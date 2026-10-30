import { render } from "preact";
import kanaFont from "../../assets/fonts/kana.ttf?url";
import { App } from "./app.jsx";
import { Session } from "./session.js";
import { PhraseSession } from "./phrase-session.js";
import { pair, start, syncKey } from "./cloud.js";
import "./styles.css";

const face = new FontFace("Kana", `url(${kanaFont})`);
face.load().then((f) => document.fonts.add(f)).catch(() => { /* system kana fonts still work */ });

// A pairing link (from `kanthropic sync link` or another device) carries the
// key in the fragment, which never reaches a server. It stays in the address
// bar so "Add to Home Screen" bakes it into the icon — iOS gives home-screen
// apps their own storage, and this way the icon pairs itself on first launch.
const m = location.hash.match(/pair=([^&]+)/);
if (m) {
  const key = decodeURIComponent(m[1]);
  if (key !== syncKey()) pair(key);
}

const session = new Session();
const phrases = new PhraseSession();
session.appear();
start(() => { session.remoteChanged(); phrases.remoteChanged(); });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") session.requestFocus();
});

render(<App session={session} phrases={phrases} />, document.getElementById("app"));

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").then(async (reg) => {
    await navigator.serviceWorker.ready;
    // Hand the SW everything this page loaded (hashed bundles, the font) so the
    // app works offline from the very next launch.
    const urls = [location.pathname, ...performance.getEntriesByType("resource").map((e) => e.name)]
      .filter((u) => { try { return new URL(u, location.href).origin === location.origin; } catch { return false; } });
    (reg.active || navigator.serviceWorker.controller)?.postMessage({ cache: urls });
  }).catch(() => { /* offline support is a bonus */ });
}
