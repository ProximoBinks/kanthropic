/**
 * Browser sync loop. Same diff/merge as the CLI and the Mac app (src/core/sync.mjs);
 * the transport is the Convex client, plus a live subscription to the space's
 * head revision so another device's answers show up within a second or so.
 */
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { emptyBase, finish, newSyncKey, prepare } from "../../src/core/sync.mjs";
import { load, onWrite, saveQuiet } from "./store.js";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL;
const KEY_SLOT = "kanthropic:sync";
const BASE_SLOT = "kanthropic:sync-base";

/** @type {ConvexClient | null} */
let client = null;
let unsubscribe = null;
let timer = null;
let running = false;
let again = false;
const status = { state: "off", at: 0, error: "" };
const statusListeners = new Set();
let onRemote = () => {};
let started = false;

function setStatus(next) {
  Object.assign(status, next);
  for (const fn of statusListeners) fn({ ...status });
}

export function onStatus(fn) {
  statusListeners.add(fn);
  fn({ ...status });
  return () => statusListeners.delete(fn);
}

export function syncAvailable() {
  return !!CONVEX_URL;
}

export function accountEmail() {
  try { return JSON.parse(localStorage.getItem(KEY_SLOT) || "null")?.email || null; } catch { return null; }
}

/**
 * Sign up (keeping whatever this browser already synced) or sign in, then sync
 * with the account's space. Throws a readable message on failure.
 * @param {"signup" | "login"} mode
 */
export async function authenticate(mode, email, password) {
  const http = new ConvexHttpClient(CONVEX_URL);
  const args = mode === "signup" ? { email, password, ...(syncKey() ? { key: syncKey() } : {}) } : { email, password };
  let r;
  try {
    r = await http.action(mode === "signup" ? anyApi.accountsNode.signup : anyApi.accountsNode.login, args);
  } catch (e) {
    const msg = String(e?.message || e);
    throw new Error(msg.match(/Uncaught Error: (.*)/)?.[1] ?? msg);
  }
  pair(r.key, r.email);
  return r;
}

export function syncKey() {
  try { return JSON.parse(localStorage.getItem(KEY_SLOT) || "null")?.key || null; } catch { return null; }
}

function readBase() {
  try { return JSON.parse(localStorage.getItem(BASE_SLOT) || "null") || emptyBase(); } catch { return emptyBase(); }
}

/** Pair this browser with a space (an existing key, or a brand new one). */
export function pair(key = null, email = null) {
  const next = (key || "").trim() || newSyncKey();
  if (next !== syncKey()) localStorage.setItem(BASE_SLOT, JSON.stringify(emptyBase()));
  localStorage.setItem(KEY_SLOT, JSON.stringify({ key: next, ...(email ? { email } : {}) }));
  if (started) start(onRemote);
  return next;
}

export function unpair() {
  localStorage.removeItem(KEY_SLOT);
  localStorage.removeItem(BASE_SLOT);
  stop();
  setStatus({ state: "off", error: "" });
}

async function round() {
  const key = syncKey();
  if (!client || !key) return;
  if (running) { again = true; return; }
  running = true;
  const mine = client;
  setStatus({ state: "syncing" });
  try {
    const base = readBase();
    const { since, changes, sent } = prepare(base, load());
    const reply = await mine.mutation(anyApi.sync.sync, { key, since, changes });
    if (mine !== client) return; // unpaired or re-paired meanwhile
    const r = finish(base, sent, reply, load());
    saveQuiet(r.store);
    localStorage.setItem(BASE_SLOT, JSON.stringify(r.base));
    setStatus({ state: "ok", at: Date.now(), error: "" });
    if (r.changed) onRemote();
  } catch (e) {
    setStatus({ state: navigator.onLine === false ? "offline" : "error", error: String(e?.message || e) });
  } finally {
    if (mine === client) running = false;
    if (again) { again = false; soon(200); }
  }
}

/** Debounced sync, so a burst of answers goes up in one round trip. */
export function soon(ms = 1200) {
  clearTimeout(timer);
  timer = setTimeout(round, ms);
}

export function syncNow() {
  clearTimeout(timer);
  return round();
}

function stop() {
  unsubscribe?.();
  unsubscribe = null;
  client?.close();
  client = null;
  running = false; // a request on the closed client never settles
}

/** @param {() => void} remote  called when a sync pulled in someone else's changes */
export function start(remote) {
  onRemote = remote;
  started = true;
  stop();
  const key = syncKey();
  if (!CONVEX_URL || !key) { setStatus({ state: "off" }); return; }
  client = new ConvexClient(CONVEX_URL);
  unsubscribe = client.onUpdate(anyApi.sync.head, { key }, (rev) => {
    if (typeof rev === "number" && rev !== readBase().rev) soon(50);
  });
  syncNow();
}

onWrite(() => { if (syncKey()) soon(); });
if (typeof window !== "undefined") {
  window.addEventListener("online", () => soon(100));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") soon(50);
    else if (syncKey()) syncNow();
  });
}
