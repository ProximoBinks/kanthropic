/** Read the thinking/idle state the Claude hooks write. Never throws; treats a
 *  missing/old file as idle (so a missed Stop hook can't leave it stuck "on").
 *
 *  Two sources, matching how the hooks write:
 *   - per-TMUX-session files (`sessions/<name>.state`) — inside a kanthropic
 *     tmux session only THAT session's Claude drives the pane's dot/bell;
 *   - per-CLAUDE-session files (`state/<session_id>.json`) — written for every
 *     Claude session, tmux or not, so `kanthropic watch` and the standalone
 *     drill work in any terminal. Aggregated: any fresh "thinking" counts.
 */
import { readFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { env } from "node:process";
import { SESSION_STATE_PATH, STATE_DIR, SESSIONS_DIR, TMUX_SESSION } from "./paths.mjs";

const STALE_S = 600;      // a "thinking" older than 10 min is treated as idle
const PRUNE_S = 86_400;   // state files idle for over a day are deleted

/** @returns {"thinking" | "idle"} */
function parseState(path) {
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    if (s.state === "thinking") {
      if (typeof s.at === "number" && Date.now() / 1000 - s.at > STALE_S) return "idle";
      return "thinking";
    }
    return "idle";
  } catch {
    return "idle";
  }
}

/** The kanthropic tmux session this process runs inside, or null. Cached —
 *  a pane's session doesn't change over its lifetime. */
let _ownSession;
function ownKanthropicSession() {
  if (_ownSession !== undefined) return _ownSession;
  _ownSession = null;
  if (env.TMUX) {
    try {
      const name = execFileSync("tmux", ["display-message", "-p", "#{session_name}"],
        { encoding: "utf8" }).trim();
      if (name === TMUX_SESSION || name.startsWith(`${TMUX_SESSION}-`)) _ownSession = name;
    } catch { /* tmux gone — treat as outside */ }
  }
  return _ownSession;
}

/** Is ANY Claude session thinking? Scans the per-session state dir (pruning
 *  entries idle for over a day so it can't grow forever) and falls back to the
 *  legacy single file for hooks installed by older versions. */
export function anySessionThinking() {
  let thinking = false;
  try {
    for (const f of readdirSync(STATE_DIR)) {
      if (!f.endsWith(".json")) continue;
      const p = join(STATE_DIR, f);
      if (parseState(p) === "thinking") { thinking = true; continue; }
      try {
        const s = JSON.parse(readFileSync(p, "utf8"));
        if (typeof s.at === "number" && Date.now() / 1000 - s.at > PRUNE_S) unlinkSync(p);
      } catch { try { unlinkSync(p); } catch { /* ignore */ } }
    }
  } catch { /* no state dir yet */ }
  return thinking || parseState(SESSION_STATE_PATH) === "thinking";
}

/** @returns {"thinking" | "idle"} */
export function readSessionState() {
  const own = ownKanthropicSession();
  if (own) {
    const p = join(SESSIONS_DIR, `${own}.state`);
    // No per-session file yet (hooks from an older install) → aggregate view.
    if (existsSync(p)) return parseState(p);
  }
  return anySessionThinking() ? "thinking" : "idle";
}
