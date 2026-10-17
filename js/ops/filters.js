// Colour filters and film grain — port of kirson/core/ops/filters.py.
import { register, P, choice, blend } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { contrastAll, contrastCurve, lumaContrast, saturate, splitTone, whiteBalance } from "./basic.js";

const fade = (f, black, white) => {
  for (let i = 0; i < f.data.length; i++) f.data[i] = black + (white - black) * f.data[i];
  return f;
};
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
};
export const FILTER_NAMES = Object.keys(LOOKS);

register("filter", "Фильтр", [choice("style", "Стиль", FILTER_NAMES, 0), P("amount", "Сила", 0, 100, 100)],
  (img, p) => {
    const look = LOOKS[FILTER_NAMES[p.style]];
    if (!look || p.amount <= 0) return img;
    return blend(img, I.toU8(I.clamp01(look(I.toFloat(img)))), p.amount / 100);
  });

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
    const f = I.toFloat(img), d = f.data, k = (p.amount / 100) * 0.07;
    for (let i = 0, j = 0; i < w * h; i++, j += 3) {
      const l = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
      const n = noise.data[i] * (0.35 + 2.6 * l * (1 - l)) * k;
      d[j] += n; d[j + 1] += n; d[j + 2] += n;
    }
    return I.toU8(I.clamp01(f));
  }, { active: (p) => p.amount > 0 });
