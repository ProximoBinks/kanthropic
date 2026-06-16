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

      // Fixed layout via absolute positioning so Enter NEVER scrolls the glyph:
      //   row 1            header
      //   rows 2..N-2      glyph (centered)
      //   row N-1          prompt  ← Enter lands on the spare row below, no scroll
      //   row N            spare / miss reading
      const PROMPT_ROW = Math.max(2, rowsT - 1);
      const areaTop = 2, areaBot = PROMPT_ROW - 1;
      const areaH = Math.max(1, areaBot - areaTop + 1);
      const renderRows = Math.min(areaH, MAX_GLYPH_ROWS);
      const maxW = Math.max(8, Math.min(cols - 2, MAX_GLYPH_COLS));

      stdout.write(CLEAR);
      stdout.write(at(1, 1) + `${dot} ${c.dim(`${script} · ${correct}/${seen}`)}`);

      let drew = false;
      if (renderer === "sixel") {
        const sx = glyphSixel(next.glyph, renderRows * cellPx);
        if (sx) {
          const hC = Math.min(areaH, Math.max(1, Math.round(sx.heightPx / cellPx)));
          const wC = Math.max(1, Math.round(sx.widthPx / (cellPx / 2)));
          const gRow = areaTop + Math.max(0, Math.floor((areaH - hC) / 2));
          const gCol = 1 + Math.max(0, Math.floor((cols - wC) / 2));
          stdout.write(at(gRow, gCol) + sx.sixel);
          drew = true;
        }
      } else if (renderer === "iterm") {
        const img = glyphImage(next.glyph, renderRows);
        if (img) {
          const gRow = areaTop + Math.max(0, Math.floor((areaH - renderRows) / 2));
          const gCol = 1 + Math.max(0, Math.floor((cols - img.widthCells) / 2));
          stdout.write(at(gRow, gCol) + img.escape);
          drew = true;
        }
      }
      if (!drew) {
        const art = bigGlyph(next.glyph, renderRows, maxW, store.config.glyphStyle);
        const lines = art || [next.glyph];
        const gRow = areaTop + Math.max(0, Math.floor((areaH - lines.length) / 2));
        for (let i = 0; i < lines.length; i++) {
          const w = [...lines[i]].length;
          stdout.write(at(gRow + i, 1 + Math.max(0, Math.floor((cols - w) / 2))) + c.accent(lines[i]));
        }
      }

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
