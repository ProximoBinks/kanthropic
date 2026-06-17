import { describe, it, expect } from "vitest";
import { scriptMastered, resolveScript } from "../src/cli/drill.mjs";
import { ENTRIES, glyph as glyphOf } from "../src/data/kana.mjs";

/** Build a cards map where every glyph of `script` is at FSRS state `state`. */
function cardsAll(script, state) {
  const cards = {};
  for (const e of ENTRIES) cards[glyphOf(e, script)] = { state, seen: 1 };
  return cards;
}

describe("auto-advance hiragana → katakana", () => {
  it("scriptMastered is true only when every glyph is state ≥ 2", () => {
    expect(scriptMastered({}, "hiragana")).toBe(false);
    expect(scriptMastered(cardsAll("hiragana", 1), "hiragana")).toBe(false); // still learning
    expect(scriptMastered(cardsAll("hiragana", 2), "hiragana")).toBe(true);  // all graduated
  });

  it("advances to katakana once hiragana is mastered (and katakana isn't)", () => {
    const store = { config: { script: "hiragana", autoAdvance: true }, cards: cardsAll("hiragana", 2) };
    expect(resolveScript(store)).toBe("katakana");
  });

  it("stays on hiragana until it's mastered", () => {
    const store = { config: { script: "hiragana", autoAdvance: true }, cards: cardsAll("hiragana", 1) };
    expect(resolveScript(store)).toBe("hiragana");
  });

  it("an explicit script always wins", () => {
    const store = { config: { script: "hiragana", autoAdvance: true }, cards: cardsAll("hiragana", 2) };
    expect(resolveScript(store, "hiragana")).toBe("hiragana");
  });

  it("respects autoAdvance: false", () => {
    const store = { config: { script: "hiragana", autoAdvance: false }, cards: cardsAll("hiragana", 2) };
    expect(resolveScript(store)).toBe("hiragana");
  });

  it("doesn't advance when both scripts are mastered (stays put)", () => {
    const cards = { ...cardsAll("hiragana", 2), ...cardsAll("katakana", 2) };
    const store = { config: { script: "hiragana", autoAdvance: true }, cards };
    expect(resolveScript(store)).toBe("hiragana");
  });
});
