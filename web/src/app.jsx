import { useEffect, useRef, useState } from "preact/hooks";
import { PHRASE_SOURCE, VOICES } from "../../src/core/phrases.mjs";
import { setSpeakEnabled, setVoicePref, speakEnabled, speakPhrase, voicePref } from "./phrase-session.js";
import { accountEmail, authenticate, onStatus, pair, syncAvailable, syncKey, syncNow, unpair } from "./cloud.js";

const FONTS = [
  { id: "bundled", label: "Noto Sans", detail: "ships with kanthropic", css: "'Kana', 'Hiragino Sans', sans-serif" },
  { id: "gothic", label: "Gothic", detail: "Hiragino Sans — print, easy to read", css: "'Hiragino Sans', 'Kana', sans-serif" },
  { id: "rounded", label: "Rounded", detail: "Maru Gothic", css: "'Hiragino Maru Gothic ProN', 'Kana', sans-serif" },
  { id: "mincho", label: "Mincho", detail: "serif — the brushy one", css: "'Hiragino Mincho ProN', 'Yu Mincho', serif" },
];
const FONT_SLOT = "kanthropic:font";
const KEYBOARD_SLOT = "kanthropic:keyboard";

/** "auto" shows the on-screen keyboard on touchscreens only. */
function useKeyboardPref() {
  const read = () => { try { return localStorage.getItem(KEYBOARD_SLOT) || "auto"; } catch { return "auto"; } };
  const [pref, setPref] = useState(read);
  useEffect(() => {
    const on = () => setPref(read());
    window.addEventListener("kanthropic:keyboard", on);
    return () => window.removeEventListener("kanthropic:keyboard", on);
  }, []);
  const set = (v) => {
    try { localStorage.setItem(KEYBOARD_SLOT, v); } catch { /* ignore */ }
    window.dispatchEvent(new Event("kanthropic:keyboard"));
  };
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return { pref, set, onScreen: pref === "on" || (pref === "auto" && touch) };
}

const isTyping = (s) => (s.mode === "study" || s.mode === "rote" || s.mode === "dakuten") && !s.emptyMessage && !s.drillPicker;

function useSession(session) {
  const [, tick] = useState(0);
  useEffect(() => session.subscribe(() => tick((n) => n + 1)), [session]);
  return session.s;
}

function useFont() {
  const [id, setId] = useState(() => {
    try { return localStorage.getItem(FONT_SLOT) || "bundled"; } catch { return "bundled"; }
  });
  useEffect(() => {
    const face = FONTS.find((f) => f.id === id) || FONTS[0];
    document.documentElement.style.setProperty("--kana", face.css);
    try { localStorage.setItem(FONT_SLOT, id); } catch { /* ignore */ }
  }, [id]);
  return [id, setId];
}

export function App({ session, phrases }) {
  const s = useSession(session);
  const [font, setFont] = useFont();
  return s.showSettings
    ? <Settings session={session} s={s} font={font} setFont={setFont} />
    : <Drill session={session} s={s} phrases={phrases} />;
}

function Drill({ session, s, phrases }) {
  const head = session.headerMode;
  const { onScreen } = useKeyboardPref();
  const keys = onScreen && s.mode !== "chart" && s.mode !== "phrases" && s.mode !== "progress" && isTyping(s);
  return (
    <main class={`panel ${keys ? "with-keys" : ""}`}>
      <header class="bar">
        <Tab on={head === "learn"} onClick={() => session.setMode("learn")}>learn</Tab>
        <Tab on={head === "study"} onClick={() => session.setMode("study")}>study</Tab>
        <Tab on={head === "phrases"} onClick={() => { session.setMode("phrases"); phrases.open(); }}>phrases</Tab>
        <button class={`icon mark ${head === "dakuten" ? "on" : ""}`} aria-label="Dakuten" onClick={() => session.setMode("dakuten")}>゛</button>
        <button class={`icon ${head === "chart" ? "on" : ""}`} aria-label="Chart" onClick={() => session.setMode("chart")}><GridIcon /></button>
        <button class={`icon ${head === "progress" ? "on" : ""}`} aria-label="Progress" onClick={() => session.setMode("progress")}><CalendarIcon /></button>
        <span class="grow" />
        <button class={`kana-btn ${s.script === "hiragana" ? "on" : ""}`} onClick={() => session.setScript("hiragana")}>あ</button>
        <span class="slash">/</span>
        <button class={`kana-btn ${s.script === "katakana" ? "on" : ""}`} onClick={() => session.setScript("katakana")}>ア</button>
        <button class="icon" aria-label="Settings" onClick={() => session.openSettings()}><GearIcon /></button>
        <SyncDot onClick={() => session.openSettings()} />
      </header>
      {s.mode === "phrases" ? <Phrases ps={phrases} /> : s.mode === "chart" ? <Chart session={session} s={s} />
        : s.mode === "progress" ? <Progress session={session} s={s} /> : (
        <>
          <Card s={s} />
          <Input session={session} s={s} onScreen={onScreen} />
          <Footer session={session} s={s} />
          {keys && <Keyboard session={session} s={s} />}
        </>
      )}
    </main>
  );
}

function Tab({ on, onClick, children }) {
  return <button class={`tab ${on ? "on" : ""}`} onClick={onClick}>{children}</button>;
}

function Card({ s }) {
  const spine = s.flash === "ok" ? "var(--ok)" : s.flash === "miss" ? "var(--miss)" : "var(--gold)";
  let body;
  if (s.emptyMessage) body = <p class="empty">{s.emptyMessage}</p>;
  else if (s.mode === "dakuten") body = <Dakuten s={s} />;
  else {
    body = (
      <>
        <div class="glyph" key={s.glyph}>{s.glyph}</div>
        {s.mode === "learn" ? (
          <>
            <div class="reading"><span class="romaji gold">{s.romaji}</span><span class="partner">{s.partner}</span></div>
            <p class="mnemonic">{s.mnemonic}</p>
          </>
        ) : s.revealed ? <div class="romaji miss">{s.revealed}</div> : null}
      </>
    );
  }
  return (
    <section class="card">
      <div class="spine" style={{ background: spine }} />
      <div class="card-body">{body}</div>
    </section>
  );
}

function Dakuten({ s }) {
  const color = s.flash === "ok" ? "var(--ok)" : "var(--miss)";
  return (
    <div class="dakuten">
      {s.dakutenKind === "exception" && <div class="label gold">exception</div>}
      <div class="dak-row">
        <span class="dak-prompt">
          <span class={s.dakutenPromptIsKana ? "glyph sm" : "serif"}>{s.glyph}</span>
          <span class="dak-mark">{s.dakutenMark}</span>
        </span>
        <span class="arrow">→</span>
        {s.revealed != null
          ? <span class="serif reveal" style={{ color }}>{s.dakutenVoicedRomaji}</span>
          : <span class="qmark">?</span>}
      </div>
      {s.dakutenPromptIsKana && s.romaji && <div class="romaji gold">{s.romaji}</div>}
      {s.revealed != null && (
        <div class="dak-example">
          <span class="kana">{s.dakutenExampleFrom}</span>
          <span class="arrow">→</span>
          <span class="kana" style={{ color }}>{s.dakutenVoiced}</span>
          {s.dakutenCaption && <span class="caption">{s.dakutenCaption}</span>}
        </div>
      )}
    </div>
  );
}

function Input({ session, s, onScreen }) {
  const ref = useRef(null);
  const typing = isTyping(s);
  useEffect(() => {
    if (typing && !onScreen) ref.current?.focus({ preventScroll: true });
  }, [typing, onScreen, s.glyph, s.focusNonce]);

  if (s.drillPicker) {
    return (
      <section class="actions">
        <p class="note">Saved today · resets at midnight</p>
        {s.drillSets.map((set) => (
          <Action key={set.id} title={set.label} detail={`${set.done}/${set.count} today`} onClick={() => session.pickDrillSet(set.id)} />
        ))}
        <button class="back" onClick={() => session.cancelDrillPicker()}>back</button>
      </section>
    );
  }
  if (typing) {
    return (
      <section class="actions">
        {onScreen ? (
          <div class={`answer display ${s.flash === "miss" ? "miss" : ""}`} aria-label="romaji" aria-live="polite">
            {s.answer || <span class="placeholder">romaji</span>}<span class="caret" />
          </div>
        ) : <form onSubmit={(e) => { e.preventDefault(); session.submit(); }}>
          <input
            ref={ref}
            class={`answer ${s.flash === "miss" ? "miss" : ""}`}
            value={s.answer}
            onInput={(e) => session.setAnswer(e.currentTarget.value)}
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck={false}
            enterkeyhint="go" inputmode="text" aria-label="romaji"
            placeholder="romaji"
          />
        </form>}
        {(s.mode === "rote" || s.mode === "dakuten") && (
          <Action
            title={s.roteTotal > 0 ? `i'm confident  ${s.roteDone}/${s.roteTotal}` : "i'm confident"}
            detail={s.mode === "dakuten" ? "got the marks" : "schedule reviews"}
            onClick={() => (s.mode === "dakuten" ? session.confirmDakuten() : session.confirmConfident())}
          />
        )}
        {s.mode === "study" && <Action title="drill all" detail="pick a set" onClick={() => session.openDrillPicker()} />}
        {s.mode === "dakuten" && <Action title="drill all" detail="start over" onClick={() => session.drillAllDakuten()} />}
      </section>
    );
  }
  if (s.mode === "learn" && !s.emptyMessage) {
    return (
      <section class="actions">
        <button class="continue" onClick={() => session.continueLearn()}>
          <span>{s.learnTotal > 0 ? `continue  ${s.learnIndex + 1}/${s.learnTotal}` : "continue"}</span>
          <span class="detail">tap</span>
        </button>
      </section>
    );
  }
  return <section class="actions"><EmptyActions session={session} s={s} /></section>;
}

function EmptyActions({ session, s }) {
  if (s.emptyMessage === "set complete for today") {
    return (
      <>
        <Action title="drill now" detail="another round" onClick={() => session.restartDrill()} />
        <Action title="choose another set" onClick={() => session.openDrillPicker()} />
        <Action title="scheduled reviews" onClick={() => session.setMode("study")} />
      </>
    );
  }
  if (s.mode === "dakuten" && s.emptyMessage === "these marks are sticking") {
    return (
      <>
        <p class="note">three in a row on each rule — the marks are sticking</p>
        <Action title="drill all" detail="the whole set" onClick={() => session.drillAllDakuten()} />
      </>
    );
  }
  if (s.mode === "study" && s.emptyMessage === "nothing due") {
    return (
      <>
        <p class="note">reviews come back when they’re due — that’s the point</p>
        {s.learned > 0 && <Action title="drill all" detail="pick a set" onClick={() => session.openDrillPicker()} />}
        <Action title="learn next row" onClick={() => session.setMode("learn")} />
        {s.learning > 0 && <Action title="rote the shaky ones" onClick={() => session.roteShaky()} />}
        <Action title="i've been away" onClick={() => session.markAway()} />
      </>
    );
  }
  return (
    <>
      {s.learned > 0 && <Action title="drill all" detail="pick a set" onClick={() => session.openDrillPicker()} />}
      <Action title="learn the next row" onClick={() => session.setMode("learn")} />
    </>
  );
}

function Action({ title, detail, onClick }) {
  return (
    <button class="action" onClick={onClick}>
      <span>{title}</span>
      {detail && <span class="detail">{detail}</span>}
    </button>
  );
}

function Footer({ session, s }) {
  const progress = s.total > 0 ? Math.min(1, s.learned / s.total) : 0;
  let right = null;
  if (s.mode === "rote" || s.mode === "dakuten") right = <span class="mono gold">{s.roteDone}/{s.roteTotal} sticking</span>;
  else if (s.mode !== "learn" && s.hint) right = <button class="hint" onClick={() => session.setMode("learn")}>{s.hint}</button>;
  return (
    <footer class="foot">
      <div class="track"><div class="fill" style={{ width: `${progress * 100}%` }} /></div>
      <div class="foot-row">
        <span class="mono">{s.learned}/{s.total}</span>
        {s.scoreSeen > 0 && <span class="mono">{s.scoreCorrect}/{s.scoreSeen}</span>}
        <span class="grow" />
        {right}
      </div>
      {s.engineError && <p class="mono miss">{s.engineError}</p>}
    </footer>
  );
}

function Chart({ session, s }) {
  const glyphs = (rows) => rows.flatMap((r) => r.filter((c) => !c.empty).map((c) => c.glyph));
  return (
    <section class="chart">
      <div class="legend">
        <Dot label="new" color="var(--mute-soft)" />
        <Dot label="learning" color="var(--gold)" />
        <Dot label="due" color="var(--miss)" />
        <Dot label="mastered" color="var(--ok)" />
        <span class="grow" />
        <span class="mono">{s.mastered}/{s.total}</span>
      </div>
      <p class="note">tap a row to drill it</p>
      <div class="chart-scroll">
        {s.chart.map((section) => (
          <div class="family" key={section.id}>
            <button class="family-head" onClick={() => session.drillChartGlyphs(glyphs(section.rows))}>
              <span>{section.label}</span><PlayIcon />
            </button>
            {section.rows.map((row, i) => (
              <button class="chart-row" key={i} disabled={!glyphs([row]).length} onClick={() => session.drillChartGlyphs(glyphs([row]))}>
                {row.map((cell, j) => (
                  <span key={j} class={`cell ${cell.empty ? "blank" : cell.status}`} title={cell.empty ? "" : `${cell.glyph}  ${cell.romaji}  ·  ${cell.status}`}>
                    {cell.empty ? "" : cell.glyph}
                  </span>
                ))}
                <PlayIcon />
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

const fmt = (ms) => {
  const m = Math.round((ms || 0) / 60_000);
  if (!ms) return "0m";
  if (m < 1) return "<1m";
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "–");
const longDate = (date) => new Date(`${date}T12:00`).toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" });

/** Practice time, streaks and a month calendar, plus where kana and phrases stand. */
function Progress({ session, s }) {
  const v = s.progress;
  if (!v) return null;
  const { summary: sum, month, kana, phrases } = v;
  const today = sum.today;
  const ring = Math.min(1, today.ms / today.goalMs);
  const now = new Date();
  const atThisMonth = month.year === now.getFullYear() && month.month === now.getMonth() + 1;
  const day = s.progressDay;
  return (
    <section class="progress chart-scroll">
      <div class="today">
        <svg class="ring" viewBox="0 0 44 44" width="64" height="64">
          <circle cx="22" cy="22" r="19" class="ring-track" />
          <circle cx="22" cy="22" r="19" class={`ring-fill ${today.goalMet ? "met" : ""}`}
            stroke-dasharray={`${ring * 119.4} 119.4`} transform="rotate(-90 22 22)" />
        </svg>
        <div class="today-text">
          <div class="label">today</div>
          <div class="today-time">{fmt(today.ms)}<span class="mute"> / {sum.goalMin}m</span></div>
          <div class="note">{today.answers ? `${today.answers} answers · ${pct(today.correct, today.answers)} right` : "nothing yet today"}</div>
        </div>
        <div class="streak">
          <div class="streak-n">{sum.streak}</div>
          <div class="note">day streak</div>
        </div>
      </div>

      <div class="stat-row">
        <Stat n={fmt(sum.week.ms)} label="last 7 days" detail={`${sum.week.days}/7 days`} />
        <Stat n={fmt(sum.all.ms)} label="all time" detail={`${sum.all.days} days`} />
        <Stat n={sum.best} label="best streak" detail="days" />
      </div>

      <div class="cal">
        <div class="cal-head">
          <button class="cal-nav" aria-label="previous month" onClick={() => session.shiftProgressMonth(-1)}>‹</button>
          <span class="cal-title">{month.label}</span>
          <button class="cal-nav" aria-label="next month" disabled={atThisMonth} onClick={() => session.shiftProgressMonth(1)}>›</button>
        </div>
        <div class="cal-grid">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span class="cal-dow" key={i}>{d}</span>)}
          {month.weeks.flat().map((c) => (
            <button key={c.date} class={`cal-day l${c.level} ${c.inMonth ? "" : "out"} ${c.today ? "today" : ""} ${day?.date === c.date ? "picked" : ""}`}
              disabled={c.future || !c.inMonth} title={c.ms ? `${c.date}: ${fmt(c.ms)}` : c.date}
              onClick={() => session.pickProgressDay(c.date)}>
              {c.day}
            </button>
          ))}
        </div>
        <div class="cal-foot">
          <span class="note">{month.total.days ? `${month.total.days} days · ${fmt(month.total.ms)} this month` : "no practice this month"}</span>
          <span class="cal-key">less{[0, 1, 2, 3, 4].map((l) => <i key={l} class={`l${l}`} />)}goal</span>
        </div>
        {day && (
          <div class="day-detail">
            <div class="label">{longDate(day.date)}</div>
            {day.answers ? (
              <div class="day-grid">
                <span>time</span><b>{fmt(day.ms)}</b>
                <span>answers</span><b>{day.answers} · {pct(day.correct, day.answers)} right</b>
                {day.kana > 0 && <><span>kana</span><b>{day.kana}</b></>}
                {day.phrases > 0 && <><span>phrases</span><b>{day.phrases}{day.newPhrases ? ` · ${day.newPhrases} new` : ""}</b></>}
                {day.phrases > 0 && <><span>modes</span><b>{day.built} built · {day.listened} heard · {day.said} said</b></>}
              </div>
            ) : <p class="note">no practice</p>}
          </div>
        )}
      </div>

      <div class="standing">
        <div class="label">where you are</div>
        <Bar label="hiragana" n={kana.hiragana.mastered} of={kana.hiragana.total} detail={`${kana.hiragana.learned} learned`} />
        <Bar label="katakana" n={kana.katakana.mastered} of={kana.katakana.total} detail={`${kana.katakana.learned} learned`} />
        <Bar label="phrases" n={phrases.mastered} of={phrases.total} detail={`${phrases.met} met · ${phrases.speaking} speaking`} />
        <p class="note">bars show mastered: right on separate days and on a long interval</p>
      </div>
    </section>
  );
}

function Stat({ n, label, detail }) {
  return (
    <div class="stat">
      <div class="stat-n">{n}</div>
      <div class="stat-label">{label}</div>
      <div class="note">{detail}</div>
    </div>
  );
}

function Bar({ label, n, of, detail }) {
  return (
    <div class="bar-row">
      <div class="bar-top"><span>{label}</span><span class="mono">{n}/{of}</span></div>
      <div class="bar-track"><span style={{ width: `${of ? (n / of) * 100 : 0}%` }} /></div>
      <div class="note">{detail}</div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3">
      <rect x="1.5" y="2.5" width="13" height="12" rx="2" /><path d="M1.5 6.5h13M5 1v3M11 1v3" />
      <path d="M4.5 9.5h1M7.5 9.5h1M10.5 9.5h1M4.5 12h1M7.5 12h1" stroke-linecap="round" />
    </svg>
  );
}

function Dot({ label, color }) {
  return <span class="dot-label"><span class="dot" style={{ background: color }} />{label}</span>;
}

function SyncDot({ onClick }) {
  const [st, setSt] = useState({ state: "off" });
  useEffect(() => onStatus(setSt), []);
  const color = { ok: "var(--ok)", syncing: "var(--gold)", error: "var(--miss)", offline: "var(--mute-soft)" }[st.state] || "transparent";
  const title = { ok: "synced", syncing: "syncing…", error: `sync error: ${st.error}`, offline: "offline — will sync later", off: "sync off" }[st.state];
  return (
    <button class="sync-hit" aria-label={title} title={title} onClick={onClick}>
      <span class="sync-dot" style={{ background: color, borderColor: st.state === "off" ? "var(--miss)" : color }} />
    </button>
  );
}

function Settings({ session, s, font, setFont }) {
  const confirmThen = (msg, fn) => () => { if (window.confirm(msg)) fn(); };
  return (
    <main class="panel settings">
      <header class="bar">
        <button class="back-link" onClick={() => session.closeSettings()}>‹ drill</button>
        <span class="grow" />
        <span class="label">settings</span>
      </header>
      <div class="settings-scroll">
        <SyncSettings onPaired={() => session.appear()} />
        <hr />
        <KeyboardSetting />
        <hr />
        <SpeakSetting />
        <hr />
        <div class="label">Font</div>
        {FONTS.map((f) => (
          <button class="row" key={f.id} onClick={() => setFont(f.id)}>
            <span class="font-sample" style={{ fontFamily: f.css }}>ふ</span>
            <span class="row-text"><span class="row-title">{f.label}</span><span class="row-detail">{f.detail}</span></span>
            {font === f.id && <span class="gold">✓</span>}
          </button>
        ))}
        <hr />
        <div class="label">Deck</div>
        <DeckAction title="I've been away" detail="Every introduced card is due today. A miss sends it back to learning."
          onClick={confirmThen(`Puts every introduced ${s.script} card due today. History stays.`, () => session.markAway())} />
        <DeckAction title="Reset learning…" detail="Un-mastered characters go back to new. Walk the mnemonics again."
          onClick={confirmThen("Characters you haven't mastered go back to new. Mastered ones stay.", () => session.resetLearning())} />
        <DeckAction title="Reset studying…" detail="Wipe review history. Keep which characters you've met."
          onClick={confirmThen(`Wipes FSRS review history for ${s.script}. Introductions stay.`, () => session.resetStudying())} />
        <DeckAction title="Reset everything…" detail="Forget this script entirely." destructive
          onClick={confirmThen(`Reset ${s.script}? Forgets every card in this script — on every synced device.`, () => session.resetCurrentScript())} />
      </div>
    </main>
  );
}

function DeckAction({ title, detail, destructive, onClick }) {
  return (
    <button class="row deck" onClick={onClick}>
      <span class="row-text">
        <span class={`row-title ${destructive ? "miss" : ""}`}>{title}</span>
        <span class="row-detail">{detail}</span>
      </span>
    </button>
  );
}

function SyncSettings({ onPaired }) {
  const [key, setKey] = useState(syncKey());
  const [st, setSt] = useState({ state: "off" });
  const [shown, setShown] = useState(false);
  useEffect(() => onStatus(setSt), []);

  if (!syncAvailable()) {
    return <p class="note">Sync isn't configured in this build (no VITE_CONVEX_URL).</p>;
  }
  if (!key) return <AccountForm onDone={(k) => { setKey(k); onPaired(); }} />;
  const when = st.at ? new Date(st.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—";
  const link = `${location.origin}${location.pathname}#pair=${encodeURIComponent(key)}`;
  return (
    <>
      <div class="label">Account</div>
      {accountEmail() && <p class="row-title">{accountEmail()}</p>}
      <p class="note">
        {st.state === "error" ? <span class="miss">error: {st.error}</span>
          : st.state === "offline" ? "offline — answers are saved and sync when you're back"
          : st.state === "syncing" ? "syncing…" : `synced · ${when}`}
      </p>
      <Action title="sync now" onClick={() => { syncNow().then(onPaired); }} />
      <Action title={shown ? "hide key" : "show key"} detail="pair another device" onClick={() => setShown(!shown)} />
      {shown && (
        <div class="keybox">
          <code>{key}</code>
          <button class="action inline" onClick={() => navigator.clipboard?.writeText(link)}>copy pairing link</button>
          <p class="note">Anyone with this key can see and edit your progress.</p>
        </div>
      )}
      <Action title={accountEmail() ? "sign out" : "stop syncing"} detail="keeps local progress" onClick={() => { if (window.confirm("Sign out on this device? Progress here is kept.")) { unpair(); setKey(null); } }} />
    </>
  );
}

function usePhrases(ps) {
  const [, tick] = useState(0);
  useEffect(() => ps.subscribe(() => tick((n) => n + 1)), [ps]);
  return ps.s;
}

function Phrases({ ps }) {
  const p = usePhrases(ps);
  if (p.view === "topics") return <PhraseTopics ps={ps} p={p} />;
  const topic = p.topic ? p.stats.topics.find((t) => t.id === p.topic)?.label : "review";
  return (
    <section class="phrases">
      <div class="phrase-bar">
        <button class="back-link" onClick={() => ps.showTopics()}>‹ topics</button>
        <span class="label">{topic}</span>
        <span class="grow" />
        {p.score.seen > 0 && <span class="mono">{p.score.right}/{p.score.seen}</span>}
      </div>
      {p.view === "intro" && <PhraseIntro ps={ps} p={p} />}
      {p.view === "quiz" && p.mode === "build" && <PhraseQuiz ps={ps} p={p} />}
      {p.view === "quiz" && p.mode === "listen" && <PhraseListen ps={ps} p={p} />}
      {p.view === "quiz" && p.mode === "say" && <PhraseSay ps={ps} p={p} />}
      {p.view === "empty" && <PhraseEmpty ps={ps} p={p} />}
    </section>
  );
}

function PhraseTopics({ ps, p }) {
  const st = p.stats;
  return (
    <section class="phrases">
      <div class="legend">
        <span class="mono">{st.introduced}/{st.total} met</span>
        <span class="mono">{st.mastered} mastered</span>
        {st.saying > 0 && <span class="mono">{st.saying} speaking</span>}
        <span class="grow" />
        <span class="mono">{Math.max(0, st.newPerDay - st.newToday)} new left today</span>
      </div>
      <div class="chart-scroll">
        {st.due > 0 && (
          <button class="topic due-all" onClick={() => ps.start(null)}>
            <span class="topic-name">review what's due</span>
            <span class="topic-badge">{st.due}</span>
          </button>
        )}
        {st.topics.map((t, i) => [
          t.group && t.group !== st.topics[i - 1]?.group && <div class="topic-group" key={`g-${t.group}`}>{t.group}</div>,
          <button class="topic" key={t.id} onClick={() => ps.start(t.id)}>
            <span class="topic-name">{t.label}</span>
            {t.due > 0 && <span class="topic-badge">{t.due}</span>}
            <span class="topic-meter"><span style={{ width: `${(t.introduced / t.count) * 100}%` }} /></span>
            <span class="mono">{t.introduced}/{t.count}</span>
          </button>,
        ])}
        <p class="note credit">Phrases: {PHRASE_SOURCE.replace(/ — /, ". ")} Family phrases: written for Kanthropic.</p>
      </div>
    </section>
  );
}

function Speaker({ phrase }) {
  return (
    <button class="speaker" aria-label="play" onClick={() => speakPhrase(phrase)}>
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" stroke="none" /><path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10" />
      </svg>
    </button>
  );
}

function PhraseAnswer({ phrase, tone }) {
  return (
    <div class={`phrase-answer ${tone || ""}`}>
      <div class="phrase-ja">{phrase.ja}<Speaker phrase={phrase} /></div>
      {phrase.kana !== phrase.ja.replace(/[。、？！?!\s]/g, "") && <div class="phrase-kana">{phrase.kana}</div>}
      <div class="romaji gold">{phrase.romaji}</div>
    </div>
  );
}

function PhraseIntro({ ps, p }) {
  return (
    <>
      <div class="phrase-card">
        <div class="label gold">new phrase</div>
        <div class="phrase-en">{p.phrase.en}</div>
        {p.phrase.note && <div class="note">{p.phrase.note}</div>}
        <PhraseAnswer phrase={p.phrase} />
      </div>
      <button class="key go wide-go" onClick={() => ps.continueIntro()}>try it</button>
    </>
  );
}

function PhraseQuiz({ ps, p }) {
  const byKey = new Map(p.tiles.map((t) => [t.key, t]));
  return (
    <>
      <div class="phrase-card">
        <div class="label">{p.kind === "new" ? "now build it" : "translate"}</div>
        <div class="phrase-en">{p.phrase.en}</div>
        {p.phrase.note && <div class="note">{p.phrase.note}</div>}
        <div class={`answer-line ${p.result || ""}`}>
          {p.picked.map((k) => (
            <button class="tile picked" key={k} onClick={() => ps.unpick(k)}>{byKey.get(k)?.text}</button>
          ))}
        </div>
        {p.result && (
          <div class={`verdict ${p.result}`}>
            {p.result === "ok" ? "correct" : "the answer"}
            <PhraseAnswer phrase={p.phrase} tone={p.result} />
          </div>
        )}
      </div>
      {!p.result && (
        <div class="tile-bank">
          {p.tiles.map((t) => (
            <button class={`tile ${p.picked.includes(t.key) ? "used" : ""}`} key={t.key} disabled={p.picked.includes(t.key)}
              onClick={() => ps.pick(t.key)}>{t.text}</button>
          ))}
        </div>
      )}
      {p.result
        ? <button class={`key go wide-go ${p.result}`} onClick={() => ps.next()}>continue</button>
        : <button class="key go wide-go" disabled={!p.picked.length} onClick={() => ps.check()}>check</button>}
    </>
  );
}

/** Hear it, no text: pick what it means. */
function PhraseListen({ ps, p }) {
  return (
    <>
      <div class="phrase-card">
        <div class="label">listen</div>
        <button class="listen-play" aria-label="play again" onClick={() => speakPhrase(p.phrase)}>
          <svg viewBox="0 0 20 20" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" stroke="none" /><path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10" />
          </svg>
          <span>{p.result ? "play again" : "what does it mean?"}</span>
        </button>
        <div class="choices">
          {p.choices.map((c) => {
            const tone = !p.result ? "" : c.key === p.answer ? "ok" : c.key === p.chosen ? "miss" : "dim";
            return (
              <button class={`choice ${tone}`} key={c.key} disabled={!!p.result} onClick={() => ps.choose(c.key)}>
                <span>{c.en}</span>{c.note && <span class="note">{c.note}</span>}
              </button>
            );
          })}
        </div>
        {p.result && <PhraseAnswer phrase={p.phrase} tone={p.result} />}
      </div>
      {p.result && <button class={`key go wide-go ${p.result}`} onClick={() => ps.next()}>continue</button>}
    </>
  );
}

/** Say it out loud from the English, then check yourself. */
function PhraseSay({ ps, p }) {
  return (
    <>
      <div class="phrase-card">
        <div class="label gold">say it out loud</div>
        <div class="phrase-en">{p.phrase.en}</div>
        {p.phrase.note && <div class="note">{p.phrase.note}</div>}
        {p.revealed
          ? <PhraseAnswer phrase={p.phrase} tone={p.result} />
          : <p class="note say-hint">say the whole sentence, then check</p>}
      </div>
      {!p.revealed && <button class="key go wide-go" onClick={() => ps.reveal()}>show answer</button>}
      {p.revealed && !p.result && (
        <div class="rate-row">
          {[["again", "missed it"], ["hard", "with effort"], ["good", "got it"], ["easy", "instant"]].map(([r, d]) => (
            <button class={`rate ${r}`} key={r} onClick={() => ps.rate(r)}><span>{r}</span><span class="note">{d}</span></button>
          ))}
        </div>
      )}
      {p.result && <button class={`key go wide-go ${p.result}`} onClick={() => ps.next()}>continue</button>}
    </>
  );
}

function PhraseEmpty({ ps, p }) {
  const msg = {
    "caught-up": "nothing due — pick a topic to meet new phrases",
    limit: `that's today's ${p.stats.newPerDay} new phrases`,
    done: "you've met every phrase in this topic",
  }[p.reason] || "nothing here";
  return (
    <div class="phrase-card">
      <p class="empty">{msg}</p>
      <section class="actions">
        {p.reason === "limit" && <Action title="learn 5 more" detail="today only" onClick={() => ps.learnMore()} />}
        {p.stats.due > 0 && p.topic && <Action title="review what's due" detail={`${p.stats.due}`} onClick={() => ps.start(null)} />}
        <Action title="topics" onClick={() => ps.showTopics()} />
      </section>
    </div>
  );
}

// Only the letters romaji needs (no l, q, v, x), in QWERTY positions.
const KEY_ROWS = [
  ["w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k"],
  ["z", "c", "b", "n", "m"],
];

function Keyboard({ session, s }) {
  const press = (k) => {
    if (s.flash !== "none") return; // grading — the card is about to change
    if (k === "⌫") session.setAnswer(s.answer.slice(0, -1));
    else if (k === "⏎") session.submit();
    else session.setAnswer(s.answer + k);
  };
  // A hardware keyboard (iPad, laptop with "on") still works.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target?.tagName === "INPUT") return;
      if (e.key === "Backspace") press("⌫");
      else if (e.key === "Enter") press("⏎");
      else if (/^[a-z]$/i.test(e.key)) press(e.key.toLowerCase());
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // pointerdown, not click: keys fire on touch, like a real keyboard.
  const key = (k, cls = "") => (
    <button key={k} class={`key ${cls}`} onPointerDown={(e) => { e.preventDefault(); press(k); }}
      aria-label={k === "⌫" ? "delete" : k === "⏎" ? "check" : k}>
      {k === "⏎" ? "check" : k}
    </button>
  );
  return (
    <section class="keyboard" aria-label="romaji keyboard">
      {KEY_ROWS.map((row, i) => (
        <div class="key-row" key={i}>
          {row.map((k) => key(k))}
          {i === 2 && key("⌫", "wide")}
        </div>
      ))}
      <div class="key-row">{key("⏎", "go")}</div>
    </section>
  );
}

function SpeakSetting() {
  const [on, setOn] = useState(speakEnabled());
  return (
    <>
      <div class="label">Phrases</div>
      <button class="row" onClick={() => { setSpeakEnabled(!on); setOn(!on); }}>
        <span class="row-text"><span class="row-title">Read phrases aloud</span><span class="row-detail">recorded voices (Google Chirp 3 HD)</span></span>
        <span class="gold">{on ? "on" : "off"}</span>
      </button>
      <VoiceSetting />
    </>
  );
}

function VoiceSetting() {
  const [pref, setPref] = useState(voicePref());
  const choose = (v) => { setVoicePref(v); setPref(v); };
  return (
    <>
      <button class="row" onClick={() => choose("mix")}>
        <span class="row-text"><span class="row-title">Mix voices</span><span class="row-detail">a different speaker each time — trains your ear</span></span>
        {pref === "mix" && <span class="gold">✓</span>}
      </button>
      {VOICES.map((v) => (
        <button class="row" key={v} onClick={() => choose(v)}>
          <span class="row-text"><span class="row-title">{v}</span></span>
          {pref === v && <span class="gold">✓</span>}
        </button>
      ))}
    </>
  );
}

function KeyboardSetting() {
  const { pref, set } = useKeyboardPref();
  const opts = [["auto", "touchscreens"], ["on", "always"], ["off", "system keyboard"]];
  return (
    <>
      <div class="label">On-screen keyboard</div>
      {opts.map(([id, detail]) => (
        <button class="row" key={id} onClick={() => set(id)}>
          <span class="row-text"><span class="row-title">{id}</span><span class="row-detail">{detail}</span></span>
          {pref === id && <span class="gold">✓</span>}
        </button>
      ))}
    </>
  );
}

function AccountForm({ onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState(false);
  const go = async (mode) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await authenticate(mode, email, password);
      onDone(r.key);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };
  if (paste) {
    return (
      <>
        <div class="label">Pair with a key</div>
        <form class="pair" onSubmit={(e) => { e.preventDefault(); const k = e.currentTarget.k.value.trim(); if (k) onDone(pair(k)); }}>
          <input name="k" class="answer small" placeholder="sync key" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck={false} />
          <button class="action inline" type="submit">pair</button>
        </form>
        <button class="back" onClick={() => setPaste(false)}>back</button>
      </>
    );
  }
  return (
    <>
      <div class="label">Account</div>
      <p class="note">Sign in to sync with your Mac. New here? Create an account and this device's progress comes with it.</p>
      <form class="account" onSubmit={(e) => { e.preventDefault(); go("login"); }}>
        <input class="answer small" type="email" placeholder="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)}
          autocomplete="username" autocapitalize="off" spellcheck={false} />
        <input class="answer small" type="password" placeholder="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)}
          autocomplete="current-password" />
        {error && <p class="note miss">{error}</p>}
        <Action title={busy ? "…" : "sign in"} onClick={() => go("login")} />
        <Action title="create account" detail="8+ character password" onClick={() => go("signup")} />
      </form>
      <button class="back" onClick={() => setPaste(true)}>pair with a key instead</button>
    </>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" /><path d="M6 1.5v13M10 1.5v13M1.5 6h13M1.5 10h13" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4" />
    </svg>
  );
}

function PlayIcon() {
  return <svg class="play" viewBox="0 0 8 8" width="8" height="8"><path d="M1 0.5 7 4 1 7.5z" fill="currentColor" /></svg>;
}
