// Skin tone and light on the face, incl. oily-shine removal — port of kirson/core/ops/tone.py.
import { register, P } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { getAnalysis, getMask, refFaceWidth, facePx, faceWidth } from "../face/masks.js";
import * as T from "../face/topology.js";
import { FACE_TAB, labEdit } from "./skin.js";

const WORK_FACE = 300, EVEN_BAND = [0.035, 0.25], EVEN_L = 0.3, REDNESS_MARGIN = 3;
const TAN = [-6, 1.2, 5], PALE = [4, -1.5, -5], FILL_LIGHT = 8;
const MATTE_BASE = 0.12, MATTE_FROM = 3, MATTE_RANGE = 14, MATTE_DEPTH = 0.9, GLINT_SCALE = 0.02, GLINT_DEPTH = 0.85;
const clip = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

export function chan(f, k) {
  const p = I.fimg(f.w, f.h, 1);
  for (let i = 0; i < p.data.length; i++) p.data[i] = f.data[i * f.c + k];
  return p;
}

// blur of x (plane or c-channel) using only mask pixels: no halo from hair, lips, background
export function nblur(x, m, sigma) {
  sigma = Math.max(sigma, 0.5);
  const wm = I.gaussian(m, sigma), xm = I.fimg(x.w, x.h, x.c);
  for (let i = 0; i < m.data.length; i++) for (let c = 0; c < x.c; c++) xm.data[i * x.c + c] = x.data[i * x.c + c] * m.data[i];
  const b = I.gaussian(xm, sigma);
  for (let i = 0; i < m.data.length; i++) {
    const d = Math.max(wm.data[i], 1e-4);
    for (let c = 0; c < x.c; c++) b.data[i * x.c + c] /= d;
  }
  return b;
}

// fn(labSmall, mSmall, fwSmall) -> [dL, da, db] planes on a reduced copy, added upsampled × mask
export function low(lab, m, fw, fn) {
  const s = Math.min(1, WORK_FACE / Math.max(fw, 1));
  const sw = Math.max(2, Math.floor(m.w * s)), sh = Math.max(2, Math.floor(m.h * s));
  const corr = fn(I.resize(lab, sw, sh), I.resize(m, sw, sh), fw * s);
  if (!corr) return;
  const c3 = I.fimg(sw, sh, 3);
  for (let i = 0; i < sw * sh; i++) for (let c = 0; c < 3; c++) c3.data[3 * i + c] = corr[c] ? corr[c].data[i] : 0;
  const up = I.resizeLinear(c3, m.w, m.h);
  for (let i = 0; i < m.data.length; i++) for (let c = 0; c < 3; c++) lab.data[3 * i + c] += up.data[3 * i + c] * m.data[i];
}

const median = (vals) => I.percentile(vals, 0.5);
function selected(p, m) {
  const out = [];
  for (let i = 0; i < m.data.length; i++) if (m.data[i] > 0.5) out.push(p.data[i]);
  return out;
}

function skinMask(img, ctx) {
  const f = getMask(img, ctx, "face_skin"), b = getMask(img, ctx, "body_skin");
  return I.mapPlane(f, (v, i) => Math.max(v, b.data[i]));
}

register("skin_tone", "Тон кожи", [P("even", "Ровный тон", 0, 100, 0), P("redness", "Убрать покраснения", 0, 100, 0),
  P("tan", "Загар", -100, 100, 0)], (img, p, ctx) => {
  const fw = refFaceWidth(img, ctx), ke = p.even / 100, kr = p.redness / 100, kt = p.tan / 100;
  const lowFn = (labS, mS, fws) => {
    if (selected(mS, mS).length < 20) return null;
    const base = nblur(labS, mS, EVEN_BAND[0] * fws), n = mS.data.length;
    const dL = I.fimg(mS.w, mS.h, 1), da = I.fimg(mS.w, mS.h, 1), db = I.fimg(mS.w, mS.h, 1);
    if (ke > 0) {
      const broad = nblur(labS, mS, EVEN_BAND[1] * fws);
      for (let i = 0; i < n; i++) {
        dL.data[i] -= ke * EVEN_L * (base.data[3 * i] - broad.data[3 * i]);
        da.data[i] -= ke * (base.data[3 * i + 1] - broad.data[3 * i + 1]);
        db.data[i] -= ke * 0.8 * (base.data[3 * i + 2] - broad.data[3 * i + 2]);
      }
    }
    if (kr > 0) {
      const ba = chan(base, 1), med = median(selected(ba, mS));
      for (let i = 0; i < n; i++) {
        const excess = Math.max(0, ba.data[i] + da.data[i] - (med + REDNESS_MARGIN));
        da.data[i] -= kr * 0.85 * excess;
        db.data[i] += kr * 0.15 * excess;
      }
    }
    return [dL, da, db];
  };
  return labEdit(img, skinMask(img, ctx), fw, (lab, m) => {
    if (ke > 0 || kr > 0) low(lab, m, fw, lowFn);
    if (kt !== 0) {
      const d = kt > 0 ? TAN : PALE, t = Math.abs(kt);
      for (let i = 0; i < m.data.length; i++) {
        const w = m.data[i] * t, j = 3 * i;
        lab.data[j] += w * d[0] * clip(lab.data[j] / 60, 0.3, 1);
        lab.data[j + 1] += w * d[1];
        lab.data[j + 2] += w * d[2];
      }
    }
  });
}, { category: FACE_TAB, active: (p) => p.even !== 0 || p.redness !== 0 || p.tan !== 0 });

function matte(labS, mS, fws, k) {
  const n = mS.data.length;
  if (selected(mS, mS).length < 20) return null;
  const L = I.gaussian(chan(labS, 0), Math.max(0.5, 0.004 * fws));
  const base = nblur(chan(labS, 0), mS, MATTE_BASE * fws);
  const chroma = I.fimg(mS.w, mS.h, 1);
  for (let i = 0; i < n; i++) chroma.data[i] = Math.hypot(labS.data[3 * i + 1], labS.data[3 * i + 2]);
  const cSkin = median(selected(chroma, mS));
  let w = I.fimg(mS.w, mS.h, 1);
  const excess = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    excess[i] = Math.max(0, L.data[i] - base.data[i] - MATTE_FROM);
    const pale = clip(1 - chroma.data[i] / Math.max(cSkin, 1));
    w.data[i] = clip(excess[i] / MATTE_RANGE) * (0.45 + 0.55 * pale) * (mS.data[i] > 0.05 ? 1 : 0);
  }
  w = I.gaussian(w, Math.max(0.5, 0.006 * fws));
  const ab = I.fimg(mS.w, mS.h, 2), keep = I.fimg(mS.w, mS.h, 1);
  for (let i = 0; i < n; i++) {
    ab.data[2 * i] = labS.data[3 * i + 1];
    ab.data[2 * i + 1] = labS.data[3 * i + 2];
    keep.data[i] = mS.data[i] * (1 - clip(w.data[i] * 2));
  }
  const around = nblur(ab, keep, 0.04 * fws);
  const dL = I.fimg(mS.w, mS.h, 1), da = I.fimg(mS.w, mS.h, 1), db = I.fimg(mS.w, mS.h, 1);
  for (let i = 0; i < n; i++) {
    dL.data[i] = -k * w.data[i] * excess[i] * MATTE_DEPTH;
    da.data[i] = k * w.data[i] * (around.data[2 * i] - ab.data[2 * i]) * 0.8;
    db.data[i] = k * w.data[i] * (around.data[2 * i + 1] - ab.data[2 * i + 1]) * 0.8;
  }
  return [dL, da, db];
}

function matteGlints(lab, m, fw, k) {
  const L = chan(lab, 0), base = I.gaussian(L, Math.max(1, GLINT_SCALE * fw));
  const a = I.gaussian(chan(lab, 1), 1.5), b = I.gaussian(chan(lab, 2), 1.5);
  const chroma = I.mapPlane(a, (v, i) => Math.hypot(v, b.data[i]));
  const sel = selected(chroma, m), cSkin = sel.length ? median(sel) : 15;
  for (let i = 0; i < m.data.length; i++) {
    const glint = Math.max(0, L.data[i] - base.data[i] - 1.5);
    const pale = clip(1.3 - chroma.data[i] / Math.max(cSkin, 1));
    lab.data[3 * i] -= m.data[i] * k * GLINT_DEPTH * glint * pale;
  }
}

function fillMap(img, ctx) {
  const { w, h } = img, s = Math.min(1, 256 / Math.max(w, h));
  const sw = Math.max(2, Math.floor(w * s)), sh = Math.max(2, Math.floor(h * s)), out = I.fimg(sw, sh, 1);
  for (const face of getAnalysis(ctx).faces) {
    const p = facePx(face, w, h);
    const eye = (idx) => idx.reduce((acc, k) => [acc[0] + p[k][0] / idx.length, acc[1] + p[k][1] / idx.length], [0, 0]);
    const er = eye(T.RIGHT_EYE), el = eye(T.LEFT_EYE), nose = p[T.NOSE_TIP];
    const cx = ((nose[0] + (er[0] + el[0]) / 2) / 2) * s, cy = ((nose[1] + (er[1] + el[1]) / 2) / 2) * s;
    const sig = 0.4 * faceWidth(face, w, h) * s;
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const v = Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sig * sig));
        if (v > out.data[y * sw + x]) out.data[y * sw + x] = v;
      }
  }
  return I.resizeLinear(out, w, h);
}

register("face_light", "Свет на лице", [P("matte", "Убрать жирный блеск", 0, 100, 0),
  P("soften", "Смягчить резкие тени", 0, 100, 0), P("fill", "Подсветить лицо", 0, 100, 0)], (img, p, ctx) => {
  if (!getAnalysis(ctx).faces.length) return img;
  const fw = refFaceWidth(img, ctx), skin = getMask(img, ctx, "face_skin");
  const ks = p.soften / 100, kf = p.fill / 100, km = p.matte / 100;
  const softenFn = (labS, mS, fws) => {
    const sel = selected(mS, mS);
    if (sel.length < 20) return null;
    const L = nblur(chan(labS, 0), mS, 0.07 * fws), typical = I.percentile(selected(L, mS), 0.6);
    const lift = I.mapPlane(L, (v) => ks * (Math.max(0, typical - v) * 0.65 - Math.max(0, v - typical - 6) * 0.25));
    return [lift, null, null];
  };
  const fill = kf > 0 ? fillMap(img, ctx) : I.plane(img.w, img.h);
  return labEdit(img, skin, fw, (lab, m, fillC) => {
    if (km > 0) {
      low(lab, m, fw, (a, b, c) => matte(a, b, c, km));
      matteGlints(lab, m, fw, km);
    }
    if (ks > 0) low(lab, m, fw, softenFn);
    if (kf > 0)
      for (let i = 0; i < m.data.length; i++) {
        const j = 3 * i;
        lab.data[j] += m.data[i] * fillC.data[i] * kf * FILL_LIGHT * clip((100 - lab.data[j]) / 30);
      }
  }, fill);
}, { category: FACE_TAB, active: (p) => p.soften > 0 || p.fill > 0 || p.matte > 0 });
