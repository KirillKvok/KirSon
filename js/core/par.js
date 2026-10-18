// Several processor cores for the heavy blurs. With cross-origin isolation (the service worker
// adds COOP / COEP headers) the processing worker starts helper workers; a pass's rows are cut
// into chunks in shared memory, and every thread — the processing worker too — takes the next
// free chunk (an atomic counter). If helpers are slow to start or missing, the processing worker
// simply does all the chunks itself: the result is the same either way.
import * as K from "./kernels.js";

const ON = typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true
  && typeof Worker !== "undefined" && typeof WorkerGlobalScope !== "undefined";
const MIN_PARALLEL = 150000; // smaller buffers: one thread is faster than handing out
let helpers = [], ready = 0;

// called once by the processing worker
export function start() {
  if (!ON || helpers.length) return;
  const n = Math.min(5, Math.max(0, (navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < n; i++) {
    try {
      const h = new Worker(new URL("../helper.js", import.meta.url), { type: "module" });
      h.onmessage = (e) => { if (e.data === "ready") ready++; };
      h.onerror = () => {};
      helpers.push(h);
    } catch { break; } // no nested workers in this browser
  }
}

export const threads = () => (ON ? ready + 1 : 1);

// a buffer the helpers can write into (a plain one when there is no sharing)
export function shared(n) {
  return ON && n >= MIN_PARALLEL ? new Float32Array(new SharedArrayBuffer(n * 4)) : new Float32Array(n);
}
export function sharedCopy(a) {
  if (!ON || a.length < MIN_PARALLEL || a.buffer instanceof SharedArrayBuffer) return a;
  const s = shared(a.length);
  s.set(a);
  return s;
}

// fill rows 0..total of a.dst with kernel `kind`
export function rows(kind, a, total) {
  const par = ON && ready > 0 && a.dst.length >= MIN_PARALLEL && a.src.buffer instanceof SharedArrayBuffer
    && a.dst.buffer instanceof SharedArrayBuffer && total >= 16;
  if (!par) return K[kind](a, 0, total);
  const chunks = Math.min(total >> 2, (ready + 1) * 3);
  const ctl = new Int32Array(new SharedArrayBuffer(8)); // [next chunk, chunks done]
  const job = { kind, a, total, chunks, ctl };
  for (const h of helpers) h.postMessage(job);
  work(job);
  for (;;) {
    const d = Atomics.load(ctl, 1);
    if (d >= chunks) break;
    Atomics.wait(ctl, 1, d, 100);
  }
}

export function work({ kind, a, total, chunks, ctl }) {
  for (;;) {
    const i = Atomics.add(ctl, 0, 1);
    if (i >= chunks) return;
    try {
      K[kind](a, Math.floor((i * total) / chunks), Math.floor(((i + 1) * total) / chunks));
    } finally { // counted even on an error: the waiting thread must never hang
      Atomics.add(ctl, 1, 1);
      Atomics.notify(ctl, 1);
    }
  }
}
