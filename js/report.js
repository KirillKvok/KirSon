// Problem report: the last errors and steps, kept in localStorage (they survive the tab being closed by
// iOS for memory), and a text the user can send in a messenger — the site has no server to send it to.
import { VERSION } from "./version.js";

const KEY = "kirson-log", MAX = 60;
let log = [];
try { log = JSON.parse(localStorage.getItem(KEY)) || []; } catch { log = []; }

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* full / private */ } }, 300);
}

// one line of the log: what happened (a step of the user or an error)
export function note(kind, text) {
  const t = new Date();
  log.push([`${t.toLocaleDateString("ru")} ${t.toLocaleTimeString("ru")}`, kind, String(text).slice(0, 600)]);
  if (log.length > MAX) log = log.slice(-MAX);
  save();
  if (kind === "сбой") try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* */ } // at once
}

const short = (err) => {
  if (!err) return "?";
  const stack = String(err.stack || "").split("\n").slice(0, 4).join(" | ");
  return `${err.message || err}${stack ? ` — ${stack}` : ""}`;
};

window.addEventListener("error", (e) => note("ошибка", e.error ? short(e.error) : `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => note("ошибка", short(e.reason)));
// MediaPipe / TensorFlow Lite print their own diagnostics as warnings and errors: not problems
const NOISE = /^[WIE]\d{4} \d|^INFO: |TensorFlow Lite|XNNPACK|OpenGL error checking|pooled buffers/;
for (const level of ["error", "warn"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    if (typeof args[0] === "string" && NOISE.test(args[0])) return orig(...args);
    note(level === "error" ? "ошибка" : "внимание", args.map((a) => (a instanceof Error ? short(a) : typeof a === "object" ? safeJson(a) : a)).join(" "));
    orig(...args);
  };
}
function safeJson(a) {
  try { return JSON.stringify(a).slice(0, 300); } catch { return String(a); }
}

async function deviceText() {
  const n = navigator, lines = [
    `KirSon ${VERSION}`,
    `Устройство: ${n.userAgent}`,
    `Память: ${n.deviceMemory ? `${n.deviceMemory} ГБ` : "?"}, ядер: ${n.hardwareConcurrency || "?"}, экран ${screen.width}×${screen.height} @${devicePixelRatio}`,
    `Режим: ${matchMedia("(display-mode: standalone)").matches || n.standalone ? "на экране Домой" : "в браузере"}, `
      + `потоки: ${self.crossOriginIsolated ? "да" : "нет"}, облегчённый: ${localStorage.getItem("kirson-safe") || 0}, WebGPU: ${n.gpu ? "есть" : "нет"}`,
  ];
  try {
    const est = await n.storage?.estimate?.();
    if (est) lines.push(`Хранилище: ${Math.round(est.usage / 1e6)} из ${Math.round(est.quota / 1e6)} МБ`);
  } catch { /* */ }
  return lines.join("\n");
}

export async function reportText() {
  const rows = log.slice(-40).map(([t, k, s]) => `${t} [${k}] ${s}`);
  return `${await deviceText()}\n\nПоследние события:\n${rows.length ? rows.join("\n") : "— ошибок не было"}`;
}

// share sheet on phones (messengers), the clipboard elsewhere; true if it went somewhere
export async function sendReport() {
  const text = await reportText();
  if (navigator.share && /iPhone|iPad|Android/.test(navigator.userAgent)) {
    try { await navigator.share({ title: "KirSon: отчёт о проблеме", text }); return "shared"; } catch (e) { if (e?.name === "AbortError") return null; }
  }
  try { await navigator.clipboard.writeText(text); return "copied"; } catch { /* no clipboard permission */ }
  return text; // last resort: shown for manual copying
}

export const clearLog = () => { log = []; try { localStorage.removeItem(KEY); } catch { /* */ } };
