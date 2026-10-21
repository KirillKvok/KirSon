// Smooth image deformation from local primitives — port of kirson/core/warp.py.
//   push(q, d, sigma)          content around q moves by d (Gaussian falloff)
//   scale(c, k, R, axis=null)  content within R of c grows by (1+k) at the centre
// Evaluated on a coarse grid inside the region where it is not ~0, inverted by fixed-point
// iteration, gain lowered automatically so the map never folds; applied with bilinear remap.
import { resizeLinear, fimg } from "./img.js";

// the grid is relative to the region (not pixels): the same warp — and the same fold guard — on the
// preview and the full-size export (a 4 px minimum made the guard weaken faces differently by size)
const FIELD_CELLS = 300, MIN_AREA = 0.35;

export class Field {
  constructor() {
    this.pushes = [];
    this.scales = [];
    this.fades = [];
    this.gain = 1;
  }

  // the deformation made so far (every push / scale added before this call) fades back towards the
  // original along the path `pts` (px): fully within 0.4·r of it, not at all from r, by `k` (0..1)
  fade(pts, r, k) {
    if (!(k > 0) || r < 1 || !pts.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r);
      x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
    }
    this.fades.push({ np: this.pushes.length, ns: this.scales.length, pts, r, k: Math.min(1, k), box: [x0, y0, x1, y1] });
  }

  // 0..1: how much of the earlier deformation one fade takes away at (x, y)
  static _fadeAt(f, x, y) {
    const [x0, y0, x1, y1] = f.box;
    if (x < x0 || y < y0 || x > x1 || y > y1) return 0;
    let d2 = Infinity;
    const p = f.pts;
    if (p.length === 1) d2 = (x - p[0][0]) ** 2 + (y - p[0][1]) ** 2;
    for (let i = 0; i + 1 < p.length; i++) { // distance to the path, segment by segment
      const [ax, ay] = p[i], [bx, by] = p[i + 1], vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
      d2 = Math.min(d2, (x - ax - t * vx) ** 2 + (y - ay - t * vy) ** 2);
    }
    let t = (f.r - Math.sqrt(d2)) / (0.6 * f.r);
    if (t <= 0) return 0;
    if (t > 1) t = 1;
    return f.k * t * t * (3 - 2 * t);
  }

  push(q, d, sigma) {
    if (Math.hypot(d[0], d[1]) > 1e-3) this.pushes.push([q[0], q[1], d[0], d[1], sigma]);
  }

  scale(c, k, radius, axis = null) {
    if (Math.abs(k) <= 1e-4) return;
    let ax = null;
    if (axis) {
      const n = Math.hypot(axis[0], axis[1]);
      ax = [axis[0] / n, axis[1] / n];
    }
    this.scales.push([c[0], c[1], k, radius, ax]);
  }

  get empty() {
    return !this.pushes.length && !this.scales.length;
  }

  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [qx, qy, , , s] of this.pushes) {
      x0 = Math.min(x0, qx - 3.5 * s); y0 = Math.min(y0, qy - 3.5 * s);
      x1 = Math.max(x1, qx + 3.5 * s); y1 = Math.max(y1, qy + 3.5 * s);
    }
    for (const [cx, cy, , R] of this.scales) {
      x0 = Math.min(x0, cx - 1.2 * R); y0 = Math.min(y0, cy - 1.2 * R);
      x1 = Math.max(x1, cx + 1.2 * R); y1 = Math.max(y1, cy + 1.2 * R);
    }
    return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
  }

  // forward displacement at (x, y) -> [dx, dy] (times gain)
  at(x, y, gain = this.gain) {
    // fades: a primitive is weakened by every fade added after it (the product of what they leave)
    const nf = this.fades.length;
    let keep = null;
    if (nf) {
      keep = new Float64Array(nf + 1);
      keep[nf] = 1;
      for (let j = nf - 1; j >= 0; j--) keep[j] = keep[j + 1] * (1 - Field._fadeAt(this.fades[j], x, y));
    }
    let Dx = 0, Dy = 0, j = 0, factor = keep ? keep[0] : 1;
    for (let i = 0; i < this.pushes.length; i++) {
      if (keep) {
        while (j < nf && this.fades[j].np <= i) j++;
        factor = keep[j];
        if (factor <= 0) continue;
      }
      const [qx, qy, dx, dy, s] = this.pushes[i];
      const r2 = (x - qx) ** 2 + (y - qy) ** 2;
      if (r2 > 12.25 * s * s) continue; // beyond 3.5 sigma (the bounds): < 0.22 %
      const w = Math.exp(-r2 / (2 * s * s)) * factor;
      Dx += dx * w;
      Dy += dy * w;
    }
    j = 0;
    for (let i = 0; i < this.scales.length; i++) {
      if (keep) {
        while (j < nf && this.fades[j].ns <= i) j++;
        factor = keep[j];
        if (factor <= 0) continue;
      }
      const [cx, cy, k, R, ax] = this.scales[i];
      const dx = x - cx, dy = y - cy;
      let t = 1 - (dx * dx + dy * dy) / (R * R);
      if (t <= 0) continue;
      t *= t * factor;
      if (!ax) {
        Dx += k * t * dx;
        Dy += k * t * dy;
      } else {
        const along = (dx * ax[0] + dy * ax[1]) * k * t;
        Dx += along * ax[0];
        Dy += along * ax[1];
      }
    }
    return [Dx * gain, Dy * gain];
  }

  // the fold guard's gain for an image of w x h on a coarser grid (the deformation grid drawn over the
  // photo: the same picture as the render, cheaply)
  gainFor(w, h, cells = 60) {
    if (this.empty) return 0;
    const [bx0, by0, bx1, by1] = this.bounds();
    const x0 = Math.max(bx0, 0), y0 = Math.max(by0, 0), x1 = Math.min(bx1, w), y1 = Math.min(by1, h);
    if (x1 <= x0 || y1 <= y0) return 0;
    const n = Math.max(2, Math.round((cells * Math.max(x1 - x0, y1 - y0)) / Math.max(w, h)));
    const gx = Float32Array.from({ length: n }, (_, i) => x0 + ((x1 - 1 - x0) * i) / (n - 1));
    const gy = Float32Array.from({ length: n }, (_, i) => y0 + ((y1 - 1 - y0) * i) / (n - 1));
    return (this.gain = this._safeGain(gx, gy));
  }

  // largest gain <= 1 keeping det(Jacobian) >= MIN_AREA everywhere on the grid
  _safeGain(gx, gy) {
    const gw = gx.length, gh = gy.length;
    const Dx = new Float32Array(gw * gh), Dy = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const d = this.at(gx[i], gy[j], 1);
      Dx[j * gw + i] = d[0];
      Dy[j * gw + i] = d[1];
    }
    const grad = (D, i, j, axis) => {
      if (axis === 0) {
        const a = Math.max(0, i - 1), b = Math.min(gw - 1, i + 1);
        return b === a ? 0 : (D[j * gw + b] - D[j * gw + a]) / (gx[b] - gx[a]);
      }
      const a = Math.max(0, j - 1), b = Math.min(gh - 1, j + 1);
      return b === a ? 0 : (D[b * gw + i] - D[a * gw + i]) / (gy[b] - gy[a]);
    };
    const J = [];
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++)
      J.push([grad(Dx, i, j, 0), grad(Dy, i, j, 1), grad(Dx, i, j, 1), grad(Dy, i, j, 0)]);
    for (const alpha of [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2, 0.1]) {
      let ok = true;
      for (const [uxx, uyy, uxy, uyx] of J) {
        if ((1 + alpha * uxx) * (1 + alpha * uyy) - alpha * alpha * uxy * uyx < MIN_AREA) { ok = false; break; }
      }
      if (ok) return alpha;
    }
    return 0;
  }

  // backward maps for an image of w x h (null if nothing moves)
  compute(w, h, iterations = 3) {
    if (this.empty) return null;
    const [bx0, by0, bx1, by1] = this.bounds();
    const x0 = Math.max(bx0, 0), y0 = Math.max(by0, 0), x1 = Math.min(bx1, w), y1 = Math.min(by1, h);
    if (x1 <= x0 || y1 <= y0) return null;
    const rw = x1 - x0, rh = y1 - y0;
    const step = Math.max(0.5, Math.max(rw, rh) / FIELD_CELLS);
    const gw = Math.ceil(rw / step) + 1, gh = Math.ceil(rh / step) + 1;
    const gx = Float32Array.from({ length: gw }, (_, i) => x0 + ((x1 - 1 - x0) * i) / Math.max(1, gw - 1));
    const gy = Float32Array.from({ length: gh }, (_, j) => y0 + ((y1 - 1 - y0) * j) / Math.max(1, gh - 1));
    this.gain = this._safeGain(gx, gy);
    if (this.gain === 0) return null;
    const sx = fimg(gw, gh, 1), sy = fimg(gw, gh, 1);
    const ramp = (n) => Float32Array.from({ length: n }, (_, i) => {
      let t = Math.min(i, n - 1 - i) / Math.max(0.08 * n, 1);
      t = Math.min(1, Math.max(0, t));
      return t * t * (3 - 2 * t);
    });
    const rx = ramp(gw), ry = ramp(gh);
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        const px = gx[i], py = gy[j];
        let x = px, y = py;
        for (let it = 0; it < iterations; it++) {
          const d = this.at(x, y);
          x = px - d[0];
          y = py - d[1];
        }
        const taper = rx[i] * ry[j]; // exactly zero at the region border
        sx.data[j * gw + i] = px + (x - px) * taper;
        sy.data[j * gw + i] = py + (y - py) * taper;
      }
    return new Warp(x0, y0, resizeLinear(sx, rw, rh), resizeLinear(sy, rw, rh));
  }

  apply(img) {
    const wp = this.compute(img.w, img.h);
    return wp ? wp.apply(img) : img;
  }
}

// Backward maps for the region at (x0, y0): output pixel shows the source (mapX, mapY).
export class Warp {
  constructor(x0, y0, mapX, mapY) {
    this.x0 = x0;
    this.y0 = y0;
    this.mapX = mapX; // planes, region size
    this.mapY = mapY;
  }

  // uint8 RGB image {w, h, data} or float image {w, h, c, data}
  apply(img) {
    const c = img.c || 3, { w, h } = img, src = img.data;
    const out = img.c ? fimg(w, h, c, src.slice()) : { w, h, data: new Uint8ClampedArray(src) };
    const rw = this.mapX.w, rh = this.mapX.h, d = out.data;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const k = y * rw + x;
        let fx = this.mapX.data[k], fy = this.mapY.data[k];
        fx = fx < 0 ? 0 : fx > w - 1 ? w - 1 : fx;
        fy = fy < 0 ? 0 : fy > h - 1 ? h - 1 : fy;
        const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const ix1 = Math.min(w - 1, ix + 1), iy1 = Math.min(h - 1, iy + 1);
        const a = (iy * w + ix) * c, b = (iy * w + ix1) * c, e = (iy1 * w + ix) * c, f = (iy1 * w + ix1) * c;
        const o = ((this.y0 + y) * w + this.x0 + x) * c;
        for (let ch = 0; ch < c; ch++) {
          const top = src[a + ch] + (src[b + ch] - src[a + ch]) * tx;
          const bot = src[e + ch] + (src[f + ch] - src[e + ch]) * tx;
          d[o + ch] = top + (bot - top) * ty;
        }
      }
    }
    return out;
  }

  // how far each output pixel's source is from itself (plane, image size)
  moved(w, h) {
    const m = fimg(w, h, 1);
    for (let y = 0; y < this.mapX.h; y++)
      for (let x = 0; x < this.mapX.w; x++) {
        const k = y * this.mapX.w + x;
        m.data[(this.y0 + y) * w + this.x0 + x] = Math.hypot(this.mapX.data[k] - (this.x0 + x), this.mapY.data[k] - (this.y0 + y));
      }
    return m;
  }

  // same warp, displacement scaled by falloff (plane, image size)
  attenuated(falloff) {
    const mx = fimg(this.mapX.w, this.mapX.h, 1), my = fimg(this.mapX.w, this.mapX.h, 1);
    for (let y = 0; y < this.mapX.h; y++)
      for (let x = 0; x < this.mapX.w; x++) {
        const k = y * this.mapX.w + x, f = falloff.data[(this.y0 + y) * falloff.w + this.x0 + x];
        mx.data[k] = this.x0 + x + (this.mapX.data[k] - (this.x0 + x)) * f;
        my.data[k] = this.y0 + y + (this.mapY.data[k] - (this.y0 + y)) * f;
      }
    return new Warp(this.x0, this.y0, mx, my);
  }
}
