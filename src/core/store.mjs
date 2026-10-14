/**
 * Local progress store at ~/.kanthropic/progress.json.
 *
 * Shape:
 *   {
 *     version: 1,
 *     config: { script: Script, frontMs: number, backMs: number },
 *     cards: { [glyph]: CardState },   // keyed by the displayed glyph
 *     ambient: { script, glyph, shownAt } | null
 *   }
 *
 * CardState mirrors the fields the FSRS scheduler needs plus app stats, so it
 * is the local equivalent of the hypertools `kanaCards` row (no userId — this
 * is single-user, on-disk).
 *
 * @typedef {import("../data/kana.mjs").Script} Script
 * @typedef {{
 *   script: Script, romaji: string,
 *   due: number, stability: number, difficulty: number,
 *   elapsed_days: number, scheduled_days: number, learning_steps: number,
 *   reps: number, lapses: number, state: number, last_review?: number,
 *   seen: number, misses: number,
 *   goodDays?: number, lastGoodDay?: number, lastGoodAt?: number
 * }} CardState
 */
import { readFileSync, copyFileSync } from "node:fs";
import { PROGRESS_PATH } from "./paths.mjs";
import { writeAtomic, withLock } from "./fsutil.mjs";

// image defaults to "auto": real images where the terminal supports them (sixel
// inside a sixel-tmux, iTerm2 standalone), falling back to chafa braille
// symbol-art otherwise — so it looks its best by default and never garbles.
// continuous: when on, the drill never stops at "caught up" — once nothing is
// due it rolls straight into drilling what you're still learning, then the whole
// learned set, ignoring FSRS due timers, until you master it or go add new cards.
// checkinEvery: when grinding past the schedule (continuous / "practice anyway"),
// pause for a check-in once you've cleared the set — each card right this many
// times this run (or ~6 min) — so you can learn the next set, keep going, or
// stop. 0 disables. Higher = longer grind before it asks.
/** @type {{ script: Script, frontMs: number, backMs: number, image: "auto"|"on"|"off", autoAdvance: boolean, continuous: boolean, checkinEvery: number, popOnThink: boolean, glyphFont: string }} */
export const DEFAULT_CONFIG = { script: "hiragana", frontMs: 2600, backMs: 1700, image: "auto", autoAdvance: true, continuous: false, checkinEvery: 3, popOnThink: true, glyphFont: "HiraginoSans-W5" };

/** @returns {{ version: number, config: typeof DEFAULT_CONFIG, cards: Record<string, CardState>, ambient: any, learned: string[], learnedMigrated: boolean, rote: string[], roteKind: "row" | "cram" | null, dakutenStreaks: Record<string, number>, activeDrill: string | null, drillProgress: Record<string, any> }} */
export function emptyStore() {
  return { version: 1, config: { ...DEFAULT_CONFIG }, cards: {}, ambient: null, learned: [], learnedMigrated: false, rote: [], roteKind: null, dakutenStreaks: {}, activeDrill: null, drillProgress: {} };
}

/** Config with hostile/hand-edited values coerced back to sane ones — a bad
 *  `script` would crash entryByGlyph on every card otherwise. */
function sanitizeConfig(cfg) {
  const c = { ...DEFAULT_CONFIG, ...(cfg && typeof cfg === "object" ? cfg : {}) };
  if (c.script !== "hiragana" && c.script !== "katakana") c.script = DEFAULT_CONFIG.script;
  if (!["on", "off", "auto"].includes(c.image)) c.image = DEFAULT_CONFIG.image;
  for (const k of ["frontMs", "backMs", "checkinEvery"]) {
    if (typeof c[k] !== "number" || !Number.isFinite(c[k]) || c[k] < 0) c[k] = DEFAULT_CONFIG[k];
  }
  if (typeof c.popOnThink !== "boolean") c.popOnThink = DEFAULT_CONFIG.popOnThink;
  if (typeof c.glyphFont !== "string" || !c.glyphFont.trim()) c.glyphFont = DEFAULT_CONFIG.glyphFont;
  return c;
}

/** Load the store, tolerating a missing/corrupt file by returning a fresh one.
 *  A corrupt-but-present file is quarantined to progress.json.corrupt-<ts>
 *  first, so the next save can't silently erase the user's FSRS history.
 *  Never throws. @returns {ReturnType<typeof emptyStore>} */
export function load() {
  let raw = null;
  try { raw = readFileSync(PROGRESS_PATH, "utf8"); }
  catch { return emptyStore(); }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") throw new Error("not an object");
    return {
      version: 1,
      config: sanitizeConfig(data.config),
      cards: data.cards ?? {},
      ambient: data.ambient ?? null,
      learned: Array.isArray(data.learned) ? data.learned : [],
      learnedMigrated: !!data.learnedMigrated,
      rote: Array.isArray(data.rote) ? data.rote.filter((g) => typeof g === "string") : [],
      roteKind: data.roteKind === "cram" || data.roteKind === "row" ? data.roteKind : null,
      activeDrill: typeof data.activeDrill === "string" ? data.activeDrill : null,
      drillProgress: data.drillProgress && typeof data.drillProgress === "object" ? data.drillProgress : {},
      dakutenStreaks: data.dakutenStreaks && typeof data.dakutenStreaks === "object" ? data.dakutenStreaks : {},
    };
  } catch {
    if (raw.trim()) {
      try { copyFileSync(PROGRESS_PATH, `${PROGRESS_PATH}.corrupt-${Date.now()}`); } catch { /* best-effort */ }
    }
    return emptyStore();
  }
}

/** Atomically persist the store (temp file + rename so a crash can't truncate
 *  it). Never throws. @param {ReturnType<typeof emptyStore>} data */
export function save(data) {
  try { writeAtomic(PROGRESS_PATH, JSON.stringify(data, null, 2)); }
  catch { /* best-effort: progress loss beats breaking the caller */ }
}

/** Re-load, apply `mutate`, and save — under a lock so concurrent panes can't
 *  clobber each other's grades. This is how ALL writes that follow a blocking
 *  user prompt must go through: the caller's loaded snapshot may be minutes
 *  stale by the time the user answers, so only the delta gets applied here.
 *  @param {(store: ReturnType<typeof emptyStore>) => void} mutate
 *  @returns {ReturnType<typeof emptyStore>} the store as saved */
export function update(mutate) {
  return withLock(PROGRESS_PATH, () => {
    const store = load();
    mutate(store);
    save(store);
    return store;
  });
}
