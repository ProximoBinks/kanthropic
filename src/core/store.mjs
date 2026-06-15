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
 *   seen: number, misses: number
 * }} CardState
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { KANTHROPIC_DIR, PROGRESS_PATH } from "./paths.mjs";

export const DEFAULT_CONFIG = { script: "hiragana", frontMs: 2600, backMs: 1700 };

/** @returns {{ version: number, config: typeof DEFAULT_CONFIG, cards: Record<string, CardState>, ambient: any }} */
export function emptyStore() {
  return { version: 1, config: { ...DEFAULT_CONFIG }, cards: {}, ambient: null };
}

/** Load the store, tolerating a missing/corrupt file by returning a fresh one.
 *  Never throws. @returns {ReturnType<typeof emptyStore>} */
export function load() {
  try {
    const raw = readFileSync(PROGRESS_PATH, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return emptyStore();
    return {
      version: 1,
      config: { ...DEFAULT_CONFIG, ...(data.config ?? {}) },
      cards: data.cards ?? {},
      ambient: data.ambient ?? null,
    };
  } catch {
    return emptyStore();
  }
}

/** Atomically persist the store (temp file + rename so a crash can't truncate
 *  it). Never throws. @param {ReturnType<typeof emptyStore>} data */
export function save(data) {
  try {
    mkdirSync(KANTHROPIC_DIR, { recursive: true });
    const tmp = PROGRESS_PATH + ".tmp-" + process.pid + "-" + Date.now();
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    try { renameSync(tmp, PROGRESS_PATH); }
    catch { try { unlinkSync(tmp); } catch { /* ignore */ } writeFileSync(PROGRESS_PATH, JSON.stringify(data, null, 2), "utf8"); }
  } catch { /* best-effort: progress loss beats breaking the caller */ }
}
