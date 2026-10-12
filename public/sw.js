// Batter Beats service worker: lets the app open and game mode run without a
// connection. Plain JavaScript, served as-is from /sw.js.
//
// - Clips and announcements kept for offline use (cache "bb-clips", filled by the app) are served from the phone.
// - The app itself (page, scripts, styles, fonts, icons) is stored as it loads.
//   The page is fetched fresh when there's a connection, so updates arrive on the
//   next open; after a few seconds with no answer the stored copy is used.
// - Everything else under /api/ always goes to the server.

const SHELL = "bb-shell-v2";
const CLIPS = "bb-clips";
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL).then((c) => c.add("/")).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("bb-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Tries the network (giving up after timeoutMs, if set), storing good answers; falls back to the stored copy. */
async function networkFirst(request, cacheKey, timeoutMs) {
  const cache = await caches.open(SHELL);
  const fromNetwork = fetch(request).then((res) => {
    if (res.ok) cache.put(cacheKey, res.clone());
    return res;
  });
  try {
    if (!timeoutMs) return await fromNetwork;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const res = await Promise.race([fromNetwork, timeout]);
    if (res) return res;
    const stored = await cache.match(cacheKey, { ignoreVary: true });
    return stored || (await fromNetwork);
  } catch (err) {
    const stored = await cache.match(cacheKey, { ignoreVary: true });
    if (stored) return stored;
    throw err;
  }
}

/** Uses the stored copy if there is one (for files whose names change when their content does). */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const stored = await cache.match(request, { ignoreVary: true });
  if (stored) return stored;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/media/")) {
    event.respondWith(caches.match(request, { cacheName: CLIPS, ignoreVary: true }).then((kept) => kept || fetch(request)));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  // Every screen is the same page; the app picks the screen from the address.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/", PAGE_TIMEOUT_MS));
    return;
  }
  // Built files have the content's fingerprint in their names, so a stored copy is always right.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request, request, 0));
});
