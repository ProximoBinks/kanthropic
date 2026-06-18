/**
 * `kanthropic reset` — wipe kana progress for a clean slate.
 *
 *   kanthropic reset                  reset BOTH scripts (asks first)
 *   kanthropic reset --script kata     reset just katakana
 *   kanthropic reset --yes            skip the confirmation
 *
 * Resetting forgets the FSRS deck and empties the learned pool for the scope,
 * so the `learn` list shows those rows as "· new" again. Config is untouched.
 */
import { stdout } from "node:process";
import { ENTRIES, glyph as glyphOf } from "../data/kana.mjs";
import { load, save } from "../core/store.mjs";
import { resetGlyphs } from "../core/learned.mjs";
import { makeLineReader } from "./lineReader.mjs";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

/** Glyphs in scope: one script, or both when `script` is null. */
function scopeGlyphs(script) {
  const scripts = script ? [script] : ["hiragana", "katakana"];
  const out = [];
  for (const s of scripts) for (const e of ENTRIES) out.push(glyphOf(e, s));
  return out;
}

/** @param {{ script?: import("../data/kana.mjs").Script | null, yes?: boolean }} opts */
export async function runReset(opts = {}) {
  const script = opts.script || null;
  const label = script || "all kana (hiragana + katakana)";
  const glyphs = scopeGlyphs(script);

  // Count what's actually there so the prompt is honest about the damage: a
  // glyph counts if it's been drilled OR is just sitting in the learned pool.
  const store0 = load();
  const pool = new Set(store0.learned || []);
  const have = glyphs.filter((g) => pool.has(g) || (store0.cards[g]?.seen ?? 0) > 0).length;
  if (have === 0) {
    stdout.write(`${c.dim("Nothing to reset for")} ${c.bold(label)}${c.dim(".")}\n`);
    return;
  }

  if (!opts.yes) {
    const reader = makeLineReader();
    stdout.write(`${c.red("⚠")}  This forgets ${c.bold(`${have} learned ${label}`)} `
      + `${c.dim("(FSRS progress + the learned pool). This can't be undone.")}\n`);
    const ans = (await reader.next(`   Type ${c.bold("yes")} to confirm → `))?.trim().toLowerCase();
    reader.close();
    if (ans !== "yes" && ans !== "y") { stdout.write(c.dim("Cancelled.\n")); return; }
  }

  const store = load();
  const n = resetGlyphs(store, glyphs);
  save(store);
  stdout.write(`${c.green("✓")} reset ${c.bold(`${n} ${label}`)}. `
    + c.dim("Run `kanthropic learn` to start again.\n"));
}
