import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Storage half of accounts. Hashing lives in accountsNode.ts (Node runtime, scrypt);
// these are internal so the only way in is through those actions.

export const byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    ctx.db.query("accounts").withIndex("by_email", (q) => q.eq("email", email)).unique(),
});

export const create = internalMutation({
  args: { email: v.string(), salt: v.string(), hash: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("accounts").withIndex("by_email", (q) => q.eq("email", args.email)).unique();
    if (existing) throw new Error("an account with that email already exists — sign in instead");
    await ctx.db.insert("accounts", { ...args, failures: 0, lockedUntil: 0 });
  },
});

export const recordAttempt = internalMutation({
  args: { email: v.string(), ok: v.boolean() },
  handler: async (ctx, { email, ok }) => {
    const row = await ctx.db.query("accounts").withIndex("by_email", (q) => q.eq("email", email)).unique();
    if (!row) return;
    if (ok) return void (await ctx.db.patch(row._id, { failures: 0, lockedUntil: 0 }));
    const failures = (row.failures ?? 0) + 1;
    // After 5 misses, back off: 1 min, 2, 4… capped at an hour.
    const lockedUntil = failures >= 5 ? Date.now() + Math.min(60, 2 ** (failures - 5)) * 60_000 : 0;
    await ctx.db.patch(row._id, { failures, lockedUntil });
  },
});

export const setPassword = internalMutation({
  args: { email: v.string(), salt: v.string(), hash: v.string() },
  handler: async (ctx, { email, salt, hash }) => {
    const row = await ctx.db.query("accounts").withIndex("by_email", (q) => q.eq("email", email)).unique();
    if (row) await ctx.db.patch(row._id, { salt, hash, failures: 0, lockedUntil: 0 });
  },
});

/** Admin: delete an account (`npx convex run accounts:remove '{"email":"…"}'`). Its synced progress stays. */
export const remove = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const row = await ctx.db.query("accounts").withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase())).unique();
    if (row) await ctx.db.delete(row._id);
    return !!row;
  },
});
