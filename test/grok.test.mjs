import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli/index.mjs", import.meta.url));
const HOOK = fileURLToPath(new URL("../src/core/grok-hook.sh", import.meta.url));

function run(home, ...args) {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8",
  });
}

function fire(home, event, payload, extraEnv = {}) {
  const script = join(home, ".kanthropic", "grok-hook.sh");
  const r = spawnSync("sh", [script], {
    env: { ...process.env, HOME: home, GROK_HOOK_EVENT: event, GROK_SESSION_ID: payload.sessionId || "s1", ...extraEnv },
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return r;
}

describe("Grok hook wiring", () => {
  let home;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "kanthropic-grok-")); });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("installs a standalone ~/.grok/hooks/kanthropic.json and removes it cleanly", () => {
    run(home, "grok-install");
    const specPath = join(home, ".grok", "hooks", "kanthropic.json");
    expect(existsSync(specPath)).toBe(true);
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    expect(spec.hooks.UserPromptSubmit[0].hooks[0].command).toContain("grok-hook.sh");
    expect(spec.hooks.Stop[0].hooks[0].timeout).toBe(5);
    expect(spec.hooks.Notification[0].matcher).toBe("idle_prompt");
    expect(spec.hooks.PreToolUse).toBeUndefined(); // the finicky Claude reopen path is gone
    expect(existsSync(join(home, ".kanthropic", "grok-hook.sh"))).toBe(true);

    run(home, "grok-uninstall");
    expect(existsSync(specPath)).toBe(false);
    expect(existsSync(join(home, ".kanthropic", "grok-hook.sh"))).toBe(false);
  });

  it("does not touch ~/.claude/settings.json", () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    const orig = '{ "model": "keep-me" }\n';
    writeFileSync(join(home, ".claude", "settings.json"), orig, "utf8");
    run(home, "grok-install");
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(orig);
  });
});

describe("Grok hook script (busy / idle)", () => {
  let home;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kanthropic-groksh-"));
    mkdirSync(join(home, ".kanthropic"), { recursive: true });
    const dest = join(home, ".kanthropic", "grok-hook.sh");
    writeFileSync(dest, readFileSync(HOOK));
    chmodSync(dest, 0o755);
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("marks thinking on UserPromptSubmit and idle on Stop of the same turn", () => {
    fire(home, "user_prompt_submit", { sessionId: "abc", promptId: "p1" });
    const state = () => JSON.parse(readFileSync(join(home, ".kanthropic", "state", "abc.json"), "utf8"));
    expect(state().state).toBe("thinking");
    expect(state().promptId).toBe("p1");

    const stop = fire(home, "stop", { sessionId: "abc", promptId: "p1", reason: "end_turn" });
    expect(stop.stdout).toBe(""); // Stop is a gate — no JSON on stdout
    expect(state().state).toBe("idle");
  });

  it("ignores a stale Stop that arrives after the next prompt", () => {
    fire(home, "user_prompt_submit", { sessionId: "abc", promptId: "p1" });
    fire(home, "user_prompt_submit", { sessionId: "abc", promptId: "p2" });
    fire(home, "stop", { sessionId: "abc", promptId: "p1" }); // late report for p1
    const state = JSON.parse(readFileSync(join(home, ".kanthropic", "state", "abc.json"), "utf8"));
    expect(state.state).toBe("thinking");
    expect(state.promptId).toBe("p2");
  });

  it("ignores subagent events", () => {
    fire(home, "user_prompt_submit", { sessionId: "abc", promptId: "p1", subagentType: "explore" });
    expect(existsSync(join(home, ".kanthropic", "state", "abc.json"))).toBe(false);
  });
});
