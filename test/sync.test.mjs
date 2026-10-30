import { describe, it, expect } from "vitest";
import { emptyStore } from "../src/core/store.mjs";
import { gradeCard } from "../src/core/scheduler.mjs";
import { diff, emptyBase, finish, flatten, prepare, resolve, unflatten } from "../src/core/sync.mjs";

/** In-memory twin of convex/sync.ts so the round trip runs without a deployment. */
function memoryServer() {
  const rows = new Map(); // key -> { value, rev }
  let head = 0;
  return {
    rows,
    sync({ since, changes }) {
      let rev = head;
      const pushed = new Map();
      for (const { k, v } of changes) {
        const current = rows.get(k)?.value ?? null;
        let next = v;
        if (v != null && current != null) {
          const cur = JSON.parse(current);
          next = resolve(k, cur, JSON.parse(v)) === cur ? current : v;
        }
        pushed.set(k, next);
        if (next === current && rows.has(k)) continue;
        rows.set(k, { value: next, rev: ++rev });
      }
      head = rev;
      const from = since > head ? 0 : since;
      const docs = new Map(pushed);
      for (const [k, r] of rows) if (r.rev > from) docs.set(k, r.value);
      return { rev, docs: [...docs].map(([k, v]) => ({ k, v })) };
    },
  };
}

function device(store = emptyStore()) {
  return { store, base: emptyBase() };
}

function syncDevice(d, server, { during } = {}) {
  const { since, changes, sent } = prepare(d.base, d.store);
  const reply = server.sync({ since, changes });
  if (during) during(d.store);
  const r = finish(d.base, sent, reply, d.store);
  d.store = r.store;
  d.base = r.base;
  return r;
}

const T0 = Date.UTC(2026, 9, 1, 12);

function review(d, glyph, correct, at) {
  d.store.cards[glyph] = gradeCard("hiragana", glyph, d.store.cards[glyph], correct, new Date(at));
  if (!d.store.learned.includes(glyph)) d.store.learned.push(glyph);
}

describe("cloud sync", () => {
  it("copies an existing deck to a fresh device", () => {
    const server = memoryServer();
    const mac = device();
    review(mac, "あ", true, T0);
    review(mac, "い", false, T0 + 1000);
    mac.store.dakutenStreaks = { ka: 2 };
    syncDevice(mac, server);

    const phone = device();
    const r = syncDevice(phone, server);
    expect(r.changed).toBe(true);
    expect(phone.store.cards).toEqual(mac.store.cards);
    expect(new Set(phone.store.learned)).toEqual(new Set(mac.store.learned));
    expect(phone.store.dakutenStreaks).toEqual({ ka: 2 });
    // Device-local config is untouched.
    expect(phone.store.config).toEqual(emptyStore().config);
  });

  it("merges different cards studied on two devices", () => {
    const server = memoryServer();
    const mac = device();
    const phone = device();
    review(mac, "あ", true, T0);
    review(phone, "か", true, T0 + 5000);
    syncDevice(mac, server);
    syncDevice(phone, server);
    syncDevice(mac, server);
    expect(Object.keys(mac.store.cards).sort()).toEqual(["あ", "か"]);
    expect(Object.keys(phone.store.cards).sort()).toEqual(["あ", "か"]);
    expect(new Set(mac.store.learned)).toEqual(new Set(["あ", "か"]));
  });

  it("keeps the most recent review when both devices graded the same card", () => {
    const server = memoryServer();
    const mac = device();
    const phone = device();
    review(phone, "あ", false, T0 + 60_000); // newer
    review(mac, "あ", true, T0);              // older, but syncs last
    syncDevice(phone, server);
    syncDevice(mac, server);
    expect(mac.store.cards["あ"].last_review).toBe(T0 + 60_000);
    syncDevice(mac, server); // and it doesn't keep re-pushing its losing copy
    expect(prepare(mac.base, mac.store).changes).toEqual([]);
  });

  it("propagates a reset (deleted cards and learned glyphs)", () => {
    const server = memoryServer();
    const mac = device();
    const phone = device();
    review(mac, "あ", true, T0);
    syncDevice(mac, server);
    syncDevice(phone, server);
    delete phone.store.cards["あ"];
    phone.store.learned = [];
    syncDevice(phone, server);
    syncDevice(mac, server);
    expect(mac.store.cards).toEqual({});
    expect(mac.store.learned).toEqual([]);
  });

  it("keeps an answer given while the request was in flight", () => {
    const server = memoryServer();
    const mac = device();
    review(mac, "あ", true, T0);
    syncDevice(mac, server, { during: (s) => { s.cards["う"] = gradeCard("hiragana", "う", undefined, true, new Date(T0 + 9)); } });
    expect(mac.store.cards["う"]).toBeTruthy();
    expect(prepare(mac.base, mac.store).changes.map((c) => c.k)).toEqual(["card:う"]);
  });

  it("ignores Swift's spelling of an empty drill", () => {
    const js = emptyStore();
    const swift = { ...emptyStore(), roteKind: "", activeDrill: null, rote: [] };
    expect(diff(flatten(js), flatten(swift))).toEqual([]);
  });

  it("sends values as JSON strings (Convex rejects non-ASCII field names)", () => {
    const d = device();
    d.store.drillProgress = { "hiragana:gojuon": { date: "2026-10-01", streaks: { "あ": 2 }, correct: 2, seen: 2 } };
    const { changes } = prepare(d.base, d.store);
    expect(changes).toEqual([{ k: "progress:hiragana:gojuon", v: '{"correct":2,"date":"2026-10-01","seen":2,"streaks":{"あ":2}}' }]);
  });

  it("starts over when the server is behind the device", () => {
    const mac = device();
    review(mac, "あ", true, T0);
    syncDevice(mac, memoryServer());
    const fresh = memoryServer(); // e.g. a new deployment
    syncDevice(mac, fresh);
    syncDevice(mac, fresh);
    expect(fresh.rows.has("card:あ")).toBe(true);
  });

  it("keeps keys from a newer app version instead of deleting them", () => {
    const base = { rev: 5, flat: { "card:あ": { due: 1, last_review: 1 }, "future:thing": { x: 1 } } };
    // This device's store came from that base: it doesn't know future:thing.
    const local = unflatten(base.flat, {});
    expect(local.syncExtra).toEqual({ "future:thing": { x: 1 } });
    const { changes } = prepare(base, local);
    expect(changes.find((c) => c.k === "future:thing")).toBeUndefined();
  });
});
