/**
 * Reversibly wire Claude Code lifecycle hooks into ~/.claude/settings.json so
 * that — inside the `kanthropic session` tmux layout — a kana drill pane
 * OPENS below Claude while it's thinking and CLOSES when it's done.
 *
 *   UserPromptSubmit → on-thinking.sh : write state + open a kana pane below
 *   PreToolUse       → on-thinking.sh : reopen the pane when Claude resumes
 *   Notification     → on-idle.sh     : close the pane when Claude needs you
 *   Stop             → on-idle.sh     : close the pane at end of turn
 *
 * The open script is idempotent (it won't recreate a pane that's already alive),
 * so PreToolUse firing on every tool is a no-op — but when Claude PAUSES to ask
 * you something (a tool-permission prompt, an MCP elicitation), the Notification
 * hook closes the pane so you can answer, and the next PreToolUse reopens it.
 *
 * The heavy lifting lives in two small scripts in ~/.kanthropic so settings.json
 * stays a clean one-liner. Both are guarded: the pane open/close only happens
 * inside a tmux session named "kanthropic", so plain `claude` sessions (and
 * other tmux work) are completely unaffected. Each hook command carries the
 * MARKER so uninstall removes exactly our entries, leaving the user's own hooks
 * untouched.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  parseable, readTopLevel, upsertTopLevel, removeTopLevel, verifyTopLevel,
} from "./jsonc.mjs";
import {
  KANTHROPIC_DIR, CLAUDE_SETTINGS_PATH, CLAUDE_SETTINGS_BACKUP_PATH, ABSENT_SENTINEL,
} from "./paths.mjs";
import { writeAtomic } from "./fsutil.mjs";

const MARKER = "kanthropic-panel";
const ON_THINKING = join(KANTHROPIC_DIR, "on-thinking.sh");
const ON_IDLE = join(KANTHROPIC_DIR, "on-idle.sh");

// Height (rows) of the kana pane that opens below Claude — tall enough for the
// big-glyph rendering to be legible.
const PANE_ROWS = 18;

// Open the kana pane below Claude. Guarded to the "kanthropic" tmux session so
// it never disturbs other sessions. IDEMPOTENT: if our pane is already alive it
// does nothing, so PreToolUse (which fires on every tool) never thrashes it —
// only a genuine reopen (after the pane was closed for a prompt) recreates it.
// The pane id is tracked per tmux session ($SESSION) so several concurrent
// `kanthropic session` windows each open/close their OWN kana pane.
// State is written twice over:
//  - per CLAUDE session (state/<session_id>.json, always — session_id comes
//    from the hook's stdin JSON) so concurrent Claude sessions can't flip each
//    other's indicators, and `kanthropic watch` works with no tmux at all;
//  - per TMUX session (sessions/<name>.state, kanthropic sessions only) so a
//    session's drill pane tracks ITS OWN Claude.
// Writes go via a temp file + mv so a poller can never read a half-write.
const STATE_PRELUDE = `STATE_DIR="$HOME/.kanthropic/state"
SESS_DIR="$HOME/.kanthropic/sessions"
mkdir -p "$STATE_DIR" "$SESS_DIR"
if [ -t 0 ]; then SID=default; else
  SID=$(sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)
fi
[ -n "$SID" ] || SID=default
write_state() {
  printf '{"state":"%s","at":%s}' "$1" "$(date +%s)" > "$2.$$" && mv -f "$2.$$" "$2"
}
`;

const THINKING_SCRIPT = `#!/bin/sh
${STATE_PRELUDE}write_state thinking "$STATE_DIR/$SID.json"
[ -n "$TMUX_PANE" ] || exit 0
SESSION=$(tmux display-message -p -t "$TMUX_PANE" '#{session_name}' 2>/dev/null)
case "$SESSION" in kanthropic*) ;; *) exit 0 ;; esac
write_state thinking "$SESS_DIR/$SESSION.state"
PANE="$SESS_DIR/$SESSION.pane"
LOCK="$SESS_DIR/$SESSION.lock"
# One opener at a time: Claude runs tools in parallel, so two of these can race
# the check-then-split below and open DUPLICATE panes (the loser's pane id is
# clobbered and the pane leaks forever). mkdir is atomic; a lock older than a
# minute is a crashed holder and gets stolen.
if ! mkdir "$LOCK" 2>/dev/null; then
  [ -n "$(find "$LOCK" -maxdepth 0 -mmin +1 2>/dev/null)" ] || exit 0
  rmdir "$LOCK" 2>/dev/null
  mkdir "$LOCK" 2>/dev/null || exit 0
fi
OLD=$(cat "$PANE" 2>/dev/null)
# Already open for this session? Leave it (don't recreate on every tool call).
if [ -n "$OLD" ] && tmux list-panes -s -t "$SESSION" -F '#{pane_id}' 2>/dev/null | grep -qx "$OLD"; then
  rmdir "$LOCK" 2>/dev/null
  exit 0
fi
NEW=$(tmux split-window -v -l ${PANE_ROWS} -P -F '#{pane_id}' -t "$TMUX_PANE" 'kanthropic drill' 2>/dev/null)
[ -n "$NEW" ] && printf '%s' "$NEW" > "$PANE"
rmdir "$LOCK" 2>/dev/null
exit 0
`;

// Close the kana pane for this session (focus falls back to Claude).
const IDLE_SCRIPT = `#!/bin/sh
${STATE_PRELUDE}write_state idle "$STATE_DIR/$SID.json"
[ -n "$TMUX_PANE" ] || exit 0
SESSION=$(tmux display-message -p -t "$TMUX_PANE" '#{session_name}' 2>/dev/null)
case "$SESSION" in kanthropic*) ;; *) exit 0 ;; esac
write_state idle "$SESS_DIR/$SESSION.state"
PANE="$SESS_DIR/$SESSION.pane"
OLD=$(cat "$PANE" 2>/dev/null)
[ -n "$OLD" ] && tmux kill-pane -t "$OLD" 2>/dev/null
: > "$PANE"
# Sweep any stray drill pane in this session — a lost open-race (or an older
# version) can leave one behind that the tracked id no longer covers.
tmux list-panes -s -t "$SESSION" -F '#{pane_id} #{pane_start_command}' 2>/dev/null \\
  | grep 'kanthropic drill' | cut -d' ' -f1 \\
  | while read -r p; do tmux kill-pane -t "$p" 2>/dev/null; done
exit 0
`;

/** @param {"thinking"|"idle"} state @returns {string} */
function hookCommand(state) {
  const script = state === "thinking" ? ON_THINKING : ON_IDLE;
  return `sh ${JSON.stringify(script)} # ${MARKER}`;
}

/** A single Claude hook entry. @param {"thinking"|"idle"} state */
function hookEntry(state) {
  return { hooks: [{ type: "command", command: hookCommand(state) }] };
}

/** Serialize a value for a depth-1 key: pretty JSON, every line after the first
 *  indented 2 spaces so the block nests correctly under the key. */
function pretty(obj) {
  return JSON.stringify(obj, null, 2)
    .split("\n").map((line, i) => (i === 0 ? line : "  " + line)).join("\n");
}

/** Drop OUR entries from an event's hook array — filtering at the INDIVIDUAL
 *  hook level, so a user who added their own command into one of our groups
 *  keeps it (a per-group filter would delete theirs along with ours).
 *  @param {any[]} arr */
function withoutOurs(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((group) => {
      const hs = group?.hooks;
      if (!Array.isArray(hs)) return group;
      return { ...group, hooks: hs.filter((h) => !(typeof h?.command === "string" && h.command.includes(MARKER))) };
    })
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
}

/** @returns {{ ok: boolean, reason?: string }} */
export function installHooks() {
  try {
    const existed = existsSync(CLAUDE_SETTINGS_PATH);
    const src = existed ? readFileSync(CLAUDE_SETTINGS_PATH, "utf8") : "{\n}\n";
    if (existed && !parseable(src)) {
      return { ok: false, reason: "~/.claude/settings.json is not valid JSON/JSONC." };
    }
    mkdirSync(KANTHROPIC_DIR, { recursive: true });
    if (!existsSync(CLAUDE_SETTINGS_BACKUP_PATH)) {
      writeFileSync(CLAUDE_SETTINGS_BACKUP_PATH, existed ? src : ABSENT_SENTINEL, "utf8");
    }

    // The scripts the hooks call (rewritten each install so upgrades land).
    writeFileSync(ON_THINKING, THINKING_SCRIPT, "utf8");
    writeFileSync(ON_IDLE, IDLE_SCRIPT, "utf8");

    const cur = readTopLevel(src, "hooks");
    const hooks = (cur && typeof cur === "object") ? { ...cur } : {};
    // Open on a new prompt and on every tool (the latter reopens after a pause);
    // close when Claude needs you (Notification) and at end of turn (Stop).
    hooks.UserPromptSubmit = [...withoutOurs(hooks.UserPromptSubmit), hookEntry("thinking")];
    hooks.PreToolUse = [...withoutOurs(hooks.PreToolUse), hookEntry("thinking")];
    hooks.Notification = [...withoutOurs(hooks.Notification), hookEntry("idle")];
    hooks.Stop = [...withoutOurs(hooks.Stop), hookEntry("idle")];

    const next = upsertTopLevel(src, "hooks", pretty(hooks));
    // Refuse to write anything we can't read back intact — an editor bug must
    // degrade to "install refused", never to a destroyed settings.json.
    if (!verifyTopLevel(next, "hooks", hooks)) {
      return { ok: false, reason: "refusing to write: edited settings.json failed validation (file untouched)." };
    }
    writeAtomic(CLAUDE_SETTINGS_PATH, next);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/** Is the kanthropic status line still present in this settings text? Local
 *  check (not install.mjs's isInstalled) to avoid an import cycle. */
function statuslineStillInstalled(src) {
  try {
    const sl = /** @type {any} */ (readTopLevel(src, "statusLine"));
    return !!sl && typeof sl === "object" && typeof sl.command === "string"
      && sl.command.includes("kanthropic-statusline");
  } catch { return false; }
}

/** Delete the helper scripts. ONLY safe once settings.json no longer points at
 *  them — deleting first and then failing the settings edit would leave four
 *  hooks firing on missing files every prompt. */
function removeHookScripts() {
  for (const p of [ON_THINKING, ON_IDLE]) if (existsSync(p)) rmSync(p);
}

/** @returns {{ ok: boolean, reason?: string }} */
export function uninstallHooks() {
  try {
    if (!existsSync(CLAUDE_SETTINGS_PATH)) { removeHookScripts(); return { ok: true }; }
    const src = readFileSync(CLAUDE_SETTINGS_PATH, "utf8");
    if (!parseable(src)) return { ok: false, reason: "settings.json not parseable — left untouched." };

    const cur = readTopLevel(src, "hooks");
    if (!cur || typeof cur !== "object") { removeHookScripts(); return { ok: true }; }

    /** @type {Record<string, any>} */
    const hooks = { ...cur };
    for (const ev of ["UserPromptSubmit", "PreToolUse", "Notification", "Stop"]) {
      const cleaned = withoutOurs(hooks[ev]);
      if (cleaned.length) hooks[ev] = cleaned; else delete hooks[ev];
    }

    const removeAll = Object.keys(hooks).length === 0;
    const next = removeAll
      ? removeTopLevel(src, "hooks")
      : upsertTopLevel(src, "hooks", pretty(hooks));
    if (!verifyTopLevel(next, "hooks", removeAll ? undefined : hooks)) {
      return { ok: false, reason: "refusing to write: edited settings.json failed validation (file untouched)." };
    }
    if (next !== src) writeAtomic(CLAUDE_SETTINGS_PATH, next);
    removeHookScripts();

    // The settings backup is SHARED with the status-line installer; whoever
    // uninstalls LAST cleans it up (and deletes the empty `{}` shell if we
    // created the whole file — the ABSENT sentinel).
    if (!statuslineStillInstalled(next)) {
      let backup = "";
      try { backup = readFileSync(CLAUDE_SETTINGS_BACKUP_PATH, "utf8"); } catch { /* none */ }
      if (backup === ABSENT_SENTINEL && /^[\s{}]*$/.test(next) && existsSync(CLAUDE_SETTINGS_PATH)) {
        rmSync(CLAUDE_SETTINGS_PATH);
      }
      if (backup && existsSync(CLAUDE_SETTINGS_BACKUP_PATH)) rmSync(CLAUDE_SETTINGS_BACKUP_PATH);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/** @returns {boolean} */
export function hooksInstalled() {
  try {
    const hooks = readTopLevel(readFileSync(CLAUDE_SETTINGS_PATH, "utf8"), "hooks");
    if (!hooks || typeof hooks !== "object") return false;
    // Look for OUR command in the actual hook entries — a mere mention of the
    // marker elsewhere (e.g. a user's disabled copy) shouldn't count.
    return ["UserPromptSubmit", "PreToolUse", "Notification", "Stop"].some((ev) =>
      Array.isArray(hooks[ev]) && hooks[ev].some((g) => Array.isArray(g?.hooks)
        && g.hooks.some((h) => typeof h?.command === "string" && h.command.includes(MARKER))));
  } catch {
    return false;
  }
}
