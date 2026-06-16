/**
 * kanthropic progress status line — GENERATED. Do not edit here; edit the
 * template in the kanthropic package and re-run `kanthropic install`.
 *
 * Claude Code runs this on every status-line refresh and renders its one line
 * at the bottom of the terminal. It reads ~/.kanthropic/progress.json and prints
 * a compact summary of your kana progress, so every time you drill more, the
 * next refresh shows updated numbers. Stateless, dependency-free, never throws.
 *
 * `__PKG_SRC__` is substituted by the installer with the absolute path to the
 * package `src/` dir so these imports resolve regardless of cwd.
 */
import { load } from "__PKG_SRC__/core/store.mjs";
import { ENTRIES, glyph as glyphOf } from "__PKG_SRC__/data/kana.mjs";

const V = "\x1b[38;5;176m"; // violet accent
const D = "\x1b[2m";        // dim
const G = "\x1b[32m";       // green (learned)
const A = "\x1b[38;5;179m"; // amber (due)
const R = "\x1b[0m";

try {
  const store = load();
  const script = store.config.script;
  const now = Date.now();
  // FSRS state 2 = Review (graduated/"learned"); seen>0 but not graduated =
  // still learning; never seen = new/"to go".
  let total = 0, seen = 0, learned = 0, learning = 0, due = 0, reviews = 0, correct = 0;
  for (const e of ENTRIES) {
    total++;
    const card = store.cards[glyphOf(e, script)];
    if (card && card.seen > 0) {
      seen++;
      if (card.state === 2) learned++; else learning++;
      if (card.due <= now) due++;
      reviews += card.seen;
      correct += card.seen - card.misses;
    }
  }
  const toGo = total - seen;
  const acc = reviews > 0 ? Math.round((correct / reviews) * 100) : 100;
  // e.g.  かな hiragana · 24 learned · 8 learning · 30 due · 42 to go · 88%
  const dot = `${D}·${R}`;
  const parts = [
    `${V}かな${R} ${D}${script}${R}`,
    `${G}${learned}${R} learned`,
    `${learning} learning`,
    `${due > 0 ? A : D}${due} due${R}`,
    `${toGo} to go`,
    `${D}${acc}%${R}`,
  ];
  process.stdout.write(parts.join(` ${dot} `));
} catch {
  /* prime directive: never break the status line */
}
