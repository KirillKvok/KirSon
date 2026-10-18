// Skin retouch, naturalness, teeth & eyes — port of kirson/core/ops/skin.py.
import { register, P } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { components, dilate, erode, median255 } from "../core/draw.js";
import { getMask, refFaceWidth } from "../face/masks.js";

export const FACE_TAB = "Лицо";
const SMOOTH_RADIUS = 0.02, SMOOTH_EPS = 0.001, MIN_TEXTURE = 0.35;
const WORK_FACE = 400, BLEMISH_FACE = 300;

const odd = (x, lo = 3, hi = 255) => Math.min(hi, Math.max(lo, Math.round(x) | 1));
const clip = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

// Small spots darker or redder than the skin around them (median at ~3.5% of face width).
export function blemishMask(low, skin, fw) {
  const { w, h } = low, n = w * h, r = odd(fw * 0.035) >> 1;
  const lab = I.rgbToLab(low);
  const L = I.fimg(w, h, 1), a4 = I.fimg(w, h, 1);
  for (let i = 0; i < n; i++) {
    L.data[i] = clip(Math.floor(lab.data[3 * i] * 2.55), 0, 255);
    a4.data[i] = clip(Math.floor(lab.data[3 * i + 1] * 4 + 64), 0, 255);
  }
  const coreR = Math.max(1, Math.round(fw * 0.03));
  const core = erode(I.mapPlane(skin, (v) => (v > 0.8 ? 1 : 0)), coreR);
  const Lmed = median255(L, r, core), amed = median255(a4, r, core); // spots are looked for only in the core
  const score = I.fimg(w, h, 1);
  for (let i = 0; i < n; i++) {
    const dark = (Lmed.data[i] - L.data[i]) / 255, red = (a4.data[i] - amed.data[i]) / 4;
    let s = Math.max(clip((dark - 0.012) / 0.02), clip((red - 1.5) / 2.5));
    s *= clip((0.9 * 255 - Lmed.data[i]) / (0.08 * 255)); // not in specular shine
    score.data[i] = s * core.data[i];
  }
  const { labels, stats } = components(score, 0.35);
  const maxSide = fw * 0.06, minArea = Math.max(2, (fw * 0.004) ** 2);
  const keep = stats.map((st) => st && st.area >= minArea && Math.max(st.x1 - st.x0 + 1, st.y1 - st.y0 + 1) <= maxSide
    && st.area >= 0.3 * (st.x1 - st.x0 + 1) * (st.y1 - st.y0 + 1));
  let m = I.fimg(w, h, 1);
  for (let i = 0; i < n; i++) m.data[i] = keep[labels[i]] ? 1 : 0;
  m = I.gaussian(dilate(m, Math.max(1, Math.round(fw * 0.006))), Math.max(0.5, fw * 0.004));
  for (let i = 0; i < n; i++) m.data[i] *= clip(skin.data[i] * 1.5);
  return m;
}

register("skin", "Кожа", [P("smooth", "Сглаживание", 0, 100, 0), P("texture", "Текстура", 0, 100, 100),
  P("blemish", "Прыщи и пятна", 0, 100, 0), P("body", "Кожа тела", 0, 100, 50)], (img, p, ctx) => {
  const fw = refFaceWidth(img, ctx);
  let mask = getMask(img, ctx, "face_skin");
  if (p.body > 0) {
    const body = getMask(img, ctx, "body_skin"), k = p.body / 100;
    mask = I.mapPlane(mask, (v, i) => Math.max(v, body.data[i] * k));
  }
  const b = I.bbox(mask, Math.round(fw * 0.1));
  if (!b) return img;
  const m = I.crop(mask, b), f = I.cropFloat(img, b), { w, h } = f;

  const low = I.gaussian(f, Math.max(0.6, fw * 0.004));
  const fine = I.fimg(w, h, 3);
  for (let i = 0; i < fine.data.length; i++) fine.data[i] = f.data[i] - low.data[i];

  if (p.blemish > 0) {
    const wb = Math.min(1, BLEMISH_FACE / fw);
    const bw = Math.max(1, Math.round(w * wb)), bh = Math.max(1, Math.round(h * wb));
    const lowB = I.resize(low, bw, bh);
    const spot = blemishMask(lowB, I.resize(m, bw, bh), fw * wb);
    // fill from the surrounding skin only (normalised blur ignoring the spots)
    const keep = I.mapPlane(spot, (v) => clip(1 - 2 * v));
    const lk = I.fimg(bw, bh, 3);
    for (let i = 0; i < bw * bh; i++) for (let c = 0; c < 3; c++) lk.data[3 * i + c] = lowB.data[3 * i + c] * keep.data[i];
    const sig = Math.max(1, fw * wb * 0.02);
    const num = I.gaussian(lk, sig), den = I.gaussian(keep, sig);
    for (let i = 0; i < bw * bh; i++) for (let c = 0; c < 3; c++) num.data[3 * i + c] /= Math.max(den.data[i], 1e-3);
    const fill = I.resizeLinear(num, w, h), bm = I.resizeLinear(spot, w, h), k = p.blemish / 100;
    for (let i = 0; i < w * h; i++) {
      const t = bm.data[i] * k;
      if (t <= 0) continue;
      for (let c = 0; c < 3; c++) {
        const j = 3 * i + c;
        low.data[j] += (fill.data[j] - low.data[j]) * t;
        fine.data[j] *= 1 - 0.5 * t; // the spot's own texture (bump highlight) mostly dropped
      }
    }
  }
  const clean = I.fimg(w, h, 3);
  for (let i = 0; i < clean.data.length; i++) clean.data[i] = low.data[i] + fine.data[i];

  if (p.smooth > 0) {
    const ws = Math.min(1, WORK_FACE / fw);
    const base = I.guidedFast(I.luminance(low), low, fw * SMOOTH_RADIUS, SMOOTH_EPS, ws);
    const tk = MIN_TEXTURE + ((1 - MIN_TEXTURE) * p.texture) / 100, sk = p.smooth / 100;
    for (let i = 0; i < w * h; i++) {
      const s = m.data[i] * sk;
      if (s <= 0) continue;
      for (let c = 0; c < 3; c++) {
        const j = 3 * i + c;
        clean.data[j] += (base.data[j] + fine.data[j] * tk - clean.data[j]) * s;
      }
    }
  }
  return I.withPart(img, I.clamp01(clean), b);
}, { category: FACE_TAB, active: (p) => p.smooth > 0 || p.blemish > 0 });

register("skin_natural", "Естественность", [P("texture", "Текстура кожи (поры)", 0, 100, 0),
  P("volume", "Естественные тени и объём", 0, 100, 0)], (img, p, ctx) => {
  const fw = refFaceWidth(img, ctx), mask = getMask(img, ctx, "face_skin");
  const b = I.bbox(mask, Math.round(fw * 0.1));
  if (!b) return img;
  const m = I.crop(mask, b), f = I.cropFloat(img, b), lum = I.luminance(f), next = I.clone(lum);
  const n = lum.w * lum.h;
  if (p.volume > 0) {
    const src = ctx.cache.get("_source");
    if (src && src.w === img.w && src.h === img.h) {
      const sl = I.luminance(I.cropFloat(src, b));
      const lo = Math.max(1.5, fw * 0.05), hi = Math.max(4, fw * 0.2);
      const band = (x) => { const a = I.gaussian(x, lo), c = I.gaussian(x, hi); return I.mapPlane(a, (v, i) => v - c.data[i]); };
      const sr = band(sl), cr = band(lum), t = p.volume / 100;
      const restore = Math.min(2 * t, 1), deepen = Math.max(2 * t - 1, 0) * 0.6;
      for (let i = 0; i < n; i++) next.data[i] += restore * (sr.data[i] - cr.data[i]) + deepen * sr.data[i];
    }
  }
  if (p.texture > 0) {
    const pore = Math.max(0.5, fw * 0.0016);
    const noise = I.fimg(lum.w, lum.h, 1, I.seededNormal(n, 1017));
    const a = I.gaussian(noise, pore), c = I.gaussian(noise, pore * 2.2);
    let sd = 0;
    for (let i = 0; i < n; i++) { a.data[i] -= c.data[i]; sd += a.data[i] * a.data[i]; }
    sd = Math.max(Math.sqrt(sd / n), 1e-6);
    const k = (p.texture / 100) * 0.011;
    for (let i = 0; i < n; i++) {
      let v = a.data[i] / sd;
      v = v < 0 ? v * 1.25 : v * 0.75; // pores read as tiny dark dots
      const l = lum.data[i];
      next.data[i] += v * clip(4 * l * (1 - l)) * k;
    }
  }
  const out = I.fimg(lum.w, lum.h, 1);
  for (let i = 0; i < n; i++) out.data[i] = clip(lum.data[i] + (next.data[i] - lum.data[i]) * clip(m.data[i] * 1.15));
  return I.withPart(img, I.scaleLuminance(f, out, lum), b);
}, { category: FACE_TAB, active: (p) => p.texture > 0 || p.volume > 0 });

// Edit in Lab inside the mask's box; only the change is added (the round trip is lossy).
export function labEdit(img, mask, fw, edit, ...extra) {
  const b = I.bbox(mask, Math.round(fw * 0.02) + 2);
  if (!b) return img;
  const m = I.crop(mask, b), f = I.cropFloat(img, b);
  const lab = I.rgbToLab(f), unedited = I.labToRgb(lab);
  edit(lab, m, ...extra.map((e) => I.crop(e, b)));
  const edited = I.labToRgb(lab);
  for (let i = 0; i < f.data.length; i++) f.data[i] += edited.data[i] - unedited.data[i];
  return I.withPart(img, I.clamp01(f), b);
}

register("teeth_eyes", "Зубы и глаза", [P("teeth", "Отбелить зубы", 0, 100, 0), P("sclera", "Белки глаз", 0, 100, 0),
  P("iris", "Яркость радужки", 0, 100, 0)], (img, p, ctx) => {
  const fw = refFaceWidth(img, ctx);
  let out = img;
  if (p.teeth > 0) {
    const k = p.teeth / 100;
    out = labEdit(out, getMask(out, ctx, "teeth"), fw, (lab, m) => {
      for (let i = 0; i < m.data.length; i++) {
        const w = m.data[i] * k, j = 3 * i;
        lab.data[j + 1] *= 1 - 0.25 * w;
        lab.data[j + 2] *= 1 - 0.45 * w;
        lab.data[j] += w * Math.max(0, 90 - lab.data[j]) * 0.15;
      }
    });
  }
  if (p.sclera > 0) {
    const k = p.sclera / 100;
    out = labEdit(out, getMask(out, ctx, "sclera"), fw, (lab, m) => {
      for (let i = 0; i < m.data.length; i++) {
        const w = m.data[i] * k, j = 3 * i;
        lab.data[j + 1] *= 1 - 0.7 * w;
        lab.data[j + 2] *= 1 - 0.5 * w;
        lab.data[j] += w * Math.max(0, 90 - lab.data[j]) * 0.25;
      }
    });
  }
  if (p.iris > 0) {
    const k = p.iris / 100, sigma = Math.max(0.7, fw * 0.006);
    out = labEdit(out, getMask(out, ctx, "iris"), fw, (lab, m) => {
      const L = I.fimg(m.w, m.h, 1);
      for (let i = 0; i < m.data.length; i++) L.data[i] = lab.data[3 * i];
      const bl = I.gaussian(L, sigma);
      for (let i = 0; i < m.data.length; i++) {
        const w = m.data[i] * k, j = 3 * i;
        lab.data[j] += w * ((L.data[i] - bl.data[i]) * 1.2 + 6);
        lab.data[j + 1] *= 1 + 0.35 * w;
        lab.data[j + 2] *= 1 + 0.35 * w;
      }
    });
  }
  return out;
}, { category: FACE_TAB });
