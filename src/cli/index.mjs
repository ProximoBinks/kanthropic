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
import { execFileSync } from "node:child_process";
import { ENTRIES, glyph as glyphOf } from "../data/kana.mjs";
import { load, save } from "../core/store.mjs";
import { pickNext } from "../core/ambient.mjs";
import { install, uninstall, isInstalled } from "../install/install.mjs";
import { installHooks, uninstallHooks, hooksInstalled } from "../core/hooks.mjs";
import { getFont } from "./font.mjs";
import { runDrill } from "./drill.mjs";
import { runSession, listKanthropicSessions, killKanthropicSessions } from "./session.mjs";
import { TMUX_SESSION } from "../core/paths.mjs";
import { makeLineReader } from "./lineReader.mjs";
import { runLearn } from "./learn.mjs";
import { runReset } from "./reset.mjs";
import { glyphImage, glyphSixel, pickRenderer, probeCellHeight } from "./glyphImage.mjs";
import { glyphChafa } from "./glyphChafa.mjs";

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
  if (flags.continuous === "on" || flags.continuous === true) store.config.continuous = true;
  if (flags.continuous === "off") store.config.continuous = false;
  save(store);
  stdout.write(`${green("✓")} config: script=${store.config.script} `
    + `image=${store.config.image} advance=${store.config.autoAdvance ? "on" : "off"} `
    + `continuous=${store.config.continuous ? "on" : "off"} `
    + `front=${store.config.frontMs}ms back=${store.config.backMs}ms\n`);
}

/** `sessions` — list running kanthropic tmux sessions; `sessions clear` kills
 *  them all (and cleans their pane files). `--yes`/`-y` skips the prompt. */
async function cmdSessions(rest) {
  const verb = rest.find((a) => !a.startsWith("-"));
  const clearing = ["clear", "clean", "cleanse", "kill"].includes(verb || "");
  const yes = rest.includes("--yes") || rest.includes("-y");
  const sessions = listKanthropicSessions();

  if (clearing) {
    if (!sessions.length) {
      killKanthropicSessions(); // still tidy up any stale pane files
      stdout.write(dim("No kanthropic sessions running — nothing to clear.\n"));
      return;
    }
    if (!yes) {
      const reader = makeLineReader();
      stdout.write(`This ends ${bold(`${sessions.length} session${sessions.length === 1 ? "" : "s"}`)} `
        + dim("(and the Claude running in each):\n"));
      for (const s of sessions) stdout.write(`  • ${s}\n`);
      const ans = (await reader.next(`Clear all? ${dim("[y/N]")} `))?.trim().toLowerCase();
      reader.close();
      if (ans !== "y" && ans !== "yes") { stdout.write(dim("Cancelled.\n")); return; }
    }
    const killed = killKanthropicSessions();
    stdout.write(`${green("✓")} cleared ${bold(`${killed.length} session${killed.length === 1 ? "" : "s"}`)}. `
      + dim("(Your kana progress and Claude history are kept.)\n"));
    return;
  }

  if (!sessions.length) { stdout.write(`\n${dim("No kanthropic sessions running.")}\n`); return; }
  stdout.write(`\n${accent("kanthropic sessions")}\n`);
  for (const s of sessions) stdout.write(`  • ${bold(s)}\n`);
  const first = sessions[0] === TMUX_SESSION ? "" : ` ${sessions[0].slice(TMUX_SESSION.length + 1)}`;
  stdout.write(dim(`\n  Attach:     kanthropic session${first}\n`)
    + dim(`  Clear all:  kanthropic sessions clear\n`));
}

async function cmdImageTest(rest) {
  const flags = parseFlags(rest);
  const ch = rest.find((a) => !a.startsWith("--")) || "ば";
  // `--via sixel|iterm|chafa` forces a specific renderer; otherwise auto-detect.
  const via = ["sixel", "iterm", "chafa"].includes(flags.via) ? flags.via : pickRenderer("on");
  stdout.write(`\n${accent("imagetest")} — rendering ${bold(ch)} via ${bold(via)}:\n\n`);
  if (via === "sixel") {
    const cellPx = (await probeCellHeight()) || 20;
    const sx = glyphSixel(ch, 10 * cellPx);
    if (!sx) { stdout.write(dim("(no Japanese font found)\n")); return; }
    stdout.write(sx.sixel + "\n\n");
  } else if (via === "chafa") {
    let lines = null;
    try { lines = await glyphChafa(ch, 12, 40, { symbols: "braille" }); }
    catch (e) { stdout.write(dim(`(chafa failed: ${e?.message ?? e})\n`)); return; }
    stdout.write(accent((lines || ["(no Japanese font found)"]).join("\n")) + "\n\n");
  } else {
    const img = glyphImage(ch, 10);
    if (!img) { stdout.write(dim("(no Japanese font found)\n")); return; }
    stdout.write(img.escape + "\n\n");
  }
  stdout.write(dim(`Force a specific one:  kanthropic imagetest ${ch} --via sixel|iterm|chafa\n`)
    + dim(`  • sixel  — real image inside a sixel-enabled tmux (the session)\n`)
    + dim(`  • iterm  — real image in a standalone iTerm2/Sixel terminal\n`)
    + dim(`  • chafa  — braille symbol-art fallback (works anywhere)\n`));
}

const ok = (s) => `${green("✓")} ${s}`;
const warn = (s) => `\x1b[33m⚠\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;

/** Run a shell check, returning trimmed stdout or null on failure. */
function sh(cmd) {
  try { return execFileSync("sh", ["-c", cmd], { encoding: "utf8" }).trim(); }
  catch { return null; }
}

/** Environment check — what works, what to fix. Never changes anything. */
function cmdDoctor() {
  stdout.write(`\n${accent("kanthropic doctor")} — environment check\n\n`);

  const major = +process.versions.node.split(".")[0];
  stdout.write("  " + (major >= 18 ? ok(`node ${process.version}`) : bad(`node ${process.version} (need ≥ 18)`)) + "\n");
  stdout.write("  " + (getFont() ? ok("kana font loaded (bundled — no install needed)") : bad("no kana font could be loaded")) + "\n");
  stdout.write("  " + (sh("command -v claude") ? ok("claude CLI on PATH") : warn("claude CLI not found on PATH")) + "\n");

  const tmuxV = sh("tmux -V");
  if (!tmuxV) {
    stdout.write("  " + warn("tmux not installed — needed for `kanthropic session` (brew install tmux)") + "\n");
  } else {
    const sixel = sh('strings "$(command -v tmux)" 2>/dev/null | grep -qi sixel && echo yes');
    stdout.write("  " + ok(tmuxV) + "\n");
    stdout.write("    " + (sixel
      ? ok("built with sixel → real images render in the session")
      : warn("built WITHOUT sixel → the session uses chafa braille (rebuild tmux for images)")) + "\n");
  }

  const tp = process.env.TERM_PROGRAM || "(unknown)";
  const imgTerm = ["vscode", "iTerm.app", "WezTerm", "rio", "mintty"].includes(tp);
  stdout.write("  " + (imgTerm
    ? ok(`terminal: ${tp} (can show inline images)`)
    : warn(`terminal: ${tp} (may not show inline images → chafa braille)`)) + "\n");
  if (tp === "vscode") {
    stdout.write("    " + dim('VS Code / Antigravity: set "terminal.integrated.enableImages": true → Reload Window → new terminal') + "\n");
  }

  stdout.write("  " + (isInstalled() ? ok("status line installed") : warn("status line not installed (run `kanthropic setup`)")) + "\n");
  stdout.write("  " + (hooksInstalled() ? ok("session hooks installed") : warn("hooks not installed (run `kanthropic setup`)")) + "\n");

  const cfg = load().config;
  stdout.write("  " + dim(`config: image=${cfg.image}  script=${cfg.script}`) + "\n\n");
}

/** One-shot: install the status line + hooks, then print the doctor + next steps. */
function cmdSetup() {
  stdout.write(`\n${accent("kanthropic setup")}\n`);
  const r1 = install();
  stdout.write("  " + (r1.ok ? ok("status line installed") : bad(r1.reason)) + "\n");
  const r2 = installHooks();
  stdout.write("  " + (r2.ok ? ok("session hooks installed") : bad(r2.reason)) + "\n");
  cmdDoctor();
  stdout.write(`${bold("Next:")}\n`
    + `  1. Crisp images (VS Code / Antigravity): set ${bold('"terminal.integrated.enableImages": true')},\n`
    + `     then ${bold("Developer: Reload Window")}, then open a new terminal.\n`
    + `  2. Start it:  ${bold("kanthropic session")}\n`
    + dim(`     (No image support? It still works — falls back to chafa braille.)\n\n`)
    + `${bold("Leaving the session:")}\n`
    + `  • Step away (keep it running):  ${bold("Ctrl-b")} then ${bold("d")}  ${dim("(detach → `kanthropic session` to return)")}\n`
    + `  • End it for good:  quit Claude (${bold("Ctrl-C")} / ${bold("/exit")}), then type ${bold("exit")}\n\n`);
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
    + `  ${bold("setup")}                install everything + print an environment check\n`
    + `  ${bold("doctor")}               environment check (what works, what to fix)\n`
    + `  ${bold("install")}              add the ambient flashcard line to Claude Code\n`
    + `  ${bold("uninstall")}            remove it (restores any prior status line)\n`
    + `  ${bold("learn")} [--script k]   learn kana from zero, row by row (image + mnemonic)\n`
    + `  ${bold("session")} [name] [args] seamless tmux layout; a name = a separate window (args→claude)\n`
    + `  ${bold("sessions")} [clear]      list running sessions, or ${bold("clear")} to end them all\n`
    + `  ${bold("drill")} [--count N]    practice your learned kana (endless, or N for a scored session)\n`
    + `  ${bold("reset")} [--script k]   wipe progress for a clean slate (asks first; --yes to skip)\n`
    + `  ${bold("hooks-install")}        wire Claude hooks (state + tmux focus switch)\n`
    + `  ${bold("hooks-uninstall")}      remove those hooks\n`
    + `  ${bold("status")}               show install state + your progress\n`
    + `  ${bold("config")} [--image m]   set script / image / ${bold("--continuous on|off")} (never stop) / timing\n`
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
    case "learn":
      await runLearn({ script: scriptFrom(flags, store.config.script) });
      break;
    case "drill":
      // Pass a script only when --script is explicit; otherwise let the drill
      // resolve it (auto-advance hiragana → katakana once hiragana is mastered).
      // --count N runs a bounded, scored session (the old `study`).
      await runDrill({
        script: flags.script ? scriptFrom(flags, "hiragana") : undefined,
        count: flags.count ? +flags.count : undefined,
      });
      break;
    case "reset":
      // No --script → both scripts. --yes/-y skips the confirmation.
      await runReset({
        script: flags.script ? scriptFrom(flags, "hiragana") : null,
        yes: flags.yes === true || rest.includes("-y"),
      });
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
    case "sessions": await cmdSessions(rest); break;
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
    case "setup": cmdSetup(); break;
    case "doctor": cmdDoctor(); break;
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
