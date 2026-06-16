/** Filesystem locations kanthropic reads and writes. Centralized so the
 *  installer, the store, and the generated status-line script agree. */
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();

/** Our private directory — progress, generated status-line script, backups. */
export const KANTHROPIC_DIR = join(home, ".kanthropic");

/** The local FSRS/progress store the drill writes and the ambient tick reads. */
export const PROGRESS_PATH = join(KANTHROPIC_DIR, "progress.json");

/** The status-line script the installer generates and Claude Code runs. */
export const STATUSLINE_SCRIPT_PATH = join(KANTHROPIC_DIR, "kanthropic-statusline.mjs");

/** A captured pre-existing user statusLine (chain-capture), so we stack the
 *  card above the user's own HUD instead of clobbering it. */
export const PREV_STATUSLINE_PATH = join(KANTHROPIC_DIR, "prev-statusline.json");

/** Tiny file the Claude hooks write ("thinking"/"idle") and the drill watches,
 *  so the side-pane input box reacts to whether Claude is working. */
export const SESSION_STATE_PATH = join(KANTHROPIC_DIR, "session-state.json");

/** tmux pane IDs the `session` launcher records, so the hooks can switch focus
 *  to the right pane regardless of the user's tmux base-index config. */
export const KANA_PANE_PATH = join(KANTHROPIC_DIR, "kana-pane");
export const CLAUDE_PANE_PATH = join(KANTHROPIC_DIR, "claude-pane");

/** The tmux session name the launcher and hooks share. */
export const TMUX_SESSION = "kanthropic";

/** Claude Code's settings file — the surface we edit. */
export const CLAUDE_SETTINGS_PATH = join(home, ".claude", "settings.json");

/** One-time byte-exact backup of settings.json from first install. */
export const CLAUDE_SETTINGS_BACKUP_PATH = join(KANTHROPIC_DIR, "settings.backup.json");

/** Sentinel written to the backup when settings.json did not exist before us,
 *  so uninstall knows to delete the shell we created rather than restore one. */
export const ABSENT_SENTINEL = "__KANTHROPIC_ABSENT__";
