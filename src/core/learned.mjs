/**
 * The "learned pool" — the set of glyphs the user has gone through in
 * `kanthropic learn`. The drill, session, and study practice ONLY these, so a
 * character is never first encountered in the ambient pop-up. New characters
 * enter the pool only via learn mode.
 */
import { ENTRIES, glyph as glyphOf } from "../data/kana.mjs";

/** Glyphs (one script) the user can possibly learn. */
export const SCRIPT_TOTAL = ENTRIES.length; // 104

/** FSRS state at which a card counts as "mastered" (Review). */
export const MASTERED_STATE = 2;

/** Distinct days a card must be recalled correctly before it counts as mastered,
 *  so two passes in one sitting (short-term memory) can't graduate it. */
export const MASTER_DAYS = 2;

/**
 * Is this card mastered? It must have graduated to FSRS Review AND been recalled
 * correctly on at least MASTER_DAYS separate days — real retention, not a fluke.
 * Cards from before day-tracking existed (no `goodDays`) are treated as proven.
 * @param {{state?:number, goodDays?:number}=} card
 */
export function isMastered(card) {
  if ((card?.state ?? 0) < MASTERED_STATE) return false;
  return (card?.goodDays ?? Infinity) >= MASTER_DAYS;
}

/**
 * Wipe progress for `glyphs`: forget their FSRS cards and pull them out of the
 * learned pool. Mutates `store`; returns the number of glyphs actually cleared.
 * @param {{cards:Record<string,any>, learned:string[]}} store
 * @param {Iterable<string>} glyphs
 */
export function resetGlyphs(store, glyphs) {
  const drop = new Set(glyphs);
  const pool = new Set(store.learned || []);
  let n = 0;
  for (const g of drop) {
    if (store.cards[g] || pool.has(g)) n++; // cleared if it had a card or sat in the pool
    if (store.cards[g]) delete store.cards[g];
  }
  store.learned = (store.learned || []).filter((g) => !drop.has(g));
  return n;
}

/**
 * One-time migration for users who drilled before learn mode existed: seed
 * `learned` from any glyph they've already practiced, so they keep their deck.
 * Mutates `store`; returns true when it changed something (caller should save).
 * Guarded by `store.learnedMigrated` so it runs exactly once.
 */
export function ensureLearned(store) {
  if (store.learnedMigrated) return false;
  store.learnedMigrated = true;
  const set = new Set(store.learned);
  for (const g of Object.keys(store.cards)) {
    if ((store.cards[g]?.seen ?? 0) > 0) set.add(g);
  }
  store.learned = [...set];
  return true;
}

/** Number of learned glyphs in `script`. */
export function learnedCount(store, script) {
  const set = new Set(store.learned);
  let n = 0;
  for (const e of ENTRIES) if (set.has(glyphOf(e, script))) n++;
  return n;
}

/** Every learned glyph of `script`, ignoring due dates (for "practice anyway"). */
export function learnedSet(store, script) {
  const set = new Set(store.learned);
  const out = new Set();
  for (const e of ENTRIES) {
    const g = glyphOf(e, script);
    if (set.has(g)) out.add(g);
  }
  return out;
}

/**
 * Learned glyphs you haven't mastered yet (FSRS Review + 2 days). Used for the
 * honest "still learning N" count and icons — includes graduated cards that are
 * just waiting on their second day. @returns {Set<string>}
 */
export function unmasteredPool(store, script) {
  const set = new Set(store.learned);
  const out = new Set();
  for (const e of ENTRIES) {
    const g = glyphOf(e, script);
    if (set.has(g) && !isMastered(store.cards[g])) out.add(g);
  }
  return out;
}

/**
 * Learned glyphs still in the LEARNING PHASE — not yet graduated to FSRS Review
 * (New / Learning / Relearning). This is the active grind set: once a card
 * graduates it rides its schedule instead of being drilled on repeat, even if
 * it isn't "mastered" yet (that still needs a second day). So you can't get
 * stuck hammering a card you've clearly already learned. @returns {Set<string>}
 */
export function learningPool(store, script) {
  const set = new Set(store.learned);
  const out = new Set();
  for (const e of ENTRIES) {
    const g = glyphOf(e, script);
    if (set.has(g) && (store.cards[g]?.state ?? 0) !== MASTERED_STATE) out.add(g);
  }
  return out;
}

/**
 * Glyphs of `script` that are learned AND worth practicing now — never drilled
 * (new) or due for review. Empty ⇒ you're caught up.
 * @returns {Set<string>}
 */
export function practiceablePool(store, script, now = Date.now()) {
  const set = new Set(store.learned);
  const pool = new Set();
  for (const e of ENTRIES) {
    const g = glyphOf(e, script);
    if (!set.has(g)) continue;
    const c = store.cards[g];
    if (!c || (c.seen ?? 0) === 0 || c.due <= now) pool.add(g);
  }
  return pool;
}
