/** Read the thinking/idle state the Claude hooks write. Never throws; treats a
 *  missing/old file as idle (so a missed Stop hook can't leave it stuck "on"). */
import { readFileSync } from "node:fs";
import { SESSION_STATE_PATH } from "./paths.mjs";

const STALE_S = 600; // a "thinking" older than 10 min is treated as idle

/** @returns {"thinking" | "idle"} */
export function readSessionState() {
  try {
    const s = JSON.parse(readFileSync(SESSION_STATE_PATH, "utf8"));
    if (s.state === "thinking") {
      if (typeof s.at === "number" && Date.now() / 1000 - s.at > STALE_S) return "idle";
      return "thinking";
    }
    return "idle";
  } catch {
    return "idle";
  }
}
