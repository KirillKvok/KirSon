// Basic corrections — port of kirson/core/ops/basic.py (tone, light, colour, sharpness).
import { register, P } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { getMask } from "../face/masks.js";

// Vibrance weight by hue (0..255 full circle). Skin is at 6..17 (median 12) from red:
// those hues get only 15% of the boost, so faces do not turn orange.
const SKIN_PROTECT = new Float32Array(256);
for (let h = 0; h < 256; h++) {
  const d = Math.min(h, 256 - h);
  SKIN_PROTECT[h] = Math.round(255 * (1 - 0.85 * Math.exp(-(((d - 12) / 12) ** 2)))) / 255;
}

export function contrastCurve(x, c) {
  if (c >= 0) return x + c * (x * x * (3 - 2 * x) - x);
  return x + -c * 0.5 * (0.5 - x);
}

// contrast curve applied to a float buffer (all channels) — for filters
export function contrastAll(f, c) {
  const d = f.data;
  for (let i = 0; i < d.length; i++) d[i] = contrastCurve(d[i], c);
  return f;
}

export function lumaContrast(f, c) {
  const lum = I.luminance(f);
  const nl = I.mapPlane(lum, (v) => contrastCurve(v, c));
  return I.scaleLuminance(f, nl, lum);
}

// temperature / tint in -1..1; gains normalised so overall brightness is kept
export function whiteBalance(f, temperature, tint) {
  let gr = 1 + 0.22 * temperature, gg = 1 - 0.18 * tint, gb = 1 - 0.22 * temperature;
  const norm = gr * 0.2126 + gg * 0.7152 + gb * 0.0722;
  gr /= norm; gg /= norm; gb /= norm;
  const d = f.data;
  for (let j = 0; j < d.length; j += 3) {
    d[j] = Math.min(1, Math.max(0, d[j] * gr));
    d[j + 1] = Math.min(1, Math.max(0, d[j + 1] * gg));
    d[j + 2] = Math.min(1, Math.max(0, d[j + 2] * gb));
  }
  return f;
}

function hueFull(r, g, b) {
  // HSV hue mapped to 0..255 (OpenCV HSV_FULL), on 8-bit values
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h;
  if (mx === r) h = (g - b) / d;
  else if (mx === g) h = 2 + (b - r) / d;
  else h = 4 + (r - g) / d;
  h *= 60;
  if (h < 0) h += 360;
  return Math.round((h * 256) / 360) & 255;
}

export function saturate(f, saturation = 0, vibrance = 0) {
  const lum = I.luminance(f), d = f.data, L = lum.data, out = I.fimg(f.w, f.h, 3), o = out.data;
  for (let i = 0, j = 0; i < L.length; i++, j += 3) {
    const r = d[j], g = d[j + 1], b = d[j + 2], l = L[i];
    let factor = 1 + saturation;
    if (vibrance) {
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (vibrance > 0) {
        const hue = hueFull(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
        const dull = 1 - Math.min(chroma * 2, 1);
        factor *= 1 + vibrance * dull * SKIN_PROTECT[hue];
      } else factor *= 1 + vibrance * Math.min(chroma / 0.3, 1);
    }
    o[j] = l + (r - l) * factor;
    o[j + 1] = l + (g - l) * factor;
    o[j + 2] = l + (b - l) * factor;
  }
  return I.fitGamut(out, lum);
}

// shadows / highlights tints as [r, g, b] offsets, luminance kept
export function splitTone(f, sh, hi) {
  const lum = I.luminance(f), d = f.data, out = I.fimg(f.w, f.h, 3), o = out.data;
  for (let i = 0, j = 0; i < lum.data.length; i++, j += 3) {
    const l = lum.data[i], ws = (1 - l) ** 2, wh = l * l;
    for (let k = 0; k < 3; k++) o[j + k] = Math.min(1, Math.max(0, d[j + k] + ws * sh[k] + wh * hi[k]));
  }
  return I.scaleLuminance(out, lum, I.luminance(out));
}

register("brightness", "Яркость", [P("amount", "Яркость", -100, 100, 0)], (img, p) => {
  // gamma: lifts midtones, black and white points stay
  const gamma = 2 ** (-p.amount / 100);
  return I.applyCurve(img, (x) => x ** gamma);
});

register("contrast", "Контраст", [P("amount", "Контраст", -100, 100, 0)], (img, p) =>
  I.applyCurve(img, (x) => contrastCurve(x, p.amount / 100)));

register("light", "Свет и тени", [P("shadows", "Тени", -100, 100, 0), P("highlights", "Светлые", -100, 100, 0)],
  (img, p) => {
    // local tone mapping weighted by the edge-aware local brightness (no halos)
    const base = I.smoothBase(I.lumU8(img), Math.max(img.w, img.h) * 0.02);
    const sh = p.shadows / 100, hi = p.highlights / 100;
    return I.stripMap(img, (f, y0) => {
      const lum = I.luminance(f), b = I.planeRows(base, y0, f.h);
      const ln = I.mapPlane(lum, (v, i) => {
        const bb = b.data[i], e = 1.5 * (sh * (1 - bb) ** 2 + hi * bb * bb);
        return Math.max(v, 1e-6) ** (2 ** -e);
      });
      return I.scaleLuminance(f, ln, lum);
    });
  });

register("color", "Цвет", [P("saturation", "Насыщенность", -100, 100, 0), P("vibrance", "Сочность", -100, 100, 0),
  P("temperature", "Температура", -100, 100, 0), P("tint", "Оттенок", -100, 100, 0)], (img, p) => {
  return I.stripMap(img, (f) => {
    if (p.temperature || p.tint) f = whiteBalance(f, p.temperature / 100, p.tint / 100);
    if (p.saturation || p.vibrance) f = saturate(f, p.saturation / 100, p.vibrance / 100);
    return f;
  });
});

register("sharpen", "Чёткость", [P("sharpness", "Резкость", 0, 100, 0), P("clarity", "Детализация", -100, 100, 0)],
  (img, p, ctx) => {
    const lum = I.lumU8(img), out = I.clone(lum), long = Math.max(img.w, img.h);
    if (p.sharpness) {
      const sigma = Math.max(0.7, long / 1600);
      const blur = I.gaussian(lum, sigma);
      // skin gets only a little sharpening: it would undo smoothing and bring back noise
      let skin = null;
      if (ctx.cache.has("analysis")) {
        const fs = getMask(img, ctx, "face_skin"), bs = getMask(img, ctx, "body_skin");
        skin = I.mapPlane(fs, (v, i) => Math.max(v, bs.data[i]));
      }
      for (let i = 0; i < out.data.length; i++) {
        const det = lum.data[i] - blur.data[i];
        let gate = Math.min(1, Math.max(0, (Math.abs(det) - 0.01) / 0.02));
        if (skin) gate *= 1 - 0.8 * skin.data[i];
        out.data[i] += (p.sharpness / 100) * 1.2 * det * gate;
      }
    }
    if (p.clarity) {
      const base = I.smoothBase(lum, long * 0.03);
      for (let i = 0; i < out.data.length; i++) {
        const b = base.data[i];
        out.data[i] += (p.clarity / 100) * 0.8 * (lum.data[i] - b) * 4 * b * (1 - b);
      }
    }
    I.clamp01(out);
    return I.stripMap(img, (f, y0) => I.scaleLuminance(f, I.planeRows(out, y0, f.h), I.planeRows(lum, y0, f.h)));
  });
