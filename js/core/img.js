// Image core for the web version: what kirson/core/color.py and the OpenCV calls do on the
// desktop, in plain JS on typed arrays (fast in Safari / Chrome JITs, no 10 MB OpenCV.js).
//
// Images:  {w, h, data: Uint8ClampedArray}  RGB, 3 bytes per pixel (between operations)
// Float:   {w, h, c, data: Float32Array}    interleaved, 0..1 (inside operations)
// Planes:  {w, h, c: 1, data: Float32Array} single channel
// Channel order is RGB (the desktop code is BGR: colour tuples are reordered when ported).

import * as par from "./par.js";

export const LUMA = [0.2126, 0.7152, 0.0722]; // Rec.709, RGB order

export function fimg(w, h, c = 1, data = null) {
  return { w, h, c, data: data || new Float32Array(w * h * c) };
}

export function clone(f) {
  return { w: f.w, h: f.h, c: f.c, data: f.data.slice() };
}

export function toFloat(img) {
  const n = img.w * img.h * 3, out = new Float32Array(n), d = img.data;
  for (let i = 0; i < n; i++) out[i] = d[i] * (1 / 255);
  return { w: img.w, h: img.h, c: 3, data: out };
}

export function toU8(f) {
  const n = f.w * f.h * 3, out = new Uint8ClampedArray(n), d = f.data;
  for (let i = 0; i < n; i++) out[i] = d[i] * 255 + 0.5; // clamped array saturates
  return { w: f.w, h: f.h, data: out };
}

export function luminance(f) {
  const n = f.w * f.h, out = new Float32Array(n), d = f.data;
  for (let i = 0, j = 0; i < n; i++, j += 3) out[i] = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
  return fimg(f.w, f.h, 1, out);
}

export function clamp01(f) {
  const d = f.data;
  for (let i = 0; i < d.length; i++) d[i] = d[i] < 0 ? 0 : d[i] > 1 ? 1 : d[i];
  return f;
}

// --- blurs ------------------------------------------------------------------------------

// Separable passes (core/kernels.js), shared out between processor cores when possible (par.js).
const pass = (kind, src, dst, w, h, c, r, k = null) => par.rows(kind, { src, dst, w, h, c, r, k }, h);

// Box filter of size (2r+1)^2, like cv2.boxFilter (normalised).
export function boxBlur(f, r) {
  r = Math.max(0, Math.round(r));
  if (r === 0) return clone(f);
  const tmp = par.shared(f.data.length), out = par.shared(f.data.length);
  pass("boxH", par.sharedCopy(f.data), tmp, f.w, f.h, f.c, r);
  pass("boxV", tmp, out, f.w, f.h, f.c, r);
  return fimg(f.w, f.h, f.c, out);
}

function gaussKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return { k, r };
}

// Box sizes whose triple pass approximates a Gaussian of `sigma` (Kovesi).
function boxesForGauss(sigma, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const out = [];
  for (let i = 0; i < n; i++) out.push(((i < m ? wl : wu) - 1) / 2);
  return out;
}

// Gaussian blur, like cv2.GaussianBlur(f, (0, 0), sigma). Small sigma: exact separable
// kernel; large sigma: three box passes (same look, cost independent of sigma).
export function gaussian(f, sigma) {
  if (!(sigma > 0.2)) return clone(f);
  const { w, h, c } = f;
  if (sigma <= 3) {
    const { k, r } = gaussKernel(sigma);
    const tmp = par.shared(f.data.length), out = par.shared(f.data.length);
    pass("convH", par.sharedCopy(f.data), tmp, w, h, c, r, k);
    pass("convV", tmp, out, w, h, c, r, k);
    return fimg(w, h, c, out);
  }
  const a = par.shared(f.data.length), b = par.shared(f.data.length);
  a.set(f.data);
  for (const r of boxesForGauss(sigma)) {
    pass("boxH", a, b, w, h, c, r);
    pass("boxV", b, a, w, h, c, r);
  }
  return fimg(w, h, c, a);
}

// --- resize -------------------------------------------------------------------------------

// Area average (shrinking) — like cv2.INTER_AREA for downscaling. Separable: each output
// column / row is a weighted sum of the source pixels it covers (taps precomputed).
function areaTaps(n, nn) {
  const sc = n / nn, start = new Int32Array(nn), count = new Int32Array(nn), off = new Int32Array(nn), wts = [];
  for (let o = 0; o < nn; o++) {
    const a = o * sc, b = Math.min(n, a + sc), i0 = Math.floor(a), i1 = Math.min(n, Math.ceil(b));
    start[o] = i0; count[o] = i1 - i0; off[o] = wts.length;
    let tot = 0;
    for (let i = i0; i < i1; i++) tot += Math.min(b, i + 1) - Math.max(a, i);
    for (let i = i0; i < i1; i++) wts.push((Math.min(b, i + 1) - Math.max(a, i)) / tot);
  }
  return { start, count, off, wts: Float32Array.from(wts) };
}

// rows of both passes on all cores (kernels.js areaH / areaV)
export function resizeArea(f, nw, nh) {
  const { w, h, c } = f;
  const tmp = par.shared(nw * h * c), out = par.shared(nw * nh * c);
  par.rows("areaH", { src: par.sharedCopy(f.data), dst: tmp, w, c, nw, t: areaTaps(w, nw) }, h);
  par.rows("areaV", { src: tmp, dst: out, c, nw, t: areaTaps(h, nh) }, nh);
  return fimg(nw, nh, c, out);
}

// Bilinear (pixel centres aligned, like cv2.INTER_LINEAR); column indices / weights precomputed.
export function resizeLinear(f, nw, nh) {
  const { w, h, c } = f, out = par.shared(nw * nh * c);
  const sx = w / nw;
  const X0 = new Int32Array(nw), X1 = new Int32Array(nw), TX = new Float32Array(nw);
  for (let x = 0; x < nw; x++) {
    const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
    X0[x] = Math.floor(fx) * c;
    X1[x] = Math.min(w - 1, Math.floor(fx) + 1) * c;
    TX[x] = fx - Math.floor(fx);
  }
  par.rows("linear", { src: par.sharedCopy(f.data), dst: out, w, h, c, nw, nh, X0, X1, TX }, nh);
  return fimg(nw, nh, c, out);
}

export function resize(f, nw, nh) {
  nw = Math.max(1, Math.round(nw));
  nh = Math.max(1, Math.round(nh));
  if (nw === f.w && nh === f.h) return f;
  return nw < f.w && nh < f.h ? resizeArea(f, nw, nh) : resizeLinear(f, nw, nh);
}

// uint8 RGB image resize (downscaled previews)
export function resizeU8(img, nw, nh) {
  return toU8(resize(toFloat(img), nw, nh));
}

// --- guided filter --------------------------------------------------------------------------

// Fast guided filter: coefficients at `scale` (<= 1), applied at full size (color.guided_fast).
// guide: plane; src: plane or c-channel image.
export function guidedFast(guide, src, radius, eps, scale) {
  const { w, h } = guide, c = src.c;
  const s = Math.min(1, scale);
  const sw = Math.max(1, Math.round(w * s)), sh = Math.max(1, Math.round(h * s));
  const g = resize(guide, sw, sh), p = resize(src, sw, sh);
  const r = Math.max(1, Math.round(radius * s));
  const n = sw * sh;
  const gg = fimg(sw, sh, 1), pg = fimg(sw, sh, c);
  for (let i = 0; i < n; i++) {
    gg.data[i] = g.data[i] * g.data[i];
    for (let ch = 0; ch < c; ch++) pg.data[i * c + ch] = p.data[i * c + ch] * g.data[i];
  }
  const mi = boxBlur(g, r), mii = boxBlur(gg, r), mp = boxBlur(p, r), mip = boxBlur(pg, r);
  const A = fimg(sw, sh, c), B = fimg(sw, sh, c);
  for (let i = 0; i < n; i++) {
    const m = mi.data[i], v = mii.data[i] - m * m;
    for (let ch = 0; ch < c; ch++) {
      const j = i * c + ch;
      const a = (mip.data[j] - m * mp.data[j]) / (v + eps);
      A.data[j] = a;
      B.data[j] = mp.data[j] - a * m;
    }
  }
  const Af = resize(boxBlur(A, r), w, h), Bf = resize(boxBlur(B, r), w, h);
  const out = fimg(w, h, c);
  for (let i = 0; i < w * h; i++)
    for (let ch = 0; ch < c; ch++) {
      const j = i * c + ch;
      out.data[j] = Af.data[j] * guide.data[i] + Bf.data[j];
    }
  return out;
}

// Edge-aware low-pass of luminance (color.smooth_base): coefficients where radius ~ 8 px.
export function smoothBase(lum, radius, eps = 1e-2) {
  const s = Math.min(1, 8 / Math.max(radius, 1));
  return guidedFast(lum, lum, radius, eps, s);
}

// --- colour ---------------------------------------------------------------------------------

// Pull out-of-range pixels toward their luminance (keeps hue), in place (color.fit_gamut).
export function fitGamut(f, lum) {
  const d = f.data, L = lum.data, n = f.w * f.h;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const r = d[j], g = d[j + 1], b = d[j + 2];
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi <= 1 && lo >= 0) continue;
    const l = Math.min(1, Math.max(0, L[i]));
    const t = Math.min(1, (1 - l) / Math.max(hi - l, 1e-6), l / Math.max(l - lo, 1e-6));
    for (let k = 0; k < 3; k++) {
      const v = l + (d[j + k] - l) * t;
      d[j + k] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return f;
}

// Change brightness per pixel keeping hue; lifting scales colour only by sqrt(ratio).
export function scaleLuminance(f, lumNew, lumOld) {
  const out = fimg(f.w, f.h, 3), d = f.data, o = out.data, n = f.w * f.h;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const lo = lumOld.data[i], ln = lumNew.data[i];
    const ratio = ln / Math.max(lo, 1e-4);
    const cs = Math.min(ratio, Math.sqrt(Math.max(ratio, 1)));
    o[j] = ln + (d[j] - lo) * cs;
    o[j + 1] = ln + (d[j + 1] - lo) * cs;
    o[j + 2] = ln + (d[j + 2] - lo) * cs;
  }
  return fitGamut(out, lumNew);
}

// uint8 image through a 256-entry curve (values 0..1)
export function applyCurve(img, curve) {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = curve(i / 255) * 255 + 0.5;
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < out.length; i++) out[i] = lut[img.data[i]];
  return { w: img.w, h: img.h, data: out };
}

// sRGB <-> CIE Lab (D65), as OpenCV's float COLOR_RGB2Lab: L 0..100, a/b about -128..127. The pixel
// math lives in kernels.js (row ranges): large images are converted on all cores (par.js).
export function rgbToLab(f) {
  const out = par.shared(f.data.length);
  par.rows("toLab", { src: par.sharedCopy(f.data), dst: out, w: f.w }, f.h);
  return fimg(f.w, f.h, 3, out);
}

export function labToRgb(lab) {
  const out = par.shared(lab.data.length);
  par.rows("fromLab", { src: par.sharedCopy(lab.data), dst: out, w: lab.w }, lab.h);
  return fimg(lab.w, lab.h, 3, out);
}

// --- small helpers --------------------------------------------------------------------------

export function plane(w, h, value = 0) {
  const p = fimg(w, h, 1);
  if (value) p.data.fill(value);
  return p;
}

export function mapPlane(p, fn) {
  const out = fimg(p.w, p.h, 1), d = p.data, o = out.data;
  for (let i = 0; i < d.length; i++) o[i] = fn(d[i], i);
  return out;
}

export function maxOf(p) {
  let m = -Infinity;
  for (const v of p.data) if (v > m) m = v;
  return m;
}

// Bounding box of mask > thr, padded: {x0, y0, x1, y1} or null
export function bbox(mask, pad = 0, thr = 0.01) {
  const { w, h, data } = mask;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[y * w + x] > thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  return { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(w, x1 + pad + 1), y1: Math.min(h, y1 + pad + 1) };
}

export function crop(f, b) {
  const { c } = f, w = b.x1 - b.x0, h = b.y1 - b.y0, out = new Float32Array(w * h * c);
  for (let y = 0; y < h; y++) {
    const src = ((b.y0 + y) * f.w + b.x0) * c;
    out.set(f.data.subarray(src, src + w * c), y * w * c);
  }
  return fimg(w, h, c, out);
}

export function paste(f, part, b) {
  const { c } = f, w = b.x1 - b.x0;
  for (let y = 0; y < b.y1 - b.y0; y++) f.data.set(part.data.subarray(y * w * c, (y + 1) * w * c), ((b.y0 + y) * f.w + b.x0) * c);
  return f;
}

// Seeded normal noise (Box–Muller on a xorshift), so grain does not "boil".
export function seededNormal(n, seed = 20261017) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s + 0.5) / 4294967296;
  };
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = rnd(), v = rnd(), r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

// Float crop of a uint8 RGB image (only the box is converted)
export function cropFloat(img, b) {
  const w = b.x1 - b.x0, h = b.y1 - b.y0, out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    let s = ((b.y0 + y) * img.w + b.x0) * 3, o = y * w * 3;
    for (let x = 0; x < w * 3; x++) out[o++] = img.data[s++] * (1 / 255);
  }
  return fimg(w, h, 3, out);
}

// Copy of a uint8 RGB image with a float RGB part written into the box
export function withPart(img, part, b) {
  const out = new Uint8ClampedArray(img.data);
  const w = b.x1 - b.x0;
  for (let y = 0; y < b.y1 - b.y0; y++) {
    let o = ((b.y0 + y) * img.w + b.x0) * 3, s = y * w * 3;
    for (let x = 0; x < w * 3; x++) out[o++] = part.data[s++] * 255 + 0.5;
  }
  return { w: img.w, h: img.h, data: out };
}

export function percentile(values, q) {
  const a = Float32Array.from(values).sort();
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))] : 0;
}

// Luminance plane straight from a uint8 RGB image (no float RGB copy of the whole photo).
export function lumU8(img) {
  const n = img.w * img.h, out = new Float32Array(n), d = img.data, k = 1 / 255;
  for (let i = 0, j = 0; i < n; i++, j += 3) out[i] = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) * k;
  return fimg(img.w, img.h, 1, out);
}

// Run a per-pixel float edit in horizontal strips: fn(floatStrip, y0) -> floatStrip.
// Memory stays at one strip in float instead of the whole photo (12 MP: 146 MB per float copy).
export const STRIP_ROWS = 256;
export function stripMap(img, fn) {
  const out = new Uint8ClampedArray(img.data.length);
  for (let y0 = 0; y0 < img.h; y0 += STRIP_ROWS) {
    const y1 = Math.min(img.h, y0 + STRIP_ROWS);
    const r = fn(cropFloat(img, { x0: 0, y0, x1: img.w, y1 }), y0);
    const o = y0 * img.w * 3;
    for (let i = 0; i < r.data.length; i++) out[o + i] = r.data[i] * 255 + 0.5;
  }
  return { w: img.w, h: img.h, data: out };
}

// rows y0..y0+h of a plane (a view, no copy)
export function planeRows(p, y0, h) {
  return fimg(p.w, h, 1, p.data.subarray(y0 * p.w, (y0 + h) * p.w));
}

// 0..1 planes kept in caches as bytes (4x less memory; masks do not need more precision)
export function packPlane(p) {
  const d = new Uint8Array(p.data.length);
  for (let i = 0; i < d.length; i++) d[i] = Math.min(255, Math.max(0, p.data[i] * 255 + 0.5));
  return { w: p.w, h: p.h, packed: d };
}
export function unpackPlane(q) {
  const out = new Float32Array(q.packed.length), k = 1 / 255;
  for (let i = 0; i < out.length; i++) out[i] = q.packed[i] * k;
  return fimg(q.w, q.h, 1, out);
}
