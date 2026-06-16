/**
 * Render a kana glyph as large Unicode braille art so it's crisp and legible in
 * a terminal pane — in particular so the dakuten (゛, two strokes) and
 * handakuten (゜, a ring) are unmistakable, and yōon combos stay readable.
 *
 * Braille gives 2×4 sub-dots per character cell (4× the resolution of a
 * half-block), so thin strokes survive. We rasterize the real font outline
 * (opentype.js) with supersampled scanline fill, then pack each 2×4 block of
 * sub-pixels into one braille glyph.
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
].filter(Boolean);

let _font = null;
let _tried = false;

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
  const cubic = (p0, p1, p2, p3, n = 16) => {
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

/** Supersampled coverage → boolean sub-pixel grid [H][W] (non-zero winding). */
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
        for (let sx = Math.max(0, xa); sx < Math.min(W * SS, xb); sx++) {
          cov[Math.floor(sy / SS)][Math.floor(sx / SS)]++;
        }
      }
    }
  }
  const thr = SS * SS * 0.35;
  return cov.map((row) => row.map((v) => v >= thr));
}

// sub-pixel (dx 0..1, dy 0..3) → braille dot bit
const DOT = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]];

/**
 * @param {string} ch a single glyph (or yōon pair)
 * @param {number} rows terminal rows of art to produce
 * @param {number} [maxCols] cap the width (cells) so wide yōon fit the pane
 * @returns {string[] | null} braille lines, or null if no font
 */
export function bigGlyph(ch, rows = 7, maxCols = Infinity) {
  const f = font();
  if (!f) return null;
  try {
    const path = f.getPath(ch, 0, 0, 100);
    const bb = path.getBoundingBox();
    const gw = bb.x2 - bb.x1, gh = bb.y2 - bb.y1;
    if (!(gw > 0 && gh > 0)) return null;
    const aspect = gw / gh;
    // Square sub-pixels: a braille cell is 2 wide × 4 tall and a terminal cell
    // is ~1:2, so 2px:4px maps to a square pixel. W must be even (2 per cell).
    let H = Math.max(4, rows * 4);
    let W = Math.max(2, Math.round((H * aspect) / 2) * 2);
    if (W / 2 > maxCols) { // too wide → constrain by width, keep aspect
      W = Math.max(2, maxCols * 2);
      H = Math.max(4, Math.round((W / aspect) / 4) * 4);
    }
    const grid = rasterize(flatten(path.commands), bb, W, H, 2);

    const lines = [];
    for (let cy = 0; cy < H / 4; cy++) {
      let line = "";
      for (let cx = 0; cx < W / 2; cx++) {
        let bits = 0;
        for (let dx = 0; dx < 2; dx++) {
          for (let dy = 0; dy < 4; dy++) {
            if (grid[cy * 4 + dy]?.[cx * 2 + dx]) bits |= DOT[dx][dy];
          }
        }
        line += String.fromCharCode(0x2800 + bits);
      }
      lines.push(line.replace(/⠀+$/, "")); // trim trailing blank braille
    }
    return lines;
  } catch {
    return null;
  }
}
