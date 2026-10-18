// Face parsing (BiSeNet resnet18, CelebAMask-HQ classes — kirson/core/face/analysis.py) with
// ONNX Runtime Web in its own thread: the analysis on the main thread sends a 512×512 face crop
// (normalised, NCHW) and gets the class of every pixel back.
//   {id, data: Float32Array(3*512*512)}  ->  {id, labels: Uint8Array(512*512)} | {id, error}
import * as ort from "../../vendor/ort/ort.wasm.min.mjs";

const S = 512;
ort.env.wasm.wasmPaths = new URL("../../vendor/ort/", import.meta.url).href;
// several cores when the page is cross-origin isolated (the service worker's headers)
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

let session = null;

async function load() {
  session ||= ort.InferenceSession.create(new URL("../../models/face_parsing.onnx", import.meta.url).href,
    { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  return session;
}

self.onmessage = async (e) => {
  const { id, data } = e.data;
  try {
    const s = await load();
    if (!data) return self.postMessage({ id, ready: true }); // warm-up
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", data, [1, 3, S, S]) });
    const t = out[s.outputNames[0]], n = S * S, k = t.dims[1], d = t.data;
    const labels = new Uint8Array(n), best = new Float32Array(n).fill(-Infinity);
    for (let c = 0; c < k; c++) {
      const o = c * n;
      for (let i = 0; i < n; i++) if (d[o + i] > best[i]) { best[i] = d[o + i]; labels[i] = c; }
    }
    self.postMessage({ id, labels }, [labels.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
