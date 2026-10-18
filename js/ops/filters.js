// Colour filters and film grain — port of kirson/core/ops/filters.py.
import { register, P, choice, blend } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { contrastAll, contrastCurve, lumaContrast, saturate, splitTone, whiteBalance } from "./basic.js";

const fade = (f, black, white) => {
  for (let i = 0; i < f.data.length; i++) f.data[i] = black + (white - black) * f.data[i];
  return f;
};
// A look from a recipe (the way photo editors describe a style): white balance, a gentle exposure
// curve, contrast, per-channel black / white points (fade, tinted blacks), split toning, saturation /
// vibrance, black-and-white mix with an optional tone, vignette. RGB order. Looks run in strips:
// (f, y0, W, H) — the vignette needs the strip's place in the photo.
function recipe(r) {
  return (f, y0 = 0, W = f.w, H = f.h) => {
    if (r.temp || r.tint) f = whiteBalance(f, r.temp || 0, r.tint || 0);
    if (r.expo) { // midtones up / down, black and white stay
      const g = 2 ** -r.expo, d = f.data;
      for (let i = 0; i < d.length; i++) d[i] = Math.max(d[i], 0) ** g;
    }
    if (r.contrast) f = lumaContrast(f, r.contrast);
    if (r.bw) { // channel mix (RGB weights), then the paper tone
      const [wr, wg, wb] = r.bw, d = f.data, t = r.tone || [0, 0, 0];
      for (let j = 0; j < d.length; j += 3) {
        const l = wr * d[j] + wg * d[j + 1] + wb * d[j + 2];
        d[j] = l + t[0] * l * (1 - l) * 4; d[j + 1] = l + t[1] * l * (1 - l) * 4; d[j + 2] = l + t[2] * l * (1 - l) * 4;
      }
    }
    if (r.split) f = splitTone(f, r.split[0], r.split[1]);
    if (r.sat || r.vib) f = saturate(f, r.sat || 0, r.vib || 0);
    if (r.black || r.white) { // fade: lifted (possibly tinted) blacks, softened whites
      const b = r.black || [0, 0, 0], w = r.white || [1, 1, 1], d = f.data;
      for (let j = 0; j < d.length; j += 3) for (let c = 0; c < 3; c++) d[j + c] = b[c] + (w[c] - b[c]) * d[j + c];
    }
    if (r.vignette) {
      const d = f.data, cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy);
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) {
          const q = Math.hypot(x - cx, y0 + y - cy) / R, k = 1 - r.vignette * Math.max(0, q - 0.45) ** 2 * 3.3;
          const j = 3 * (y * f.w + x);
          d[j] *= k; d[j + 1] *= k; d[j + 2] *= k;
        }
    }
    return f;
  };
}
const gray = (v) => [v, v, v];

// desktop tuples are (b, g, r): reordered to [r, g, b] here
const LOOKS = {
  "Нет": null,
  "Тёплый": (f) => saturate(whiteBalance(f, 0.35, -0.05), 0.08),
  "Холодный": (f) => saturate(whiteBalance(f, -0.35, 0.03), 0, 0.1),
  "Плёнка": (f) => fade(saturate(splitTone(contrastAll(f, 0.25), [0.03, 0, -0.02], [0.02, 0, -0.03]), -0.15), 0.05, 0.96),
  "Ч/Б": (f) => {
    const d = f.data;
    for (let j = 0; j < d.length; j += 3) {
      const l = contrastCurve(0.35 * d[j] + 0.55 * d[j + 1] + 0.1 * d[j + 2], 0.3);
      d[j] = d[j + 1] = d[j + 2] = l;
    }
    return f;
  },
  "Винтаж": (f) => fade(contrastAll(splitTone(saturate(f, -0.4), [0.05, 0, -0.04], [0.04, 0.01, -0.06]), 0.15), 0.08, 0.93),
  "Яркий": (f) => saturate(lumaContrast(f, 0.25), 0, 0.5),
  "Нежный": (f) => saturate(whiteBalance(contrastAll(f, -0.25), 0.08, 0.1), -0.08),
  "Кино": (f) => saturate(splitTone(lumaContrast(f, 0.25), [-0.08, 0.05, 0.12], [0.07, -0.01, -0.09]), -0.1),
  // --- added 2026-10-18 (after the 9 above: presets store the style's number) -------------------
  // film stocks
  "Портра": recipe({ temp: 0.12, contrast: -0.06, sat: -0.08, split: [[0.01, 0.01, -0.02], [0.03, 0.01, -0.03]],
    black: [0.04, 0.035, 0.03], white: [0.98, 0.97, 0.94] }),
  "Фуджи": recipe({ temp: -0.05, tint: -0.07, sat: -0.1, split: [[-0.02, 0.02, 0.02], [0.01, 0.02, -0.01]],
    black: [0.04, 0.05, 0.05], white: [0.97, 0.98, 0.97] }),
  "Кодак Голд": recipe({ temp: 0.25, contrast: 0.1, sat: 0.08, split: [[0.02, 0.01, -0.02], [0.04, 0.02, -0.04]],
    black: gray(0.03) }),
  "Синестилл": recipe({ temp: -0.25, contrast: 0.15, sat: -0.05, split: [[-0.04, 0, 0.06], [0.06, 0.01, -0.03]],
    black: [0.02, 0.03, 0.05] }),
  "Экта": recipe({ contrast: 0.2, vib: 0.35, temp: 0.05, split: [[-0.01, 0, 0.02], [0.02, 0.01, -0.02]] }),
  // colour grades
  "Тил и оранж": recipe({ contrast: 0.15, sat: 0.05, split: [[-0.07, 0.02, 0.08], [0.08, 0.02, -0.07]] }),
  "Золотой час": recipe({ temp: 0.4, tint: 0.05, sat: 0.08, expo: 0.08, split: [[0.02, 0, -0.02], [0.05, 0.02, -0.05]] }),
  "Муди": recipe({ contrast: 0.2, sat: -0.25, temp: -0.05, split: [[-0.02, 0, 0.03], [0.01, 0, -0.01]],
    black: gray(0.06), vignette: 0.35 }),
  "Чистая кожа": recipe({ expo: 0.15, contrast: -0.1, sat: -0.05, temp: 0.05, black: gray(0.02) }),
  "Пастель": recipe({ contrast: -0.2, sat: -0.2, tint: 0.05, expo: 0.1, black: [0.08, 0.07, 0.09], white: [0.99, 0.98, 0.98] }),
  "Матовый": recipe({ contrast: 0.1, black: gray(0.1), white: gray(0.95), sat: -0.05 }),
  "Розовый": recipe({ tint: 0.14, temp: 0.05, split: [[0.02, 0, 0.02], [0.03, 0, 0.02]], sat: -0.05 }),
  "Мята": recipe({ tint: -0.12, temp: -0.1, split: [[-0.01, 0.02, 0.02], [-0.01, 0.03, 0.02]], black: [0.03, 0.05, 0.05] }),
  "Лаванда": recipe({ split: [[0.03, 0, 0.06], [0.02, 0, 0.03]], sat: -0.12, black: [0.05, 0.04, 0.07] }),
  "Осень": recipe({ temp: 0.25, vib: 0.2, contrast: 0.08, split: [[0.02, 0.01, -0.02], [0.05, 0.01, -0.05]] }),
  "Зима": recipe({ temp: -0.3, sat: -0.15, expo: 0.1, contrast: -0.05, black: [0.03, 0.04, 0.06] }),
  "Ретро 70-х": recipe({ temp: 0.3, sat: -0.12, split: [[0.04, 0.02, -0.02], [0.05, 0.03, -0.06]], black: [0.09, 0.07, 0.05],
    white: [0.97, 0.94, 0.88] }),
  "Блёклый": recipe({ sat: -0.45, contrast: 0.35, black: gray(0.02) }),
  "Глянец": recipe({ contrast: 0.22, vib: 0.3, expo: 0.04 }),
  // Instagram-style
  "Кларендон": recipe({ contrast: 0.2, sat: 0.12, split: [[-0.03, 0.01, 0.04], [0.03, 0.02, -0.02]] }),
  "Джуно": recipe({ temp: 0.1, vib: 0.3, contrast: 0.1, split: [[0, 0, 0], [0.03, 0.02, -0.02]] }),
  "Валенсия": recipe({ temp: 0.2, sat: -0.05, split: [[0.02, 0.01, 0], [0.04, 0.02, -0.03]], black: [0.06, 0.05, 0.04] }),
  "Ларк": recipe({ expo: 0.15, temp: -0.08, sat: -0.1, vib: 0.15, contrast: -0.05 }),
  // black and white
  "Нуар": recipe({ bw: [0.3, 0.6, 0.1], contrast: 0.55, vignette: 0.45 }),
  "Ч/Б мягкий": recipe({ bw: [0.33, 0.55, 0.12], contrast: -0.05, black: gray(0.07), white: gray(0.96) }),
  "Сепия": recipe({ bw: [0.33, 0.55, 0.12], tone: [0.06, 0.02, -0.06], contrast: 0.1, black: [0.06, 0.04, 0.03] }),
};
export const FILTER_NAMES = Object.keys(LOOKS);

register("filter", "Фильтр", [choice("style", "Стиль", FILTER_NAMES, 0), P("amount", "Сила", 0, 100, 100)],
  (img, p) => {
    const look = LOOKS[FILTER_NAMES[p.style]];
    if (!look || p.amount <= 0) return img;
    return blend(img, I.stripMap(img, (f, y0) => I.clamp01(look(f, y0, img.w, img.h))), p.amount / 100);
  });

// a small picture of every filter for its button (the photo itself, as in Persona)
export function filterThumb(img, name) {
  const look = LOOKS[name];
  if (!look) return img;
  return I.toU8(I.clamp01(look(I.toFloat(img), 0, img.w, img.h)));
}

const noiseCache = new Map();

register("grain", "Зерно", [P("amount", "Сила зерна", 0, 100, 0), P("size", "Размер зерна", 0, 100, 20)],
  (img, p) => {
    // monochrome, seeded (does not "boil"), strongest in the midtones; size relative to the frame
    const { w, h } = img;
    const cell = Math.max(1, (Math.max(w, h) / 1600) * (1 + (1.5 * p.size) / 100));
    const gw = Math.max(1, Math.ceil(w / cell)), gh = Math.max(1, Math.ceil(h / cell));
    const key = `${gw}x${gh}>${w}x${h}`;
    let noise = noiseCache.get(key); // the same grain every time: cache it per frame size
    if (!noise) {
      noise = I.fimg(gw, gh, 1, I.seededNormal(gw * gh));
      if (gw !== w || gh !== h) noise = I.resizeLinear(noise, w, h);
      noiseCache.clear();
      noiseCache.set(key, noise);
    }
    const k = (p.amount / 100) * 0.07;
    return I.stripMap(img, (f, y0) => {
      const d = f.data, o = y0 * w;
      for (let i = 0, j = 0; i < f.w * f.h; i++, j += 3) {
        const l = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
        const n = noise.data[o + i] * (0.35 + 2.6 * l * (1 - l)) * k;
        d[j] += n; d[j + 1] += n; d[j + 2] += n;
      }
      return I.clamp01(f);
    });
  }, { active: (p) => p.amount > 0 });
