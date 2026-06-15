/**
 * Installer / uninstaller for the ambient status-line surface.
 *
 * Edits `~/.claude/settings.json` with the same care Kickbacks takes (our own
 * implementation): a one-time byte-exact backup, minimal-diff JSONC edits that
 * preserve the user's other keys + comments, chain-capture of any pre-existing
 * statusLine, and a fully reversible, KEY-SCOPED uninstall that never clobbers
 * settings the user changed after install.
 */
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseable, readTopLevel, readTopLevelRaw, upsertTopLevel, removeTopLevel,
} from "../core/jsonc.mjs";
import {
  KANTHROPIC_DIR, STATUSLINE_SCRIPT_PATH, PREV_STATUSLINE_PATH,
  CLAUDE_SETTINGS_PATH, CLAUDE_SETTINGS_BACKUP_PATH, ABSENT_SENTINEL,
} from "../core/paths.mjs";

const PKG_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = resolve(PKG_SRC, "install/statusline.tpl.mjs");
const SCRIPT_MARK = "kanthropic-statusline";

/** A command-type statusLine that is not ours (chain-capturable).
 *  @param {unknown} v @returns {v is { type: string, command: string }} */
function isForeignStatusLine(v) {
  return !!v && typeof v === "object"
    && v.type === "command"
    && typeof v.command === "string"
    && !v.command.includes(SCRIPT_MARK);
}

/** The JSON value we write for our statusLine entry. @returns {string} */
function ourStatusLineValue() {
  const cmd = `node ${JSON.stringify(STATUSLINE_SCRIPT_PATH)}`;
  return JSON.stringify({ type: "command", command: cmd, padding: 0 });
}

/** Generate the status-line script from the template (resolve imports to this
 *  package's src dir) and write it to ~/.kanthropic. */
function writeStatuslineScript() {
  const tpl = readFileSync(TEMPLATE_PATH, "utf8");
  const script = tpl.split("__PKG_SRC__").join(PKG_SRC.replace(/\\/g, "/"));
  mkdirSync(KANTHROPIC_DIR, { recursive: true });
  writeFileSync(STATUSLINE_SCRIPT_PATH, script, "utf8");
}

/**
 * Install the ambient status line into Claude Code.
 * @returns {{ ok: boolean, reason?: string, chained?: boolean }}
 */
export function install() {
  try {
    const existed = existsSync(CLAUDE_SETTINGS_PATH);
    const pristine = existed ? readFileSync(CLAUDE_SETTINGS_PATH, "utf8") : null;
    if (pristine !== null && !parseable(pristine)) {
      return { ok: false, reason: "~/.claude/settings.json is not valid JSON/JSONC — fix it first." };
    }

    mkdirSync(KANTHROPIC_DIR, { recursive: true });

    // One-time backup (ABSENT sentinel when there was no file at all).
    if (!existsSync(CLAUDE_SETTINGS_BACKUP_PATH)) {
      writeFileSync(CLAUDE_SETTINGS_BACKUP_PATH, pristine === null ? ABSENT_SENTINEL : pristine, "utf8");
    }

    // Chain-capture an existing user statusLine so we stack above it, not over it.
    let chained = false;
    const prevSl = pristine !== null ? readTopLevel(pristine, "statusLine") : undefined;
    if (isForeignStatusLine(prevSl)) {
      // `raw` is the original value text (formatting preserved) so uninstall
      // restores it byte-for-byte; `statusLine` is the parsed form the
      // generated status-line script reads to run the chained HUD command.
      const raw = readTopLevelRaw(pristine, "statusLine");
      writeFileSync(PREV_STATUSLINE_PATH,
        JSON.stringify({ statusLine: prevSl, raw }, null, 2), "utf8");
      chained = true;
    }

    writeStatuslineScript();

    const base = pristine ?? "{\n}\n";
    const next = upsertTopLevel(base, "statusLine", ourStatusLineValue());
    if (!existed || next !== pristine) writeFileSync(CLAUDE_SETTINGS_PATH, next, "utf8");

    return { ok: true, chained };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/**
 * Reverse the install. Key-scoped: removes only our statusLine from the CURRENT
 * settings.json (restoring a chain-captured one), leaving every other key the
 * user may have added intact. Keeps ~/.kanthropic/progress.json (your learning
 * progress) untouched.
 * @returns {{ ok: boolean, reason?: string, restored: boolean }}
 */
export function uninstall() {
  try {
    if (existsSync(CLAUDE_SETTINGS_PATH)) {
      const cur = readFileSync(CLAUDE_SETTINGS_PATH, "utf8");
      if (!parseable(cur)) {
        return { ok: false, restored: false, reason: "settings.json not parseable — left untouched." };
      }
      const curSl = readTopLevel(cur, "statusLine");
      const isOurs = !!curSl && typeof curSl === "object"
        && typeof curSl.command === "string" && curSl.command.includes(SCRIPT_MARK);

      let next = cur;
      if (isOurs) {
        // Restore a chain-captured HUD if we have one, else just drop the key.
        let prev, raw;
        try {
          const cap = JSON.parse(readFileSync(PREV_STATUSLINE_PATH, "utf8"));
          prev = cap.statusLine; raw = cap.raw;
        } catch { prev = undefined; }
        next = isForeignStatusLine(prev)
          // Prefer the original raw text (byte-exact); fall back to a compact
          // re-serialization if the raw capture is missing.
          ? upsertTopLevel(cur, "statusLine", typeof raw === "string" ? raw : JSON.stringify(prev))
          : removeTopLevel(cur, "statusLine");
      }

      // If we created the whole file (ABSENT sentinel) and nothing but our key
      // was ever added, delete the shell rather than leave an empty {}.
      let backup = "";
      try { backup = readFileSync(CLAUDE_SETTINGS_BACKUP_PATH, "utf8"); } catch { /* none */ }
      const emptyShell = /^[\s{}]*$/.test(next);
      if (backup === ABSENT_SENTINEL && emptyShell) {
        rmSync(CLAUDE_SETTINGS_PATH);
      } else if (next !== cur) {
        writeFileSync(CLAUDE_SETTINGS_PATH, next, "utf8");
      }
    }

    for (const p of [STATUSLINE_SCRIPT_PATH, PREV_STATUSLINE_PATH, CLAUDE_SETTINGS_BACKUP_PATH]) {
      if (existsSync(p)) rmSync(p);
    }
    return { ok: true, restored: true };
  } catch (e) {
    return { ok: false, restored: false, reason: String(e) };
  }
}

/** @returns {boolean} whether our statusLine is currently installed. */
export function isInstalled() {
  try {
    if (!existsSync(CLAUDE_SETTINGS_PATH)) return false;
    const sl = readTopLevel(readFileSync(CLAUDE_SETTINGS_PATH, "utf8"), "statusLine");
    return !!sl && typeof sl === "object" && typeof sl.command === "string" && sl.command.includes(SCRIPT_MARK);
  } catch {
    return false;
  }
}
