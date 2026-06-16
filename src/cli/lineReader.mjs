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
  return {
    /** @returns {Promise<string|null>} */
    next() {
      if (queue.length) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((res) => waiters.push(res));
    },
    close() { rl.close(); },
  };
}
