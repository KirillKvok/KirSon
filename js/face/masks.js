// Soft masks (planes 0..1, image size) from the analysis — port of kirson/core/face/masks.py.
// Sizes are fractions of the face width, so masks match on the preview and the export.
import * as I from "../core/img.js";
import { Canvas, dilate } from "../core/draw.js";
import * as T from "./topology.js";

export const SEG_CLASSES = ["background", "hair", "body_skin", "face_skin", "clothes", "other"];

// --- analysis access (worker side) ------------------------------------------------------------
export function getAnalysis(ctx) {
  const a = ctx.cache.get("analysis") || { faces: [], seg: null, poses: [], person: null, hair: null };
  const sel = ctx.cache.get("face_select") || [];
  if (!sel.length) return a;
  const key = "analysis_select:" + sel.join(",");
  if (!ctx.cache.has(key)) ctx.cache.set(key, { ...a, faces: sel.filter((i) => i < a.faces.length).map((i) => a.faces[i]) });
  return ctx.cache.get(key);
}

export function facePx(face, w, h) { // [[x, y] * 478] in pixels
  const out = new Array(face.pts.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = [face.pts[2 * i] * w, face.pts[2 * i + 1] * h];
  return out;
}
export function faceWidth(face, w, h) {
  const p = face.pts;
  return Math.hypot((p[2 * T.CHEEK_LEFT] - p[2 * T.CHEEK_RIGHT]) * w, (p[2 * T.CHEEK_LEFT + 1] - p[2 * T.CHEEK_RIGHT + 1]) * h);
}
export function refFaceWidth(img, ctx) {
  const faces = getAnalysis(ctx).faces;
  if (!faces.length) return 0.12 * Math.max(img.w, img.h);
  const ws = faces.map((f) => faceWidth(f, img.w, img.h)).sort((a, b) => a - b);
  return ws[(ws.length - 1) >> 1];
}

function resized(ctx, key, plane, w, h) {
  const k = `resized:${key}:${w}x${h}`;
  if (!ctx.cache.has(k)) ctx.cache.set(k, I.resizeLinear(plane, w, h));
  return ctx.cache.get(k);
}

export function segClass(ctx, name, w, h) {
  const a = getAnalysis(ctx);
  if (!a.seg) return I.plane(w, h);
  const c = SEG_CLASSES.indexOf(name), s = a.seg, p = I.fimg(s.w, s.h, 1);
  for (let i = 0; i < s.w * s.h; i++) p.data[i] = s.data[i * 6 + c];
  return resized(ctx, "seg:" + name, p, w, h);
}

export function personConf(ctx, w, h) {
  const a = getAnalysis(ctx);
  if (a.person) return resized(ctx, "person", a.person, w, h);
  return I.mapPlane(segClass(ctx, "background", w, h), (v) => 1 - v);
}

// --- per-face drawing ---------------------------------------------------------------------------
const pick = (pts, idx) => idx.map((i) => pts[i]);
const feather = (m, s) => (s > 0.3 ? I.gaussian(m, Math.max(s, 0.5)) : m);

function perFace(draw) {
  return (img, ctx) => {
    const { w, h } = img, full = I.plane(w, h);
    for (const face of getAnalysis(ctx).faces) {
      const pts = facePx(face, w, h), fw = faceWidth(face, w, h);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const m = (x1 - x0) * 0.35;
      const b = { x0: Math.max(0, Math.floor(x0 - m)), y0: Math.max(0, Math.floor(y0 - m)),
        x1: Math.min(w, Math.ceil(x1 + m)), y1: Math.min(h, Math.ceil(y1 + m)) };
      if (b.x1 <= b.x0 || b.y1 <= b.y0) continue;
      const roi = { w: b.x1 - b.x0, h: b.y1 - b.y0, fw, pts: pts.map(([x, y]) => [x - b.x0, y - b.y0]), box: b };
      const part = draw(roi, img);
      for (let y = 0; y < roi.h; y++)
        for (let x = 0; x < roi.w; x++) {
          const i = (b.y0 + y) * w + b.x0 + x;
          full.data[i] = Math.max(full.data[i], part.data[y * roi.w + x]);
        }
    }
    return full;
  };
}

function shape(indexLists, featherK, grow = 0) {
  return (roi) => {
    const c = new Canvas(roi.w, roi.h);
    for (const idx of indexLists) c.poly(pick(roi.pts, idx));
    let m = c.plane();
    if (grow) m = dilate(m, grow * roi.fw);
    return feather(m, featherK * roi.fw);
  };
}

function lipsGeo(roi) {
  const c = new Canvas(roi.w, roi.h).poly(pick(roi.pts, T.LIPS_OUTER)).poly(pick(roi.pts, T.LIPS_INNER), 0);
  return feather(c.plane(), 0.006 * roi.fw);
}

function iris(roi) {
  const c = new Canvas(roi.w, roi.h), eyes = new Canvas(roi.w, roi.h);
  for (const [center, ring, eye] of [[T.RIGHT_IRIS_CENTER, T.RIGHT_IRIS, T.RIGHT_EYE], [T.LEFT_IRIS_CENTER, T.LEFT_IRIS, T.LEFT_EYE]]) {
    const cc = roi.pts[center];
    const r = ring.reduce((s, k) => s + Math.hypot(roi.pts[k][0] - cc[0], roi.pts[k][1] - cc[1]), 0) / ring.length;
    c.circle(cc, r);
    eyes.poly(pick(roi.pts, eye));
  }
  const m = c.plane(), e = eyes.plane();
  for (let i = 0; i < m.data.length; i++) m.data[i] *= e.data[i]; // eyelids cover the iris
  return feather(m, 0.003 * roi.fw);
}

const roiFloat = (img, b) => I.cropFloat(img, b);

function teeth(roi, img) {
  // bright, low-chroma pixels inside the mouth opening; thresholds from the mouth's own range
  const mouth = new Canvas(roi.w, roi.h).poly(pick(roi.pts, T.LIPS_INNER)).plane();
  const inside = [];
  for (let i = 0; i < mouth.data.length; i++) if (mouth.data[i] > 0.5) inside.push(i);
  if (inside.length < 20) return I.plane(roi.w, roi.h);
  const lab = I.rgbToLab(roiFloat(img, roi.box));
  const Ls = inside.map((i) => lab.data[3 * i]).sort((a, b) => a - b);
  const lo = Ls[Math.floor(0.15 * (Ls.length - 1))], hi = Ls[Math.floor(0.55 * (Ls.length - 1))];
  const out = I.plane(roi.w, roi.h);
  for (let i = 0; i < out.data.length; i++) {
    const L = lab.data[3 * i], chroma = Math.hypot(lab.data[3 * i + 1], lab.data[3 * i + 2]);
    const bright = Math.min(1, Math.max(0, (L - lo) / Math.max(hi - lo, 1e-3)));
    const neutral = Math.min(1, Math.max(0, (40 - chroma) / 18));
    out.data[i] = mouth.data[i] * bright * neutral;
  }
  return feather(out, 0.004 * roi.fw);
}

function cheeks(roi) {
  const c = new Canvas(roi.w, roi.h);
  for (const k of [205, 425]) c.circle(roi.pts[k], 0.09 * roi.fw);
  return feather(c.plane(), 0.06 * roi.fw);
}

const UPPER_LID_R = [133, 173, 157, 158, 159, 160, 161, 246, 33];
const UPPER_LID_L = [362, 398, 384, 385, 386, 387, 388, 466, 263];

function eyeliner(roi) {
  const c = new Canvas(roi.w, roi.h), p = roi.pts, fw = roi.fw;
  let ux = p[T.FOREHEAD][0] - p[T.CHIN][0], uy = p[T.FOREHEAD][1] - p[T.CHIN][1];
  const un = Math.hypot(ux, uy) + 1e-6;
  ux /= un; uy /= un;
  for (const lid of [UPPER_LID_R, UPPER_LID_L]) {
    const pts = pick(p, lid), n = pts.length;
    for (let i = 0; i < n - 1; i++) c.line(pts[i], pts[i + 1], Math.max(1, fw * (0.005 + (0.01 * i) / (n - 2))));
    const outer = pts[n - 1], prev = pts[n - 3];
    let dx = outer[0] - prev[0], dy = outer[1] - prev[1];
    const dn = Math.hypot(dx, dy) + 1e-6;
    dx /= dn; dy /= dn;
    c.line(outer, [outer[0] + (dx * 0.9 + ux * 0.35) * 0.05 * fw, outer[1] + (dy * 0.9 + uy * 0.35) * 0.05 * fw], Math.max(1, fw * 0.006));
  }
  const m = feather(c.plane(), 0.003 * fw);
  const eyes = new Canvas(roi.w, roi.h).poly(pick(p, T.RIGHT_EYE)).poly(pick(p, T.LEFT_EYE)).plane();
  for (let i = 0; i < m.data.length; i++) m.data[i] *= 1 - eyes.data[i]; // never over the eyeball
  return m;
}

const deg = (dx, dy) => (Math.atan2(dy, dx) * 180) / Math.PI;

function contourShadow(roi) {
  const p = roi.pts, fw = roi.fw, c = new Canvas(roi.w, roi.h);
  for (const [ear, mouth] of [[234, 61], [454, 291]]) {
    const cc = [0.7 * p[ear][0] + 0.3 * p[mouth][0], 0.7 * p[ear][1] + 0.3 * p[mouth][1]];
    c.ellipse(cc, 0.12 * fw, 0.03 * fw, deg(p[mouth][0] - p[ear][0], p[mouth][1] - p[ear][1]));
  }
  for (const k of [54, 284]) c.ellipse(p[k], 0.06 * fw, 0.04 * fw, 0);
  const jaw = new Canvas(roi.w, roi.h);
  const nose = p[T.NOSE_TIP], chin = p[T.CHIN];
  const lower = T.FACE_OVAL.filter((k) => (p[k][0] - nose[0]) * (chin[0] - nose[0]) + (p[k][1] - nose[1]) * (chin[1] - nose[1]) > 0);
  jaw.polyline(pick(p, lower), Math.max(1, 0.05 * fw));
  const m = c.plane(), j = jaw.plane();
  for (let i = 0; i < m.data.length; i++) m.data[i] = Math.max(m.data[i], 0.8 * j.data[i]);
  return feather(m, 0.035 * fw);
}

function contourLight(roi) {
  const p = roi.pts, fw = roi.fw, c = new Canvas(roi.w, roi.h);
  let dx = p[T.CHIN][0] - p[T.FOREHEAD][0], dy = p[T.CHIN][1] - p[T.FOREHEAD][1];
  const dn = Math.hypot(dx, dy) + 1e-6;
  dx /= dn; dy /= dn;
  for (const [corner, ear] of [[33, 234], [263, 454]]) {
    const cc = [0.5 * (p[corner][0] + p[ear][0]) + dx * 0.06 * fw, 0.5 * (p[corner][1] + p[ear][1]) + dy * 0.06 * fw];
    c.ellipse(cc, 0.07 * fw, 0.025 * fw, deg(p[ear][0] - p[corner][0], p[ear][1] - p[corner][1]));
  }
  c.polyline(pick(p, [168, 6, 197, 195]), Math.max(1, 0.03 * fw));
  c.ellipse(p[151], 0.08 * fw, 0.05 * fw, 0);
  c.ellipse(p[175], 0.04 * fw, 0.025 * fw, 0);
  return feather(c.plane(), 0.025 * fw);
}

// --- segmentation-based -------------------------------------------------------------------------
function snap(img, conf, radiusFrac = 0.004) {
  // follow the photo's edges (guided filter by luminance) around the mask only
  const radius = Math.max(2, Math.max(img.w, img.h) * radiusFrac);
  const b = I.bbox(conf, Math.round(3 * radius) + 2);
  if (!b) return I.plane(img.w, img.h);
  const gray = I.luminance(roiFloat(img, b));
  const scale = Math.max(img.w, img.h) > 2000 ? 0.5 : 1;
  const out = I.plane(img.w, img.h);
  I.paste(out, I.clamp01(I.guidedFast(gray, I.crop(conf, b), radius, 1e-4, scale)), b);
  return out;
}

function refinedClass(img, ctx, name) {
  const conf = name === "person" ? personConf(ctx, img.w, img.h) : segClass(ctx, name, img.w, img.h);
  const gray = I.luminance(I.toFloat(img));
  const radius = Math.max(2, Math.max(img.w, img.h) * 0.004);
  const scale = Math.max(img.w, img.h) > 2000 ? 0.5 : 1;
  return I.clamp01(I.guidedFast(gray, conf, radius, 1e-4, scale));
}

const mul = (a, b) => I.mapPlane(a, (v, i) => v * b.data[i]);

function faceSkin(img, ctx) {
  const skin = refinedClass(img, ctx, "face_skin");
  if (!getAnalysis(ctx).faces.length) return skin;
  const near = perFace(shape([T.FACE_OVAL], 0.08, 0.12))(img, ctx);
  const features = perFace(shape([T.RIGHT_EYE, T.LEFT_EYE, T.RIGHT_BROW, T.LEFT_BROW, T.LIPS_OUTER], 0.012, 0.015))(img, ctx);
  return I.mapPlane(skin, (v, i) => v * Math.min(1, near.data[i]) * (1 - features.data[i]));
}

function hair(img, ctx) {
  const a = getAnalysis(ctx);
  if (!a.hair) return refinedClass(img, ctx, "hair");
  const old = segClass(ctx, "hair", img.w, img.h);
  const fresh = resized(ctx, "hairseg", a.hair, img.w, img.h);
  const r = Math.max(2, Math.round(Math.max(img.w, img.h) * 0.02));
  // the multiclass hair, grown: limits the hair model (it fires on shoulders in full-body shots)
  const s = Math.min(1, 256 / Math.max(img.w, img.h)); // dilate on a small copy: cheap
  const sm = I.resize(I.mapPlane(old, (v) => (v > 0.3 ? 1 : 0)), Math.round(img.w * s), Math.round(img.h * s));
  let near = I.gaussian(dilate(sm, Math.max(1, r * s)), Math.max(0.5, (r * s) / 2));
  near = I.resizeLinear(near, img.w, img.h);
  return snap(img, mul(fresh, near));
}

function sclera(img, ctx) {
  const eyes = MASKS.eyes(img, ctx);
  const ir = perFace((roi, im) => dilate(iris(roi, im), 0.004 * roi.fw))(img, ctx);
  return I.mapPlane(eyes, (v, i) => Math.max(0, v - ir.data[i]));
}

export const MASKS = {
  face_oval: perFace(shape([T.FACE_OVAL], 0.01)),
  face_skin: faceSkin,
  body_skin: (img, ctx) => refinedClass(img, ctx, "body_skin"),
  hair,
  person: (img, ctx) => refinedClass(img, ctx, "person"),
  lips: perFace(lipsGeo),
  mouth_inner: perFace(shape([T.LIPS_INNER], 0.004)),
  teeth: perFace(teeth),
  eyes: perFace(shape([T.RIGHT_EYE, T.LEFT_EYE], 0.003)),
  iris: perFace(iris),
  sclera,
  brows: perFace(shape([T.RIGHT_BROW, T.LEFT_BROW], 0.006, 0.004)),
  cheeks: perFace(cheeks),
  eyeliner: perFace(eyeliner),
  contour_shadow: perFace(contourShadow),
  contour_light: perFace(contourLight),
};

// soft region around the given faces, reaching down for long hair; body: the figure under the face
function nearFaces(w, h, a, body) {
  const s = Math.min(1, 512 / Math.max(w, h)), sw = Math.max(2, Math.floor(w * s)), sh = Math.max(2, Math.floor(h * s));
  const c = new Canvas(sw, sh);
  let fw0 = 10;
  for (const f of a.faces) {
    const fw = faceWidth(f, w, h) * s, p = facePx(f, w, h);
    fw0 = Math.max(fw0, fw);
    const cx = (p.reduce((t, q) => t + q[0], 0) / p.length) * s, cy = (p.reduce((t, q) => t + q[1], 0) / p.length) * s;
    if (body) c.poly([[cx - 1.2 * fw, cy - fw], [cx + 1.2 * fw, cy - fw], [cx + 2.2 * fw, sh], [cx - 2.2 * fw, sh]]);
    else c.ellipse([cx, cy + 0.6 * fw], 1.1 * fw, 2.2 * fw, 0);
  }
  return I.resizeLinear(I.gaussian(c.plane(), Math.max(1, 0.25 * fw0)), w, h);
}

// Mask `name` for `img` (the image the operation receives), cached per size, face choice and
// mask-brush edits (applied by ops/mask_edit.js when present).
export function getMask(img, ctx, name) {
  const sel = (ctx.cache.get("face_select") || []).join(",");
  const edits = ctx.cache.get("mask_edits_key") || "";
  const key = `mask:${name}:${img.w}x${img.h}:${sel}:${edits}`;
  let m = ctx.cache.get(key);
  if (!m) {
    const baseKey = `maskbase:${name}:${img.w}x${img.h}:${sel}`;
    let base = ctx.cache.get(baseKey);
    if (!base) {
      base = MASKS[name](img, ctx);
      if (sel && (name === "hair" || name === "body_skin")) { // the hair / body of the chosen people only
        const near = nearFaces(img.w, img.h, getAnalysis(ctx), name === "body_skin");
        base = I.mapPlane(base, (v, i) => v * near.data[i]);
      }
      ctx.cache.set(baseKey, base);
    }
    const apply = ctx.cache.get("mask_edits_apply");
    m = apply ? apply(name, base) : base;
    ctx.cache.set(key, m);
  }
  return m;
}
