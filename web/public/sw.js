// kanthropic service worker: the app shell works offline; sync catches up later.
const CACHE = "kanthropic-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const urls = event.data?.cache;
  if (Array.isArray(urls)) event.waitUntil(caches.open(CACHE).then((c) => c.addAll([...new Set(urls)]).catch(() => {})));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // Pages: network first so updates land, cache when offline.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        cache.put(url.pathname, res.clone());
        return res;
      } catch {
        return (await cache.match(url.pathname)) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }

  // Hashed assets: cache first.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
