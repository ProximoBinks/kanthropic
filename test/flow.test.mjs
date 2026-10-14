import { describe, it, expect } from "vitest";
import { beginDrill, checkDakuten, drillSets, gradeDakuten, markDueNow, nextDakuten, nextRevise, nextRote, nextUnlearnedRow, progressChart, resetLearning, resetStudying, resolveScript, revisePool, rowsFor, scriptMastered, summary } from "../src/core/flow.mjs";
import { invoke } from "../src/core/engine.mjs";
import { DAKUTEN_LESSONS, ENTRIES, glyph as glyphOf, checkAnswer, entryByGlyph } from "../src/data/kana.mjs";

const NOW = 1_700_000_000_000;

function cardsAll(script, state, extra = {}) {
  const cards = {};
  for (const e of ENTRIES) cards[glyphOf(e, script)] = { state, seen: 1, due: NOW + 1e12, ...extra };
  return cards;
}

describe("learn / revise flow", () => {
  it("rowsFor has every non-null entry exactly once", () => {
    const rows = rowsFor("hiragana");
    const glyphs = rows.flatMap((r) => r.entries.map((e) => e.hira));
    expect(glyphs.length).toBe(ENTRIES.length);
    expect(new Set(glyphs).size).toBe(ENTRIES.length);
  });

  it("nextUnlearnedRow is the first row, then the next after that row is learned", () => {
    const first = nextUnlearnedRow({ learned: [] }, "hiragana");
    expect(first.map((e) => e.hira)).toEqual(["あ", "い", "う", "え", "お"]);
    const after = nextUnlearnedRow({ learned: first.map((e) => e.hira) }, "hiragana");
    expect(after.map((e) => e.hira)).toEqual(["か", "き", "く", "け", "こ"]);
  });

  it("nextUnlearnedRow is null once every glyph of the script is in the pool", () => {
    const learned = ENTRIES.map((e) => e.hira);
    expect(nextUnlearnedRow({ learned }, "hiragana")).toBeNull();
  });

  it("revisePool is empty when nothing is learned", () => {
    expect(revisePool({ learned: [], cards: {} }, "hiragana", NOW).reason).toBe("empty");
  });

  it("revisePool prefers due cards", () => {
    const store = {
      learned: ["あ", "い"],
      cards: {
        "あ": { seen: 1, due: NOW - 1, state: 1 },
        "い": { seen: 1, due: NOW + 1e12, state: 1 },
      },
    };
    const { pool, reason } = revisePool(store, "hiragana", NOW);
    expect(reason).toBe("due");
    expect([...pool]).toEqual(["あ"]);
  });

  it("revisePool is caught-up when nothing is due (does not keep grinding)", () => {
    const store = {
      learned: ["あ", "い"],
      cards: {
        "あ": { seen: 1, due: NOW + 1e12, state: 1 },
        "い": { seen: 1, due: NOW + 1e12, state: 1 },
      },
    };
    const { pool, reason } = revisePool(store, "hiragana", NOW);
    expect(reason).toBe("caught-up");
    expect(pool.size).toBe(0);
  });

  it("nextRevise returns no glyph when caught up", () => {
    const store = { learned: ["さ"], cards: { "さ": { seen: 1, due: NOW + 1e12, state: 1 } } };
    const card = nextRevise(store, "hiragana", "さ", NOW, () => 0);
    expect(card.glyph).toBeNull();
    expect(card.reason).toBe("caught-up");
  });

  it("nextRote deals from the rote set", () => {
    const store = { learned: ["あ", "い"], rote: ["い"], cards: {} };
    const card = nextRote(store, "hiragana", null, () => 0);
    expect(card.glyph).toBe("い");
    expect(card.reason).toBe("rote");
  });

  it("resetLearning drops un-mastered glyphs and keeps mastered", () => {
    const store = {
      learned: ["あ", "い"],
      rote: ["い"],
      cards: {
        "あ": { state: 2, goodDays: 2, seen: 4 },
        "い": { state: 1, seen: 1 },
      },
    };
    expect(resetLearning(store, "hiragana")).toBe(1);
    expect(store.learned).toEqual(["あ"]);
    expect(store.cards["い"]).toBeUndefined();
    expect(store.cards["あ"]).toBeTruthy();
    expect(store.rote).toEqual([]);
  });

  it("resetStudying wipes FSRS but keeps introductions", () => {
    const store = {
      learned: ["あ"],
      cards: { "あ": { state: 2, goodDays: 2, seen: 9, due: NOW + 1e12 } },
    };
    expect(resetStudying(store, "hiragana")).toBe(1);
    expect(store.learned).toEqual(["あ"]);
    expect(store.cards["あ"]).toBeUndefined();
  });

  it("markDueNow sets due on introduced cards", () => {
    const store = {
      learned: ["あ"],
      cards: { "あ": { state: 2, due: NOW + 1e12, seen: 4 } },
    };
    expect(markDueNow(store, "hiragana", NOW)).toBe(1);
    expect(store.cards["あ"].due).toBe(NOW);
  });

  it("scriptMastered / resolveScript still auto-advance hiragana → katakana", () => {
    expect(scriptMastered({}, "hiragana")).toBe(false);
    expect(scriptMastered(cardsAll("hiragana", 2), "hiragana")).toBe(true);
    const store = { config: { script: "hiragana", autoAdvance: true }, cards: cardsAll("hiragana", 2) };
    expect(resolveScript(store)).toBe("katakana");
    expect(resolveScript(store, "hiragana")).toBe("hiragana");
  });

  it("summary counts learned / mastered / due", () => {
    const store = {
      learned: ["あ", "い"],
      cards: {
        "あ": { seen: 4, due: NOW - 1, state: 2, goodDays: 2 },
        "い": { seen: 1, due: NOW - 1, state: 1 },
      },
    };
    const s = summary(store, "hiragana", NOW);
    expect(s.learned).toBe(2);
    expect(s.mastered).toBe(1);
    expect(s.learning).toBe(1);
    expect(s.due).toBe(2);
    expect(s.total).toBe(104);
  });
});

describe("engine invoke (what the macOS app calls)", () => {
  it("prepare migrates seen cards into learned", () => {
    const r = invoke("prepare", { store: { learned: [], learnedMigrated: false, cards: { "あ": { seen: 2 } } } });
    expect(r.changed).toBe(true);
    expect(r.store.learned).toEqual(["あ"]);
  });

  it("nextLearnRow / learnView / check / grade round-trip", () => {
    const row = invoke("nextLearnRow", { store: { learned: [] }, script: "hiragana" });
    expect(row.glyphs[0]).toBe("あ");
    const view = invoke("learnView", { script: "hiragana", glyph: "あ" });
    expect(view.romaji).toBe("a");
    expect(view.partner).toBe("ア");
    expect(view.mnemonic.length).toBeGreaterThan(4);
    expect(invoke("check", { script: "hiragana", glyph: "あ", input: "a" })).toBe(true);
    expect(invoke("check", { script: "hiragana", glyph: "あ", input: "あ" })).toBe(true);
    expect(invoke("check", { script: "hiragana", glyph: "あ", input: "ka" })).toBe(false);
    const card = invoke("grade", { script: "hiragana", glyph: "あ", store: { cards: {} }, correct: true, now: NOW });
    expect(card.romaji).toBe("a");
    expect(card.seen).toBe(1);
  });

  it("nextRevise returns a JSON-safe card", () => {
    const store = { learned: ["あ"], cards: { "あ": { seen: 1, due: 0, state: 1, romaji: "a" } } };
    const card = invoke("nextRevise", { store, script: "hiragana", lastGlyph: null, now: NOW });
    expect(card.glyph).toBe("あ");
    expect(typeof card.poolSize).toBe("number");
  });
});

describe("progress chart + dakuten", () => {
  it("chart groups voiced rows under their base family", () => {
    const chart = progressChart({ learned: ["あ"], cards: { "あ": { seen: 1, due: NOW - 1, state: 1 } } }, "hiragana", NOW);
    expect(chart[0].id).toBe("a");
    expect(chart[0].rows[0]).toHaveLength(5);
    expect(chart[0].rows[0][0]).toMatchObject({ glyph: "あ", status: "due" });
    const ka = chart.find((s) => s.id === "ka");
    expect(ka.label).toBe("ka / ga");
    expect(ka.rows).toHaveLength(2);
    expect(ka.rows[0].map((c) => c.glyph)).toEqual(["か", "き", "く", "け", "こ"]);
    expect(ka.rows[1].map((c) => c.glyph)).toEqual(["が", "ぎ", "ぐ", "げ", "ご"]);
    const ha = chart.find((s) => s.id === "ha");
    expect(ha.rows).toHaveLength(3); // ha, ba, pa
    const ya = chart.find((s) => s.id === "ya");
    expect(ya.rows[0][1].empty).toBe(true);
    expect(ya.rows[0][2].glyph).toBe("ゆ");
  });

  it("chart marks mastered vs new", () => {
    const chart = progressChart({
      learned: ["か"],
      cards: { "か": { state: 2, goodDays: 2, seen: 4, due: NOW + 1e12 } },
    }, "hiragana", NOW);
    const ka = chart.find((s) => s.id === "ka").rows[0][0];
    expect(ka.status).toBe("mastered");
    expect(chart.find((s) => s.id === "a").rows[0][1].status).toBe("new"); // い
  });

  it("dakuten is T→D (and friends), then exceptions chi→ji", () => {
    expect(checkDakuten("t-d", "d")).toBe(true);
    expect(checkDakuten("t-d", "da")).toBe(true);
    expect(checkDakuten("t-d", "d>")).toBe(true);
    expect(checkDakuten("t-d", "t")).toBe(false);
    expect(checkDakuten("k-g", "g")).toBe(true);
    expect(checkDakuten("h-p", "p")).toBe(true);
    expect(checkDakuten("s-z", "z")).toBe(true);
    expect(checkDakuten("chi-ji", "ji")).toBe(true);
    expect(checkDakuten("chi-ji", "di")).toBe(false);
    expect(checkDakuten("shi-ji", "ji")).toBe(true);
    expect(checkDakuten("tsu-zu", "zu")).toBe(true);
    const first = nextDakuten(null, {}, () => 0);
    expect(first.prompt).toBeTruthy();
    expect(first.size).toBeGreaterThan(5);
    const skipT = nextDakuten("t-d", { "t-d": 3 }, () => 0);
    expect(skipT.id).not.toBe("t-d");
    expect(skipT.sticking).toBe(1);
    const all = Object.fromEntries(DAKUTEN_LESSONS.map((l) => [l.id, 3]));
    const done = nextDakuten(null, all, () => 0);
    expect(done.done).toBe(true);
  });

  it("dakuten rote is 3-in-a-row, miss resets, leftover lesson is forced", () => {
    let s = {};
    s = gradeDakuten(s, "t-d", true);
    s = gradeDakuten(s, "t-d", true);
    expect(s["t-d"]).toBe(2);
    s = gradeDakuten(s, "t-d", false);
    expect(s["t-d"]).toBe(0);
    s = gradeDakuten(s, "t-d", true);
    s = gradeDakuten(s, "t-d", true);
    s = gradeDakuten(s, "t-d", true);
    expect(s["t-d"]).toBe(3);

    const streaks = Object.fromEntries(DAKUTEN_LESSONS.map((l) => [l.id, 3]));
    streaks["fu-bu"] = 1;
    const only = nextDakuten("t-d", streaks, () => 0.99);
    expect(only.id).toBe("fu-bu");
    expect(only.sticking).toBe(DAKUTEN_LESSONS.length - 1);
    expect(only.done).toBe(false);
    expect(only.streak).toBe(1);

    const viaEngine = invoke("gradeDakuten", { streaks: {}, id: "k-g", correct: true });
    expect(viaEngine["k-g"]).toBe(1);
    const next = invoke("nextDakuten", { lastId: "k-g", streaks: { "k-g": 3 } });
    expect(next.id).not.toBe("k-g");
    const complete = invoke("completeDakuten");
    expect(DAKUTEN_LESSONS.every((l) => complete[l.id] === 3)).toBe(true);
  });

  it("drillSets is learned glyphs, split regular / dakuten / yōon", () => {
    expect(drillSets({ learned: [] }, "hiragana")).toEqual([]);
    const onlyA = drillSets({ learned: ["あ"] }, "hiragana");
    expect(onlyA.map((s) => s.id)).toEqual(["gojuon"]);
    expect(onlyA[0].glyphs).toEqual(["あ"]);
    const mixed = drillSets({ learned: ["あ", "か", "が", "きゃ", "ア"] }, "hiragana");
    expect(mixed.map((s) => s.id)).toEqual(["gojuon", "dakuten", "yoon", "all"]);
    expect(mixed.find((s) => s.id === "gojuon").count).toBe(2);
    expect(mixed.find((s) => s.id === "dakuten").glyphs).toEqual(["が"]);
    expect(mixed.find((s) => s.id === "all").count).toBe(4);

    const store = { learned: ["あ", "が"], rote: [] };
    const r = beginDrill(store, "hiragana", "dakuten");
    expect(r.count).toBe(1);
    expect(r.id).toBe("dakuten");
    expect(r.fresh).toEqual([]);
    expect(store.rote).toEqual(["が"]);
    expect(store.roteKind).toBe("cram");

    const via = invoke("drillSets", { store: { learned: ["あ", "が"] }, script: "hiragana" });
    expect(via.some((s) => s.id === "all" && s.count === 2)).toBe(true);
    const started = invoke("beginDrill", { store: { learned: ["あ", "が"] }, script: "hiragana", id: "gojuon" });
    expect(started.count).toBe(1);
    expect(started.store.rote).toEqual(["あ"]);

    const rowStore = { learned: ["か"], rote: [] };
    const row = beginDrill(rowStore, "hiragana", "row", ["か", "き", "く", "け", "こ"]);
    expect(row.count).toBe(5);
    expect(row.fresh).toEqual(["き", "く", "け", "こ"]);
    expect(row.id).toBe("row");
    expect(rowStore.rote).toEqual(["か", "き", "く", "け", "こ"]);
    expect(rowStore.learned).toEqual(["か", "き", "く", "け", "こ"]);
  });
});

describe("checkAnswer accepts the glyph itself", () => {
  it("hiragana or katakana input matches the pair", () => {
    const shi = entryByGlyph("hiragana", "し");
    expect(checkAnswer("し", shi)).toBe(true);
    expect(checkAnswer("シ", shi)).toBe(true);
  });
});
