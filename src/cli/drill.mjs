/**
 * `kanthropic drill` — a tiny, endless kana input box for a side/bottom pane
 * next to Claude Code. Type the rōmaji, press Enter, it grades with FSRS and
 * shows the next card. A dot reflects whether Claude is thinking (●) or idle
 * (○), driven by the session-state file the Claude hooks write — so the box
 * "lights up" (a soft bell) the moment Claude starts working.
 *
 * Deliberately minimal: two short lines per card, no full-screen redraw.
 */
import { stdout } from "node:process";
import { checkAnswer, entryByGlyph, ENTRIES, glyph as glyphOf } from "../data/kana.mjs";
import { load, save } from "../core/store.mjs";
import { gradeCard } from "../core/scheduler.mjs";
import { pickNext } from "../core/ambient.mjs";
import { ensureLearned, learnedCount, practiceablePool, learnedSet, unmasteredPool, isMastered, SCRIPT_TOTAL } from "../core/learned.mjs";
import { walkRow, nextUnlearnedRow } from "./learn.mjs";
import { readSessionState } from "../core/session.mjs";
import { makeLineReader } from "./lineReader.mjs";
import { glyphImage, glyphSixel, pickRenderer, probeCellHeight } from "./glyphImage.mjs";
import { glyphChafa } from "./glyphChafa.mjs";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  accent: (s) => `\x1b[38;5;176m${s}\x1b[0m`,
};

const CLEAR = "\x1b[2J\x1b[3J\x1b[H"; // clear screen + scrollback + home
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cap the glyph size so a big terminal window doesn't scale it into a giant,
// thin, ugly shape. ~16 rows tall is large and crisp; bigger just looks wrong.
const MAX_GLYPH_ROWS = 16;
const MAX_GLYPH_COLS = 42;

// Max time between check-ins when drilling past the schedule (the other trigger
// is a clean streak of `checkinEvery`).
const CHECKIN_MS = 6 * 60 * 1000;

/** Center each line within `cols` and join. @param {string[]} lines */
function center(lines, cols) {
  return lines.map((l) => " ".repeat(Math.max(0, Math.floor((cols - [...l].length) / 2))) + l).join("\n");
}

/** A script is "mastered" once every glyph is mastered (FSRS Review + recalled
 *  on ≥ MASTER_DAYS separate days). @param {Record<string, any>} cards */
export function scriptMastered(cards, script) {
  return ENTRIES.every((e) => isMastered(cards[glyphOf(e, script)]));
}

/** The script to actually drill. An explicit `--script` always wins; otherwise
 *  auto-advance hiragana → katakana once hiragana is fully mastered. */
export function resolveScript(store, explicit) {
  if (explicit) return explicit;
  const s = store.config.script;
  if (store.config.autoAdvance === false) return s;
  if (s === "hiragana" && scriptMastered(store.cards, "hiragana")
      && !scriptMastered(store.cards, "katakana")) return "katakana";
  return s;
}

/** @param {{ script?: import("../data/kana.mjs").Script, count?: number }} [opts]
 *  `count` runs a bounded session of N cards ending in a recap (the old
 *  `study`); omitted runs the endless ambient drill. */
export async function runDrill(opts = {}) {
  const limit = typeof opts.count === "number" && opts.count > 0 ? opts.count : 0;
  const store0 = load();
  if (ensureLearned(store0)) save(store0); // one-time: existing drilled cards count as learned
  const prev = store0.config.script;
  // `let` so a live `/h` `/k` swap can change scripts mid-drill (persisted to
  // config, so the session pane keeps it on the next card too).
  let script = resolveScript(store0, opts.script);
  // Persist + announce a one-time auto-advance (only fires on the transition).
  const advancedFrom = (!opts.script && script !== prev) ? prev : null;
  if (advancedFrom) { store0.config.script = script; save(store0); }

  const renderer = pickRenderer(store0.config.image || "auto");
  // Sixel needs the cell pixel height to size to N rows; probe once.
  const cellPx = renderer === "sixel" ? (await probeCellHeight()) || 20 : 20;
  const reader = makeLineReader();
  let lastGlyph = null;
  let correct = 0, seen = 0;
  const missed = [];
  // Practice mode when nothing is due. "normal" = follow FSRS due dates;
  // "focus" = drill only what you're still learning (ignores due, auto-exits
  // when mastered); "review" = drill the whole learned set to self-test.
  let mode = "normal";
  // Check-in pacing: when grinding past the schedule, pause once you've cleared
  // the set (each card right `checkinEvery` times this run) — or after a while —
  // so you can move on. sessionGood = correct reps per glyph this run.
  const sessionGood = new Map();
  let lastCheckin = Date.now();
  let lastState = readSessionState();

  // Soft bell when Claude transitions into thinking — a non-intrusive cue.
  const poll = setInterval(() => {
    const s = readSessionState();
    if (s === "thinking" && lastState !== "thinking") stdout.write("\x07");
    lastState = s;
  }, 1500);

  // A centered message + wait. Returns the chosen action: "quit", "recheck",
  // "learn" ([n], when `allowLearnNext`), "cram" ([r], when `allowCram`), or
  // "hiragana"/"katakana" if the user typed /h · /k to switch script.
  const plainLen = (s) => [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;
  async function messageScreen(lines, { allowCram = false, allowLearnNext = false, keepGoing = false, cramLabel = "practice anyway" } = {}) {
    const rows = stdout.rows || 16, cols = stdout.columns || 40;
    stdout.write("\x1b[?25l" + CLEAR);
    stdout.write("\n".repeat(Math.max(0, (rows - lines.length - 3) >> 1)));
    for (const l of lines) stdout.write(" ".repeat(Math.max(0, (cols - plainLen(l)) >> 1)) + l + "\n");
    const parts = [];
    if (allowLearnNext) parts.push("[n] learn next row");
    if (allowCram) parts.push(`[r] ${cramLabel}`);
    if (keepGoing) parts.push("[Enter] keep going");
    parts.push("[q] quit");
    const foot = c.dim(parts.join(" · "));
    stdout.write("\n" + " ".repeat(Math.max(0, (cols - plainLen(foot)) >> 1)) + foot + "\n");
    stdout.write(`\x1b[${Math.max(2, rows - 1)};1H\x1b[?25h`);
    const k = (await reader.next(""))?.trim().toLowerCase();
    if (k === null || k === "q") return "quit";
    if (allowLearnNext && k === "n") return "learn";
    if (allowCram && k === "r") return "cram";
    if (/^\/(h|hira|hiragana)$/.test(k)) return "hiragana";
    if (/^\/(k|kata|katakana)$/.test(k)) return "katakana";
    return "recheck";
  }

  if (advancedFrom) {
    stdout.write(CLEAR + `\n\n  ${c.accent(c.bold(`🎉 ${advancedFrom} mastered!`))}\n`
      + `  ${c.dim(`Now moving on to ${script} →`)}\n`);
    await sleep(2600);
  }

  try {
    for (;;) {
      const store = load();
      const now = Date.now();
      // Practice ONLY what's been learned. Empty pool / nothing due → nudge to
      // go learn more, rather than ambushing with an un-learned character.
      // Act on a messageScreen result that isn't quit/recheck. Returns true to
      // break the drill loop. `swap` persists so the session pane keeps it.
      const swap = (s) => { script = s; lastGlyph = null; store.config.script = s; save(store); };
      const handle = async (action) => {
        if (action === "quit") return true;
        if (action === "learn") {
          const row = nextUnlearnedRow(load(), script);
          // Drill the row you just learned right away (focus mode), even after
          // you miss them and FSRS would otherwise schedule them out.
          if (row) { await walkRow({ entries: row, script, renderer, cellPx, reader }); mode = "focus"; }
        } else if (action === "cram") {
          // Same key, context-aware: focus the still-learning set if there is
          // one, otherwise review the whole learned set (self-test).
          mode = unmasteredPool(store, script).size ? "focus" : "review";
        } else if (action === "hiragana" || action === "katakana") swap(action);
        return false;
      };

      if (learnedCount(store, script) === 0) {
        if (limit) break; // bounded session: nothing to do → go to recap
        const action = await messageScreen([`${c.dim("📖")}  No ${script} learned yet`, "",
          `Press ${c.accent(c.bold("n"))} to learn your first row`,
          "", c.dim("/h · /k switch script")], { allowLearnNext: true });
        if (await handle(action)) break;
        continue;
      }
      // Resolve the pool for the active mode. "focus" drills only what you're
      // still learning (ignores due, auto-exits once mastered); "review" drills
      // the whole learned set; "normal" follows FSRS due dates.
      let pool;
      if (mode === "focus") {
        pool = unmasteredPool(store, script);
        if (pool.size === 0) mode = "normal"; // mastered the focus set → resume scheduling
      }
      if (mode === "normal") pool = practiceablePool(store, script, now);
      else if (mode === "review") pool = learnedSet(store, script);
      if (pool.size === 0) {
        if (limit) break; // bounded session ran out of due cards → recap
        // Continuous mode: never stop on "caught up". Grind the still-learning
        // set (focus) on its own — the same small set until you're comfortable —
        // and only widen to the whole learned set (review) once it's all
        // mastered. The set-completion check-in below ends each grind.
        if (store.config.continuous && learnedCount(store, script) > 0) {
          mode = unmasteredPool(store, script).size ? "focus" : "review";
          continue;
        }
        const more = learnedCount(store, script) < SCRIPT_TOTAL;
        const stillLearning = unmasteredPool(store, script).size;
        const anyLearned = learnedCount(store, script) > 0;
        const lines = [`${c.green("✓")}  Caught up — nothing due right now`, ""];
        if (stillLearning > 0)
          lines.push(c.dim(`Still learning ${stillLearning} — drill just those below`));
        else if (!more)
          lines.push(c.accent(`🎉 You've learned every ${script}!`));
        else
          lines.push(c.dim("Learn the next row, or review what you know"));
        lines.push("", c.dim("/h · /k switch script"));
        const action = await messageScreen(lines, {
          allowCram: anyLearned, // focus the still-learning set, or review all if mastered
          allowLearnNext: more,
          cramLabel: stillLearning > 0 ? "drill these now" : "review everything",
        });
        if (await handle(action)) break;
        continue;
      }
      // Avoid an immediate repeat ONLY when there's something else to show. With
      // a single-card pool (e.g. the last unmastered char in focus mode, kept
      // there by a wrong answer), avoiding it makes pickNext return null — and
      // `continue` would then spin forever without reading input (a freeze).
      const avoid = pool.size > 1 ? lastGlyph : null;
      const next = pickNext(script, store.cards, avoid, now, undefined, pool);
      if (!next) { lastGlyph = null; continue; } // safety net: never spin
      lastGlyph = next.glyph;
      const entry = entryByGlyph(script, next.glyph);

      const rows = stdout.rows || 16;
      const cols = stdout.columns || 40;
      const dot = readSessionState() === "thinking" ? c.accent("●") : c.dim("○");

      // Glyph centered with newlines + leading spaces (the emission tmux's sixel
      // needs — it won't render if you jump to it with an absolute cursor move).
      // Reserve 4 rows (header + prompt + a SPARE row below it) so the newline
      // Enter emits lands on the spare row instead of scrolling the glyph up.
      const availRows = Math.max(3, rows - 3);
      const renderRows = Math.min(availRows, MAX_GLYPH_ROWS);
      const maxW = Math.max(8, Math.min(cols - 2, MAX_GLYPH_COLS));

      // Hide the cursor while we redraw so it doesn't flash at the top-left
      // (where CLEAR homes it) before jumping to the prompt; shown again below.
      stdout.write("\x1b[?25l" + CLEAR); // no top header — status is in the prompt now

      let drew = false;
      if (renderer === "sixel") {
        const sx = glyphSixel(next.glyph, renderRows * cellPx);
        if (sx) {
          const heightCells = Math.max(1, Math.round(sx.heightPx / cellPx));
          const widthCells = Math.max(1, Math.round(sx.widthPx / (cellPx / 2)));
          const topPad = Math.max(0, Math.floor((availRows - heightCells) / 2));
          const botPad = Math.max(0, availRows - heightCells - topPad);
          const padCols = Math.max(0, Math.floor((cols - widthCells) / 2));
          stdout.write("\n".repeat(topPad));
          stdout.write(" ".repeat(padCols) + sx.sixel + "\n");
          stdout.write("\n".repeat(botPad));
          drew = true;
        }
      } else if (renderer === "iterm") {
        const img = glyphImage(next.glyph, renderRows);
        if (img) {
          const topPad = Math.max(0, Math.floor((availRows - renderRows) / 2));
          const botPad = Math.max(0, availRows - renderRows - topPad);
          const padCols = Math.max(0, Math.floor((cols - img.widthCells) / 2));
          stdout.write("\n".repeat(topPad));
          stdout.write(" ".repeat(padCols) + img.escape + "\n");
          stdout.write("\n".repeat(botPad));
          drew = true;
        }
      }
      if (!drew) {
        // No image support → chafa braille symbol-art (falls back to the plain
        // character if chafa can't render this glyph).
        let lines = null;
        try { lines = await glyphChafa(next.glyph, renderRows, maxW, { symbols: "braille" }); }
        catch { lines = null; }
        const artLines = lines && lines.length ? lines : [c.bold(next.glyph)];
        const glyphBlock = c.accent(center(artLines, cols));
        const topPad = Math.max(0, Math.floor((availRows - artLines.length) / 2));
        const botPad = Math.max(0, availRows - artLines.length - topPad);
        stdout.write("\n".repeat(topPad));
        stdout.write(glyphBlock + "\n");
        stdout.write("\n".repeat(botPad));
      }

      // Pin the prompt to a fixed row with a spare row below it, so the newline
      // Enter emits lands on the spare row instead of scrolling the glyph. This
      // absolute move is done AFTER the botPad newlines (which commit the sixel
      // into tmux's grid) — moving before that commit makes tmux drop the image.
      stdout.write(`\x1b[${Math.max(2, rows - 1)};1H\x1b[?25h`); // move to prompt + show cursor
      // Drop any Enter spammed during the previous grade/sleep so it can't
      // auto-answer the next few cards (interactive only — keep piped input).
      if (process.stdin.isTTY) reader.flush();
      // Status (dot + script + score) lives on the prompt line now. A trailing
      // ⟳ marks focus/review mode (drilling past FSRS due dates).
      const status = `${script}${mode !== "normal" ? " ⟳" : ""} ${correct}/${seen}`;
      const promptW = [...`○ ${status}  → `].length; // visible width, for the ✓/✗ offset
      const answer = await reader.next(`${dot} ${c.dim(status)}  ${c.dim("→")} `);
      if (answer === null) break; // pane closed

      // Slash-commands swap script live (never a valid rōmaji answer). Persist
      // to config so the session pane stays on the new script next card.
      const cmd = answer.trim().toLowerCase();
      if (/^\/(h|hira|hiragana|k|kata|katakana)$/.test(cmd)) {
        script = cmd[1] === "k" ? "katakana" : "hiragana";
        store.config.script = script; save(store);
        lastGlyph = null;
        continue;
      }

      const ok = checkAnswer(answer, entry);
      store.cards[next.glyph] = gradeCard(script, next.glyph, store.cards[next.glyph], ok);
      save(store);
      seen++;
      const aw = [...answer].length;
      if (ok) {
        correct++;
        sessionGood.set(next.glyph, (sessionGood.get(next.glyph) || 0) + 1);
        // ✓ inline, just after your answer (Enter dropped the cursor a line).
        stdout.write(`\x1b[A\x1b[${promptW + aw + 1}C${c.green("✓")}\x1b[B\r`);
        await sleep(450);
      } else {
        // ✗ + reading inline on the same line; brief pause to read it (no second
        // Enter, which would scroll from the spare bottom row).
        sessionGood.set(next.glyph, 0); // a miss resets that card's session progress
        missed.push({ glyph: next.glyph, romaji: entry.romaji });
        stdout.write(`\x1b[A\x1b[${promptW + aw + 1}C${c.red("✗")}  ${c.dim("= " + entry.romaji)}\x1b[B\r`);
        await sleep(1600);
      }
      if (limit && seen >= limit) break; // bounded session done

      // Check-in: when grinding past the schedule (focus/review), pause once
      // you've CLEARED the set — every card in it right `checkinEvery` times this
      // run — or after ~6 min. Then choose to learn the next set, keep going, or
      // stop. `checkinEvery` 0 disables it. A small focus set clears fast; a big
      // review set rarely fully clears, so the time fallback paces it.
      const passes = store.config.checkinEvery | 0;
      const setCleared = passes > 0 && pool.size > 0
        && [...pool].every((g) => (sessionGood.get(g) || 0) >= passes);
      if (passes > 0 && mode !== "normal"
          && (setCleared || Date.now() - lastCheckin >= CHECKIN_MS)) {
        lastCheckin = Date.now();
        sessionGood.clear(); // a fresh round if you keep going
        const more = learnedCount(store, script) < SCRIPT_TOTAL;
        const action = await messageScreen([
          `${c.green("✓")}  nice — you've got these for now`,
          "",
          more ? c.dim("learn the next set, keep going, or stop?") : c.dim("keep going, or take a break?"),
        ], { allowLearnNext: more, keepGoing: true });
        if (await handle(action)) break;
      }
    }
  } finally {
    clearInterval(poll);
    stdout.write("\x1b[?25h"); // always restore the cursor on exit
    reader.close();
  }
  if (limit) {
    // Bounded-session recap (the old `study`).
    const total = correct + missed.length;
    stdout.write(CLEAR + `\n  ${c.bold("Session complete")} — ${c.green(`${correct}/${total}`)} correct.\n`);
    if (missed.length) {
      stdout.write(`  ${c.dim("review: " + missed.map((m) => `${m.glyph}=${m.romaji}`).join("  "))}\n`);
    }
    stdout.write("\n");
  } else {
    stdout.write("\n" + c.dim(`${correct}/${seen} this run`) + "\n");
  }
}
