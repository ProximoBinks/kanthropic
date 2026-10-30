import { drillKey, drillProgress, gradeDrill } from "./drill-progress.mjs";
/**
 * JSContext / IIFE entry for the macOS app. Pure functions over a store
 * snapshot — no fs, no Node. The host owns persistence.
 *
 * Bundled with:
 *   esbuild src/core/engine.mjs --bundle --format=iife --global-name=Kanthropic
 */
import { ENTRIES, DAKUTEN_LESSONS, checkAnswer, entryByGlyph, glyph as glyphOf } from "../data/kana.mjs";
import { mnemonicFor } from "../data/mnemonics.mjs";
import { gradeCard } from "./scheduler.mjs";
import { ensureLearned } from "./learned.mjs";
import { emptyBase, finish as syncFinish, prepare as syncPrepare } from "./sync.mjs";
import { activityDay, activityMonth, activitySummary, formatDuration, logAnswer } from "./activity.mjs";
import {
  audioFile, VOICES as PHRASE_VOICES, cardKey as phraseCardKey, checkPhrase, gradePhrase, nextPhrase, phraseById, phraseCard, phraseQuiz, phraseTopics, PHRASE_SOURCE,
} from "./phrases.mjs";
import {
  beginDrill, checkDakuten, drillSets, gradeDakuten, markDueNow, nextDakuten, nextRevise, nextRote,
  nextUnlearnedRow, progressChart, resetLearning, resetStudying, resolveScript, rowsFor, summary,
  ROTE_STREAK,
} from "./flow.mjs";

/**
 * Everything the progress tab shows, in one call so the web and Mac apps
 * render the same numbers: practice time and streaks, the month calendar,
 * and where the kana and phrases stand.
 * @param {Record<string, any>} store
 * @param {{ year?: number, month?: number, now?: number }} [opts]  month is 1–12; defaults to this month
 */
export function progressView(store, { year, month, now = Date.now() } = {}) {
  const d = new Date(now);
  const y = year ?? d.getFullYear();
  const m = month ?? d.getMonth() + 1;
  const ph = phraseTopics(store, now);
  return {
    summary: activitySummary(store, { now }),
    month: activityMonth(store, { year: y, month: m, now }),
    kana: {
      hiragana: summary(store, "hiragana", now),
      katakana: summary(store, "katakana", now),
    },
    phrases: { total: ph.total, met: ph.introduced, mastered: ph.mastered, speaking: ph.saying, due: ph.due },
  };
}

/**
 * Plain-JSON view of one character in learn mode.
 * @param {import("../data/kana.mjs").Script} script
 * @param {string} ch
 */
function learnView(script, ch) {
  const entry = entryByGlyph(script, ch);
  if (!entry) return null;
  const other = script === "hiragana" ? "katakana" : "hiragana";
  return {
    glyph: ch,
    romaji: entry.romaji,
    partner: glyphOf(entry, other),
    other,
    mnemonic: mnemonicFor(entry, ch),
  };
}

/** @param {import("../data/kana.mjs").KanaEntry[] | null} entries */
function serializeRow(entries) {
  if (!entries) return null;
  return entries.map((e) => ({ hira: e.hira, kata: e.kata, romaji: e.romaji }));
}

/**
 * Single dispatch used by Swift (and tests). Payload is a plain object.
 * Returns JSON-safe values only (no Set / Date / undefined).
 * @param {string} op
 * @param {Record<string, any>} p
 */
export function invoke(op, p = {}) {
  try {
    switch (op) {
      case "prepare": {
        const store = p.store || {};
        const changed = ensureLearned(store);
        return { store, changed };
      }
      case "resolveScript":
        return resolveScript(p.store || {}, p.explicit ?? null);
      case "summary":
        return summary(p.store || {}, p.script, p.now);
      case "nextLearnRow": {
        const row = nextUnlearnedRow(p.store || {}, p.script);
        if (!row) return null;
        const script = p.script;
        return {
          glyphs: row.map((e) => glyphOf(e, script)),
          romaji: row.map((e) => e.romaji),
          entries: serializeRow(row),
        };
      }
      case "learnView":
        return learnView(p.script, p.glyph);
      case "check": {
        const entry = entryByGlyph(p.script, p.glyph);
        if (!entry) return false;
        const raw = String(p.input ?? "");
        if (raw.trim() === entry.hira || raw.trim() === entry.kata) return true;
        return checkAnswer(raw, entry);
      }
      case "grade":
        return gradeCard(
          p.script,
          p.glyph,
          p.store?.cards?.[p.glyph],
          !!p.correct,
          new Date(typeof p.now === "number" ? p.now : Date.now()),
        );
      case "nextRevise":
        return nextRevise(p.store || {}, p.script, p.lastGlyph ?? null, p.now ?? Date.now());
      case "nextRote":
        return nextRote(p.store || {}, p.script, p.lastGlyph ?? null, Math.random, p.streaks ?? {});
      case "roteStreak":
        return ROTE_STREAK;
      case "drillSets":
        return drillSets(p.store || {}, p.script).map((s) => ({
          id: s.id, label: s.label, count: s.count,
          done: s.glyphs.filter((g) => (drillProgress(p.store || {}, drillKey(p.script, s.id), p.now).streaks[g] || 0) >= ROTE_STREAK).length,
        }));
      case "beginDrill": {
        const store = p.store || {};
        const glyphs = Array.isArray(p.glyphs) ? p.glyphs : null;
        const r = beginDrill(store, p.script, String(p.id ?? "all"), glyphs);
        return { store, count: r.count, id: r.id, fresh: r.fresh };
      }
      case "drillProgress":
        return drillProgress(p.store || {}, p.key, p.now);
      case "gradeDrill": {
        const store = p.store || {};
        if (!p.key || store.activeDrill !== p.key || !(store.rote || []).includes(p.glyph)) return { store };
        const progress = gradeDrill(store, p.key, p.glyph, !!p.correct, p.now);
        return { store, progress };
      }
      case "resetLearning": {
        const store = p.store || {};
        const dropped = resetLearning(store, p.script);
        return { store, dropped };
      }
      case "resetStudying": {
        const store = p.store || {};
        const cleared = resetStudying(store, p.script);
        return { store, cleared };
      }
      case "markDueNow": {
        const store = p.store || {};
        const n = markDueNow(store, p.script, p.now ?? Date.now());
        return { store, n };
      }
      case "rows":
        return rowsFor(p.script).map((r) => ({
          section: r.section,
          glyphs: r.entries.map((e) => glyphOf(e, p.script)),
          romaji: r.entries.map((e) => e.romaji),
        }));
      case "allGlyphs":
        return ENTRIES.map((e) => ({ hira: e.hira, kata: e.kata, romaji: e.romaji }));
      case "chart":
        return progressChart(p.store || {}, p.script, p.now ?? Date.now());
      case "nextDakuten":
        return nextDakuten(p.lastId ?? null, p.streaks ?? {}, Math.random, !!p.force);
      case "checkDakuten":
        return checkDakuten(p.id, String(p.input ?? ""));
      case "gradeDakuten":
        return gradeDakuten(p.streaks ?? {}, p.id, !!p.correct);
      case "completeDakuten": {
        const s = {};
        for (const L of DAKUTEN_LESSONS) s[L.id] = ROTE_STREAK;
        return s;
      }
      case "dakutenCount":
        return DAKUTEN_LESSONS.length;
      // Phrases (src/core/phrases.mjs). gradePhrase returns the updated store.
      case "phraseTopics":
        return phraseTopics(p.store || {}, p.now ?? Date.now());
      case "nextPhrase":
        return nextPhrase(p.store || {}, {
          topic: p.topic ?? null, lastId: p.lastId ?? null, now: p.now ?? Date.now(), extraNew: p.extraNew ?? 0,
        });
      case "phrase":
        return phraseById(p.id);
      case "phraseQuiz":
        return phraseQuiz(p.id);
      case "phraseCard":
        return phraseCard(p.store || {}, p.id, p.kind ?? "review");
      case "checkPhrase":
        return checkPhrase(p.id, p.picked);
      case "gradePhrase": {
        const store = p.store || {};
        store.cards = { ...(store.cards || {}), [phraseCardKey(p.id)]: gradePhrase(store, p.id, !!p.correct, p.now ?? Date.now(), { mode: p.mode ?? "build", rating: p.rating ?? null }) };
        return { store };
      }
      // Practice log (src/core/activity.mjs). logAnswer returns the updated store.
      case "logAnswer": {
        const store = p.store || {};
        logAnswer(store, { kind: p.kind, correct: !!p.correct, mode: p.mode ?? "", isNew: !!p.isNew, now: p.now ?? Date.now() });
        return { store };
      }
      case "activitySummary":
        return activitySummary(p.store || {}, { now: p.now ?? Date.now(), goalMin: p.goalMin ?? undefined });
      case "activityMonth":
        return activityMonth(p.store || {}, { year: p.year, month: p.month, now: p.now ?? Date.now(), goalMin: p.goalMin ?? undefined });
      case "activityDay":
        return activityDay(p.store || {}, p.date);
      case "progressView":
        return progressView(p.store || {}, { year: p.year, month: p.month, now: p.now ?? Date.now() });
      case "formatDuration":
        return formatDuration(p.ms);
      case "phraseAudio":
        return audioFile(p.id, p.voice ?? null);
      case "phraseVoices":
        return PHRASE_VOICES;
      case "phraseSource":
        return PHRASE_SOURCE;
      // Cloud sync: the host does the HTTP call and the file I/O (see sync.mjs).
      case "syncPrepare":
        return syncPrepare(p.base || emptyBase(), p.store || {});
      case "syncFinish":
        return syncFinish(p.base || emptyBase(), p.sent || {}, p.reply, p.store || {});
      default:
        return { error: "unknown op " + op };
    }
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
}

export {
  nextRevise, nextRote, nextUnlearnedRow, resolveScript, rowsFor, summary,
  resetLearning, resetStudying, markDueNow, ROTE_STREAK,
  progressChart, nextDakuten, checkDakuten, gradeDakuten, drillSets, beginDrill,
};
