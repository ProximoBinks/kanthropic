import { describe, it, expect } from "vitest";
import {
  FIRST_MS, IDLE_MS, activityDay, activityMonth, activitySummary, dayTotals, formatDuration, level, logAnswer,
} from "../src/core/activity.mjs";
import { flatten, unflatten, resolve } from "../src/core/sync.mjs";
import { progressView } from "../src/core/engine.mjs";

// Local-time dates, so the tests hold in any timezone.
const at = (y, m, d, h = 10, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime();
const fresh = (deviceId = "dev-a") => ({ config: { deviceId }, cards: {}, activity: {} });

describe("practice log", () => {
  it("counts active time between answers, not idle time", () => {
    const s = fresh();
    logAnswer(s, { kind: "kana", correct: true, now: at(2026, 10, 30, 9) });              // first: FIRST_MS
    logAnswer(s, { kind: "kana", correct: false, now: at(2026, 10, 30, 9, 0, 20) });      // +20s
    logAnswer(s, { kind: "phrase", correct: true, mode: "say", now: at(2026, 10, 30, 9, 1, 0) }); // +40s
    logAnswer(s, { kind: "phrase", correct: true, mode: "listen", isNew: false, now: at(2026, 10, 30, 11) }); // break: FIRST_MS
    const t = dayTotals(s, "2026-10-30");
    expect(t.ms).toBe(FIRST_MS + 20_000 + 40_000 + FIRST_MS);
    expect(t).toMatchObject({ answers: 4, correct: 3, kana: 2, phrases: 2, said: 1, listened: 1, built: 0 });
    expect(IDLE_MS).toBeLessThan(2 * 3600_000);
  });

  it("creates a device id once and keeps devices apart, so sync can't clobber", () => {
    const s = { config: {}, activity: {} };
    logAnswer(s, { kind: "kana", correct: true, now: at(2026, 10, 30) });
    const id = s.config.deviceId;
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    logAnswer(s, { kind: "kana", correct: true, now: at(2026, 10, 30, 10, 0, 5) });
    expect(s.config.deviceId).toBe(id);

    const phone = fresh("phone");
    logAnswer(phone, { kind: "phrase", correct: true, now: at(2026, 10, 30, 20) });
    // Both devices' entries travel as separate sync keys and add up.
    const merged = unflatten({ ...flatten(s), ...flatten(phone) }, s);
    expect(Object.keys(merged.activity["2026-10-30"]).sort()).toEqual([id, "phone"].sort());
    expect(dayTotals(merged, "2026-10-30").answers).toBe(3);
    // The device id itself never syncs.
    expect(JSON.stringify(flatten(s))).not.toContain('"deviceId"');
  });

  it("keeps the fuller copy of a device's day on a sync conflict", () => {
    const a = { ms: 1000, answers: 3 }, b = { ms: 2000, answers: 5 };
    expect(resolve("activity:2026-10-30:x", a, b)).toBe(b);
    expect(resolve("activity:2026-10-30:x", b, a)).toBe(b);
  });

  it("counts a streak that's still alive today, and the best run", () => {
    const s = fresh();
    for (const d of [1, 2, 3, 10, 11, 28, 29]) logAnswer(s, { kind: "kana", correct: true, now: at(2026, 10, d) });
    // Today (30th) not practised yet: the streak from the 28th–29th still counts.
    const sum = activitySummary(s, { now: at(2026, 10, 30, 8) });
    expect(sum.streak).toBe(2);
    expect(sum.best).toBe(3);
    expect(sum.all.days).toBe(7);
    expect(sum.since).toBe("2026-10-01");
    // A missed day breaks it.
    expect(activitySummary(s, { now: at(2026, 10, 31, 8) }).streak).toBe(0);
  });

  it("lays out a month Monday-first with goal levels", () => {
    const s = fresh();
    // 15 minutes of steady answers on the 5th (goal met), one answer on the 6th.
    for (let i = 0; i <= 60; i++) logAnswer(s, { kind: "kana", correct: true, now: at(2026, 10, 5, 9) + i * 15_000 });
    logAnswer(s, { kind: "kana", correct: true, now: at(2026, 10, 6) });
    const m = activityMonth(s, { year: 2026, month: 10, now: at(2026, 10, 30) });
    expect(m.label).toBe("October 2026");
    const days = m.weeks.flat();
    expect(m.weeks.every((w) => w.length === 7)).toBe(true);
    // 1 October 2026 is a Thursday: three days of September lead in.
    expect(days.slice(0, 4).map((d) => d.inMonth)).toEqual([false, false, false, true]);
    expect(days.find((d) => d.date === "2026-10-05").level).toBe(4);
    expect(days.find((d) => d.date === "2026-10-06").level).toBe(1);
    expect(days.find((d) => d.date === "2026-10-30").today).toBe(true);
    expect(days.find((d) => d.date === "2026-10-31").future).toBe(true);
    expect(m.total.days).toBe(2);
    expect(level(0)).toBe(0);
  });

  it("gives a day's breakdown and readable durations", () => {
    const s = fresh();
    logAnswer(s, { kind: "phrase", correct: true, mode: "build", isNew: true, now: at(2026, 10, 30) });
    logAnswer(s, { kind: "phrase", correct: false, mode: "build", now: at(2026, 10, 30, 10, 0, 10) });
    expect(activityDay(s, "2026-10-30")).toMatchObject({ answers: 2, newPhrases: 1, built: 2, accuracy: 0.5 });
    expect(activityDay(s, "2026-10-29").accuracy).toBeNull();
    expect(formatDuration(40_000)).toBe("40s");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(65 * 60_000)).toBe("1h 05m");
  });

  it("builds the whole progress view in one call", () => {
    const s = fresh();
    logAnswer(s, { kind: "kana", correct: true, now: at(2026, 10, 30) });
    const v = progressView(s, { now: at(2026, 10, 30, 12) });
    expect(v.summary.today.answers).toBe(1);
    expect(v.month.month).toBe(10);
    expect(v.kana.hiragana.total).toBe(104);
    expect(v.phrases.total).toBeGreaterThan(500);
  });
});
