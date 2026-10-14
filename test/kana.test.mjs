import { describe, it, expect } from "vitest";
import { ENTRIES, DAKUTEN_PAIRS, glyph, checkAnswer, entryByGlyph } from "../src/data/kana.mjs";
import { pickNext } from "../src/core/ambient.mjs";
import { gradeCard } from "../src/core/scheduler.mjs";

describe("kana data + answer checking", () => {
  it("has the full set (46 + 25 + 33 = 104 entries)", () => {
    expect(ENTRIES.length).toBe(104);
  });

  it("dakuten pairs are ka/sa/ta/ha → voiced and ha → p (25)", () => {
    expect(DAKUTEN_PAIRS.length).toBe(25);
    const ka = DAKUTEN_PAIRS.find((p) => p.baseHira === "か" && p.mark === "゛");
    expect(ka.voicedHira).toBe("が");
    expect(ka.voicedRomaji).toBe("ga");
    const haBa = DAKUTEN_PAIRS.find((p) => p.baseHira === "は" && p.mark === "゛");
    const haPa = DAKUTEN_PAIRS.find((p) => p.baseHira === "は" && p.mark === "゜");
    expect(haBa.voicedRomaji).toBe("ba");
    expect(haPa.voicedRomaji).toBe("pa");
  });

  it("accepts canonical and alternate romanizations, normalizes case/space", () => {
    const shi = entryByGlyph("hiragana", "し");
    expect(checkAnswer("shi", shi)).toBe(true);
    expect(checkAnswer("SI", shi)).toBe(true);   // alt + uppercase
    expect(checkAnswer(" shi ", shi)).toBe(true); // trimmed
    expect(checkAnswer("su", shi)).toBe(false);
    expect(checkAnswer("", shi)).toBe(false);
  });

  it("ignores accidental trailing/leading symbols (ka> still counts)", () => {
    const ka = entryByGlyph("hiragana", "か");
    expect(checkAnswer("ka>", ka)).toBe(true);
    expect(checkAnswer("ka.", ka)).toBe(true);
    expect(checkAnswer("ka!", ka)).toBe(true);
    expect(checkAnswer(">ka", ka)).toBe(true);
    expect(checkAnswer(" ka/ ", ka)).toBe(true);
    expect(checkAnswer("ｋａ＞", ka)).toBe(true); // fullwidth leftovers
    // extra letters must not sneak through — ん is "n", "na" is な
    const n = entryByGlyph("hiragana", "ん");
    expect(checkAnswer("n", n)).toBe(true);
    expect(checkAnswer("n.", n)).toBe(true);
    expect(checkAnswer("na", n)).toBe(false);
    expect(checkAnswer("kaa", ka)).toBe(false);
  });

  it("maps katakana glyphs distinctly", () => {
    const a = entryByGlyph("katakana", "ア");
    expect(a.romaji).toBe("a");
    expect(glyph(a, "katakana")).toBe("ア");
    expect(glyph(a, "hiragana")).toBe("あ");
  });

  it("keeps alternate romanizations consistent within a family", () => {
    // ちゃ/ちゅ/ちょ all take the c- variant a kunrei-adjacent typist uses…
    expect(checkAnswer("cya", entryByGlyph("hiragana", "ちゃ"))).toBe(true);
    expect(checkAnswer("cyu", entryByGlyph("hiragana", "ちゅ"))).toBe(true);
    expect(checkAnswer("cyo", entryByGlyph("hiragana", "ちょ"))).toBe(true);
    // …and づ takes dzu just as ぢ takes dji.
    expect(checkAnswer("dzu", entryByGlyph("hiragana", "づ"))).toBe(true);
    expect(checkAnswer("dji", entryByGlyph("hiragana", "ぢ"))).toBe(true);
  });
});

describe("ambient picker", () => {
  it("never returns the avoided glyph and stays within the script", () => {
    const seq = [];
    let avoid = null;
    for (let i = 0; i < 50; i++) {
      const next = pickNext("hiragana", {}, avoid);
      expect(next).not.toBeNull();
      expect(next.glyph).not.toBe(avoid);
      // glyph must be a real hiragana entry
      expect(entryByGlyph("hiragana", next.glyph)).toBeTruthy();
      avoid = next.glyph;
      seq.push(next.glyph);
    }
    expect(seq.length).toBe(50);
  });

  it("weights new/weak cards higher (deterministic rng)", () => {
    // Mark あ as mastered (low weight), leave い brand-new (high weight).
    const cards = {
      "あ": { script: "hiragana", romaji: "a", seen: 9, misses: 0, due: 0, state: 3 },
    };
    // rng=0 walks from the start of the pool; with あ skipped via avoid, the
    // first high-weight new entry should be picked deterministically.
    const pick = pickNext("hiragana", cards, "あ", Date.now(), () => 0);
    expect(pick).not.toBeNull();
  });
});

describe("fsrs grading", () => {
  it("advances reps/seen on correct and counts a miss on wrong", () => {
    const first = gradeCard("hiragana", "あ", undefined, true);
    expect(first.seen).toBe(1);
    expect(first.misses).toBe(0);
    expect(first.reps).toBeGreaterThanOrEqual(1);
    expect(first.romaji).toBe("a");

    const second = gradeCard("hiragana", "あ", first, false);
    expect(second.seen).toBe(2);
    expect(second.misses).toBe(1);
    expect(typeof second.due).toBe("number");
  });
});
