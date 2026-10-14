/**
 * Build and launch the macOS menu bar app.
 */
import { stdout, platform } from "node:process";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { installGrokHooks } from "../core/grok.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUILD_SH = join(ROOT, "macos", "build.sh");
const BUILT_APP = join(ROOT, "macos", "build", "Kanthropic.app");
const INSTALL_APP = existsSync("/Applications/Kanthropic.app")
  ? "/Applications/Kanthropic.app"
  : join(homedir(), "Applications", "Kanthropic.app");

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

function have(cmd) {
  try { execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }); return true; }
  catch { return false; }
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

/** @param {{ buildOnly?: boolean, skipHooks?: boolean }} [opts] */
export async function runApp(opts = {}) {
  if (platform !== "darwin") {
    stdout.write(`${c.red("✗")} the menu bar app is macOS only.\n`
      + c.dim("  On this machine use `kanthropic drill` / `kanthropic learn`.\n"));
    process.exitCode = 1;
    return;
  }
  if (!existsSync(BUILD_SH)) {
    stdout.write(`${c.red("✗")} macos/build.sh is missing — reinstall kanthropic from source.\n`);
    process.exitCode = 1;
    return;
  }
  if (!have("swiftc")) {
    stdout.write(`${c.red("✗")} swiftc not found. Install Xcode Command Line Tools:\n`
      + `  ${c.bold("xcode-select --install")}\n`);
    process.exitCode = 1;
    return;
  }

  stdout.write(`\n${c.bold("kanthropic")} — building the menu bar app\n`);
  try {
    const out = run("bash", [BUILD_SH], { cwd: ROOT });
    if (out.trim()) stdout.write(c.dim(out.trim() + "\n"));
  } catch (e) {
    stdout.write(`${c.red("✗")} build failed\n${e.stderr || e.stdout || e.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(BUILT_APP)) {
    stdout.write(`${c.red("✗")} build produced no Kanthropic.app\n`);
    process.exitCode = 1;
    return;
  }

  if (!INSTALL_APP.startsWith("/Applications")) {
    mkdirSync(join(homedir(), "Applications"), { recursive: true });
  }
  try {
    try { run("pkill", ["-x", "Kanthropic"]); } catch { /* not running */ }
    run("rm", ["-rf", INSTALL_APP]);
    run("ditto", [BUILT_APP, INSTALL_APP]);
  } catch (e) {
    stdout.write(`${c.red("✗")} could not install to ~/Applications\n${e.stderr || e.message}\n`);
    process.exitCode = 1;
    return;
  }
  stdout.write(`  ${c.green("✓")} installed ${c.dim(INSTALL_APP)}\n`);

  if (!opts.skipHooks) {
    const r = installGrokHooks();
    stdout.write(r.ok
      ? `  ${c.green("✓")} Grok Build hooks installed ${c.dim("(pops the app while Grok thinks)")}\n`
      : `  ${c.red("✗")} Grok hooks: ${r.reason}\n`);
  }

  if (opts.buildOnly) return;

  try {
    spawn("open", ["-a", INSTALL_APP], { detached: true, stdio: "ignore" }).unref();
  } catch (e) {
    stdout.write(`${c.red("✗")} could not launch: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  stdout.write(`  ${c.green("✓")} launched — look for ${c.bold("あ")} in the menu bar\n`
    + c.dim("    left-click a flashcard · right-click settings · pops while Grok thinks\n\n"));
}
