// Image core for the web version: what kirson/core/color.py and the OpenCV calls do on the
// desktop, in plain JS on typed arrays (fast in Safari / Chrome JITs, no 10 MB OpenCV.js).
//
// Images:  {w, h, data: Uint8ClampedArray}  RGB, 3 bytes per pixel (between operations)
// Float:   {w, h, c, data: Float32Array}    interleaved, 0..1 (inside operations)
// Planes:  {w, h, c: 1, data: Float32Array} single channel
// Channel order is RGB (the desktop code is BGR: colour tuples are reordered when ported).

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

// One box pass of radius r along rows (horizontal) for a c-channel interleaved buffer.
// Edge pixels are replicated. O(n), independent of r.
function boxH(src, dst, w, h, c, r) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w * c;
    for (let ch = 0; ch < c; ch++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k)) * c + ch];
      for (let x = 0; x < w; x++) {
        dst[row + x * c + ch] = acc * norm;
        const add = Math.min(w - 1, x + r + 1), sub = Math.max(0, x - r);
        acc += src[row + add * c + ch] - src[row + sub * c + ch];
      }
    }
  }
}

function boxV(src, dst, w, h, c, r) {
  // row by row with a running sum per column: memory is read sequentially (cache friendly)
  const norm = 1 / (2 * r + 1), stride = w * c, acc = new Float64Array(stride);
  for (let k = -r; k <= r; k++) {
    const o = Math.min(h - 1, Math.max(0, k)) * stride;
    for (let j = 0; j < stride; j++) acc[j] += src[o + j];
  }
  for (let y = 0; y < h; y++) {
    const o = y * stride, add = Math.min(h - 1, y + r + 1) * stride, sub = Math.max(0, y - r) * stride;
    for (let j = 0; j < stride; j++) {
      dst[o + j] = acc[j] * norm;
      acc[j] += src[add + j] - src[sub + j];
    }
  }
}

// Box filter of size (2r+1)^2, like cv2.boxFilter (normalised).
export function boxBlur(f, r) {
  r = Math.max(0, Math.round(r));
  if (r === 0) return clone(f);
  const tmp = new Float32Array(f.data.length), out = new Float32Array(f.data.length);
  boxH(f.data, tmp, f.w, f.h, f.c, r);
  boxV(tmp, out, f.w, f.h, f.c, r);
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

function convH(src, dst, w, h, c, k, r) {
  // each row (one channel at a time) is copied into a reflect-101 padded buffer, so the
  // inner loop has no edge tests
  const pad = new Float32Array(w + 2 * r), n = k.length;
  for (let y = 0; y < h; y++) {
    const row = y * w * c;
    for (let ch = 0; ch < c; ch++) {
      for (let x = 0; x < w; x++) pad[x + r] = src[row + x * c + ch];
      for (let i = 1; i <= r; i++) {
        pad[r - i] = pad[r + Math.min(i, w - 1)];
        pad[r + w - 1 + i] = pad[r + w - 1 - Math.min(i, w - 1)];
      }
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let i = 0; i < n; i++) acc += k[i] * pad[x + i];
        dst[row + x * c + ch] = acc;
      }
    }
  }
}

function convV(src, dst, w, h, c, k, r) {
  const stride = w * c;
  for (let y = 0; y < h; y++) {
    for (let i = -r; i <= r; i++) {
      let yy = y + i;
      yy = yy < 0 ? -yy : yy >= h ? 2 * h - 2 - yy : yy;
      if (yy < 0 || yy >= h) yy = Math.min(h - 1, Math.max(0, yy));
      const kw = k[i + r], so = yy * stride, dO = y * stride;
      if (i === -r) for (let j = 0; j < stride; j++) dst[dO + j] = kw * src[so + j];
      else for (let j = 0; j < stride; j++) dst[dO + j] += kw * src[so + j];
    }
  }
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
    const tmp = new Float32Array(f.data.length), out = new Float32Array(f.data.length);
    convH(f.data, tmp, w, h, c, k, r);
    convV(tmp, out, w, h, c, k, r);
    return fimg(w, h, c, out);
  }
  let a = f.data.slice(), b = new Float32Array(a.length);
  for (const r of boxesForGauss(sigma)) {
    boxH(a, b, w, h, c, r);
    boxV(b, a, w, h, c, r);
  }
  return fimg(w, h, c, a);
}

// --- resize -------------------------------------------------------------------------------

// Area average (shrinking) — like cv2.INTER_AREA for downscaling.
export function resizeArea(f, nw, nh) {
  const { w, h, c } = f, out = new Float32Array(nw * nh * c), d = f.data;
  const sx = w / nw, sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = y * sy, y1 = y0 + sy;
    for (let x = 0; x < nw; x++) {
      const x0 = x * sx, x1 = x0 + sx;
      for (let ch = 0; ch < c; ch++) {
        let acc = 0, area = 0;
        for (let yy = Math.floor(y0); yy < Math.min(h, Math.ceil(y1)); yy++) {
          const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
          for (let xx = Math.floor(x0); xx < Math.min(w, Math.ceil(x1)); xx++) {
            const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
            acc += d[(yy * w + xx) * c + ch] * wx * wy;
            area += wx * wy;
          }
        }
        out[(y * nw + x) * c + ch] = acc / area;
      }
    }
  }
  return fimg(nw, nh, c, out);
}

// Bilinear (pixel centres aligned, like cv2.INTER_LINEAR); column indices / weights precomputed.
export function resizeLinear(f, nw, nh) {
  const { w, h, c } = f, out = new Float32Array(nw * nh * c), d = f.data;
  const sx = w / nw, sy = h / nh;
  const X0 = new Int32Array(nw), X1 = new Int32Array(nw), TX = new Float32Array(nw);
  for (let x = 0; x < nw; x++) {
    const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
    X0[x] = Math.floor(fx) * c;
    X1[x] = Math.min(w - 1, Math.floor(fx) + 1) * c;
    TX[x] = fx - Math.floor(fx);
  }
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const r0 = Math.floor(fy) * w * c, r1 = Math.min(h - 1, Math.floor(fy) + 1) * w * c, ty = fy - Math.floor(fy);
    let o = y * nw * c;
    for (let x = 0; x < nw; x++) {
      const x0 = X0[x], x1 = X1[x], tx = TX[x];
      for (let ch = 0; ch < c; ch++, o++) {
        const top = d[r0 + x0 + ch] + (d[r0 + x1 + ch] - d[r0 + x0 + ch]) * tx;
        const bot = d[r1 + x0 + ch] + (d[r1 + x1 + ch] - d[r1 + x0 + ch]) * tx;
        out[o] = top + (bot - top) * ty;
      }
    }
  }
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

// sRGB <-> CIE Lab (D65), as OpenCV's float COLOR_RGB2Lab: L 0..100, a/b about -128..127.
const lin = new Float32Array(4096);
for (let i = 0; i < 4096; i++) {
  const v = i / 4095;
  lin[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function toLin(v) {
  return v <= 0 ? 0 : v >= 1 ? 1 : lin[(v * 4095 + 0.5) | 0];
}
function fromLin(v) {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
const Xn = 0.950456, Zn = 1.088754;
function fLab(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

export function rgbToLab(f) {
  const out = fimg(f.w, f.h, 3), d = f.data, o = out.data;
  for (let j = 0; j < d.length; j += 3) {
    const r = toLin(d[j]), g = toLin(d[j + 1]), b = toLin(d[j + 2]);
    const x = (0.412453 * r + 0.35758 * g + 0.180423 * b) / Xn;
    const y = 0.212671 * r + 0.71516 * g + 0.072169 * b;
    const z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / Zn;
    const fx = fLab(x), fy = fLab(y), fz = fLab(z);
    o[j] = y > 0.008856 ? 116 * fy - 16 : 903.3 * y;
    o[j + 1] = 500 * (fx - fy);
    o[j + 2] = 200 * (fy - fz);
  }
  return out;
}

export function labToRgb(lab) {
  const out = fimg(lab.w, lab.h, 3), d = lab.data, o = out.data;
  for (let j = 0; j < d.length; j += 3) {
    const L = d[j];
    const fy = (L + 16) / 116, fx = fy + d[j + 1] / 500, fz = fy - d[j + 2] / 200;
    const y = L > 7.9996 ? fy * fy * fy : L / 903.3;
    const x = (fx > 0.206893 ? fx * fx * fx : (fx - 16 / 116) / 7.787) * Xn;
    const z = (fz > 0.206893 ? fz * fz * fz : (fz - 16 / 116) / 7.787) * Zn;
    const r = 3.240479 * x - 1.53715 * y - 0.498535 * z;
    const g = -0.969256 * x + 1.875991 * y + 0.041556 * z;
    const b = 0.055648 * x - 0.204043 * y + 1.057311 * z;
    o[j] = fromLin(Math.max(0, r));
    o[j + 1] = fromLin(Math.max(0, g));
    o[j + 2] = fromLin(Math.max(0, b));
  }
  return out;
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
