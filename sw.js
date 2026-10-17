// Offline: the app shell, libraries and models are cached on the first visit; later visits
// work without the internet. Bump VERSION when files change, so phones get the update.
const VERSION = "kirson-69f785a96af4";
const CORE = [
  "./",
  "js/version.js",
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

// Heavy files that rarely change (models, MediaPipe, fonts) live in their own cache and survive
// updates; the app shell is per version.
const ASSETS = "kirson-assets-1";
const isAsset = (url) => /\/(models|vendor|fonts)\//.test(new URL(url).pathname);

self.addEventListener("install", (e) => {
  // cache: "reload" — fresh from the server, never a stale copy from the browser's HTTP cache
  e.waitUntil(caches.open(VERSION)
    .then((c) => Promise.all(CORE.map((u) => fetch(u, { cache: "reload" }).then((r) => r.ok && c.put(u, r)))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== ASSETS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (isAsset(req.url)) { // cache first: ~60 MB downloaded once
    e.respondWith(caches.open(ASSETS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
    return;
  }
  // the app itself: network first (always the newest version online), cache when offline
  e.respondWith(fetch(req, { cache: "no-cache" }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});
