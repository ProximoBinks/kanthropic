import { describe, it, expect } from "vitest";
import { ensureLearned, learnedCount, practiceablePool } from "../src/core/learned.mjs";
import { pickNext } from "../src/core/ambient.mjs";

const NOW = 1_000_000_000_000;

describe("learned pool (acquisition → reinforcement gate)", () => {
  it("migrates existing practiced cards into `learned`, once", () => {
    const store = { learned: [], learnedMigrated: false, cards: {
      "あ": { seen: 3, due: NOW }, "い": { seen: 0, due: NOW }, // い never actually practiced
    } };
    expect(ensureLearned(store)).toBe(true);
    expect(store.learned).toEqual(["あ"]);     // only seen>0 migrates
    expect(store.learnedMigrated).toBe(true);
    // second call is a no-op (so un-learning later can't be undone)
    store.learned = [];
    expect(ensureLearned(store)).toBe(false);
    expect(store.learned).toEqual([]);
  });

  it("practiceablePool = learned glyphs that are new or due", () => {
    const store = { learned: ["あ", "い", "う"], cards: {
      "あ": { seen: 2, due: NOW - 1 },          // due → practiceable
      "い": { seen: 2, due: NOW + 1e9 },         // learned but not due → not
      // う: learned, no card → new → practiceable
      "か": { seen: 2, due: NOW - 1 },           // due but NOT learned → excluded
    } };
    const pool = practiceablePool(store, "hiragana", NOW);
    expect([...pool].sort()).toEqual(["あ", "う"]);
    expect(learnedCount(store, "hiragana")).toBe(3);
  });

  it("pickNext with a pool only returns glyphs from that pool", () => {
    const only = new Set(["さ", "し"]);
    for (let i = 0; i < 30; i++) {
      const p = pickNext("hiragana", {}, null, NOW, Math.random, only);
      expect(only.has(p.glyph)).toBe(true);
    }
  });

  it("pickNext returns null when the pool is empty", () => {
    expect(pickNext("hiragana", {}, null, NOW, Math.random, new Set())).toBeNull();
  });
});
