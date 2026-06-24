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
  parseable, readTopLevel, upsertTopLevel, removeTopLevel,
} from "./jsonc.mjs";
import {
  KANTHROPIC_DIR, CLAUDE_SETTINGS_PATH, CLAUDE_SETTINGS_BACKUP_PATH, ABSENT_SENTINEL,
} from "./paths.mjs";

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
const THINKING_SCRIPT = `#!/bin/sh
mkdir -p "$HOME/.kanthropic/sessions"
printf '{"state":"thinking","at":%s}' "$(date +%s)" > "$HOME/.kanthropic/session-state.json"
[ -n "$TMUX_PANE" ] || exit 0
SESSION=$(tmux display-message -p -t "$TMUX_PANE" '#{session_name}' 2>/dev/null)
case "$SESSION" in kanthropic*) ;; *) exit 0 ;; esac
PANE="$HOME/.kanthropic/sessions/$SESSION.pane"
OLD=$(cat "$PANE" 2>/dev/null)
# Already open for this session? Leave it (don't recreate on every tool call).
if [ -n "$OLD" ] && tmux list-panes -s -t "$SESSION" -F '#{pane_id}' 2>/dev/null | grep -qx "$OLD"; then
  exit 0
fi
NEW=$(tmux split-window -v -l ${PANE_ROWS} -P -F '#{pane_id}' -t "$TMUX_PANE" 'kanthropic drill' 2>/dev/null)
[ -n "$NEW" ] && printf '%s' "$NEW" > "$PANE"
exit 0
`;

// Close the kana pane for this session (focus falls back to Claude).
const IDLE_SCRIPT = `#!/bin/sh
mkdir -p "$HOME/.kanthropic/sessions"
printf '{"state":"idle","at":%s}' "$(date +%s)" > "$HOME/.kanthropic/session-state.json"
[ -n "$TMUX_PANE" ] || exit 0
SESSION=$(tmux display-message -p -t "$TMUX_PANE" '#{session_name}' 2>/dev/null)
case "$SESSION" in kanthropic*) ;; *) exit 0 ;; esac
PANE="$HOME/.kanthropic/sessions/$SESSION.pane"
OLD=$(cat "$PANE" 2>/dev/null)
[ -n "$OLD" ] && tmux kill-pane -t "$OLD" 2>/dev/null
: > "$PANE"
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

/** Drop any of OUR entries from an event's hook array. @param {any[]} arr */
function withoutOurs(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((group) => {
    const hs = group?.hooks;
    if (!Array.isArray(hs)) return true;
    return !hs.some((h) => typeof h?.command === "string" && h.command.includes(MARKER));
  });
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
    writeFileSync(CLAUDE_SETTINGS_PATH, next, "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/** @returns {{ ok: boolean, reason?: string }} */
export function uninstallHooks() {
  try {
    for (const p of [ON_THINKING, ON_IDLE]) if (existsSync(p)) rmSync(p);
    if (!existsSync(CLAUDE_SETTINGS_PATH)) return { ok: true };
    const src = readFileSync(CLAUDE_SETTINGS_PATH, "utf8");
    if (!parseable(src)) return { ok: false, reason: "settings.json not parseable — left untouched." };

    const cur = readTopLevel(src, "hooks");
    if (!cur || typeof cur !== "object") return { ok: true };

    /** @type {Record<string, any>} */
    const hooks = { ...cur };
    for (const ev of ["UserPromptSubmit", "PreToolUse", "Notification", "Stop"]) {
      const cleaned = withoutOurs(hooks[ev]);
      if (cleaned.length) hooks[ev] = cleaned; else delete hooks[ev];
    }

    const next = Object.keys(hooks).length
      ? upsertTopLevel(src, "hooks", pretty(hooks))
      : removeTopLevel(src, "hooks");
    if (next !== src) writeFileSync(CLAUDE_SETTINGS_PATH, next, "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/** @returns {boolean} */
export function hooksInstalled() {
  try {
    const hooks = readTopLevel(readFileSync(CLAUDE_SETTINGS_PATH, "utf8"), "hooks");
    return JSON.stringify(hooks ?? "").includes(MARKER);
  } catch {
    return false;
  }
}
