// KirSon web — interface. Persona-like: the photo, one slider for the chosen tool, a row of the
// tab's tools, tabs. Processing runs in a worker (engine.js); the original never leaves the phone.
import "./ops/index.js";
import { ORDER } from "./ops/index.js";
import { REGISTRY, Pipeline, defaults, isIdentity } from "./core/pipeline.js";
import { FILTER_NAMES, filterThumb } from "./ops/filters.js";
import { LIP_COLORS, BLUSH_COLORS, SHADOW_COLORS, EYE_COLORS } from "./ops/makeup.js";
import { HAIR_NAMES, HAIR_COLORS } from "./ops/hair.js";
import { REPLACE, PLAIN, GRADIENT } from "./ops/background.js";
import { iconFor } from "./icons.js";
import { LIGHT_DIRS } from "./ops/relight.js";
import { labToRgb } from "./core/img.js";
import { LOOKS as BASE_LOOKS, BUILTIN, scaled as scaleLook } from "./core/presets.js";
import { MORE_LOOKS, MORE_PRESETS } from "./core/styles.js";
import { ASPECTS, rectOf, inscribedScale } from "./ops/crop.js";
import { LIQUIFY_MODES, MASK_LAYERS } from "./ops/brushes.js";
import { SKIN_BRUSH_MODES } from "./ops/skin.js";
import { selectedFaces } from "./ops/faces.js";
import { objectKey } from "./ops/object.js";
import { Engine } from "./engine.js";
import { analyze, objectMask, parseFaces, warmUpParsing, removeFill, superResolve, faceTracker, setGpu, onnxInfo } from "./face/analysis.js";
import { openCoach } from "./coach.js";
import * as assets from "./assets.js";
import * as device from "./device.js";
import { showShare, presetFromAddress } from "./share.js";
import { VERSION } from "./version.js";
import { runTour, seen, welcomeSteps, editorSteps } from "./tour.js";
import * as session from "./session.js";
import { FORMATS, fit, facesFocus } from "./social.js";
import { videoSupported, record } from "./video.js";
import { openCompare } from "./compare.js";
import { haptic } from "./haptics.js";
import { editVideo, videoEditSupported, audioContext } from "./videoedit.js";

// the desktop's looks and presets plus the web's own styles (core/styles.js)
const LOOKS = { ...BASE_LOOKS, ...MORE_LOOKS }, PRESETS = { ...BUILTIN, ...MORE_PRESETS };
const PREVIEW = 1280; // preview long side (as on the desktop)
const FAST = 640;     // while a slider is held
const DETAIL = 2048;  // preview long side when zoomed in (fine detail)
const MAX_ZOOM = 6;
const MAX_PIXELS = device.MAX_PIXELS; // iOS canvas limit is 16.7 MP; lower in the light mode
const EXPORT_PHONE = 3200; // long side of the saved photo on phones (memory)

// Tabs: what each one offers. {op, param} = a slider tool; {op, param, option} = a choice chip.
const TABS = [
  {
    name: "Образы",
    tools: [
      { kind: "auto", label: "✦ Авто" },
      ...Object.keys(LOOKS).map((name) => ({ kind: "look", name, label: name })),
      { kind: "strength", label: "Сила образа" },
      ...Object.keys(PRESETS).map((name) => ({ kind: "preset", name, label: name })),
      { kind: "reset", label: "Без обработки" },
    ],
  },
  {
    name: "Мои",
    get tools() { return mineTools(); },
  },
  {
    name: "Лицо",
    tools: [
      ...[["skin", "smooth"], ["skin", "blemish"], ["face_light", "matte"], ["skin_tone", "even"],
      ["skin_tone", "redness"], ["freckles", "amount"], ["face_detail", "circles"], ["face_detail", "bags"], ["face_detail", "folds"],
      ["face_detail", "wrinkles"], ["face_light", "soften"], ["face_light", "fill"], ["relight", "amount"], ["skin_tone", "tan"],
      ["teeth_eyes", "teeth"], ["teeth_eyes", "sclera"], ["teeth_eyes", "iris"], ["skin", "texture"],
      ["skin_natural", "texture"], ["skin_natural", "volume"], ["skin", "body"]].map(([op, param]) => ({ op, param })),
      ...LIGHT_DIRS.map((n, k) => ({ op: "relight", param: "dir", option: k, label: `Свет: ${n.toLowerCase()}` })),
      // by hand, on «Кисти»: the smoothing where she wants it, a spot taken away
      ...SKIN_BRUSH_MODES.map((label, mode) => ({ kind: "faceBrush", tool: "skin", mode, label })),
      { kind: "faceBrush", tool: "heal", mode: 0, label: "Убрать пятно кистью" },
      { kind: "facePick", label: "Выбрать лицо" },
      { kind: "faceAll", label: "Все лица" },
    ],
  },
  {
    name: "Форма",
    tools: [["face_shape", "slim"], ["face_shape", "jaw"], ["face_shape", "chin"], ["face_shape", "eyes"],
      ["face_shape", "eye_open"], ["face_shape", "nose"], ["face_shape", "lips"], ["face_shape", "smile"],
      ["face_shape", "symmetry"]].map(([op, param]) => ({ op, param })),
  },
  {
    name: "Фигура",
    tools: [{ kind: "bodyAuto", label: "Авто" }, ...[["body", "waist"], ["body", "hips"], ["body", "legs"], ["body", "length"], ["body", "arms"],
      ["body", "shoulders"], ["body", "neck"]].map(([op, param]) => ({ op, param }))],
  },
  {
    name: "Макияж",
    tools: [
      { op: "makeup", param: "lips" },
      ...Object.keys(LIP_COLORS).map((n, k) => ({ op: "makeup", param: "lip_color", option: k, label: n })),
      { op: "makeup", param: "blush" },
      ...Object.keys(BLUSH_COLORS).map((n, k) => ({ op: "makeup", param: "blush_color", option: k, label: n })),
      { op: "makeup", param: "shadow" },
      ...Object.keys(SHADOW_COLORS).map((n, k) => ({ op: "makeup", param: "shadow_color", option: k, label: n })),
      { op: "makeup", param: "mascara" }, { op: "makeup", param: "eyeliner" }, { op: "makeup", param: "brows" },
      { op: "makeup", param: "highlight" }, { op: "makeup", param: "contour" },
      { op: "makeup", param: "iris" },
      ...Object.keys(EYE_COLORS).map((n, k) => ({ op: "makeup", param: "iris_color", option: k, label: n })),
    ],
  },
  {
    name: "Волосы",
    tools: [
      ...HAIR_NAMES.map((n, k) => ({ op: "hair", param: "color", option: k, label: k ? n : "Свой цвет" })),
      { op: "hair", param: "thick" }, { op: "hair", param: "volume" }, { op: "hair", param: "amount" },
      { op: "hair", param: "shine" }, { op: "hair", param: "roots" },
    ],
  },
  {
    name: "Фон",
    tools: [
      { op: "background", param: "blur" }, { op: "background", param: "brightness" }, { op: "background", param: "saturation" },
      ...REPLACE.map((n, k) => ({ op: "background", param: "replace", option: k, label: k ? n : "Свой фон",
        action: n === "Своя картинка" ? "pickBackground" : null })),
    ],
  },
  {
    name: "Объект",
    tools: [
      { kind: "objectPick", label: "Выбрать объект" },
      ...["brightness", "contrast", "saturation", "sharpness"].map((param) => ({ op: "object", param })),
      { kind: "objectRemove", label: "Удалить объект" },
      { kind: "objectClear", label: "Снять выделение" },
    ],
  },
  {
    name: "Кисти",
    tools: [
      ...LIQUIFY_MODES.map((label, mode) => ({ kind: "brush", tool: "liquify", mode, label })),
      ...SKIN_BRUSH_MODES.map((label, mode) => ({ kind: "brush", tool: "skin", mode, label })),
      { kind: "brush", tool: "heal", mode: 0, label: "Заплатка" },
      ...MASK_LAYERS.map((label, mode) => ({ kind: "brush", tool: "mask_edit", mode, label })),
      { kind: "brushSize", label: "Размер кисти" },
      { kind: "brushStrength", label: "Сила кисти" },
      { kind: "brushClear", label: "Стереть мазки" },
    ],
  },
  {
    name: "Кадр",
    tools: [
      { kind: "smartFrame", label: "Умный кадр" },
      ...Object.keys(ASPECTS).map((name) => ({ kind: "aspect", name, label: name })),
      { op: "crop", param: "angle", label: "Наклон" },
      { kind: "rotate", label: "⟳ 90°" },
      { kind: "flip", label: "Отразить" },
      { kind: "frameReset", label: "Сбросить кадр" },
    ],
  },
  {
    name: "Коррекция",
    tools: [{ kind: "enhance", label: "Улучшить качество" }, ...[["light", "shadows"], ["light", "highlights"], ["brightness", "amount"], ["contrast", "amount"],
      ["color", "saturation"], ["color", "vibrance"], ["color", "temperature"], ["color", "tint"],
      ["sharpen", "sharpness"], ["sharpen", "clarity"]].map(([op, param]) => ({ op, param }))],
  },
  {
    name: "Фильтры",
    tools: [
      { op: "filter", param: "amount", label: "Сила фильтра" },
      { op: "grain", param: "amount", label: "Зерно" },
      { op: "grain", param: "size", label: "Размер зерна" },
      ...FILTER_NAMES.map((n, k) => ({ op: "filter", param: "style", option: k, label: n })),
    ],
  },
];

const $ = (id) => document.getElementById(id);
const view = $("view"), vctx = view.getContext("2d");
const engine = new Engine();

const app = {
  pipeline: Pipeline.fromOrder(ORDER),
  history: [],
  future: [],
  tab: 0,
  tool: null,       // current slider tool {op, param, label}
  aspect: "Свободно", // crop frame proportions
  brush: { tool: "liquify", mode: 0, size: 25, strength: 50 },
  versions: [],     // [{name, state, thumb}] of this photo (kept in the session)
  split: false,     // before / after divider on the photo
  splitPos: 0.5,
  before: null,     // the original in the result's frame (when cropped)
  look: null,       // chosen look and its strength (0..150 %)
  lookStrength: 100,
  original: null,   // full-size ImageData
  preview: null,    // preview ImageData (the "before" view)
  result: null,     // last rendered preview
  name: "photo",
  imageId: 0,
  dragging: false,
};

// --- state ------------------------------------------------------------------------------
function values(op) {
  return { ...defaults(REGISTRY[op]), ...app.pipeline.step(op).values };
}
function setValue(op, param, v) {
  app.pipeline.step(op).values[param] = v;
}
// a saved edit (session, version, undo step) made before an operation existed: brought to the current
// list of operations — the new ones at their defaults (otherwise their tools had no step to set)
function fromState(json) {
  const d = typeof json === "string" ? JSON.parse(json) : json, p = Pipeline.fromOrder(ORDER);
  for (const st of d.steps || []) {
    const t = p.step(st.op);
    if (t) { t.values = { ...(st.values || {}) }; t.enabled = st.enabled !== false; }
  }
  return p;
}
function snapshot() {
  return JSON.stringify(app.pipeline.toJSON());
}
function pushHistory() {
  const s = snapshot();
  if (app.history[app.history.length - 1] === s) return;
  app.history.push(s);
  app.future = [];
  updateButtons();
  if (app.original && !app.restoring) session.save({ state: s });
}
function restore(s) {
  app.pipeline = fromState(s);
  renderTools();
  requestRender();
  drawOverlay();
}
function undo() {
  if (app.history.length < 2) return;
  app.future.push(app.history.pop());
  restore(app.history[app.history.length - 1]);
  updateButtons();
}
function redo() {
  if (!app.future.length) return;
  const s = app.future.pop();
  app.history.push(s);
  restore(s);
  updateButtons();
}
function updateButtons() {
  $("btn-undo").disabled = app.history.length < 2;
  $("btn-redo").disabled = !app.future.length;
  $("btn-save").disabled = !app.original;
}

// --- tabs, tools, slider -------------------------------------------------------------------
function paramOf(t) {
  return REGISTRY[t.op].params.find((p) => p.name === t.param);
}
function toolLabel(t) {
  return t.label || paramOf(t).label;
}

function renderTabs() {
  const nav = $("tabs");
  nav.innerHTML = "";
  TABS.forEach((tab, k) => {
    const b = document.createElement("button");
    b.className = "tab" + (k === app.tab ? " on" : "");
    b.textContent = tab.name;
    b.onclick = () => selectTab(k);
    nav.appendChild(b);
  });
}

function canvasOf(imageData) {
  const c = document.createElement("canvas");
  c.width = imageData.width;
  c.height = imageData.height;
  c.getContext("2d").putImageData(imageData, 0, 0);
  return c;
}

function selectTab(k) {
  const wasFrame = frameTab(), wasBrush = brushTab() || objectTab();
  app.facePick = false;
  app.objectPick = false;
  app.tab = k;
  if (frameTab()) resetZoom(); // the frame editor works on the whole, unzoomed photo
  updateSplit(true);
  if (wasFrame !== frameTab() || wasBrush !== (brushTab() || objectTab())) requestRender(); // whole photo in these tabs
  drawOverlay();
  app.tool = TABS[k].tools.find((t) => (t.option === undefined && !t.kind) || t.kind === "strength" || t.kind === "brushSize") || null;
  renderTabs();
  renderTools();
}

// Values applied as the whole edit (look, preset, «Авто»): the frame of this photo and the
// chosen faces are kept.
const KEEP = ["crop", "face_select"];
function applyValues(vals) {
  const next = Pipeline.fromOrder(ORDER);
  for (const st of next.steps) {
    if (KEEP.includes(st.op)) st.values = { ...app.pipeline.step(st.op)?.values };
    else if (vals[st.op]) st.values = { ...vals[st.op] };
  }
  app.pipeline = next;
}

function applyLook(push = true) {
  if (!app.look) return;
  applyValues(scaleLook(LOOKS[app.look], app.lookStrength / 100));
  if (push) {
    pushHistory();
    addVersion(`${app.look}${app.lookStrength === 100 ? "" : ` ${app.lookStrength}%`}`);
  }
  requestRender();
}

// --- my presets (this phone, any photo) and versions (this photo) ---------------------------------
const PRESETS_KEY = "kirson-presets", MAX_VERSIONS = 12;
// a preset carries the look of the edit, not what belongs to one photo
const NOT_PORTABLE = ["crop", "face_select", "liquify", "mask_edit", "heal", "object"];

function myPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; } catch { return []; }
}
function storePresets(list) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
    return true;
  } catch {
    toast("Не удалось сохранить пресет");
    return false;
  }
}
// the changed sliders of the current edit (hidden values — strokes, pictures — are left out)
function portableValues() {
  const out = {};
  for (const st of app.pipeline.steps) {
    if (NOT_PORTABLE.includes(st.op) || !st.enabled || !REGISTRY[st.op]) continue;
    const v = {};
    for (const p of REGISTRY[st.op].params) {
      const x = st.values[p.name];
      if (!p.hidden && x !== undefined && JSON.stringify(x) !== JSON.stringify(p.def)) v[p.name] = x;
    }
    if (Object.keys(v).length) out[st.op] = v;
  }
  return out;
}

function savePreset() {
  const vals = portableValues();
  if (!Object.keys(vals).length) return toast("Сначала настройте фото — пресет запоминает ваши правки");
  const list = myPresets();
  const name = (prompt("Название пресета", `Мой пресет ${list.length + 1}`) || "").trim().slice(0, 40);
  if (!name) return;
  const i = list.findIndex((p) => p.name === name);
  if (i >= 0) list[i].values = vals;
  else list.push({ name, values: vals });
  if (storePresets(list)) toast(`Пресет «${name}» сохранён — он работает с любым фото`);
  renderTools();
}

function applyPreset(p) {
  app.look = null;
  applyValues(p.values);
  pushHistory();
  addVersion(p.name);
  renderTools();
  requestRender();
}

// a long press on my preset: share it (a link / QR code) or delete it
function presetMenu(p) {
  toast(`Пресет «${p.name}»`, 0, [["Поделиться", () => { hideToast(); showShare(p, toast); }],
    ["Удалить", () => deletePreset(p)], ["Отмена", hideToast]]);
}

// opened with a shared preset's link: add it to «Мои»
async function acceptSharedPreset() {
  const p = await presetFromAddress();
  if (!p) return false;
  toast(`Вам прислали пресет «${p.name}». Добавить в «Мои»?`, 0, [["Добавить", () => {
    const list = myPresets();
    let name = p.name;
    for (let i = 2; list.some((x) => x.name === name); i++) name = `${p.name} (${i})`;
    list.push({ name, values: p.values });
    if (storePresets(list)) toast(`Пресет «${name}» добавлен — он во вкладке «Мои»`, 3000);
    if (mineTab()) renderTools();
  }], ["Не надо", hideToast]]);
  return true;
}

function deletePreset(p) {
  toast(`Удалить пресет «${p.name}»?`, 0, [["Удалить", () => {
    storePresets(myPresets().filter((x) => x.name !== p.name));
    hideToast();
    renderTools();
  }], ["Отмена", hideToast]]);
}

function addVersion(name) {
  if (!app.original) return;
  const state = snapshot();
  if (app.versions.some((v) => v.state === state)) return;
  const v = { name: name || `Версия ${app.versions.length + 1}`, state, thumb: null };
  app.versions = [...app.versions, v].slice(-MAX_VERSIONS);
  app.thumbFor = v; // the next preview of this state becomes its picture
  session.save({ versions: app.versions });
  if (mineTab()) renderTools();
}

function openVersion(v) {
  app.pipeline = fromState(v.state);
  app.look = null;
  pushHistory();
  renderTools();
  requestRender();
  drawOverlay();
}

// --- «Фигура: Авто»: moderate values for the parts of the body actually in the frame ---------------------
// (MediaPipe pose landmarks and their visibility) — a head-and-shoulders selfie gets no «waist».
const POSE = { nose: 0, shoulders: [11, 12], elbows: [13, 14], hips: [23, 24], knees: [25, 26], ankles: [27, 28] };
function bodyAuto() {
  const pose = app.analysis?.poses?.[0];
  if (!app.analysis) return toast("Подождите — фото ещё анализируется");
  if (!pose) return toast("Фигура в кадре не найдена", 2500);
  const seen = (idx) => [].concat(idx).every((i) => (pose.vis?.[i] ?? 0) > 0.55 && pose.pts[2 * i + 1] < 1 && pose.pts[2 * i + 1] > 0);
  const vals = { waist: 0, hips: 0, arms: 0, legs: 0, length: 0, neck: 0 }, names = [];
  if (seen(POSE.shoulders) && seen(POSE.hips)) { vals.waist = 30; vals.hips = 15; names.push("талия", "бёдра"); }
  if (seen(POSE.elbows)) { vals.arms = 20; names.push("руки"); }
  if (seen(POSE.knees)) { vals.legs = 20; names.push("ноги"); }
  if (seen(POSE.ankles)) { vals.length = 15; names.push("длина ног"); }
  if (seen(POSE.shoulders) && seen(POSE.nose)) { vals.neck = 10; names.push("шея"); }
  if (!names.length) return toast("Тело почти не видно в кадре — подправлять нечего", 2500);
  Object.assign(app.pipeline.step("body").values, vals);
  pushHistory();
  renderTools();
  requestRender();
  toast(`Подправлено: ${names.join(", ")} — каждый ползунок можно изменить`, 3000);
}

// --- «Улучшить качество»: Real-ESRGAN x4 (face/analysis.js superResolve) ------------------------------
// The photo is scaled to a quarter of the result and the network draws the detail back 4x; mixed 70 %
// with a plain upscale and a fine grain — at 100 % skin looked painted. Best for small or blurry
// photos; a big sharp photo gets only the warning (and smoother skin) out of it.
const ENHANCE_MIX = 0.7;
function enhancePhoto() {
  if (!app.original) return;
  const long = Math.max(app.original.width, app.original.height);
  const outMax = /iPhone|iPad|iPod|Android/.test(navigator.userAgent) ? 2048 : 3072;
  const text = long > outMax * 1.1
    ? `Фото уже большое (${long} px): нейросеть сделает его ${outMax} px, дорисует резкость и смягчит кожу. Лучше всего — для маленьких и размытых фото.`
    : "Нейросеть дорисует мелкие детали и увеличит фото. Лучше всего — для маленьких и размытых фото.";
  toast(text, 0, [["Улучшить", () => runEnhance(Math.min(long, outMax / 4))], ["Отмена", hideToast]]);
}

async function runEnhance(inSide) {
  const before = app.file, name = app.name;
  $("busy").hidden = false;
  await ensureExtra("enhance");
  toast("Улучшаю качество… 0%", 0);
  try {
    const [sw, sh] = scaled(app.original, inSide), small = imageData(canvasOf(app.original), sw, sh);
    const sr = await superResolve(small, (p) => { $("toast").firstChild.textContent = `Улучшаю качество… ${Math.round(p * 100)}%`; });
    const plain = imageData(canvasOf(small), sr.width, sr.height), d = sr.data, b = plain.data;
    let seed = 11;
    const noise = () => { // fine monochrome grain (seeded): the network's skin is too clean
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return ((seed >> 8) % 1000) / 1000 - 0.5;
    };
    for (let i = 0; i < d.length; i += 4) {
      const g = noise() * 5;
      for (let c = 0; c < 3; c++) d[i + c] = b[i + c] + (d[i + c] - b[i + c]) * ENHANCE_MIX + g;
    }
    const c = canvasOf(sr), blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
    await openFile(new File([blob], `${name}_hd.jpg`, { type: "image/jpeg" }));
    toast(`Готово · ${sr.width}×${sr.height}`, 0, before ? [["Вернуть исходное", () => { hideToast(); openFile(before); }]] : []);
  } catch (err) {
    console.error(err);
    toast("Не удалось улучшить фото");
  }
  $("busy").hidden = true;
}

// --- «Пакет фото»: the current edit applied to many photos (core/batch.py on the desktop) ----------
// Each photo gets its own analysis (faces, parsing) and the same sliders — without what belongs to one
// photo (frame, brushes, object, chosen faces). Phones work at the light size (memory), computers at full.
function batchState() {
  const vals = portableValues(), p = Pipeline.fromOrder(ORDER);
  for (const st of p.steps) if (vals[st.op]) st.values = { ...vals[st.op] };
  return p.toJSON();
}

function startBatch() {
  if (!Object.keys(portableValues()).length)
    return toast("Сначала настройте одно фото как нравится — пакет применит те же правки к остальным", 4000);
  $("batch-files").value = "";
  $("batch-files").click();
}

let batchRunning = false;
$("batch-files").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  if (!files.length || batchRunning) return;
  batchRunning = true;
  const state = batchState(), out = [], phone = /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  const limit = phone ? EXPORT_PHONE : Math.floor(Math.sqrt(MAX_PIXELS));
  $("busy").hidden = false;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    toast(`Пакет: фото ${i + 1} из ${files.length}…`, 0);
    const id = 1e6 + Date.now() % 1e6 + i; // never the open photo's id
    try {
      const img = await decode(files[i]), [w, h] = scaled(img, limit), full = imageData(img, w, h);
      img.close?.();
      const a = await analyze(full);
      a.imageId = id;
      if (a.faces.length) await parseFaces(full, a.faces).catch(() => {});
      engine.setAnalysis(a);
      engine.setImage("batch", full, 1, id);
      const { image } = await engine.render("batch", state);
      engine.drop("batch");
      engine.forgetAnalysis(id);
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      c.getContext("2d").putImageData(image, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
      const name = (files[i].name || `photo_${i + 1}`).replace(/\.[^.]+$/, "");
      out.push(new File([blob], `${name}_kirson.jpg`, { type: "image/jpeg" }));
    } catch (err) {
      console.error(err);
      failed++;
      engine.drop("batch");
      engine.forgetAnalysis(id);
    }
  }
  $("busy").hidden = true;
  batchRunning = false;
  if (!out.length) return toast("Не удалось обработать фото");
  batchFiles = out;
  toast(`Готово: ${out.length} фото${failed ? `, не получилось: ${failed}` : ""}`, 0, [["Сохранить все", saveBatch]]);
});

// --- «Ретушь видео»: a short selfie video with the current edit (js/videoedit.js) --------------------
// Without an open photo (from the start screen) the natural look «Свежесть» is used.
let videoAudio = null, videoRunning = false;
function startVideo() {
  if (videoRunning) return;
  videoAudio?.close?.();
  videoAudio = audioContext(); // during the tap: iPhone allows sound only then
  $("video-file").value = "";
  $("video-file").click();
}
function videoState() {
  if (app.original && Object.keys(portableValues()).length) return batchState();
  const p = Pipeline.fromOrder(ORDER), vals = LOOKS["Свежесть"];
  for (const st of p.steps) if (vals[st.op]) st.values = { ...vals[st.op] };
  return p.toJSON();
}
$("btn-video").hidden = !videoEditSupported();
$("btn-video").onclick = startVideo;
$("video-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || videoRunning) return;
  videoRunning = true;
  const state = videoState(), phone = /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  $("busy").hidden = false;
  toast("Видео: обрабатываю кадры… 0%", 0);
  let id = 2e6 + (Date.now() % 1e6);
  try {
    const res = await editVideo(file, {
      longSide: phone ? 720 : 1080,
      audio: videoAudio,
      processFrame: async (img) => {
        id++;
        const a = await analyze(img);
        a.imageId = id;
        engine.setAnalysis(a);
        engine.setImage("vframe", img, 1, id);
        const { image } = await engine.render("vframe", state);
        engine.drop("vframe");
        engine.forgetAnalysis(id);
        return image;
      },
      onProgress: (stage, p) => {
        $("toast").firstChild.textContent = stage === "frames"
          ? `Видео: обрабатываю кадры… ${Math.round(p * 100)}%` : `Видео: собираю со звуком… ${Math.round(p * 100)}%`;
      },
    });
    savedFile = res.file;
    const notes = [res.cut ? "первые 15 с" : "", res.sound ? "" : "без звука"].filter(Boolean).join(", ");
    toast(`Видео готово · ${(res.file.size / 1048576).toFixed(1)} МБ${notes ? ` (${notes})` : ""}`, 0, [["Сохранить в Фото", shareSaved]]);
  } catch (err) {
    console.error(err);
    toast("Не удалось обработать видео");
    engine.drop("vframe");
  }
  $("busy").hidden = true;
  videoRunning = false;
});

let batchFiles = [];
async function saveBatch() {
  if (navigator.canShare && navigator.canShare({ files: batchFiles })) {
    try {
      await navigator.share({ files: batchFiles }); // iPhone: «Сохранить N изображений»
      hideToast();
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  for (const f of batchFiles) { // computers: ordinary downloads
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    await new Promise((r) => setTimeout(r, 300));
  }
  hideToast();
}

// «Сравнить версии»: «Сейчас» and the newest versions side by side (quick 640 px renders)
function compareVersions() {
  if (!app.preview) return;
  const now = snapshot();
  const items = [{ name: "Сейчас", state: now, thumb: null, current: true },
    ...[...app.versions].reverse().filter((v) => v.state !== now)];
  openCompare({
    items,
    render: async (state) => (await engine.render("fast", JSON.parse(state))).image,
    onPick: (it) => openVersion(it),
  });
}

function deleteVersion(v) {
  toast(`Удалить «${v.name}»?`, 0, [["Удалить", () => {
    app.versions = app.versions.filter((x) => x !== v);
    session.save({ versions: app.versions });
    hideToast();
    renderTools();
  }], ["Отмена", hideToast]]);
}

function versionThumb(image) {
  const k = 96 / Math.max(image.width, image.height), c = document.createElement("canvas");
  c.width = Math.round(image.width * k);
  c.height = Math.round(image.height * k);
  c.getContext("2d").drawImage(canvasOf(image), 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.75);
}

function mineTools() {
  const tools = [{ kind: "presetSave", label: "＋ Сохранить пресет" }];
  for (const p of myPresets()) tools.push({ kind: "myPreset", preset: p, label: p.name });
  tools.push({ kind: "versionSave", label: "＋ Запомнить версию" });
  if (app.versions.length) tools.push({ kind: "compare", label: "Сравнить версии" });
  tools.push({ kind: "batch", label: "Пакет фото" });
  if (videoEditSupported()) tools.push({ kind: "videoEdit", label: "Видео с этими правками" });
  for (const v of [...app.versions].reverse()) tools.push({ kind: "version", version: v, label: v.name });
  return tools;
}

// long press (iPhone has no right click): fn instead of the tap
function onLongPress(b, fn) {
  let timer = 0;
  b.addEventListener("pointerdown", () => {
    b.dataset.long = "";
    timer = setTimeout(() => { b.dataset.long = "1"; fn(); }, 550);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => clearTimeout(timer));
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}

async function runAuto() {
  if (!app.preview) return;
  if (!app.analysis) return toast("Подождите — фото ещё анализируется");
  $("busy").hidden = false;
  try {
    applyValues(await engine.auto("preview"));
    app.look = null;
    pushHistory();
    addVersion("Авто");
    renderTools();
    requestRender();
    toast("Подобрано под это фото — можно подправить на вкладках");
  } catch (err) {
    console.error(err);
  }
  $("busy").hidden = true;
}

function kindTool(t, b) {
  const on = (t.kind === "look" && app.look === t.name) || (t.kind === "strength" && app.tool === t);
  b.className = "tool" + (on ? " on" : "") + (t.kind === "auto" ? " accent" : "");
  b.innerHTML = `<span class="dot"></span>${t.label}`;
  if (t.kind === "version") {
    b.classList.add("version");
    if (snapshot() === t.version.state) b.classList.add("on");
    b.innerHTML = (t.version.thumb ? `<img alt="" src="${t.version.thumb}">` : `<span class="dot"></span>`)
      + `<span></span>`;
    b.lastChild.textContent = t.label;
  } else if (t.kind === "myPreset") {
    b.innerHTML = `<span class="dot"></span><span></span>`;
    b.lastChild.textContent = t.label; // the user's own text
  }
  if (t.kind === "version" || t.kind === "myPreset") {
    onLongPress(b, () => (t.kind === "version" ? deleteVersion(t.version) : presetMenu(t.preset)));
  }
  b.onclick = () => {
    if (b.dataset.long === "1") return;
    if (t.kind === "auto") return runAuto();
    if (t.kind === "enhance") return enhancePhoto();
    if (t.kind === "bodyAuto") return bodyAuto();
    if (t.kind === "smartFrame") return smartFrame();
    if (t.kind === "presetSave") return savePreset();
    if (t.kind === "myPreset") return applyPreset(t.preset);
    if (t.kind === "versionSave") {
      if (!app.original) return;
      const n = app.versions.length;
      addVersion();
      return toast(app.versions.length > n ? "Версия запомнена — нажмите на неё, чтобы вернуться" : "Такая версия уже есть");
    }
    if (t.kind === "version") return openVersion(t.version);
    if (t.kind === "compare") return compareVersions();
    if (t.kind === "batch") return startBatch();
    if (t.kind === "videoEdit") return startVideo();
    if (t.kind === "look") {
      app.look = t.name;
      app.tool = TABS[app.tab].tools.find((x) => x.kind === "strength");
      applyLook();
    } else if (t.kind === "preset") {
      app.look = null;
      applyValues(PRESETS[t.name]);
      pushHistory();
      addVersion(t.name);
      requestRender();
    } else if (t.kind === "reset") {
      app.look = null;
      applyValues({});
      pushHistory();
      requestRender();
    } else if (t.kind === "strength") app.tool = t;
    else if (t.kind === "aspect") setAspect(t.name);
    else if (t.kind === "brush") {
      Object.assign(app.brush, { tool: t.tool, mode: t.mode });
      if (!app.tool || !["brushSize", "brushStrength"].includes(app.tool.kind))
        app.tool = TABS[app.tab].tools.find((x) => x.kind === "brushSize");
      drawOverlay();
    } else if (t.kind === "brushSize" || t.kind === "brushStrength") app.tool = t;
    else if (t.kind === "facePick") {
      const n = app.analysis?.faces.length || 0;
      if (n < 2) toast(n ? "На фото одно лицо — правки и так только для него" : "Лица ещё ищутся…");
      else {
        app.facePick = !app.facePick;
        if (app.facePick) toast("Коснитесь лица, которое нужно править", 3000);
        drawOverlay();
      }
    } else if (t.kind === "objectPick") {
      app.objectPick = !app.objectPick;
      if (app.objectPick) toast("Коснитесь предмета или человека на фото", 3000);
    } else if (t.kind === "objectRemove") return removeObject();
    else if (t.kind === "objectClear") {
      Object.assign(app.pipeline.step("object").values, { x: -1, y: -1, remove: 0 });
      app.objectPick = false;
      pushHistory();
      requestRender();
      drawOverlay();
    } else if (t.kind === "faceAll") {
      app.pipeline.step("face_select").values.faces = [];
      app.facePick = false;
      pushHistory();
      requestRender();
      drawOverlay();
      toast("Правки — для всех лиц", 2000);
    }
    else if (t.kind === "faceBrush") { // to «Кисти» with this brush
      app.brush.tool = t.tool;
      app.brush.mode = t.mode;
      if (t.tool === "heal") app.brush.size = Math.min(app.brush.size, 8); // a spot: a small brush
      selectTab(TABS.findIndex((x) => x.name === "Кисти"));
      app.tool = TABS[app.tab].tools.find((x) => x.kind === "brushSize");
      renderTools();
      $("tools").querySelector(".tool.on")?.scrollIntoView({ inline: "center", block: "nearest" }); // the chosen brush in view
      toast(t.tool === "heal" ? "Коснитесь пятна пальцем — оно исчезнет. Два пальца — приблизить"
        : t.mode === 0 ? "Проведите пальцем там, где сгладить кожу. Два пальца — приблизить"
          : "Проведите там, где сглаживание не нужно: родинка, ресницы, контур губ", 3500);
      return;
    }
    else if (t.kind === "brushClear") {
      app.pipeline.step(app.brush.tool).values[brushParam()] = [];
      pushHistory();
      requestRender();
      drawOverlay();
    }
    else if (t.kind === "rotate") editFrame({ rot90: ((frameValues().rot90 || 0) + 1) % 4, x0: 0, y0: 0, x1: 1, y1: 1 }, true);
    else if (t.kind === "flip") {
      const f = frameValues();
      editFrame({ flip: f.flip >= 0.5 ? 0 : 1, x0: 1 - (f.x1 ?? 1), x1: 1 - (f.x0 ?? 0) });
    } else if (t.kind === "frameReset") {
      app.aspect = "Свободно";
      editFrame({ rot90: 0, flip: 0, angle: 0, x0: 0, y0: 0, x1: 1, y1: 1 });
    }
    renderTools();
  };
  if (t.kind === "aspect" && app.aspect === t.name) b.classList.add("on");
  if (t.kind === "facePick" && app.facePick) b.classList.add("on");
  if (t.kind === "objectPick" && app.objectPick) b.classList.add("on");
  if (t.kind === "facePick") {
    const sel = selectedFaces(app.pipeline.step("face_select").values);
    if (sel.length) b.innerHTML = `<span class="dot"></span>Лица: ${sel.map((i) => i + 1).join(", ")}`;
    b.classList.toggle("changed", sel.length > 0);
  }
  if (t.kind === "brush" && app.brush.tool === t.tool && app.brush.mode === t.mode) b.classList.add("on");
  if ((t.kind === "brushSize" || t.kind === "brushStrength") && app.tool === t) b.classList.add("on");
}

// filter buttons show the photo with that filter (a 64 px square around the face), made once per photo
const thumbs = { id: -1, base: null, urls: new Map() };
function filterThumbFor(k) {
  if (!app.preview) return null;
  if (thumbs.id !== app.imageId) {
    const W = app.preview.width, H = app.preview.height, side = Math.min(W, H) * 0.6;
    const f = app.analysis?.faces?.[0];
    let cx = W / 2, cy = H / 2;
    if (f) {
      let sx = 0, sy = 0;
      for (let i = 0; i < f.pts.length; i += 2) { sx += f.pts[i]; sy += f.pts[i + 1]; }
      cx = (sx / (f.pts.length / 2)) * W; cy = (sy / (f.pts.length / 2)) * H;
    }
    const x0 = Math.max(0, Math.min(W - side, cx - side / 2)), y0 = Math.max(0, Math.min(H - side, cy - side / 2));
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(canvasOf(app.preview), x0, y0, side, side, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data, rgb = new Uint8ClampedArray(64 * 64 * 3);
    for (let i = 0; i < 64 * 64; i++) for (let ch = 0; ch < 3; ch++) rgb[3 * i + ch] = d[4 * i + ch];
    Object.assign(thumbs, { id: app.imageId, base: { w: 64, h: 64, data: rgb }, urls: new Map(), face: !!f });
  }
  if (!thumbs.face && app.analysis?.faces?.length) thumbs.id = -1; // the face is known now: centre on it
  if (!thumbs.urls.has(k)) {
    const out = filterThumb(thumbs.base, FILTER_NAMES[k]), c = document.createElement("canvas");
    c.width = c.height = 64;
    const id = c.getContext("2d").createImageData(64, 64);
    for (let i = 0; i < 64 * 64; i++) {
      for (let ch = 0; ch < 3; ch++) id.data[4 * i + ch] = out.data[3 * i + ch];
      id.data[4 * i + 3] = 255;
    }
    c.getContext("2d").putImageData(id, 0, 0);
    thumbs.urls.set(k, c.toDataURL("image/jpeg", 0.8));
  }
  return thumbs.urls.get(k);
}

// --- tool buttons: volumetric glass tiles (an icon, a colour or a glass orb over the label) ---------
const css = (rgb) => `rgb(${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(",")})`;
const labCss = (L, a, b) => css([...labToRgb({ w: 1, h: 1, c: 3, data: Float32Array.of(L, a, b) }).data]);
// the colour a colour choice applies (null: not a colour, or «none»)
function swatch(t) {
  const key = `${t.op}.${t.param}`;
  if (key === "makeup.lip_color") { const [L, a, b] = Object.values(LIP_COLORS)[t.option]; return labCss(L, a, b); }
  if (key === "makeup.blush_color") { const [a, b] = Object.values(BLUSH_COLORS)[t.option]; return labCss(66, a, b); }
  if (key === "makeup.shadow_color") { const [L, a, b] = Object.values(SHADOW_COLORS)[t.option]; return labCss(L, a, b); }
  if (key === "makeup.iris_color") { const [L, a, b] = Object.values(EYE_COLORS)[t.option]; return labCss(L, a, b); }
  if (key === "hair.color" && t.option > 0) { const [L, a, b] = HAIR_COLORS[HAIR_NAMES[t.option]]; return labCss(L, a, b); }
  if (key === "background.replace") {
    const n = REPLACE[t.option];
    if (PLAIN[n]) return css(PLAIN[n]);
    if (n === "Студийный градиент") return `linear-gradient(160deg, ${css(GRADIENT[0])}, ${css(GRADIENT[1])})`;
  }
  return null;
}
// looks: an orb hue from the name, kept in the brand's warm range (rose → coral → gold)
const hueOf = (s) => (310 + ([...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7) % 110)) % 360;
// long words in narrow tiles: a soft hyphen after a vowel near the middle (browsers on Windows do
// not hyphenate Russian themselves)
const VOWEL = /[аеёиоуыэюяaeiouy]/i;
function softHyphens(word) {
  if (word.length < 10) return word;
  let best = -1;
  for (let i = 3; i <= word.length - 4; i++)
    if (VOWEL.test(word[i - 1]) && !VOWEL.test(word[i]) && (best < 0 || Math.abs(i - word.length / 2) < Math.abs(best - word.length / 2))) best = i;
  return best < 0 ? word : word.slice(0, best) + "\u00AD" + word.slice(best);
}
const plainLabel = (s) => s.replace(/^[✦＋↺⟳]\s*/, "").split(" ").map(softHyphens).join(" ");

// --- «новое»: what a new feature does, once, on its first tap ------------------------------------------
const TIPS = {
  compare: "Сравните до четырёх версий рядом и вернитесь к лучшей.",
  batch: "Настройте одно фото — пакет применит те же правки к любому количеству снимков.",
  videoEdit: "Ретушь видео до 15 секунд с этими правками — звук сохраняется.",
  enhance: "Нейросеть дорисует детали маленьким и размытым фото и увеличит их.",
  presetSave: "Сохраните правки как свой пресет — он работает с любым фото. Удерживайте пресет, чтобы поделиться им.",
  objectRemove: "Нейросеть уберёт выделенный предмет и дорисует фон.",
  "hair.thick": "Затягивает просветы и пробор — волосы выглядят гуще.",
  "relight.amount": "Мягкий студийный свет на лицо — направление выбирается кнопками «Свет: …».",
  "makeup.shadow": "Тени для век — оттенок выбирается цветными кнопками рядом.",
  "makeup.mascara": "Ресницы темнее и гуще — кожа века не красится.",
  "makeup.highlight": "Перламутровый блеск на скулах, носу и над губой.",
  "makeup.iris": "Новый цвет глаз — рисунок радужки и блик сохраняются.",
  "freckles.amount": "Влево — убрать веснушки, вправо — добавить естественные на нос и щёки.",
  bodyAuto: "Мягко подправит только те части фигуры, что видны в кадре.",
  faceBrush: "Сглаживание и пятна вручную: проведите пальцем там, где нужно, — или где сглаживание лишнее.",
  smartFrame: "Кадрирует по правилам портрета: глаза на верхней трети, место по направлению взгляда.",
  "btn-video": "Ретушь видео до 15 секунд: кожа, тон и цвет в каждом кадре, звук сохраняется.",
  "btn-camera": "Камера подскажет, как встать к свету и держать телефон, — и снимет лучший кадр.",
};
const TIPS_KEY = "kirson-tips";
let tipTimer = 0;
function showTip(text) {
  let el = document.getElementById("tip");
  if (!el) {
    el = document.createElement("div");
    el.id = "tip";
    el.className = "tip glass";
    el.onclick = () => el.remove();
    document.body.appendChild(el);
  }
  el.textContent = text;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => el.remove(), 5000);
}
function tipsSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(TIPS_KEY)) || []); } catch { return new Set(); }
}
const tipKey = (t) => (t.kind ? t.kind : `${t.op}.${t.param}`);
function badge(b, key) {
  if (!TIPS[key] || tipsSeen().has(key)) return;
  b.dataset.tip = key;
  const s = document.createElement("span");
  s.className = "newbadge";
  s.textContent = "новое";
  b.appendChild(s);
}
// the first tap: the tip (the action itself goes on as usual)
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-tip]");
  if (!b) return;
  const key = b.dataset.tip, seen = tipsSeen();
  delete b.dataset.tip;
  b.querySelector(".newbadge")?.remove();
  if (seen.has(key)) return;
  seen.add(key);
  try { localStorage.setItem(TIPS_KEY, JSON.stringify([...seen])); } catch { /* private mode */ }
  showTip(TIPS[key]); // its own bubble: the action's messages (questions with buttons) stay visible
}, true);
for (const id of ["btn-video", "btn-camera"]) badge($(id), id);

function decorate(b, t, label) {
  if (b.classList.contains("thumb") || b.classList.contains("version")) return;
  const on = b.classList.contains("on");
  b.classList.add("tile");
  const ico = document.createElement("span"), lbl = document.createElement("span"), dot = document.createElement("span");
  ico.className = "ico";
  lbl.className = "lbl";
  dot.className = "dot";
  lbl.textContent = plainLabel(label);
  const color = t.op && swatch(t);
  if (color) {
    ico.classList.add("swatch");
    ico.style.background = color;
  } else if (t.kind === "look") {
    ico.classList.add("orb");
    ico.style.setProperty("--h", hueOf(t.name));
  } else if (t.kind === "aspect" && /\d/.test(t.name)) {
    ico.classList.add("text");
    ico.textContent = t.name;
  } else if (t.kind === "rotate") {
    ico.innerHTML = iconFor(t);
    lbl.textContent = "90°";
  } else ico.innerHTML = iconFor(t);
  if (t.op === "hair" && t.param === "color" && t.option === 0) ico.innerHTML = iconFor({ kind: "reset" });
  if (t.op === "background" && t.param === "replace" && !color) ico.innerHTML = iconFor(t.option ? { op: "skin_natural", param: "volume" } : { kind: "reset" });
  b.replaceChildren(ico, lbl, dot);
  b.classList.toggle("on", on);
  badge(b, tipKey(t));
}

function renderTools() {
  const row = $("tools");
  row.innerHTML = "";
  for (const t of TABS[app.tab].tools) {
    const b = document.createElement("button");
    row.appendChild(b);
    if (t.kind) {
      kindTool(t, b);
      decorate(b, t, t.label);
      continue;
    }
    const p = paramOf(t), v = values(t.op)[t.param];
    const isChoice = t.option !== undefined;
    const on = isChoice ? v === t.option : app.tool === t;
    const changed = !isChoice && v !== p.def;
    b.className = "tool" + (on ? " on" : "") + (changed ? " changed" : "");
    b.innerHTML = `<span class="dot"></span>${toolLabel(t)}`;
    const thumb = t.op === "filter" && t.param === "style" && filterThumbFor(t.option);
    if (thumb) {
      b.classList.add("thumb");
      b.innerHTML = `<img alt="" src="${thumb}"><span>${toolLabel(t)}</span>`;
    }
    b.onclick = () => {
      if (t.action === "pickBackground") return $("bg-file").click();
      if (isChoice) {
        setValue(t.op, t.param, t.option);
        pushHistory();
        requestRender();
      } else app.tool = t;
      renderTools();
    };
    decorate(b, t, toolLabel(t));
  }
  if (tabChanged()) {
    const b = document.createElement("button");
    b.className = "tool reset-tab";
    b.onclick = resetTab;
    row.appendChild(b);
    decorate(b, { kind: "reset" }, "Сбросить вкладку");
  }
  renderSlider();
}

function renderSlider() {
  const t = app.tool, s = $("slider");
  $("slider-row").style.visibility = t ? "visible" : "hidden";
  const hint = mineTab() ? (app.versions.length || myPresets().length
    ? "Нажмите — применить, удерживайте — удалить"
    : "Пресеты — для любого фото, версии — для этого") : "";
  $("panel-hint").hidden = !hint;
  $("panel-hint").textContent = hint;
  if (!t) return;
  $("tool-reset").hidden = !!t.kind;
  if (t.kind === "brushSize" || t.kind === "brushStrength") {
    const key = t.kind === "brushSize" ? "size" : "strength";
    s.min = 1;
    s.max = 100;
    s.value = app.brush[key];
    $("tool-label").textContent = t.label;
    $("tool-value").textContent = `${app.brush[key]}`;
    return;
  }
  if (t.kind === "strength") {
    s.min = 0;
    s.max = 150;
    s.value = app.lookStrength;
    $("tool-label").textContent = app.look ? `${app.look}` : "Сила образа";
    $("tool-value").textContent = `${app.lookStrength}`;
    return;
  }
  const p = paramOf(t);
  s.min = p.min;
  s.max = p.max;
  s.value = values(t.op)[t.param];
  $("tool-label").textContent = toolLabel(t);
  $("tool-value").textContent = s.value;
  $("tool-reset").hidden = false;
  $("tool-reset").disabled = Number(s.value) === p.def;
}

// «↺» next to the slider: the current effect back to its default (one undo step)
$("tool-reset").addEventListener("click", () => {
  const t = app.tool;
  if (!t || t.kind) return;
  setValue(t.op, t.param, paramOf(t).def);
  pushHistory();
  renderTools();
  requestRender();
  toast(`«${toolLabel(t)}» отменено`, 1500);
});

// the sliders of a tab back to their defaults (choices too: filter «Нет», hair colour …)
function tabChanged(tab = TABS[app.tab]) {
  return tab.tools.some((t) => t.op && !t.kind && values(t.op)[t.param] !== paramOf(t).def);
}
function resetTab() {
  const tab = TABS[app.tab];
  for (const t of tab.tools) if (t.op && !t.kind) setValue(t.op, t.param, paramOf(t).def);
  pushHistory();
  renderTools();
  requestRender();
  toast(`Вкладка «${tab.name}» сброшена — вернуть можно стрелкой назад`, 2200);
}

$("slider").addEventListener("input", (e) => {
  const t = app.tool;
  if (!t) return;
  const v = Number(e.target.value);
  if (t.kind === "brushSize" || t.kind === "brushStrength") {
    app.brush[t.kind === "brushSize" ? "size" : "strength"] = v;
    $("tool-value").textContent = v;
    if (t.kind === "brushSize") previewRing(); // the real size on the photo, live
    return;
  }
  if (t.kind === "strength") {
    app.lookStrength = v;
    $("tool-value").textContent = v;
    app.dragging = true;
    if (app.look) applyLook(false);
    return;
  }
  setValue(t.op, t.param, v);
  $("tool-value").textContent = v;
  $("tool-reset").disabled = v === paramOf(t).def;
  app.dragging = true;
  requestRender();
});
$("slider").addEventListener("change", () => {
  app.dragging = false;
  pushHistory();
  renderTools();
  requestRender(); // full-quality preview
});
$("tool-value").addEventListener("click", () => {
  const t = app.tool;
  if (!t) return;
  if (t.kind === "strength") {
    app.lookStrength = 100;
    applyLook();
    renderSlider();
    return;
  }
  setValue(t.op, t.param, paramOf(t).def);
  pushHistory();
  renderTools();
  requestRender();
});

// --- rendering ---------------------------------------------------------------------------------
const frameTab = () => TABS[app.tab].name === "Кадр";
const brushTab = () => TABS[app.tab].name === "Кисти";
const objectTab = () => TABS[app.tab].name === "Объект";
const mineTab = () => TABS[app.tab].name === "Мои";
const frameValues = () => app.pipeline.step("crop").values;

function previewState() {
  const st = app.pipeline.toJSON();
  if (frameTab()) { // the editor shows the whole (rotated) photo with the frame over it
    const c = st.steps.find((s) => s.op === "crop");
    c.values = { ...c.values, x0: 0, y0: 0, x1: 1, y1: 1 };
  }
  if (brushTab() || objectTab() || app.facePick) st.steps.find((s) => s.op === "crop").enabled = false; // whole-photo coordinates
  return st;
}

// While a slider moves, the full-quality preview is kept when this device renders it fast enough (the
// 640 px quick copy, stretched over the screen, made the whole face look blurred and hard to judge);
// only slow renders fall back to the quick copy. Times are learned from the last renders per key.
const renderMs = {};
const SHARP_WHILE_DRAGGING_MS = 900;
// the 2048 px copy for zoomed-in work, made when first needed (phones: memory)
function ensureDetail(source = null) {
  if (!app.detailWidth || app.detailReady || !app.original) return;
  const W = app.original.width, H = app.original.height, [dw, dh] = scaled({ width: W, height: H }, DETAIL);
  const tmp = source ? null : canvasOf(app.original);
  engine.setImage("detail", imageData(source || tmp, dw, dh), dw / W, app.imageId);
  if (tmp) tmp.width = tmp.height = 0;
  app.detailReady = true;
}

function requestRender() {
  if (!app.preview) return;
  const full = zoom.s > 1.5 && app.detailWidth ? "detail" : "preview";
  if (full === "detail") ensureDetail();
  const key = app.dragging && (renderMs[full] ?? 0) > SHARP_WHILE_DRAGGING_MS ? "fast" : full;
  engine.preview(key, previewState(), app.split ? "always" : true);
}

engine.onPreview = (image, ms, before, key) => {
  if (key !== "fast") renderMs[key] = renderMs[key] === undefined ? ms : renderMs[key] * 0.6 + ms * 0.4;
  app.result = image;
  app.before = before;
  if (app.thumbFor && key !== "fast" && snapshot() === app.thumbFor.state) {
    app.thumbFor.thumb = versionThumb(image);
    app.thumbFor = null;
    session.save({ versions: app.versions });
    if (mineTab()) renderTools();
  }
  // a quick low-res render is drawn over the current canvas size (no jumps in size)
  app.fastScale = key === "fast" ? (zoom.s > 1.5 && app.detailWidth ? app.detailWidth : app.preview.width) / app.fastWidth : 1;
  if (!beforeHeld) show(image);
  updateSplit(true);
  $("busy").hidden = true;
  updateFrame();
  drawOverlay();
  console.debug(`preview ${ms.toFixed(0)} ms`);
};

function show(image) {
  const k = app.fastScale || 1, w = Math.round(image.width * k), h = Math.round(image.height * k);
  if (view.width !== w || view.height !== h) {
    view.width = w;
    view.height = h;
    fitCanvas();
  }
  if (image.width === view.width) vctx.putImageData(image, 0, 0);
  else createImageBitmap(image).then((bmp) => vctx.drawImage(bmp, 0, 0, view.width, view.height));
}

// --- zoom: pinch, pan, double tap, wheel ------------------------------------------------------
// The photo box gets translate + scale; the canvas has a fixed on-screen "fit" size, so the
// higher-resolution render used when zoomed in replaces it without any jump.
const stage = $("stage"), box = $("frame-box"), fitBtn = $("btn-fit");
const zoom = { s: 1, tx: 0, ty: 0 };
const applied = { tx: 0, ty: 0 }; // the transform currently on screen

function fitCanvas() {
  if (view.hidden || !view.width) return;
  const r = stage.getBoundingClientRect(), pad = 20;
  const k = Math.min((r.width - pad) / view.width, (r.height - pad) / view.height);
  view.style.width = `${Math.floor(view.width * k)}px`;
  view.style.height = `${Math.floor(view.height * k)}px`;
  updateSplit(true);
  clampZoom();
  applyZoom();
}

function clampZoom() {
  zoom.s = Math.min(MAX_ZOOM, Math.max(1, zoom.s));
  const w = box.offsetWidth, h = box.offsetHeight;
  zoom.tx = Math.min(0, Math.max(w * (1 - zoom.s), zoom.tx));
  zoom.ty = Math.min(0, Math.max(h * (1 - zoom.s), zoom.ty));
  if (zoom.s === 1) zoom.tx = zoom.ty = 0;
}

let detailWanted = false;
function applyZoom() {
  box.style.transform = zoom.s === 1 ? "" : `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})`;
  box.style.setProperty("--zinv", String(1 / zoom.s));
  applied.tx = zoom.s === 1 ? 0 : zoom.tx;
  applied.ty = zoom.s === 1 ? 0 : zoom.ty;
  fitBtn.hidden = zoom.s <= 1.01;
  const want = zoom.s > 1.5;
  if (want !== detailWanted) { // sharper render once the zoom crosses 1.5x
    detailWanted = want;
    clearTimeout(applyZoom.t);
    applyZoom.t = setTimeout(requestRender, 250);
  }
}

// zoom by factor f keeping the screen point (cx, cy) in place
function zoomAt(cx, cy, s) {
  // The box's untransformed position (the rect includes the transform on screen right now,
  // which during a pinch is not the `zoom` state being computed), then the point under
  // (cx, cy) in unscaled box coordinates for the current `zoom` state.
  const o = box.getBoundingClientRect();
  const ox = o.left - applied.tx, oy = o.top - applied.ty;
  const lx = (cx - ox - zoom.tx) / zoom.s, ly = (cy - oy - zoom.ty) / zoom.s;
  const ns = Math.min(MAX_ZOOM, Math.max(1, s));
  zoom.tx += (zoom.s - ns) * lx;
  zoom.ty += (zoom.s - ns) * ly;
  zoom.s = ns;
  clampZoom();
  applyZoom();
}

function resetZoom() {
  Object.assign(zoom, { s: 1, tx: 0, ty: 0 });
  applyZoom();
}
fitBtn.onclick = resetZoom;

const pointers = new Map();
let gesture = null, lastTap = { t: 0, x: 0, y: 0 };
stage.addEventListener("pointerdown", (e) => {
  if (view.hidden || frameTab() || e.target.closest("button") || e.target.closest("#frame") || e.target.closest("#split-line")) return;
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const ps = [...pointers.values()];
  if (ps.length === 2 && gesture?.kind === "stroke") cancelStroke(); // two fingers: zoom, not paint
  if (ps.length === 1 && brushTab()) {
    startStroke(e.clientX, e.clientY);
    gesture = { kind: "stroke" };
  } else if (ps.length === 2) {
    gesture = { kind: "pinch", d0: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), s0: zoom.s,
      mx: (ps[0].x + ps[1].x) / 2, my: (ps[0].y + ps[1].y) / 2, tx: zoom.tx, ty: zoom.ty };
  } else if (ps.length === 1) {
    gesture = { kind: "pan", x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty, moved: false };
  }
});
stage.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const ps = [...pointers.values()];
  if (gesture?.kind === "stroke") {
    moveStroke(e.clientX, e.clientY);
  } else if (gesture?.kind === "pinch" && ps.length >= 2) {
    const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
    const mx = (ps[0].x + ps[1].x) / 2, my = (ps[0].y + ps[1].y) / 2;
    // restore the start, then zoom around the start midpoint and follow the fingers' movement
    Object.assign(zoom, { s: gesture.s0, tx: gesture.tx, ty: gesture.ty });
    zoomAt(gesture.mx, gesture.my, gesture.s0 * (d / Math.max(gesture.d0, 1)));
    zoom.tx += mx - gesture.mx;
    zoom.ty += my - gesture.my;
    clampZoom();
    applyZoom();
  } else if (gesture?.kind === "pan") {
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    if (Math.hypot(dx, dy) > 6) gesture.moved = true;
    if (zoom.s > 1) {
      zoom.tx = gesture.tx + dx;
      zoom.ty = gesture.ty + dy;
      clampZoom();
      applyZoom();
    }
  }
});
const pointerEnd = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture?.kind === "stroke") {
    endStroke();
    gesture = null;
    return;
  }
  if (gesture?.kind === "pan" && !gesture.moved && e.type === "pointerup" && app.objectPick) {
    pickObject(...toPhoto(e.clientX, e.clientY));
    gesture = null;
    return;
  }
  if (gesture?.kind === "pan" && !gesture.moved && e.type === "pointerup" && app.facePick) {
    toggleFaceAt(...toPhoto(e.clientX, e.clientY));
    gesture = null;
    return;
  }
  if (gesture?.kind === "pan" && !gesture.moved && e.type === "pointerup" && !brushTab()) {
    const now = performance.now(); // double tap: zoom in at the point / back to the whole photo
    if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      if (zoom.s > 1.01) resetZoom();
      else zoomAt(e.clientX, e.clientY, 2.5);
      lastTap.t = 0;
    } else lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
  if (pointers.size === 1 && gesture?.kind === "pinch") { // one finger stays: continue as a pan
    const [p] = [...pointers.values()];
    gesture = { kind: "pan", x: p.x, y: p.y, tx: zoom.tx, ty: zoom.ty, moved: true };
  } else if (!pointers.size) gesture = null;
};
stage.addEventListener("pointerup", pointerEnd);
stage.addEventListener("pointercancel", pointerEnd);
stage.addEventListener("wheel", (e) => {
  if (view.hidden || frameTab()) return;
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, zoom.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
}, { passive: false });
// iPhone Safari: no page zoom on pinch (the photo zooms instead)
document.addEventListener("gesturestart", (e) => e.preventDefault());
window.addEventListener("resize", fitCanvas);

// --- before / after split ----------------------------------------------------------------------
const beforeView = $("before-view"), splitLine = $("split-line"), splitBtn = $("btn-split");
const splitAllowed = () => !frameTab() && !brushTab() && !view.hidden;

// redraw: the original (in the result's frame) over the result, clipped right of the divider
function updateSplit(redraw = false) {
  const on = app.split && splitAllowed() && !!app.preview;
  beforeView.hidden = splitLine.hidden = !on;
  splitBtn.classList.toggle("on", app.split);
  if (!on) return;
  if (redraw || beforeView.width !== view.width) {
    beforeView.width = view.width;
    beforeView.height = view.height;
    const src = app.before || app.preview;
    beforeView.getContext("2d").drawImage(canvasOf(src), 0, 0, view.width, view.height);
  }
  Object.assign(beforeView.style, { width: view.style.width, height: view.style.height,
    left: `${view.offsetLeft}px`, top: `${view.offsetTop}px`,
    clipPath: `inset(0 ${(1 - app.splitPos) * 100}% 0 0)` });
  Object.assign(splitLine.style, { left: `${view.offsetLeft + app.splitPos * view.offsetWidth}px`,
    top: `${view.offsetTop}px`, height: `${view.offsetHeight}px` });
}

splitBtn.onclick = () => {
  app.split = !app.split;
  if (app.split && !splitAllowed()) toast("Шторка работает на остальных вкладках", 2000);
  updateSplit(true);
  if (app.split) requestRender(); // the original at the current render size (sharp when zoomed)
};
let splitDrag = false;
splitLine.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  splitLine.setPointerCapture(e.pointerId);
  splitDrag = true;
});
splitLine.addEventListener("pointermove", (e) => {
  if (!splitDrag) return;
  const r = view.getBoundingClientRect(); // includes the zoom
  app.splitPos = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  updateSplit();
});
const splitEnd = () => (splitDrag = false);
splitLine.addEventListener("pointerup", splitEnd);
splitLine.addEventListener("pointercancel", splitEnd);

// --- brushes: strokes in the photo's own coordinates -------------------------------------------
const ring = $("ring"), overlay = $("overlay");
let stroke = null;

const brushRadius = () => 0.005 + ((app.brush.size - 1) / 99) * 0.195; // of the long side

function toPhoto(cx, cy) {
  const r = view.getBoundingClientRect(); // includes the zoom
  return [(cx - r.left) / r.width, (cy - r.top) / r.height];
}

function showRing(cx, cy) {
  const r = view.getBoundingClientRect(), st = stage.getBoundingClientRect();
  const d = 2 * brushRadius() * Math.max(r.width, r.height);
  Object.assign(ring.style, { left: `${cx - st.left}px`, top: `${cy - st.top}px`, width: `${d}px`, height: `${d}px` });
  ring.hidden = false;
}

// while the size slider moves: the brush circle at its real size in the middle of the visible photo
let ringTimer = 0;
function previewRing() {
  if (view.hidden) return;
  const r = view.getBoundingClientRect(), st = stage.getBoundingClientRect();
  const x0 = Math.max(r.left, st.left), x1 = Math.min(r.right, st.right);
  const y0 = Math.max(r.top, st.top), y1 = Math.min(r.bottom, st.bottom);
  ring.classList.add("preview");
  showRing((x0 + x1) / 2, (y0 + y1) / 2);
  clearTimeout(ringTimer);
  ringTimer = setTimeout(() => {
    ring.classList.remove("preview");
    if (!stroke) ring.hidden = true;
  }, 1200);
}

// the hidden parameter holding a brush tool's strokes («Кожа» keeps its own as `brush`)
const brushParam = () => (app.brush.tool === "skin" ? "brush" : "strokes");
function strokesOfTool() {
  const st = app.pipeline.step(app.brush.tool), k = brushParam();
  return (st.values[k] ||= []);
}

function startStroke(cx, cy) {
  const [x, y] = toPhoto(cx, cy);
  stroke = [app.brush.mode, brushRadius(), app.brush.strength / 100, x, y];
  app.pipeline.step(app.brush.tool).values[brushParam()] = [...strokesOfTool(), stroke];
  app.dragging = app.brush.tool !== "heal"; // the patch looks right only in full quality
  showRing(cx, cy);
  requestRender();
  drawOverlay();
}

function moveStroke(cx, cy) {
  if (!stroke) return;
  showRing(cx, cy);
  const [x, y] = toPhoto(cx, cy), n = stroke.length;
  if (Math.hypot(x - stroke[n - 2], y - stroke[n - 1]) < stroke[1] * 0.08) return; // jitter
  stroke.push(x, y);
  app.pipeline.step(app.brush.tool).values[brushParam()] = [...strokesOfTool()]; // a new array: re-render
  if (app.brush.tool !== "heal") requestRender();
  drawOverlay();
}

function endStroke() {
  ring.hidden = true;
  if (!stroke) return;
  stroke = null;
  app.dragging = false;
  pushHistory(); // one stroke = one undo step
  requestRender();
}

function cancelStroke() {
  ring.hidden = true;
  if (!stroke) return;
  const list = strokesOfTool();
  app.pipeline.step(app.brush.tool).values[brushParam()] = list.filter((s) => s !== stroke);
  stroke = null;
  app.dragging = false;
  requestRender();
  drawOverlay();
}

// painted mask corrections, tinted by layer, while the «Маски» brushes are selected
const LAYER_COLORS = ["rgba(230,60,60,0.38)", "rgba(250,200,60,0.38)", "rgba(90,200,90,0.38)", "rgba(60,140,230,0.38)"];
const SKIN_COLORS = ["rgba(90,200,120,0.32)", "rgba(230,80,80,0.32)"]; // smooth here / keep the texture here
const objectConfs = new Map(); // tapped point -> magic-touch mask (for the outline)

async function pickObject(x, y) {
  if (x < 0 || y < 0 || x > 1 || y > 1) return;
  app.objectPick = false;
  $("busy").hidden = false;
  try {
    await ensureExtra("object");
    const conf = await objectMask(app.original, x, y);
    objectConfs.set(objectKey(x, y), conf);
    engine.setObjectMask(x, y, conf);
    Object.assign(app.pipeline.step("object").values, { x, y, remove: 0 });
    pushHistory();
    renderTools();
    requestRender();
    drawOverlay();
    toast("Объект выбран — двигайте ползунки", 2500);
  } catch (err) {
    console.error(err);
    toast("Не удалось выделить объект");
  }
  $("busy").hidden = true;
}

// «Удалить объект»: only by this button, after the outline was shown (magic touch sometimes takes
// more than meant). The fill is made once per object and kept.
const objectFills = new Map();
async function fillFor(x, y) {
  const key = objectKey(x, y);
  if (!objectFills.has(key)) {
    let conf = objectConfs.get(key);
    if (!conf) {
      conf = await objectMask(app.original, x, y);
      objectConfs.set(key, conf);
    }
    const fill = await removeFill(app.original, conf);
    if (!fill) throw new Error("empty object");
    objectFills.set(key, fill);
    engine.setObjectFill(x, y, fill);
  }
  return objectFills.get(key);
}

async function removeObject() {
  const v = app.pipeline.step("object").values;
  if (!(v.x >= 0)) return toast("Сначала выберите объект на фото", 2500);
  if (v.remove >= 0.5) return toast("Объект уже удалён — отменить можно стрелкой назад", 2500);
  const [x, y] = [v.x, v.y];
  $("busy").hidden = false;
  await ensureExtra("remove");
  toast("Удаляю объект…", 0);
  try {
    await fillFor(x, y);
    const o = app.pipeline.step("object").values;
    if (o.x === x && o.y === y) {
      o.remove = 1;
      pushHistory();
      renderTools();
      requestRender();
      drawOverlay();
    }
    toast("Объект удалён", 2000);
  } catch (err) {
    console.error(err);
    toast("Не удалось удалить объект");
  }
  $("busy").hidden = true;
}

// outline of the selected object (cached per selection)
let outlineCache = { key: "", canvas: null };
function drawObjectOutline(g, W, H) {
  const v = app.pipeline.step("object").values, key = objectKey(v.x ?? -1, v.y ?? -1), conf = objectConfs.get(key);
  if (!conf || !(v.x >= 0) || v.remove >= 0.5) return; // removed: nothing to outline
  if (outlineCache.key !== key) {
    const c = document.createElement("canvas");
    c.width = conf.w;
    c.height = conf.h;
    const id = c.getContext("2d").createImageData(conf.w, conf.h), d = conf.data, w = conf.w;
    for (let y = 1; y < conf.h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, inside = d[i] > 0.5;
        if (!inside) continue;
        if (d[i - 1] > 0.5 && d[i + 1] > 0.5 && d[i - w] > 0.5 && d[i + w] > 0.5) continue;
        id.data.set([255, 214, 64, 255], 4 * i);
      }
    c.getContext("2d").putImageData(id, 0, 0);
    outlineCache = { key, canvas: c };
  }
  g.imageSmoothingEnabled = false;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) g.drawImage(outlineCache.canvas, dx, dy, W, H); // a bit thicker
}

function toggleFaceAt(x, y) {
  const faces = app.analysis?.faces || [];
  let best = -1, bestD = Infinity;
  faces.forEach((f, i) => {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (let k = 0; k < f.pts.length; k += 2) {
      x0 = Math.min(x0, f.pts[k]); x1 = Math.max(x1, f.pts[k]);
      y0 = Math.min(y0, f.pts[k + 1]); y1 = Math.max(y1, f.pts[k + 1]);
    }
    const mx = 0.3 * (x1 - x0), my = 0.3 * (y1 - y0);
    if (x < x0 - mx || x > x1 + mx || y < y0 - my || y > y1 + my) return;
    const d = Math.hypot(x - (x0 + x1) / 2, y - (y0 + y1) / 2);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best < 0) return toast("Там нет лица — коснитесь лица", 2000);
  const st = app.pipeline.step("face_select").values, sel = new Set(selectedFaces(st));
  if (sel.has(best)) sel.delete(best);
  else sel.add(best);
  st.faces = [...sel].sort((a, b) => a - b);
  app.facePick = false;
  pushHistory();
  renderTools();
  requestRender();
  drawOverlay();
  toast(st.faces.length ? `Правятся лица: ${st.faces.map((i) => i + 1).join(", ")}` : "Правки — для всех лиц", 2500);
}

function drawFaces(g, W, H) {
  const sel = new Set(selectedFaces(app.pipeline.step("face_select").values));
  (app.analysis?.faces || []).forEach((f, i) => {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (let k = 0; k < f.pts.length; k += 2) {
      x0 = Math.min(x0, f.pts[k]); x1 = Math.max(x1, f.pts[k]);
      y0 = Math.min(y0, f.pts[k + 1]); y1 = Math.max(y1, f.pts[k + 1]);
    }
    const t = Math.max(3, W / 300);
    g.lineWidth = t + 3;
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.strokeRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H);
    g.lineWidth = t;
    g.strokeStyle = sel.has(i) ? "#F3C24A" : "#fff";
    g.strokeRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H);
    g.fillStyle = sel.has(i) ? "#F3C24A" : "#fff";
    g.font = `bold ${Math.round(W / 22)}px sans-serif`;
    g.fillText(String(i + 1), x0 * W + t * 2, y0 * H + W / 20);
  });
}

function drawOverlay() {
  if (objectTab() && !view.hidden && app.pipeline.step("object").values.x >= 0) {
    overlay.hidden = false;
    overlay.width = view.width;
    overlay.height = view.height;
    Object.assign(overlay.style, { width: view.style.width, height: view.style.height,
      left: `${view.offsetLeft}px`, top: `${view.offsetTop}px` });
    const g = overlay.getContext("2d");
    g.clearRect(0, 0, overlay.width, overlay.height);
    drawObjectOutline(g, overlay.width, overlay.height);
    return;
  }
  if (app.facePick && !view.hidden) { // frames of the faces to choose from
    overlay.hidden = false;
    overlay.width = view.width;
    overlay.height = view.height;
    Object.assign(overlay.style, { width: view.style.width, height: view.style.height,
      left: `${view.offsetLeft}px`, top: `${view.offsetTop}px` });
    const g = overlay.getContext("2d");
    g.clearRect(0, 0, overlay.width, overlay.height);
    drawFaces(g, overlay.width, overlay.height);
    return;
  }
  const skinBrush = app.brush.tool === "skin";
  const on = brushTab() && (app.brush.tool === "mask_edit" || skinBrush) && !view.hidden;
  overlay.hidden = !on;
  if (!on) return;
  overlay.width = view.width;
  overlay.height = view.height;
  Object.assign(overlay.style, { width: view.style.width, height: view.style.height,
    left: `${view.offsetLeft}px`, top: `${view.offsetTop}px` });
  const g = overlay.getContext("2d"), W = overlay.width, H = overlay.height, L = Math.max(W, H);
  g.clearRect(0, 0, W, H);
  g.lineCap = g.lineJoin = "round";
  const list = skinBrush ? app.pipeline.step("skin").values.brush || [] : app.pipeline.step("mask_edit").values.strokes || [];
  for (const s of list) {
    g.strokeStyle = g.fillStyle = skinBrush ? SKIN_COLORS[s[0]] || SKIN_COLORS[0] : LAYER_COLORS[s[0]] || LAYER_COLORS[0];
    const r = s[1] * L;
    g.lineWidth = 2 * r;
    g.beginPath();
    g.moveTo(s[3] * W, s[4] * H);
    if (s.length <= 5) {
      g.arc(s[3] * W, s[4] * H, r, 0, 2 * Math.PI);
      g.fill();
      continue;
    }
    for (let i = 5; i + 1 < s.length; i += 2) g.lineTo(s[i] * W, s[i + 1] * H);
    g.stroke();
  }
}

// --- crop frame editor -------------------------------------------------------------------------
const frameEl = $("frame");
function updateFrame() {
  const on = frameTab() && app.preview && !view.hidden;
  frameEl.hidden = !on;
  if (!on) return;
  const [x0, y0, x1, y1] = rectOf(frameValues());
  const r = view.getBoundingClientRect(), box = $("frame-box").getBoundingClientRect();
  Object.assign(frameEl.style, {
    left: `${r.left - box.left + x0 * r.width}px`, top: `${r.top - box.top + y0 * r.height}px`,
    width: `${(x1 - x0) * r.width}px`, height: `${(y1 - y0) * r.height}px`,
  });
}

function editFrame(vals, refit = false) {
  Object.assign(frameValues(), vals);
  if (refit && ASPECTS[app.aspect] !== null) return setAspect(app.aspect);
  pushHistory();
  requestRender();
  updateFrame();
}

// aspect as a normalised width/height ratio of the frame being cropped
function aspectQ(name) {
  const ratio = ASPECTS[name];
  if (ratio === null || !app.result) return null;
  return ratio === 0 ? 1 : (ratio * view.height) / view.width;
}

// «Умный кадр»: the largest frame of the chosen proportions (4:5 when free) with the eyes on the upper
// third, the face centred — or on the far third when the head is turned (room ahead of the look) —
// and room above the head. Rotation / mirroring of the frame are taken into account.
function smartFrame() {
  const faces = app.analysis?.faces;
  if (!app.analysis) return toast("Подождите — фото ещё анализируется");
  if (!faces?.length) return toast("Лицо не найдено — кадр можно задать вручную", 2500);
  const fv = frameValues(), rot = (fv.rot90 || 0) % 4, flip = !!fv.flip;
  const W = app.original.width, H = app.original.height, [FW, FH] = rot % 2 ? [H, W] : [W, H];
  // a point of the photo (normalised) -> the rotated / mirrored frame (normalised)
  const map = ([x, y]) => {
    let p = rot === 1 ? [1 - y, x] : rot === 2 ? [1 - x, 1 - y] : rot === 3 ? [y, 1 - x] : [x, y];
    if (flip) p = [1 - p[0], p[1]];
    const s = inscribedScale(FW, FH, fv.angle || 0); // straightening crops around the centre
    return [0.5 + (p[0] - 0.5) / s, 0.5 + (p[1] - 0.5) / s];
  };
  const box = (f) => {
    const P = (i) => map([f.pts[2 * i], f.pts[2 * i + 1]]);
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (let i = 0; i < f.pts.length / 2; i++) { const [x, y] = P(i); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const l = P(234), r = P(454), nose = P(1), mid = (l[0] + r[0]) / 2, half = Math.abs(r[0] - l[0]) / 2 || 1;
    return { x0, y0, x1, y1, eyes: (P(468)[1] + P(473)[1]) / 2, turn: (nose[0] - mid) / half }; // turn < 0: to the frame's left
  };
  const ratio = ASPECTS[app.aspect] || 4 / 5, q = (ratio * FH) / FW; // normalised width / height
  let [cw, ch] = q <= 1 ? [q, 1] : [1, 1 / q];
  // the faces to frame: all if they fit, else the chosen ones («Лицо» → «Выбрать лицо»), else the biggest
  let boxes = faces.map(box);
  const fits = (bs) => Math.max(...bs.map((b) => b.x1)) - Math.min(...bs.map((b) => b.x0)) <= cw * 0.9;
  if (!fits(boxes)) {
    const sel = selectedFaces(app.pipeline.step("face_select").values).filter((i) => i < boxes.length);
    boxes = sel.length && fits(sel.map((i) => boxes[i])) ? sel.map((i) => boxes[i])
      : [boxes.reduce((a, b) => ((b.x1 - b.x0) > (a.x1 - a.x0) ? b : a))];
  }
  const x0 = Math.min(...boxes.map((b) => b.x0)), x1 = Math.max(...boxes.map((b) => b.x1));
  const y0 = Math.min(...boxes.map((b) => b.y0)), y1 = Math.max(...boxes.map((b) => b.y1));
  const eyesY = boxes.reduce((a, b) => a + b.eyes, 0) / boxes.length, turn = boxes.reduce((a, b) => a + b.turn, 0) / boxes.length;
  const cx = (x0 + x1) / 2, fh = y1 - y0;
  // horizontal: centred, or on the third away from where the face looks
  const target = Math.abs(turn) > 0.22 ? (turn < 0 ? 2 / 3 : 1 / 3) : 0.5;
  let left = cx - target * cw;
  // vertical: the eyes on the upper third, but the top of the head (+ a little air) inside
  let top = eyesY - ch / 3;
  top = Math.min(top, y0 - 0.35 * fh);
  const clip = (v, a, b) => Math.min(b, Math.max(a, v));
  left = clip(left, 0, 1 - cw);
  top = clip(top, 0, 1 - ch);
  if (ASPECTS[app.aspect] === null) app.aspect = "4:5";
  editFrame({ x0: left, y0: top, x1: left + cw, y1: top + ch });
  renderTools();
  toast(`Кадр ${app.aspect}: глаза на верхней трети${target === 0.5 ? "" : ", место по направлению взгляда"}`, 2500);
}

function setAspect(name) {
  app.aspect = name;
  const q = aspectQ(name);
  if (q === null) return renderTools();
  const [nw, nh] = q <= 1 ? [q, 1] : [1, 1 / q];
  editFrame({ x0: 0.5 - nw / 2, y0: 0.5 - nh / 2, x1: 0.5 + nw / 2, y1: 0.5 + nh / 2 });
}

let drag = null;
frameEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  frameEl.setPointerCapture(e.pointerId);
  const h = e.target.classList.contains("h") ? [...e.target.classList].find((c) => c !== "h") : "move";
  drag = { h, x: e.clientX, y: e.clientY, start: rectOf(frameValues()) };
});
frameEl.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const r = view.getBoundingClientRect(), MIN = 0.05;
  const dx = (e.clientX - drag.x) / r.width, dy = (e.clientY - drag.y) / r.height;
  let [x0, y0, x1, y1] = drag.start;
  const clip = (v, a, b) => Math.min(b, Math.max(a, v));
  if (drag.h === "move") {
    const w = x1 - x0, h = y1 - y0;
    x0 = clip(x0 + dx, 0, 1 - w); y0 = clip(y0 + dy, 0, 1 - h);
    x1 = x0 + w; y1 = y0 + h;
  } else {
    if (drag.h.includes("l")) x0 = clip(x0 + dx, 0, x1 - MIN);
    if (drag.h.includes("r")) x1 = clip(x1 + dx, x0 + MIN, 1);
    if (drag.h.includes("t")) y0 = clip(y0 + dy, 0, y1 - MIN);
    if (drag.h.includes("b")) y1 = clip(y1 + dy, y0 + MIN, 1);
    const q = aspectQ(app.aspect);
    if (q) { // corner: the opposite corner stays, proportions kept
      const ax = drag.h.includes("l") ? drag.start[2] : drag.start[0], ay = drag.h.includes("t") ? drag.start[3] : drag.start[1];
      let nw = Math.max(x1 - x0, (y1 - y0) * q);
      nw = Math.min(nw, drag.h.includes("l") ? ax : 1 - ax, (drag.h.includes("t") ? ay : 1 - ay) * q);
      const nh = nw / q;
      [x0, x1] = drag.h.includes("l") ? [ax - nw, ax] : [ax, ax + nw];
      [y0, y1] = drag.h.includes("t") ? [ay - nh, ay] : [ay, ay + nh];
    }
  }
  Object.assign(frameValues(), { x0, y0, x1, y1 });
  updateFrame();
});
const endDrag = () => {
  if (!drag) return;
  drag = null;
  pushHistory();
};
frameEl.addEventListener("pointerup", endDrag);
frameEl.addEventListener("pointercancel", endDrag);
window.addEventListener("resize", updateFrame);

// "До": hold to see the original
let beforeHeld = false;
const before = $("btn-before");
before.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  beforeHeld = true;
  before.classList.add("on");
  const b = app.before || app.preview;
  if (view.width !== b.width) vctx.drawImage(canvasOf(b), 0, 0, view.width, view.height);
  else vctx.putImageData(b, 0, 0);
});
const release = () => {
  if (!beforeHeld) return;
  beforeHeld = false;
  before.classList.remove("on");
  if (app.result) show(app.result);
};
before.addEventListener("pointerup", release);
before.addEventListener("pointercancel", release);
before.addEventListener("pointerleave", release);

// --- open --------------------------------------------------------------------------------------
function scaled(img, maxSide) {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  return [Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k))];
}

function imageData(source, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(source, 0, 0, w, h);
  const out = g.getImageData(0, 0, w, h);
  c.width = c.height = 0; // released now: Safari counts canvas memory and closes the tab over its limit
  return out;
}

// Decoded photo, EXIF rotation applied. createImageBitmap does not wait for the page to be
// visible (img.decode() does in background tabs); <img> is the fallback for older browsers.
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();
      return img;
    } catch (err) {
      if (isHeic(file)) return decodeHeic(file);
      throw err;
    }
  }
}

// iPhone photos (HEIC) open natively only in Safari: Chrome, Firefox, Edge on Android, Windows,
// Mac and Linux get libheif (WebAssembly, 1.4 MB, loaded only when such a photo is opened)
const isHeic = (file) => /\.hei[cf]$/i.test(file.name || "") || /image\/hei[cf]/i.test(file.type || "");
let heifLib = null;
async function decodeHeic(file) {
  await ensureExtra("heic");
  toast("Открываю фото HEIC…", 0);
  heifLib ||= import("../vendor/libheif/libheif-bundle.mjs").then((m) => m.default());
  const lib = await heifLib, images = new lib.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
  if (!images?.length) throw new Error("HEIC: no image");
  const im = images[0], w = im.get_width(), h = im.get_height();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d"), data = g.createImageData(w, h);
  await new Promise((resolve, reject) => im.display(data, (d) => (d ? resolve() : reject(new Error("HEIC: decode")))));
  g.putImageData(data, 0, 0);
  for (const x of images) x.free?.();
  hideToast();
  return c;
}

async function openFile(file, { restoring = false } = {}) {
  if (!file) return;
  app.file = file;
  device.openingStarted();
  clearTimeout(app.openingTimer);
  app.openingTimer = setTimeout(device.openingDone, 40000); // alive 40 s after opening: it went well
  if (!restoring) {
    session.save({ file, name: file.name || "photo", state: null, exporting: false, bgFile: null, bgPid: null, versions: [] });
    app.versions = [];
    app.thumbFor = null;
  }
  $("busy").hidden = false;
  try {
    const img = await decode(file);
    let [w, h] = [img.width, img.height];
    if (w * h > MAX_PIXELS) [w, h] = scaled({ width: w, height: h }, Math.floor(Math.sqrt(MAX_PIXELS * Math.max(w, h) / Math.min(w, h))));
    app.original = imageData(img, w, h);
    app.analysis = null; // the previous photo's analysis must not answer for this one
    const [pw, ph] = scaled({ width: w, height: h }, PREVIEW), [fw, fh] = scaled({ width: w, height: h }, FAST);
    app.preview = imageData(img, pw, ph);
    app.imageId += 1;
    app.name = (file.name || "photo").replace(/\.[^.]+$/, "");
    engine.setImage("preview", app.preview, pw / w, app.imageId);
    engine.setImage("fast", imageData(img, fw, fh), fw / w, app.imageId);
    app.fastWidth = fw;
    app.detailWidth = 0;
    app.detailReady = false;
    engine.drop("detail");
    if (Math.max(w, h) > PREVIEW * 1.2) { // sharper preview for zoomed-in work
      app.detailWidth = scaled({ width: w, height: h }, DETAIL)[0];
      if (device.EAGER_DETAIL) ensureDetail(img);
    }
    img.close?.(); // the decoded photo (12 MP: 48 MB) is not kept beyond its ImageData copies
    Object.assign(app.pipeline.step("crop").values, { rot90: 0, flip: 0, angle: 0, x0: 0, y0: 0, x1: 1, y1: 1 });
    app.pipeline.step("face_select").values.faces = [];
    app.facePick = false;
    Object.assign(app.pipeline.step("object").values, { x: -1, y: -1, remove: 0 });
    app.objectPick = false;
    objectConfs.clear(); // tap points of another photo
    objectFills.clear();
    $("welcome").hidden = true;
    view.hidden = false;
    $("panel").hidden = false;
    before.hidden = false;
    splitBtn.hidden = false;
    view.width = pw;
    view.height = ph;
    vctx.putImageData(app.preview, 0, 0);
    resetZoom();
    fitCanvas();
    app.result = null;
    if (!app.history.length) pushHistory();
    updateButtons();
    requestRender();
    runAnalysis(app.imageId);
    if (!seen("editor")) setTimeout(showEditorTour, 900); // the first photo: how the editor works
  } catch (err) {
    console.error(err);
    toast("Не удалось открыть фото");
    device.openingDone();
    $("busy").hidden = true;
  }
}

// Face / person analysis of the full photo (once per photo, MediaPipe on the main thread).
async function runAnalysis(imageId) {
  $("busy").hidden = false;
  try {
    const t = performance.now();
    const a = await analyze(app.original);
    if (imageId !== app.imageId) return; // another photo was opened meanwhile
    a.imageId = imageId;
    app.analysis = a;
    engine.setAnalysis(a);
    console.debug(`analysis ${Math.round(performance.now() - t)} ms, faces ${a.faces.length}`);
    if (!a.faces.length) toast("Лицо не найдено — ретушь лица недоступна");
    requestRender();
    if (a.faces.length && device.FACE_PARSING) refineFaces(a, imageId);
    else device.openingDone();
  } catch (err) {
    console.error(err);
    toast("Не удалось проанализировать фото");
    device.openingDone();
  }
  $("busy").hidden = true;
}

// face parsing (precise lips, brows, skin, hairline): the edit is visible at once with the
// landmark masks and gets sharper when this is done
async function refineFaces(a, imageId) {
  try {
    const t = performance.now();
    await parseFaces(app.original, a.faces);
    if (imageId !== app.imageId) return;
    engine.setAnalysis(a);
    requestRender();
    console.debug(`face parsing ${Math.round(performance.now() - t)} ms`);
  } catch (err) {
    console.warn("face parsing unavailable", err); // the landmark masks stay
  }
  device.openingDone();
}

$("file").addEventListener("change", (e) => openFile(e.target.files[0]));
$("bg-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const pic = await decode(file);
  const [w, h] = scaled(pic, 4096);
  const pid = `pic-${Date.now()}`;
  engine.setPicture(pid, imageData(pic, w, h));
  session.save({ bgFile: file, bgPid: pid });
  setValue("background", "image", pid);
  setValue("background", "replace", REPLACE.indexOf("Своя картинка"));
  pushHistory();
  renderTools();
  requestRender();
  e.target.value = "";
});
for (const id of ["btn-open", "btn-open-big"]) $(id).onclick = () => $("file").click();
// selfie: phones and tablets open the front camera right away (on a computer it would only be a file dialog)
$("btn-camera").hidden = !matchMedia("(pointer: coarse)").matches;
// with the live camera: hints on light and angle (js/coach.js); the phone's own camera from there too
$("btn-camera").onclick = () => {
  if (!navigator.mediaDevices?.getUserMedia) return $("camera").click();
  openCoach({ tracker: faceTracker, onShot: (f) => openFile(f), onNativeCamera: () => $("camera").click() });
};
$("camera").addEventListener("change", (e) => {
  const f = e.target.files[0];
  e.target.value = ""; // the same shot can be taken again
  if (!f) return;
  const d = new Date(), p2 = (n) => String(n).padStart(2, "0"); // iOS names every shot «image.jpg»
  const name = `selfie_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}.jpg`;
  openFile(new File([f], name, { type: f.type || "image/jpeg" }));
});
// a light tap in the hand for buttons and tabs (js/haptics.js); the slider ticks at its default
document.addEventListener("click", (e) => {
  if (e.target.closest?.(".tool, .tab, .icon, .primary, .secondary, .toast-btn, .chip-btn, .tool-reset, .compare-back")) haptic();
}, true);
let lastDetent = null;
$("slider").addEventListener("input", (e) => {
  const t = app.tool;
  if (!t || t.kind) return;
  const at = Number(e.target.value) === paramOf(t).def;
  if (at && lastDetent === false) haptic();
  lastDetent = at;
});

// --- theme: as the system, light or dark (the button in the bar cycles; kept on this device) ---------
// The dark look lives in `@media (prefers-color-scheme: dark)` blocks: their condition is switched —
// the original (system), "all" (always dark) or "not all" (never) — and the same for the dark logo
// and the status bar colour. No second copy of the dark styles to keep in step.
const THEME_KEY = "kirson-theme", THEMES = ["auto", "light", "dark"];
const THEME_NAMES = { auto: "как в системе", light: "светлая", dark: "тёмная" };
const darkQuery = /prefers-color-scheme:\s*dark/, lightQuery = /prefers-color-scheme:\s*light/;
const original = new WeakMap();
function setMedia(obj, get, set, mode) {
  if (!original.has(obj)) original.set(obj, get());
  const orig = original.get(obj);
  const dark = darkQuery.test(orig), light = lightQuery.test(orig);
  if (!dark && !light) return;
  if (mode === "auto") set(orig);
  else set((mode === "dark") === dark ? "all" : "not all");
}
function applyTheme(mode) {
  const walk = (rules) => {
    for (const r of rules) {
      if (r.media && r.cssRules) {
        setMedia(r, () => r.media.mediaText, (v) => { r.media.mediaText = v; }, mode);
        walk(r.cssRules);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); } catch { /* another origin */ }
  }
  for (const el of document.querySelectorAll("source[media], meta[name=theme-color][media]"))
    setMedia(el, () => el.getAttribute("media"), (v) => el.setAttribute("media", v), mode);
  document.documentElement.style.colorScheme = mode === "auto" ? "" : mode;
  $("btn-theme").title = `Тема: ${THEME_NAMES[mode]}`;
}
let theme = "auto";
try { theme = THEMES.includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : "auto"; } catch { /* private mode */ }
applyTheme(theme);
// a stylesheet still loading has no rules yet: once it is there, switch it too
for (const l of document.querySelectorAll('link[rel=stylesheet]')) l.addEventListener("load", () => applyTheme(theme));
$("btn-theme").onclick = () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  applyTheme(theme);
  toast(`Тема: ${THEME_NAMES[theme]}`, 1500);
};

// --- any platform: install as an app, keyboard on computers -------------------------------------------
// Chrome / Edge (Android, Windows, Mac, Linux) offer installing through this event: a button for it.
// Safari has no such event: a line on how to do it (iPhone — the welcome tour explains it too).
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  $("btn-install").hidden = false;
  $("install-hint").hidden = true;
});
$("btn-install").onclick = async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null;
  $("btn-install").hidden = true;
};
window.addEventListener("appinstalled", () => { $("btn-install").hidden = true; });
{
  const ua = navigator.userAgent, installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const macSafari = /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua) && !iOS;
  const hint = installed ? "" : iOS ? "Как приложение: «Поделиться» → «На экран „Домой“»."
    : macSafari ? "Как приложение: меню «Файл» → «Добавить в Dock»." : "";
  $("install-hint").textContent = hint;
  $("install-hint").hidden = !hint;
}

// computers: Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl+Y redo, Ctrl/⌘+S save, Ctrl/⌘+O open; hold Space for «До»
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea")) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && (k === "z" || k === "я") && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && ((k === "z" || k === "я") && e.shiftKey || k === "y" || k === "н")) { e.preventDefault(); redo(); }
  else if (mod && (k === "s" || k === "ы")) { e.preventDefault(); save(); }
  else if (mod && (k === "o" || k === "щ")) { e.preventDefault(); $("file").click(); }
  else if (e.code === "Space" && !e.repeat && app.preview && !before.hidden) {
    e.preventDefault();
    before.dispatchEvent(new PointerEvent("pointerdown"));
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space") release();
});

$("btn-undo").onclick = undo;
$("btn-redo").onclick = redo;

// --- save ---------------------------------------------------------------------------------------
let savedFile = null;

const SIZE_PREF = "kirson-save-size";
function savePref(v) {
  try { localStorage.setItem(SIZE_PREF, v); } catch { /* private mode */ }
}
function sizePref() {
  try { return localStorage.getItem(SIZE_PREF) || "full"; } catch { return "full"; }
}

// «Сохранить»: the full photo, a lighter copy (long side EXPORT_PHONE) if the phone is short of
// memory, or a copy made for a social network
function save() {
  if (!app.original) return;
  const W = app.original.width, H = app.original.height;
  const extra = [["Для соцсетей", saveSocial], ...(videoSupported() ? [["Видео до/после", saveVideo]] : [])];
  if (Math.max(W, H) <= EXPORT_PHONE) return toast("Сохранить фото", 0, [[`Полный · ${W}×${H}`, () => exportPhoto("full")], ...extra]);
  const [w, h] = scaled(app.original, EXPORT_PHONE);
  // the full size always first: after one memory failure the light copy used to come first for good,
  // and a habitual tap saved a smaller photo («качество хуже»)
  const full = [`Полный · ${W}×${H}`, () => exportPhoto("full")], opt = [`Лёгкий · ${w}×${h} (если мало памяти)`, () => exportPhoto("optimal")];
  toast("Сохранить фото", 0, [full, opt, ...extra]);
}

// the faces lead a social crop when the frame is the photo's own (otherwise the frame's centre)
function socialFocus() {
  const own = isIdentity(REGISTRY.crop, app.pipeline.step("crop").values);
  const idx = selectedFaces(app.pipeline.step("face_select").values), all = (own && app.analysis?.faces) || [];
  return facesFocus(idx.length ? idx.map((i) => all[i]).filter(Boolean) : all);
}

// a «до → после» video for stories (the sharp preview is enough for 1080 px)
async function saveVideo() {
  hideToast();
  $("busy").hidden = false;
  toast("Готовлю видео…", 0);
  try {
    if (app.detailWidth) ensureDetail();
    const key = app.detailWidth ? "detail" : "preview";
    const { image, before } = await engine.render(key, app.pipeline.toJSON(), "always");
    const focus = socialFocus();
    const a = fit(image, FORMATS.story, focus), b = fit(before, FORMATS.story, focus);
    $("busy").hidden = true;
    savedFile = await record(b, a, app.name, (p) => {
      $("toast").firstChild.textContent = `Записываю видео… ${Math.round(p * 100)}%`;
    });
    toast(`Видео готово · ${(savedFile.size / 1048576).toFixed(1)} МБ`, 0, [["Сохранить в Фото", shareSaved]]);
  } catch (err) {
    console.error(err);
    toast("Не удалось сделать видео");
  }
  $("busy").hidden = true;
}

function saveSocial() {
  toast("Размер соцсети: обрезка по лицам, без геометки", 0,
    Object.entries(FORMATS).map(([k, f]) => [f.label, () => exportPhoto("optimal", k)]));
}

async function exportPhoto(size, social = null) {
  hideToast();
  if (!social) savePref(size);
  $("busy").hidden = false;
  toast(size === "full" ? "Обрабатываю в полном размере…" : "Обрабатываю…", 0);
  // if Safari runs out of memory it reloads the tab: the next start restores the work
  await session.save({ exporting: size === "full", state: snapshot() });
  try {
    let src = app.original;
    if (size === "optimal" && Math.max(src.width, src.height) > EXPORT_PHONE) {
      const [w, h] = scaled(src, EXPORT_PHONE);
      src = imageData(canvasOf(src), w, h);
    }
    engine.setImage("full", src, src.width / app.original.width, app.imageId);
    const { image } = await engine.render("full", app.pipeline.toJSON());
    engine.drop("full");
    let c;
    if (social) {
      c = fit(image, FORMATS[social], socialFocus());
    } else {
      c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      c.getContext("2d").putImageData(image, 0, 0);
    }
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", social ? 0.92 : 0.97)); // as the desktop (q97)
    const suffix = social ? FORMATS[social].suffix : "kirson";
    savedFile = new File([blob], `${app.name}_${suffix}.jpg`, { type: "image/jpeg" });
    session.save({ exporting: false });
    // Sharing needs a fresh tap on iPhone: offer the button.
    haptic("done");
    toast(`Готово · ${c.width}×${c.height}`, 0, [["Сохранить в Фото", shareSaved]]);
  } catch (err) {
    console.error(err);
    session.save({ exporting: false });
    engine.drop("full");
    if (size === "full") toast("Не хватило памяти телефона", 0, [["Сохранить лёгкий", () => exportPhoto("optimal")]]);
    else toast("Не удалось сохранить");
  }
  $("busy").hidden = true;
}

async function shareSaved() {
  if (!savedFile) return;
  if (navigator.canShare && navigator.canShare({ files: [savedFile] })) {
    try {
      await navigator.share({ files: [savedFile] }); // «Сохранить изображение» в меню iPhone
      hideToast();
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  const a = document.createElement("a"); // computers: an ordinary download
  a.href = URL.createObjectURL(savedFile);
  a.download = savedFile.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  hideToast();
}
$("btn-save").onclick = save;

// --- toast -------------------------------------------------------------------------------------
let toastTimer = 0;
function toast(text, ms = 2500, buttons = []) {
  const t = $("toast");
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = text;
  t.appendChild(span);
  for (const [label, fn] of buttons) {
    const b = document.createElement("button");
    b.className = "toast-btn";
    b.textContent = label;
    b.onclick = fn;
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(hideToast, ms);
}
function hideToast() {
  $("toast").hidden = true;
}

// --- start --------------------------------------------------------------------------------------
renderTabs();
selectTab(0);
updateButtons();
// (not on the development server: a cached copy would hide fresh edits)
$("version").textContent = `версия ${VERSION}`;
// first start: the networks every photo needs, downloaded once with a progress bar (js/assets.js)
async function prepareCore() {
  let todo = [];
  try { todo = await assets.missing(assets.CORE); } catch { /* no Cache Storage */ }
  if (!todo.length) return;
  const box = $("prep"), bar = box.querySelector("i"), text = box.querySelector("span");
  box.hidden = false;
  text.textContent = "Готовлю нейросети — это нужно только один раз…";
  try {
    await assets.download(todo, (done, total) => {
      bar.style.width = `${Math.round((done / total) * 100)}%`;
      text.textContent = `Готовлю нейросети — только один раз: ${assets.progressText(done, total)}`;
    });
    bar.style.width = "100%";
    box.classList.add("done");
    text.textContent = "Готово — KirSon работает и без интернета";
    setTimeout(() => { box.hidden = true; }, 4000);
  } catch (err) {
    console.warn("prefetch", err);
    box.hidden = true; // offline or blocked: the networks load as they are needed
  }
}
// the graphics card for the ONNX models (2–5x faster where WebGPU works): its runtime (22 MB) is fetched
// quietly after the core and used from the next start; on localhost straight away (files on the server)
async function prepareGpu() {
  if (!navigator.gpu || !device.GPU_ONNX) return;
  try { if (localStorage.getItem("kirson-nogpu")) return; } catch { /* private mode */ } // a switch for debugging
  try {
    if (!(await navigator.gpu.requestAdapter())) return;
    const dev = ["localhost", "127.0.0.1"].includes(location.hostname);
    const todo = dev ? [] : await assets.missing(assets.EXTRA.gpu.files);
    if (!todo.length) return setGpu(true);
    assets.download(todo).catch(() => {}); // next start
  } catch { /* no WebGPU here */ }
}
prepareCore().then(prepareGpu).finally(() => setTimeout(device.FACE_PARSING ? warmUpParsing : () => {}, 500));

// the tab died while opening a photo last time (memory): the light mode is on — say so, and how to undo
if (device.SAFE > 0) {
  const note = document.createElement("p");
  note.className = "install-hint";
  $("welcome").insertBefore(note, $("version"));
  note.append(device.SAFE >= 2 ? "Облегчённый режим: без разбора лица, фото до 8 МП. " : "Облегчённый режим для этого телефона. ");
  const off = document.createElement("a");
  off.href = "#";
  off.textContent = "Выключить";
  off.onclick = (e) => { e.preventDefault(); device.resetSafe(); location.reload(); };
  note.append(off);
}
if (device.CRASHED_OPENING)
  setTimeout(() => toast("В прошлый раз телефону не хватило памяти — включил облегчённый режим. Откройте фото снова", 6000), 800);

// a feature's own network (object selection, removal, enhancement, HEIC) the first time it is used
async function ensureExtra(name) {
  const x = assets.EXTRA[name];
  let todo = [];
  try { todo = await assets.missing(x.files); } catch { return; }
  if (!todo.length) return;
  toast(`Загружаю нейросеть для ${x.label} (один раз)…`, 0);
  try {
    await assets.download(todo, (done, total) => {
      $("toast").firstChild.textContent = `Загружаю нейросеть для ${x.label} (один раз): ${assets.progressText(done, total)}`;
    });
  } catch (err) {
    console.warn("download", name, err);
  }
  hideToast();
}

// continue the previous work (the app was closed by iOS, or a full-size save ran out of memory)
async function restoreSession(s) {
  hideToast();
  app.restoring = true; // opening the photo must not overwrite the saved edit
  try {
    await openFile(s.file, { restoring: true });
  } finally {
    app.restoring = false;
  }
  app.versions = s.versions || [];
  if (s.bgFile && s.bgPid) {
    const pic = await decode(s.bgFile), [w, h] = scaled(pic, 4096);
    engine.setPicture(s.bgPid, imageData(pic, w, h));
  }
  if (s.state) {
    app.pipeline = fromState(s.state);
    app.history = [s.state];
    app.future = [];
    const o = app.pipeline.step("object").values; // the selected object's mask is made again
    if (o.x >= 0) {
      const [x, y] = [o.x, o.y];
      const waitAnalysis = async () => { while (!app.analysis) await new Promise((r) => setTimeout(r, 300)); };
      waitAnalysis().then(() => objectMask(app.original, x, y)).then(async (conf) => {
        objectConfs.set(objectKey(x, y), conf);
        engine.setObjectMask(x, y, conf);
        if (o.remove >= 0.5) await fillFor(x, y);
        requestRender();
      }).catch(() => {});
    }
    renderTools();
    updateButtons();
    requestRender();
  }
}
acceptSharedPreset().then((shared) => shared ? null : session.load()).then((s) => {
  if (!s?.file || app.preview) return;
  if (s.exporting) {
    savePref("optimal");
    session.save({ exporting: false }); // say it once
    restoreSession(s).then(() => toast("Полный размер не поместился в память телефона. Правки сохранены — сохраните «Лёгкий» вариант.",
      0, [["Сохранить", save]]));
  } else {
    toast("Продолжить с прошлого фото?", 0, [["Продолжить", () => restoreSession(s)], ["Новое", () => { session.clear(); hideToast(); }]]);
  }
});

function showEditorTour() {
  selectTab(0); // «Образы»: the «Авто» button is on screen
  resetZoom();
  runTour("editor", editorSteps());
}
$("btn-help").onclick = () => (app.preview ? showEditorTour() : runTour("welcome", welcomeSteps()));
if (!seen("welcome")) setTimeout(() => { if (!app.preview) runTour("welcome", welcomeSteps()); }, 600);
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  // updateViaCache "none": the browser checks sw.js itself on every start (no stale copy)
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch((e) => console.warn("service worker", e));
  // a new version took over: reload right away if no photo is being edited yet
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!app.original && !sessionStorage.getItem("kirson-reloaded")) {
      sessionStorage.setItem("kirson-reloaded", "1");
      location.reload();
    }
  });
}
window.kirson = { app, engine, openFile, saved: () => savedFile, batch: () => batchFiles, onnxInfo }; // for scripted checks
if (["localhost", "127.0.0.1"].includes(location.hostname)) import("./dev.js").then((m) => (window.kirson.dev = m));
