import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli/index.mjs", import.meta.url));

/** Run the CLI with a sandboxed HOME so we never touch the real ~/.claude. */
function run(home, ...args) {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
}

describe("install / uninstall reversibility", () => {
  let home;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kanthropic-"));
    mkdirSync(join(home, ".claude"), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const settingsPath = (h) => join(h, ".claude", "settings.json");

  it("byte-exact round-trip preserving a pre-existing statusLine + comments", () => {
    const orig = `{
  // my config
  "model": "claude-opus-4-8",
  "statusLine": { "type": "command", "command": "my-hud --fancy", "padding": 1 },
  "permissions": { "allow": ["Bash"] }
}`;
    writeFileSync(settingsPath(home), orig, "utf8");
    run(home, "install");
    // Our line is in place; the user's HUD is captured for chaining.
    const patched = readFileSync(settingsPath(home), "utf8");
    expect(patched).toContain("kanthropic-statusline");
    expect(patched).toContain("// my config");
    expect(existsSync(join(home, ".kanthropic", "prev-statusline.json"))).toBe(true);

    run(home, "uninstall");
    expect(readFileSync(settingsPath(home), "utf8")).toBe(orig);
  });

  it("creates then deletes settings.json when none existed (ABSENT sentinel)", () => {
    expect(existsSync(settingsPath(home))).toBe(false);
    run(home, "install");
    expect(existsSync(settingsPath(home))).toBe(true);
    run(home, "uninstall");
    expect(existsSync(settingsPath(home))).toBe(false);
  });

  it("keeps learning progress across uninstall", () => {
    run(home, "install");
    // seed progress via learn mode (study row 1, then quit)
    execFileSync("node", [CLI, "learn", "--script", "hiragana"], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      input: "1\n\n\n\n\n\n\nq\n", encoding: "utf8",
    });
    const progress = join(home, ".kanthropic", "progress.json");
    expect(existsSync(progress)).toBe(true);
    run(home, "uninstall");
    expect(existsSync(progress)).toBe(true); // progress survives uninstall
  });
});
