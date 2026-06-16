/**
 * Render a kana glyph as large half-block art so it's actually legible in a
 * terminal pane — in particular so the dakuten (゛, two strokes) and
 * handakuten (゜, a ring) are unmistakable. Rasterizes the real font outline
 * (opentype.js) to a pixel grid, then maps each pair of vertical pixels to a
 * half-block character (▀ ▄ █), doubling vertical resolution.
 *
 * Degrades gracefully: if no Japanese font can be loaded, `bigGlyph` returns
 * null and the caller falls back to the plain character.
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
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
].filter(Boolean);

let _font = null;   // cached parsed font
let _tried = false; // so a missing font is only logged/attempted once

function font() {
  if (_tried) return _font;
  _tried = true;
  for (const path of CANDIDATES) {
    try {
      if (!existsSync(path)) continue;
      const buf = readFileSync(path);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      _font = opentype.parse(ab);
      return _font;
    } catch { /* try the next candidate */ }
  }
  return _font;
}

/** Flatten a glyph path's commands into closed polygons (arrays of points). */
function flatten(cmds) {
  const subs = [];
  let cur = [];
  let last = { x: 0, y: 0 };
  const cubic = (p0, p1, p2, p3, n = 14) => {
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      cur.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
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

/**
 * @param {string} ch a single glyph
 * @param {number} heightPx pixel height to rasterize at (rows of art = heightPx/2)
 * @returns {string[] | null} lines of half-block art, or null if no font
 */
export function bigGlyph(ch, heightPx = 24) {
  const f = font();
  if (!f) return null;
  try {
    const H = Math.max(4, Math.round(heightPx / 2) * 2);
    const path = f.getPath(ch, 0, 0, 100);
    const bb = path.getBoundingBox();
    const gw = bb.x2 - bb.x1, gh = bb.y2 - bb.y1;
    if (!(gw > 0 && gh > 0)) return null;
    // 1 cell = 1px wide × 2px tall (half-blocks), and a cell is ~2× taller than
    // wide, so square pixels ⇒ W cells = the glyph's pixel width at this height.
    const W = Math.max(2, Math.round(H * (gw / gh)));
    const subs = flatten(path.commands);
    const grid = Array.from({ length: H }, () => new Array(W).fill(false));

    for (let py = 0; py < H; py++) {
      const y = bb.y1 + (py + 0.5) / H * gh;
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
          const x0 = Math.round((xs[i].x - bb.x1) / gw * W);
          const x1 = Math.round((xs[i + 1].x - bb.x1) / gw * W);
          for (let px = Math.max(0, x0); px < Math.min(W, x1); px++) grid[py][px] = true;
        }
      }
    }

    const lines = [];
    for (let py = 0; py < H; py += 2) {
      let line = "";
      for (let px = 0; px < W; px++) {
        const t = grid[py][px], b = py + 1 < H ? grid[py + 1][px] : false;
        line += t && b ? "█" : t ? "▀" : b ? "▄" : " ";
      }
      lines.push(line.replace(/\s+$/, ""));
    }
    return lines;
  } catch {
    return null;
  }
}
