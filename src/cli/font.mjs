/**
 * Shared font loading + path flattening for the glyph renderers.
 *
 * Prefers the bundled kana font (a subset of Noto Sans JP, OFL) so glyphs
 * render on any machine with no system Japanese font, then a few system
 * locations. We only need glyph OUTLINES — they get rasterized to a bitmap for
 * the image / chafa renderers.
 */
import opentype from "opentype.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLED_FONT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts", "kana.ttf");

const CANDIDATES = [
  process.env.KANTHROPIC_FONT,
  BUNDLED_FONT, // ships with kanthropic → works with no system font installed
  join(homedir(), "Library/Fonts/NotoSansJP-VariableFont_wght.ttf"),
  "/System/Library/Fonts/Supplemental/NotoSansJP-Regular.otf",
  "/Library/Fonts/NotoSansJP-Regular.otf",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
].filter(Boolean);

let _font = null;
let _tried = false;

/** The loaded JP font (or null if none could be parsed). Cached. */
export function getFont() {
  if (_tried) return _font;
  _tried = true;
  for (const path of CANDIDATES) {
    try {
      if (!existsSync(path)) continue;
      const buf = readFileSync(path);
      _font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      return _font;
    } catch { /* try the next candidate */ }
  }
  return _font;
}

/** Flatten opentype path commands into closed polygons (arrays of points). */
export function flatten(cmds) {
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
