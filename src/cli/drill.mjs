/**
 * `kanthropic drill` — type the rōmaji, press Enter, FSRS grades it.
 *
 * Learn a row, then study what's due. `/n` learns the next row; `q` quits.
 */
import { stdout } from "node:process";
import { checkAnswer, entryByGlyph } from "../data/kana.mjs";
import { load, update } from "../core/store.mjs";
import { gradeCard } from "../core/scheduler.mjs";
import { logAnswer } from "../core/activity.mjs";
import { ensureLearned, learnedCount, SCRIPT_TOTAL } from "../core/learned.mjs";
import { nextRevise, nextUnlearnedRow, resolveScript, scriptMastered } from "../core/flow.mjs";
import { walkRow } from "./learn.mjs";
import { readSessionState } from "../core/session.mjs";
import { makeLineReader } from "./lineReader.mjs";
import { glyphImage, glyphSixel, pickRenderer, probeCellHeight } from "./glyphImage.mjs";
import { glyphChafa } from "./glyphChafa.mjs";

export { resolveScript, scriptMastered };

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  accent: (s) => `\x1b[38;5;176m${s}\x1b[0m`,
};

const CLEAR = "\x1b[2J\x1b[3J\x1b[H";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_GLYPH_ROWS = 16;
const MAX_GLYPH_COLS = 42;

/** Center each line within `cols` and join. @param {string[]} lines */
function center(lines, cols) {
  return lines.map((l) => " ".repeat(Math.max(0, Math.floor((cols - [...l].length) / 2))) + l).join("\n");
}

const plainLen = (s) => [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;

/**
 * @param {{ script?: import("../data/kana.mjs").Script, count?: number, watch?: boolean }} [opts]
 */
export async function runDrill(opts = {}) {
  const limit = typeof opts.count === "number" && opts.count > 0 ? opts.count : 0;
  const watchMode = !!opts.watch;
  let watchForced = false;
  const store0 = update((s) => { ensureLearned(s); });
  const prev = store0.config.script;
  let script = resolveScript(store0, opts.script);
  const advancedFrom = (!opts.script && script !== prev) ? prev : null;
  if (advancedFrom) update((s) => { s.config.script = script; });

  const renderer = pickRenderer(store0.config.image || "auto");
  const cellPx = renderer === "sixel" ? (await probeCellHeight()) || 20 : 20;
  const reader = makeLineReader();
  let lastGlyph = null;
  let correct = 0, seen = 0;
  const missed = [];
  let lastState = readSessionState();
  let hintShown = false;
  let nothingLearned = false;

  const poll = setInterval(() => {
    const s = readSessionState();
    if (s === "thinking" && lastState !== "thinking") stdout.write("\x07");
    lastState = s;
  }, 1500);

  if (advancedFrom) {
    stdout.write(CLEAR + `\n\n  ${c.accent(c.bold(`${advancedFrom} mastered`))}\n`
      + `  ${c.dim(`moving on to ${script}`)}\n`);
    await sleep(1800);
  }

  async function waitForThinking() {
    let lastDraw = 0;
    for (;;) {
      if (readSessionState() === "thinking") return "go";
      if (Date.now() - lastDraw > 5000) {
        const rows = stdout.rows || 16, cols = stdout.columns || 40;
        const lines = [
          `${c.dim("waiting for Grok…")}`,
          "",
          c.dim("cards appear the moment a turn starts"),
          "",
          c.dim("[Enter] drill now · [q] quit"),
        ];
        stdout.write("\x1b[?25l" + CLEAR);
        stdout.write("\n".repeat(Math.max(0, (rows - lines.length) >> 1)));
        for (const l of lines) stdout.write(" ".repeat(Math.max(0, (cols - plainLen(l)) >> 1)) + l + "\n");
        lastDraw = Date.now();
      }
      const k = reader.tryNext();
      if (k === null) return "quit";
      if (k !== undefined) {
        const t = k.trim().toLowerCase();
        if (t === "q" || t === "/q" || t === "quit") return "quit";
        return "force";
      }
      await sleep(300);
    }
  }

  async function learnNextRow() {
    const row = nextUnlearnedRow(load(), script);
    if (!row) return false;
    const done = await walkRow({ entries: row, script, renderer, cellPx, reader });
    lastGlyph = null;
    return done;
  }

  try {
    for (;;) {
      if (watchMode && !watchForced) {
        const r = await waitForThinking();
        if (r === "quit") break;
        if (r === "force") watchForced = true;
      }
      const store = load();
      const now = Date.now();

      if (learnedCount(store, script) === 0) {
        if (limit) { nothingLearned = true; break; }
        const row = nextUnlearnedRow(store, script);
        if (!row) {
          // Every row of this script is in the deck — try the other one, or sit.
          const other = script === "hiragana" ? "katakana" : "hiragana";
          if (learnedCount(store, other) === 0 && nextUnlearnedRow(store, other)) {
            script = other;
            update((st) => { st.config.script = script; });
            lastGlyph = null;
            continue;
          }
          stdout.write(CLEAR + `\n  ${c.dim("Every " + script + " character is already in your deck.")}\n`);
          await sleep(1200);
          // Fall through to revise (the pool should be the whole set).
        } else {
          await walkRow({ entries: row, script, renderer, cellPx, reader });
          lastGlyph = null;
          if (learnedCount(load(), script) === 0) break; // bailed before the first glyph
          continue;
        }
      }

      const next = nextRevise(store, script, lastGlyph, now);
      if (!next?.glyph) {
        lastGlyph = null;
        if (limit) break;
        const rows = stdout.rows || 16, cols = stdout.columns || 40;
        const lines = [
          c.green("caught up"),
          "",
          c.dim("nothing due — reviews come back on the schedule"),
          "",
          c.dim("[n] learn next row · [q] quit"),
        ];
        stdout.write("\x1b[?25l" + CLEAR);
        stdout.write("\n".repeat(Math.max(0, (rows - lines.length) >> 1)));
        for (const l of lines) stdout.write(" ".repeat(Math.max(0, Math.floor((cols - plainLen(l)) / 2))) + l + "\n");
        stdout.write("\x1b[?25h");
        const k = (await reader.next(""))?.trim().toLowerCase();
        if (k === "q" || k === "/q" || k == null) break;
        if (k === "n" || k === "/n") await learnNextRow();
        continue;
      }
      lastGlyph = next.glyph;
      const entry = entryByGlyph(script, next.glyph);

      const rows = stdout.rows || 16;
      const cols = stdout.columns || 40;
      const thinking = readSessionState() === "thinking";
      const dot = thinking ? c.accent("●") : c.dim("○");

      const availRows = Math.max(3, rows - 3);
      const renderRows = Math.min(availRows, MAX_GLYPH_ROWS);
      const maxW = Math.max(8, Math.min(cols - 2, MAX_GLYPH_COLS));

      stdout.write("\x1b[?25l" + CLEAR);

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

      if (!hintShown) {
        hintShown = true;
        const hint = c.dim("/n next row · /h /k script · q quit");
        stdout.write(`\x1b[${Math.max(1, rows - 2)};1H` + " ".repeat(Math.max(0, (cols - plainLen(hint)) >> 1)) + hint);
      }
      stdout.write(`\x1b[${Math.max(2, rows - 1)};1H\x1b[?25h`);
      if (process.stdin.isTTY) reader.flush();
      const tag = next.reason === "due" ? "" : " · keep going";
      const status = `${script}${tag} ${correct}/${seen}`;
      const promptW = [...`○ ${status}  → `].length;
      const answer = await reader.next(`${dot} ${c.dim(status)}  ${c.dim("→")} `);
      if (answer === null) break;

      const cmd = answer.trim().toLowerCase();
      if (["q", "/q", "quit", "/quit"].includes(cmd)) break;
      if (/^\/(n|new)$/.test(cmd)) {
        if (learnedCount(load(), script) < SCRIPT_TOTAL) await learnNextRow();
        continue;
      }
      if (/^\/(h|hira|hiragana|k|kata|katakana)$/.test(cmd)) {
        script = cmd[1] === "k" ? "katakana" : "hiragana";
        update((st) => { st.config.script = script; });
        lastGlyph = null;
        continue;
      }

      const ok = checkAnswer(answer, entry);
      update((st) => {
        st.cards[next.glyph] = gradeCard(script, next.glyph, st.cards[next.glyph], ok);
        logAnswer(st, { kind: "kana", correct: ok });
      });
      seen++;
      const aw = [...answer].length;
      if (ok) {
        correct++;
        stdout.write(`\x1b[A\x1b[${promptW + aw + 1}C${c.green("✓")}\x1b[B\r`);
        await sleep(450);
      } else {
        missed.push({ glyph: next.glyph, romaji: entry.romaji });
        stdout.write(`\x1b[A\x1b[${promptW + aw + 1}C${c.red("✗")}  ${c.dim("= " + entry.romaji)}\x1b[B\r`);
        await sleep(1600);
      }
      if (limit && seen >= limit) break;
    }
  } finally {
    clearInterval(poll);
    stdout.write("\x1b[?25h");
    reader.close();
  }
  if (nothingLearned) {
    stdout.write(CLEAR + `\n  ${c.dim("Nothing learned yet — run")} ${c.bold("kanthropic learn")} ${c.dim("or the menu bar app.")}\n\n`);
  } else if (limit) {
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
