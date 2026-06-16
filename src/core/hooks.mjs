/**
 * Reversibly wire Claude Code lifecycle hooks into ~/.claude/settings.json so
 * the `kanthropic drill` input box (in a side/bottom terminal pane) reacts to
 * whether Claude is working.
 *
 *   UserPromptSubmit → write {"state":"thinking"}  (you submit → Claude starts)
 *   Stop             → write {"state":"idle"}      (Claude finished)
 *
 * Both hooks just write ~/.kanthropic/session-state.json and exit 0, so they
 * are instant and never affect Claude. The drill watches that file. Each
 * command carries the MARKER so uninstall removes exactly our entries, leaving
 * any hooks the user already had untouched.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import {
  parseable, readTopLevel, upsertTopLevel, removeTopLevel,
} from "./jsonc.mjs";
import {
  KANTHROPIC_DIR, CLAUDE_SETTINGS_PATH, CLAUDE_SETTINGS_BACKUP_PATH, ABSENT_SENTINEL,
} from "./paths.mjs";

const MARKER = "kanthropic-panel";

/** @param {"thinking"|"idle"} state @returns {string} */
function stateCommand(state) {
  // POSIX sh: write the state file and exit 0. MARKER tags it for removal.
  return `sh -c 'mkdir -p "$HOME/.kanthropic"; `
    + `printf "{\\"state\\":\\"${state}\\",\\"at\\":%s}" "$(date +%s)" `
    + `> "$HOME/.kanthropic/session-state.json"; exit 0' # ${MARKER}`;
}

/** A single Claude hook entry. @param {"thinking"|"idle"} state */
function hookEntry(state) {
  return { hooks: [{ type: "command", command: stateCommand(state) }] };
}

/** Serialize a value for a depth-1 key: pretty JSON, with every line after the
 *  first indented 2 spaces so the block nests correctly under the key (the
 *  closing brace lines up with the key, not column 0). @param {unknown} obj */
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

    const hooks = (readTopLevel(src, "hooks") && typeof readTopLevel(src, "hooks") === "object")
      ? { ...readTopLevel(src, "hooks") } : {};
    hooks.UserPromptSubmit = [...withoutOurs(hooks.UserPromptSubmit), hookEntry("thinking")];
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
    if (!existsSync(CLAUDE_SETTINGS_PATH)) return { ok: true };
    const src = readFileSync(CLAUDE_SETTINGS_PATH, "utf8");
    if (!parseable(src)) return { ok: false, reason: "settings.json not parseable — left untouched." };

    const cur = readTopLevel(src, "hooks");
    if (!cur || typeof cur !== "object") return { ok: true };

    /** @type {Record<string, any>} */
    const hooks = { ...cur };
    for (const ev of ["UserPromptSubmit", "Stop"]) {
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
