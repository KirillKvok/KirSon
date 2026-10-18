// Makeup: lipstick, blush, brows, eyeliner, contour — port of kirson/core/ops/makeup.py.
// Colours in Lab: the target sets a*/b*, the photo's own lightness pattern stays.
import { register, P, choice } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { getMask, refFaceWidth } from "../face/masks.js";
import { erode } from "../core/draw.js";
import { labEdit } from "./skin.js";
import { chan } from "./tone.js";

export const MAKEUP_TAB = "Макияж";
export const LIP_COLORS = { "Розовый": [58, 32, 8], "Красный": [40, 58, 18], "Ягодный": [36, 42, 4], "Нюд": [60, 18, 17], "Коралл": [64, 36, 30] };
export const BLUSH_COLORS = { "Розовые": [28, 6], "Персиковые": [20, 22] };
export const SHADOW_COLORS = { "Нюд": [52, 10, 18], "Бронза": [44, 14, 30], "Розовые": [58, 24, 4], "Дымчатые": [28, 1, -2],
  "Сливовые": [34, 22, -12] };
export const EYE_COLORS = { "Голубые": [58, -6, -24], "Зелёные": [52, -20, 14], "Серые": [60, -2, -7], "Медовые": [52, 14, 36],
  "Карие": [36, 14, 24] };
const LIPS = Object.keys(LIP_COLORS), BLUSH = Object.keys(BLUSH_COLORS);
const SHADOWS = Object.keys(SHADOW_COLORS), EYES = Object.keys(EYE_COLORS);
const clip = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mul = (a, b) => I.mapPlane(a, (v, i) => v * b.data[i]);

register("makeup", "Макияж", [P("lips", "Помада", 0, 100, 0), choice("lip_color", "Цвет помады", LIPS, 0),
  P("blush", "Румяна", 0, 100, 0), choice("blush_color", "Цвет румян", BLUSH, 0), P("brows", "Брови", 0, 100, 0),
  P("eyeliner", "Подводка", 0, 100, 0), P("contour", "Скульптор", 0, 100, 0),
  P("shadow", "Тени для век", 0, 100, 0), choice("shadow_color", "Цвет теней", SHADOWS, 0),
  P("mascara", "Тушь", 0, 100, 0), P("highlight", "Хайлайтер", 0, 100, 0),
  P("iris", "Цвет глаз", 0, 100, 0), choice("iris_color", "Оттенок глаз", EYES, 0)], (img, p, ctx) => {
  const fw = refFaceWidth(img, ctx);
  let out = img;
  if (p.contour > 0) {
    const k = p.contour / 100, skin = getMask(out, ctx, "face_skin");
    const shadow = mul(getMask(out, ctx, "contour_shadow"), skin), light = mul(getMask(out, ctx, "contour_light"), skin);
    out = labEdit(out, I.mapPlane(shadow, (v, i) => Math.max(v, light.data[i])), fw, (lab, m, sh, li) => {
      for (let i = 0; i < m.data.length; i++) {
        const j = 3 * i, L = lab.data[j];
        lab.data[j] = L - k * sh.data[i] * 13 + k * li.data[i] * Math.max(0, 95 - L) * 0.22;
        lab.data[j + 2] += k * sh.data[i] * 2.5;
      }
    }, shadow, light);
  }
  if (p.shadow > 0) { // the lid's own light and relief stay, colour goes to the shade
    const [tL, ta, tb] = SHADOW_COLORS[SHADOWS[p.shadow_color]], k = p.shadow / 100;
    out = labEdit(out, getMask(out, ctx, "eyeshadow"), fw, (lab, m) => {
      for (let i = 0; i < m.data.length; i++) {
        const w = m.data[i] * k * 0.8, j = 3 * i;
        if (w <= 0) continue;
        lab.data[j] += w * (tL - lab.data[j]) * 0.45;
        lab.data[j + 1] += w * (ta - lab.data[j + 1]) * 0.7;
        lab.data[j + 2] += w * (tb - lab.data[j + 2]) * 0.7;
      }
    });
  }
  if (p.mascara > 0) { // the lashes (already darker than the lid) get darker and a touch thicker
    const k = p.mascara / 100, r = Math.max(1, Math.round(fw * 0.003));
    out = labEdit(out, getMask(out, ctx, "lashes"), fw, (lab, m) => {
      const L = chan(lab, 0), local = I.gaussian(L, Math.max(1, fw * 0.012)), thick = erode(L, r);
      for (let i = 0; i < m.data.length; i++) {
        const w = m.data[i] * k, j = 3 * i;
        if (w <= 0) continue;
        const hair = clip((local.data[i] - thick.data[i] - 3) / 12); // dark strands near this pixel
        const target = Math.min(L.data[i], thick.data[i]) * 0.55;
        lab.data[j] += w * hair * (target - lab.data[j]);
        lab.data[j + 1] *= 1 - w * hair * 0.6;
        lab.data[j + 2] *= 1 - w * hair * 0.6;
      }
    });
  }
  if (p.highlight > 0) { // a pearly sheen: lighter, a little less colour, more where the skin already glows
    const k = p.highlight / 100;
    out = labEdit(out, mul(getMask(out, ctx, "highlight"), getMask(out, ctx, "face_skin")), fw, (lab, m) => {
      const L = chan(lab, 0), base = I.gaussian(L, Math.max(1, fw * 0.03));
      for (let i = 0; i < m.data.length; i++) {
        const w = m.data[i] * k, j = 3 * i;
        if (w <= 0) continue;
        lab.data[j] += w * (Math.max(0, 96 - L.data[i]) * 0.24 + Math.max(0, L.data[i] - base.data[i]) * 1.2);
        lab.data[j + 1] *= 1 - w * 0.12;
        lab.data[j + 2] *= 1 - w * 0.18;
      }
    });
  }
  if (p.iris > 0) { // the iris's own pattern, pupil and catchlight stay: only its colour changes
    const [tL, ta, tb] = EYE_COLORS[EYES[p.iris_color]], k = p.iris / 100;
    out = labEdit(out, getMask(out, ctx, "iris"), fw, (lab, m) => {
      let s = 0, n = 0;
      for (let i = 0; i < m.data.length; i++) if (m.data[i] > 0.5) { s += lab.data[3 * i]; n++; }
      if (!n) return;
      const meanL = s / n, lift = Math.max(0, (tL - meanL) * 0.45); // dark eyes lifted to show a light colour
      for (let i = 0; i < m.data.length; i++) {
        const j = 3 * i, L = lab.data[j];
        const w = m.data[i] * k * clip((L - 10) / 18) * clip((88 - L) / 15); // not the pupil, not the catchlight
        if (w <= 0) continue;
        lab.data[j] = L + w * lift;
        const c = clip((L + lift) / Math.max(tL, 1), 0.35, 1.2);
        lab.data[j + 1] += w * (ta * c - lab.data[j + 1]) * 0.72;
        lab.data[j + 2] += w * (tb * c - lab.data[j + 2]) * 0.72;
      }
    });
  }
  if (p.eyeliner > 0) {
    const k = p.eyeliner / 100;
    out = labEdit(out, getMask(out, ctx, "eyeliner"), fw, (lab, m) => {
      for (let i = 0; i < m.data.length; i++) {
        const w = m.data[i] * k, j = 3 * i;
        lab.data[j] += w * (12 - lab.data[j]) * 0.85;
        lab.data[j + 1] *= 1 - w * 0.8;
        lab.data[j + 2] *= 1 - w * 0.8;
      }
    });
  }
  if (p.lips > 0) {
    const [tL, ta, tb] = LIP_COLORS[LIPS[p.lip_color]], k = p.lips / 100;
    out = labEdit(out, getMask(out, ctx, "lips"), fw, (lab, m) => {
      let s = 0, n = 0;
      for (let i = 0; i < m.data.length; i++) if (m.data[i] > 0.5) { s += lab.data[3 * i]; n++; }
      if (!n) return;
      const meanL = s / n;
      for (let i = 0; i < m.data.length; i++) {
        const w = m.data[i] * k, j = 3 * i;
        lab.data[j] += w * (tL - meanL) * 0.6;
        lab.data[j + 1] += w * (ta - lab.data[j + 1]) * 0.85;
        lab.data[j + 2] += w * (tb - lab.data[j + 2]) * 0.85;
      }
    });
  }
  if (p.blush > 0) {
    const [ta, tb] = BLUSH_COLORS[BLUSH[p.blush_color]], k = p.blush / 100;
    out = labEdit(out, mul(getMask(out, ctx, "cheeks"), getMask(out, ctx, "face_skin")), fw, (lab, m) => {
      for (let i = 0; i < m.data.length; i++) {
        const w = m.data[i] * k * 0.6, j = 3 * i;
        lab.data[j + 1] += w * (ta - lab.data[j + 1]);
        lab.data[j + 2] += w * (tb - lab.data[j + 2]);
        lab.data[j] -= w * 2;
      }
    });
  }
  if (p.brows > 0) {
    const k = p.brows / 100, sigma = Math.max(1, fw * 0.02);
    out = labEdit(out, getMask(out, ctx, "brows"), fw, (lab, m) => {
      const L = chan(lab, 0), local = I.gaussian(L, sigma);
      for (let i = 0; i < m.data.length; i++) {
        const hair = Math.min(1, Math.max(0, (local.data[i] - L.data[i] + 2) / 8)), w = m.data[i] * k, j = 3 * i;
        lab.data[j] -= w * (6 + 10 * hair); // only the hairs get darker
        lab.data[j + 1] *= 1 - w * 0.15;
        lab.data[j + 2] *= 1 - w * 0.15;
      }
    });
  }
  return out;
}, { category: MAKEUP_TAB, active: (p) => ["lips", "blush", "brows", "eyeliner", "contour", "shadow", "mascara", "highlight", "iris"].some((k) => p[k] > 0) });
