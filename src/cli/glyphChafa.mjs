/**
 * Render a kana glyph as terminal symbol-art via chafa (libchafa, WASM).
 *
 * The fallback when the terminal can't display inline images: rasterize the
 * font outline to an anti-aliased white-on-black bitmap and let chafa's
 * perceptual symbol mapper pick the best Unicode (braille) symbols — the same
 * engine the `chafa` CLI uses, so output is consistent and needs no tuning.
 *
 * Returns plain symbol text; the caller wraps it in its accent colour.
 */
import ChafaFactory from "chafa-wasm";
import { getFont, flatten } from "./font.mjs";
import { coverage } from "./glyphImage.mjs";

let _mod = null;
async function mod() {
  if (!_mod) _mod = await ChafaFactory();
  return _mod;
}

/** Rasterize `ch` to an anti-aliased grayscale ImageDataLike (white on black). */
function glyphImageData(ch, scale = 240) {
  const f = getFont();
  if (!f) return null;
  const path = f.getPath(ch, 0, 0, 100);
  const bb = path.getBoundingBox();
  const gw = bb.x2 - bb.x1, gh = bb.y2 - bb.y1;
  if (!(gw > 0 && gh > 0)) return null;
  const H = scale, W = Math.max(2, Math.round(H * (gw / gh)));
  const pad = Math.round(H * 0.08);
  const cov = coverage(flatten(path.commands), bb, W, H, 3);
  const FW = W + 2 * pad, FH = H + 2 * pad;
  const data = new Uint8ClampedArray(FW * FH * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255; // opaque, black bg
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.round(cov[y][x] * 255);
      const i = ((y + pad) * FW + (x + pad)) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v;
    }
  }
  return { width: FW, height: FH, data };
}

/**
 * @param {string} ch
 * @param {number} rows cells tall
 * @param {number} cols cells wide (cap)
 * @param {{ symbols?: string }} [opts] chafa symbol selector (e.g. "block",
 *        "braille", "all", "block+border", "vhalf+quad")
 * @returns {Promise<string[] | null>} art lines, or null if no font
 */
export async function glyphChafa(ch, rows = 8, cols = 48, { symbols = "braille" } = {}) {
  const img = glyphImageData(ch);
  if (!img) return null;
  const m = await mod();
  try {
    const ansi = await new Promise((res, rej) => {
      m.imageToAnsi(img, {
        format: "CHAFA_PIXEL_MODE_SYMBOLS",
        colors: "CHAFA_CANVAS_MODE_FGBG", // monochrome → plain symbols, caller adds accent color
        height: rows,
        width: cols,
        fontRatio: 0.5,      // terminal cell ≈ 1 wide : 2 tall
        symbols,
      }, (err, data) => (err ? rej(err) : res(data.ansi)));
    });
    return ansi.replace(/\n$/, "").split("\n");
  } catch (e) {
    // libchafa can hit an out-of-bounds on certain glyph/size combos, which
    // corrupts the shared WASM heap — drop the cached module so the *next*
    // glyph starts from a clean instance instead of cascading failures.
    _mod = null;
    throw e;
  }
}
