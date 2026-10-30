/**
 * FSRS scheduling for the typed drill — the same engine the hypertools kana
 * app uses (`ts-fsrs`). Imported ONLY by the drill, never by the ambient
 * status-line tick, so the hot path stays dependency-free and fast.
 *
 * @typedef {import("./store.mjs").CardState} CardState
 * @typedef {import("../data/kana.mjs").Script} Script
 */
import { createEmptyCard, fsrs, generatorParameters, Rating } from "ts-fsrs";
import { entryByGlyph } from "../data/kana.mjs";
import { MASTER_DAYS, MASTERED_STATE } from "./learned.mjs";

// Fuzz spreads due dates so cards reviewed together don't all return the same day.
// A `1d` learning step (default is just 1m/10m) means a freshly learned card
// comes back the NEXT DAY before it can graduate — so "mastered" reflects recall
// across a real gap, not two passes seconds apart.
const f = fsrs(generatorParameters({ enable_fuzz: true, learning_steps: ["1m", "10m", "1d"] }));
// Phrases cap the gap at a month. Tile and listening answers are recognition,
// easier than recall, so an unbroken run of them would otherwise push a
// phrase out for a year after four reviews — and you need them in conversation.
export const PHRASE_MAX_DAYS = 30;
const fPhrase = fsrs(generatorParameters({ enable_fuzz: true, learning_steps: ["1m", "10m", "1d"], maximum_interval: PHRASE_MAX_DAYS }));

const DAY_MS = 86_400_000;
/** LOCAL-timezone day index for `ms` — used to count *distinct* days a card
 *  was recalled. Local, not UTC: for most of the world UTC midnight lands in
 *  the middle of the local day (9 AM in Tokyo, 4–8 PM in the US), which would
 *  let one afternoon+evening sitting count as "two days". */
const dayOf = (ms) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / DAY_MS);

/** Minimum gap between two reviews that count as separate days, so 23:59 →
 *  00:01 (or a DST shift / travel) can't fake the second day. ~a night's sleep. */
const MIN_DAY_GAP_MS = 8 * 3_600_000;

/** Reconstruct a ts-fsrs Card from a stored row (ms → Date), or start fresh.
 *  @param {CardState | undefined} c @param {Date} now */
function toCard(c, now) {
  if (!c) return createEmptyCard(now);
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps ?? 0,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  };
}

/**
 * Grade a review and return the next CardState. A correct answer grades as
 * `Good`, a wrong answer as `Again` (shortening the next interval). Mirrors
 * the hypertools `review` mutation, on local state.
 *
 * @param {Script} script
 * @param {string} glyph  the displayed character (store key)
 * @param {CardState | undefined} prev
 * @param {boolean} correct
 * @param {Date} [now]
 * @param {number | null} [rating]  an explicit ts-fsrs Rating (1–4); overrides `correct`
 * @returns {CardState}
 */
export function gradeCard(script, glyph, prev, correct, now = new Date(), rating = null) {
  const entry = entryByGlyph(script, glyph);
  const romaji = entry ? entry.romaji : (prev?.romaji ?? "");
  let next;
  try {
    next = (/** @type {string} */ (script) === "phrase" ? fPhrase : f).next(toCard(prev, now), now, rating ?? (correct ? Rating.Good : Rating.Again)).card;
  } catch {
    // Corrupt/legacy card state (e.g. a null stability) must not crash the drill
    // — restart this card's schedule cleanly instead.
    next = (/** @type {string} */ (script) === "phrase" ? fPhrase : f).next(createEmptyCard(now), now, rating ?? (correct ? Rating.Good : Rating.Again)).card;
  }

  // Track the number of DISTINCT days the card was recalled correctly. A card
  // counts as mastered only once this reaches MASTER_DAYS (see isMastered), so
  // two passes in one sitting can't fake it. A day only counts when it's a new
  // LOCAL calendar day AND ≥ MIN_DAY_GAP_MS since the last counted one; the
  // anchor (lastGoodDay/lastGoodAt) advances only on a counted day, so a
  // just-under-the-gap review doesn't push the next chance further out.
  // Cards from before this field existed are treated as already proven.
  const nowMs = now.getTime();
  const today = dayOf(nowMs);
  const priorGoodDays = prev?.goodDays ?? ((prev?.state ?? 0) >= MASTERED_STATE ? MASTER_DAYS : 0);
  let goodDays, lastGoodDay, lastGoodAt;
  if (correct) {
    const newDay = today !== prev?.lastGoodDay
      && (prev?.lastGoodAt == null || nowMs - prev.lastGoodAt >= MIN_DAY_GAP_MS);
    goodDays = newDay ? priorGoodDays + 1 : priorGoodDays;
    lastGoodDay = newDay || prev?.lastGoodDay == null ? today : prev.lastGoodDay;
    lastGoodAt = newDay || prev?.lastGoodAt == null ? nowMs : prev.lastGoodAt;
  } else {
    goodDays = 0;            // a miss breaks the across-days streak
    lastGoodDay = undefined;
    lastGoodAt = undefined;
  }

  return {
    goodDays,
    lastGoodDay,
    lastGoodAt,
    script,
    romaji,
    due: next.due.getTime(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsed_days: next.elapsed_days,
    scheduled_days: next.scheduled_days,
    learning_steps: next.learning_steps ?? 0,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    last_review: next.last_review ? next.last_review.getTime() : now.getTime(),
    seen: (prev?.seen ?? 0) + 1,
    misses: (prev?.misses ?? 0) + (correct ? 0 : 1),
  };
}
