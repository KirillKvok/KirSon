// Offline: the app shell, libraries and models are cached on the first visit; later visits
// work without the internet. Bump VERSION when files change, so phones get the update.
const VERSION = "kirson-web-1";
const CORE = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/engine.js", "js/worker.js", "js/core/img.js", "js/core/pipeline.js",
  "js/ops/index.js", "js/ops/basic.js", "js/ops/filters.js",
  "fonts/Manrope-Variable.ttf", "fonts/CormorantGaramond-Variable.ttf",
  "icons/monogram.svg", "icons/monogram-dark.svg", "icons/icon-192.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// cache first; anything fetched later (models, MediaPipe wasm) is cached as it arrives
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
    }
    return res;
  })));
});
