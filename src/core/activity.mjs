/**
 * Practice log: how long and how much you practised each day, for the
 * progress calendar. Pure functions over a store snapshot, like flow.mjs.
 *
 *   store.activity[date][device] = { ms, answers, correct, kana, phrases,
 *                                    newPhrases, built, listened, said, lastAt }
 *
 * Time is ACTIVE time, measured between answers rather than with a running
 * clock: the gap since your previous answer counts if it's under IDLE_MS
 * (reading, thinking, saying it aloud), otherwise only FIRST_MS does (you
 * walked off, or it's the first card of a sitting). So an app left open on
 * a card for an hour doesn't log an hour, and nothing has to tick.
 *
 * Each device keeps its own entry per day, so two devices practising the
 * same day never overwrite each other when they sync; the day's total is
 * the sum. `date` is the LOCAL calendar day (practiceDate).
 */
import { practiceDate } from "./drill-progress.mjs";

/** A gap longer than this between answers is a break, not practice. */
export const IDLE_MS = 90_000;
/** What an answer after a break (or the first of a sitting) counts for. */
export const FIRST_MS = 12_000;
/** Default daily goal, in minutes: a calendar day is "full" at this. */
export const GOAL_MIN = 15;

const DAY_MS = 86_400_000;

/**
 * A fresh device id (stored per device, never synced). Web Crypto when it's
 * there; the macOS app runs this in JavaScriptCore, which has no `crypto`,
 * so fall back to Math.random — it only has to tell your own devices apart.
 */
export function newDeviceId() {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Log one answer. Mutates and returns `store`. The device id lives in the
 * device-local config (created on first use), so the Mac app and the CLI,
 * which share a progress file, count as one device.
 * @param {Record<string, any>} store
 * @param {{ kind: "kana" | "phrase", correct: boolean, mode?: string, isNew?: boolean, now?: number }} a
 */
export function logAnswer(store, { kind, correct, mode = "", isNew = false, now = Date.now() }) {
  const date = practiceDate(now);
  if (!store.config || typeof store.config !== "object") store.config = {};
  if (typeof store.config.deviceId !== "string" || !store.config.deviceId) store.config = { ...store.config, deviceId: newDeviceId() };
  const dev = store.config.deviceId;
  const days = { ...(store.activity || {}) };
  const day = { ...(days[date] || {}) };
  const e = { ms: 0, answers: 0, correct: 0, kana: 0, phrases: 0, newPhrases: 0, built: 0, listened: 0, said: 0, ...(day[dev] || {}) };
  const gap = e.lastAt ? now - e.lastAt : Infinity;
  e.ms += gap >= 0 && gap <= IDLE_MS ? gap : FIRST_MS;
  e.answers += 1;
  if (correct) e.correct += 1;
  if (kind === "phrase") {
    e.phrases += 1;
    if (isNew) e.newPhrases += 1;
    if (mode === "listen") e.listened += 1;
    else if (mode === "say") e.said += 1;
    else e.built += 1;
  } else {
    e.kana += 1;
  }
  e.lastAt = now;
  day[dev] = e;
  days[date] = day;
  store.activity = days;
  return store;
}

const FIELDS = ["ms", "answers", "correct", "kana", "phrases", "newPhrases", "built", "listened", "said"];

/** One day's totals across devices. */
export function dayTotals(store, date) {
  const out = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  for (const e of Object.values(store.activity?.[date] || {})) {
    for (const f of FIELDS) out[f] += Number(e?.[f]) || 0;
  }
  return out;
}

/** "2026-10-30" → local-noon ms (noon dodges DST edges when stepping days). */
const dateMs = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};
const addDays = (date, n) => practiceDate(dateMs(date) + n * DAY_MS);
const practised = (store, date) => dayTotals(store, date).answers > 0;

/** 0–4 for the calendar: nothing, then quarters of the daily goal (4 = goal met). */
export function level(ms, goalMin = GOAL_MIN) {
  if (!ms) return 0;
  const f = ms / (goalMin * 60_000);
  return f >= 1 ? 4 : f >= 0.5 ? 3 : f >= 0.25 ? 2 : 1;
}

/**
 * Headline numbers: today, streaks, this week, all time.
 * The current streak still counts when today isn't done yet (it's only
 * broken once a whole day is missed).
 */
export function activitySummary(store, { now = Date.now(), goalMin = GOAL_MIN } = {}) {
  const today = practiceDate(now);
  const dates = Object.keys(store.activity || {}).filter((d) => practised(store, d)).sort();
  let streak = 0;
  for (let d = practised(store, today) ? today : addDays(today, -1); practised(store, d); d = addDays(d, -1)) streak++;
  let best = 0, run = 0, prev = null;
  for (const d of dates) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const sum = (list) => list.reduce((acc, d) => {
    const t = dayTotals(store, d);
    for (const f of FIELDS) acc[f] += t[f];
    return acc;
  }, Object.fromEntries(FIELDS.map((f) => [f, 0])));
  // Week = the last 7 days including today.
  const week = sum(Array.from({ length: 7 }, (_, i) => addDays(today, -i)));
  const all = sum(dates);
  const t = dayTotals(store, today);
  return {
    today: { date: today, ...t, goalMs: goalMin * 60_000, goalMet: t.ms >= goalMin * 60_000 },
    streak, best,
    week: { ...week, days: Array.from({ length: 7 }, (_, i) => addDays(today, -i)).filter((d) => practised(store, d)).length },
    all: { ...all, days: dates.length },
    since: dates[0] ?? null,
    goalMin,
  };
}

/**
 * A month as calendar weeks (Monday first), for the grid.
 * @param {Record<string, any>} store
 * @param {{ year: number, month: number, now?: number, goalMin?: number }} opts  month is 1–12
 */
export function activityMonth(store, { year, month, now = Date.now(), goalMin = GOAL_MIN }) {
  const today = practiceDate(now);
  const first = new Date(year, month - 1, 1, 12);
  const lead = (first.getDay() + 6) % 7; // days before the 1st, Monday-first
  let date = practiceDate(first.getTime() - lead * DAY_MS);
  const weeks = [];
  let total = { ms: 0, answers: 0, days: 0 };
  do {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const t = dayTotals(store, date);
      const inMonth = Number(date.slice(5, 7)) === month;
      if (inMonth && t.answers) { total.ms += t.ms; total.answers += t.answers; total.days++; }
      week.push({
        date, day: Number(date.slice(8)), inMonth, today: date === today, future: date > today,
        ms: t.ms, answers: t.answers, level: level(t.ms, goalMin),
      });
      date = addDays(date, 1);
    }
    weeks.push(week);
  } while (Number(date.slice(5, 7)) === month);
  const label = first.toLocaleString("en", { month: "long", year: "numeric" });
  return { year, month, label, weeks, total };
}

/** Everything one tapped day shows. */
export function activityDay(store, date) {
  const t = dayTotals(store, date);
  return { date, ...t, accuracy: t.answers ? t.correct / t.answers : null };
}

/** "1h 05m" / "12m" / "40s" for display. */
export function formatDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
