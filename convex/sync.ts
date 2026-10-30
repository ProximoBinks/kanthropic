import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { resolve } from "../src/core/sync.mjs";

const MAX_CHANGES = 2000;

async function spaceOf(key: string): Promise<string> {
  if (key.length < 32 || key.length > 128) throw new Error("bad sync key");
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Push local changes and pull everything newer than `since` in one round trip.
 * Returns the new head `rev` and, for every key the caller should take, its
 * current value — including the winners for keys the caller pushed, so a
 * losing write isn't retried forever.
 */
export const sync = mutation({
  args: {
    key: v.string(),
    since: v.number(),
    // Values are JSON strings (see src/core/sync.mjs); null deletes.
    changes: v.array(v.object({ k: v.string(), v: v.union(v.string(), v.null()) })),
  },
  handler: async (ctx, { key, since, changes }) => {
    if (changes.length > MAX_CHANGES) throw new Error("too many changes in one sync");
    const space = await spaceOf(key);
    let head = await ctx.db.query("spaces").withIndex("by_space", (q) => q.eq("space", space)).unique();
    if (!head) {
      const id = await ctx.db.insert("spaces", { space, rev: 0 });
      head = (await ctx.db.get(id))!;
    }
    let rev = head.rev;

    const pushed = new Map<string, string | null>();
    for (const { k, v: incoming } of changes) {
      if (!k || k.length > 200 || (incoming != null && incoming.length > 64_000)) continue;
      const row = await ctx.db
        .query("entries")
        .withIndex("by_space_key", (q) => q.eq("space", space).eq("key", k))
        .unique();
      const current: string | null = row?.value ?? null;
      let next = incoming;
      if (incoming != null && current != null) {
        try {
          const cur = JSON.parse(current);
          next = resolve(k, cur, JSON.parse(incoming)) === cur ? current : incoming;
        } catch {
          next = incoming;
        }
      }
      pushed.set(k, next);
      if (next === current && row) continue;
      rev += 1;
      if (row) await ctx.db.patch(row._id, { value: next, rev });
      else await ctx.db.insert("entries", { space, key: k, value: next, rev });
    }
    if (rev !== head.rev) await ctx.db.patch(head._id, { rev });

    // A caller ahead of the server (data reset, new deployment) starts over.
    const from = since > head.rev ? 0 : since;
    const newer = await ctx.db
      .query("entries")
      .withIndex("by_space_rev", (q) => q.eq("space", space).gt("rev", from))
      .collect();
    const docs = new Map<string, string | null>(pushed);
    for (const row of newer) docs.set(row.key, row.value ?? null);
    return { rev, docs: [...docs].map(([k, value]) => ({ k, v: value })) };
  },
});

/** Head revision only — cheap to subscribe to, so a device knows when to sync. */
export const head = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const space = await spaceOf(key);
    const row = await ctx.db.query("spaces").withIndex("by_space", (q) => q.eq("space", space)).unique();
    return row?.rev ?? 0;
  },
});
