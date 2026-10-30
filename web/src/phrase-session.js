/**
 * Phrases tab state machine. Decisions come from src/core/phrases.mjs; this
 * only sequences topic picker → (intro) → quiz → result → next. The quiz is
 * tiles, listening or "say it", whichever phraseCard picks for the card.
 */
import {
  audioFile, cardKey, checkPhrase, drillGrade, drillNext, gradePhrase, nextPhrase, phraseById, phraseCard,
  phraseDrillSet, phraseTopics, startDrill, PHRASE_SOURCE,
} from "../../src/core/phrases.mjs";
import { load, update } from "./store.js";
import { logAnswer } from "../../src/core/activity.mjs";

const TOPIC_SLOT = "kanthropic:phrase-topic";
const SPEAK_SLOT = "kanthropic:speak";
const VOICE_SLOT = "kanthropic:voice";

/** "mix" (a random speaker each time) or one voice name. */
export function voicePref() {
  try { return localStorage.getItem(VOICE_SLOT) || "mix"; } catch { return "mix"; }
}
export function setVoicePref(v) {
  try { localStorage.setItem(VOICE_SLOT, v); } catch { /* ignore */ }
}

export function speakEnabled() {
  try { return localStorage.getItem(SPEAK_SLOT) !== "off"; } catch { return true; }
}
export function setSpeakEnabled(on) {
  try { localStorage.setItem(SPEAK_SLOT, on ? "on" : "off"); } catch { /* ignore */ }
}

let current = null;

/** Play a phrase: its pre-recorded clip, or the device's Japanese voice if there's none. */
export function speakPhrase(phrase) {
  if (!phrase) return;
  const pref = voicePref();
  const file = audioFile(phrase.id, pref === "mix" ? null : pref);
  if (!file) return speak(phrase.ja);
  current?.pause();
  globalThis.speechSynthesis?.cancel();
  current = new Audio(`audio/${file}`);
  current.play().catch(() => speak(phrase.ja));
}

/** Read Japanese aloud with the device's ja-JP voice, preferring an Enhanced/Premium one. */
export function speak(text) {
  const synth = globalThis.speechSynthesis;
  if (!synth || !text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 0.9;
  const ja = synth.getVoices().filter((v) => v.lang?.replace("_", "-").startsWith("ja"));
  const voice = ja.find((v) => /premium|enhanced|siri/i.test(v.name)) || ja.find((v) => /kyoko|otoya/i.test(v.name)) || ja[0];
  if (voice) u.voice = voice;
  synth.speak(u);
}

export class PhraseSession {
  constructor() {
    this.s = {
      view: "topics", topic: null, stats: phraseTopics(load()),
      phrase: null, kind: null, mode: "build", stage: "build", tiles: [], picked: [], choices: [], answer: null, chosen: null,
      revealed: false, result: null, reason: null, score: { right: 0, seen: 0 },
      drill: null,
    };
    this.lastId = null;
    /** Phrases drilled this sitting, so "another round" moves on to the next ones. */
    this.drilled = [];
    this.extraNew = 0;
    this.listeners = new Set();
    this.source = PHRASE_SOURCE;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  set(patch) {
    Object.assign(this.s, patch);
    for (const fn of this.listeners) fn(this.s);
  }

  /** Entering the tab: resume the last topic, or show the picker. */
  open() {
    let topic = null;
    try { topic = localStorage.getItem(TOPIC_SLOT); } catch { /* ignore */ }
    if (topic === "all") this.start(null);
    else if (topic && this.s.stats.topics.some((t) => t.id === topic)) this.start(topic);
    else this.showTopics();
  }

  showTopics() {
    try { localStorage.removeItem(TOPIC_SLOT); } catch { /* ignore */ }
    this.set({ view: "topics", stats: phraseTopics(load()), phrase: null, drill: null });
  }

  /**
   * Drill: a round of phrases you've met, outside the schedule (no FSRS).
   * @param {"shaky" | "topic"} kind  shaky = not mastered yet; topic = all met in `topic`
   * @param {string | null} topic
   */
  startDrill(kind, topic = this.s.topic, again = false) {
    const store = load();
    if (!again) this.drilled = [];
    let ids = phraseDrillSet(store, { kind, topic, exclude: this.drilled });
    // Run out of new ones: start over from the top.
    if (!ids.length && this.drilled.length) { this.drilled = []; ids = phraseDrillSet(store, { kind, topic }); }
    if (!ids.length) return;
    this.drilled.push(...ids);
    this.lastId = null;
    this.set({ topic, drill: startDrill(ids, { kind, topic }), score: { right: 0, seen: 0 } });
    this.deal();
  }

  /** Same kind of drill again (the next phrases, if there are more). */
  drillAgain() {
    const d = this.s.drill;
    if (d) this.startDrill(d.kind, d.topic, true);
  }

  endDrill() {
    this.set({ drill: null });
    this.deal();
  }

  /** @param {string | null} topic  null = review everything that's due */
  start(topic) {
    try { localStorage.setItem(TOPIC_SLOT, topic ?? "all"); } catch { /* ignore */ }
    this.lastId = null;
    this.set({ topic, score: { right: 0, seen: 0 }, drill: null });
    this.deal();
  }

  deal() {
    const store = load();
    if (this.s.drill) {
      const n = drillNext(this.s.drill, this.lastId);
      if (!n) { this.set({ view: "drill-done", phrase: null, stats: phraseTopics(store) }); return; }
      this.lastId = n.id;
      this.quiz(phraseById(n.id), n.kind);
      return;
    }
    const n = nextPhrase(store, { topic: this.s.topic, lastId: this.lastId, extraNew: this.extraNew });
    const stats = phraseTopics(store);
    if (!n.id) {
      this.set({ view: "empty", reason: n.reason, phrase: null, stats });
      return;
    }
    const phrase = phraseById(n.id);
    this.lastId = n.id;
    if (n.kind === "new") {
      this.set({ view: "intro", phrase, kind: "new", stats, result: null });
      if (speakEnabled()) speakPhrase(phrase);
    } else {
      this.quiz(phrase, "review", stats);
    }
  }

  /** Deal the card in the mode its record calls for (build / listen / say). */
  quiz(phrase, kind, stats = this.s.stats) {
    const c = phraseCard(load(), phrase.id, kind);
    this.set({
      view: "quiz", phrase, kind, mode: c.mode, stage: c.stage, stats,
      tiles: c.tiles ?? [], picked: [], choices: c.choices ?? [], answer: c.answer ?? null, chosen: null,
      revealed: false, result: null,
    });
    // Listening starts with the sound; it's the whole question.
    if (c.mode === "listen") speakPhrase(phrase);
  }

  /** Store a grade and update the session score. */
  grade(ok, extra = {}) {
    const { phrase, mode, kind, drill } = this.s;
    if (drill) {
      // Drilling never touches the schedule; it only counts as practice.
      update((s) => { logAnswer(s, { kind: "phrase", correct: ok, mode }); });
      const score = { right: this.s.score.right + (ok ? 1 : 0), seen: this.s.score.seen + 1 };
      this.set({ result: ok ? "ok" : "miss", score, drill: drillGrade(drill, phrase.id, ok) });
      return;
    }
    update((s) => {
      s.cards = { ...s.cards, [cardKey(phrase.id)]: gradePhrase(s, phrase.id, ok, Date.now(), { mode, ...extra }) };
      logAnswer(s, { kind: "phrase", correct: ok, mode, isNew: kind === "new" });
    });
    const score = { right: this.s.score.right + (ok ? 1 : 0), seen: this.s.score.seen + 1 };
    this.set({ result: ok ? "ok" : "miss", score });
  }

  /** Listening: pick a meaning. */
  choose(key) {
    if (this.s.mode !== "listen" || this.s.result) return;
    this.set({ chosen: key });
    this.grade(key === this.s.answer);
  }

  /** Say it: show the answer (and play it) after you've said it aloud. */
  reveal() {
    if (this.s.mode !== "say" || this.s.revealed) return;
    this.set({ revealed: true });
    speakPhrase(this.s.phrase);
  }

  /** Say it: grade yourself. @param {"again" | "hard" | "good" | "easy"} rating */
  rate(rating) {
    if (this.s.mode !== "say" || !this.s.revealed || this.s.result) return;
    this.grade(rating !== "again", { rating });
  }

  continueIntro() {
    if (this.s.phrase) this.quiz(this.s.phrase, "new");
  }

  pick(key) {
    if (this.s.result || this.s.picked.includes(key)) return;
    this.set({ picked: [...this.s.picked, key] });
  }

  unpick(key) {
    if (this.s.result) return;
    this.set({ picked: this.s.picked.filter((k) => k !== key) });
  }

  check() {
    const { phrase, picked, tiles, result } = this.s;
    if (!phrase || result || !picked.length) return;
    const texts = picked.map((k) => tiles.find((t) => t.key === k)?.text ?? "");
    const ok = checkPhrase(phrase.id, texts);
    this.grade(ok);
    if (speakEnabled()) speakPhrase(phrase);
  }

  next() { this.deal(); }

  /** Past today's new-phrase allowance, on purpose. */
  learnMore() {
    this.extraNew += 5;
    this.deal();
  }

  /** Another device's answers arrived. Only refresh when nothing is mid-card. */
  remoteChanged() {
    if (this.s.view === "topics") this.set({ stats: phraseTopics(load()) });
    else if (this.s.view === "empty" && !this.s.drill) this.deal();
  }
}
