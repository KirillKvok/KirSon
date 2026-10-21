// Soft masks (planes 0..1, image size) from the analysis — port of kirson/core/face/masks.py.
// Sizes are fractions of the face width, so masks match on the preview and the export.
import * as I from "../core/img.js";
import { Canvas, dilate, erode } from "../core/draw.js";
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
  if (!ctx.cache.has(k)) ctx.cache.set(k, I.packPlane(I.resizeLinear(plane, w, h)));
  return I.unpackPlane(ctx.cache.get(k));
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

// eyeshadow: the lid from the lash line up to about half way to the brow, strongest at the lashes,
// a short wing at the outer corner; never over the eyeball
function eyeshadow(roi) {
  const p = roi.pts, fw = roi.fw, c = new Canvas(roi.w, roi.h);
  for (const [lid, brow] of [[UPPER_LID_R, T.RIGHT_BROW], [UPPER_LID_L, T.LEFT_BROW]]) {
    const lidPts = pick(p, lid), browPts = pick(p, brow);
    const toward = (q, f) => {
      let best = browPts[0], bd = Infinity;
      for (const b of browPts) { const d = Math.hypot(b[0] - q[0], b[1] - q[1]); if (d < bd) { bd = d; best = b; } }
      return [q[0] + (best[0] - q[0]) * f, q[1] + (best[1] - q[1]) * f];
    };
    for (const [f, value] of [[0.55, 0.45], [0.35, 0.75], [0.18, 1]]) { // layers: a soft fade upwards
      const top = lidPts.map((q) => toward(q, f));
      c.poly([...lidPts, ...top.reverse()], value);
    }
    const outer = lidPts[lidPts.length - 1], prev = lidPts[lidPts.length - 3];
    let dx = outer[0] - prev[0], dy = outer[1] - prev[1];
    const dn = Math.hypot(dx, dy) + 1e-6;
    dx /= dn; dy /= dn;
    const tip = toward([outer[0] + dx * 0.05 * fw, outer[1] + dy * 0.05 * fw], 0.25);
    c.poly([outer, tip, toward(outer, 0.35)], 0.7);
  }
  const m = feather(c.plane(), 0.018 * fw);
  const eyes = feather(new Canvas(roi.w, roi.h).poly(pick(p, T.RIGHT_EYE)).poly(pick(p, T.LEFT_EYE)).plane(), 0.002 * fw);
  const brows = feather(new Canvas(roi.w, roi.h).poly(pick(p, T.RIGHT_BROW)).poly(pick(p, T.LEFT_BROW)).plane(), 0.01 * fw);
  for (let i = 0; i < m.data.length; i++) m.data[i] *= (1 - eyes.data[i]) * (1 - brows.data[i]);
  return m;
}

// lashes: a thin band just above the upper lash line (mascara darkens the hairs there)
function lashes(roi) {
  const c = new Canvas(roi.w, roi.h), p = roi.pts, fw = roi.fw;
  for (const lid of [UPPER_LID_R, UPPER_LID_L]) {
    const pts = pick(p, lid);
    for (let i = 0; i < pts.length - 1; i++) c.line(pts[i], pts[i + 1], Math.max(1, fw * 0.03));
  }
  const m = feather(c.plane(), 0.006 * fw);
  const eyes = new Canvas(roi.w, roi.h).poly(pick(p, T.RIGHT_EYE)).poly(pick(p, T.LEFT_EYE)).plane();
  for (let i = 0; i < m.data.length; i++) m.data[i] *= 1 - 0.7 * eyes.data[i];
  return m;
}

// highlighter: the tops of the cheekbones, the nose bridge, the cupid's bow, the inner eye corners
function highlight(roi) {
  const p = roi.pts, fw = roi.fw, c = new Canvas(roi.w, roi.h);
  let dx = p[T.CHIN][0] - p[T.FOREHEAD][0], dy = p[T.CHIN][1] - p[T.FOREHEAD][1];
  const dn = Math.hypot(dx, dy) + 1e-6;
  dx /= dn; dy /= dn;
  for (const [corner, ear] of [[33, 234], [263, 454]]) {
    const cc = [0.55 * p[corner][0] + 0.45 * p[ear][0] + dx * 0.07 * fw, 0.55 * p[corner][1] + 0.45 * p[ear][1] + dy * 0.07 * fw];
    c.ellipse(cc, 0.075 * fw, 0.028 * fw, deg(p[ear][0] - p[corner][0], p[ear][1] - p[corner][1]));
  }
  c.polyline(pick(p, [168, 6, 197, 195, 5]), Math.max(1, 0.022 * fw), 0.8);
  c.circle([p[0][0] - dx * 0.012 * fw, p[0][1] - dy * 0.012 * fw], 0.016 * fw, 0.8); // cupid's bow
  for (const k of [133, 362]) c.circle(p[k], 0.012 * fw, 0.7);
  return feather(c.plane(), 0.02 * fw);
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

// face parsing classes (face/analysis.js PARSE_CLASSES)
const PARSE = ["background", "skin", "l_brow", "r_brow", "l_eye", "r_eye", "eye_g", "l_ear", "r_ear",
  "ear_r", "nose", "mouth", "u_lip", "l_lip", "neck", "neck_l", "cloth", "hair", "hat"];

// Union over faces of face-parsing classes in image coordinates (soft edges from upsampling the
// 512 px label map); null when no face was parsed.
function parsed(img, ctx, classes) {
  const ids = classes.map((c) => PARSE.indexOf(c));
  let full = null;
  for (const f of getAnalysis(ctx).faces) {
    if (!f.parse || !f.parseBox) continue;
    const x0 = Math.round(f.parseBox[0] * img.w), y0 = Math.round(f.parseBox[1] * img.h);
    const x1 = Math.round(f.parseBox[2] * img.w), y1 = Math.round(f.parseBox[3] * img.h);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const S = Math.round(Math.sqrt(f.parse.length)), m = I.fimg(S, S, 1);
    for (let i = 0; i < m.data.length; i++) m.data[i] = ids.includes(f.parse[i]) ? 1 : 0;
    const r = I.resizeLinear(m, x1 - x0, y1 - y0);
    full ||= I.plane(img.w, img.h);
    const fx = Math.max(1, r.w * 0.08), fy = Math.max(1, r.h * 0.08); // soft towards the crop's border
    for (let y = 0; y < r.h && y0 + y < img.h; y++) {
      const ey = Math.min(1, Math.min(y, r.h - 1 - y) / fy);
      for (let x = 0; x < r.w && x0 + x < img.w; x++) {
        const j = (y0 + y) * img.w + x0 + x, v = r.data[y * r.w + x] * ey * Math.min(1, Math.min(x, r.w - 1 - x) / fx);
        if (v > full.data[j]) full.data[j] = v;
      }
    }
  }
  return full;
}

// parsed classes kept near the landmark shape `region` (a parse of a neighbour face, hair over
// the brows ... stays out), snapped to the photo's edges
function parsedNear(img, ctx, classes, region) {
  const p = parsed(img, ctx, classes);
  if (!p) return null;
  const r = perFace(region)(img, ctx);
  return snap(img, I.mapPlane(p, (v, i) => v * Math.min(1, r.data[i] * 1.5)), 0.002);
}

function brows(img, ctx) {
  return parsedNear(img, ctx, ["l_brow", "r_brow"], shape([T.RIGHT_BROW, T.LEFT_BROW], 0.02, 0.03))
    || perFace(shape([T.RIGHT_BROW, T.LEFT_BROW], 0.006, 0.004))(img, ctx);
}

function lips(img, ctx) {
  return parsedNear(img, ctx, ["u_lip", "l_lip"], shape([T.LIPS_OUTER], 0.01, 0.015)) || perFace(lipsGeo)(img, ctx);
}

function faceSkin(img, ctx) {
  // face parsing knows skin from hair strands, ears and the neck; the multiclass segmenter
  // (256 px for the whole frame) does not
  const p = parsed(img, ctx, ["skin", "nose"]);
  const skin = p ? snap(img, p) : refinedClass(img, ctx, "face_skin");
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
  const h = mul(fresh, near), p = parsed(img, ctx, ["hair"]); // the precise hairline around the face
  if (p) for (let i = 0; i < h.data.length; i++) if (fresh.data[i] > 0.2 && p.data[i] > h.data[i]) h.data[i] = p.data[i];
  // what the parsing / segmenter call skin (hairColour checks it against the photo's colours: in profile
  // they call the temple hair «skin»)
  const skin = hairSkin(img, ctx);
  const hc = I.mapPlane(h, (v, i) => v * (1 - skin.data[i])); // the confident hair, for the reach
  // where hair may be: the confident hair grown by ~5 % of the photo, inside the multiclass hair's reach,
  // where the hair model / the parsing see at least a little hair — or right at the face's edge, where
  // they miss the temples (dark walls above the head stay walls)
  const k = Math.min(1, 320 / Math.max(img.w, img.h)), sw = Math.max(2, Math.round(img.w * k)), sh = Math.max(2, Math.round(img.h * k));
  const reach = I.resizeLinear(I.gaussian(dilate(I.mapPlane(I.resize(hc, sw, sh), (v) => (v > 0.35 ? 1 : 0)),
    Math.max(1, Math.round(Math.max(sw, sh) * 0.05))), 1.5), img.w, img.h);
  const edge = perFace(shape([T.FACE_OVAL], 0.05, 0.15))(img, ctx);
  for (let i = 0; i < reach.data.length; i++)
    reach.data[i] *= Math.min(1, near.data[i] * 1.5) * Math.min(1, Math.max(fresh.data[i] * 5, p ? p.data[i] * 1.5 : 0, edge.data[i]));
  // inside the face's own outline (landmarks) the parsing's skin is trusted as it is: a shadowed
  // face edge looks hair-like by colour and got a light rim when dyed blond
  const inner = perFace(shape([T.FACE_OVAL], 0.02, 0.01))(img, ctx);
  hairColour(img, h, skin, reach, inner);
  return snap(img, h);
}

// what is surely not hair: the parsing's skin, nose, ears, neck (sharp) and the segmenter's face / body
// skin (256 px, blurry: only where it is sure)
function hairSkin(img, ctx) {
  const skin = I.plane(img.w, img.h), face = segClass(ctx, "face_skin", img.w, img.h), body = segClass(ctx, "body_skin", img.w, img.h);
  const ps = parsed(img, ctx, ["skin", "nose", "l_ear", "r_ear", "neck", "neck_l"]);
  // with the parsing, the face is the parsing's (in profile the blurry segmenter calls the temple hair
  // «face skin»); the segmenter's body skin (arms, shoulders) still counts
  for (let i = 0; i < skin.data.length; i++) {
    const seg = ps ? body.data[i] : Math.max(face.data[i], body.data[i]);
    skin.data[i] = Math.max(ps ? ps.data[i] : 0, Math.min(1, Math.max(0, (seg - 0.55) / 0.3)));
  }
  return skin;
}

// The photo's own colours of hair, skin and background (Lab; from the confident parts of each mask):
// inside `reach` a pixel goes to the class it looks most like. Long hair the hair model saw only in
// blotches is filled; forehead, temples, an ear in profile — where the models overreach — are let go;
// where the background has the hair's colour, the hair model's own answer stays.
function hairColour(img, h, skin, reach, inner) {
  const b = I.bbox(I.mapPlane(reach, (v, i) => Math.max(v, h.data[i])), 2, 0.05);
  if (!b) return;
  const f = I.cropFloat(img, b), lab = I.rgbToLab(f), w = b.x1 - b.x0, n = w * (b.y1 - b.y0);
  const st = () => ({ n: 0, L: 0, a: 0, b: 0, LL: 0, aa: 0, bb: 0 });
  const hs = st(), bs = st(), sk = [[], [], []];
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i - x) / w, j = (b.y0 + y) * img.w + b.x0 + x;
    const L = lab.data[3 * i], A = lab.data[3 * i + 1], B = lab.data[3 * i + 2];
    if (skin.data[j] > 0.8) { if ((i & 3) === 0) { sk[0].push(L); sk[1].push(A); sk[2].push(B); } continue; }
    const s = h.data[j] > 0.75 ? hs : h.data[j] < 0.03 && reach.data[j] < 0.5 ? bs : null;
    if (!s) continue;
    s.n++; s.L += L; s.a += A; s.b += B; s.LL += L * L; s.aa += A * A; s.bb += B * B;
  }
  if (hs.n < 50) {
    for (let i = 0; i < h.data.length; i++) h.data[i] *= 1 - skin.data[i];
    return;
  }
  const fin = (s) => {
    if (s.n < 50) return null;
    const m = [s.L / s.n, s.a / s.n, s.b / s.n];
    return [m, [Math.sqrt(Math.max(16, s.LL / s.n - m[0] ** 2)), Math.sqrt(Math.max(4, s.aa / s.n - m[1] ** 2)),
      Math.sqrt(Math.max(4, s.bb / s.n - m[2] ** 2))]];
  };
  // skin: median and MAD — robust to hair the parsing called skin
  const robust = (v) => {
    if (v.length < 50) return null;
    const med = (a) => { const c = Float32Array.from(a).sort(); return c[c.length >> 1]; };
    const m = v.map(med), sd = v.map((a, k) => Math.max(k ? 2 : 4, 1.4826 * med(a.map((x) => Math.abs(x - m[k])))));
    return [m, sd];
  };
  const H = fin(hs), S = robust(sk), B = fin(bs);
  const d2 = (L, A, Bb, [m, sd]) => ((L - m[0]) / sd[0]) ** 2 * 0.6 + ((A - m[1]) / sd[1]) ** 2 + ((Bb - m[2]) / sd[2]) ** 2;
  // the hair's own shadows (between strands) are darker than its mean: lightness counts little below it
  const dHair = (L, A, Bb) => d2(L < H[0][0] ? H[0][0] - (H[0][0] - L) * 0.4 : L, A, Bb, H);
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i - x) / w, j = (b.y0 + y) * img.w + b.x0 + x;
    const r = reach.data[j];
    if (r <= 0 && h.data[j] <= 0 && skin.data[j] <= 0) continue;
    const L = lab.data[3 * i], A = lab.data[3 * i + 1], Bb = lab.data[3 * i + 2];
    const eh = Math.exp(-dHair(L, A, Bb) / 2), es = S ? Math.exp(-d2(L, A, Bb, S) / 2) : 0, eb = B ? Math.exp(-d2(L, A, Bb, B) / 2) : 0;
    const sum = eh + es + eb + 1e-9, pHair = eh / sum, pSkin = es / sum;
    // what the models call skin stays skin — unless it clearly looks like this hair, not like this skin
    const sk = Math.max(skin.data[j] * (1 - Math.min(1, Math.max(0, (pHair - pSkin) / 0.5))), skin.data[j] * inner.data[j]);
    // hair-coloured inside the reach: filled, in proportion (thin hair over skin at the temples is half
    // dyed, not left a dark wedge); the background's own look decides against it
    const grow = r * (1 - sk) * (1 - inner.data[j]) * Math.min(1, Math.max(0, (pHair - 0.3) / 0.45));
    let v = Math.max(h.data[j] * (1 - sk), grow);
    v *= 1 - Math.min(1, Math.max(0, (pSkin - 0.5) / 0.3)); // skin-coloured: out
    h.data[j] = v;
  }
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
  hair_skin: hairSkin, // (inspection)
  hair_raw: (img, ctx) => resized(ctx, "hairseg", getAnalysis(ctx).hair, img.w, img.h), // (inspection)
  person: (img, ctx) => refinedClass(img, ctx, "person"),
  lips,
  mouth_inner: perFace(shape([T.LIPS_INNER], 0.004)),
  teeth: perFace(teeth),
  eyes: perFace(shape([T.RIGHT_EYE, T.LEFT_EYE], 0.003)),
  iris: perFace(iris),
  sclera,
  brows,
  cheeks: perFace(cheeks),
  eyeliner: perFace(eyeliner),
  eyeshadow: perFace(eyeshadow),
  lashes: perFace(lashes),
  highlight: perFace(highlight),
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
  const packed = ctx.cache.get(key);
  if (packed) return I.unpackPlane(packed); // a fresh float copy: callers may change it
  let m;
  {
    const baseKey = `maskbase:${name}:${img.w}x${img.h}:${sel}`;
    let base = ctx.cache.get(baseKey) && I.unpackPlane(ctx.cache.get(baseKey));
    if (!base) {
      base = MASKS[name](img, ctx);
      if (sel && (name === "hair" || name === "body_skin")) { // the hair / body of the chosen people only
        const near = nearFaces(img.w, img.h, getAnalysis(ctx), name === "body_skin");
        base = I.mapPlane(base, (v, i) => v * near.data[i]);
      }
      ctx.cache.set(baseKey, I.packPlane(base));
    }
    const apply = ctx.cache.get("mask_edits_apply");
    m = apply ? apply(name, base) : base;
    ctx.cache.set(key, I.packPlane(m));
  }
  return m;
}
