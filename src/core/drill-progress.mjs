/** Daily practice is independent of the long-term FSRS review schedule. */
export function practiceDate(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function drillKey(script, id, glyphs = null) {
  return `${script}:${glyphs ? `row:${[...new Set(glyphs)].sort().join(",")}` : id}`;
}

/** Read without changing a store; stale sessions appear empty immediately. */
export function drillProgress(store, key, now = Date.now()) {
  const date = practiceDate(now);
  const saved = store.drillProgress?.[key];
  if (saved?.date === date) {
    const streaks = Object.fromEntries(Object.entries(saved.streaks || {})
      .filter(([, n]) => typeof n === "number" && Number.isFinite(n) && n >= 0)
      .map(([g, n]) => [g, Math.min(3, n)]));
    return { date, streaks, correct: Number(saved.correct) || 0, seen: Number(saved.seen) || 0 };
  }
  return { date, streaks: {}, correct: 0, seen: 0 };
}

/** Save every answer so quitting or changing sets cannot lose the sitting. */
export function gradeDrill(store, key, glyph, correct, now = Date.now()) {
  const progress = drillProgress(store, key, now);
  progress.streaks[glyph] = correct ? Math.min(3, (progress.streaks[glyph] || 0) + 1) : 0;
  progress.seen += 1;
  progress.correct += correct ? 1 : 0;
  store.drillProgress = { ...store.drillProgress, [key]: progress };
  return progress;
}

export function clearDrillProgress(store, script) {
  store.drillProgress = Object.fromEntries(Object.entries(store.drillProgress || {})
    .filter(([key]) => !key.startsWith(`${script}:`)));
  if (store.activeDrill?.startsWith(`${script}:`)) store.activeDrill = null;
}
