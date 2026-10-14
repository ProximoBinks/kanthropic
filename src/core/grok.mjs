/**
 * Wire Grok Build hooks so the menu-bar app pops while Grok is thinking.
 *
 * Unlike the Claude installer this does NOT edit a shared settings.json —
 * Grok loads every file in ~/.grok/hooks/, so we drop our own file and
 * delete it on uninstall. No JSONC surgery, no tmux panes.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KANTHROPIC_DIR, GROK_HOOKS_DIR, GROK_HOOK_PATH, GROK_HOOK_SCRIPT } from "./paths.mjs";
import { writeAtomic } from "./fsutil.mjs";

const SCRIPT_SRC = fileURLToPath(new URL("./grok-hook.sh", import.meta.url));
const MARKER = "kanthropic";

function hookCommand() {
  return `sh ${JSON.stringify(GROK_HOOK_SCRIPT)}`;
}

function spec() {
  const command = hookCommand();
  const run = { type: "command", command, timeout: 5 };
  const group = { hooks: [run] };
  return {
    // Grok ignores unknown keys; this is for humans grepping the file.
    kanthropic: MARKER,
    hooks: {
      UserPromptSubmit: [group],
      Stop: [group],
      StopFailure: [group],
      StopCancelled: [group],
      SessionEnd: [group],
      Notification: [{ matcher: "idle_prompt", hooks: [run] }],
    },
  };
}

/** @returns {{ ok: boolean, reason?: string }} */
export function installGrokHooks() {
  try {
    mkdirSync(GROK_HOOKS_DIR, { recursive: true });
    mkdirSync(KANTHROPIC_DIR, { recursive: true });
    copyFileSync(SCRIPT_SRC, GROK_HOOK_SCRIPT);
    try { chmodSync(GROK_HOOK_SCRIPT, 0o755); } catch { /* windows */ }
    writeAtomic(GROK_HOOK_PATH, JSON.stringify(spec(), null, 2) + "\n");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }
}

/** @returns {{ ok: boolean, reason?: string }} */
export function uninstallGrokHooks() {
  try {
    if (existsSync(GROK_HOOK_PATH)) rmSync(GROK_HOOK_PATH);
    if (existsSync(GROK_HOOK_SCRIPT)) rmSync(GROK_HOOK_SCRIPT);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }
}

/** @returns {boolean} */
export function grokHooksInstalled() {
  try {
    if (!existsSync(GROK_HOOK_PATH)) return false;
    const raw = readFileSync(GROK_HOOK_PATH, "utf8");
    return raw.includes("kanthropic") && raw.includes("grok-hook.sh");
  } catch {
    return false;
  }
}
