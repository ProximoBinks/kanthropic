/**
 * Cloud sync, pure half. No fs, no network, so the CLI, the macOS app (through
 * engine.js) and the PWA all share the same diff and merge.
 *
 * The store is flattened into independent keys, so two devices that study
 * different cards never overwrite each other:
 *
 *   card:<glyph>      CardState               (FSRS history)
 *   learned:<glyph>   true                    (in the deck)
 *   progress:<key>    drill-all day progress
 *   drill             { rote, roteKind, activeDrill }
 *   dakuten           dakuten streaks
 *   activity:<date>:<device>  that device's practice that day (activity.mjs)
 *   profile           { avatar }: a small JPEG data URL for the progress ring
 *
 * A missing key is the same as "absent", so deletions sync as `null`.
 * Keys this version doesn't know (added by a newer app) are kept as-is in
 * store.syncExtra and sent back unchanged, so an out-of-date device can
 * never delete data it doesn't understand.
 * Device-local things (config, ambient, learnedMigrated) never leave the machine.
 *
 * Protocol (see convex/sync.ts): the client pushes the keys that changed since
 * its last synced snapshot (the "base") and gets back every key that changed on
 * the server since `rev`, plus the winning value of each key it pushed. Values
 * travel and rest as JSON strings: Convex only allows ASCII field names, and
 * kana are object keys here (drill streaks).
 */

/** Deterministic JSON so Swift's key order / number formatting can't fake a change. */
export function stableStringify(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
}

/** Drop undefined fields so a value round-trips through JSON (and Convex) unchanged. */
function clean(v) {
  return v == null ? null : JSON.parse(JSON.stringify(v));
}

/** @param {Record<string, any>} store @returns {Record<string, any>} */
export function flatten(store) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [g, c] of Object.entries(store?.cards || {})) {
    if (c && typeof c === "object") out[`card:${g}`] = clean(c);
  }
  for (const g of store?.learned || []) {
    if (typeof g === "string") out[`learned:${g}`] = true;
  }
  for (const [k, p] of Object.entries(store?.drillProgress || {})) {
    if (p && typeof p === "object") out[`progress:${k}`] = clean(p);
  }
  const rote = Array.isArray(store?.rote) ? store.rote.filter((g) => typeof g === "string") : [];
  const roteKind = store?.roteKind === "row" || store?.roteKind === "cram" ? store.roteKind : null;
  const activeDrill = typeof store?.activeDrill === "string" && store.activeDrill ? store.activeDrill : null;
  if (rote.length || activeDrill) out.drill = { rote, roteKind, activeDrill };
  for (const [date, byDevice] of Object.entries(store?.activity || {})) {
    for (const [dev, e] of Object.entries(byDevice || {})) {
      if (e && typeof e === "object") out[`activity:${date}:${dev}`] = clean(e);
    }
  }
  const dak = store?.dakutenStreaks;
  if (dak && typeof dak === "object" && Object.keys(dak).length) out.dakuten = clean(dak);
  if (typeof store?.profile?.avatar === "string" && store.profile.avatar) out.profile = { avatar: store.profile.avatar };
  for (const [k, v] of Object.entries(store?.syncExtra || {})) {
    if (!(k in out) && v != null && !isKnown(k)) out[k] = clean(v);
  }
  return out;
}

/** Keys this version of flatten/unflatten handles itself. */
const KNOWN_PREFIXES = ["card:", "learned:", "progress:", "activity:"];
const KNOWN_KEYS = new Set(["drill", "dakuten", "profile"]);
function isKnown(k) {
  return KNOWN_KEYS.has(k) || KNOWN_PREFIXES.some((p) => k.startsWith(p));
}

/**
 * Write synced keys back into `local`, keeping its device-local fields.
 * Returns a new store object; `local` is not mutated.
 * @param {Record<string, any>} flat @param {Record<string, any>} local
 */
export function unflatten(flat, local) {
  /** @type {Record<string, any>} */
  const cards = {};
  const learned = [];
  /** @type {Record<string, any>} */
  const drillProgress = {};
  /** @type {Record<string, Record<string, any>>} */
  const activity = {};
  /** @type {Record<string, any>} */
  const syncExtra = {};
  for (const [k, v] of Object.entries(flat)) {
    if (v == null) continue;
    if (!isKnown(k)) syncExtra[k] = v;
    else if (k.startsWith("activity:")) {
      const [, date, dev] = k.split(":");
      (activity[date] ??= {})[dev] = v;
    }
    else if (k.startsWith("card:")) cards[k.slice(5)] = v;
    else if (k.startsWith("learned:")) learned.push(k.slice(8));
    else if (k.startsWith("progress:")) drillProgress[k.slice(9)] = v;
  }
  const drill = flat.drill || null;
  return {
    ...local,
    cards,
    learned,
    drillProgress,
    activity,
    rote: drill?.rote || [],
    roteKind: drill?.roteKind || null,
    activeDrill: drill?.activeDrill || null,
    dakutenStreaks: flat.dakuten || {},
    profile: flat.profile || {},
    syncExtra,
  };
}

/**
 * Keys whose value differs between two flattened snapshots.
 * @param {Record<string, any>} from @param {Record<string, any>} to
 * @returns {{ k: string, v: any }[]}  v === null means deleted
 */
export function diff(from, to) {
  const out = [];
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const k of keys) {
    const a = from[k] ?? null;
    const b = to[k] ?? null;
    if (stableStringify(a) !== stableStringify(b)) out.push({ k, v: b });
  }
  return out;
}

/** @param {Record<string, any>} flat @param {{ k: string, v: any }[]} docs */
export function applyDocs(flat, docs) {
  const out = { ...flat };
  for (const { k, v } of docs) {
    if (v == null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/**
 * Server-side conflict rule for one key. Both values are non-null here; a
 * deletion (or a first write) is plain last-writer-wins.
 *   card:     the more recent review wins (a review is a review, whichever
 *             device saw it); a tie (e.g. "I've been away") takes the incoming
 *   progress: same day → the one that's seen more answers; else the later day
 *   activity: the one with more answers (a device's day only grows)
 *   anything else: incoming wins
 * @param {string} key @param {any} current @param {any} incoming @returns {any}
 */
export function resolve(key, current, incoming) {
  if (key.startsWith("card:")) {
    return (current.last_review ?? 0) > (incoming.last_review ?? 0) ? current : incoming;
  }
  // One device's day only ever grows; keep the fuller copy.
  if (key.startsWith("activity:")) return (current.answers ?? 0) > (incoming.answers ?? 0) ? current : incoming;
  if (key.startsWith("progress:")) {
    if (current.date === incoming.date) return (current.seen ?? 0) > (incoming.seen ?? 0) ? current : incoming;
    return String(current.date) > String(incoming.date) ? current : incoming;
  }
  return incoming;
}

/** An empty sync base: nothing seen from the server yet. */
export function emptyBase() {
  return { rev: 0, flat: {} };
}

/** @param {{ k: string, v: any }[]} docs @returns {{ k: string, v: string | null }[]} */
export function encode(docs) {
  return docs.map(({ k, v }) => ({ k, v: v == null ? null : stableStringify(v) }));
}

/** @param {{ k: string, v: string | null }[]} docs @returns {{ k: string, v: any }[]} */
export function decode(docs) {
  return docs.map(({ k, v }) => {
    try { return { k, v: v == null ? null : JSON.parse(v) }; } catch { return { k, v: null }; }
  });
}

/**
 * Step 1 of a sync round: what to push (already encoded for the wire).
 * @param {{ rev: number, flat: Record<string, any> }} base @param {Record<string, any>} local
 */
export function prepare(base, local) {
  const sent = flatten(local);
  return { since: base.rev || 0, changes: encode(diff(base.flat || {}, sent)), sent };
}

/**
 * Step 2: fold the server's reply into the base and into the CURRENT local
 * store. Anything that changed locally while the request was in flight is kept
 * (and, because it now differs from the new base, pushed next round).
 *
 * @param {{ rev: number, flat: Record<string, any> }} base
 * @param {Record<string, any>} sent     the flattened local we pushed from
 * @param {{ rev: number, docs: { k: string, v: string | null }[] }} reply  as the server sent it
 * @param {Record<string, any>} current  the local store as it is now
 * @returns {{ base: { rev: number, flat: Record<string, any> }, store: Record<string, any>, changed: boolean }}
 */
export function finish(base, sent, reply, current) {
  // The server is behind us (reset / new deployment): its reply is the whole
  // truth, and whatever only we have gets pushed next round.
  const behind = reply.rev < (base.rev || 0);
  const docs = decode(reply.docs || []);
  const flat = applyDocs(behind ? {} : base.flat || {}, docs);
  const now = flatten(current);
  // Behind: keep everything local (the server only adds to it); otherwise the
  // new base plus whatever changed locally while the request was in flight.
  const merged = behind ? applyDocs(now, docs) : applyDocs(flat, diff(sent, now));
  const store = unflatten(merged, current);
  return {
    base: { rev: reply.rev, flat },
    store,
    changed: diff(now, merged).length > 0,
  };
}

/** Random pairing key (base64url, 32 bytes). Uses Web Crypto, present in Node 18+, browsers and Convex. */
export function newSyncKey() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
