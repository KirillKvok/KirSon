// Hair: dye colours, shine, root touch-up, volume, thicker — port of kirson/core/ops/hair.py.
import { register, P, choice } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { Canvas } from "../core/draw.js";
import { Field } from "../core/warp.js";
import { getAnalysis, getMask, refFaceWidth, facePx, faceWidth } from "../face/masks.js";
import * as T from "../face/topology.js";
import { labEdit } from "./skin.js";
import { chan } from "./tone.js";
import { MAKEUP_TAB } from "./makeup.js";

// Each dye as real hair shows it: its shadow, middle and highlight (Lab). The hair's own light and shade is
// mapped through these — a single target colour gave a flat painted look, dark hair dyed blond turned olive
// in its shadows (yellow at low lightness) and chocolate came out ginger.
export const HAIR_PALETTES = {
  "Шоколадный": [[12, 4, 5], [22, 7, 9], [38, 8, 13]],
  "Каштановый": [[14, 7, 8], [27, 11, 15], [44, 11, 19]],
  "Медный": [[20, 16, 16], [38, 22, 28], [58, 18, 32]],
  "Блонд": [[40, 5, 16], [60, 4, 20], [80, 2, 18]],
  "Пепельный": [[32, 0, 2], [52, 0, 2], [72, -1, 1]],
  "Чёрный": [[6, 1, 0], [12, 1, -1], [27, 0, -2]],
  "Бордо": [[11, 13, 3], [22, 20, 5], [38, 20, 6]],
  "Розовый": [[42, 20, -2], [60, 23, -3], [77, 15, -3]],
};
export const HAIR_COLORS = Object.fromEntries(Object.entries(HAIR_PALETTES).map(([n, p]) => [n, p[1]])); // swatches
export const HAIR_NAMES = ["Нет", ...Object.keys(HAIR_COLORS)];
const VOLUME_MAX = 0.08;
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

// «Гуще»: in thin hair the scalp / background shows between strands — pixels lighter and pinker than
// the hair mass around them (the parting most of all). They are pulled to the local tone of the hair
// (a normalised blur inside the mask), the strands' fine texture is kept, and the mass gets a little
// denser (darker, richer), as thick hair looks.
function thicker(img, hair, fw, k) {
  return labEdit(img, hair, fw, (lab, m) => {
    const { w, h } = m, n = w * h, sigma = Math.max(2, fw * 0.04), fine = Math.max(0.6, fw * 0.003);
    const conf = I.mapPlane(m, (v) => { const t = clip((v - 0.3) / 0.5); return t * t * (3 - 2 * t); });
    const L = chan(lab, 0), A = chan(lab, 1), B = chan(lab, 2);
    const wsum = I.gaussian(conf, sigma), num = I.fimg(w, h, 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) num.data[3 * i + c] = lab.data[3 * i + c] * conf.data[i];
    const base = I.gaussian(num, sigma), Ls = I.gaussian(L, fine);
    for (let i = 0; i < n; i++) {
      const cm = conf.data[i];
      if (cm <= 0) continue;
      const d = Math.max(wsum.data[i], 1e-3), bL = base.data[3 * i] / d, bA = base.data[3 * i + 1] / d, bB = base.data[3 * i + 2] / d;
      const j = 3 * i, l = lab.data[j];
      // a gap: lighter than the mass, or pinker (scalp at the parting)
      const gap = Math.max(clip((l - bL - 3) / 14), clip((A.data[i] - bA - 2) / 7) * clip((l - bL + 4) / 10));
      const g = cm * k * gap;
      const tex = (l - Ls.data[i]) * 0.6; // the strands' own fine detail stays
      let nl = l + g * (bL + tex - l);
      nl -= cm * k * 0.06 * nl * clip((bL - 8) / 20); // denser mass: a touch darker (not for black hair)
      lab.data[j] = nl;
      lab.data[j + 1] += g * (bA - lab.data[j + 1]);
      lab.data[j + 2] += g * (bB - lab.data[j + 2]) + cm * k * 0.04 * (lab.data[j + 2] > 0 ? lab.data[j + 2] : 0);
    }
  });
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

// The dye. Each pixel's place in the hair's own light and shade (u: 0 = its shadows, 0.5 = the middle,
// 1 = its highlights, from the percentiles of the smoothed lightness) picks the dye's tone there, so the
// depth between strands stays. The grain of the photo (lightness minus a ~1 px blur) is added back as it
// was, in proportion to the new lightness (strands on light hair are more contrasty). The dye's contrast is
// held to at most 2.5x the hair's own (dark flat hair dyed blond would otherwise show every jpeg block). On the matte's soft edge (mixed hair / skin / background pixels)
// the change of a typical strand is added instead of mapping the pixel itself: a mixed lighter pixel mapped
// to a highlight glowed as a rim.
const absDiff = (a, b) => I.mapPlane(a, (v, i) => Math.abs(v - b.data[i]));

function dye(img, hair, fw, pal, k) {
  return labEdit(img, hair, fw, (lab, m) => {
    const { w, h } = m, n = w * h, L = chan(lab, 0);
    const base = I.gaussian(L, Math.max(0.6, fw * 0.0015));
    // a flyaway hair on a light background is a mix — lighter than the hair, yet darker than what is
    // around it (the wall at the hair's edge is lighter than its surroundings, never darker)
    const around = I.gaussian(L, Math.max(1.5, fw * 0.006));
    // the mass of the hair, for filling its holes: the models leave half-transparent streaks inside long
    // hair, which a dye that follows the matte showed as stripes
    const mass = I.gaussian(m, Math.max(2, fw * 0.03));
    // texture: hair is strands (fine light and shade), a wall of the same colour behind it is smooth. On the
    // soft edge of the matte where hair and background look alike (dark hair, dark wall) the models' blurry
    // edge reached ~1 % of the photo into the wall, and a light dye glowed there
    const strand = Math.max(0.8, fw * 0.004), tex = I.gaussian(absDiff(L, I.gaussian(L, strand)), strand * 3);
    const sel = [], sa = [0, 0];
    let ns = 0;
    // the hair's own light and shade from its sure part (the soft edge mixes in the wall and the skin and
    // made the highlights look higher than they are: the whole mass got squeezed into the shadows)
    for (let i = 0; i < n; i += 2) if (m.data[i] > 0.88) {
      sel.push(base.data[i]);
      sa[0] += lab.data[3 * i + 1]; sa[1] += lab.data[3 * i + 2]; ns++;
    }
    if (sel.length < 50) return;
    const texSel = [];
    for (let i = 0; i < n; i += 2) if (m.data[i] > 0.88) texSel.push(tex.data[i]);
    const hairTex = Math.max(0.3, I.percentile(texSel, 0.5)); // the hair's own (Lab L units)
    const p05 = I.percentile(sel, 0.05), p50 = I.percentile(sel, 0.5), p95 = I.percentile(sel, 0.95);
    const meanA = sa[0] / ns, meanB = sa[1] / ns;
    let sdA = 0, sdB = 0, sdL = 0, mL = 0;
    for (const v of sel) mL += v;
    mL /= sel.length;
    for (const v of sel) sdL += (v - mL) ** 2;
    sdL = Math.max(6, Math.sqrt(sdL / sel.length));
    for (let i = 0; i < n; i += 2) if (m.data[i] > 0.88) { sdA += (lab.data[3 * i + 1] - meanA) ** 2; sdB += (lab.data[3 * i + 2] - meanB) ** 2; }
    sdA = Math.max(3, Math.sqrt(sdA / ns)); sdB = Math.max(3, Math.sqrt(sdB / ns));
    const lo = Math.max(1, p50 - p05), hi = Math.max(1, p95 - p50);
    const uOf = (v) => clip(v < p50 ? 0.5 - (0.5 * (p50 - v)) / lo : 0.5 + (0.5 * (v - p50)) / hi, -0.15, 1.15);
    const LOf = (u) => (u < 0.5 ? p50 - (0.5 - u) * 2 * lo : p50 + (u - 0.5) * 2 * hi);
    // the dye's tones, its contrast held near the hair's own
    const [S, M, H] = pal, spread = H[0] - S[0], own = p95 - p05;
    const kc = clip((own * 2.5) / Math.max(1, spread), 0.6, 1);
    const tone = (u) => {
      const [A, B, t] = u < 0.5 ? [S, M, u * 2] : [M, H, (u - 0.5) * 2];
      const out = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
      out[0] = M[0] + (out[0] - M[0]) * kc;
      return out;
    };
    const likeHair = (Lv, A, B) => {
      const l = Lv < mL ? mL - (mL - Lv) * 0.3 : Lv;
      const d = ((l - mL) / sdL) ** 2 * (Lv > mL ? 1.7 : 0.5) + ((A - meanA) / sdA) ** 2 + ((B - meanB) / sdB) ** 2;
      return clip((16 - d) / 8);
    };
    for (let i = 0; i < n; i++) {
      const j = 3 * i, Lv = lab.data[j], A = lab.data[j + 1], B = lab.data[j + 2], bl = base.data[i];
      let mm = m.data[i];
      const fill = clip((mass.data[i] - 0.8) / 0.15); // deep inside the mass only (its outer edge borders dark backgrounds)
      if (fill > 0 && mm < 0.95) mm = Math.max(mm, fill * likeHair(Lv, A, B));
      if (mm <= 0.06) continue;
      const core = clip((mm - 0.6) / 0.35);
      // the matte is the pixel's share of hair: the dye follows it nearly linearly; on the soft edge only
      // hair-like pixels take it; far brighter than the hair = a lit wall caught by the mask
      const stray = clip((around.data[i] - Lv - 6) / 10); // a strand stands out; the grain of a dark wall does not
      const textured = clip(tex.data[i] / (0.45 * hairTex)); // smooth = a wall, not hair
      // deep inside the mass every pixel is dyed (smooth sheen, out-of-focus hair); towards its edge a smooth
      // pixel is a wall, whatever the mask says
      const deep = clip((mass.data[i] - 0.85) / 0.1);
      const gate = deep + (1 - deep) * Math.max(textured * (core + (1 - core) * likeHair(Lv, A, B)), stray);
      const wgt = clip((mm - 0.06) / 0.86) * gate * k
        * Math.max(stray, clip(1 - (Lv - mL - 25) / 20));
      if (wgt <= 0) continue;
      const u = uOf(bl), T = tone(u);
      // full mapping (inside the hair): the tone + the photo's grain, a little of the hair's own colour play
      // the strands' fine light and shade grows with the new lightness (it is a ratio: the same strands on
      // light hair are far more contrasty than on dark) — 1x left light dyes looking like a wig
      const fL = T[0] + (Lv - bl) * clip((T[0] + 8) / (bl + 8), 1, 2.6), fA = T[1] + (A - meanA) * 0.25, fB = T[2] + (B - meanB) * 0.25;
      // a typical strand's change (the edge): the pixel keeps its mix, the hair part changes colour
      const ue = Math.min(u, 0.6), Te = tone(ue), dL = Te[0] - LOf(ue);
      const eL = Lv + dL, eA = A + (Te[1] - meanA), eB = B + (Te[2] - meanB);
      const nL = eL + (fL - eL) * core, nA = eA + (fA - eA) * core, nB = eB + (fB - eB) * core;
      lab.data[j] = Lv + wgt * (clip(nL, 0, 100) - Lv);
      lab.data[j + 1] = A + wgt * (nA - A);
      lab.data[j + 2] = B + wgt * (nB - B);
    }
  });
}

register("hair", "Волосы", [choice("color", "Цвет волос", HAIR_NAMES, 0), P("amount", "Сила цвета", 0, 100, 70),
  P("shine", "Блеск", 0, 100, 0), P("volume", "Объём", 0, 100, 0), P("roots", "Закрасить корни", 0, 100, 0),
  P("thick", "Гуще", 0, 100, 0)],
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
    if (p.thick > 0) out = thicker(out, hair, fw, p.thick / 100); // before the dye: gaps take the new colour too
    if (p.color > 0 && p.amount > 0) out = dye(out, hair, fw, HAIR_PALETTES[HAIR_NAMES[p.color]], p.amount / 100);
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
  }, { category: MAKEUP_TAB, active: (p) => (p.color > 0 && p.amount > 0) || p.shine > 0 || p.volume > 0 || p.roots > 0 || p.thick > 0 });
