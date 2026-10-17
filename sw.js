// Offline: the app shell, libraries and models are cached on the first visit; later visits
// work without the internet. Bump VERSION when files change, so phones get the update.
const VERSION = "kirson-17ba8a86fb62";
const CORE = [
  "./",
  "css/app.css",
  "fonts/CormorantGaramond-Variable.ttf",
  "fonts/Manrope-Variable.ttf",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/monogram-dark.svg",
  "icons/monogram.svg",
  "index.html",
  "js/app.js",
  "js/core/auto.js",
  "js/core/draw.js",
  "js/core/img.js",
  "js/core/pipeline.js",
  "js/core/presets.js",
  "js/core/warp.js",
  "js/dev.js",
  "js/engine.js",
  "js/face/analysis.js",
  "js/face/masks.js",
  "js/face/topology.js",
  "js/ops/background.js",
  "js/ops/basic.js",
  "js/ops/body.js",
  "js/ops/crop.js",
  "js/ops/detail.js",
  "js/ops/filters.js",
  "js/ops/hair.js",
  "js/ops/index.js",
  "js/ops/makeup.js",
  "js/ops/shape.js",
  "js/ops/skin.js",
  "js/ops/tone.js",
  "js/worker.js",
  "manifest.webmanifest",
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
