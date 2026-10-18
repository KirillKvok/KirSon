// Processing thread: the pipeline runs here, so the interface never freezes while a slider moves.
//   {type: "image", key, w, h, data, scale}   — store an image (RGBA bytes) under a key
//   {type: "render", id, key, state}           — run the pipeline, reply {type: "result", id, w, h, data}
//   {type: "drop", key}                        — forget an image (frees memory after export)
import "./ops/index.js";
import { Context, Pipeline } from "./core/pipeline.js";
import { PICTURES } from "./ops/background.js";
import { getMask } from "./face/masks.js";
import { suggest } from "./core/auto.js";
import { geometry, frameActive } from "./ops/crop.js";
import { OBJECT_MASKS, objectKey } from "./ops/object.js";

const images = new Map(); // key -> {img, ctx}
let analysis = null; // the photo's face / person analysis (normalised), shared by all sizes

function rgbaToRgb(rgba, w, h) {
  const out = new Uint8ClampedArray(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    out[j] = rgba[i * 4];
    out[j + 1] = rgba[i * 4 + 1];
    out[j + 2] = rgba[i * 4 + 2];
  }
  return out;
}

function rgbToRgba(rgb, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    out[i * 4] = rgb[j];
    out[i * 4 + 1] = rgb[j + 1];
    out[i * 4 + 2] = rgb[j + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === "image") {
      const img = { w: m.w, h: m.h, data: rgbaToRgb(new Uint8ClampedArray(m.data), m.w, m.h) };
      const ctx = new Context(m.scale, new Map(), { noCache: m.key === "full" });
      ctx.cache.set("_imageId", m.imageId);
      if (analysis && analysis.imageId === m.imageId) ctx.cache.set("analysis", analysis);
      images.set(m.key, { img, ctx });
    } else if (m.type === "analysis") {
      analysis = m.analysis;
      for (const { ctx } of images.values()) {
        if (ctx.cache.get("_imageId") !== analysis.imageId) continue;
        // masks and step outputs computed without the analysis are no longer valid
        for (const k of [...ctx.cache.keys()]) if (k !== "_imageId") ctx.cache.delete(k);
        ctx.cache.set("analysis", analysis);
      }
    } else if (m.type === "picture") { // the user's own background picture
      PICTURES.set(m.pid, { w: m.w, h: m.h, data: rgbaToRgb(new Uint8ClampedArray(m.data), m.w, m.h) });
    } else if (m.type === "mask") { // debugging: a mask as a grey image
      const { img, ctx } = images.get(m.key);
      const p = getMask(img, ctx, m.name), rgba = new Uint8ClampedArray(p.w * p.h * 4);
      for (let i = 0; i < p.w * p.h; i++) {
        rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = p.data[i] * 255;
        rgba[4 * i + 3] = 255;
      }
      self.postMessage({ type: "result", id: m.id, w: p.w, h: p.h, data: rgba.buffer, ms: 0 }, [rgba.buffer]);
    } else if (m.type === "auto") { // «Авто»: suggested values for this photo
      const { img, ctx } = images.get(m.key);
      self.postMessage({ type: "auto", id: m.id, values: suggest(img, ctx) });
    } else if (m.type === "objectMask") { // magic-touch mask of a tapped object
      OBJECT_MASKS.set(objectKey(m.x, m.y), { w: m.w, h: m.h, c: 1, data: new Float32Array(m.data) });
    } else if (m.type === "drop") {
      images.delete(m.key);
    } else if (m.type === "render") {
      const entry = images.get(m.key);
      if (!entry) throw new Error(`no image ${m.key}`);
      const t = performance.now();
      const out = Pipeline.fromJSON(m.state).run(entry.img, entry.ctx);
      const rgba = rgbToRgba(out.data, out.w, out.h);
      const msg = { type: "result", id: m.id, w: out.w, h: out.h, data: rgba.buffer, ms: performance.now() - t };
      const transfer = [rgba.buffer];
      const frame = m.state.steps.find((s) => s.op === "crop");
      const framed = frame && frame.enabled !== false && frameActive({ ...frame.values });
      // "always": the original at this size for the split view (sharp when zoomed in)
      if ((m.before && framed) || m.before === "always") {
        const b = framed ? geometry(entry.img, frame.values) : entry.img, brgba = rgbToRgba(b.data, b.w, b.h);
        Object.assign(msg, { bw: b.w, bh: b.h, before: brgba.buffer });
        transfer.push(brgba.buffer);
      }
      self.postMessage(msg, transfer);
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, message: String(err && err.stack || err) });
  }
};
