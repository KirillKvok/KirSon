// ONNX models with ONNX Runtime Web in their own thread (several cores when the page is
// cross-origin isolated):
//   face parsing — BiSeNet resnet18, CelebAMask-HQ classes (kirson/core/face/analysis.py):
//     {id, model: "parse", data: Float32Array(3*512*512) normalised NCHW} -> {id, labels: Uint8Array(512*512)}
//   object removal — MI-GAN (Picsart AI Research, MIT; 28 MB, made for phones):
//     {id, model: "migan", image: Uint8Array(3*h*w) RGB planar, mask: Uint8Array(h*w) 255 = keep, 0 = fill, w, h}
//     -> {id, image: Uint8Array(3*h*w) planar}
//   quality — Real-ESRGAN general x4v3 (BSD-3, 5 MB): {id, model: "esrgan", data: Float32Array(3*h*w), w, h}
//     -> {id, image: Uint8Array(3*4h*4w) planar}
//   {id, model} without data: load the model only (warm-up). Errors -> {id, error}.
import * as ort from "../../vendor/ort/ort.wasm.min.mjs";

ort.env.wasm.wasmPaths = new URL("../../vendor/ort/", import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

const FILES = { parse: "face_parsing.onnx", migan: "migan.onnx", esrgan: "esrgan_x4v3.onnx" };
const sessions = {};
function load(model) {
  sessions[model] ||= ort.InferenceSession.create(new URL(`../../models/${FILES[model]}`, import.meta.url).href,
    { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  return sessions[model];
}

async function parse(s, data) {
  const S = 512, n = S * S;
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", data, [1, 3, S, S]) });
  const t = out[s.outputNames[0]], k = t.dims[1], d = t.data;
  const labels = new Uint8Array(n), best = new Float32Array(n).fill(-Infinity);
  for (let c = 0; c < k; c++) {
    const o = c * n;
    for (let i = 0; i < n; i++) if (d[o + i] > best[i]) { best[i] = d[o + i]; labels[i] = c; }
  }
  return { labels };
}

async function migan(s, image, mask, w, h) {
  const out = await s.run({
    image: new ort.Tensor("uint8", image, [1, 3, h, w]),
    mask: new ort.Tensor("uint8", mask, [1, 1, h, w]),
  });
  return { image: new Uint8Array(out[s.outputNames[0]].data) };
}

// Real-ESRGAN general x4v3 (BSD-3): a tile [1,3,h,w] float 0..1 -> RGB planar bytes, 4x the size
async function esrgan(s, data, w, h) {
  const out = await s.run({ input: new ort.Tensor("float32", data, [1, 3, h, w]) });
  const d = out[s.outputNames[0]].data, img = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) img[i] = Math.max(0, Math.min(255, d[i] * 255 + 0.5));
  return { image: img };
}

self.onmessage = async (e) => {
  const m = e.data, model = m.model || "parse";
  try {
    const s = await load(model);
    if (!m.data && !m.image) return self.postMessage({ id: m.id, ready: true });
    const r = model === "parse" ? await parse(s, m.data)
      : model === "esrgan" ? await esrgan(s, m.data, m.w, m.h) : await migan(s, m.image, m.mask, m.w, m.h);
    self.postMessage({ id: m.id, ...r }, [(r.labels || r.image).buffer]);
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err?.message || err) });
  }
};
