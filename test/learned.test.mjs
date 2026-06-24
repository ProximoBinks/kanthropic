import { describe, it, expect } from "vitest";
import { ensureLearned, learnedCount, practiceablePool, learnedSet, unmasteredPool, learningPool, isMastered, resetGlyphs } from "../src/core/learned.mjs";
import { pickNext } from "../src/core/ambient.mjs";
import { gradeCard } from "../src/core/scheduler.mjs";

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
    // learnedSet ignores due dates entirely (the "practice anyway" pool)
    expect([...learnedSet(store, "hiragana")].sort()).toEqual(["あ", "い", "う"]);
  });

  it("unmasteredPool = learned glyphs not yet at FSRS Review (the focus set)", () => {
    const store = { learned: ["あ", "い", "う", "え"], cards: {
      "あ": { seen: 9, state: 2 },           // mastered → excluded
      "い": { seen: 2, state: 1 },           // learning → focus
      "う": { seen: 1, state: 0 },           // new-ish → focus
      // え: learned, no card → never drilled → focus
      "か": { seen: 2, state: 1 },           // learning but NOT learned → excluded
    } };
    expect([...unmasteredPool(store, "hiragana")].sort()).toEqual(["い", "う", "え"]);
  });

  it("learningPool excludes graduated cards waiting on day 2 (no endless grind)", () => {
    const store = { learned: ["あ", "い", "う", "え"], cards: {
      "あ": { state: 2, goodDays: 2 },  // mastered
      "い": { state: 2, goodDays: 1 },  // graduated, just needs a 2nd day → NOT actively learning
      "う": { state: 1 },               // learning → active grind
      // え: no card (new) → active grind
    } };
    expect([...learningPool(store, "hiragana")].sort()).toEqual(["う", "え"]);
    // but the honest "not mastered yet" count still includes い
    expect([...unmasteredPool(store, "hiragana")].sort()).toEqual(["い", "う", "え"]);
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

  it("pickNext returns null when the only pool glyph is the avoided one", () => {
    // The hazard behind the drill freeze: a 1-card pool whose sole member is the
    // last glyph. The drill must NOT pass an avoid glyph when pool.size === 1,
    // or it would get null → spin forever. This documents why.
    expect(pickNext("hiragana", {}, "さ", NOW, Math.random, new Set(["さ"]))).toBeNull();
    expect(pickNext("hiragana", {}, null, NOW, Math.random, new Set(["さ"])).glyph).toBe("さ");
  });

  it("isMastered needs Review state AND recall on >= 2 separate days", () => {
    expect(isMastered(undefined)).toBe(false);
    expect(isMastered({ state: 1, goodDays: 9 })).toBe(false); // not graduated
    expect(isMastered({ state: 2, goodDays: 1 })).toBe(false); // crammed one day → not a fluke-pass
    expect(isMastered({ state: 2, goodDays: 2 })).toBe(true);  // two separate days
    expect(isMastered({ state: 2 })).toBe(true);               // legacy card (no field) = already proven
    expect(isMastered({ state: 3 })).toBe(true);               // legacy relearning card
  });

  it("gradeCard counts DISTINCT correct days (cramming one sitting stays at 1)", () => {
    const d1a = new Date("2026-06-01T10:00:00Z");
    const d1b = new Date("2026-06-01T20:00:00Z"); // same day, hours later
    const d2 = new Date("2026-06-02T10:00:00Z");  // next day
    let c = gradeCard("hiragana", "あ", undefined, true, d1a);
    expect(c.goodDays).toBe(1);
    c = gradeCard("hiragana", "あ", c, true, d1b);
    expect(c.goodDays).toBe(1);                    // same day → no credit
    c = gradeCard("hiragana", "あ", c, true, d2);
    expect(c.goodDays).toBe(2);                    // a real second day
    c = gradeCard("hiragana", "あ", c, false, d2);
    expect(c.goodDays).toBe(0);                    // a miss breaks the streak
  });

  it("resetGlyphs forgets cards + pool, counting either", () => {
    const store = {
      learned: ["あ", "い", "う"],
      cards: { "あ": { seen: 5, state: 2 }, "い": { seen: 0 }, "か": { seen: 3 } },
    };
    // あ (card+pool), い (pool only), う (pool only, no card) → 3 cleared
    const n = resetGlyphs(store, ["あ", "い", "う"]);
    expect(n).toBe(3);
    expect(store.cards["あ"]).toBeUndefined();
    expect(store.cards["か"]).toEqual({ seen: 3 }); // out of scope → untouched
    expect(store.learned).toEqual([]);
  });
});
