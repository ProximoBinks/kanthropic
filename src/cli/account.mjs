/** `kanthropic account` — email + password sign up / sign in for cloud sync. */
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { authenticate, syncConfig, syncNow } from "../core/cloud.mjs";
import { load } from "../core/store.mjs";

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

/** Prompt for one line; `hidden` echoes nothing (passwords). */
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    if (hidden) {
      // @ts-ignore — readline has no public "mute" switch
      rl._writeToOutput = (s) => { if (s.includes(question)) stdout.write(question); };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) stdout.write("\n");
      resolve(answer);
    });
  });
}

/** @param {string[]} rest @param {Record<string, string|boolean>} flags */
export async function runAccount(rest, flags) {
  const sub = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  if (sub !== "signup" && sub !== "login") {
    const cfg = syncConfig();
    stdout.write(cfg?.email
      ? `signed in as ${bold(cfg.email)} ${dim("· kanthropic sync off to sign out")}\n`
      : `${bold("kanthropic account signup")} [--email you@x.com]   create an account with this machine's progress\n`
        + `${bold("kanthropic account login")}  [--email you@x.com]   sign in on another machine\n`);
    return;
  }
  if (!stdin.isTTY) {
    stdout.write(red("✗ this needs a terminal to type your password into — run it in Terminal / iTerm\n"));
    process.exit(1);
  }
  const email = typeof flags.email === "string" ? flags.email : await ask("email: ");
  const password = await ask("password: ", true);
  if (sub === "signup" && (await ask("again: ", true)) !== password) {
    stdout.write(red("✗ passwords don't match\n"));
    process.exit(1);
  }
  try {
    const cfg = await authenticate(sub, email, password);
    stdout.write(`${green("✓")} ${sub === "signup" ? "account created" : "signed in"} as ${bold(cfg.email)}\n`);
    const learned = load().learned.length;
    const r = await syncNow(cfg);
    stdout.write(`${green("✓ synced")} ${dim(`(${r.pushed} sent, ${r.pulled} received · ${learned} characters learned here)`)}\n`);
    stdout.write(`\n  on your phone: ${bold(cfg.webUrl)} → sign in → Share → Add to Home Screen\n\n`);
  } catch (e) {
    stdout.write(red(`✗ ${e.message}\n`));
    process.exit(1);
  }
}
