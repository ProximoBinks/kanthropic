import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// One "space" per pairing key. Every device holding the key reads and writes
// the same space; the key itself never reaches the database, only its hash.
export default defineSchema({
  // Email + password → the sync key of that person's space. Signing in on a
  // device just hands it the key; sync itself is unchanged.
  accounts: defineTable({
    email: v.string(),
    salt: v.string(),
    hash: v.string(),
    key: v.string(),
    failures: v.number(),
    lockedUntil: v.number(),
  }).index("by_email", ["email"]),

  spaces: defineTable({
    space: v.string(),
    rev: v.number(),
  }).index("by_space", ["space"]),

  // One row per synced key (see src/core/sync.mjs), value as a JSON string.
  // `value: null` is a tombstone, kept so devices that are behind still learn
  // about the delete.
  entries: defineTable({
    space: v.string(),
    key: v.string(),
    value: v.union(v.string(), v.null()),
    rev: v.number(),
  })
    .index("by_space_key", ["space", "key"])
    .index("by_space_rev", ["space", "rev"]),
});
