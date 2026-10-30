import { describe, it, expect } from "vitest";
import { emptyStore } from "../src/core/store.mjs";
import {
  NEW_PER_DAY, PHRASES, TOPICS, cardKey, checkPhrase, gradePhrase, listenQuiz, nextPhrase, phraseById, phraseCard,
  phraseMode, phraseQuiz, phraseTopics,
} from "../src/core/phrases.mjs";
import { summary } from "../src/core/flow.mjs";

const NOW = Date.UTC(2026, 9, 20, 3);
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

function answer(store, id, correct, now = NOW) {
  store.cards[cardKey(id)] = gradePhrase(store, id, correct, now);
}

describe("phrase deck", () => {
  it("ships a usable deck", () => {
    expect(PHRASES.length).toBeGreaterThan(300);
    expect(TOPICS.reduce((n, t) => n + t.count, 0)).toBe(PHRASES.length);
    for (const p of PHRASES) {
      expect(p.tiles.length).toBeGreaterThan(0);
      expect(p.tiles.join("")).toBe(p.kana);
      expect(p.en && p.ja && p.romaji).toBeTruthy();
    }
  });

  it("keeps the readings people actually say", () => {
    const byJa = (ja) => PHRASES.find((p) => p.ja === ja);
    expect(byJa("ゆっくり話してください。").tiles).toEqual(["ゆっくり", "はなして", "ください"]);
    expect(byJa("鶏肉").kana).toBe("とりにく");
  });

  it("never shows two cards the same prompt", () => {
    // Same English and note means the quiz can't tell you which answer it wants.
    const seen = new Map();
    for (const p of PHRASES) {
      const key = `${p.en.toLowerCase().replace(/[.!?]/g, "").trim()}|${p.note ?? ""}`;
      expect(seen.get(key), `${p.id} repeats ${seen.get(key)}`).toBeUndefined();
      seen.set(key, p.id);
    }
  });

  it("groups topics with the family visit first", () => {
    expect(TOPICS[0].group).toBe("visiting family");
    for (const t of TOPICS) expect(t.group).toBeTruthy();
    // Each group's topics sit together, so the picker shows one header per group.
    const order = TOPICS.map((t) => t.group).filter((g, i, a) => g !== a[i - 1]);
    expect(new Set(order).size).toBe(order.length);
  });

  it("records every phrase", async () => {
    const { default: AUDIO } = await import("../src/data/phrase-audio.mjs");
    for (const p of PHRASES) expect(Object.keys(AUDIO.files[p.id] ?? {}), p.id).toEqual(AUDIO.voices);
  });

  it("asks for what the Japanese actually says", () => {
    const byId = (id) => phraseById(id);
    expect(byId("basics-3")).toMatchObject({ en: "Yes, I'm fine.", ja: "はい、元気です。" });
    expect(byId("problems-58").tiles).toEqual(["みちに", "まよっています"]);
    expect(byId("signs-4").kana).toBe("でぐち");
  });
});

describe("phrase flow", () => {
  it("introduces a topic in book order, then caps new phrases per day", () => {
    const store = emptyStore();
    const topic = TOPICS.find((t) => t.count > NEW_PER_DAY).id;
    const inTopic = PHRASES.filter((p) => p.topic === topic);
    for (let i = 0; i < NEW_PER_DAY; i++) {
      const n = nextPhrase(store, { topic, now: NOW });
      expect(n).toMatchObject({ id: inTopic[i].id, kind: "new" });
      answer(store, n.id, true);
    }
    // Learning steps bring them back within minutes; before that, the cap holds.
    expect(nextPhrase(store, { topic, now: NOW }).reason).toBe("limit");
    expect(nextPhrase(store, { topic, now: NOW, extraNew: 1 }).id).toBe(inTopic[NEW_PER_DAY].id);
  });

  it("puts due reviews before anything new, across topics when no topic is chosen", () => {
    const store = emptyStore();
    const a = PHRASES[0].id;
    answer(store, a, false, NOW - 3_600_000); // a miss an hour ago → due now
    expect(nextPhrase(store, { now: NOW })).toMatchObject({ id: a, kind: "review" });
    expect(nextPhrase(emptyStore(), { now: NOW }).reason).toBe("caught-up");
  });

  it("builds a tile bank with the answer plus decoys", () => {
    const multi = PHRASES.find((p) => p.tiles.length >= 3);
    const q = phraseQuiz(multi.id, seq(0.3, 0.7, 0.1));
    expect(q.tiles.length).toBe(multi.tiles.length + 2);
    expect(q.tiles.map((t) => t.text)).toEqual(expect.arrayContaining(multi.tiles));
    const single = PHRASES.find((p) => p.tiles.length === 1);
    expect(phraseQuiz(single.id).tiles.length).toBe(4);
  });

  it("checks by spelling, so identical tiles are interchangeable", () => {
    const p = PHRASES.find((x) => x.tiles.length >= 2);
    expect(checkPhrase(p.id, p.tiles)).toBe(true);
    expect(checkPhrase(p.id, [...p.tiles].reverse())).toBe(false);
  });

  it("schedules phrases without touching kana progress", () => {
    const store = emptyStore();
    answer(store, PHRASES[0].id, true);
    const card = store.cards[cardKey(PHRASES[0].id)];
    expect(card.introducedAt).toBe(NOW);
    expect(card.romaji).toBe(phraseById(PHRASES[0].id).romaji);
    expect(summary(store, "hiragana", NOW).learned).toBe(0);
    expect(phraseTopics(store, NOW)).toMatchObject({ introduced: 1, newToday: 1 });
  });
});

describe("phrase modes", () => {
    const id = "about-me-2";
  /** Answer `id` right `days` more times, each when it falls due. */
  function study(store, days, opts = {}) {
    let now = NOW;
    for (let i = 0; i < days; i++) {
      const c = store.cards[cardKey(id)];
      now = Math.max(now + 60_000, c?.due ?? 0);
      const mode = phraseCard(store, id, c ? "review" : "new").mode;
      store.cards[cardKey(id)] = gradePhrase(store, id, true, now, { mode, ...(mode === "say" ? { rating: "good" } : {}), ...opts });
    }
    return now;
  }

  it("builds with tiles first, listens once it graduates, then says it once it's stable", () => {
    const store = emptyStore();
    expect(phraseCard(store, id, "new").mode).toBe("build");
    answer(store, id, true);
    expect(phraseMode(store.cards[cardKey(id)]).stage).toBe("build");
    study(store, 1); // 10 minutes later: graduates, back tomorrow
    expect(phraseMode(store.cards[cardKey(id)], "about-me").stage).toBe("listen");
    study(store, 1); // the next day: listened, back in about a week
    const c = store.cards[cardKey(id)];
    expect(c.stability).toBeGreaterThanOrEqual(7);
    expect(phraseMode(c, "about-me")).toEqual({ mode: "say", stage: "say" });
    // Even a perfect record comes back within a month.
    study(store, 8);
    expect(store.cards[cardKey(id)].scheduled_days).toBeLessThanOrEqual(30);
  });

  it("drops back to tiles after a miss, and needs good accuracy to be asked aloud", () => {
    const store = emptyStore();
    answer(store, id, true);
    study(store, 6);
    const now = store.cards[cardKey(id)].due;
    store.cards[cardKey(id)] = gradePhrase(store, id, false, now, { mode: "say", rating: "again" });
    expect(phraseMode(store.cards[cardKey(id)]).mode).toBe("build");
    expect(store.cards[cardKey(id)].modes.say.misses).toBe(1);
    // Low lifetime accuracy keeps a stable card at listening.
    expect(phraseMode({ state: 2, goodDays: 3, stability: 30, reps: 10, seen: 10, misses: 4 }).stage).toBe("listen");
    expect(phraseMode({ state: 2, goodDays: 3, stability: 30, reps: 10, seen: 10, misses: 1 }).stage).toBe("say");
  });

  it("keeps listening in the mix for spoken cards, and dialect stays listen-only", () => {
    const ready = { state: 2, goodDays: 3, stability: 30, seen: 10, misses: 0 };
    const modes = [0, 1, 2].map((saysSinceListen) => phraseMode({ ...ready, saysSinceListen }).mode);
    expect(modes).toEqual(["say", "say", "listen"]);
    expect(phraseMode(ready, "hiroshima-ben").mode).toBe("listen");
  });

  it("feeds a self-grade straight to FSRS", () => {
    const base = emptyStore();
    answer(base, id, true);
    study(base, 6);
    const due = base.cards[cardKey(id)].due;
    const hard = gradePhrase(base, id, true, due, { mode: "say", rating: "hard" });
    const easy = gradePhrase(base, id, true, due, { mode: "say", rating: "easy" });
    expect(easy.due).toBeGreaterThan(hard.due);
    expect(hard.lastMiss).toBeUndefined();
  });

  it("offers four meanings for listening, one right, none a lookalike", () => {
    for (const p of PHRASES) {
      const q = listenQuiz(p.id, seq(0.2, 0.8, 0.5, 0.1));
      expect(q.choices.length).toBe(4);
      const right = q.choices.find((c) => c.key === q.answer);
      expect(right.en).toBe(p.en);
      const others = q.choices.filter((c) => c.key !== q.answer);
      for (const o of others) expect(o.en.toLowerCase().replace(/[.!?]/g, "")).not.toBe(p.en.toLowerCase().replace(/[.!?]/g, ""));
      expect(new Set(q.choices.map((c) => c.en + c.note)).size).toBe(4);
    }
  });
});
