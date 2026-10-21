// ONNX models with ONNX Runtime Web in their own thread (several cores when the page is
// cross-origin isolated; the graphics card — WebGPU — when the worker is started with ?gpu=1):
//   face parsing — BiSeNet resnet18, CelebAMask-HQ classes (kirson/core/face/analysis.py):
//     {id, model: "parse", data: Float32Array(3*512*512) normalised NCHW} -> {id, labels: Uint8Array(512*512)}
//   object removal — MI-GAN (Picsart AI Research, MIT; 28 MB, made for phones):
//     {id, model: "migan", image: Uint8Array(3*h*w) RGB planar, mask: Uint8Array(h*w) 255 = keep, 0 = fill, w, h}
//     -> {id, image: Uint8Array(3*h*w) planar}
//   quality — Real-ESRGAN general x4v3 (BSD-3, 5 MB): {id, model: "esrgan", data: Float32Array(3*h*w), w, h}
//     -> {id, image: Uint8Array(3*4h*4w) planar}
//   {id, model} without data: load the model only (warm-up); {id, model: "info"}: where each model runs.
//   Errors -> {id, error}.
// On the graphics card a model that fails (an operator WebGPU cannot run, a lost device) is made again
// on the processor and the request repeated: the result is the same, only slower.
const Q = new URL(import.meta.url).searchParams;
const GPU = Q.get("gpu") === "1" && !!self.navigator.gpu;
const THREADS = Math.max(1, Math.min(4, Number(Q.get("threads")) || 1)); // js/device.js ONNX_THREADS
const ready = (async () => {
  const ort = await import(GPU ? "../../vendor/ort/ort.webgpu.min.mjs" : "../../vendor/ort/ort.wasm.min.mjs");
  ort.env.logLevel = "error"; // not the notes on which nodes run where
  ort.env.wasm.wasmPaths = new URL("../../vendor/ort/", import.meta.url).href;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? THREADS : 1;
  return ort;
})();

const FILES = { parse: "face_parsing.onnx", migan: "migan.onnx", esrgan: "esrgan_x4v3.onnx" };
const sessions = {}; // model -> Promise<{s, gpu}>
async function make(model, gpu) {
  const ort = await ready;
  const s = await ort.InferenceSession.create(new URL(`../../models/${FILES[model]}`, import.meta.url).href,
    { executionProviders: gpu ? ["webgpu", "wasm"] : ["wasm"], graphOptimizationLevel: "all" });
  return { s, gpu };
}
function load(model) {
  sessions[model] ||= make(model, GPU).catch((err) => {
    console.warn(`onnx ${model}: graphics card session failed, processor instead`, err);
    return make(model, false);
  });
  return sessions[model];
}
// feeds: {inputName | "_" (the first input): [type, data, dims]}
async function run(model, feeds) {
  const ort = await ready, { s, gpu } = await load(model);
  const tensors = {};
  for (const [k, [type, data, dims]] of Object.entries(feeds)) tensors[k === "_" ? s.inputNames[0] : k] = new ort.Tensor(type, data, dims);
  try {
    const t = (await s.run(tensors))[s.outputNames[0]];
    return { dims: t.dims, data: t.getData ? await t.getData() : t.data };
  } catch (err) {
    if (!gpu) throw err;
    console.warn(`onnx ${model}: failed on the graphics card, processor instead`, err);
    sessions[model] = make(model, false); // this model on the processor from now on
    return run(model, feeds);
  }
}

async function parse(data) {
  const S = 512, n = S * S;
  const { dims, data: d } = await run("parse", { _: ["float32", data, [1, 3, S, S]] }), k = dims[1];
  const labels = new Uint8Array(n), best = new Float32Array(n).fill(-Infinity);
  for (let c = 0; c < k; c++) {
    const o = c * n;
    for (let i = 0; i < n; i++) if (d[o + i] > best[i]) { best[i] = d[o + i]; labels[i] = c; }
  }
  return { labels };
}

async function migan(image, mask, w, h) {
  const { data } = await run("migan", { image: ["uint8", image, [1, 3, h, w]], mask: ["uint8", mask, [1, 1, h, w]] });
  return { image: new Uint8Array(data) };
}

// Real-ESRGAN general x4v3 (BSD-3): a tile [1,3,h,w] float 0..1 -> RGB planar bytes, 4x the size
async function esrgan(data, w, h) {
  const { data: d } = await run("esrgan", { input: ["float32", data, [1, 3, h, w]] }), img = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) img[i] = Math.max(0, Math.min(255, d[i] * 255 + 0.5));
  return { image: img };
}

self.onmessage = async (e) => {
  const m = e.data, model = m.model || "parse";
  try {
    if (model === "info") {
      const where = {};
      for (const [k, p] of Object.entries(sessions)) where[k] = (await p).gpu ? "gpu" : "cpu";
      return self.postMessage({ id: m.id, gpu: GPU, where });
    }
    if (!m.data && !m.image) {
      await load(model);
      return self.postMessage({ id: m.id, ready: true });
    }
    const r = model === "parse" ? await parse(m.data)
      : model === "esrgan" ? await esrgan(m.data, m.w, m.h) : await migan(m.image, m.mask, m.w, m.h);
    self.postMessage({ id: m.id, ...r }, [(r.labels || r.image).buffer]);
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err?.message || err) });
  }
};
