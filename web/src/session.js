/**
 * Drill state machine — a straight port of macos/Sources/Session.swift so the
 * phone behaves exactly like the menu bar panel. All decisions go through the
 * shared engine (src/core/engine.mjs); this file only sequences them.
 */
import { invoke } from "../../src/core/engine.mjs";
import { load, save, update } from "./store.js";
import { logAnswer } from "../../src/core/activity.mjs";

const ROTE_STREAK = 3;
const now = () => Date.now();

export class Session {
  constructor() {
    this.s = {
      mode: "study", script: "hiragana", glyph: "", romaji: "", mnemonic: "", partner: "",
      answer: "", flash: "none", revealed: null,
      learned: 0, total: 104, mastered: 0, learning: 0, due: 0, reason: "due",
      learnIndex: 0, learnTotal: 0, roteDone: 0, roteTotal: 0,
      hint: null, emptyMessage: null, scoreCorrect: 0, scoreSeen: 0, engineError: null,
      focusNonce: 0, showSettings: false, chart: [],
      dakutenMark: "゛", dakutenKind: "rule", dakutenVoiced: "", dakutenVoicedRomaji: "",
      dakutenCaption: "", dakutenPromptIsKana: false, dakutenExampleFrom: "", dakutenLessonId: "",
      drillPicker: false, drillSets: [], cram: false,
      progress: null, progressMonth: null, progressDay: null,
    };
    this.learnGlyphs = [];
    this.pendingRote = [];
    this.returnToChart = false;
    this.lastGlyph = null;
    this.busy = false;
    this.activeDrill = null;
    this.practiceDay = "";
    this.sessionGood = {};
    this.flashTimer = null;
    this.listeners = new Set();
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  set(patch) {
    Object.assign(this.s, patch);
    for (const fn of this.listeners) fn(this.s);
  }

  get headerMode() {
    const { mode, cram } = this.s;
    if (mode === "rote") return cram ? "study" : "learn";
    return mode;
  }

  requestFocus() {
    this.set({ focusNonce: this.s.focusNonce + 1 });
    if (this.s.mode === "rote" && this.activeDrill && !this.busy) {
      const store = load();
      if (this.restoreDrillProgress(store)) this.dealRote(store);
    }
  }

  /** Another device's answers arrived. Refresh what's on screen if we're idle. */
  remoteChanged() {
    if (this.busy || this.s.answer || this.s.showSettings) return;
    // First sync on a fresh device: start over from the deck that just arrived.
    if (this.s.learned === 0) return this.appear();
    const store = load();
    switch (this.s.mode) {
      case "chart": this.refreshSummary(store); this.refreshChart(store); break;
      case "progress": this.refreshProgress(store); break;
      case "study": if (!this.s.drillPicker) this.dealStudy(store); else this.refreshSummary(store); break;
      case "rote": this.activeDrill = store.activeDrill || this.activeDrill; this.dealRote(store); break;
      default: this.refreshSummary(store);
    }
  }

  cancelFeedback() {
    clearTimeout(this.flashTimer);
    this.flashTimer = null;
    this.busy = false;
    this.set({ flash: "none", revealed: null, answer: "" });
  }

  restoreDrillProgress(store) {
    if (!this.activeDrill) return false;
    const progress = invoke("drillProgress", { store, key: this.activeDrill, now: now() });
    if (!progress || progress.error) return false;
    const changed = progress.date !== this.practiceDay;
    this.practiceDay = progress.date;
    this.sessionGood = { ...(progress.streaks || {}) };
    this.set({ scoreCorrect: progress.correct || 0, scoreSeen: progress.seen || 0 });
    return changed;
  }

  appear() {
    let store = load();
    const prepared = invoke("prepare", { store });
    if (prepared?.store) {
      if (prepared.changed) save(prepared.store);
      store = prepared.store;
    }
    const script = invoke("resolveScript", { store }) || this.s.script;
    this.set({ script });
    this.refreshSummary(store);
    if (this.s.learned === 0) {
      this.set({ mode: "learn" });
      this.startLearn(store);
    } else if ((store.rote || []).length > 0) {
      this.activeDrill = typeof store.activeDrill === "string" ? store.activeDrill : null;
      this.set({ mode: "rote", cram: store.roteKind === "cram" });
      this.restoreDrillProgress(store);
      this.dealRote(store);
    } else {
      this.set({ mode: "study" });
      this.dealStudy(store);
    }
  }

  setMode(next) {
    this.cancelFeedback();
    this.activeDrill = null;
    this.sessionGood = {};
    const target = next === "rote" ? "learn" : next;
    this.lastGlyph = null;
    this.pendingRote = [];
    this.returnToChart = false;
    this.set({ answer: "", flash: "none", revealed: null, hint: null, emptyMessage: null, drillPicker: false });
    const store = load();
    switch (target) {
      case "learn": {
        const kind = store.roteKind;
        if ((store.rote || []).length > 0 && kind !== "cram") {
          this.set({ cram: false, mode: "rote" });
          this.dealRote(store);
        } else {
          if (kind === "cram") update((s) => { s.rote = []; s.roteKind = null; s.activeDrill = null; });
          this.set({ cram: false, mode: "learn" });
          this.startLearn(load());
        }
        break;
      }
      case "study":
        this.set({ mode: "study" });
        this.dealStudy(store);
        break;
      case "dakuten":
        this.set({ mode: "dakuten" });
        this.dealDakuten();
        break;
      case "phrases":
        this.set({ mode: "phrases" });
        break;
      case "chart":
        this.set({ mode: "chart" });
        this.refreshSummary(store);
        this.refreshChart(store);
        break;
      case "progress":
        this.set({ mode: "progress", progressDay: null });
        this.refreshProgress(store);
        break;
    }
  }

  /** Progress tab: practice calendar + where everything stands. */
  refreshProgress(store = load()) {
    const at = this.s.progressMonth;
    this.set({ progress: invoke("progressView", { store, now: now(), ...(at || {}) }) });
  }

  /** Step the calendar a month back (-1) or forward (+1); never past this month. */
  shiftProgressMonth(delta) {
    const cur = this.s.progress?.month;
    if (!cur) return;
    let y = cur.year, m = cur.month + delta;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    const today = new Date();
    if (y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth() + 1)) return;
    this.set({ progressMonth: { year: y, month: m }, progressDay: null });
    this.refreshProgress();
  }

  /** Tap a day: its breakdown (tap again to close). */
  pickProgressDay(date) {
    if (this.s.progressDay?.date === date) return this.set({ progressDay: null });
    this.set({ progressDay: invoke("activityDay", { store: load(), date }) });
  }

  setScript(next) {
    if (next === this.s.script) return;
    this.set({ script: next });
    update((s) => { s.config = { ...s.config, script: next }; });
    this.lastGlyph = null;
    this.learnGlyphs = [];
    this.sessionGood = {};
    this.setMode(this.headerMode);
  }

  setAnswer(answer) { this.set({ answer }); }
  openSettings() { this.set({ showSettings: true }); }
  closeSettings() {
    this.set({ showSettings: false });
    this.remoteChanged(); // pick up anything a sign-in or sync pulled in meanwhile
  }

  later(ms, fn) {
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(fn, ms);
  }

  submit() {
    const { mode } = this.s;
    if (mode === "learn") return this.continueLearn();
    if (mode === "dakuten") return this.submitDakuten();
    if (this.busy) return;
    const typed = this.s.answer.trim();
    const { glyph, script, romaji } = this.s;
    if (!typed || !glyph) return;
    const store = load();
    const ok = invoke("check", { script, glyph, input: typed }) === true;

    // Rote: local streaks only. FSRS writes on hits would fake long-term memory.
    if (mode === "rote") {
      this.restoreDrillProgress(store);
      this.busy = true;
      this.sessionGood[glyph] = ok ? (this.sessionGood[glyph] || 0) + 1 : 0;
      this.set({
        scoreSeen: this.s.scoreSeen + 1,
        scoreCorrect: this.s.scoreCorrect + (ok ? 1 : 0),
        flash: ok ? "ok" : "miss",
        revealed: ok ? null : romaji,
      });
      if (this.activeDrill) {
        const key = this.activeDrill;
        const saved = update((s) => {
          const r = invoke("gradeDrill", { store: s, key, glyph, correct: ok, now: now() });
          if (r?.store) Object.assign(s, r.store);
          logAnswer(s, { kind: "kana", correct: ok });
        });
        this.restoreDrillProgress(saved);
      } else {
        update((s) => { logAnswer(s, { kind: "kana", correct: ok }); });
      }
      this.refreshRoteCounts(store);
      this.later(ok ? 400 : 1200, () => {
        this.busy = false;
        this.set({ flash: "none", revealed: null, answer: "" });
        if (this.allRoteSticking()) this.confirmConfident();
        else this.dealRote(load());
      });
      return;
    }

    const card = invoke("grade", { script, glyph, store, correct: ok, now: now() });
    update((s) => {
      if (card && !card.error) s.cards = { ...s.cards, [glyph]: card };
      logAnswer(s, { kind: "kana", correct: ok });
    });
    this.busy = true;
    this.set({
      scoreSeen: this.s.scoreSeen + 1,
      scoreCorrect: this.s.scoreCorrect + (ok ? 1 : 0),
      flash: ok ? "ok" : "miss",
      revealed: ok ? null : romaji,
    });
    this.later(ok ? 450 : 1250, () => {
      this.busy = false;
      this.set({ flash: "none", revealed: null, answer: "" });
      this.dealStudy(load());
    });
  }

  continueLearn() {
    if (!this.learnGlyphs.length) return;
    if (this.s.learnIndex + 1 < this.learnGlyphs.length) {
      this.set({ learnIndex: this.s.learnIndex + 1 });
      this.showLearn();
      return;
    }
    const rote = this.pendingRote.length ? this.pendingRote : this.learnGlyphs;
    const kind = this.pendingRote.length ? "cram" : "row";
    this.pendingRote = [];
    update((s) => {
      s.learned = [...new Set([...(s.learned || []), ...rote])];
      s.rote = rote;
      s.roteKind = kind;
      s.activeDrill = null;
    });
    this.learnGlyphs = [];
    this.sessionGood = {};
    this.activeDrill = null;
    this.set({ cram: kind === "cram", mode: "rote", hint: "rote until they stick" });
    this.dealRote(load());
  }

  /** Graduate the rote set onto the FSRS schedule (one Good each, first time). */
  confirmConfident() {
    this.cancelFeedback();
    const t = now();
    const script = this.s.script;
    update((s) => {
      const cards = { ...(s.cards || {}) };
      for (const g of s.rote || []) {
        if (!cards[g] || !cards[g].seen) {
          const card = invoke("grade", { script, glyph: g, store: s, correct: true, now: t });
          if (card && !card.error) cards[g] = card;
        }
      }
      s.cards = cards;
      s.rote = [];
      s.roteKind = null;
      s.activeDrill = null;
    });
    this.activeDrill = null;
    this.sessionGood = {};
    const back = this.returnToChart;
    this.returnToChart = false;
    if (back) {
      this.set({ cram: false, mode: "chart", hint: null, emptyMessage: null, glyph: "" });
      const store = load();
      this.refreshSummary(store);
      this.refreshChart(store);
    } else {
      this.set({ cram: false, mode: "study", hint: "on the schedule" });
      this.dealStudy(load());
    }
  }

  roteShaky() {
    this.cancelFeedback();
    this.activeDrill = null;
    update((s) => { s.rote = []; s.roteKind = "cram"; s.activeDrill = null; });
    this.sessionGood = {};
    this.set({ cram: true, mode: "rote", showSettings: false });
    this.dealRote(load());
  }

  openDrillPicker() {
    this.cancelFeedback();
    const raw = invoke("drillSets", { store: load(), script: this.s.script, now: now() });
    const sets = Array.isArray(raw) ? raw : [];
    this.set({ answer: "", flash: "none", revealed: null, hint: null, glyph: "", drillSets: sets });
    if (!sets.length) this.set({ drillPicker: false, emptyMessage: "learn a row first" });
    else this.set({ drillPicker: true, emptyMessage: "drill which set?" });
  }

  pickDrillSet(id) {
    this.cancelFeedback();
    this.returnToChart = false;
    const r = invoke("beginDrill", { store: load(), script: this.s.script, id });
    if (!r?.store) return;
    save(r.store);
    this.activeDrill = r.store.activeDrill || null;
    this.restoreDrillProgress(r.store);
    this.lastGlyph = null;
    this.set({ drillPicker: false, emptyMessage: null, cram: true, mode: "rote", hint: "rote until they stick" });
    this.dealRote(load());
  }

  cancelDrillPicker() {
    this.set({ drillPicker: false, emptyMessage: null });
    this.setMode("study");
  }

  restartDrill() {
    if (this.s.mode !== "rote" || !this.activeDrill) return;
    this.cancelFeedback();
    const key = this.activeDrill;
    const store = update((s) => {
      // Restart only this set's streaks; keep today's score and other sets.
      const saved = { ...(s.drillProgress || {}) };
      saved[key] = { ...(saved[key] || {}), streaks: {} };
      s.drillProgress = saved;
    });
    this.sessionGood = {};
    this.lastGlyph = null;
    this.set({ drillPicker: false, emptyMessage: null });
    this.dealRote(store);
    this.requestFocus();
  }

  drillChartGlyphs(glyphs) {
    this.cancelFeedback();
    this.activeDrill = null;
    const list = glyphs.filter(Boolean);
    if (!list.length) return;
    const learned = new Set(load().learned || []);
    const fresh = list.filter((g) => !learned.has(g));
    this.lastGlyph = null;
    this.sessionGood = {};
    this.returnToChart = true;
    this.set({ answer: "", flash: "none", revealed: null, hint: null, emptyMessage: null, drillPicker: false });
    if (!fresh.length) return this.startCram(list);
    this.pendingRote = list;
    this.learnGlyphs = fresh;
    this.set({ cram: true, learnIndex: 0, learnTotal: fresh.length, mode: "learn" });
    this.showLearn();
  }

  startCram(glyphs) {
    const r = invoke("beginDrill", { store: load(), script: this.s.script, glyphs });
    if (!r?.store) return;
    save(r.store);
    this.activeDrill = r.store.activeDrill || null;
    this.restoreDrillProgress(r.store);
    this.lastGlyph = null;
    this.set({ cram: true, mode: "rote", hint: "rote until they stick" });
    this.dealRote(load());
  }

  applyMutate(op) {
    const r = invoke(op, { store: load(), script: this.s.script, now: now() });
    if (r?.store) save(r.store);
  }

  markAway() {
    this.cancelFeedback();
    this.activeDrill = null;
    this.applyMutate("markDueNow");
    this.set({ mode: "study", showSettings: false });
    this.dealStudy(load());
  }

  resetLearning() {
    this.cancelFeedback();
    this.activeDrill = null;
    this.applyMutate("resetLearning");
    this.sessionGood = {};
    this.set({ mode: "learn", showSettings: false });
    this.appear();
  }

  resetStudying() {
    this.cancelFeedback();
    this.activeDrill = null;
    this.applyMutate("resetStudying");
    this.sessionGood = {};
    this.set({ mode: "study", showSettings: false });
    this.appear();
  }

  resetCurrentScript() {
    this.cancelFeedback();
    this.activeDrill = null;
    const script = this.s.script;
    update((store) => {
      const rows = invoke("rows", { script }) || [];
      const drop = new Set(rows.flatMap((r) => r.glyphs));
      store.cards = Object.fromEntries(Object.entries(store.cards || {}).filter(([g]) => !drop.has(g)));
      store.learned = (store.learned || []).filter((g) => !drop.has(g));
      store.rote = [];
      store.roteKind = null;
      store.activeDrill = null;
      store.drillProgress = Object.fromEntries(
        Object.entries(store.drillProgress || {}).filter(([k]) => !k.startsWith(`${script}:`)),
      );
      store.dakutenStreaks = {};
    });
    this.sessionGood = {};
    this.set({ showSettings: false });
    this.appear();
  }

  startLearn(store) {
    this.set({ emptyMessage: null });
    const row = invoke("nextLearnRow", { store, script: this.s.script });
    if (!row?.glyphs?.length) {
      this.learnGlyphs = [];
      this.set({ emptyMessage: `every ${this.s.script} character is in your deck`, glyph: "", mnemonic: "", romaji: "", partner: "" });
      return;
    }
    this.learnGlyphs = row.glyphs;
    this.set({ learnIndex: 0, learnTotal: row.glyphs.length });
    this.showLearn();
  }

  showLearn() {
    const ch = this.learnGlyphs[this.s.learnIndex];
    if (!ch) return;
    const view = invoke("learnView", { script: this.s.script, glyph: ch }) || {};
    this.set({
      glyph: ch, romaji: view.romaji || "", partner: view.partner || "", mnemonic: view.mnemonic || "",
      emptyMessage: null, answer: "",
    });
  }

  dealRote(store) {
    this.restoreDrillProgress(store);
    this.refreshSummary(store);
    this.refreshRoteCounts(store);
    if (this.s.roteTotal > 0 && this.s.roteDone === this.s.roteTotal) {
      this.set({ glyph: "", emptyMessage: "set complete for today", hint: "daily practice resets at midnight" });
      return;
    }
    const card = invoke("nextRote", { store, script: this.s.script, streaks: this.sessionGood, lastGlyph: this.lastGlyph });
    if (!card?.glyph) {
      this.set({ mode: "study" });
      this.dealStudy(store);
      return;
    }
    this.lastGlyph = card.glyph;
    this.set({
      glyph: card.glyph, romaji: card.romaji || "", reason: "rote", mnemonic: "", partner: "",
      emptyMessage: null, hint: `${ROTE_STREAK} right in a row to stick`,
    });
  }

  dealStudy(store) {
    this.refreshSummary(store);
    const card = invoke("nextRevise", { store, script: this.s.script, now: now(), lastGlyph: this.lastGlyph });
    const reason = card?.reason || "caught-up";
    this.set({ reason, mnemonic: "", partner: "" });
    if (!card?.glyph) {
      this.set({ glyph: "", romaji: "" });
      if (reason === "empty" || this.s.learned === 0) {
        this.set({ mode: "learn" });
        this.startLearn(store);
      } else {
        this.set({ emptyMessage: "nothing due", hint: "reviews come back on the schedule" });
      }
      return;
    }
    this.lastGlyph = card.glyph;
    this.set({ emptyMessage: null, glyph: card.glyph, romaji: card.romaji || "", hint: null });
  }

  refreshRoteCounts(store) {
    const rote = store.rote || [];
    this.set({
      roteTotal: rote.length,
      roteDone: rote.filter((g) => (this.sessionGood[g] || 0) >= ROTE_STREAK).length,
    });
  }

  allRoteSticking() {
    const rote = load().rote || [];
    return rote.length > 0 && rote.every((g) => (this.sessionGood[g] || 0) >= ROTE_STREAK);
  }

  submitDakuten() {
    if (this.busy) return;
    const typed = this.s.answer.trim();
    if (!typed || !this.s.glyph) return;
    const ok = invoke("checkDakuten", { id: this.s.dakutenLessonId, input: typed }) === true;
    const streaks = load().dakutenStreaks || {};
    const next = invoke("gradeDakuten", { streaks, id: this.s.dakutenLessonId, correct: ok });
    update((s) => {
      if (next && !next.error) s.dakutenStreaks = next;
      logAnswer(s, { kind: "kana", correct: ok });
    });
    this.busy = true;
    this.set({
      scoreSeen: this.s.scoreSeen + 1,
      scoreCorrect: this.s.scoreCorrect + (ok ? 1 : 0),
      flash: ok ? "ok" : "miss",
      revealed: this.s.dakutenVoicedRomaji,
    });
    this.later(ok ? 500 : 1350, () => {
      this.busy = false;
      this.set({ flash: "none", revealed: null, answer: "" });
      this.dealDakuten();
    });
  }

  confirmDakuten() {
    this.cancelFeedback();
    const done = invoke("completeDakuten");
    if (done && !done.error) update((s) => { s.dakutenStreaks = done; });
    this.set({ emptyMessage: "these marks are sticking", glyph: "", hint: null, roteDone: this.s.roteTotal });
  }

  drillAllDakuten() {
    this.cancelFeedback();
    update((s) => { s.dakutenStreaks = {}; });
    this.set({ dakutenLessonId: "", emptyMessage: null, drillPicker: false, hint: `${ROTE_STREAK} right in a row to stick` });
    this.dealDakuten();
  }

  dealDakuten() {
    const streaks = load().dakutenStreaks || {};
    const card = invoke("nextDakuten", { streaks, force: false, lastId: this.s.dakutenLessonId || null });
    if (!card || card.error) return;
    this.set({ roteDone: card.sticking || 0, roteTotal: card.size || 0 });
    if (card.done) {
      this.set({ emptyMessage: "these marks are sticking", glyph: "", hint: null });
      return;
    }
    this.set({
      emptyMessage: null,
      dakutenLessonId: card.id || "",
      dakutenKind: card.kind || "rule",
      dakutenMark: card.mark || "゛",
      glyph: card.prompt || "",
      romaji: card.promptRomaji || "",
      dakutenVoicedRomaji: card.reveal || "",
      dakutenVoiced: card.exampleTo || "",
      dakutenExampleFrom: card.exampleFrom || "",
      dakutenCaption: card.caption || "",
      dakutenPromptIsKana: !!card.promptIsKana,
      partner: card.exampleTo || "",
      mnemonic: "",
      hint: `${ROTE_STREAK} right in a row to stick`,
    });
  }

  refreshChart(store = load()) {
    const raw = invoke("chart", { store, script: this.s.script, now: now() });
    this.set({ chart: Array.isArray(raw) ? raw : [] });
  }

  refreshSummary(store) {
    const s = invoke("summary", { store, script: this.s.script, now: now() });
    if (!s || s.error) return;
    this.set({ learned: s.learned, total: s.total, mastered: s.mastered, learning: s.learning, due: s.due });
  }
}
