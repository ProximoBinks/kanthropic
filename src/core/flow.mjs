/**
 * Two tracks, Anki-shaped:
 *
 *   learn  — introduce a row, then rote it until it sticks (no FSRS writes
 *            on hits — cramming must not inflate review intervals)
 *   study  — only FSRS-due cards. Caught up means caught up.
 *
 * Coming back a month later: due cards surface on their own, as long as
 * rote didn't fake "Good" reviews. "I've been away" marks everything due.
 *
 * @typedef {import("../data/kana.mjs").Script} Script
 * @typedef {import("./store.mjs").CardState} CardState
 */
import { CHART_FAMILIES, DAKUTEN_LESSONS, ENTRIES, GROUPS, glyph as glyphOf, peelJunk } from "../data/kana.mjs";
import {
  isMastered, learnedCount, learningPool, practiceablePool, resetGlyphs, SCRIPT_TOTAL,
} from "./learned.mjs";
import { clearDrillProgress, drillKey } from "./drill-progress.mjs";
import { pickNext } from "./ambient.mjs";

/** Consecutive hits in a rote sitting before a card counts as sticking. */
export const ROTE_STREAK = 3;

/**
 * A script is mastered once every glyph is FSRS Review + recalled on
 * ≥ MASTER_DAYS separate days.
 * @param {Record<string, CardState | undefined>} cards
 * @param {Script} script
 */
export function scriptMastered(cards, script) {
  return ENTRIES.every((e) => isMastered(cards[glyphOf(e, script)]));
}

/**
 * Script to practice. An explicit choice always wins; otherwise auto-advance
 * hiragana → katakana once hiragana is fully mastered.
 * @param {{ config?: { script?: Script, autoAdvance?: boolean }, cards?: Record<string, CardState> }} store
 * @param {Script | null} [explicit]
 * @returns {Script}
 */
export function resolveScript(store, explicit) {
  if (explicit === "hiragana" || explicit === "katakana") return explicit;
  const s = store.config?.script === "katakana" ? "katakana" : "hiragana";
  if (store.config?.autoAdvance === false) return s;
  const cards = store.cards ?? {};
  if (s === "hiragana" && scriptMastered(cards, "hiragana") && !scriptMastered(cards, "katakana")) {
    return "katakana";
  }
  return s;
}

/**
 * Learnable rows for a script, in teaching order (gojūon → dakuten → yōon).
 * @param {Script} [_script] unused — row shape is shared; glyphs are derived by the caller
 * @returns {{ section: string, entries: import("../data/kana.mjs").KanaEntry[] }[]}
 */
export function rowsFor(_script) {
  const rows = [];
  for (const g of GROUPS) {
    for (const row of g.rows) {
      const entries = row.filter(Boolean);
      if (entries.length) rows.push({ section: g.label, entries });
    }
  }
  return rows;
}

/**
 * First row not yet fully in the learned pool, or null if every row is in.
 * @param {{ learned?: string[] }} store
 * @param {Script} script
 * @returns {import("../data/kana.mjs").KanaEntry[] | null}
 */
export function nextUnlearnedRow(store, script) {
  const learned = new Set(store.learned || []);
  for (const r of rowsFor(script)) {
    if (!r.entries.every((e) => learned.has(glyphOf(e, script)))) return r.entries;
  }
  return null;
}

/** Every glyph belonging to `script`. */
export function scriptGlyphs(script) {
  return ENTRIES.map((e) => glyphOf(e, script));
}

/**
 * Study pool: only what's actually due (or never drilled). Caught up is
 * empty — do not keep grading Good on a graduated deck.
 *
 * @param {{ learned?: string[], cards?: Record<string, CardState> }} store
 * @param {Script} script
 * @param {number} [now]
 * @returns {{ pool: Set<string>, reason: "due" | "caught-up" | "empty" }}
 */
export function revisePool(store, script, now = Date.now()) {
  if (learnedCount(store, script) === 0) return { pool: new Set(), reason: "empty" };
  const due = practiceablePool(store, script, now);
  if (due.size > 0) return { pool: due, reason: "due" };
  return { pool: new Set(), reason: "caught-up" };
}

/**
 * Glyphs in the active rote set for this script. Falls back to still-learning
 * cards so "rote the shaky ones" works after a gap.
 * @param {{ learned?: string[], rote?: string[], cards?: Record<string, CardState> }} store
 * @param {Script} script
 */
export function roteSet(store, script) {
  const allowed = new Set(scriptGlyphs(script));
  const learned = new Set(store.learned || []);
  const explicit = (store.rote || []).filter((g) => allowed.has(g) && learned.has(g));
  if (explicit.length) return new Set(explicit);
  return learningPool(store, script);
}

/**
 * Next revise card. Avoids an immediate repeat unless the pool is a single glyph.
 * @param {{ learned?: string[], cards?: Record<string, CardState> }} store
 * @param {Script} script
 * @param {string | null} [lastGlyph]
 * @param {number} [now]
 * @param {() => number} [rng]
 * @returns {{ glyph: string, romaji: string, reason: string, poolSize: number } | null}
 */
export function nextRevise(store, script, lastGlyph = null, now = Date.now(), rng = Math.random) {
  const { pool, reason } = revisePool(store, script, now);
  if (pool.size === 0) return { glyph: null, romaji: null, reason, poolSize: 0 };
  const avoid = pool.size > 1 ? lastGlyph : null;
  const next = pickNext(script, store.cards || {}, avoid, now, rng, pool);
  if (!next) return { glyph: null, romaji: null, reason, poolSize: 0 };
  return { glyph: next.glyph, romaji: next.romaji, reason, poolSize: pool.size };
}

/**
 * Next rote card from the active set.
 * @param {{ learned?: string[], rote?: string[], cards?: Record<string, CardState> }} store
 * @param {Script} script
 * @param {string | null} [lastGlyph]
 * @param {() => number} [rng]
 */
export function nextRote(store, script, lastGlyph = null, rng = Math.random, streaks = {}) {
  const pool = new Set([...roteSet(store, script)].filter((g) => (streaks[g] || 0) < ROTE_STREAK));
  if (pool.size === 0) return { glyph: null, romaji: null, reason: "empty", poolSize: 0 };
  const avoid = pool.size > 1 ? lastGlyph : null;
  const next = pickNext(script, store.cards || {}, avoid, Date.now(), rng, pool);
  if (!next) return { glyph: null, romaji: null, reason: "empty", poolSize: pool.size };
  return { glyph: next.glyph, romaji: next.romaji, reason: "rote", poolSize: pool.size };
}

const DRILL_LABELS = { gojuon: "regular", dakuten: "dakuten", yoon: "yōon" };

/**
 * Learned glyphs split by gojūon / dakuten / yōon for a "drill all" picker.
 * Unlearned characters stay out — this is practice, not a first look.
 * "everything" is included only when more than one group has learned glyphs.
 *
 * @param {{ learned?: string[] }} store
 * @param {Script} script
 * @returns {{ id: string, label: string, count: number, glyphs: string[] }[]}
 */
export function drillSets(store, script) {
  const learned = new Set(store.learned || []);
  /** @type {{ id: string, label: string, count: number, glyphs: string[] }[]} */
  const sets = [];
  for (const g of GROUPS) {
    const glyphs = [];
    for (const e of ENTRIES) {
      if (e.group !== g.id) continue;
      const ch = glyphOf(e, script);
      if (learned.has(ch)) glyphs.push(ch);
    }
    if (glyphs.length) {
      sets.push({ id: g.id, label: DRILL_LABELS[g.id] || g.id, count: glyphs.length, glyphs });
    }
  }
  if (sets.length > 1) {
    const glyphs = sets.flatMap((s) => s.glyphs);
    sets.push({ id: "all", label: "everything", count: glyphs.length, glyphs });
  }
  return sets;
}

/**
 * Put a drill-all set into the rote pool. Mutates store.
 * Pass `glyphs` to drill an explicit row (chart tap); those characters are
 * introduced if they weren't in the learned pool yet.
 *
 * @param {{ learned?: string[], rote?: string[], roteKind?: string | null, activeDrill?: string | null }} store
 * @param {Script} script
 * @param {string} id  gojuon | dakuten | yoon | all | row
 * @param {string[] | null} [glyphs]
 * @returns {{ count: number, id: string | null, fresh: string[] }}
 */
export function beginDrill(store, script, id, glyphs = null) {
  const allowed = new Set(scriptGlyphs(script));
  const learned = new Set(store.learned || []);
  /** @type {string[]} */
  let chosen = [];
  /** @type {string | null} */
  let tag = id;
  if (Array.isArray(glyphs) && glyphs.length) {
    chosen = glyphs.filter((g) => typeof g === "string" && allowed.has(g));
    tag = "row";
  } else {
    const set = drillSets(store, script).find((s) => s.id === id);
    chosen = set ? [...set.glyphs] : [];
    tag = set?.id ?? null;
  }
  const fresh = chosen.filter((g) => !learned.has(g));
  for (const g of chosen) learned.add(g);
  store.learned = [...learned];
  store.rote = chosen;
  store.roteKind = chosen.length ? "cram" : null;
  store.activeDrill = chosen.length ? drillKey(script, tag, tag === "row" ? chosen : null) : null;
  return { count: chosen.length, id: tag, fresh };
}

/**
 * Pull un-mastered glyphs of this script out of the pool (mnemonics again).
 * Mastered cards stay. Mutates store. @returns {number} dropped
 */
export function resetLearning(store, script) {
  clearDrillProgress(store, script);
  const drop = scriptGlyphs(script).filter(
    (g) => (store.learned || []).includes(g) && !isMastered(store.cards?.[g]),
  );
  resetGlyphs(store, drop);
  const gone = new Set(drop);
  store.rote = (store.rote || []).filter((g) => !gone.has(g));
  if (!store.rote.length) store.roteKind = null;
  return drop.length;
}

/**
 * Wipe FSRS history for this script, keep introductions. Next study treats
 * them as unseen. Mutates store. @returns {number} cards cleared
 */
export function resetStudying(store, script) {
  clearDrillProgress(store, script);
  const set = new Set(scriptGlyphs(script));
  let n = 0;
  for (const g of set) {
    if (store.cards?.[g]) {
      delete store.cards[g];
      n++;
    }
  }
  store.rote = (store.rote || []).filter((g) => !set.has(g));
  if (!store.rote.length) store.roteKind = null;
  return n;
}

/**
 * Put every introduced card of this script due right now. History stays, so
 * a miss sends it back to learning. Mutates store. @returns {number}
 */
export function markDueNow(store, script, now = Date.now()) {
  const learned = new Set(store.learned || []);
  let n = 0;
  for (const g of scriptGlyphs(script)) {
    if (!learned.has(g) || !store.cards?.[g]) continue;
    store.cards[g] = { ...store.cards[g], due: now };
    n++;
  }
  return n;
}

/**
 * Counts for the HUD.
 * @param {{ learned?: string[], cards?: Record<string, CardState> }} store
 * @param {Script} script
 * @param {number} [now]
 */
export function summary(store, script, now = Date.now()) {
  const cards = store.cards || {};
  let mastered = 0;
  for (const e of ENTRIES) {
    const g = glyphOf(e, script);
    if (isMastered(cards[g])) mastered++;
  }
  return {
    total: SCRIPT_TOTAL,
    learned: learnedCount(store, script),
    mastered,
    learning: learningPool(store, script).size,
    due: practiceablePool(store, script, now).size,
  };
}

/**
 * Traditional chart: gojūon / dakuten / yōon rows with empty slots preserved
 * so columns stay a-i-u-e-o aligned. Status is per-glyph progress.
 *
 * @param {{ learned?: string[], rote?: string[], cards?: Record<string, CardState> }} store
 * @param {Script} script
 * @param {number} [now]
 * @returns {{ id: string, label: string, rows: { empty: boolean, glyph?: string, romaji?: string, status?: string }[][] }[]}
 */
export function progressChart(store, script, now = Date.now()) {
  const learned = new Set(store.learned || []);
  const cards = store.cards || {};
  return CHART_FAMILIES.map((fam) => ({
    id: fam.id,
    label: fam.label,
    rows: fam.rows.map((row) => row.map((entry) => {
      if (!entry) return { empty: true };
      const ch = glyphOf(entry, script);
      const card = cards[ch];
      let status = "new";
      if (isMastered(card)) status = "mastered";
      else if (learned.has(ch)) {
        if (!card || (card.seen ?? 0) === 0 || card.due <= now) status = "due";
        else status = "learning";
      }
      return { empty: false, glyph: ch, romaji: entry.romaji, status };
    })),
  }));
}

function dakutenStreak(streaks, id) {
  const v = streaks?.[id];
  return typeof v === "number" && v > 0 ? v : 0;
}

function dakutenCard(L, streaks) {
  const sticking = DAKUTEN_LESSONS.filter((x) => dakutenStreak(streaks, x.id) >= ROTE_STREAK).length;
  const need = DAKUTEN_LESSONS.length - sticking;
  return {
    id: L.id,
    kind: L.kind,
    mark: L.mark,
    prompt: L.prompt,
    promptRomaji: L.promptRomaji || "",
    promptIsKana: L.promptIsKana,
    reveal: L.reveal,
    exampleFrom: L.exampleFrom,
    exampleTo: L.exampleTo,
    caption: L.caption,
    streak: dakutenStreak(streaks, L.id),
    needHits: ROTE_STREAK,
    sticking,
    size: DAKUTEN_LESSONS.length,
    need,
    done: need === 0,
  };
}

/**
 * Rote pick: unfinished lessons first, weighted toward misses / low streaks.
 * Avoids an immediate repeat. `force` keeps going after everything sticks.
 *
 * @param {string | null} [lastId]
 * @param {Record<string, number>} [streaks]
 * @param {() => number} [rng]
 * @param {boolean} [force]
 */
export function nextDakuten(lastId = null, streaks = {}, rng = Math.random, force = false) {
  const unfinished = DAKUTEN_LESSONS.filter((L) => dakutenStreak(streaks, L.id) < ROTE_STREAK);
  if (!force && unfinished.length === 0) return dakutenCard(DAKUTEN_LESSONS[0], streaks);
  const source = unfinished.length && !force ? unfinished : DAKUTEN_LESSONS;
  let pool = source.filter((L) => source.length === 1 || L.id !== lastId);
  if (!pool.length) pool = source;
  let total = 0;
  const weighted = pool.map((L) => {
    const s = dakutenStreak(streaks, L.id);
    const w = Math.max(1, (ROTE_STREAK - Math.min(s, ROTE_STREAK - 1)) ** 2);
    total += w;
    return { L, w };
  });
  let r = rng() * total;
  let L = weighted[weighted.length - 1].L;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) { L = x.L; break; }
  }
  return dakutenCard(L, streaks);
}

/** @param {Record<string, number>} streaks @param {string} id @param {boolean} ok */
export function gradeDakuten(streaks, id, ok) {
  const next = { ...streaks };
  next[id] = ok ? dakutenStreak(streaks, id) + 1 : 0;
  return next;
}

/**
 * @param {string} id
 * @param {string} input
 */
export function checkDakuten(id, input) {
  const L = DAKUTEN_LESSONS.find((x) => x.id === id);
  if (!L) return false;
  const peeled = peelJunk(input);
  const forms = [input.trim(), peeled].filter(Boolean);
  for (const form of forms) {
    const v = form.toLowerCase().replace(/\s+/g, "");
    if (L.answers.some((a) => a === form || a === v || a === form.toLowerCase())) return true;
  }
  return false;
}
