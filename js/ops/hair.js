// Hair: dye colours, shine, root touch-up, volume — port of kirson/core/ops/hair.py.
import { register, P, choice } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { Canvas } from "../core/draw.js";
import { Field } from "../core/warp.js";
import { getAnalysis, getMask, refFaceWidth, facePx, faceWidth } from "../face/masks.js";
import * as T from "../face/topology.js";
import { labEdit } from "./skin.js";
import { chan } from "./tone.js";
import { MAKEUP_TAB } from "./makeup.js";

export const HAIR_COLORS = { "Шоколадный": [28, 9, 13], "Каштановый": [32, 15, 22], "Медный": [44, 22, 30],
  "Блонд": [68, 3, 21], "Пепельный": [56, 0, 3], "Чёрный": [14, 1, 1], "Бордо": [27, 22, 6], "Розовый": [58, 24, 0] };
export const HAIR_NAMES = ["Нет", ...Object.keys(HAIR_COLORS)];
const VOLUME_MAX = 0.08, MAX_LIFT = 30;
const clip = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

function rootsMask(img, ctx, hair, fw) {
  const c = new Canvas(img.w, img.h);
  for (const face of getAnalysis(ctx).faces) {
    const p = facePx(face, img.w, img.h);
    let up = [p[T.FOREHEAD][0] - p[T.CHIN][0], p[T.FOREHEAD][1] - p[T.CHIN][1]];
    const n = Math.hypot(up[0], up[1]) + 1e-6;
    up = [up[0] / n, up[1] / n];
    c.circle([p[T.FOREHEAD][0] + up[0] * 0.2 * fw, p[T.FOREHEAD][1] + up[1] * 0.2 * fw], 0.55 * fw);
  }
  const m = I.gaussian(c.plane(), Math.max(1, 0.15 * fw));
  return I.mapPlane(m, (v, i) => v * hair.data[i]);
}

function volumeField(img, ctx, hair, amount) {
  const { w, h } = img, faces = getAnalysis(ctx).faces;
  if (!faces.length) return null;
  const field = new Field();
  for (const face of faces) {
    const p = facePx(face, w, h), fw = faceWidth(face, w, h), oval = T.FACE_OVAL.map((k) => p[k]);
    const centre = oval.reduce((a, q) => [a[0] + q[0] / oval.length, a[1] + q[1] / oval.length], [0, 0]);
    const step = Math.max(2, Math.floor(fw * 0.05)), seen = new Set();
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!(hair.data[i] > 0.5)) continue;
        if (hair.data[i - 1] > 0.5 && hair.data[i + 1] > 0.5 && hair.data[i - w] > 0.5 && hair.data[i + w] > 0.5) continue;
        const cell = `${Math.floor(x / step)},${Math.floor(y / step)}`; // contour, thinned
        if (seen.has(cell)) continue;
        seen.add(cell);
        const v = [x - centre[0], y - centre[1]], d = Math.hypot(v[0], v[1]);
        if (d > 1.3 * fw) continue;
        if (Math.min(...oval.map((q) => Math.hypot(q[0] - x, q[1] - y))) < 0.3 * fw) continue;
        const ox = Math.round(x + (v[0] / d) * 0.05 * fw), oy = Math.round(y + (v[1] / d) * 0.05 * fw);
        if (ox >= 0 && ox < w && oy >= 0 && oy < h && hair.data[oy * w + ox] > 0.5) continue; // outer edge only
        field.push([x, y], [(v[0] / d) * amount * VOLUME_MAX * fw, (v[1] / d) * amount * VOLUME_MAX * fw], 0.12 * fw);
      }
  }
  return field.empty ? null : field;
}

register("hair", "Волосы", [choice("color", "Цвет волос", HAIR_NAMES, 0), P("amount", "Сила цвета", 0, 100, 70),
  P("shine", "Блеск", 0, 100, 0), P("volume", "Объём", 0, 100, 0), P("roots", "Закрасить корни", 0, 100, 0)],
  (img, p, ctx) => {
    const fw = refFaceWidth(img, ctx), hair = getMask(img, ctx, "hair");
    if (!I.bbox(hair, 0)) return img;
    let out = img;
    if (p.roots > 0) {
      const roots = rootsMask(out, ctx, hair, fw), k = p.roots / 100;
      const lab = I.rgbToLab(I.toFloat(out)), sr = [0, 0, 0], sl = [0, 0, 0];
      let nr = 0, nl = 0;
      for (let i = 0; i < hair.data.length; i++) {
        const len = hair.data[i] * (1 - clip(roots.data[i] * 3));
        if (roots.data[i] > 0.3) { for (let c = 0; c < 3; c++) sr[c] += lab.data[3 * i + c]; nr++; }
        if (len > 0.5) { for (let c = 0; c < 3; c++) sl[c] += lab.data[3 * i + c]; nl++; }
      }
      if (nr && nl > 50) {
        const shift = [0, 1, 2].map((c) => sl[c] / nl - sr[c] / nr);
        out = labEdit(out, roots, fw, (lb, m) => {
          for (let i = 0; i < m.data.length; i++) for (let c = 0; c < 3; c++) lb.data[3 * i + c] += m.data[i] * k * shift[c];
        });
      }
    }
    if (p.color > 0 && p.amount > 0) {
      const [tL, ta, tb] = HAIR_COLORS[HAIR_NAMES[p.color]], k = p.amount / 100;
      out = labEdit(out, hair, fw, (lab, m) => {
        let sL = 0, sa = 0, sb = 0, n = 0;
        for (let i = 0; i < m.data.length; i++) if (m.data[i] > 0.5) { sL += lab.data[3 * i]; sa += lab.data[3 * i + 1]; sb += lab.data[3 * i + 2]; n++; }
        if (!n) return;
        const meanL = sL / n, meanA = sa / n, meanB = sb / n;
        const newMean = clip(tL, meanL - 25, meanL + MAX_LIFT);
        const gain = clip(Math.sqrt(newMean / Math.max(meanL, 1)), 1, 2.5); // strands stay visible
        for (let i = 0; i < m.data.length; i++) {
          const j = 3 * i, L = lab.data[j], mm = m.data[i];
          // only the confident part of the mask: its soft edge is often skin or background, which
          // turned copper / blond there (the desktop has a sharper parsed hairline)
          const t = clip((mm - 0.25) / 0.5);
          // far brighter than the hair itself = background caught by the mask (a lit wall)
          const w = t * t * (3 - 2 * t) * k * clip(1 - (L - meanL - 25) / 20);
          const nL = clip(newMean + (L - meanL) * gain, 0, 100);
          lab.data[j] = L + w * (nL - L);
          const c = clip(nL / Math.max(tL, 1), 0.25, 1); // dark strands less saturated
          lab.data[j + 1] += w * (ta * c + (lab.data[j + 1] - meanA) * 0.4 * gain - lab.data[j + 1]);
          lab.data[j + 2] += w * (tb * c + (lab.data[j + 2] - meanB) * 0.4 * gain - lab.data[j + 2]);
        }
      });
    }
    if (p.shine > 0) {
      const k = p.shine / 100, sigma = Math.max(1, fw * 0.01);
      out = labEdit(out, hair, fw, (lab, m) => {
        const L = chan(lab, 0), base = I.gaussian(L, sigma), sel = [];
        for (let i = 0; i < m.data.length; i++) if (m.data[i] > 0.5) sel.push(base.data[i]);
        const p60 = sel.length ? I.percentile(sel, 0.6) : 100;
        for (let i = 0; i < m.data.length; i++) {
          const hi = sel.length ? clip((base.data[i] - p60) / 25) : 0;
          lab.data[3 * i] += m.data[i] * k * ((L.data[i] - base.data[i]) * 0.8 + hi * 8);
        }
      });
    }
    if (p.volume > 0) {
      const field = volumeField(out, ctx, hair, p.volume / 100);
      if (field) {
        const warped = field.apply(out), keep = getMask(out, ctx, "face_oval"), d = new Uint8ClampedArray(out.data.length);
        for (let i = 0; i < keep.data.length; i++) for (let c = 0; c < 3; c++) {
          const j = 3 * i + c;
          d[j] = warped.data[j] * (1 - keep.data[i]) + out.data[j] * keep.data[i] + 0.5;
        }
        out = { w: out.w, h: out.h, data: d };
      }
    }
    return out;
  }, { category: MAKEUP_TAB, active: (p) => (p.color > 0 && p.amount > 0) || p.shine > 0 || p.volume > 0 || p.roots > 0 });
