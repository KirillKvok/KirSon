// The neural networks and runtimes, downloaded once with a visible progress and kept for offline use.
// Files go straight into the service worker's asset cache (sw.js serves /models, /vendor from it,
// cache first), so MediaPipe / ONNX Runtime find them there. CORE is what every photo needs; the
// rest is fetched the first time its feature is used.
const CACHE = "kirson-assets-1"; // the same name as in sw.js
const base = new URL("../", import.meta.url);
const u = (p) => new URL(p, base).href;

export const CORE = [
  "vendor/mediapipe/wasm/vision_wasm_internal.js", "vendor/mediapipe/wasm/vision_wasm_internal.wasm",
  "models/face_landmarker.task", "models/selfie_multiclass_256x256.tflite", "models/pose_landmarker_full.task",
  "models/hair_segmenter.tflite", "vendor/ort/ort-wasm-simd-threaded.mjs", "vendor/ort/ort-wasm-simd-threaded.wasm",
  "models/face_parsing.onnx",
].map(u);
export const EXTRA = {
  object: { label: "выделения объектов", files: ["models/magic_touch.tflite"].map(u) },
  remove: { label: "удаления объектов", files: ["models/migan.onnx"].map(u) },
  enhance: { label: "улучшения качества", files: ["models/esrgan_x4v3.onnx"].map(u) },
  heic: { label: "фото HEIC", files: ["vendor/libheif/libheif-bundle.mjs"].map(u) },
};

async function cache() {
  return typeof caches !== "undefined" ? caches.open(CACHE) : null;
}

export async function missing(urls) {
  const c = await cache();
  if (!c) return [];
  const out = [];
  for (const url of urls) if (!(await c.match(url))) out.push(url);
  return out;
}

const TYPES = { wasm: "application/wasm", js: "text/javascript", mjs: "text/javascript" };

// download `urls` into the cache; onProgress(doneBytes, totalBytes)
export async function download(urls, onProgress = () => {}) {
  const c = await cache();
  if (!c || !urls.length) return;
  const sizes = await Promise.all(urls.map((url) => fetch(url, { method: "HEAD", cache: "no-store" })
    .then((r) => Number(r.headers.get("content-length")) || 0).catch(() => 0)));
  const total = sizes.reduce((a, b) => a + b, 0);
  let done = 0;
  for (const url of urls) {
    const res = await fetch(url, { cache: "reload" });
    if (!res.ok || !res.body) throw new Error(`download ${url}: ${res.status}`);
    const reader = res.body.getReader(), parts = [];
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      parts.push(value);
      done += value.length;
      onProgress(done, Math.max(total, done));
    }
    const ext = url.split(".").pop();
    const type = TYPES[ext] || res.headers.get("content-type") || "application/octet-stream";
    await c.put(url, new Response(new Blob(parts, { type }), { headers: { "Content-Type": type } }));
  }
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to clear it under storage pressure
}

const mb = (b) => (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0);
export const progressText = (done, total) => `${mb(done)} из ${mb(total)} МБ`;
