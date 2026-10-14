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

  it("adds open/close hooks and removes them cleanly (byte-exact, no prior hooks)", () => {
    const orig = '{\n  "model": "x",\n  "permissions": { "allow": ["Bash"] }\n}\n';
    writeFileSync(settings(home), orig, "utf8");

    run(home, "hooks-install");
    const after = readFileSync(settings(home), "utf8");
    expect(parseable(after)).toBe(true);
    const hooks = readTopLevel(after, "hooks");
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toContain("on-thinking.sh");
    expect(hooks.PreToolUse[0].hooks[0].command).toContain("on-thinking.sh"); // reopen after a pause
    expect(hooks.Notification[0].hooks[0].command).toContain("on-idle.sh");   // close when Claude asks
    expect(hooks.Stop[0].hooks[0].command).toContain("on-idle.sh");
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toContain("kanthropic-panel");
    // helper scripts written with the open/close logic
    expect(existsSync(join(home, ".kanthropic", "on-thinking.sh"))).toBe(true);
    const open = readFileSync(join(home, ".kanthropic", "on-thinking.sh"), "utf8");
    expect(open).toContain("split-window");
    expect(open).toContain("list-panes"); // idempotent guard so PreToolUse won't thrash
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
    expect(hooks.PreToolUse[0].hooks[0].command).toBe("echo mine"); // user's, kept at index 0
    expect(hooks.PreToolUse[1].hooks[0].command).toContain("on-thinking.sh"); // ours appended
    expect(Object.keys(hooks).sort()).toEqual(["Notification", "PreToolUse", "Stop", "UserPromptSubmit"]);

    run(home, "hooks-uninstall");
    const after = readFileSync(settings(home), "utf8");
    expect(parseable(after)).toBe(true);
    hooks = readTopLevel(after, "hooks");
    expect(hooks.PreToolUse[0].hooks[0].command).toBe("echo mine"); // user's hook survives
    expect(hooks.PreToolUse[1]).toBeUndefined(); // ours gone, user's alone again
    expect(hooks.UserPromptSubmit).toBeUndefined(); // ours gone
    expect(hooks.Notification).toBeUndefined();
    expect(hooks.Stop).toBeUndefined();
  });

  it("keeps a user hook that was added INSIDE one of our groups", () => {
    // Uninstall filters per-hook, not per-group — a user command sitting in
    // our group must survive even though the group carries our marker.
    writeFileSync(settings(home), JSON.stringify({
      hooks: {
        Stop: [{
          hooks: [
            { type: "command", command: "sh x.sh # kanthropic-panel" },
            { type: "command", command: "echo mine-too" },
          ],
        }],
      },
    }, null, 2), "utf8");
    run(home, "hooks-uninstall");
    const hooks = readTopLevel(readFileSync(settings(home), "utf8"), "hooks");
    expect(hooks.Stop[0].hooks).toEqual([{ type: "command", command: "echo mine-too" }]);
  });

  it("full setup then uninstall in EITHER order leaves no empty settings shell", () => {
    for (const order of [["uninstall", "hooks-uninstall"], ["hooks-uninstall", "uninstall"]]) {
      const h = mkdtempSync(join(tmpdir(), "kanthropic-order-"));
      try {
        // no settings.json at all → both installers share the ABSENT sentinel
        run(h, "install");
        run(h, "hooks-install");
        expect(existsSync(join(h, ".claude", "settings.json"))).toBe(true);
        run(h, order[0]);
        run(h, order[1]);
        expect(existsSync(join(h, ".claude", "settings.json"))).toBe(false); // shell cleaned up
      } finally {
        rmSync(h, { recursive: true, force: true });
      }
    }
  });
});
