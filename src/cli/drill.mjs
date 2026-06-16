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

      const rowsT = stdout.rows || 16;
      const cols = stdout.columns || 40;
      const dot = readSessionState() === "thinking" ? c.accent("●") : c.dim("○");
      const at = (r, col) => `\x1b[${r};${col}H`; // absolute cursor move (1-based)

      // Glyph is positioned by newlines + leading spaces (the emission tmux's
      // sixel needs — it won't render if you jump to it with an absolute move),
      // but the PROMPT is pinned to row N-1 with row N kept spare, so Enter
      // lands on the spare row instead of scrolling the glyph up.
      const PROMPT_ROW = Math.max(2, rowsT - 1);
      const areaH = Math.max(1, PROMPT_ROW - 2); // rows 2..PROMPT_ROW-1
      const renderRows = Math.min(areaH, MAX_GLYPH_ROWS);
      const maxW = Math.max(8, Math.min(cols - 2, MAX_GLYPH_COLS));
      const padCol = (w) => " ".repeat(Math.max(0, Math.floor((cols - w) / 2)));

      let imgCells, emit;
      if (renderer === "sixel") {
        const sx = glyphSixel(next.glyph, renderRows * cellPx);
        if (sx) {
          imgCells = Math.min(areaH, Math.max(1, Math.round(sx.heightPx / cellPx)));
          emit = padCol(Math.round(sx.widthPx / (cellPx / 2))) + sx.sixel + "\n";
        }
      } else if (renderer === "iterm") {
        const img = glyphImage(next.glyph, renderRows);
        if (img) {
          imgCells = renderRows;
          emit = padCol(img.widthCells) + img.escape + "\n";
        }
      }
      if (!emit) {
        const art = bigGlyph(next.glyph, renderRows, maxW, store.config.glyphStyle);
        const lines = art || [next.glyph];
        imgCells = lines.length;
        emit = lines.map((l) => padCol([...l].length) + c.accent(l)).join("\n") + "\n";
      }
      const topPad = Math.max(0, Math.floor((areaH - imgCells) / 2));

      stdout.write(CLEAR);
      stdout.write(`${dot} ${c.dim(`${script} · ${correct}/${seen}`)}\n`);
      stdout.write("\n".repeat(topPad));
      stdout.write(emit);
      stdout.write(at(PROMPT_ROW, 1) + "\x1b[K");
      const answer = await reader.next(c.dim("→ "));
      if (answer === null) break; // pane closed

      const ok = checkAnswer(answer, entry);
      store.cards[next.glyph] = gradeCard(script, next.glyph, store.cards[next.glyph], ok);
      save(store);
      seen++;
      const aw = [...answer].length;
      if (ok) {
        correct++;
        // ✓ inline, right after your answer (Enter dropped the cursor a line).
        stdout.write(`\x1b[A\x1b[${3 + aw}C${c.green("✓")}`);
        await sleep(450);
      } else {
        // ✗ inline; the reading on the spare last row. Park the cursor back on
        // the prompt row so the continue-Enter can't scroll either.
        stdout.write(`\x1b[A\x1b[${3 + aw}C${c.red("✗")}`);
        stdout.write(at(rowsT, 1) + "\x1b[K" + `${c.dim("=")} ${c.bold(entry.romaji)}  ${c.dim("· Enter")}`);
        stdout.write(at(PROMPT_ROW, 1));
        await reader.next("");
      }
    }
  } finally {
    clearInterval(poll);
    reader.close();
  }
  stdout.write("\n" + c.dim(`${correct}/${seen} this run`) + "\n");
}
