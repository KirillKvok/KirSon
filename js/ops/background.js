// Background: replace, blur, brightness, saturation — port of kirson/core/ops/background.py.
import { register, P, choice, hidden } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { getAnalysis } from "../face/masks.js";
import { segClass } from "../face/masks.js";
import { personMaskFor } from "./body.js";
import { saturate } from "./basic.js";

export const BG_TAB = "Фон";
const BLUR_MAX = 0.012, MATTE_RADIUS = 0.004;
export const REPLACE = ["Нет", "Белый", "Светло-серый", "Бежевый", "Пудровый", "Графит", "Студийный градиент", "Своя картинка"];
const PLAIN = { "Белый": [0.97, 0.97, 0.97], "Светло-серый": [0.83, 0.84, 0.84], "Бежевый": [0.92, 0.87, 0.8],
  "Пудровый": [0.93, 0.82, 0.84], "Графит": [0.21, 0.22, 0.24] }; // RGB (desktop tuples are BGR)
const GRADIENT = [[0.82, 0.8, 0.78], [0.39, 0.37, 0.36]];

// pictures chosen by the user: id -> {w, h, data (RGB bytes)}; set by the worker
export const PICTURES = new Map();
const coverCache = new Map();

function picture(id, w, h) {
  const key = `${id}:${w}x${h}`;
  if (coverCache.has(key)) return coverCache.get(key);
  const pic = PICTURES.get(id);
  if (!pic) return null;
  const k = Math.max(w / pic.w, h / pic.h);
  const rw = Math.max(w, Math.round(pic.w * k)), rh = Math.max(h, Math.round(pic.h * k));
  const big = I.resize(I.toFloat(pic), rw, rh);
  const x0 = (rw - w) >> 1, y0 = (rh - h) >> 1;
  const out = I.crop(big, { x0, y0, x1: x0 + w, y1: y0 + h });
  coverCache.clear();
  coverCache.set(key, out);
  return out;
}

function newBackground(name, id, w, h) {
  if (PLAIN[name]) {
    const f = I.fimg(w, h, 3), c = PLAIN[name];
    for (let i = 0; i < w * h; i++) f.data.set(c, 3 * i);
    return f;
  }
  if (name === "Студийный градиент") {
    const f = I.fimg(w, h, 3), [c0, c1] = GRADIENT;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const r = Math.hypot((x - 0.5 * w) / (0.75 * w), (y - 0.42 * h) / (0.9 * h));
        const t = Math.min(1, r) ** 1.4, j = 3 * (y * w + x);
        for (let c = 0; c < 3; c++) f.data[j + c] = c0[c] * (1 - t) + c1[c] * t;
      }
    return f;
  }
  if (name === "Своя картинка" && id) return picture(id, w, h);
  return null;
}

// crisp person matte for a new background: the soft pose mask's 0.5 edge hardened and snapped
// to the photo with a guided filter (the soft mask left a blurry "ghost" around the body)
function matte(img, ctx, person) {
  const { w, h } = img;
  const entry = ctx.cache.get(`person_after_body:${w}x${h}`);
  let conf = person;
  if ((!entry || entry[0] !== img) && !ctx.cache.get("mask_edits_key")) {
    const bgc = segClass(ctx, "background", w, h);
    conf = I.mapPlane(person, (v, i) => {
      const m = 1 - bgc.data[i];
      return 0.5 * Math.max(v, m) + 0.5 * Math.min(v, m);
    });
  }
  const hard = I.mapPlane(conf, (v) => Math.min(1, Math.max(0, (v - 0.5) * 4 + 0.5)));
  const a = I.guidedFast(I.luminance(I.toFloat(img)), hard, MATTE_RADIUS * Math.max(w, h), 1e-3, Math.min(1, 2000 / Math.max(w, h)));
  return I.mapPlane(a, (v) => Math.min(1, Math.max(0, (Math.min(1, Math.max(0, v)) - 0.5) * 1.5 + 0.5)));
}

register("background", "Фон", [choice("replace", "Заменить фон", REPLACE, 0), hidden("image", ""),
  P("blur", "Размытие", 0, 100, 0), P("brightness", "Яркость", -100, 100, 0), P("saturation", "Насыщенность", -100, 100, 0)],
  (img, p, ctx) => {
    const { w, h } = img, n = w * h;
    let person = personMaskFor(img, ctx);
    let f = I.toFloat(img), bg;
    const nb = p.replace ? newBackground(REPLACE[p.replace], p.image, w, h) : null;
    if (nb) {
      person = matte(img, ctx, person);
      // take the old background's colour out of the soft edge (hair): F = (I - (1-a) B_old) / a
      const sig = Math.max(2, 0.01 * Math.max(w, h));
      const wbg = I.mapPlane(person, (v) => 1 - v), fw = I.fimg(w, h, 3);
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) fw.data[3 * i + c] = f.data[3 * i + c] * wbg.data[i];
      const num = I.gaussian(fw, sig), den = I.gaussian(wbg, sig);
      for (let i = 0; i < n; i++) {
        const a = person.data[i];
        if (a <= 0.02 || a >= 0.98) continue;
        const d = Math.max(den.data[i], 1e-4);
        for (let c = 0; c < 3; c++) {
          const j = 3 * i + c, old = num.data[j] / d;
          f.data[j] = Math.min(1, Math.max(0, (f.data[j] - (1 - a) * old) / Math.max(a, 0.02)));
        }
      }
      bg = nb;
      if (p.blur > 0) bg = I.gaussian(bg, (p.blur / 100) * BLUR_MAX * Math.max(w, h));
    } else {
      bg = f;
      if (p.blur > 0) { // normalised blur over the background only: no halo from the person
        const sigma = (p.blur / 100) * BLUR_MAX * Math.max(w, h);
        const wbg = I.gaussian(I.mapPlane(person, (v) => 1 - v), 1);
        const fw = I.fimg(w, h, 3);
        for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) fw.data[3 * i + c] = f.data[3 * i + c] * wbg.data[i];
        const num = I.gaussian(fw, sigma), den = I.gaussian(wbg, sigma);
        bg = I.fimg(w, h, 3);
        for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
          const j = 3 * i + c;
          bg.data[j] = den.data[i] > 1e-3 ? num.data[j] / Math.max(den.data[i], 1e-4) : f.data[j];
        }
      }
    }
    if (p.brightness) {
      const gamma = 2 ** (-p.brightness / 100), lum = I.luminance(bg);
      for (let i = 0; i < n; i++) {
        const l = lum.data[i], k = Math.max(l, 1e-6) ** gamma / Math.max(l, 1e-4);
        for (let c = 0; c < 3; c++) bg.data[3 * i + c] = Math.min(1, Math.max(0, bg.data[3 * i + c] * k));
      }
    }
    if (p.saturation) bg = saturate(bg, p.saturation / 100);
    const out = new Uint8ClampedArray(n * 3);
    for (let i = 0; i < n; i++) {
      const m = person.data[i];
      for (let c = 0; c < 3; c++) out[3 * i + c] = (f.data[3 * i + c] * m + bg.data[3 * i + c] * (1 - m)) * 255 + 0.5;
    }
    return { w, h, data: out };
  }, { category: BG_TAB, active: (p) => p.blur > 0 || p.brightness !== 0 || p.saturation !== 0 || p.replace > 0 });

export { getAnalysis };
