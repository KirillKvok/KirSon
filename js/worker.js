// Processing thread: the pipeline runs here, so the interface never freezes while a slider moves.
//   {type: "image", key, w, h, data, scale}   — store an image (RGBA bytes) under a key
//   {type: "render", id, key, state}           — run the pipeline, reply {type: "result", id, w, h, data}
//   {type: "drop", key}                        — forget an image (frees memory after export)
import "./ops/index.js";
import { Context, Pipeline } from "./core/pipeline.js";

const images = new Map(); // key -> {img, ctx}

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
      const ctx = new Context(m.scale);
      ctx.cache.set("_imageId", m.imageId);
      images.set(m.key, { img, ctx });
    } else if (m.type === "drop") {
      images.delete(m.key);
    } else if (m.type === "render") {
      const entry = images.get(m.key);
      if (!entry) throw new Error(`no image ${m.key}`);
      const t = performance.now();
      const out = Pipeline.fromJSON(m.state).run(entry.img, entry.ctx);
      const rgba = rgbToRgba(out.data, out.w, out.h);
      self.postMessage({ type: "result", id: m.id, w: out.w, h: out.h, data: rgba.buffer, ms: performance.now() - t },
        [rgba.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, message: String(err && err.stack || err) });
  }
};
