"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

function normalize(email: string) {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) throw new Error("that doesn't look like an email address");
  return e;
}

function checkPassword(pw: string) {
  if (pw.length < 8) throw new Error("password must be at least 8 characters");
  if (pw.length > 256) throw new Error("password is too long");
}

async function hashPassword(pw: string, salt = randomBytes(16)) {
  return { salt: salt.toString("base64"), hash: (await scrypt(pw, salt, 32)).toString("base64") };
}

async function verify(email: string, password: string, ctx: any): Promise<{ key: string }> {
  const row: { salt: string; hash: string; key: string; lockedUntil: number } | null = await ctx.runQuery(internal.accounts.byEmail, { email });
  const bad = new Error("wrong email or password");
  if (!row) {
    await hashPassword(password); // same cost either way, so timing doesn't reveal which emails exist
    throw bad;
  }
  if (row.lockedUntil > Date.now()) throw new Error("too many attempts — try again in a few minutes");
  const { hash } = await hashPassword(password, Buffer.from(row.salt, "base64"));
  const ok = timingSafeEqual(Buffer.from(hash, "base64"), Buffer.from(row.hash, "base64"));
  await ctx.runMutation(internal.accounts.recordAttempt, { email, ok });
  if (!ok) throw bad;
  return row;
}

/**
 * Create an account. Pass the device's current sync `key` to keep the progress
 * it already synced; otherwise the account gets a fresh, empty space.
 * Returns the sync key every signed-in device uses.
 */
export const signup = action({
  args: { email: v.string(), password: v.string(), key: v.optional(v.string()) },
  handler: async (ctx, { email, password, key }): Promise<{ email: string; key: string }> => {
    const e = normalize(email);
    checkPassword(password);
    const syncKey = key && key.length >= 32 && key.length <= 128 ? key : randomBytes(32).toString("base64url");
    await ctx.runMutation(internal.accounts.create, { email: e, ...(await hashPassword(password)), key: syncKey });
    return { email: e, key: syncKey };
  },
});

/** Sign in: returns the account's sync key. */
export const login = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<{ email: string; key: string }> => {
    const e = normalize(email);
    const row = await verify(e, password, ctx);
    return { email: e, key: row.key };
  },
});

export const changePassword = action({
  args: { email: v.string(), password: v.string(), newPassword: v.string() },
  handler: async (ctx, { email, password, newPassword }): Promise<null> => {
    const e = normalize(email);
    await verify(e, password, ctx);
    checkPassword(newPassword);
    await ctx.runMutation(internal.accounts.setPassword, { email: e, ...(await hashPassword(newPassword)) });
    return null;
  },
});
