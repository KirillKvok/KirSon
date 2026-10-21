// What this device can afford. iPhone Safari closes a tab that goes over its memory limit (the page just
// reloads — «выбрасывает»), and it counts every canvas, worker and WebAssembly memory; weak Android phones
// (navigator.deviceMemory < 4) likewise. So on them: the networks on the processor with one thread (the
// WebGPU runtime alone is 22 MB more plus video memory), fewer helper threads, the sharp 2048 px preview
// only when zoomed in.
//
// A safety net for devices we cannot test on: a photo being opened is marked in localStorage and the mark
// cleared once it is analysed. A mark left at the next start means the tab died opening it: the next level
// of lightness is switched on for good (1 — no graphics card, single threads; 2 — no face parsing either,
// photos at most 8 MP). «Выключить» next to the version on the start screen turns it off.
const ua = navigator.userAgent;
export const IOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const ANDROID = /Android/.test(ua);
export const PHONE = IOS || ANDROID;
const MEM = navigator.deviceMemory || 0; // GB (Chrome / Android only), 0 = unknown
export const LOW_MEMORY = MEM > 0 && MEM < 4;

const SAFE_KEY = "kirson-safe", OPENING_KEY = "kirson-opening";
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };

// the tab died while opening a photo last time: one level lighter (decided once, at start)
export let SAFE = Number(get(SAFE_KEY)) || 0;
export const CRASHED_OPENING = !!get(OPENING_KEY);
if (CRASHED_OPENING) {
  SAFE = Math.min(2, SAFE + 1);
  set(SAFE_KEY, String(SAFE));
  set(OPENING_KEY, null);
}

export const openingStarted = () => set(OPENING_KEY, String(Date.now()));
export const openingDone = () => set(OPENING_KEY, null);
export const resetSafe = () => { set(SAFE_KEY, null); SAFE = 0; };

const light = IOS || LOW_MEMORY || SAFE > 0;
export const GPU_ONNX = !light; // ONNX Runtime on the graphics card: desktops and strong Android phones
export const ONNX_THREADS = light ? 1 : Math.min(4, navigator.hardwareConcurrency || 2);
export const HELPERS = SAFE >= 2 ? 0 : light ? 2 : Math.min(5, Math.max(0, (navigator.hardwareConcurrency || 2) - 1));
export const FACE_PARSING = SAFE < 2;
// iOS canvas limit is 16.7 MP; on iPhone 12.6 MP (12 MP photos stay whole, 48 MP ones are reduced at once)
export const MAX_PIXELS = SAFE >= 2 ? 8_000_000 : IOS ? 12_600_000 : 16_000_000;
export const EAGER_DETAIL = !PHONE; // the 2048 px preview made at once only on computers
