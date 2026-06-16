#!/usr/bin/env node
/**
 * kanthropic CLI — command router.
 *
 *   kanthropic install            Add the ambient flashcard line to Claude Code.
 *   kanthropic uninstall          Remove it, restoring any prior status line.
 *   kanthropic study [opts]       Typed, FSRS-scored drill (run at the idle prompt).
 *   kanthropic status             Show install state + your progress.
 *   kanthropic config [opts]      Set default script / flip timing.
 *   kanthropic preview            Print a few sample ambient lines.
 *
 * Options: --script hiragana|katakana   --count N   --front <ms>   --back <ms>
 */
import { stdout } from "node:process";
import { ENTRIES, glyph as glyphOf } from "../data/kana.mjs";
import { load, save } from "../core/store.mjs";
import { pickNext } from "../core/ambient.mjs";
import { install, uninstall, isInstalled } from "../install/install.mjs";
import { installHooks, uninstallHooks, hooksInstalled } from "../core/hooks.mjs";
import { runStudy } from "./study.mjs";
import { runDrill } from "./drill.mjs";
import { runSession } from "./session.mjs";

const accent = (s) => `\x1b[38;5;176m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

/** @param {string[]} argv @returns {Record<string, string|boolean>} */
function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

/** @param {Record<string, any>} flags @returns {"hiragana"|"katakana"} */
function scriptFrom(flags, fallback) {
  const s = flags.script;
  if (s === "katakana" || s === "kata" || s === "k") return "katakana";
  if (s === "hiragana" || s === "hira" || s === "h") return "hiragana";
  return fallback;
}

function cmdStatus() {
  const store = load();
  const installed = isInstalled();
  stdout.write(`\n${accent("kanthropic")} — ambient kana while Claude thinks\n\n`);
  stdout.write(`  status line : ${installed ? green("installed") : dim("not installed")}`
    + `${installed ? "" : "  (run " + bold("kanthropic install") + ")"}\n`);
  const hooks = hooksInstalled();
  stdout.write(`  panel hooks : ${hooks ? green("installed") : dim("not installed")}`
    + `${hooks ? "" : "  (run " + bold("kanthropic hooks-install") + ")"}\n`);
  stdout.write(`  default     : ${store.config.script}  `
    + dim(`(flip ${store.config.frontMs}ms / ${store.config.backMs}ms)`) + "\n");

  const now = Date.now();
  for (const script of /** @type {const} */ (["hiragana", "katakana"])) {
    let total = 0, seen = 0, due = 0, weak = 0;
    for (const entry of ENTRIES) {
      total++;
      const card = store.cards[glyphOf(entry, script)];
      if (card && card.seen > 0) {
        seen++;
        if (card.due <= now) due++;
        if (card.misses > 0) weak++;
      }
    }
    stdout.write(`  ${script.padEnd(9)} : ${seen}/${total} started · `
      + `${due} due · ${weak} flagged\n`);
  }
  stdout.write("\n");
}

function cmdConfig(flags) {
  const store = load();
  if (flags.script) store.config.script = scriptFrom(flags, store.config.script);
  if (flags.front && !isNaN(+flags.front)) store.config.frontMs = +flags.front;
  if (flags.back && !isNaN(+flags.back)) store.config.backMs = +flags.back;
  save(store);
  stdout.write(`${green("✓")} config: script=${store.config.script} `
    + `front=${store.config.frontMs}ms back=${store.config.backMs}ms\n`);
}

function cmdPreview(flags) {
  const store = load();
  const script = scriptFrom(flags, store.config.script);
  stdout.write(`\n${dim("Sample ambient lines (" + script + "):")}\n\n`);
  let avoid = null;
  for (let i = 0; i < 6; i++) {
    const next = pickNext(script, store.cards, avoid);
    if (!next) break;
    avoid = next.glyph;
    stdout.write(`  ${accent(bold(next.glyph))}   ${dim("recall…")}\n`);
    stdout.write(`  ${accent(bold(next.glyph))} ${dim("→")} ${bold(next.romaji)}\n\n`);
  }
}

function help() {
  stdout.write(`\n${accent("kanthropic")} — learn kana in the dead time while Claude Code thinks\n\n`
    + `  ${bold("install")}              add the ambient flashcard line to Claude Code\n`
    + `  ${bold("uninstall")}            remove it (restores any prior status line)\n`
    + `  ${bold("session")} [claude args] seamless tmux layout (forwards args, e.g. --resume, to claude)\n`
    + `  ${bold("drill")} [--script k]   endless kana input box for a side pane (reacts to Claude)\n`
    + `  ${bold("study")} [--script k]   typed, scored session — run at the idle prompt\n`
    + `  ${bold("hooks-install")}        wire Claude hooks (state + tmux focus switch)\n`
    + `  ${bold("hooks-uninstall")}      remove those hooks\n`
    + `  ${bold("status")}               show install state + your progress\n`
    + `  ${bold("config")} [--front ms]  set default script / flip timing\n`
    + `  ${bold("preview")}              print a few sample ambient lines\n\n`
    + dim("  options: --script hiragana|katakana  --count N  --front <ms>  --back <ms>\n\n"));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const store = load();

  switch (cmd) {
    case "install": {
      const r = install();
      if (!r.ok) { stdout.write(`\x1b[31m✗ ${r.reason}\x1b[0m\n`); process.exit(1); }
      stdout.write(`${green("✓ installed.")} Your kana progress now shows in the Claude Code `
        + `status line and updates as you drill.\n`);
      if (r.chained) stdout.write(dim("  Your existing status line was preserved and stacks below.\n"));
      stdout.write(dim("  Start a new `claude` session (or `kanthropic session`) to see it.\n"));
      break;
    }
    case "uninstall": {
      const r = uninstall();
      if (!r.ok) { stdout.write(`\x1b[31m✗ ${r.reason}\x1b[0m\n`); process.exit(1); }
      stdout.write(`${green("✓ removed.")} Claude Code's status line is back to how it was. `
        + dim("(Your progress is kept.)\n"));
      break;
    }
    case "study":
      await runStudy({ script: scriptFrom(flags, store.config.script), count: flags.count ? +flags.count : undefined });
      break;
    case "drill":
      await runDrill({ script: scriptFrom(flags, store.config.script) });
      break;
    case "session":
      runSession(rest); // forward args (e.g. --resume, --continue) to claude
      break;
    case "hooks-install": {
      const r = installHooks();
      if (!r.ok) { stdout.write(`\x1b[31m✗ ${r.reason}\x1b[0m\n`); process.exit(1); }
      stdout.write(`${green("✓ hooks installed.")} Focus will auto-switch to kana while Claude thinks `
        + `(inside ${bold("kanthropic session")}), and the drill's ${bold("●")} dot lights up.\n`);
      stdout.write(dim("  Start it with: kanthropic session\n"));
      break;
    }
    case "hooks-uninstall": {
      const r = uninstallHooks();
      if (!r.ok) { stdout.write(`\x1b[31m✗ ${r.reason}\x1b[0m\n`); process.exit(1); }
      stdout.write(`${green("✓ hooks removed.")} ${dim("(Your other hooks, if any, were kept.)")}\n`);
      break;
    }
    case "status": cmdStatus(); break;
    case "config": cmdConfig(flags); break;
    case "preview": cmdPreview(flags); break;
    case undefined:
    case "help":
    case "--help":
    case "-h": help(); break;
    default:
      stdout.write(`Unknown command: ${cmd}\n`);
      help();
      process.exit(1);
  }
}

main().catch((e) => {
  stdout.write(`\x1b[31m✗ ${e?.message ?? e}\x1b[0m\n`);
  process.exit(1);
});
