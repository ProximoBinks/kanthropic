/**
 * `kanthropic session` — the seamless tmux layout.
 *
 * Opens one tmux window with two panes:
 *   ┌─────────────┬─────────────┐
 *   │   claude    │  kanthropic │
 *   │  (left)     │    drill    │
 *   └─────────────┴─────────────┘
 * and records each pane's tmux id so the Claude hooks can auto-switch focus:
 * submit a prompt → focus jumps to the kana pane → Claude finishes → focus
 * jumps back to Claude. No manual pane switching.
 *
 * Re-running attaches to an existing session instead of duplicating it.
 */
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { stdout } from "node:process";
import {
  KANTHROPIC_DIR, KANA_PANE_PATH, CLAUDE_PANE_PATH, TMUX_SESSION,
} from "../core/paths.mjs";

/** @param {string[]} args @returns {string} */
function tmux(args) {
  return execFileSync("tmux", args, { encoding: "utf8" }).trim();
}

function tmuxAvailable() {
  try { execFileSync("tmux", ["-V"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

function sessionExists() {
  try { execFileSync("tmux", ["has-session", "-t", TMUX_SESSION], { stdio: "ignore" }); return true; }
  catch { return false; }
}

/** @param {{ script: import("../data/kana.mjs").Script }} opts */
export function runSession(opts) {
  if (!tmuxAvailable()) {
    stdout.write("\x1b[31m✗ tmux is not installed.\x1b[0m  Install it with: brew install tmux\n");
    process.exit(1);
  }

  if (!sessionExists()) {
    const script = opts.script;
    mkdirSync(KANTHROPIC_DIR, { recursive: true });

    // Create the session detached, with the Claude pane on the left.
    tmux(["new-session", "-d", "-s", TMUX_SESSION, "-n", "kanthropic"]);
    const claudePane = tmux(["display-message", "-p", "-t", `${TMUX_SESSION}:0`, "#{pane_id}"]);

    // Split off the kana pane on the right and capture its id.
    const kanaPane = tmux(["split-window", "-h", "-P", "-F", "#{pane_id}", "-t", `${TMUX_SESSION}:0`]);

    // Record pane ids for the hooks to target (robust to tmux index config).
    writeFileSync(CLAUDE_PANE_PATH, claudePane, "utf8");
    writeFileSync(KANA_PANE_PATH, kanaPane, "utf8");

    // Launch the two programs.
    tmux(["send-keys", "-t", kanaPane, `kanthropic drill --script ${script}`, "Enter"]);
    tmux(["send-keys", "-t", claudePane, "claude", "Enter"]);

    // Start focused on Claude so you type your first prompt there.
    tmux(["select-pane", "-t", claudePane]);
    stdout.write(`\x1b[38;5;176m✓ kanthropic session ready.\x1b[0m  Type a prompt in Claude — `
      + `focus will jump to kana while it thinks.\n\x1b[2m  (detach: Ctrl-b then d · quit: close both panes)\x1b[0m\n`);
  } else {
    stdout.write("\x1b[2mAttaching to existing kanthropic session…\x1b[0m\n");
  }

  // Hand the terminal over to tmux (inherits the TTY).
  const r = spawnSync("tmux", ["attach", "-t", TMUX_SESSION], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
