import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// The store resolves ~/.kanthropic at import time, so these tests exercise it
// in a child process with a sandboxed HOME (same pattern as install tests).
function inHome(home, code) {
  return execFileSync("node", ["--input-type=module", "-e", code], {
    env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8",
  });
}
const STORE = new URL("../src/core/store.mjs", import.meta.url).href;

describe("progress store robustness", () => {
  let home;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kanthropic-store-"));
    mkdirSync(join(home, ".kanthropic"), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const progress = (h) => join(h, ".kanthropic", "progress.json");

  it("keeps app drill progress when the CLI updates the shared store", () => {
    const saved = {
      activeDrill: "hiragana:gojuon",
      drillProgress: { "hiragana:gojuon": { date: "2026-10-09", streaks: { "あ": 2 }, correct: 2, seen: 3 } },
    };
    writeFileSync(progress(home), JSON.stringify(saved), "utf8");
    const out = inHome(home, `
      import { update } from ${JSON.stringify(STORE)};
      const s = update((store) => { store.config.script = "katakana"; });
      console.log(JSON.stringify({ activeDrill: s.activeDrill, drillProgress: s.drillProgress }));
    `);
    expect(JSON.parse(out)).toEqual(saved);
  });

  it("quarantines a corrupt progress.json instead of silently zeroing it", () => {
    writeFileSync(progress(home), '{"cards": {"あ": {  TRUNCATED', "utf8");
    const out = inHome(home, `
      import { load, save } from ${JSON.stringify(STORE)};
      const s = load();          // corrupt → fresh store, original quarantined
      save(s);                   // would previously overwrite the evidence
      console.log(JSON.stringify(s.cards));
    `);
    expect(out.trim()).toBe("{}");
    const kept = readdirSync(join(home, ".kanthropic")).filter((f) => f.startsWith("progress.json.corrupt-"));
    expect(kept.length).toBe(1);
    expect(readFileSync(join(home, ".kanthropic", kept[0]), "utf8")).toContain("TRUNCATED");
  });

  it("update() applies deltas against a FRESH load (stale snapshots can't clobber)", () => {
    const out = inHome(home, `
      import { load, save, update } from ${JSON.stringify(STORE)};
      const stale = load();                 // snapshot BEFORE any writes
      update((s) => { s.cards["あ"] = { seen: 1, misses: 0 }; s.learned = ["あ"]; });
      // A second writer using update() must keep あ even though ITS caller
      // held a snapshot from before あ existed:
      stale.cards["い"] = { seen: 1, misses: 0 }; // the OLD, lossy pattern...
      update((s) => { s.cards["い"] = { seen: 1, misses: 0 }; }); // ...vs the fix
      const final = load();
      console.log(JSON.stringify({ keys: Object.keys(final.cards).sort(), learned: final.learned }));
    `);
    expect(JSON.parse(out.trim())).toEqual({ keys: ["あ", "い"], learned: ["あ"] });
  });

  it("coerces a hand-corrupted config.script back to a valid script", () => {
    writeFileSync(progress(home), JSON.stringify({
      version: 1, config: { script: "klingon", frontMs: -5 }, cards: {}, learned: [],
    }), "utf8");
    const out = inHome(home, `
      import { load } from ${JSON.stringify(STORE)};
      const s = load();
      console.log(s.config.script, s.config.frontMs);
    `);
    expect(out.trim()).toBe("hiragana 2600");
  });
});
