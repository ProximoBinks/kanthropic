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
import { glyphImage, glyphSixel, pickRenderer, probeCellHeight } from "./glyphImage.mjs";

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
  if (typeof flags.image === "string" && ["on", "off", "auto"].includes(flags.image)) store.config.image = flags.image;
  if (flags.advance === "on" || flags.advance === true) store.config.autoAdvance = true;
  if (flags.advance === "off") store.config.autoAdvance = false;
  save(store);
  stdout.write(`${green("✓")} config: script=${store.config.script} `
    + `image=${store.config.image} advance=${store.config.autoAdvance ? "on" : "off"} `
    + `front=${store.config.frontMs}ms back=${store.config.backMs}ms\n`);
}

async function cmdImageTest(rest) {
  const ch = rest.find((a) => !a.startsWith("--")) || "ば";
  const renderer = pickRenderer("on"); // force an image attempt for the test
  stdout.write(`\n${accent("imagetest")} — rendering ${bold(ch)} via ${bold(renderer)}:\n\n`);
  if (renderer === "sixel") {
    const cellPx = (await probeCellHeight()) || 20;
    const sx = glyphSixel(ch, 10 * cellPx);
    if (!sx) { stdout.write(dim("(no Japanese font found)\n")); return; }
    stdout.write(sx.sixel + "\n\n");
  } else {
    const img = glyphImage(ch, 10);
    if (!img) { stdout.write(dim("(no Japanese font found)\n")); return; }
    stdout.write(img.escape + "\n\n");
  }
  stdout.write(`If you see a crisp ${bold(ch)} above, images work here — turn them on with:\n`);
  stdout.write(`  ${bold("kanthropic config --image on")}  ${dim("(or leave --image auto)")}\n`);
  stdout.write(dim(`\nIf you see garbled text instead:\n`
    + `  • VS Code / Antigravity: enable "terminal.integrated.enableImages", reload.\n`
    + `  • Inside tmux you need a sixel-enabled tmux (yours is); the session uses sixel.\n`
    + `  • Fall back any time with:  kanthropic config --image off\n`));
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
    + `  ${bold("session")} [name] [args] seamless tmux layout; a name = a separate window (args→claude)\n`
    + `  ${bold("drill")} [--script k]   endless kana input box for a side pane (reacts to Claude)\n`
    + `  ${bold("study")} [--script k]   typed, scored session — run at the idle prompt\n`
    + `  ${bold("hooks-install")}        wire Claude hooks (state + tmux focus switch)\n`
    + `  ${bold("hooks-uninstall")}      remove those hooks\n`
    + `  ${bold("status")}               show install state + your progress\n`
    + `  ${bold("config")} [--image m]   set script / image mode (on|off|auto) / timing\n`
    + `  ${bold("imagetest")} [glyph]    test image rendering here (else it uses chafa braille)\n`
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
      // Pass a script only when --script is explicit; otherwise let the drill
      // resolve it (auto-advance hiragana → katakana once hiragana is mastered).
      await runDrill({ script: flags.script ? scriptFrom(flags, "hiragana") : undefined });
      break;
    case "session": {
      // `session [name] [claude args]` — a leading non-flag token names the
      // session (kanthropic-<name>); the rest pass through to claude.
      let sName, cArgs;
      if (rest[0] && !rest[0].startsWith("-")) { sName = rest[0]; cArgs = rest.slice(1); }
      else { cArgs = rest; }
      runSession(sName, cArgs);
      break;
    }
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
    case "imagetest": await cmdImageTest(rest); break;
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
