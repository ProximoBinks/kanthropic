/**
 * The "learned pool" — the set of glyphs the user has gone through in
 * `kanthropic learn`. The drill, session, and study practice ONLY these, so a
 * character is never first encountered in the ambient pop-up. New characters
 * enter the pool only via learn mode.
 */
import { ENTRIES, glyph as glyphOf } from "../data/kana.mjs";

/** Glyphs (one script) the user can possibly learn. */
export const SCRIPT_TOTAL = ENTRIES.length; // 104

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
