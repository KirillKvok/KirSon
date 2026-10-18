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
