/**
 * `kanthropic learn` — teach kana from zero, row by row.
 *
 * Pick a row (a / ka / sa / … plus dakuten and yōon); for each character it
 * shows the glyph as a big image, the rōmaji, its hiragana↔katakana partner,
 * and an original shape mnemonic. Learned characters are recorded so the row
 * menu shows your progress; the drill then reinforces them with FSRS.
 */
import { stdout } from "node:process";
import { GROUPS, glyph as glyphOf } from "../data/kana.mjs";
import { mnemonicFor } from "../data/mnemonics.mjs";
import { load, save } from "../core/store.mjs";
import { ensureLearned, isMastered, resetGlyphs } from "../core/learned.mjs";
import { pickRenderer, glyphImage, glyphSixel, probeCellHeight } from "./glyphImage.mjs";
import { glyphChafa } from "./glyphChafa.mjs";
import { makeLineReader } from "./lineReader.mjs";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  accent: (s) => `\x1b[38;5;176m${s}\x1b[0m`,
};
const CLEAR = "\x1b[2J\x1b[3J\x1b[H";

/** All learnable rows across the groups, flattened with labels. */
function rowsFor(script) {
  const rows = [];
  for (const g of GROUPS) {
    for (const row of g.rows) {
      const entries = row.filter(Boolean);
      if (entries.length) rows.push({ section: g.label, entries });
    }
  }
  return rows;
}

/** Render a glyph as centered art for the active renderer. @returns {Promise<string>} */
async function glyphArt(glyph, renderer, cellPx, rows, cols) {
  try {
    if (renderer === "sixel") {
      const sx = glyphSixel(glyph, rows * cellPx);
      if (sx) {
        const wC = Math.max(1, Math.round(sx.widthPx / (cellPx / 2)));
        return " ".repeat(Math.max(0, (cols - wC) >> 1)) + sx.sixel;
      }
    } else if (renderer === "iterm") {
      const img = glyphImage(glyph, rows);
      if (img) return " ".repeat(Math.max(0, (cols - img.widthCells) >> 1)) + img.escape;
    }
    const lines = await glyphChafa(glyph, rows, cols, { symbols: "braille" });
    if (lines && lines.length) {
      const w = Math.max(...lines.map((l) => [...l].length));
      const pad = " ".repeat(Math.max(0, (cols - w) >> 1));
      return c.accent(lines.map((l) => pad + l).join("\n"));
    }
  } catch { /* fall through */ }
  return c.accent(c.bold(" ".repeat(Math.max(0, (cols >> 1) - 1)) + glyph));
}

/** @param {{ script: import("../data/kana.mjs").Script }} opts */
export async function runLearn(opts) {
  // `script`/`other` are mutable so `s` can swap scripts without leaving the
  // menu. The row layout (rowsFor) is the same for both scripts.
  let script = opts.script;
  let other = script === "hiragana" ? "katakana" : "hiragana";
  const m0 = load(); if (ensureLearned(m0)) save(m0); // existing cards count as learned
  const renderer = pickRenderer(load().config.image || "auto");
  const cellPx = renderer === "sixel" ? (await probeCellHeight()) || 20 : 20;
  const rows = rowsFor(script);
  const reader = makeLineReader();

  try {
    for (;;) {
      const store = load();
      const learned = new Set(store.learned);

      // ── row menu ──────────────────────────────────────────────────────
      stdout.write(CLEAR + `\n  ${c.accent(c.bold(`learn ${script}`))}  ${c.dim("— pick a row to study")}\n\n`);
      // Each row's icon reflects ACTUAL progress from your FSRS deck, not just
      // whether you toggled it: ✓ = every char mastered, ◐ = some progress,
      // · = not started. So drilling chars anywhere updates the list.
      let section = "";
      let masteredRows = 0;
      rows.forEach((r, i) => {
        if (r.section !== section) { section = r.section; stdout.write(`  ${c.dim(section)}\n`); }
        const glyphs = r.entries.map((e) => glyphOf(e, script));
        const mastered = glyphs.filter((g) => isMastered(store.cards[g])).length;
        const started = glyphs.filter((g) => learned.has(g) || (store.cards[g]?.seen ?? 0) > 0).length;
        let mark, frac;
        if (mastered === glyphs.length) { mark = c.green("✓"); masteredRows++; frac = ""; }
        else if (started > 0 || mastered > 0) { mark = c.accent("◐"); frac = c.dim(` ${mastered}/${glyphs.length}`); }
        else { mark = c.dim("·"); frac = ""; }
        const n = String(i + 1).padStart(2, " ");
        stdout.write(`   ${mark} ${c.bold(n)}  ${c.accent(glyphs.join(" "))}  ${c.dim(r.entries.map((e) => e.romaji).join(" "))}${frac}\n`);
      });
      stdout.write(`\n  ${c.dim(`${masteredRows}/${rows.length} rows mastered`)}  ${c.dim("·")}  `
        + `${c.green("✓")} ${c.dim("mastered")} ${c.accent("◐")} ${c.dim("learning")} ${c.dim("· new")}\n`);
      stdout.write(`  ${c.bold("number")} study · ${c.bold("-number")} reset row · `
        + `${c.bold("s")} switch to ${other} · ${c.bold("q")} quit\n  → `);

      const sel = (await reader.next(""))?.trim().toLowerCase();
      if (sel === null || sel === "q" || sel === "quit") break;
      // `s` (or naming the script) swaps without leaving the menu.
      if (sel === "s" || sel === "h" || sel === "k" || sel === other) {
        script = sel === "h" || sel === "hiragana" ? "hiragana"
          : sel === "k" || sel === "katakana" ? "katakana" : other;
        other = script === "hiragana" ? "katakana" : "hiragana";
        continue;
      }
      // `-N` resets row N: forget its cards AND pull it out of the practice
      // pool, so the row goes back to "· new" and the icon reflects that.
      if (sel.startsWith("-")) {
        const ri = parseInt(sel.slice(1), 10) - 1;
        if (ri >= 0 && ri < rows.length) {
          const fresh = load();
          resetGlyphs(fresh, rows[ri].entries.map((e) => glyphOf(e, script)));
          save(fresh);
        }
        continue;
      }
      const idx = parseInt(sel, 10) - 1;
      if (!(idx >= 0 && idx < rows.length)) continue;

      // ── walk the row ──────────────────────────────────────────────────
      const entries = rows[idx].entries;
      let quit = false;
      for (let j = 0; j < entries.length && !quit; j++) {
        const e = entries[j];
        const glyph = glyphOf(e, script);
        const partner = script === "hiragana" ? e.kata : e.hira;
        const artRows = Math.min(16, Math.max(6, (stdout.rows || 24) - 8));
        const cols = stdout.columns || 60;

        stdout.write(CLEAR + "\n");
        stdout.write(await glyphArt(glyph, renderer, cellPx, artRows, cols) + "\n\n");
        stdout.write(`  ${c.accent(c.bold(glyph))}  ${c.dim("·")}  ${c.bold(e.romaji)}`
          + `   ${c.dim(`(${other}: ${partner})`)}\n`);
        stdout.write(`  ${mnemonicFor(e, glyph)}\n\n`);
        stdout.write(c.dim(`  ${j + 1}/${entries.length}   [Enter] next  ·  [q] back to menu\n`));

        const k = (await reader.next(""))?.trim().toLowerCase();
        if (k === null || k === "q") quit = true;
      }

      // mark the row learned
      const fresh = load();
      const set = new Set(fresh.learned);
      for (const e of entries) set.add(glyphOf(e, script));
      fresh.learned = [...set];
      save(fresh);
      if (!quit) {
        stdout.write(`\n  ${c.green("✓ row complete!")} ${c.dim("Practice it with `kanthropic drill` or in a session.")}\n`);
        stdout.write(c.dim("  [Enter] back to menu\n"));
        await reader.next("");
      }
    }
  } finally {
    reader.close();
  }
  stdout.write(CLEAR);
}
