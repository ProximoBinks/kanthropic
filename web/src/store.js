/**
 * The browser's progress store: the same JSON shape as ~/.kanthropic/progress.json,
 * kept in localStorage. Every write pokes the sync loop (see cloud.js).
 */

const KEY = "kanthropic:progress";
const listeners = new Set();

/** Same shape as emptyStore() in src/core/store.mjs (which needs node:fs). */
function emptyStore() {
  return {
    version: 1, config: { script: "hiragana", autoAdvance: true }, cards: {}, ambient: null,
    learned: [], learnedMigrated: true, rote: [], roteKind: null, dakutenStreaks: {},
    activeDrill: null, drillProgress: {},
  };
}

export function load() {
  const fresh = emptyStore();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return fresh;
    return { ...fresh, ...data, config: { ...fresh.config, ...(data.config || {}) } };
  } catch {
    return fresh;
  }
}

/** @param {Record<string, any>} store */
export function save(store) {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage full / private mode */ }
  for (const fn of listeners) fn();
}

/** Load, mutate, save. Same contract as the CLI's update(). */
export function update(mutate) {
  const store = load();
  mutate(store);
  save(store);
  return store;
}

/** Called after every local write. */
export function onWrite(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Write without notifying the sync loop (used when applying a sync result). */
export function saveQuiet(store) {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* ignore */ }
}
