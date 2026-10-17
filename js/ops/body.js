// Body shape (waist, hips, legs, arms, longer legs, shoulders, neck) without bending the
// background — port of kirson/core/ops/body.py. The person is its own layer: the background gets
// the same warp fading out with the distance from the silhouette (exactly 0 from 3 bands on).
import { register, P } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { distance } from "../core/draw.js";
import { Field, Warp } from "../core/warp.js";
import { getAnalysis, getMask } from "../face/masks.js";

export const BODY_TAB = "Фигура";
const NOSE = 0, L_EAR = 7, R_EAR = 8, MOUTH_L = 9, MOUTH_R = 10;
const L_SH = 11, R_SH = 12, L_EL = 13, R_EL = 14, L_WR = 15, R_WR = 16;
const L_HIP = 23, R_HIP = 24, L_KNEE = 25, R_KNEE = 26, L_ANK = 27, R_ANK = 28;
const FEET = [27, 28, 29, 30, 31, 32];
const WAIST_MAX = 0.08, HIPS_MAX = 0.08, LEGS_MAX = 0.14, ARMS_MAX = 0.16, LENGTH_MAX = 0.1;
const SHOULDERS_MAX = 0.06, NECK_MAX = 0.07, MIN_VIS = 0.5, BG_BAND = 0.015;

const unit = (v) => { const n = Math.hypot(v[0], v[1]); return n > 1e-6 ? [v[0] / n, v[1] / n] : v; };
const perp = (v) => [-v[1], v[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];

// distance along `dir` from `start` to the first pixel outside the person (or inside `block`)
function rayEdge(mask, start, dir, maxDist, block = null) {
  const n = Math.floor(maxDist);
  if (n < 2) return null;
  const { w, h } = mask;
  for (let t = 0; t < n; t++) {
    const x = Math.min(w - 1, Math.max(0, Math.round(start[0] + dir[0] * t)));
    const y = Math.min(h - 1, Math.max(0, Math.round(start[1] + dir[1] * t)));
    let inside = mask.data[y * w + x] > 0.5;
    if (block && block[y * w + x]) inside = false;
    if (t === 0 && !inside) return null;
    if (!inside) return t;
  }
  return null;
}

class Body {
  constructor(pts, vis, mask) {
    this.p = pts;
    this.vis = vis;
    this.mask = mask;
  }
  ok(...idx) { return idx.every((i) => this.vis[i] >= MIN_VIS); }
  get sw() { return Math.hypot(this.p[L_SH][0] - this.p[R_SH][0], this.p[L_SH][1] - this.p[R_SH][1]); }
  torso() {
    const s = [(this.p[L_SH][0] + this.p[R_SH][0]) / 2, (this.p[L_SH][1] + this.p[R_SH][1]) / 2];
    const hp = [(this.p[L_HIP][0] + this.p[R_HIP][0]) / 2, (this.p[L_HIP][1] + this.p[R_HIP][1]) / 2];
    return { s, hp, t: unit([hp[0] - s[0], hp[1] - s[1]]), tl: Math.hypot(hp[0] - s[0], hp[1] - s[1]) };
  }
  armsMask() { // capsules along the arms: a torso edge stops at an arm lying against it
    const { w, h } = this.mask, c = new OffscreenCanvas(w, h), g = c.getContext("2d");
    g.strokeStyle = "#fff";
    g.lineCap = "round";
    g.lineWidth = Math.max(2, 0.2 * this.sw);
    for (const [a, b] of [[L_EL, L_WR], [R_EL, R_WR], [L_SH, L_EL], [R_SH, R_EL]]) {
      if (!this.ok(a, b)) continue;
      let pa = this.p[a];
      const pb = this.p[b];
      if (a === L_SH || a === R_SH) pa = add(pa, [pb[0] - pa[0], pb[1] - pa[1]], 0.35);
      g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke();
    }
    const d = g.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    return out;
  }
  sidePushes(field, center, axis, amount, sigma, maxDist, block = null) {
    const n = perp(axis);
    for (const s of [-1, 1]) {
      const dir = [s * n[0], s * n[1]], d = rayEdge(this.mask, center, dir, maxDist, block);
      if (d !== null) field.push(add(center, dir, d), [-dir[0] * amount, -dir[1] * amount], sigma);
    }
  }
  limbPushes(field, chain, strength, maxHalf, sigmaFrac, midFrom = null) {
    const pts = chain.map((k) => this.p[k]);
    let length = 0;
    for (let i = 0; i < pts.length - 1; i++) length += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const sigma = sigmaFrac * length;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], axis = unit([b[0] - a[0], b[1] - a[1]]), n = perp(axis);
      for (const t of [0.15, 0.4, 0.65, 0.9]) {
        const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        for (const s of [-1, 1]) {
          const dir = [s * n[0], s * n[1]], d = rayEdge(this.mask, c, dir, maxHalf);
          if (d === null || d < 2) continue;
          if (midFrom) { // the inner edge only with a gap between the legs
            const toMid = (midFrom[0] - c[0]) * dir[0] + (midFrom[1] - c[1]) * dir[1] > 0;
            if (toMid && d > 0.5 * Math.abs((midFrom[0] - c[0]) * n[0] + (midFrom[1] - c[1]) * n[1])) continue;
          }
          field.push(add(c, dir, d), [-dir[0] * d * strength, -dir[1] * d * strength], sigma);
        }
      }
    }
  }
}

function stretchLegs(w, h, hipY, footY, k) {
  const leg = footY - hipY;
  if (leg < 10) return null;
  k = Math.min(k, (h - 2 - footY) / leg);
  if (k <= 0.002) return null;
  const y0 = Math.max(0, Math.floor(hipY - 0.1 * leg)), n = h - y0;
  const fwd = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    let r = Math.min(1, Math.max(0, (y0 + i - 1 - (hipY - 0.1 * leg)) / (0.2 * leg)));
    r = r * r * (3 - 2 * r);
    fwd[i] = fwd[i - 1] + 1 + k * r;
  }
  for (let i = 0; i < n; i++) fwd[i] += y0;
  const mapX = I.fimg(w, n, 1), mapY = I.fimg(w, n, 1);
  let j = 0;
  for (let i = 0; i < n; i++) { // inverse: output row -> source row
    const y = y0 + i;
    while (j < n - 2 && fwd[j + 1] < y) j++;
    const src = fwd[j + 1] === fwd[j] ? y0 + j : y0 + j + (y - fwd[j]) / (fwd[j + 1] - fwd[j]);
    for (let x = 0; x < w; x++) { mapX.data[i * w + x] = x; mapY.data[i * w + x] = Math.min(h - 1, src); }
  }
  return new Warp(0, y0, mapX, mapY);
}

function liftHead(w, h, b, shoulders, d) {
  const nose = b.p[NOSE], mouth = [(b.p[MOUTH_L][0] + b.p[MOUTH_R][0]) / 2, (b.p[MOUTH_L][1] + b.p[MOUTH_R][1]) / 2];
  const chinY = mouth[1] + 1.1 * (mouth[1] - nose[1]), shY = shoulders[1];
  if (shY - chinY < 4 || d < 0.5) return null;
  const sw = b.sw, cx = nose[0];
  const x0 = Math.max(0, Math.floor(cx - 1.2 * sw)), x1 = Math.min(w, Math.ceil(cx + 1.2 * sw)), y1 = Math.min(h, Math.floor(shY));
  if (x1 - x0 < 4 || y1 < 4) return null;
  const rw = x1 - x0, mapX = I.fimg(rw, y1, 1), mapY = I.fimg(rw, y1, 1);
  for (let y = 0; y < y1; y++) {
    let r = Math.min(1, Math.max(0, (shY - y) / (shY - chinY)));
    r = r * r * (3 - 2 * r);
    for (let x = 0; x < rw; x++) {
      let a = Math.min(1, Math.max(0, (1.2 * sw - Math.abs(x0 + x - cx)) / (0.6 * sw)));
      a = a * a * (3 - 2 * a);
      mapX.data[y * rw + x] = x0 + x;
      mapY.data[y * rw + x] = y + d * r * a;
    }
  }
  return new Warp(x0, 0, mapX, mapY);
}

const ACTIVE = ["waist", "hips", "legs", "arms", "length", "shoulders", "neck"];

register("body", "Фигура", [P("waist", "Талия уже", -100, 100, 0), P("hips", "Бёдра уже", -100, 100, 0),
  P("legs", "Ноги стройнее", -100, 100, 0), P("arms", "Руки стройнее", -100, 100, 0),
  P("length", "Ноги длиннее", 0, 100, 0), P("shoulders", "Плечи уже", -100, 100, 0), P("neck", "Шея длиннее", 0, 100, 0)],
  (img, p, ctx) => {
    const { w, h } = img, a = getAnalysis(ctx);
    if (!a.poses.length) return img;
    const person = getMask(img, ctx, "person");
    const warps = [];
    for (const pose of a.poses) {
      const pts = [];
      for (let i = 0; i < pose.pts.length / 2; i++) pts.push([pose.pts[2 * i] * w, pose.pts[2 * i + 1] * h]);
      const b = new Body(pts, pose.vis, person);
      if (!b.ok(L_SH, R_SH, L_HIP, R_HIP)) continue;
      const sw = b.sw, { s, hp, t, tl } = b.torso(), field = new Field();
      const arms = p.waist || p.hips ? b.armsMask() : null;
      if (p.waist) b.sidePushes(field, add(s, t, 0.68 * tl), t, (p.waist / 100) * WAIST_MAX * sw, 0.16 * tl, 0.8 * sw, arms);
      if (p.hips) b.sidePushes(field, add(hp, t, 0.08 * tl), t, (p.hips / 100) * HIPS_MAX * sw, 0.16 * tl, 0.9 * sw, arms);
      if (p.shoulders) b.sidePushes(field, add(s, t, 0.1 * tl), t, (p.shoulders / 100) * SHOULDERS_MAX * sw, 0.2 * tl, 0.9 * sw);
      if (p.legs) for (const chain of [[L_HIP, L_KNEE, L_ANK], [R_HIP, R_KNEE, R_ANK]])
        if (b.ok(...chain)) b.limbPushes(field, chain, (p.legs / 100) * LEGS_MAX, 0.45 * sw, 0.12, hp);
      if (p.arms) for (const chain of [[L_SH, L_EL, L_WR], [R_SH, R_EL, R_WR]])
        if (b.ok(...chain)) b.limbPushes(field, chain, (p.arms / 100) * ARMS_MAX, 0.22 * sw, 0.1);
      const wp = field.compute(w, h);
      if (wp) warps.push([wp, true]);
      if (p.neck > 0 && b.ok(NOSE, MOUTH_L, MOUTH_R)) {
        const lift = liftHead(w, h, b, s, (p.neck / 100) * NECK_MAX * sw);
        if (lift) warps.push([lift, true]);
      }
      if (p.length > 0 && b.ok(L_HIP, R_HIP, L_ANK, R_ANK)) {
        const footY = Math.max(...FEET.filter((i) => b.vis[i] >= 0.3 || i === L_ANK || i === R_ANK).map((i) => b.p[i][1]));
        const st = stretchLegs(w, h, hp[1], footY, (p.length / 100) * LENGTH_MAX);
        if (st) warps.push([st, false]); // longer legs only cover more floor: background stays
      }
    }
    if (!warps.length) return img;
    const dist = distance(person, (v) => v >= 0.5);
    let layer = img, alpha = person, bg = img;
    const moved = I.plane(w, h);
    for (const [wp, bendBg] of warps) {
      layer = wp.apply(layer);
      alpha = wp.apply(alpha);
      const mv = wp.moved(w, h);
      let mvMax = 0;
      for (let i = 0; i < mv.data.length; i++) { moved.data[i] = Math.max(moved.data[i], mv.data[i]); mvMax = Math.max(mvMax, mv.data[i]); }
      if (bendBg) {
        const band = Math.max(BG_BAND * Math.max(w, h), 3 * mvMax);
        const fall = I.mapPlane(dist, (d) => { const t = Math.min(1, d / (3 * band)); return (1 - t) * (1 - t) * (1 + 2 * t); });
        bg = wp.attenuated(fall).apply(bg);
      }
    }
    const r = I.mapPlane(I.gaussian(moved, 3), (v) => Math.min(1, v / 0.5));
    const out = new Uint8ClampedArray(img.data.length);
    for (let i = 0; i < w * h; i++) {
      const al = alpha.data[i], k = r.data[i];
      for (let c = 0; c < 3; c++) {
        const j = 3 * i + c, comp = layer.data[j] * al + bg.data[j] * (1 - al);
        out[j] = img.data[j] * (1 - k) + comp * k + 0.5;
      }
    }
    const res = { w, h, data: out };
    ctx.cache.set(`person_after_body:${w}x${h}`, [res, alpha]); // background uses the moved silhouette
    return res;
  }, { category: BODY_TAB, active: (p) => ACTIVE.some((k) => p[k]) });

export function personMaskFor(img, ctx) {
  const entry = ctx.cache.get(`person_after_body:${img.w}x${img.h}`);
  if (entry && entry[0] === img) return entry[1];
  return getMask(img, ctx, "person");
}
