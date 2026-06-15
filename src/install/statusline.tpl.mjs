/**
 * kanthropic ambient status line — GENERATED. Do not edit here; edit the
 * template in the kanthropic package and re-run `kanthropic install`.
 *
 * Claude Code runs this on every status-line refresh (which happens often
 * while it's thinking). Each run is an independent, stateless tick: it reads
 * ~/.kanthropic/progress.json, derives the flip phase from wall-clock
 * timestamps, advances to a new weighted card when the current one's window
 * elapses, and prints one line. No server, no clicks, no browser.
 *
 * Prime directive: NEVER break Claude Code's status line. Every path is
 * guarded; on any error we print nothing (or whatever the chained HUD gave us)
 * and exit 0.
 *
 * `__PKG_SRC__` is substituted by the installer with the absolute path to the
 * package `src/` dir so these imports resolve regardless of cwd.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pickNext } from "__PKG_SRC__/core/ambient.mjs";
import { load, save } from "__PKG_SRC__/core/store.mjs";
import { entryByGlyph } from "__PKG_SRC__/data/kana.mjs";
import { PREV_STATUSLINE_PATH } from "__PKG_SRC__/core/paths.mjs";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const ACCENT = "\x1b[38;5;176m"; // soft violet, matches the hypertools accent
const RESET = "\x1b[0m";

/** Render the ambient card line, or "" on any failure. @returns {string} */
function cardLine() {
  try {
    const store = load();
    const cfg = store.config;
    const script = cfg.script;
    const frontMs = cfg.frontMs;
    const total = cfg.frontMs + cfg.backMs;
    const now = Date.now();

    let amb = store.ambient;
    const expired = !amb || !amb.glyph || amb.script !== script
      || (now - amb.shownAt) >= total;

    if (expired) {
      const next = pickNext(script, store.cards, amb?.glyph ?? null, now);
      if (!next) return "";
      amb = { script, glyph: next.glyph, shownAt: now };
      store.ambient = amb;
      save(store); // only write when the card actually advances (no per-tick churn)
    }

    const elapsed = now - amb.shownAt;
    const entry = entryByGlyph(script, amb.glyph);
    const romaji = entry ? entry.romaji : "";

    if (elapsed < frontMs) {
      // Front: glyph only — recall it in your head.
      return `${ACCENT}${BOLD}${amb.glyph}${RESET}   ${DIM}kana · recall…${RESET}`;
    }
    // Back: reveal the answer.
    return `${ACCENT}${BOLD}${amb.glyph}${RESET} ${DIM}→${RESET} ${BOLD}${romaji}${RESET}`;
  } catch {
    return "";
  }
}

/** If the user had their own statusLine before install, run it and return its
 *  output so we can stack the card ABOVE it. Bounded + never throws.
 *  @returns {string} */
function chainedHud() {
  try {
    const sl = JSON.parse(readFileSync(PREV_STATUSLINE_PATH, "utf8")).statusLine;
    const cmd = sl && sl.type === "command" && typeof sl.command === "string" ? sl.command : "";
    if (!cmd || cmd.includes("kanthropic-statusline")) return "";
    const r = spawnSync(cmd, {
      shell: true, windowsHide: true, timeout: 2000,
      stdio: ["inherit", "pipe", "ignore"], encoding: "utf8",
    });
    return (r.stdout || "").replace(/[\r\n]+$/, "");
  } catch {
    return "";
  }
}

try {
  const card = cardLine();
  const hud = chainedHud();
  const out = [card, hud].filter((s) => s.length > 0).join("\n");
  if (out) process.stdout.write(out + "\n");
} catch {
  /* prime directive: never break the status line */
}
