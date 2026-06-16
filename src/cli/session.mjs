/**
 * `kanthropic session` — the seamless tmux layout.
 *
 * Opens a tmux session named "kanthropic" running just Claude. While Claude
 * thinks, the installed hooks SPLIT a small kana drill pane below it; when
 * Claude finishes, they CLOSE it. So the kana box pops up underneath only
 * during the dead time, then disappears:
 *
 *   idle ──submit──▶  ┌───────────────┐      ──Claude done──▶  ┌───────────────┐
 *                     │    claude     │                        │    claude     │
 *                     ├───────────────┤                        │   (full)      │
 *                     │  kana drill   │  ◀ focus here          └───────────────┘
 *                     └───────────────┘
 *
 * Re-running attaches to the existing session instead of duplicating it.
 */
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { stdout, env } from "node:process";
import { KANTHROPIC_DIR, KANA_PANE_PATH, TMUX_SESSION } from "../core/paths.mjs";

function tmuxAvailable() {
  try { execFileSync("tmux", ["-V"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

function sessionExists() {
  try { execFileSync("tmux", ["has-session", "-t", TMUX_SESSION], { stdio: "ignore" }); return true; }
  catch { return false; }
}

/**
 * Terminal-correctness hardening for the session (research Layer 3 — tmux is
 * its own width/term layer between the program and the outer terminal):
 *   - a consistent terminfo (`tmux-256color`) both sides understand;
 *   - truecolor passthrough so the glyph accent renders cleanly;
 *   - UTF-8 locale propagated into the session so block-art and any kana text
 *     can't be mangled by a non-UTF-8 LANG.
 * We don't print kana as text (we rasterize to width-1 block elements, which
 * dodges the East-Asian-Width problem entirely), so this is belt-and-braces —
 * but cheap and it makes colour + any literal kana (the status line) robust.
 */
function applyTerminalConfig(target = TMUX_SESSION) {
  const cmds = [
    ["set-option", "-t", target, "default-terminal", "tmux-256color"],
    ["set-option", "-t", target, "-ga", "terminal-overrides", ",*256col*:Tc"],
    // let inline-image escapes (iTerm2/Sixel) pass through to the outer terminal
    ["set-option", "-t", target, "allow-passthrough", "on"],
  ];
  // Propagate a UTF-8 locale to programs started in the session.
  const lang = env.LC_ALL || env.LANG || "en_US.UTF-8";
  cmds.push(["set-environment", "-t", target, "LANG", lang]);
  cmds.push(["set-environment", "-t", target, "LC_ALL", lang]);
  for (const args of cmds) {
    try { execFileSync("tmux", args, { stdio: "ignore" }); } catch { /* best-effort */ }
  }
}

/** A muted dark/violet status bar instead of tmux's blinding default green. */
export function applyTheme(target = TMUX_SESSION) {
  const opts = [
    ["status-style", "bg=colour236,fg=colour245"],
    ["window-status-current-style", "fg=colour176,bg=colour236,bold"],
    ["window-status-style", "fg=colour244,bg=colour236"],
    ["status-left-style", "fg=colour176,bg=colour236"],
    ["status-right-style", "fg=colour244,bg=colour236"],
    ["message-style", "fg=colour231,bg=colour54"],
    ["pane-active-border-style", "fg=colour176"],
    ["pane-border-style", "fg=colour238"],
  ];
  for (const [k, v] of opts) {
    try { execFileSync("tmux", ["set-option", "-t", target, k, v], { stdio: "ignore" }); }
    catch { /* best-effort theming */ }
  }
}

/** @param {string[]} [claudeArgs] forwarded to `claude` (e.g. ["--resume"]). */
export function runSession(claudeArgs = []) {
  if (!tmuxAvailable()) {
    stdout.write("\x1b[31m✗ tmux is not installed.\x1b[0m  Install it with: brew install tmux\n");
    process.exit(1);
  }

  if (!sessionExists()) {
    mkdirSync(KANTHROPIC_DIR, { recursive: true });
    writeFileSync(KANA_PANE_PATH, "", "utf8"); // clear any stale pane id

    // One pane running Claude (with any pass-through args like --resume); the
    // hooks open/close the kana pane below it.
    const claudeCmd = ["claude", ...claudeArgs].join(" ");
    execFileSync("tmux", ["new-session", "-d", "-s", TMUX_SESSION, "-n", "kanthropic"]);
    applyTerminalConfig(); // set terminfo/locale BEFORE launching claude
    applyTheme();
    execFileSync("tmux", ["send-keys", "-t", `${TMUX_SESSION}:0`, claudeCmd, "Enter"]);
    stdout.write(`\x1b[38;5;176m✓ kanthropic session ready.\x1b[0m  (\`${claudeCmd}\`)  Type a prompt — a kana `
      + "box opens below while it thinks, and closes when it's done.\n"
      + "\x1b[2m  (detach: Ctrl-b then d)\x1b[0m\n");
  } else {
    if (claudeArgs.length) {
      stdout.write("\x1b[2mA kanthropic session already exists — attaching (args ignored). "
        + "To resume there, run `claude --resume` inside the Claude pane.\x1b[0m\n");
    } else {
      stdout.write("\x1b[2mAttaching to existing kanthropic session…\x1b[0m\n");
    }
  }

  const r = spawnSync("tmux", ["attach", "-t", TMUX_SESSION], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
