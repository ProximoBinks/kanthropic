/**
 * Phrases: everyday Japanese as Duolingo-style tile cards on the same FSRS
 * schedule as the kana. Pure functions over a store snapshot, like flow.mjs.
 *
 * A phrase's card lives in store.cards under `phrase:<id>`, so it syncs with
 * no changes to sync.mjs. "Introduced" simply means it has a card.
 *
 *   new phrase  → shown once (Japanese, reading, meaning), then quizzed
 *   quiz        → one of three modes, picked from the card's record (phraseMode):
 *     build     English prompt; rebuild the Japanese from shuffled tiles
 *     listen    hear the clip, no text; pick the meaning from four
 *     say       English prompt; say it aloud, reveal, grade yourself
 *   grade       → build/listen: right = Good, wrong = Again;
 *                 say: Again / Hard / Good / Easy as you graded it
 *
 * @typedef {import("./store.mjs").CardState} CardState
 */
import PHRASEBOOK from "../data/phrases.mjs";
import AUDIO from "../data/phrase-audio.mjs";
import { gradeCard } from "./scheduler.mjs";
import { isMastered } from "./learned.mjs";
import { practiceDate } from "./drill-progress.mjs";

export const PHRASE_PREFIX = "phrase:";
/** New phrases a day, across all topics. Reviews are never capped. */
export const NEW_PER_DAY = 10;

export const TOPICS = PHRASEBOOK.topics;
export const PHRASES = PHRASEBOOK.phrases;
export const PHRASE_SOURCE = PHRASEBOOK.source;
const BY_ID = new Map(PHRASES.map((p) => [p.id, p]));

export const cardKey = (id) => PHRASE_PREFIX + id;

/**
 * Modes a card moves through as it sticks. Tiles while it's being learned
 * (recognition with a scaffold), then listening once it has graduated, then
 * saying it from memory once it's stable — the skill that actually matters.
 * A miss anywhere drops it back to tiles. Listening keeps coming round
 * between "say it" reviews so the ear doesn't fall behind the mouth.
 */
export const MODES = ["build", "listen", "say"];
/** FSRS stability (days) before a card is asked aloud. */
export const SAY_STABILITY = 7;
/** Lifetime accuracy needed before a card is asked aloud. */
export const SAY_ACCURACY = 0.8;
/** Once a card is spoken, every LISTEN_EVERY-th review is a listening one instead. */
export const LISTEN_EVERY = 3;
/** Topics to understand, not to say (dialect): they stop at listening. */
const LISTEN_ONLY = new Set(["hiroshima-ben"]);
const REVIEW_STATE = 2; // ts-fsrs State.Review

/**
 * Which mode a phrase is quizzed in, from its card alone (so every device
 * agrees). `stage` is how far it has come; `mode` is what to ask now.
 * @param {CardState | undefined} card
 * @param {string} [topic]
 * @returns {{ mode: "build" | "listen" | "say", stage: "build" | "listen" | "say" }}
 */
export function phraseMode(card, topic = "") {
  const graduated = card && card.state === REVIEW_STATE && (card.goodDays ?? 0) >= 1;
  // A recent miss (the last review was a lapse) goes back to the scaffold.
  if (!graduated || card.lastMiss) return { mode: "build", stage: "build" };
  const seen = card.seen ?? card.reps ?? 0;
  const accuracy = seen ? 1 - (card.misses ?? 0) / seen : 0;
  const ready = (card.stability ?? 0) >= SAY_STABILITY && accuracy >= SAY_ACCURACY && !LISTEN_ONLY.has(topic);
  if (!ready) return { mode: "listen", stage: "listen" };
  // Count "say" answers since it last came up as listening, so the first time
  // it's ready it's always asked aloud.
  return { mode: (card.saysSinceListen ?? 0) >= LISTEN_EVERY - 1 ? "listen" : "say", stage: "say" };
}
/** Voices the phrases were recorded in (scripts/build-audio.mjs). */
export const VOICES = AUDIO.voices;

/**
 * Pre-recorded clip for a phrase (file name under audio/), or null → device TTS.
 * `voice` picks one speaker; otherwise a random one, so the ear learns the
 * phrase rather than one person's quirks.
 */
export function audioFile(id, voice = null, rng = Math.random) {
  const byVoice = AUDIO.files[id];
  if (!byVoice) return null;
  if (voice && byVoice[voice]) return byVoice[voice];
  const all = Object.values(byVoice);
  return all.length ? all[Math.floor(rng() * all.length)] : null;
}
export const phraseById = (id) => BY_ID.get(id) || null;

/** @param {{ cards?: Record<string, CardState> }} store @param {string} id */
const cardOf = (store, id) => store.cards?.[cardKey(id)];

/** Phrases first introduced on the local day of `now`. */
export function introducedToday(store, now = Date.now()) {
  const today = practiceDate(now);
  let n = 0;
  for (const p of PHRASES) {
    const c = cardOf(store, p.id);
    if (c?.introducedAt && practiceDate(c.introducedAt) === today) n++;
  }
  return n;
}

/** Per-topic progress for the picker, plus totals. */
export function phraseTopics(store, now = Date.now()) {
  const rows = TOPICS.map((t) => ({ id: t.id, label: t.label, group: t.group ?? "", count: t.count, introduced: 0, due: 0, mastered: 0, saying: 0, shaky: 0 }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const p of PHRASES) {
    const c = cardOf(store, p.id);
    if (!c) continue;
    const row = byId.get(p.topic);
    row.introduced++;
    if (isMastered(c)) row.mastered++;
    if (phraseMode(c, p.topic).stage === "say") row.saying++;
    if (c.due <= now) row.due++;
    if (isShaky(c)) row.shaky++;
  }
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  return {
    topics: rows,
    total: PHRASES.length,
    introduced: sum("introduced"),
    due: sum("due"),
    mastered: sum("mastered"),
    saying: sum("saying"),
    shaky: sum("shaky"),
    newToday: introducedToday(store, now),
    newPerDay: NEW_PER_DAY,
  };
}

/**
 * The next phrase to work on. Due reviews come first (in this topic, or in
 * every topic when `topic` is null), then the next new phrase of the topic,
 * in book order, while today's new allowance lasts.
 *
 * @param {{ cards?: Record<string, CardState> }} store
 * @param {{ topic?: string | null, lastId?: string | null, now?: number, extraNew?: number, rng?: () => number }} [opts]
 * @returns {{ id: string | null, kind: "review" | "new" | null, reason: "due" | "new" | "caught-up" | "limit" | "done" }}
 */
export function nextPhrase(store, { topic = null, lastId = null, now = Date.now(), extraNew = 0, rng = Math.random } = {}) {
  const inScope = topic ? PHRASES.filter((p) => p.topic === topic) : PHRASES;
  const due = inScope.filter((p) => {
    const c = cardOf(store, p.id);
    return c && c.due <= now;
  });
  if (due.length) {
    // Most overdue first, but don't repeat the card you just answered.
    const pool = due.length > 1 ? due.filter((p) => p.id !== lastId) : due;
    pool.sort((a, b) => cardOf(store, a.id).due - cardOf(store, b.id).due);
    const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * Math.min(3, pool.length)))];
    return { id: pick.id, kind: "review", reason: "due" };
  }
  if (!topic) return { id: null, kind: null, reason: "caught-up" };
  const fresh = inScope.find((p) => !cardOf(store, p.id));
  if (!fresh) return { id: null, kind: null, reason: "done" };
  if (introducedToday(store, now) >= NEW_PER_DAY + extraNew) return { id: null, kind: null, reason: "limit" };
  return { id: fresh.id, kind: "new", reason: "new" };
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Tile bank for a phrase: its own tiles plus decoys from the same topic
 * (three for a one-word card, so it's a real choice; two otherwise).
 * @returns {{ id: string, en: string, note: string, tiles: { key: string, text: string }[], answer: string[] } | null}
 */
export function phraseQuiz(id, rng = Math.random) {
  const p = phraseById(id);
  if (!p) return null;
  const own = new Set(p.tiles);
  const decoyCount = p.tiles.length === 1 ? 3 : 2;
  const pool = (list) => [...new Set(list.flatMap((q) => q.tiles))].filter((t) => !own.has(t));
  let candidates = pool(PHRASES.filter((q) => q.topic === p.topic && q.id !== p.id));
  if (candidates.length < decoyCount) candidates = pool(PHRASES.filter((q) => q.id !== p.id));
  const decoys = shuffle(candidates, rng).slice(0, decoyCount);
  const tiles = shuffle([...p.tiles, ...decoys], rng).map((text, i) => ({ key: `t${i}`, text }));
  return { id: p.id, en: p.en, note: p.note || "", tiles, answer: p.tiles };
}

/**
 * Listening card: four English meanings, one right. Distractors come from the
 * same topic first (harder: similar situations), never sharing the answer's
 * English, and each carries its note so two "Thank you." can't both appear.
 * @returns {{ id: string, choices: { key: string, en: string, note: string }[], answer: string } | null}
 */
export function listenQuiz(id, rng = Math.random) {
  const p = phraseById(id);
  if (!p) return null;
  const label = (q) => `${q.en}|${q.note || ""}`;
  const same = (q) => q.en.toLowerCase().replace(/[.!?]/g, "") === p.en.toLowerCase().replace(/[.!?]/g, "");
  const pickFrom = (list, taken) => shuffle(list.filter((q) => q.id !== p.id && !same(q) && !taken.has(label(q))), rng);
  const taken = new Set([label(p)]);
  const wrong = [];
  for (const q of [...pickFrom(PHRASES.filter((q) => q.topic === p.topic), taken), ...pickFrom(PHRASES, taken)]) {
    if (wrong.length === 3) break;
    if (taken.has(label(q))) continue;
    taken.add(label(q));
    wrong.push(q);
  }
  const choices = shuffle([p, ...wrong], rng).map((q, i) => ({ key: `c${i}`, en: q.en, note: q.note || "", id: q.id }));
  const answer = choices.find((c) => c.id === p.id).key;
  return { id: p.id, choices: choices.map(({ key, en, note }) => ({ key, en, note })), answer };
}

/**
 * Everything a host needs to show the next card, so the web app and the Mac
 * app pick the same mode. New phrases are always built with tiles.
 */
export function phraseCard(store, id, kind, rng = Math.random) {
  const p = phraseById(id);
  if (!p) return null;
  // "rebuild": a drill card you just missed comes back with tiles.
  const { mode, stage } = kind === "new" || kind === "rebuild"
    ? { mode: "build", stage: kind === "new" ? "build" : phraseMode(cardOf(store, id), p.topic).stage }
    : phraseMode(cardOf(store, id), p.topic);
  return {
    mode, stage,
    ...(mode === "build" ? { tiles: phraseQuiz(id, rng).tiles } : {}),
    ...(mode === "listen" ? listenQuiz(id, rng) : {}),
  };
}

// ---------------------------------------------------------------------------
// Drill: extra practice on demand, outside the schedule.
//
// A drill is a short round of phrases you've already met, asked in each
// card's current mode until every one has been answered right; a miss sends
// the phrase a few places back and brings it back as tiles. Like the kana
// rote, a drill never writes FSRS: right answers crammed minutes apart would
// fake long-term memory and push real reviews out. It only feeds the
// practice log. Two kinds:
//   shaky   met but not yet mastered, worst first (recent miss, low
//           accuracy, short interval), across every topic or one
//   topic   every phrase you've met in one topic, least stable first
// ---------------------------------------------------------------------------

/** Phrases per drill round. */
export const DRILL_SIZE = 10;
/** A missed phrase comes back after this many others. */
const DRILL_REQUEUE = 3;

/** Met but not mastered: what "drill the shaky ones" works on. */
export function isShaky(card) {
  return !!card && !isMastered(card);
}

/** Higher = shakier: a recent miss, a poor record, a short interval. */
function shakiness(card) {
  if (!card) return -1;
  const seen = card.seen ?? card.reps ?? 0;
  const accuracy = seen ? 1 - (card.misses ?? 0) / seen : 1;
  return (card.lastMiss ? 3 : 0) + (1 - accuracy) * 2 + (card.lapses ?? 0) * 0.5 + 1 / (1 + (card.stability ?? 0));
}

/**
 * Phrases for a drill round.
 * @param {{ cards?: Record<string, CardState> }} store
 * @param {{ kind?: "shaky" | "topic", topic?: string | null, exclude?: string[], size?: number }} [opts]
 * @returns {string[]}
 */
export function phraseDrillSet(store, { kind = "shaky", topic = null, exclude = [], size = DRILL_SIZE } = {}) {
  const skip = new Set(exclude);
  const pool = PHRASES.filter((p) => (!topic || p.topic === topic) && !skip.has(p.id)).filter((p) => {
    const c = cardOf(store, p.id);
    return kind === "topic" ? !!c : isShaky(c);
  });
  const ranked = pool.map((p) => ({ id: p.id, score: shakiness(cardOf(store, p.id)) })).sort((a, b) => b.score - a.score);
  return ranked.slice(0, size).map((r) => r.id);
}

/**
 * Start a drill round. The state is plain JSON so the hosts can hold it.
 * @param {string[]} ids
 */
export function startDrill(ids, { kind = "shaky", topic = null } = {}) {
  return { kind, topic, ids: [...ids], pending: [...ids], missed: [], firstTry: 0, answered: 0 };
}

/** The next phrase of a drill (avoiding an immediate repeat), or null when it's done. */
export function drillNext(d, lastId = null) {
  if (!d?.pending?.length) return null;
  const id = d.pending.length > 1 && d.pending[0] === lastId ? d.pending[1] : d.pending[0];
  return { id, kind: d.missed.includes(id) ? "rebuild" : "review" };
}

/** Grade a drill answer. Returns the new state; `done` once every phrase is right. */
export function drillGrade(d, id, correct) {
  const pending = d.pending.filter((x) => x !== id);
  const missed = [...d.missed];
  let firstTry = d.firstTry;
  if (correct) {
    if (!missed.includes(id)) firstTry++;
  } else {
    if (!missed.includes(id)) missed.push(id);
    pending.splice(Math.min(DRILL_REQUEUE, pending.length), 0, id);
  }
  return { ...d, pending, missed, firstTry, answered: d.answered + 1, done: pending.length === 0 };
}

/** Self-grades for "say it", as ts-fsrs ratings. */
export const SAY_RATINGS = { again: 1, hard: 2, good: 3, easy: 4 };

/** Right when the picked tiles spell the phrase (so identical tiles are interchangeable). */
export function checkPhrase(id, picked) {
  const p = phraseById(id);
  return !!p && Array.isArray(picked) && picked.join("") === p.tiles.join("");
}

/**
 * Grade a phrase answer. Returns the new card; the caller stores it at
 * cardKey(id). The first grade also stamps introducedAt (for the daily cap).
 * `mode` tallies per-mode accuracy; a "say" grade passes `rating` ("again" |
 * "hard" | "good" | "easy"), which feeds FSRS directly. `lastMiss` marks a
 * lapse so the next review goes back to tiles.
 * @returns {CardState & { introducedAt: number }}
 */
export function gradePhrase(store, id, correct, now = Date.now(), { mode = "build", rating = null } = {}) {
  const prev = cardOf(store, id);
  const r = mode === "say" && typeof rating === "string" ? SAY_RATINGS[rating] ?? null : rating;
  const ok = r != null ? r > 1 : correct;
  const card = gradeCard(/** @type {any} */ ("phrase"), cardKey(id), prev, ok, new Date(now), r);
  const modes = { ...(prev?.modes || {}) };
  const m = modes[mode] || { seen: 0, misses: 0 };
  modes[mode] = { seen: m.seen + 1, misses: m.misses + (ok ? 0 : 1) };
  const out = { ...card, romaji: phraseById(id)?.romaji ?? "", introducedAt: prev?.introducedAt ?? now, modes };
  if (!ok) out.lastMiss = true; else delete out.lastMiss;
  out.saysSinceListen = mode === "say" ? (prev?.saysSinceListen ?? 0) + 1 : mode === "listen" ? 0 : prev?.saysSinceListen ?? 0;
  return out;
}
