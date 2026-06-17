import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseable, readTopLevel } from "../src/core/jsonc.mjs";

const CLI = fileURLToPath(new URL("../src/cli/index.mjs", import.meta.url));

function run(home, ...args) {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8",
  });
}

describe("Claude hook wiring", () => {
  let home;
  const settings = (h) => join(h, ".claude", "settings.json");
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kanthropic-hooks-"));
    mkdirSync(join(home, ".claude"), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("adds UserPromptSubmit + Stop and removes them cleanly (byte-exact, no prior hooks)", () => {
    const orig = '{\n  "model": "x",\n  "permissions": { "allow": ["Bash"] }\n}\n';
    writeFileSync(settings(home), orig, "utf8");

    run(home, "hooks-install");
    const after = readFileSync(settings(home), "utf8");
    expect(parseable(after)).toBe(true);
    const hooks = readTopLevel(after, "hooks");
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toContain("on-thinking.sh");
    expect(hooks.Stop[0].hooks[0].command).toContain("on-idle.sh");
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toContain("kanthropic-panel");
    // helper scripts written with the open/close logic
    expect(existsSync(join(home, ".kanthropic", "on-thinking.sh"))).toBe(true);
    expect(readFileSync(join(home, ".kanthropic", "on-thinking.sh"), "utf8")).toContain("split-window");
    expect(readFileSync(join(home, ".kanthropic", "on-idle.sh"), "utf8")).toContain("kill-pane");

    run(home, "hooks-uninstall");
    expect(readFileSync(settings(home), "utf8")).toBe(orig);
    expect(existsSync(join(home, ".kanthropic", "on-thinking.sh"))).toBe(false); // scripts removed too
  });

  it("preserves a pre-existing user hook through install + uninstall", () => {
    const orig = `{
  "hooks": {
    "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "echo mine" } ] } ]
  }
}`;
    writeFileSync(settings(home), orig, "utf8");

    run(home, "hooks-install");
    let hooks = readTopLevel(readFileSync(settings(home), "utf8"), "hooks");
    expect(hooks.PreToolUse[0].hooks[0].command).toBe("echo mine");
    expect(Object.keys(hooks).sort()).toEqual(["PreToolUse", "Stop", "UserPromptSubmit"]);

    run(home, "hooks-uninstall");
    const after = readFileSync(settings(home), "utf8");
    expect(parseable(after)).toBe(true);
    hooks = readTopLevel(after, "hooks");
    expect(hooks.PreToolUse[0].hooks[0].command).toBe("echo mine"); // user's hook survives
    expect(hooks.UserPromptSubmit).toBeUndefined(); // ours gone
    expect(hooks.Stop).toBeUndefined();
  });
});
