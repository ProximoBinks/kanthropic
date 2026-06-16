/**
 * Render a kana glyph as a real anti-aliased image and emit it via the iTerm2
 * inline-image protocol — the actual fix for legibility, since VS Code /
 * Antigravity's terminal can display true images (when
 * `terminal.integrated.enableImages` is on). No block/braille approximation.
 *
 * Self-contained: rasterizes the font outline (reusing bigGlyph's loader) to an
 * anti-aliased RGBA bitmap, encodes a PNG with Node's zlib (no image deps), and
 * wraps the escape for tmux passthrough when inside a session.
 */
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { getFont, flatten } from "./bigGlyph.mjs";

// ── minimal PNG encoder (RGBA, no dependencies) ────────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))]);
}

// ── anti-aliased coverage rasterizer ───────────────────────────────────────
function coverage(subs, bb, W, H, SS = 3) {
  const gw = bb.x2 - bb.x1, gh = bb.y2 - bb.y1;
  const cov = Array.from({ length: H }, () => new Float32Array(W));
  const hiH = H * SS;
  for (let sy = 0; sy < hiH; sy++) {
    const y = bb.y1 + (sy + 0.5) / hiH * gh;
    const xs = [];
    for (const s of subs) {
      for (let i = 0; i < s.length; i++) {
        const a = s[i], b = s[(i + 1) % s.length];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          xs.push({ x: a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x), dir: b.y > a.y ? 1 : -1 });
        }
      }
    }
    xs.sort((p, q) => p.x - q.x);
    let w = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      w += xs[i].dir;
      if (w !== 0) {
        const xa = Math.round((xs[i].x - bb.x1) / gw * W * SS);
        const xb = Math.round((xs[i + 1].x - bb.x1) / gw * W * SS);
        for (let sx = Math.max(0, xa); sx < Math.min(W * SS, xb); sx++) cov[(sy / SS) | 0][(sx / SS) | 0] += 1;
      }
    }
  }
  const norm = 1 / (SS * SS);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cov[y][x] = Math.min(1, cov[y][x] * norm);
  return cov;
}

const ACCENT = [185, 140, 240]; // violet

/**
 * Build the iTerm2 inline-image escape for `ch`, sized to `rows` terminal cells.
 * @returns {{ escape: string, widthCells: number } | null} null if no font.
 */
export function glyphImage(ch, rows, color = ACCENT) {
  const f = getFont();
  if (!f) return null;
  try {
    const path = f.getPath(ch, 0, 0, 100);
    const bb = path.getBoundingBox();
    const gw = bb.x2 - bb.x1, gh = bb.y2 - bb.y1;
    if (!(gw > 0 && gh > 0)) return null;
    const H = 200;                          // crisp internal resolution; terminal scales down
    const W = Math.max(2, Math.round(H * (gw / gh)));
    const pad = Math.round(H * 0.06);
    const cov = coverage(flatten(path.commands), bb, W, H, 3);
    const FW = W + 2 * pad, FH = H + 2 * pad;
    const rgba = Buffer.alloc(FW * FH * 4); // transparent background
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = cov[y][x];
        if (a <= 0) continue;
        const i = ((y + pad) * FW + (x + pad)) * 4;
        rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2];
        rgba[i + 3] = Math.round(a * 255);
      }
    }
    const png = encodePNG(FW, FH, rgba);
    const b64 = png.toString("base64");
    let escape = `\x1b]1337;File=inline=1;height=${rows};preserveAspectRatio=1;size=${png.length}:${b64}\x07`;
    // tmux passthrough: double every ESC and wrap (needs `allow-passthrough on`).
    if (process.env.TMUX) escape = `\x1bPtmux;${escape.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
    // Displayed width in cells (a terminal cell is ~1:2), so we can center it.
    const widthCells = Math.max(1, Math.round(2 * rows * (FW / FH)));
    return { escape, widthCells };
  } catch {
    return null;
  }
}

// ── SIXEL encoder ──────────────────────────────────────────────────────────
// tmux built with --enable-sixel renders sixel into its OWN grid, so it
// survives redraws (unlike iTerm2 passthrough). We emit anti-aliased violet on
// a transparent background (P2=1), using a few shade levels for smooth edges.
function sixelEncode(grid, W, H, fg = ACCENT, bg = [20, 20, 28], levels = 6) {
  let out = "\x1bP0;1;0q" + `"1;1;${W};${H}`;
  for (let i = 0; i < levels; i++) {
    const t = (i + 1) / levels;
    const r = Math.round((bg[0] + (fg[0] - bg[0]) * t) / 255 * 100);
    const g = Math.round((bg[1] + (fg[1] - bg[1]) * t) / 255 * 100);
    const b = Math.round((bg[2] + (fg[2] - bg[2]) * t) / 255 * 100);
    out += `#${i};2;${r};${g};${b}`;
  }
  for (let band = 0; band * 6 < H; band++) {
    const y0 = band * 6;
    for (let lvl = 0; lvl < levels; lvl++) {
      let line = `#${lvl}`;
      let any = false, runCh = -1, runLen = 0;
      const flush = () => {
        if (runLen > 0) {
          line += runLen > 3 ? `!${runLen}${String.fromCharCode(runCh)}`
                             : String.fromCharCode(runCh).repeat(runLen);
        }
        runLen = 0;
      };
      for (let x = 0; x < W; x++) {
        let bits = 0;
        for (let dy = 0; dy < 6; dy++) {
          const y = y0 + dy;
          if (y >= H) break;
          const c = grid[y][x];
          const q = c <= 0 ? 0 : Math.min(levels, Math.ceil(c * levels));
          if (q === lvl + 1) bits |= (1 << dy);
        }
        if (bits) any = true;
        const ch = 0x3f + bits;
        if (ch === runCh) runLen++; else { flush(); runCh = ch; runLen = 1; }
      }
      flush();
      if (any) out += line + "$";
    }
    out += "-";
  }
  return out + "\x1b\\";
}

/**
 * Build a sixel image for `ch` at ~`heightPx` pixels tall.
 * @returns {{ sixel: string, widthPx: number, heightPx: number } | null}
 */
export function glyphSixel(ch, heightPx, color = ACCENT) {
  const f = getFont();
  if (!f) return null;
  try {
    const path = f.getPath(ch, 0, 0, 100);
    const bb = path.getBoundingBox();
    const gw = bb.x2 - bb.x1, gh = bb.y2 - bb.y1;
    if (!(gw > 0 && gh > 0)) return null;
    const H = Math.max(6, Math.round(heightPx / 6) * 6);
    const W = Math.max(2, Math.round(H * (gw / gh)));
    const pad = Math.round(H * 0.06);
    const cov = coverage(flatten(path.commands), bb, W, H, 2);
    const FW = W + 2 * pad, FH = Math.ceil((H + 2 * pad) / 6) * 6;
    const grid = Array.from({ length: FH }, () => new Float32Array(FW));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) grid[y + pad][x + pad] = cov[y][x];
    return { sixel: sixelEncode(grid, FW, FH, color), widthPx: FW, heightPx: FH };
  } catch {
    return null;
  }
}

/**
 * Probe the terminal for its cell pixel height (so a sixel can be sized to N
 * rows). Queries text-area pixels via CSI 14 t and divides by the row count.
 * Resolves to a pixel height, or 0 if unavailable. Never hangs (short timeout).
 * @returns {Promise<number>}
 */
export function probeCellHeight(timeoutMs = 200) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY || !stdout.isTTY) return resolve(0);
    let buf = "";
    const finish = (v) => {
      clearTimeout(timer);
      try { stdin.setRawMode(false); } catch { /* ignore */ }
      stdin.off("data", onData);
      stdin.pause();
      resolve(v);
    };
    const onData = (d) => {
      buf += d.toString();
      const m = /\x1b\[4;(\d+);(\d+)t/.exec(buf);
      if (m) {
        const px = parseInt(m[1], 10);
        finish(stdout.rows ? Math.round(px / stdout.rows) : 0);
      }
    };
    try { stdin.setRawMode(true); } catch { return resolve(0); }
    stdin.resume();
    stdin.on("data", onData);
    stdout.write("\x1b[14t");
    const timer = setTimeout(() => finish(0), timeoutMs);
  });
}

let _tmuxSixel = null;
/** Whether the current tmux client supports sixel (so tmux will store it). */
function tmuxHasSixel() {
  if (_tmuxSixel !== null) return _tmuxSixel;
  try {
    const f = execFileSync("tmux", ["display-message", "-p", "#{client_termfeatures}"],
      { encoding: "utf8" });
    _tmuxSixel = /sixel/i.test(f);
  } catch { _tmuxSixel = false; }
  return _tmuxSixel;
}

/**
 * Pick the renderer for the current terminal: a real sixel image inside a
 * sixel-capable tmux, a real iTerm2 image in a capable standalone terminal, or
 * block-art otherwise.
 * @param {"on"|"off"|"auto"} mode @returns {"sixel"|"iterm"|"blocks"}
 */
export function pickRenderer(mode) {
  if (mode === "off") return "blocks";
  if (process.env.TMUX) return tmuxHasSixel() ? "sixel" : "blocks";
  if (mode === "on") return "iterm";
  if (!process.stdout.isTTY) return "blocks";
  const tp = process.env.TERM_PROGRAM || "";
  return ["vscode", "iTerm.app", "WezTerm", "rio", "mintty"].includes(tp) ? "iterm" : "blocks";
}

/**
 * Decide whether to attempt image rendering.
 *
 * NEVER inside tmux: tmux is a cell-grid multiplexer that doesn't store inline
 * images, so it erases passthrough graphics on its next redraw (status tick,
 * card change) — leaving a broken sliver. The `kanthropic session` pane is
 * tmux, so it falls back to block-art; standalone `kanthropic drill` gets
 * real images.
 *
 * @param {"on"|"off"|"auto"} mode
 */
export function imagesEnabled(mode) {
  if (mode === "off") return false;
  if (process.env.TMUX) return false; // images don't survive tmux redraws
  if (mode === "on") return true;
  // auto: only on a TTY in a terminal known to support inline images.
  if (!process.stdout.isTTY) return false;
  const tp = process.env.TERM_PROGRAM || "";
  return ["vscode", "iTerm.app", "WezTerm", "rio", "mintty"].includes(tp);
}
