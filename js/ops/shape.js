// Face shape from landmarks (slim, jaw, chin, eyes, nose, lips, smile, eye opening, symmetry) —
// port of kirson/core/ops/shape.py. Directions in the face's own frame: tilted heads work.
import { register, P } from "../core/pipeline.js";
import { Field } from "../core/warp.js";
import { getAnalysis, facePx, faceWidth } from "../face/masks.js";
import * as T from "../face/topology.js";
import { FACE_TAB } from "./skin.js";
import { frame } from "./detail.js";

const SLIM_MAX = 0.08, JAW_MAX = 0.065, CHIN_MAX = 0.08, EYES_MAX = 0.3, NOSE_MAX = 0.45, LIPS_MAX = 0.25;
const SMILE_MAX = 0.03, EYE_OPEN_MAX = 0.3, SYM_MAX_MOVE = 0.04;
const JAW_RIGHT = [172, 136, 150, 149, 58, 132], JAW_LEFT = [397, 365, 379, 378, 288, 361];
const CHIN_PTS = [152, 148, 377, 176, 400], ALAR = [49, 279], MOUTH_CORNERS = [61, 291];
const MIDLINE = [168, 6, 197, 195, 5, 4, 1, 0, 17, 152];
const SYM_PAIRS = [[[33, 133, 159, 145], [263, 362, 386, 374], 0.07], [[70, 105, 107], [300, 334, 336], 0.06],
  [[61], [291], 0.05], [[172, 136, 150, 149, 58, 132], [397, 365, 379, 378, 288, 361], 0.07]];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mean = (p, idx) => idx.reduce((a, k) => [a[0] + p[k][0] / idx.length, a[1] + p[k][1] / idx.length], [0, 0]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// pushes overlap and add up: scale them so the contour moves by `target` px on average
function pushCalibrated(field, pts, dirs, sigma, target) {
  const probe = new Field();
  pts.forEach((q, i) => probe.push(q, dirs[i], sigma));
  let achieved = 0;
  pts.forEach((q, i) => { achieved += dot(probe.at(q[0], q[1], 1), dirs[i]); });
  achieved /= pts.length;
  if (achieved <= 1e-6) return;
  // at most 4x the target (overlap can make `achieved` small); a cap of 4 *pixels* here made every
  // slider stop at ~25 on the preview and shrink 2.4x on the full-size export («всё съехало»)
  const k = Math.abs(target) * Math.min(1 / achieved, 4) * Math.sign(target);
  pts.forEach((q, i) => field.push(q, [dirs[i][0] * k, dirs[i][1] * k], sigma));
}

function pushBothSides(field, pts, dirs, side, sigma, target) {
  for (const s of [-1, 1]) {
    const idx = side.map((v, i) => (v === s ? i : -1)).filter((i) => i >= 0);
    if (idx.length) pushCalibrated(field, idx.map((i) => pts[i]), idx.map((i) => dirs[i]), sigma, target);
  }
}

function symmetry(field, p, fw, u, v, k) {
  const axis = mean(p, MIDLINE);
  const left = Math.abs(dot(sub(p[T.CHEEK_LEFT], p[T.NOSE_TIP]), u)), right = Math.abs(dot(sub(p[T.CHEEK_RIGHT], p[T.NOSE_TIP]), u));
  const turn = Math.min(left, right) / Math.max(left, right, 1e-6); // 1 = frontal
  k *= Math.min(1, Math.max(0, (turn - 0.55) / 0.3));
  if (k <= 0) return;
  for (const [ra, la, sig] of SYM_PAIRS) {
    const qa = mean(p, ra), qb = mean(p, la), a = sub(qa, axis), b = sub(qb, axis);
    const xa = dot(a, u), ya = dot(a, v), xb = dot(b, u), yb = dot(b, v);
    const x = (xa - xb) / 2, y = (ya + yb) / 2;
    for (const [q, dx, dy] of [[qa, x - xa, y - ya], [qb, -x - xb, y - yb]]) {
      let d = [(dx * u[0] + dy * v[0]) * k, (dx * u[1] + dy * v[1]) * k];
      const n = Math.hypot(d[0], d[1]);
      if (n > SYM_MAX_MOVE * fw) d = [(d[0] * SYM_MAX_MOVE * fw) / n, (d[1] * SYM_MAX_MOVE * fw) / n];
      if (n > 0.2) field.push(q, d, sig * fw);
    }
  }
}

export function shapeFace(field, p, fw, val) {
  const { mid, u, v } = frame(p);
  const inward = (idx) => {
    const pts = idx.map((k) => p[k]);
    const side = pts.map((q) => Math.sign(dot(sub(q, mid), u)));
    return [pts, side.map((s) => [-s * u[0], -s * u[1]]), side];
  };
  if (val.slim) {
    const sel = T.FACE_OVAL.filter((k) => dot(sub(p[k], mid), v) > 0.1 * fw && Math.abs(dot(sub(p[k], mid), u)) > 0.15 * fw);
    const [pts, dirs, side] = inward(sel);
    const weighted = dirs.map((d, i) => {
      const w = Math.min(1, Math.max(0.3, dot(sub(pts[i], mid), v) / (0.5 * fw)));
      return [d[0] * w, d[1] * w];
    });
    pushBothSides(field, pts, weighted, side, 0.1 * fw, (val.slim / 100) * SLIM_MAX * fw);
  }
  if (val.jaw) {
    const [pts, dirs, side] = inward([...JAW_RIGHT, ...JAW_LEFT]);
    pushBothSides(field, pts, dirs, side, 0.07 * fw, (val.jaw / 100) * JAW_MAX * fw);
  }
  if (val.chin) {
    const pts = CHIN_PTS.map((k) => p[k]);
    pushCalibrated(field, pts, pts.map(() => v), 0.09 * fw, (val.chin / 100) * CHIN_MAX * fw);
  }
  const eyes = [[T.RIGHT_EYE, 33, 133], [T.LEFT_EYE, 263, 362]];
  if (val.eyes) for (const [eye, a, b] of eyes) field.scale(mean(p, eye), (val.eyes / 100) * EYES_MAX, 1.1 * dist(p[a], p[b]));
  if (val.nose) {
    const nw = dist(p[ALAR[0]], p[ALAR[1]]);
    const c = [(p[ALAR[0]][0] + p[ALAR[1]][0] + p[T.NOSE_TIP][0]) / 3, (p[ALAR[0]][1] + p[ALAR[1]][1] + p[T.NOSE_TIP][1]) / 3];
    field.scale(c, (val.nose / 100) * NOSE_MAX, 1.3 * nw, u);
  }
  if (val.lips) field.scale(mean(p, T.LIPS_OUTER), (val.lips / 100) * LIPS_MAX, 0.75 * dist(p[61], p[291]));
  if (val.smile) {
    const mw = dist(p[61], p[291]), lc = mean(p, T.LIPS_OUTER);
    for (const k of MOUTH_CORNERS) {
      const s = Math.sign(dot(sub(p[k], lc), u));
      pushCalibrated(field, [p[k]], [[-v[0] * 0.85 + s * u[0] * 0.3, -v[1] * 0.85 + s * u[1] * 0.3]], 0.22 * mw,
        (val.smile / 100) * SMILE_MAX * fw);
    }
  }
  if (val.eye_open) for (const [eye, a, b] of eyes) field.scale(mean(p, eye), (val.eye_open / 100) * EYE_OPEN_MAX, 0.9 * dist(p[a], p[b]), v);
  if (val.symmetry) symmetry(field, p, fw, u, v, val.symmetry / 100);
}

register("face_shape", "Форма лица", [P("slim", "Овал уже", -100, 100, 0), P("jaw", "Челюсть уже", -100, 100, 0),
  P("chin", "Подбородок", -100, 100, 0), P("eyes", "Глаза больше", -100, 100, 0), P("nose", "Нос шире", -100, 100, 0),
  P("lips", "Губы больше", -100, 100, 0), P("smile", "Улыбка", -100, 100, 0), P("eye_open", "Глаза открытее", -100, 100, 0),
  P("symmetry", "Симметрия", 0, 100, 0)], (img, p, ctx) => {
  let out = img;
  for (const face of getAnalysis(ctx).faces) {
    const field = new Field();
    shapeFace(field, facePx(face, img.w, img.h), faceWidth(face, img.w, img.h), p);
    out = field.apply(out);
  }
  return out;
}, { category: FACE_TAB });
