/**
 * Pure card selection for the ambient (status-line) surface. NO ts-fsrs import
 * — the status-line script runs on every Claude Code refresh, so this stays
 * dependency-free and instant.
 *
 * Selection is weighted toward what you don't know yet: brand-new glyphs are
 * surfaced most, then due/lapsed ones, then everything else. Ambient mode only
 * *displays* — it never grades — so it reads the drill's FSRS state but doesn't
 * mutate card schedules.
 *
 * @typedef {import("./store.mjs").CardState} CardState
 * @typedef {import("../data/kana.mjs").Script} Script
 */
import { ENTRIES, glyph as glyphOf } from "../data/kana.mjs";

/** @param {CardState | undefined} card @param {number} now @returns {number} */
function weight(card, now) {
  if (!card || card.seen === 0) return 6;       // never studied → show most
  if (card.misses > 0) return 4;                // historically missed
  if (card.due <= now) return 3;                // due for review
  if (card.state <= 1) return 2;                // still learning
  return 1;                                      // mastered → occasional refresh
}

/**
 * Pick the next glyph to surface for `script`, weighted by mastery and avoiding
 * an immediate repeat of `avoidGlyph`.
 *
 * @param {Script} script
 * @param {Record<string, CardState>} cards
 * @param {string | null} [avoidGlyph]
 * @param {number} [now]
 * @param {() => number} [rng]  injectable for tests
 * @returns {{ glyph: string, romaji: string } | null}
 */
export function pickNext(script, cards, avoidGlyph = null, now = Date.now(), rng = Math.random) {
  const pool = [];
  let total = 0;
  for (const entry of ENTRIES) {
    const g = glyphOf(entry, script);
    if (g === avoidGlyph) continue;
    const w = weight(cards[g], now);
    pool.push({ glyph: g, romaji: entry.romaji, w });
    total += w;
  }
  if (pool.length === 0) return null;
  let r = rng() * total;
  for (const p of pool) {
    r -= p.w;
    if (r <= 0) return { glyph: p.glyph, romaji: p.romaji };
  }
  const last = pool[pool.length - 1];
  return { glyph: last.glyph, romaji: last.romaji };
}
