// kanthropic VS Code extension — the kana panel that opens beside Claude Code
// while it's thinking and closes when it's done.
//
// CommonJS host (the VS Code extension host runtime). All the shared kana
// logic lives in the parent package's ESM modules (../src/**); we load them
// with dynamic import() so there is ONE source of truth for the dataset, the
// FSRS grading, and the weighted picker. The webview is pure presentation and
// talks to the host over messages; the host owns all state + persistence.

const vscode = require("vscode");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const PORT_FILE = path.join(os.homedir(), ".kanthropic", "panel-port");
const PORT_RANGE = [39271, 39272, 39273, 39274, 39275];

/** Dynamically import a sibling ESM module from ../src by relative path. */
function esm(rel) {
  return import(pathToFileURL(path.join(__dirname, "..", "src", rel)).href);
}

let mods = null; // { kana, store, scheduler, ambient }
async function loadMods() {
  if (mods) return mods;
  const [kana, store, scheduler, ambient] = await Promise.all([
    esm("data/kana.mjs"), esm("core/store.mjs"),
    esm("core/scheduler.mjs"), esm("core/ambient.mjs"),
  ]);
  mods = { kana, store, scheduler, ambient };
  return mods;
}

/** @type {vscode.WebviewPanel | undefined} */
let panel;
let server;
let boundPort = 0;
let lastGlyph = null;
let statusItem;

function currentScript() {
  return vscode.workspace.getConfiguration("kanthropic").get("script", "hiragana");
}

/** Pick the next weighted card and post it to the webview. */
async function sendNextCard() {
  if (!panel) return;
  const { store, ambient } = await loadMods();
  const data = store.load();
  const script = currentScript();
  const next = ambient.pickNext(script, data.cards, lastGlyph);
  if (!next) return;
  lastGlyph = next.glyph;
  panel.webview.postMessage({ type: "card", glyph: next.glyph, script });
}

/** Grade a typed answer, persist FSRS state, and report the result back. */
async function gradeAnswer(text) {
  if (!panel) return;
  const { kana, store, scheduler } = await loadMods();
  const script = currentScript();
  const glyph = lastGlyph;
  const entry = kana.entryByGlyph(script, glyph);
  if (!entry) return;
  const correct = kana.checkAnswer(text, entry);

  const data = store.load();
  data.config.script = script;
  data.cards[glyph] = scheduler.gradeCard(script, glyph, data.cards[glyph], correct);
  store.save(data);

  panel.webview.postMessage({ type: "result", correct, romaji: entry.romaji, answer: text });
}

function webviewHtml(webview) {
  const nonce = String(Math.random()).slice(2);
  const asset = (f) => webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, "webview", f)));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");
  let html = fs.readFileSync(path.join(__dirname, "webview", "panel.html"), "utf8");
  return html
    .replace(/__CSP__/g, csp)
    .replace(/__NONCE__/g, nonce)
    .replace(/__CSS__/g, asset("panel.css"))
    .replace(/__JS__/g, asset("panel.js"));
}

function openPanel() {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside, false); // false = take focus to type
    return;
  }
  panel = vscode.window.createWebviewPanel(
    "kanthropicPanel", "かな kanthropic", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(__dirname, "webview"))] },
  );
  panel.webview.html = webviewHtml(panel.webview);
  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.type === "ready") await sendNextCard();
      else if (msg.type === "answer") await gradeAnswer(msg.text ?? "");
      else if (msg.type === "next") await sendNextCard();
    } catch (e) { console.error("kanthropic:", e); }
  });
  panel.onDidDispose(() => { panel = undefined; });
}

function closePanel() {
  if (panel) { panel.dispose(); panel = undefined; }
}

/** Tiny loopback the Claude hooks ping: /start opens, /stop closes. */
function startServer() {
  server = http.createServer((req, res) => {
    const url = (req.url || "").split("?")[0];
    res.setHeader("content-type", "text/plain");
    if (url === "/start") {
      vscode.commands.executeCommand("kanthropic.openPanel");
      res.end("ok");
    } else if (url === "/stop") {
      const close = vscode.workspace.getConfiguration("kanthropic").get("closeOnStop", true);
      if (close) vscode.commands.executeCommand("kanthropic.closePanel");
      res.end("ok");
    } else if (url === "/ping") {
      res.end("kanthropic");
    } else {
      res.statusCode = 404; res.end("no");
    }
  });
  server.on("error", () => { /* port in use → tryNextPort handles it */ });

  let i = 0;
  const tryBind = () => {
    if (i >= PORT_RANGE.length) return;
    const p = PORT_RANGE[i++];
    server.once("error", tryBind);
    server.listen(p, "127.0.0.1", () => {
      boundPort = p;
      try {
        fs.mkdirSync(path.dirname(PORT_FILE), { recursive: true });
        fs.writeFileSync(PORT_FILE, String(p), "utf8");
      } catch { /* ignore */ }
      if (statusItem) statusItem.text = "$(mortar-board) kana";
    });
  };
  tryBind();
}

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = "$(mortar-board) kana";
  statusItem.tooltip = "kanthropic — open the kana panel";
  statusItem.command = "kanthropic.openPanel";
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("kanthropic.openPanel", openPanel),
    vscode.commands.registerCommand("kanthropic.closePanel", closePanel),
    vscode.commands.registerCommand("kanthropic.toggleScript", async () => {
      const cfg = vscode.workspace.getConfiguration("kanthropic");
      const next = cfg.get("script") === "hiragana" ? "katakana" : "hiragana";
      await cfg.update("script", next, vscode.ConfigurationTarget.Global);
      lastGlyph = null;
      if (panel) await sendNextCard();
      vscode.window.showInformationMessage(`kanthropic: now drilling ${next}.`);
    }),
    { dispose: () => { try { server && server.close(); } catch { /* */ }
                       try { fs.existsSync(PORT_FILE) && fs.rmSync(PORT_FILE); } catch { /* */ } } },
  );

  startServer();
}

function deactivate() {
  try { server && server.close(); } catch { /* */ }
  try { fs.existsSync(PORT_FILE) && fs.rmSync(PORT_FILE); } catch { /* */ }
}

module.exports = { activate, deactivate };
