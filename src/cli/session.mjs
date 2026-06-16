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
import { stdout } from "node:process";
import { KANTHROPIC_DIR, KANA_PANE_PATH, TMUX_SESSION } from "../core/paths.mjs";

function tmuxAvailable() {
  try { execFileSync("tmux", ["-V"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

function sessionExists() {
  try { execFileSync("tmux", ["has-session", "-t", TMUX_SESSION], { stdio: "ignore" }); return true; }
  catch { return false; }
}

export function runSession() {
  if (!tmuxAvailable()) {
    stdout.write("\x1b[31m✗ tmux is not installed.\x1b[0m  Install it with: brew install tmux\n");
    process.exit(1);
  }

  if (!sessionExists()) {
    mkdirSync(KANTHROPIC_DIR, { recursive: true });
    writeFileSync(KANA_PANE_PATH, "", "utf8"); // clear any stale pane id

    // One pane running Claude; the hooks open/close the kana pane below it.
    execFileSync("tmux", ["new-session", "-d", "-s", TMUX_SESSION, "-n", "kanthropic"]);
    execFileSync("tmux", ["send-keys", "-t", `${TMUX_SESSION}:0`, "claude", "Enter"]);
    stdout.write("\x1b[38;5;176m✓ kanthropic session ready.\x1b[0m  Type a prompt in Claude — a kana "
      + "box opens below while it thinks, and closes when it's done.\n"
      + "\x1b[2m  (detach: Ctrl-b then d)\x1b[0m\n");
  } else {
    stdout.write("\x1b[2mAttaching to existing kanthropic session…\x1b[0m\n");
  }

  const r = spawnSync("tmux", ["attach", "-t", TMUX_SESSION], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
