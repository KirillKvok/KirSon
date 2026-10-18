// «Студийный свет»: the face lit again after the shot by a soft light from a chosen side. No network:
// the face is an ellipsoid in its own frame (u: right eye -> left eye, v: down — works with a tilted
// head) with the nose as a bump; its normals and the light direction give the shading, and only the
// lightness changes (colour and texture stay). Hair and neck near the face get a soft gradient of
// the same direction; the background is not touched. Gains are computed on a small copy (smooth),
// applied at full size.
import { register, P, choice } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { getAnalysis, facePx, faceWidth, personConf } from "../face/masks.js";
import * as T from "../face/topology.js";
import { FACE_TAB } from "./skin.js";

export const LIGHT_DIRS = ["Слева", "Справа", "Сверху", "Спереди", "Контур"];
// light vectors (x: towards the photo's right, y: down, z: towards the camera)
const DIRS = { "Слева": [-0.75, -0.25, 0.6], "Справа": [0.75, -0.25, 0.6], "Сверху": [0, -0.8, 0.6], "Спереди": [0, -0.15, 1] };
const WORK_FACE = 260;
const clip = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const norm = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };

function gainMap(img, ctx, dirName, k) {
  const faces = getAnalysis(ctx).faces;
  if (!faces.length) return null;
  const fw0 = Math.max(...faces.map((f) => faceWidth(f, img.w, img.h)));
  const ws = Math.min(1, WORK_FACE / fw0), W = Math.max(1, Math.round(img.w * ws)), H = Math.max(1, Math.round(img.h * ws));
  const G = I.plane(W, H, 1), person = personConf(ctx, W, H);
  const rim = dirName === "Контур", front = dirName === "Спереди";
  for (const f of faces) {
    const p = facePx(f, W, H), oval = T.FACE_OVAL.map((i) => p[i]);
    const c = oval.reduce((a, q) => [a[0] + q[0] / oval.length, a[1] + q[1] / oval.length], [0, 0]);
    const eR = T.RIGHT_EYE.map((i) => p[i]).reduce((a, q) => [a[0] + q[0] / 16, a[1] + q[1] / 16], [0, 0]);
    const eL = T.LEFT_EYE.map((i) => p[i]).reduce((a, q) => [a[0] + q[0] / 16, a[1] + q[1] / 16], [0, 0]);
    let u = [eL[0] - eR[0], eL[1] - eR[1]];
    const ul = Math.hypot(u[0], u[1]) || 1;
    u = [u[0] / ul, u[1] / ul];
    const v = [-u[1], u[0]]; // down the face
    const proj = (q) => [(q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1], (q[0] - c[0]) * v[0] + (q[1] - c[1]) * v[1]];
    let a = 0, bTop = 0, bBot = 0;
    for (const q of oval) {
      const [x, y] = proj(q);
      a = Math.max(a, Math.abs(x));
      if (y < 0) bTop = Math.max(bTop, -y); else bBot = Math.max(bBot, y);
    }
    a *= 1.04; bTop *= 1.04; bBot *= 1.04;
    const [nx0, ny0] = proj(p[T.NOSE_TIP]), nose = [nx0 / a, ny0 / (ny0 < 0 ? bTop : bBot)];
    // the light in the photo's frame (left / right are the photo's sides); normals are turned into it
    const L = norm(DIRS[dirName] || DIRS["Спереди"]);
    const reach = 2.2; // the gradient on hair / neck fades out at this many face radii
    const R = Math.max(a, bTop, bBot) * reach;
    const x0 = Math.max(0, Math.floor(c[0] - R)), x1 = Math.min(W, Math.ceil(c[0] + R));
    const y0 = Math.max(0, Math.floor(c[1] - R)), y1 = Math.min(H, Math.ceil(c[1] + R));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const [px, py] = proj([x, y]);
        const ex = px / a, ey = py / (py < 0 ? bTop : bBot), r2 = ex * ex + ey * ey;
        const i = y * W + x;
        // one surface for all: the ellipsoid (tilted by the nose bump) inside, its rim continued outward
        // (a normal lying flat) beyond — no seam at the face's edge
        const r = Math.sqrt(r2), ez = r < 1 ? Math.sqrt(1 - r2) : 0;
        const dx = ex - nose[0], dy = ey - nose[1], bump = r < 1 ? 0.35 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.12 * 0.12)) : 0;
        const gx = (-dx / (0.12 * 0.12)) * bump, gy = (-dy / (0.12 * 0.12)) * bump;
        const n = r < 1 ? norm([ex / Math.max(ez, 0.25) - gx * 0.5, ey / Math.max(ez, 0.25) - gy * 0.5, 1])
          : norm([ex / r, ey / r, 0.25 / r]);
        // the normal's x, y in the face frame -> the photo's (the head may be tilted)
        const nxp = n[0] * u[0] + n[1] * v[0], nyp = n[0] * u[1] + n[1] * v[1];
        const sh = rim ? clip(1 - n[2]) ** 1.5 : clip(nxp * L[0] + nyp * L[1] + n[2] * L[2]);
        // the face fully; hair / neck (the person) fading out within `reach` face radii
        const wAll = r < 1 ? 1 : clip(1 - (r - 1) / (reach - 1)) ** 1.5 * person.data[i];
        if (wAll <= 0) continue;
        let g;
        if (rim) g = 1 + k * 0.4 * sh;
        else if (front) g = 1 + k * (0.1 + 0.25 * (sh - 0.75)); // a fill: shadows lifted, little modelling
        else g = 1 + k * (sh > 0.55 ? 0.7 * (sh - 0.55) : 0.35 * (sh - 0.55)); // the lit side gains more than the far side loses
        const gi = 1 + (g - 1) * wAll; // overlapping faces: the stronger change wins
        if (Math.abs(gi - 1) > Math.abs(G.data[i] - 1)) G.data[i] = gi;
      }
  }
  return I.gaussian(G, Math.max(1, WORK_FACE * 0.04));
}

register("relight", "Студийный свет", [choice("dir", "Направление света", LIGHT_DIRS, 0),
  P("amount", "Студийный свет", 0, 100, 0)], (img, p, ctx) => {
  const G = gainMap(img, ctx, LIGHT_DIRS[p.dir], p.amount / 100);
  if (!G) return img;
  const Gf = I.resizeLinear(G, img.w, img.h);
  return I.stripMap(img, (f, y0) => {
    const lum = I.luminance(f), g = I.planeRows(Gf, y0, f.h);
    const ln = I.mapPlane(lum, (l, i) => clip(l * Math.min(1.45, Math.max(0.6, g.data[i]))));
    return I.scaleLuminance(f, ln, lum);
  });
}, { category: FACE_TAB, active: (p) => p.amount > 0 });
