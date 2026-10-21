// Row-range kernels of the separable blurs: each call fills output rows y0..y1, so the rows of
// one pass can be shared out between threads (par.js). a = {src, dst, w, h, c, k?, r}.

// Gaussian along rows: the row (all channels, interleaved) goes into a reflect-101 padded
// buffer, so the inner loop has no edge tests; the kernel is symmetric (pairs share a multiply)
export function convH(a, y0, y1) {
  const { src, dst, w, c, k, r } = a, wc = w * c, k0 = k[r];
  const pad = new Float32Array((w + 2 * r) * c);
  for (let y = y0; y < y1; y++) {
    const row = y * wc;
    pad.set(src.subarray(row, row + wc), r * c);
    for (let i = 1; i <= r; i++) {
      const ii = Math.min(i, w - 1);
      for (let ch = 0; ch < c; ch++) {
        pad[(r - i) * c + ch] = src[row + ii * c + ch];
        pad[(r + w - 1 + i) * c + ch] = src[row + (w - 1 - ii) * c + ch];
      }
    }
    for (let j = 0; j < wc; j++) {
      const o = j + r * c;
      let acc = k0 * pad[o];
      for (let i = 1, sft = c; i <= r; i++, sft += c) acc += k[r + i] * (pad[o - sft] + pad[o + sft]);
      dst[row + j] = acc;
    }
  }
}

function reflect101(y, h) {
  if (h === 1) return 0;
  y = y < 0 ? -y : y >= h ? 2 * h - 2 - y : y;
  return Math.min(h - 1, Math.max(0, y));
}

// Gaussian along columns: output row y = weighted rows y-r..y+r (memory read row by row)
export function convV(a, y0, y1) {
  const { src, dst, w, h, c, k, r } = a, stride = w * c, k0 = k[r];
  for (let y = y0; y < y1; y++) {
    const dO = y * stride;
    for (let j = 0; j < stride; j++) dst[dO + j] = k0 * src[dO + j];
    for (let i = 1; i <= r; i++) {
      const p = reflect101(y - i, h) * stride, q = reflect101(y + i, h) * stride, kw = k[r + i];
      for (let j = 0; j < stride; j++) dst[dO + j] += kw * (src[p + j] + src[q + j]);
    }
  }
}

// Box (2r+1) along rows, edge pixels replicated; O(n) whatever r is
export function boxH(a, y0, y1) {
  const { src, dst, w, c, r } = a;
  const norm = 1 / (2 * r + 1), wc = w * c, pad = new Float32Array((w + 2 * r + 1) * c);
  const span = (2 * r + 1) * c, acc = new Float64Array(c);
  for (let y = y0; y < y1; y++) {
    const row = y * wc;
    pad.set(src.subarray(row, row + wc), r * c);
    for (let i = 0; i < r; i++) for (let ch = 0; ch < c; ch++) pad[i * c + ch] = src[row + ch];
    for (let i = r + w; i < w + 2 * r + 1; i++) for (let ch = 0; ch < c; ch++) pad[i * c + ch] = src[row + wc - c + ch];
    for (let ch = 0; ch < c; ch++) {
      let s = 0;
      for (let i = 0; i < 2 * r + 1; i++) s += pad[i * c + ch];
      acc[ch] = s;
    }
    // output x: window pad[x .. x + 2r]; then slide: + pad[x + 2r + 1] - pad[x]
    if (c === 1) {
      let a0 = acc[0];
      for (let j = 0; j < wc; j++) {
        dst[row + j] = a0 * norm;
        a0 += pad[j + span] - pad[j];
      }
    } else if (c === 3) {
      let a0 = acc[0], a1 = acc[1], a2 = acc[2];
      for (let j = 0; j < wc; j += 3) {
        dst[row + j] = a0 * norm;
        dst[row + j + 1] = a1 * norm;
        dst[row + j + 2] = a2 * norm;
        a0 += pad[j + span] - pad[j];
        a1 += pad[j + span + 1] - pad[j + 1];
        a2 += pad[j + span + 2] - pad[j + 2];
      }
    } else {
      for (let j = 0; j < wc; j++) {
        const ch = j % c;
        dst[row + j] = acc[ch] * norm;
        acc[ch] += pad[j + span] - pad[j];
      }
    }
  }
}

// Box along columns: a running sum per column, started afresh at y0 (cache friendly: row order)
export function boxV(a, y0, y1) {
  const { src, dst, w, h, c, r } = a;
  const norm = 1 / (2 * r + 1), stride = w * c, acc = new Float64Array(stride);
  for (let k = y0 - r; k <= y0 + r; k++) {
    const o = Math.min(h - 1, Math.max(0, k)) * stride;
    for (let j = 0; j < stride; j++) acc[j] += src[o + j];
  }
  for (let y = y0; y < y1; y++) {
    const o = y * stride, add = Math.min(h - 1, y + r + 1) * stride, sub = Math.max(0, y - r) * stride;
    for (let j = 0; j < stride; j++) {
      dst[o + j] = acc[j] * norm;
      acc[j] += src[add + j] - src[sub + j];
    }
  }
}

// --- sRGB <-> CIE Lab (D65), as OpenCV's float COLOR_RGB2Lab; a = {src, dst, w}, 3 channels ---------------
const lin = new Float32Array(4096);
for (let i = 0; i < 4096; i++) {
  const v = i / 4095;
  lin[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function toLin(v) {
  return v <= 0 ? 0 : v >= 1 ? 1 : lin[(v * 4095 + 0.5) | 0];
}
function fromLinExact(v) {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
// table over sqrt(v) (the curve is steep near black), linear interpolation: error < 1e-5
const GAM_N = 4096, gam = new Float32Array(GAM_N + 2);
for (let i = 0; i <= GAM_N + 1; i++) gam[i] = fromLinExact(Math.min(1, (i / GAM_N) ** 2));
function fromLin(v) {
  if (v >= 1) return fromLinExact(v);
  const u = Math.sqrt(v) * GAM_N, i = u | 0;
  return gam[i] + (gam[i + 1] - gam[i]) * (u - i);
}
const Xn = 0.950456, Zn = 1.088754;
function fLab(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}


export function toLab(a, y0, y1) {
  const { src: d, dst: o } = a;
  for (let j = y0 * a.w * 3, e = y1 * a.w * 3; j < e; j += 3) {
    const r = toLin(d[j]), g = toLin(d[j + 1]), b = toLin(d[j + 2]);
    const x = (0.412453 * r + 0.35758 * g + 0.180423 * b) / Xn;
    const y = 0.212671 * r + 0.71516 * g + 0.072169 * b;
    const z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / Zn;
    const fx = fLab(x), fy = fLab(y), fz = fLab(z);
    o[j] = y > 0.008856 ? 116 * fy - 16 : 903.3 * y;
    o[j + 1] = 500 * (fx - fy);
    o[j + 2] = 200 * (fy - fz);
  }
}

export function fromLab(a, y0, y1) {
  const { src: d, dst: o } = a;
  for (let j = y0 * a.w * 3, e = y1 * a.w * 3; j < e; j += 3) {
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
}

// --- resizing (img.js resizeArea / resizeLinear) ---------------------------------------------------------
// area, along rows: a = {src, dst, w, c, nw, t: taps}; rows y0..y1 of the input height
export function areaH(a, y0, y1) {
  const { src: d, dst: tmp, w, c, nw, t } = a;
  for (let y = y0; y < y1; y++) {
    const row = y * w * c, orow = y * nw * c;
    for (let x = 0; x < nw; x++) {
      const s0 = t.start[x], cnt = t.count[x], wo = t.off[x];
      for (let ch = 0; ch < c; ch++) {
        let acc = 0;
        for (let i = 0; i < cnt; i++) acc += d[row + (s0 + i) * c + ch] * t.wts[wo + i];
        tmp[orow + x * c + ch] = acc;
      }
    }
  }
}

// area, along columns: a = {src, dst, c, nw, t}; output rows y0..y1
export function areaV(a, y0, y1) {
  const { src: tmp, dst: out, c, nw, t } = a, stride = nw * c;
  for (let y = y0; y < y1; y++) {
    const s0 = t.start[y], cnt = t.count[y], wo = t.off[y], o = y * stride;
    out.fill(0, o, o + stride);
    for (let i = 0; i < cnt; i++) {
      const wgt = t.wts[wo + i], src = (s0 + i) * stride;
      for (let j = 0; j < stride; j++) out[o + j] += tmp[src + j] * wgt;
    }
  }
}

// bilinear (pixel centres aligned, like cv2.INTER_LINEAR): output rows y0..y1
export function linear(a, y0, y1) {
  const { src: d, dst: out, w, h, c, nw, nh, X0, X1, TX } = a, sy = h / nh;
  for (let y = y0; y < y1; y++) {
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
}
