/**
 * `kanthropic study` — the typed, FSRS-scored drill you run at the idle prompt
 * (when YOU own the keyboard, not Claude). Mirrors the hypertools StudySession:
 * due-first queue, a few new cards, commit-once grading, real recall.
 *
 * @typedef {import("../data/kana.mjs").Script} Script
 */
import { stdin, stdout } from "node:process";
import { ENTRIES, glyph as glyphOf, checkAnswer, entryByGlyph } from "../data/kana.mjs";
import { load, save } from "../core/store.mjs";
import { gradeCard } from "../core/scheduler.mjs";
import { makeLineReader } from "./lineReader.mjs";

const NEW_PER_SESSION = 10;
const MAX_SESSION = 25;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  accent: (s) => `\x1b[38;5;176m${s}\x1b[0m`,
};

/** @template T @param {T[]} arr @returns {T[]} */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Due cards first, then a few new ones, capped + shuffled. Mirrors hypertools
 *  `buildQueue`. @param {Record<string, any>} cards @param {Script} script */
function buildQueue(cards, script) {
  const now = Date.now();
  const due = [];
  const fresh = [];
  for (const entry of ENTRIES) {
    const g = glyphOf(entry, script);
    const card = cards[g];
    if (!card || card.seen === 0) fresh.push(entry);
    else if (card.due <= now) due.push({ entry, due: card.due });
  }
  due.sort((a, b) => a.due - b.due);
  const queue = [...due.map((d) => d.entry), ...fresh.slice(0, NEW_PER_SESSION)];
  return shuffle(queue).slice(0, MAX_SESSION);
}

/** @param {{ script: Script, count?: number }} opts */
export async function runStudy(opts) {
  const script = opts.script;
  const store = load();
  store.config.script = script; // remember last-used script for ambient too
  let queue = buildQueue(store.cards, script);
  if (typeof opts.count === "number" && opts.count > 0) queue = queue.slice(0, opts.count);

  if (queue.length === 0) {
    save(store);
    stdout.write("\n" + c.green("✓ All caught up.") + " Nothing is due and every "
      + `${script} character has been started.\n\n`);
    return;
  }

  const reader = makeLineReader();
  stdout.write(`\n${c.accent("kanthropic")} · ${script} drill — `
    + `${queue.length} cards. Type the romaji and press Enter `
    + `(${c.dim("blank = I don't know, Ctrl+C = quit")}).\n\n`);

  let correct = 0;
  const missed = [];
  try {
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      const g = glyphOf(entry, script);
      const progress = c.dim(`${i + 1}/${queue.length}  ·  ${correct}✓`);
      const answer = await reader.next(`${progress}   ${c.accent(c.bold(g))}   → `);
      if (answer === null) {
        // stdin closed (EOF / Ctrl+D) — end the session early, keeping progress.
        stdout.write("\n");
        break;
      }

      const ok = checkAnswer(answer, entry);
      store.cards[g] = gradeCard(script, g, store.cards[g], ok);
      save(store); // persist after every card so a Ctrl+C keeps your progress

      if (ok) {
        correct++;
        stdout.write(`           ${c.green("✓ correct")}\n\n`);
      } else {
        missed.push({ glyph: g, romaji: entry.romaji });
        const shown = answer.trim() === "" ? c.dim("(skipped)") : c.red(`✗ ${answer.trim()}`);
        stdout.write(`           ${shown}  →  answer: ${c.bold(entry.romaji)}\n\n`);
      }
    }
  } finally {
    reader.close();
  }

  const total = correct + missed.length;
  stdout.write(`${c.bold("Session complete")} — ${c.green(`${correct}/${total}`)} correct. `
    + "Your schedule has been updated.\n");
  if (missed.length > 0) {
    const list = missed.map((m) => `${m.glyph}=${m.romaji}`).join("  ");
    stdout.write(c.dim(`Missed: ${list}\n`));
  }
  stdout.write("\n");
}
