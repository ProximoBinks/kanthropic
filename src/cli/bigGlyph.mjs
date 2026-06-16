/**
 * Render a kana glyph as large terminal art so it's legible — especially the
 * dakuten (゛) vs handakuten (゜) marks. Rasterizes the real font outline
 * (opentype.js) with supersampled scanline fill, then packs sub-pixels into one
 * of three glyph styles, because how well each renders depends on the terminal:
 *
 *   half    — ▀▄█        1×2 sub-pixels/cell, solid blocks, lowest res
 *   quad    — ▘▖▝▗▚▞█…   2×2 sub-pixels/cell, solid blocks, medium res
 *   braille — ⠿⣿…        2×4 sub-pixels/cell, highest res, but dotty in some fonts
 *
 * Degrades gracefully: if no Japanese font loads, returns null and the caller
 * falls back to the plain character.
 */
import opentype from "opentype.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.KANTHROPIC_FONT,
  join(homedir(), "Library/Fonts/NotoSansJP-VariableFont_wght.ttf"),
  "/System/Library/Fonts/Supplemental/NotoSansJP-Regular.otf",
  "/Library/Fonts/NotoSansJP-Regular.otf",
].filter(Boolean);

export const STYLES = ["half", "quad", "braille"];

let _font = null;
let _tried = false;
function font() {
  if (_tried) return _font;
  _tried = true;
  for (const path of CANDIDATES) {
    try {
      if (!existsSync(path)) continue;
      const buf = readFileSync(path);
      _font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      return _font;
    } catch { /* next */ }
  }
  return _font;
}

function flatten(cmds) {
  const subs = [];
  let cur = [];
  let last = { x: 0, y: 0 };
  const cubic = (p0, p1, p2, p3, n = 16) => {
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      cur.push({ x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
                 y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y });
    }
  };
  const quad = (p0, p1, p2, n = 12) => {
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      cur.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
                 y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y });
    }
  };
  for (const c of cmds) {
    if (c.type === "M") { if (cur.length) subs.push(cur); cur = [{ x: c.x, y: c.y }]; last = { x: c.x, y: c.y }; }
    else if (c.type === "L") { cur.push({ x: c.x, y: c.y }); last = { x: c.x, y: c.y }; }
    else if (c.type === "C") { cubic(last, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }); last = { x: c.x, y: c.y }; }
    else if (c.type === "Q") { quad(last, { x: c.x1, y: c.y1 }, { x: c.x, y: c.y }); last = { x: c.x, y: c.y }; }
    else if (c.type === "Z") { if (cur.length) subs.push(cur); cur = []; }
  }
  if (cur.length) subs.push(cur);
  return subs;
}

/** Supersampled non-zero-winding fill → boolean grid [H][W]. */
function rasterize(subs, bb, W, H, SS = 2) {
  const gw = bb.x2 - bb.x1, gh = bb.y2 - bb.y1;
  const cov = Array.from({ length: H }, () => new Array(W).fill(0));
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
        for (let sx = Math.max(0, xa); sx < Math.min(W * SS, xb); sx++) cov[(sy / SS) | 0][(sx / SS) | 0]++;
      }
    }
  }
  const thr = SS * SS * 0.34;
  return cov.map((row) => row.map((v) => v >= thr));
}

/** Thicken strokes by `n` sub-pixels (8-neighbour dilation) so the fine curvy
 *  strokes of complex/yōon glyphs stay connected instead of fragmenting. */
function dilate(grid, n = 1) {
  let g = grid;
  for (let k = 0; k < n; k++) {
    const H = g.length, W = g[0].length;
    const out = Array.from({ length: H }, () => new Array(W).fill(false));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (g[y][x] || g[y - 1]?.[x] || g[y + 1]?.[x] || g[y][x - 1] || g[y][x + 1]
            || g[y - 1]?.[x - 1] || g[y - 1]?.[x + 1] || g[y + 1]?.[x - 1] || g[y + 1]?.[x + 1]) {
          out[y][x] = true;
        }
      }
    }
    g = out;
  }
  return g;
}

const QUAD = [" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"];
const DOT = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]];

const CFG = {
  half:    { sx: 1, sy: 2, pack: (g, cx, cy) => {
    const t = g[cy * 2]?.[cx], b = g[cy * 2 + 1]?.[cx];
    return t && b ? "█" : t ? "▀" : b ? "▄" : " ";
  } },
  quad:    { sx: 2, sy: 2, pack: (g, cx, cy) => {
    const i = (g[cy * 2]?.[cx * 2] ? 1 : 0) | (g[cy * 2]?.[cx * 2 + 1] ? 2 : 0)
            | (g[cy * 2 + 1]?.[cx * 2] ? 4 : 0) | (g[cy * 2 + 1]?.[cx * 2 + 1] ? 8 : 0);
    return QUAD[i];
  } },
  braille: { sx: 2, sy: 4, pack: (g, cx, cy) => {
    let b = 0;
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 4; dy++) if (g[cy * 4 + dy]?.[cx * 2 + dx]) b |= DOT[dx][dy];
    return String.fromCharCode(0x2800 + b);
  } },
};

/**
 * @param {string} ch a single glyph (or yōon pair)
 * @param {number} rows terminal rows of art
 * @param {number} [maxCols] cap width (cells)
 * @param {"half"|"quad"|"braille"} [style]
 * @returns {string[] | null} art lines, or null if no font
 */
export function renderGlyph(ch, rows = 8, maxCols = Infinity, style = "braille", bold = 1) {
  const f = font();
  if (!f) return null;
  const cfg = CFG[style] || CFG.braille;
  try {
    const path = f.getPath(ch, 0, 0, 100);
    const bb = path.getBoundingBox();
    const gw = bb.x2 - bb.x1, gh = bb.y2 - bb.y1;
    if (!(gw > 0 && gh > 0)) return null;
    const a = gw / gh;
    // Cell footprint is style-independent: a terminal cell is ~1 wide : 2 tall,
    // so a square glyph occupies cellsW = 2·rows·aspect cells.
    let cellsH = Math.max(2, rows);
    let cellsW = Math.max(1, Math.round(2 * cellsH * a));
    if (cellsW > maxCols) { cellsW = Math.max(1, maxCols); cellsH = Math.max(2, Math.round(cellsW / (2 * a))); }
    let grid = rasterize(flatten(path.commands), bb, cellsW * cfg.sx, cellsH * cfg.sy, 2);
    // Wider glyphs (yōon) are rendered smaller per-stroke, so thicken more.
    const extra = a > 1.4 ? 1 : 0;
    if (bold + extra > 0) grid = dilate(grid, bold + extra);
    const lines = [];
    for (let cy = 0; cy < cellsH; cy++) {
      let line = "";
      for (let cx = 0; cx < cellsW; cx++) line += cfg.pack(grid, cx, cy);
      lines.push(line.replace(/[ ⠀]+$/, ""));
    }
    return lines;
  } catch {
    return null;
  }
}

/** Back-compat default used by the drill. */
export function bigGlyph(ch, rows = 8, maxCols = Infinity, style = "braille") {
  return renderGlyph(ch, rows, maxCols, style);
}
