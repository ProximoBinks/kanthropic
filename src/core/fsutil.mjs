/** Shared fs helpers: crash-safe writes and a coarse cross-process lock. */
import { writeFileSync, renameSync, unlinkSync, mkdirSync, rmdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** Write text to `path` via temp file + rename, so a crash mid-write can never
 *  leave a truncated file behind. Throws on failure (callers decide how to
 *  react) — deliberately NO direct-write fallback, which would reintroduce the
 *  torn-write window the rename exists to close.
 *  @param {string} path @param {string} text */
export function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text, "utf8");
  try { renameSync(tmp, path); }
  catch (e) { try { unlinkSync(tmp); } catch { /* ignore */ } throw e; }
}

/** Run `fn` while holding a mkdir-based lock beside `path`, so concurrent
 *  processes (e.g. two drill panes) serialize their read-modify-write cycles.
 *  A lock older than `staleMs` is treated as crashed and stolen. If the lock
 *  can't be acquired within `waitMs`, `fn` runs WITHOUT it — a rare
 *  last-writer-wins beats hanging an interactive prompt.
 *  @template T @param {string} path @param {() => T} fn @returns {T} */
export function withLock(path, fn, { waitMs = 500, staleMs = 2000 } = {}) {
  const lock = path + ".lock";
  const deadline = Date.now() + waitMs;
  let held = false;
  while (!held && Date.now() <= deadline) {
    try { mkdirSync(lock); held = true; }
    catch {
      try { if (Date.now() - statSync(lock).mtimeMs > staleMs) { rmdirSync(lock); continue; } }
      catch { continue; } // lock vanished between mkdir and stat → retry now
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return fn(); }
  finally { if (held) { try { rmdirSync(lock); } catch { /* ignore */ } } }
}
