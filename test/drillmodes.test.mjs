import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli/index.mjs", import.meta.url));

function drill(home, input, args = ["drill"]) {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    input, encoding: "utf8", timeout: 15_000,
  });
}

function seed(home, { due, state = 1 }) {
  const glyphs = ["あ", "い", "う", "え", "お"];
  const cards = {};
  for (const g of glyphs) {
    cards[g] = {
      script: "hiragana", romaji: "x", due, stability: 1, difficulty: 5,
      elapsed_days: 0, scheduled_days: 0, learning_steps: 1, reps: 1,
      lapses: 0, state, seen: 1, misses: 0,
    };
  }
  mkdirSync(join(home, ".kanthropic"), { recursive: true });
  writeFileSync(join(home, ".kanthropic", "progress.json"), JSON.stringify({
    version: 1, config: { image: "off" }, cards, learned: glyphs, learnedMigrated: true,
  }), "utf8");
}

describe("simplified drill", () => {
  let home;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "kanthropic-modes-")); });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("caught-up when nothing is due — does not keep grinding the deck", () => {
    seed(home, { due: Date.now() + 86_400_000 });
    const out = drill(home, "q\n");
    expect(out.toLowerCase()).toContain("caught up");
    expect(out).not.toContain("/f focus");
    expect(out).not.toContain("/s schedule");
  });

  it("q at a dealt card quits without grading", () => {
    seed(home, { due: 0 });
    drill(home, "/q\n");
    const store = JSON.parse(readFileSync(join(home, ".kanthropic", "progress.json"), "utf8"));
    for (const card of Object.values(store.cards)) {
      expect(card.seen).toBe(1);
      expect(card.misses).toBe(0);
    }
  });

  it("the answer prompt shows the short command hint", () => {
    seed(home, { due: 0 });
    const out = drill(home, "q\n");
    expect(out).toContain("/n next row");
    expect(out).toContain("q quit");
  });
});
