// «Веснушки»: −100 … +100. Left — freckles removed: small brownish spots (0.004–0.015 of the face width)
// darker than the skin around are pulled to it; pores are smaller and stay. Right — freckles added
// where they grow by nature: the nose bridge and the cheeks under the eyes; sizes, darkness and density
// are random but seeded (the same on the preview and the export), warm brown, on the skin only.
import { register, P } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { getAnalysis, getMask, refFaceWidth, facePx, faceWidth } from "../face/masks.js";
import * as T from "../face/topology.js";
import { labEdit, FACE_TAB } from "./skin.js";
import { chan } from "./tone.js";

const clip = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const MAX_FRECKLES = 170;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// where freckles grow, in the face frame (u: along the eyes, v: down; origin the nose bridge, unit = face width)
function density(u, v) {
  const g = (x, y, cx, cy, sx, sy) => Math.exp(-((x - cx) ** 2) / (2 * sx * sx) - ((y - cy) ** 2) / (2 * sy * sy));
  return Math.max(g(u, v, 0, 0.1, 0.05, 0.11), g(u, v, -0.2, 0.15, 0.1, 0.06), g(u, v, 0.2, 0.15, 0.1, 0.06),
    0.5 * g(u, v, 0, -0.1, 0.12, 0.05));
}

function addFreckles(img, ctx, k) {
  const { w, h } = img, faces = getAnalysis(ctx).faces, dark = I.plane(w, h);
  faces.forEach((f, fi) => {
    const p = facePx(f, w, h), fw = faceWidth(f, w, h);
    const eR = T.RIGHT_EYE.reduce((a, i) => [a[0] + p[i][0] / 16, a[1] + p[i][1] / 16], [0, 0]);
    const eL = T.LEFT_EYE.reduce((a, i) => [a[0] + p[i][0] / 16, a[1] + p[i][1] / 16], [0, 0]);
    let u = [eL[0] - eR[0], eL[1] - eR[1]];
    const ul = Math.hypot(u[0], u[1]) || 1;
    u = [u[0] / ul, u[1] / ul];
    const v = [-u[1], u[0]], o = p[6]; // the nose bridge between the eyes
    const rand = rng(9157 + fi * 101);
    const n = Math.round(MAX_FRECKLES * k);
    for (let placed = 0, tries = 0; placed < n && tries < n * 30; tries++) {
      const a = (rand() - 0.5) * 0.7, b = rand() * 0.45 - 0.15;
      if (rand() > density(a, b)) continue;
      placed++;
      const cx = o[0] + (a * u[0] + b * v[0]) * fw, cy = o[1] + (a * u[1] + b * v[1]) * fw;
      const r = fw * (0.0025 + 0.004 * rand() ** 1.6), depth = 0.45 + 0.55 * rand();
      // a freckle is rarely a perfect disc: two overlapping blobs
      const blobs = [[cx, cy, r], [cx + (rand() - 0.5) * r, cy + (rand() - 0.5) * r, r * (0.6 + 0.4 * rand())]];
      for (const [bx, by, br] of blobs) {
        const R = Math.ceil(br * 2.2);
        for (let y = Math.max(0, Math.floor(by - R)); y < Math.min(h, by + R); y++)
          for (let x = Math.max(0, Math.floor(bx - R)); x < Math.min(w, bx + R); x++) {
            const d2 = ((x - bx) ** 2 + (y - by) ** 2) / (br * br), val = depth * Math.exp(-d2 * 1.4);
            const i = y * w + x;
            if (val > dark.data[i]) dark.data[i] = val;
          }
      }
    }
  });
  const skin = getMask(img, ctx, "face_skin");
  for (let i = 0; i < dark.data.length; i++) dark.data[i] *= skin.data[i];
  if (!I.bbox(dark, 0)) return img;
  const fw = refFaceWidth(img, ctx), amount = 0.55 + 0.45 * k;
  return labEdit(img, dark, fw, (lab, m) => {
    for (let i = 0; i < m.data.length; i++) {
      const d = m.data[i] * amount, j = 3 * i;
      if (d <= 0) continue;
      lab.data[j] -= d * 11;
      lab.data[j + 1] += d * 2;
      lab.data[j + 2] += d * 6;
    }
  });
}

function removeFreckles(img, ctx, k) {
  const fw = refFaceWidth(img, ctx), skin = getMask(img, ctx, "face_skin");
  if (!I.bbox(skin, 0)) return img;
  return labEdit(img, skin, fw, (lab, m) => {
    const L = chan(lab, 0), A = chan(lab, 1), B = chan(lab, 2);
    const fine = I.gaussian(L, Math.max(0.6, fw * 0.002)); // without the pores
    const local = I.gaussian(L, Math.max(1, fw * 0.015)), la = I.gaussian(A, fw * 0.015), lb = I.gaussian(B, fw * 0.015);
    for (let i = 0; i < m.data.length; i++) {
      const det = local.data[i] - fine.data[i]; // > 0: a spot darker than the skin around
      const brown = clip((B.data[i] - lb.data[i] + 1.5) / 3);
      const w = m.data[i] * k * clip((det - 1.2) / 3.5) * brown;
      if (w <= 0) continue;
      const j = 3 * i;
      lab.data[j] += w * det * 0.95;
      lab.data[j + 1] += w * (la.data[i] - A.data[i]) * 0.8;
      lab.data[j + 2] += w * (lb.data[i] - B.data[i]) * 0.9;
    }
  });
}

register("freckles", "Веснушки", [P("amount", "Веснушки", -100, 100, 0)], (img, p, ctx) => {
  if (!getAnalysis(ctx).faces.length) return img;
  return p.amount > 0 ? addFreckles(img, ctx, p.amount / 100) : removeFreckles(img, ctx, -p.amount / 100);
}, { category: FACE_TAB, active: (p) => p.amount !== 0 });
