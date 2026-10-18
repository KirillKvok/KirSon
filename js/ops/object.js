// One selected object: lighter / darker, contrast, saturation, blur / crisper — port of
// kirson/core/ops/object.py (without removal: LaMa is too heavy for a phone). The tap point is
// stored as hidden x, y; its mask comes from the main thread (MediaPipe magic touch) via OBJECT_MASKS.
import { register, P, hidden } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { lumaContrast, saturate } from "./basic.js";

export const OBJECT_TAB = "Объект";
export const OBJECT_MASKS = new Map(); // "x,y" -> confidence plane (any size)
export const objectKey = (x, y) => `${(+x).toFixed(4)},${(+y).toFixed(4)}`;

function objectMaskFor(img, ctx, x, y) {
  const key = `object:${objectKey(x, y)}:${img.w}x${img.h}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  const conf = OBJECT_MASKS.get(objectKey(x, y));
  if (!conf) return null;
  const up = I.resizeLinear(conf, img.w, img.h);
  const radius = Math.max(2, Math.round(Math.max(img.w, img.h) * 0.003));
  const m = I.clamp01(I.guidedFast(I.luminance(I.toFloat(img)), up, radius, 1e-4, Math.max(img.w, img.h) > 2000 ? 0.5 : 1));
  ctx.cache.set(key, m);
  return m;
}

register("object", "Выбранный объект", [hidden("x", -1), hidden("y", -1), hidden("remove", 0),
  P("brightness", "Светлее / темнее", -100, 100, 0), P("contrast", "Контраст", -100, 100, 0),
  P("saturation", "Насыщенность", -100, 100, 0), P("sharpness", "Размыть / чётче", -100, 100, 0)],
  (img, p, ctx) => {
    const m = objectMaskFor(img, ctx, p.x, p.y);
    if (!m) return img;
    const f = I.toFloat(img), n = img.w * img.h, long = Math.max(img.w, img.h);
    let e = f;
    if (p.sharpness < 0) { // blur with the object's own pixels only
      const sigma = (-p.sharpness / 100) * 0.008 * long, fm = I.fimg(img.w, img.h, 3);
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) fm.data[3 * i + c] = f.data[3 * i + c] * m.data[i];
      const num = I.gaussian(fm, sigma), den = I.gaussian(m, sigma);
      e = I.fimg(img.w, img.h, 3);
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++)
        e.data[3 * i + c] = den.data[i] > 1e-3 ? num.data[3 * i + c] / Math.max(den.data[i], 1e-3) : f.data[3 * i + c];
    } else if (p.sharpness > 0) {
      const lum = I.luminance(e), blur = I.gaussian(lum, Math.max(0.8, long / 1400));
      const nl = I.mapPlane(lum, (v, i) => Math.min(1, Math.max(0, v + (p.sharpness / 100) * 1.6 * (v - blur.data[i]))));
      e = I.scaleLuminance(e, nl, lum);
    }
    if (p.brightness) {
      const lum = I.luminance(e);
      const nl = p.brightness > 0
        ? I.mapPlane(lum, (v) => Math.max(v, 1e-6) ** (2 ** (-p.brightness / 100))) // whites do not clip
        : I.mapPlane(lum, (v) => v * 2 ** ((p.brightness / 100) * 1.3)); // exposure: white objects darken too
      e = I.scaleLuminance(e, nl, lum);
    }
    if (p.contrast) e = lumaContrast(e, p.contrast / 100);
    if (p.saturation) e = saturate(e, p.saturation / 100);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
      const j = 3 * i + c;
      f.data[j] += (e.data[j] - f.data[j]) * m.data[i];
    }
    return I.toU8(f);
  }, { category: OBJECT_TAB, active: (p) => p.x >= 0 && ["brightness", "contrast", "saturation", "sharpness"].some((k) => p[k]) });
