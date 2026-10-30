/**
 * Cloud sync, Node half: the transport and the files. The diff and merge
 * live in sync.mjs so the macOS app and the PWA make the same decisions.
 *
 *   ~/.kanthropic/sync.json       { convexUrl, key, webUrl?, email? }  (0600)
 *   ~/.kanthropic/sync-base.json  { rev, flat }  what the server last told us
 */
import { readFileSync, chmodSync } from "node:fs";
import { SYNC_BASE_PATH, SYNC_CONFIG_PATH } from "./paths.mjs";
import { writeAtomic } from "./fsutil.mjs";
import { load, update } from "./store.mjs";
import { emptyBase, finish, newSyncKey, prepare } from "./sync.mjs";

/** The hosted kanthropic backend + PWA. `sync setup --url/--web` overrides them. */
export const DEFAULT_CONVEX_URL = "https://impressive-ptarmigan-803.convex.cloud";
export const DEFAULT_WEB_URL = "https://kanthropic.vercel.app";

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

/** @returns {{ convexUrl: string, key: string, webUrl?: string, email?: string } | null} */
export function syncConfig() {
  const c = readJson(SYNC_CONFIG_PATH);
  if (!c || typeof c.convexUrl !== "string" || typeof c.key !== "string") return null;
  return c;
}

/** Save sync settings. Generates a key unless one is given (pairing with an existing space). */
export function configureSync({ convexUrl, key = null, webUrl = null, email = null }) {
  const prev = syncConfig();
  const next = {
    convexUrl: convexUrl.replace(/\/+$/, ""),
    key: key || prev?.key || newSyncKey(),
    ...(webUrl || prev?.webUrl ? { webUrl: (webUrl || prev.webUrl).replace(/\/+$/, "") } : {}),
    ...(email ? { email } : {}),
  };
  // A different space means our base describes someone else's data.
  if (prev && (prev.key !== next.key || prev.convexUrl !== next.convexUrl)) {
    writeAtomic(SYNC_BASE_PATH, JSON.stringify(emptyBase()));
  }
  writeAtomic(SYNC_CONFIG_PATH, JSON.stringify(next, null, 2));
  try { chmodSync(SYNC_CONFIG_PATH, 0o600); } catch { /* best-effort */ }
  return next;
}

/** Link that opens the PWA already paired with this space. */
export function pairingLink(cfg) {
  if (!cfg?.webUrl) return null;
  return `${cfg.webUrl}/#pair=${encodeURIComponent(cfg.key)}`;
}

/** Call a Convex function over the public HTTP API. */
async function call(kind, convexUrl, path, args) {
  const res = await fetch(`${convexUrl}/api/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== "success") {
    // Convex wraps thrown errors as "[Request ID: …] Server Error\nUncaught Error: <ours>\n    at …".
    const msg = String(body?.errorMessage || `request failed (HTTP ${res.status})`);
    throw new Error(msg.match(/Uncaught Error: (.*)/)?.[1] ?? msg);
  }
  return body.value;
}

const mutation = (url, path, args) => call("mutation", url, path, args);

/**
 * Create an account (keeping this machine's existing sync space, so the
 * progress already here becomes the account's) or sign in to one. Either way
 * the account's key is saved as this machine's sync key.
 * @param {"signup" | "login"} mode
 */
export async function authenticate(mode, email, password, convexUrl = syncConfig()?.convexUrl || DEFAULT_CONVEX_URL) {
  const prev = syncConfig();
  const sameBackend = prev?.convexUrl === convexUrl.replace(/\/+$/, "");
  const args = mode === "signup"
    ? { email, password, ...(sameBackend && prev?.key ? { key: prev.key } : {}) }
    : { email, password };
  const r = await call("action", convexUrl, `accountsNode:${mode}`, args);
  return configureSync({ convexUrl, key: r.key, email: r.email, webUrl: prev?.webUrl || DEFAULT_WEB_URL });
}

/**
 * One sync round against the configured space. Never holds the progress lock
 * across the network call: changes made meanwhile are kept and pushed next time.
 * @returns {Promise<{ pushed: number, pulled: number, changed: boolean }>}
 */
export async function syncNow(cfg = syncConfig()) {
  if (!cfg) throw new Error("sync isn't set up — run `kanthropic sync setup --url <convex url>`");
  const base = readJson(SYNC_BASE_PATH) ?? emptyBase();
  const { since, changes, sent } = prepare(base, load());
  const reply = await mutation(cfg.convexUrl, "sync:sync", { key: cfg.key, since, changes });
  let changed = false;
  let nextBase = base;
  update((store) => {
    const r = finish(base, sent, reply, store);
    Object.assign(store, r.store);
    changed = r.changed;
    nextBase = r.base;
  });
  writeAtomic(SYNC_BASE_PATH, JSON.stringify(nextBase));
  return { pushed: changes.length, pulled: reply.docs.length, changed };
}
