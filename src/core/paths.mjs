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

/** Legacy single-file thinking/idle state (pre per-session hooks). Still read
 *  as a fallback so old installed hooks keep lighting the dot up. */
export const SESSION_STATE_PATH = join(KANTHROPIC_DIR, "session-state.json");

/** Per-Claude-session thinking/idle state, one file per session_id — written
 *  by the hooks for EVERY Claude session (tmux or not), so `kanthropic watch`
 *  and the standalone drill can react without any tmux involved. */
export const STATE_DIR = join(KANTHROPIC_DIR, "state");

/** Per-session state lives here, keyed by tmux session name, so multiple
 *  concurrent `kanthropic session` windows each track their own kana pane. */
export const SESSIONS_DIR = join(KANTHROPIC_DIR, "sessions");
export function sessionPanePath(name) { return join(SESSIONS_DIR, `${name}.pane`); }

/** The default tmux session name. Named sessions are `kanthropic-<name>`; the
 *  hooks treat any session whose name starts with `kanthropic` as ours. */
export const TMUX_SESSION = "kanthropic";

/** Grok Build's global hooks dir — one file per installer, merged on load. */
export const GROK_HOOKS_DIR = join(home, ".grok", "hooks");
/** Our hook spec. Dropping this file is install; deleting it is uninstall. */
export const GROK_HOOK_PATH = join(GROK_HOOKS_DIR, "kanthropic.json");
/** Copied helper the Grok hook command runs. */
export const GROK_HOOK_SCRIPT = join(KANTHROPIC_DIR, "grok-hook.sh");

/** Claude Code's settings file — the surface we edit. */
export const CLAUDE_SETTINGS_PATH = join(home, ".claude", "settings.json");

/** One-time byte-exact backup of settings.json from first install. */
export const CLAUDE_SETTINGS_BACKUP_PATH = join(KANTHROPIC_DIR, "settings.backup.json");

/** Sentinel written to the backup when settings.json did not exist before us,
 *  so uninstall knows to delete the shell we created rather than restore one. */
export const ABSENT_SENTINEL = "__KANTHROPIC_ABSENT__";
