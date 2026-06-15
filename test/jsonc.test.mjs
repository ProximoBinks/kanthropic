import { describe, it, expect } from "vitest";
import { parseable, readTopLevel, upsertTopLevel, removeTopLevel } from "../src/core/jsonc.mjs";

describe("jsonc minimal-diff editor", () => {
  it("upserts into an empty object", () => {
    const out = upsertTopLevel("{\n}\n", "statusLine", '{"type":"command"}');
    expect(parseable(out)).toBe(true);
    expect(readTopLevel(out, "statusLine")).toEqual({ type: "command" });
  });

  it("preserves comments and other keys + order", () => {
    const src = `{
  // user comment
  "model": "claude",
  "permissions": { "allow": ["a"] }
}`;
    const out = upsertTopLevel(src, "statusLine", '{"type":"command","command":"node x"}');
    expect(out).toContain("// user comment");
    expect(out).toContain('"model": "claude"');
    expect(readTopLevel(out, "model")).toBe("claude");
    expect(readTopLevel(out, "statusLine")).toEqual({ type: "command", command: "node x" });
  });

  it("replaces only the target key's value span (idempotent)", () => {
    let src = '{ "statusLine": {"type":"command","command":"old"}, "model": "x" }';
    src = upsertTopLevel(src, "statusLine", '{"type":"command","command":"new"}');
    src = upsertTopLevel(src, "statusLine", '{"type":"command","command":"new"}');
    expect(readTopLevel(src, "statusLine")).toEqual({ type: "command", command: "new" });
    expect(readTopLevel(src, "model")).toBe("x");
  });

  it("round-trips: remove what upsert added into a fresh shell", () => {
    const base = "{\n}\n";
    const added = upsertTopLevel(base, "statusLine", '{"type":"command"}');
    const removed = removeTopLevel(added, "statusLine");
    expect(/^[\s{}]*$/.test(removed)).toBe(true);
  });

  it("removes a middle key without leaving a dangling comma", () => {
    const src = '{ "a": 1, "statusLine": {"x":2}, "b": 3 }';
    const out = removeTopLevel(src, "statusLine");
    expect(parseable(out)).toBe(true);
    expect(readTopLevel(out, "a")).toBe(1);
    expect(readTopLevel(out, "b")).toBe(3);
    expect(readTopLevel(out, "statusLine")).toBeUndefined();
  });

  it("treats unparseable input safely", () => {
    expect(parseable("{ not json")).toBe(false);
    expect(removeTopLevel("{ not json", "x")).toBe("{ not json");
    expect(readTopLevel("{ not json", "x")).toBeUndefined();
  });
});
