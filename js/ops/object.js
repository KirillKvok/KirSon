// One selected object: lighter / darker, contrast, saturation, blur / crisper, or removed — port of
// kirson/core/ops/object.py. The tap point is stored as hidden x, y; its mask comes from the main
// thread (MediaPipe magic touch) via OBJECT_MASKS. Removal: the main thread fills the hole with
// MI-GAN (a light model instead of the desktop's LaMa) and sends the patch (OBJECT_FILLS).
import { register, P, hidden } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { lumaContrast, saturate } from "./basic.js";

export const OBJECT_TAB = "Объект";
export const OBJECT_MASKS = new Map(); // "x,y" -> confidence plane (any size)
export const OBJECT_FILLS = new Map(); // "x,y" -> {box, w, h, rgb, hole} (face/analysis.js removeFill)

// the patch pasted into img: soft edge around the hole, the photo's own fine grain on the
// upscaled fill (otherwise it looks smooth on walls and skin)
function removed(img, fill) {
  const { w, h } = img, [bx0, by0, bx1, by1] = fill.box;
  const X0 = Math.round(bx0 * w), Y0 = Math.round(by0 * h), X1 = Math.round(bx1 * w), Y1 = Math.round(by1 * h);
  const cw = X1 - X0, ch = Y1 - Y0;
  if (cw < 2 || ch < 2) return img;
  const src = I.fimg(fill.w, fill.h, 3), hole = I.fimg(fill.w, fill.h, 1, fill.hole);
  for (let i = 0; i < src.data.length; i++) src.data[i] = fill.rgb[i] / 255;
  const f = I.resizeLinear(src, cw, ch), hl = I.resizeLinear(hole, cw, ch);
  const grow = Math.max(3, Math.max(w, h) * 0.006);
  const soft = I.gaussian(hl, Math.max(1, grow / 2));
  const b = { x0: X0, y0: Y0, x1: X1, y1: Y1 }, crop = I.cropFloat(img, b);
  if (cw > fill.w) {
    const lum = I.luminance(crop), blur = I.gaussian(lum, 1.2), dev = [];
    for (let i = 0; i < cw * ch; i++) if (hl.data[i] < 0.5 && soft.data[i] > 0.02) dev.push(Math.abs(lum.data[i] - blur.data[i]));
    dev.sort((a, c) => a - c);
    const sigma = dev.length ? 1.4826 * dev[dev.length >> 1] * 0.6 : 0;
    let seed = 7;
    const rnd = () => { // seeded gaussian noise: the same grain on every render
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const u = (seed + 1) / 2147483649;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return Math.sqrt(-2 * Math.log(u)) * Math.cos((2 * Math.PI * seed) / 2147483648);
    };
    if (sigma > 0) for (let i = 0; i < cw * ch; i++) {
      const nz = rnd() * sigma;
      for (let c = 0; c < 3; c++) f.data[3 * i + c] += nz;
    }
  }
  for (let i = 0; i < cw * ch; i++) {
    const a = Math.max(soft.data[i], hl.data[i] > 0.5 ? 1 : 0);
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) crop.data[3 * i + c] += (f.data[3 * i + c] - crop.data[3 * i + c]) * a;
  }
  return I.withPart(img, I.clamp01(crop), b);
}
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
    if (p.remove >= 0.5) { // erased: the other object sliders have nothing left to act on
      const fill = OBJECT_FILLS.get(objectKey(p.x, p.y));
      return fill ? removed(img, fill) : img;
    }
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
  }, { category: OBJECT_TAB, active: (p) => p.x >= 0 && ["remove", "brightness", "contrast", "saturation", "sharpness"].some((k) => p[k]) });
