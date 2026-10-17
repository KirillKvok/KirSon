// Under-eye circles and bags, nasolabial folds, wrinkles — port of kirson/core/ops/detail.py.
import { register, P } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { Canvas } from "../core/draw.js";
import { getAnalysis, getMask, refFaceWidth, facePx, faceWidth } from "../face/masks.js";
import * as T from "../face/topology.js";
import { FACE_TAB, labEdit } from "./skin.js";
import { chan, low, nblur } from "./tone.js";

const LOWER_LID_R = [33, 7, 163, 144, 145, 153, 154, 155, 133];
const LOWER_LID_L = [263, 249, 390, 373, 374, 380, 381, 382, 362];
const ALAR = [49, 279], MOUTH = [61, 291];
const UNDER_EYE_DEPTH = 0.13, CIRCLE_LIFT = 0.85, CIRCLE_COLOR = 0.75, BAG_FLATTEN = 0.7, FOLD_LIFT = 0.75;
const WRINKLE_BAND = [0.003, 0.012], WRINKLE_LIFT = 0.8;
const clip = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

// The face's own frame: mid (between the eyes), u (right eye -> left eye), v (down the face).
export function frame(p) {
  const mean = (idx) => idx.reduce((a, k) => [a[0] + p[k][0] / idx.length, a[1] + p[k][1] / idx.length], [0, 0]);
  const er = mean(T.RIGHT_EYE), el = mean(T.LEFT_EYE);
  let u = [el[0] - er[0], el[1] - er[1]];
  const n = Math.hypot(u[0], u[1]) || 1;
  u = [u[0] / n, u[1] / n];
  let v = [-u[1], u[0]];
  const mid = [(er[0] + el[0]) / 2, (er[1] + el[1]) / 2];
  if ((p[T.CHIN][0] - mid[0]) * v[0] + (p[T.CHIN][1] - mid[1]) * v[1] < 0) v = [-v[0], -v[1]];
  return { mid, u, v };
}

function zones(img, ctx) {
  const { w, h } = img, s = Math.min(1, 1024 / Math.max(w, h));
  const sw = Math.max(2, Math.floor(w * s)), sh = Math.max(2, Math.floor(h * s));
  const eye = new Canvas(sw, sh), fold = new Canvas(sw, sh);
  let sig = 1;
  const faces = getAnalysis(ctx).faces;
  for (const face of faces) {
    const p = facePx(face, w, h).map(([x, y]) => [x * s, y * s]), fw = faceWidth(face, w, h) * s;
    const { mid, u, v } = frame(p);
    for (const lid of [LOWER_LID_R, LOWER_LID_L]) {
      const top = lid.map((k) => [p[k][0] + v[0] * 0.02 * fw, p[k][1] + v[1] * 0.02 * fw]);
      const bottom = lid.map((k) => [p[k][0] + v[0] * UNDER_EYE_DEPTH * fw, p[k][1] + v[1] * UNDER_EYE_DEPTH * fw]).reverse();
      eye.poly([...top, ...bottom]);
    }
    for (let k = 0; k < 2; k++) {
      const a = p[ALAR[k]], c = p[MOUTH[k]];
      const side = Math.sign((a[0] - mid[0]) * u[0] + (a[1] - mid[1]) * u[1]);
      const start = [a[0] + side * u[0] * 0.03 * fw - v[0] * 0.01 * fw, a[1] + side * u[1] * 0.03 * fw - v[1] * 0.01 * fw];
      const end = [c[0] + side * u[0] * 0.05 * fw + v[0] * 0.03 * fw, c[1] + side * u[1] * 0.05 * fw + v[1] * 0.03 * fw];
      fold.line(start, end, Math.max(1, 0.055 * fw));
    }
    sig = Math.max(0.5, 0.025 * fw);
  }
  if (!faces.length) return [I.plane(w, h), I.plane(w, h)];
  return [I.resizeLinear(I.gaussian(eye.plane(), sig), w, h), I.resizeLinear(I.gaussian(fold.plane(), sig), w, h)];
}
export { zones };

function zoneLow(labS, mS, fws, zoneS, lift, color, flatten) {
  let any = 0, mx = 0;
  for (let i = 0; i < mS.data.length; i++) { if (mS.data[i] > 0.5) any++; mx = Math.max(mx, zoneS.data[i]); }
  if (any < 20 || mx < 0.05) return null;
  const zone = I.mapPlane(zoneS, (v, i) => v * mS.data[i]);
  const base = nblur(labS, mS, 0.012 * fws);
  const ref = nblur(labS, I.mapPlane(mS, (v, i) => v * (1 - clip(zone.data[i] * 1.5))), 0.08 * fws);
  const relief = flatten > 0 ? nblur(chan(labS, 0), mS, 0.035 * fws) : null;
  const n = mS.data.length, dL = I.fimg(mS.w, mS.h, 1), da = I.fimg(mS.w, mS.h, 1), db = I.fimg(mS.w, mS.h, 1);
  for (let i = 0; i < n; i++) {
    const z = zone.data[i];
    let l = lift * Math.max(0, ref.data[3 * i] - base.data[3 * i]);
    if (relief) l -= flatten * (base.data[3 * i] - relief.data[i]);
    dL.data[i] = l * z;
    da.data[i] = color * (ref.data[3 * i + 1] - base.data[3 * i + 1]) * z;
    db.data[i] = color * (ref.data[3 * i + 2] - base.data[3 * i + 2]) * z;
  }
  return [dL, da, db];
}

register("face_detail", "Под глазами и морщины", [P("circles", "Тёмные круги", 0, 100, 0),
  P("bags", "Мешки под глазами", 0, 100, 0), P("folds", "Носогубные складки", 0, 100, 0),
  P("wrinkles", "Морщины", 0, 100, 0)], (img, p, ctx) => {
  if (!getAnalysis(ctx).faces.length) return img;
  const fw = refFaceWidth(img, ctx), skin = getMask(img, ctx, "face_skin");
  const [eye, fold] = zones(img, ctx);
  const kc = p.circles / 100, kb = p.bags / 100, kf = p.folds / 100, kw = p.wrinkles / 100;
  return labEdit(img, skin, fw, (lab, m, eyeC, foldC) => {
    if (kc > 0 || kb > 0)
      low(lab, m, fw, (a, b, c) => zoneLow(a, b, c, I.resize(eyeC, b.w, b.h), kc * CIRCLE_LIFT, kc * CIRCLE_COLOR, kb * BAG_FLATTEN));
    if (kf > 0) low(lab, m, fw, (a, b, c) => zoneLow(a, b, c, I.resize(foldC, b.w, b.h), kf * FOLD_LIFT, kf * 0.4, kf * 0.5));
    if (kw > 0) {
      const L = chan(lab, 0);
      const fine = I.gaussian(L, Math.max(0.6, WRINKLE_BAND[0] * fw)), broad = I.gaussian(L, Math.max(1.5, WRINKLE_BAND[1] * fw));
      for (let i = 0; i < m.data.length; i++) lab.data[3 * i] -= m.data[i] * kw * WRINKLE_LIFT * Math.min(0, fine.data[i] - broad.data[i]);
    }
  }, eye, fold);
}, { category: FACE_TAB, active: (p) => p.circles > 0 || p.bags > 0 || p.folds > 0 || p.wrinkles > 0 });
