import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

/**
 * A line reader that buffers `line` events and survives stream close — so it
 * works identically for an interactive TTY and for piped input. `next()`
 * resolves to the next line, or null once input is exhausted. Shared by the
 * `study` and `drill` commands.
 */
export function makeLineReader() {
  const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on("line", (l) => {
    const w = waiters.shift();
    if (w) w(l); else queue.push(l);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });
  // With a raw-mode TTY the kernel never delivers SIGINT — readline emits this
  // event instead, and with NO listener it just pauses stdin, leaving the
  // process an unkillable zombie. Treat Ctrl-C exactly like EOF: close, which
  // resolves every pending/future next() with null so callers exit cleanly.
  rl.on("SIGINT", () => rl.close());
  return {
    /**
     * @param {string} [prompt] shown via readline's own prompt mechanism, so it
     *   is protected from backspace (the bug where deleting your answer ate the
     *   glyph). @returns {Promise<string|null>}
     */
    next(prompt = "") {
      if (prompt) {
        if (stdin.isTTY) { rl.setPrompt(prompt); rl.prompt(); }
        else stdout.write(prompt);
      }
      if (queue.length) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((res) => waiters.push(res));
    },
    /** Discard input buffered while nothing was awaiting (e.g. Enter spammed
     *  during the grade/sleep between cards), so it can't race ahead. */
    flush() { queue.length = 0; },
    /** Non-blocking: a buffered line if one is queued, null after close/EOF,
     *  undefined when there's simply nothing yet. Lets a poll loop check for
     *  input without parking a waiter that would swallow a later line.
     *  @returns {string | null | undefined} */
    tryNext() {
      if (queue.length) return queue.shift();
      return closed ? null : undefined;
    },
    close() { rl.close(); },
  };
}
