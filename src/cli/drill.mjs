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
import { checkAnswer, entryByGlyph } from "../data/kana.mjs";
import { load, save } from "../core/store.mjs";
import { gradeCard } from "../core/scheduler.mjs";
import { pickNext } from "../core/ambient.mjs";
import { readSessionState } from "../core/session.mjs";
import { makeLineReader } from "./lineReader.mjs";
import { bigGlyph } from "./bigGlyph.mjs";
import { glyphImage, glyphSixel, pickRenderer, probeCellHeight } from "./glyphImage.mjs";

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

/** @param {{ script: import("../data/kana.mjs").Script }} opts */
export async function runDrill(opts) {
  const script = opts.script;
  const renderer = pickRenderer(load().config.image || "auto");
  // Sixel needs the cell pixel height to size to N rows; probe once.
  const cellPx = renderer === "sixel" ? (await probeCellHeight()) || 20 : 20;
  const reader = makeLineReader();
  let lastGlyph = null;
  let correct = 0, seen = 0;
  let lastState = readSessionState();

  // Soft bell when Claude transitions into thinking — a non-intrusive cue.
  const poll = setInterval(() => {
    const s = readSessionState();
    if (s === "thinking" && lastState !== "thinking") stdout.write("\x07");
    lastState = s;
  }, 1500);

  try {
    for (;;) {
      const store = load();
      const next = pickNext(script, store.cards, lastGlyph);
      if (!next) break;
      lastGlyph = next.glyph;
      const entry = entryByGlyph(script, next.glyph);

      const rows = stdout.rows || 16;
      const cols = stdout.columns || 40;
      const dot = readSessionState() === "thinking" ? c.accent("●") : c.dim("○");

      // Glyph centered with newlines + leading spaces (the emission tmux's sixel
      // needs — it won't render if you jump to it with an absolute cursor move).
      // Reserve 4 rows (header + prompt + a SPARE row below it) so the newline
      // Enter emits lands on the spare row instead of scrolling the glyph up.
      const availRows = Math.max(3, rows - 4);
      const renderRows = Math.min(availRows, MAX_GLYPH_ROWS);
      const maxW = Math.max(8, Math.min(cols - 2, MAX_GLYPH_COLS));

      stdout.write(CLEAR);
      stdout.write(`${dot} ${c.dim(`${script} · ${correct}/${seen}`)}\n`);

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
        const art = bigGlyph(next.glyph, renderRows, maxW, store.config.glyphStyle);
        const artLines = art || [c.bold(next.glyph)];
        const glyphBlock = art ? c.accent(center(artLines, cols)) : center(artLines, cols);
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
      stdout.write(`\x1b[${Math.max(2, rows - 1)};1H`);
      const answer = await reader.next(c.dim("→ "));
      if (answer === null) break; // pane closed

      const ok = checkAnswer(answer, entry);
      store.cards[next.glyph] = gradeCard(script, next.glyph, store.cards[next.glyph], ok);
      save(store);
      seen++;
      const aw = [...answer].length;
      if (ok) {
        correct++;
        // ✓ inline, just after your answer (Enter dropped the cursor a line).
        stdout.write(`\x1b[A\x1b[${3 + aw}C${c.green("✓")}\x1b[B\r`);
        await sleep(450);
      } else {
        // ✗ + reading inline on the same line; brief pause to read it (no second
        // Enter, which would scroll from the spare bottom row).
        stdout.write(`\x1b[A\x1b[${3 + aw}C${c.red("✗")}  ${c.dim("= " + entry.romaji)}\x1b[B\r`);
        await sleep(1600);
      }
    }
  } finally {
    clearInterval(poll);
    reader.close();
  }
  stdout.write("\n" + c.dim(`${correct}/${seen} this run`) + "\n");
}
