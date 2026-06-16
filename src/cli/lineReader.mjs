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
    close() { rl.close(); },
  };
}
