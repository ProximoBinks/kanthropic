import { describe, it, expect } from "vitest";
import { drillKey, drillProgress, gradeDrill, practiceDate } from "../src/core/drill-progress.mjs";
import { beginDrill, nextRote, resetLearning } from "../src/core/flow.mjs";
import { invoke } from "../src/core/engine.mjs";

const morning = new Date(2026, 9, 9, 9).getTime();
const evening = new Date(2026, 9, 9, 23, 59).getTime();
const tomorrow = new Date(2026, 9, 10, 0).getTime();

describe("dated drill progress", () => {
  it("resumes partial streaks and scores after a restart and switching sets", () => {
    let store = { learned: ["あ", "い", "が"], cards: {} };
    beginDrill(store, "hiragana", "gojuon");
    const key = store.activeDrill;
    gradeDrill(store, key, "あ", true, morning);
    gradeDrill(store, key, "あ", true, morning);
    store = JSON.parse(JSON.stringify(store));
    beginDrill(store, "hiragana", "dakuten");
    gradeDrill(store, store.activeDrill, "が", true, morning);
    beginDrill(store, "hiragana", "gojuon");
    expect(drillProgress(store, store.activeDrill, evening)).toMatchObject({
      streaks: { "あ": 2 }, correct: 2, seen: 2,
    });
    expect(store.cards).toEqual({});
  });

  it("resets at local midnight without touching learned glyphs or review history", () => {
    const store = { learned: ["あ"], cards: { "あ": { due: tomorrow + 999 } } };
    const key = drillKey("hiragana", "gojuon");
    gradeDrill(store, key, "あ", true, evening);
    expect(practiceDate(evening)).toBe("2026-10-09");
    expect(drillProgress(store, key, tomorrow)).toMatchObject({ streaks: {}, seen: 0 });
    expect(gradeDrill(store, key, "あ", true, tomorrow).streaks).toEqual({ "あ": 1 });
    expect(store.learned).toEqual(["あ"]);
    expect(store.cards["あ"].due).toBe(tomorrow + 999);
  });

  it("a miss resets only that character and completed characters leave the pool", () => {
    const store = { learned: ["あ", "い"], rote: ["あ", "い"] };
    const key = drillKey("hiragana", "gojuon");
    for (let i = 0; i < 3; i++) gradeDrill(store, key, "あ", true, morning);
    gradeDrill(store, key, "い", true, morning);
    const progress = gradeDrill(store, key, "い", false, morning);
    expect(progress.streaks).toEqual({ "あ": 3, "い": 0 });
    expect(nextRote(store, "hiragana", "い", () => 0, progress.streaks).glyph).toBe("い");
    expect(nextRote(store, "hiragana", null, () => 0, { "あ": 3, "い": 3 }).glyph).toBeNull();
  });

  it("isolates scripts, sets and explicit chart rows", () => {
    expect(drillKey("hiragana", "gojuon")).not.toBe(drillKey("katakana", "gojuon"));
    expect(drillKey("hiragana", "all")).not.toBe(drillKey("hiragana", "gojuon"));
    expect(drillKey("hiragana", "row", ["あ", "い"])).toBe(drillKey("hiragana", "row", ["い", "あ"]));
    expect(drillKey("hiragana", "row", ["あ"])).not.toBe(drillKey("hiragana", "row", ["い"]));
  });

  it("exposes current daily completion in the picker and rejects stale grades", () => {
    const store = { learned: ["あ", "が"] };
    beginDrill(store, "hiragana", "gojuon");
    const key = store.activeDrill;
    for (let i = 0; i < 3; i++) invoke("gradeDrill", { store, key, glyph: "あ", correct: true, now: morning });
    expect(invoke("drillSets", { store, script: "hiragana", now: evening })[0].done).toBe(1);
    expect(invoke("drillSets", { store, script: "hiragana", now: tomorrow })[0].done).toBe(0);
    beginDrill(store, "hiragana", "dakuten");
    invoke("gradeDrill", { store, key, glyph: "あ", correct: false, now: evening });
    expect(drillProgress(store, key, evening).streaks["あ"]).toBe(3);
  });

  it("clears saved sessions on a learning reset only for that script", () => {
    const store = { learned: ["あ", "ア"], cards: {} };
    gradeDrill(store, "hiragana:gojuon", "あ", true, morning);
    gradeDrill(store, "katakana:gojuon", "ア", true, morning);
    resetLearning(store, "hiragana");
    expect(drillProgress(store, "hiragana:gojuon", morning).seen).toBe(0);
    expect(drillProgress(store, "katakana:gojuon", morning).seen).toBe(1);
  });
});
