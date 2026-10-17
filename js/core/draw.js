// Drawing soft masks (anti-aliased polygons, circles, lines, ellipses) with OffscreenCanvas —
// what cv2.fillPoly / circle / line / ellipse(LINE_AA) do on the desktop — plus morphology and
// a median filter on planes.
import { fimg } from "./img.js";

export class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
    this.g = this.c.getContext("2d", { willReadFrequently: true });
    this.g.fillStyle = this.g.strokeStyle = "#fff";
    this.g.lineCap = this.g.lineJoin = "round";
  }

  _mode(value) {
    this.g.globalCompositeOperation = value > 0 ? "source-over" : "destination-out";
    this.g.globalAlpha = value > 0 ? value : 1;
  }

  poly(pts, value = 1) { // pts: [[x, y], ...]
    if (pts.length < 3) return this;
    this._mode(value);
    const g = this.g;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fill();
    return this;
  }

  circle(c, r, value = 1) {
    this._mode(value);
    this.g.beginPath();
    this.g.arc(c[0], c[1], Math.max(0.5, r), 0, 2 * Math.PI);
    this.g.fill();
    return this;
  }

  ellipse(c, ax, ay, angleDeg, value = 1) {
    this._mode(value);
    this.g.beginPath();
    this.g.ellipse(c[0], c[1], Math.max(0.5, ax), Math.max(0.5, ay), (angleDeg * Math.PI) / 180, 0, 2 * Math.PI);
    this.g.fill();
    return this;
  }

  polyline(pts, width, value = 1, closed = false) {
    if (pts.length < 2) return this;
    this._mode(value);
    const g = this.g;
    g.lineWidth = Math.max(1, width);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    if (closed) g.closePath();
    g.stroke();
    return this;
  }

  line(a, b, width, value = 1) {
    return this.polyline([a, b], width, value);
  }

  plane() { // alpha as a 0..1 plane
    const d = this.g.getImageData(0, 0, this.w, this.h).data, out = fimg(this.w, this.h, 1);
    for (let i = 0; i < this.w * this.h; i++) out.data[i] = d[i * 4 + 3] / 255;
    return out;
  }
}

// --- morphology (square windows: close enough to the desktop's ellipses for soft masks) -------

function runExtreme(src, dst, w, h, r, isMax, horizontal) {
  const n = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 1 : w, lineStep = horizontal ? w : 1;
  const buf = new Float32Array(n);
  for (let l = 0; l < lines; l++) {
    const o = l * lineStep;
    for (let i = 0; i < n; i++) buf[i] = src[o + i * step];
    for (let i = 0; i < n; i++) {
      let v = buf[i];
      const a = Math.max(0, i - r), b = Math.min(n - 1, i + r);
      for (let j = a; j <= b; j++) v = isMax ? Math.max(v, buf[j]) : Math.min(v, buf[j]);
      dst[o + i * step] = v;
    }
  }
}

function extreme(p, r, isMax) {
  r = Math.round(r);
  if (r < 1) return p;
  const tmp = new Float32Array(p.data.length), out = new Float32Array(p.data.length);
  runExtreme(p.data, tmp, p.w, p.h, r, isMax, true);
  runExtreme(tmp, out, p.w, p.h, r, isMax, false);
  return fimg(p.w, p.h, 1, out);
}

export const dilate = (p, r) => extreme(p, r, true);
export const erode = (p, r) => extreme(p, r, false);

// Median of a 0..255 plane over a (2r+1)^2 window (Huang's sliding histogram).
export function median255(p, r) {
  const { w, h } = p, src = new Uint8Array(w * h), out = fimg(w, h, 1);
  for (let i = 0; i < w * h; i++) src[i] = Math.max(0, Math.min(255, Math.round(p.data[i])));
  const hist = new Int32Array(256);
  for (let y = 0; y < h; y++) {
    hist.fill(0);
    const ys = Math.max(0, y - r), ye = Math.min(h - 1, y + r);
    let count = 0;
    const add = (x, s) => {
      if (x < 0 || x >= w) return;
      for (let yy = ys; yy <= ye; yy++) hist[src[yy * w + x]] += s;
      count += s * (ye - ys + 1);
    };
    for (let x = -r; x <= r; x++) add(x, 1);
    for (let x = 0; x < w; x++) {
      const half = count >> 1;
      let acc = 0, m = 0;
      for (; m < 256; m++) {
        acc += hist[m];
        if (acc > half) break;
      }
      out.data[y * w + x] = m;
      add(x - r, -1);
      add(x + r + 1, 1);
    }
  }
  return out;
}

// Connected components of plane > thr: {labels: Int32Array, stats: [{x0, y0, x1, y1, area}]}
export function components(p, thr = 0.5) {
  const { w, h } = p, labels = new Int32Array(w * h), stats = [null], stack = [];
  for (let s = 0; s < w * h; s++) {
    if (labels[s] || !(p.data[s] > thr)) continue;
    const id = stats.length;
    const st = { x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    labels[s] = id;
    stack.push(s);
    while (stack.length) {
      const q = stack.pop(), x = q % w, y = (q - x) / w;
      st.area++;
      if (x < st.x0) st.x0 = x; if (x > st.x1) st.x1 = x;
      if (y < st.y0) st.y0 = y; if (y > st.y1) st.y1 = y;
      if (x > 0 && !labels[q - 1] && p.data[q - 1] > thr) { labels[q - 1] = id; stack.push(q - 1); }
      if (x < w - 1 && !labels[q + 1] && p.data[q + 1] > thr) { labels[q + 1] = id; stack.push(q + 1); }
      if (y > 0 && !labels[q - w] && p.data[q - w] > thr) { labels[q - w] = id; stack.push(q - w); }
      if (y < h - 1 && !labels[q + w] && p.data[q + w] > thr) { labels[q + w] = id; stack.push(q + w); }
    }
    stats.push(st);
  }
  return { labels, stats };
}

// Exact Euclidean distance (px) from every pixel to the nearest pixel where `isZero` is true
// (Felzenszwalb & Huttenlocher, separable, O(n)) — what cv2.distanceTransform gives.
export function distance(p, isZero) {
  const { w, h } = p, INF = 1e20, f = new Float64Array(Math.max(w, h)), d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = isZero(p.data[i]) ? 0 : INF;
  const edt1d = (n) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  const out = fimg(w, h, 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(w);
    for (let x = 0; x < w; x++) out.data[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}
