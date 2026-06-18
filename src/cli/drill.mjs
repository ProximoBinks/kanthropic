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
import { ensureLearned, learnedCount, practiceablePool, learnedSet, SCRIPT_TOTAL } from "../core/learned.mjs";
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

/** Center each line within `cols` and join. @param {string[]} lines */
function center(lines, cols) {
  return lines.map((l) => " ".repeat(Math.max(0, Math.floor((cols - [...l].length) / 2))) + l).join("\n");
}

/** A script is "mastered" once every glyph has graduated past learning
 *  (FSRS state ≥ 2 = Review). @param {Record<string, any>} cards */
export function scriptMastered(cards, script) {
  return ENTRIES.every((e) => (cards[glyphOf(e, script)]?.state ?? 0) >= 2);
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
  let cram = false; // "practice anyway": drill the whole learned pool, ignoring due dates
  let lastState = readSessionState();

  // Soft bell when Claude transitions into thinking — a non-intrusive cue.
  const poll = setInterval(() => {
    const s = readSessionState();
    if (s === "thinking" && lastState !== "thinking") stdout.write("\x07");
    lastState = s;
  }, 1500);

  // A centered message + wait. Returns the chosen action: "quit", "recheck",
  // or (when `allowCram`) "cram" if the user pressed `r` to practice anyway.
  const plainLen = (s) => [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;
  async function messageScreen(lines, { allowCram = false } = {}) {
    const rows = stdout.rows || 16, cols = stdout.columns || 40;
    stdout.write("\x1b[?25l" + CLEAR);
    stdout.write("\n".repeat(Math.max(0, (rows - lines.length - 3) >> 1)));
    for (const l of lines) stdout.write(" ".repeat(Math.max(0, (cols - plainLen(l)) >> 1)) + l + "\n");
    const foot = c.dim(allowCram
      ? "[Enter] re-check · [r] practice anyway · [q] quit"
      : "[Enter] re-check · [q] quit");
    stdout.write("\n" + " ".repeat(Math.max(0, (cols - plainLen(foot)) >> 1)) + foot + "\n");
    stdout.write(`\x1b[${Math.max(2, rows - 1)};1H\x1b[?25h`);
    const k = (await reader.next(""))?.trim().toLowerCase();
    if (k === null || k === "q") return "quit";
    if (allowCram && k === "r") return "cram";
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
      if (learnedCount(store, script) === 0) {
        if (limit) break; // bounded session: nothing to do → go to recap
        if (await messageScreen([`${c.dim("📖")}  No ${script} learned yet`, "",
          `Open a terminal and run  ${c.accent(c.bold("kanthropic learn"))}`,
          "", c.dim("(or type /h · /k to switch script)")]) === "quit") break;
        continue;
      }
      // `cram` keeps drilling the whole learned pool even when nothing is due.
      const pool = cram ? learnedSet(store, script) : practiceablePool(store, script, now);
      if (pool.size === 0) {
        if (limit) break; // bounded session ran out of due cards → recap
        const more = learnedCount(store, script) < SCRIPT_TOTAL;
        const action = await messageScreen([`${c.green("✓")}  Caught up — nothing due right now`, "",
          more ? `Learn more:  ${c.accent(c.bold("kanthropic learn"))}`
               : c.accent(`🎉 You've learned every ${script}!`),
          "", c.dim("[r] keep practicing this set anyway · /h /k switch script")],
          { allowCram: true });
        if (action === "quit") break;
        if (action === "cram") cram = true; // ignore due dates from here on
        continue;
      }
      const next = pickNext(script, store.cards, lastGlyph, now, undefined, pool);
      if (!next) continue;
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
      // ⟳ marks "practice anyway" mode (drilling past due dates).
      const status = `${script}${cram ? " ⟳" : ""} ${correct}/${seen}`;
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
        // ✓ inline, just after your answer (Enter dropped the cursor a line).
        stdout.write(`\x1b[A\x1b[${promptW + aw + 1}C${c.green("✓")}\x1b[B\r`);
        await sleep(450);
      } else {
        // ✗ + reading inline on the same line; brief pause to read it (no second
        // Enter, which would scroll from the spare bottom row).
        missed.push({ glyph: next.glyph, romaji: entry.romaji });
        stdout.write(`\x1b[A\x1b[${promptW + aw + 1}C${c.red("✗")}  ${c.dim("= " + entry.romaji)}\x1b[B\r`);
        await sleep(1600);
      }
      if (limit && seen >= limit) break; // bounded session done
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
