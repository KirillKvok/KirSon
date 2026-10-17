// Frame: rotate 90°, straighten (largest inscribed rectangle, no empty corners), mirror, crop —
// port of kirson/core/ops/crop.py. The last pipeline step: everything else works on the full photo.
import { register, P, hidden } from "../core/pipeline.js";

export const FRAME_TAB = "Кадр";
export const ASPECTS = { "Свободно": null, "Как у фото": 0, "1:1": 1, "4:5": 4 / 5, "9:16": 9 / 16, "3:4": 3 / 4, "16:9": 16 / 9 };
export const MIN_SIZE = 0.05;

export function inscribedScale(w, h, deg) {
  const a = (Math.abs(deg) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return Math.min(w / (w * c + h * s), h / (w * s + h * c));
}

function rot90(img, k) {
  const { w, h, data } = img, nw = k % 2 ? h : w, nh = k % 2 ? w : h, out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (k === 1) { nx = h - 1 - y; ny = x; } // clockwise
      else if (k === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      const s = (y * w + x) * 3, d = (ny * nw + nx) * 3;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2];
    }
  return { w: nw, h: nh, data: out };
}

function straighten(img, deg) {
  const { w, h, data } = img, k = inscribedScale(w, h, deg);
  const ow = Math.max(1, Math.floor(w * k)), oh = Math.max(1, Math.floor(h * k));
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), out = new Uint8ClampedArray(ow * oh * 3);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      // output (centred) rotated back into the source; positive deg = counter-clockwise (as OpenCV)
      const dx = x - ow / 2 + 0.5, dy = y - oh / 2 + 0.5;
      let fx = c * dx - s * dy + w / 2 - 0.5, fy = s * dx + c * dy + h / 2 - 0.5;
      fx = Math.min(w - 1, Math.max(0, fx));
      fy = Math.min(h - 1, Math.max(0, fy));
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const ix1 = Math.min(w - 1, ix + 1), iy1 = Math.min(h - 1, iy + 1);
      for (let ch = 0; ch < 3; ch++) {
        const p00 = data[(iy * w + ix) * 3 + ch], p01 = data[(iy * w + ix1) * 3 + ch];
        const p10 = data[(iy1 * w + ix) * 3 + ch], p11 = data[(iy1 * w + ix1) * 3 + ch];
        out[(y * ow + x) * 3 + ch] = (p00 * (1 - tx) + p01 * tx) * (1 - ty) + (p10 * (1 - tx) + p11 * tx) * ty + 0.5;
      }
    }
  return { w: ow, h: oh, data: out };
}

function flip(img) {
  const { w, h, data } = img, out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3, d = (y * w + (w - 1 - x)) * 3;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2];
    }
  return { w, h, data: out };
}

export function rectOf(p) {
  const c = (v, d) => Math.min(1, Math.max(0, v ?? d));
  const x0 = c(p.x0, 0), y0 = c(p.y0, 0), x1 = c(p.x1, 1), y1 = c(p.y1, 1);
  if (x1 - x0 < MIN_SIZE / 2 || y1 - y0 < MIN_SIZE / 2) return [0, 0, 1, 1];
  return [x0, y0, x1, y1];
}

export function geometry(img, p, crop = true) {
  let out = img;
  const k = ((p.rot90 || 0) % 4 + 4) % 4;
  if (k) out = rot90(out, k);
  if (p.angle) out = straighten(out, p.angle);
  if (p.flip >= 0.5) out = flip(out);
  if (crop) {
    const [x0, y0, x1, y1] = rectOf(p);
    if (x0 !== 0 || y0 !== 0 || x1 !== 1 || y1 !== 1) {
      const c0 = Math.round(x0 * out.w), c1 = Math.max(Math.round(x1 * out.w), c0 + 1);
      const r0 = Math.round(y0 * out.h), r1 = Math.max(Math.round(y1 * out.h), r0 + 1);
      const w = c1 - c0, h = r1 - r0, data = new Uint8ClampedArray(w * h * 3);
      for (let y = 0; y < h; y++) data.set(out.data.subarray(((r0 + y) * out.w + c0) * 3, ((r0 + y) * out.w + c1) * 3), y * w * 3);
      out = { w, h, data };
    }
  }
  return out;
}

export function frameActive(p) {
  const [x0, y0, x1, y1] = rectOf(p);
  return !!(((p.rot90 || 0) % 4) || p.angle || p.flip >= 0.5 || x0 !== 0 || y0 !== 0 || x1 !== 1 || y1 !== 1);
}

register("crop", "Кадр", [P("angle", "Наклон, °", -45, 45, 0), hidden("rot90", 0), hidden("flip", 0),
  hidden("x0", 0), hidden("y0", 0), hidden("x1", 1), hidden("y1", 1)],
  (img, p) => geometry(img, p), { category: FRAME_TAB, active: frameActive });
