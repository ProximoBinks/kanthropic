/** `kanthropic sync` — set up, pair, and run cloud sync from the terminal. */
import { stdout } from "node:process";
import { rmSync } from "node:fs";
import { configureSync, DEFAULT_CONVEX_URL, pairingLink, syncConfig, syncNow } from "../core/cloud.mjs";
import { SYNC_BASE_PATH, SYNC_CONFIG_PATH } from "../core/paths.mjs";

const accent = (s) => `\x1b[38;5;176m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

/** Sync around a CLI drill when it's set up; offline must never block practice. */
export async function syncQuietly() {
  const cfg = syncConfig();
  if (!cfg) return;
  try {
    await Promise.race([syncNow(cfg), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 4000))]);
  } catch { /* next sync catches up */ }
}

async function printLink(cfg) {
  const link = pairingLink(cfg);
  if (!link) {
    stdout.write(`\n  sync key: ${bold(cfg.key)}\n`
      + dim("  paste it into the web app, or pass --web <pwa url> to get a link + QR code\n\n"));
    return;
  }
  stdout.write(`\n  open on your phone:\n  ${accent(link)}\n\n`);
  const { default: qr } = await import("qrcode-terminal");
  await new Promise((done) => qr.generate(link, { small: true }, (s) => { stdout.write(s.replace(/^/gm, "  ") + "\n"); done(null); }));
  stdout.write(dim("  then Share → Add to Home Screen. Anyone with this link can see and edit your progress.\n\n"));
}

async function runOnce(cfg) {
  try {
    const r = await syncNow(cfg);
    stdout.write(`${green("✓ synced")} ${dim(`(${r.pushed} sent, ${r.pulled} received)`)}\n`);
    return true;
  } catch (e) {
    stdout.write(red(`✗ ${e.message}\n`));
    return false;
  }
}

/** @param {string[]} rest @param {Record<string, string|boolean>} flags */
export async function runSync(rest, flags) {
  const sub = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  switch (sub) {
    case "setup": {
      const prev = syncConfig();
      const convexUrl = typeof flags.url === "string" ? flags.url : prev?.convexUrl || DEFAULT_CONVEX_URL;
      if (!convexUrl) {
        stdout.write(red("✗ need your Convex deployment URL: ") + bold("kanthropic sync setup --url https://<name>.convex.cloud [--web <pwa url>]\n"));
        process.exit(1);
      }
      const cfg = configureSync({
        convexUrl,
        key: typeof flags.key === "string" ? flags.key : null,
        webUrl: typeof flags.web === "string" ? flags.web : null,
      });
      stdout.write(`${green("✓")} sync configured ${dim(`→ ${SYNC_CONFIG_PATH}`)}\n`);
      if (await runOnce(cfg)) await printLink(cfg);
      break;
    }
    case "link": {
      const cfg = syncConfig();
      if (!cfg) { stdout.write(dim("sync isn't set up — run `kanthropic sync setup --url <convex url>`\n")); process.exit(1); }
      await printLink(cfg);
      break;
    }
    case "off": {
      rmSync(SYNC_CONFIG_PATH, { force: true });
      rmSync(SYNC_BASE_PATH, { force: true });
      stdout.write(`${green("✓")} sync off on this machine. ${dim("Your local progress is kept.")}\n`);
      break;
    }
    default: {
      const cfg = syncConfig();
      if (!cfg) {
        stdout.write(`\n${accent("kanthropic sync")} — progress on your Mac and your phone\n\n`
          + `  ${bold("sync setup")} --url <convex url> [--web <pwa url>] [--key <existing key>]\n`
          + `  ${bold("sync")}                 sync now\n`
          + `  ${bold("sync link")}            show the pairing link / QR again\n`
          + `  ${bold("sync off")}             stop syncing this machine\n\n`);
        return;
      }
      if (!(await runOnce(cfg))) process.exit(1);
    }
  }
}
