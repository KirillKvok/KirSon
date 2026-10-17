// KirSon web — interface. Persona-like: the photo, one slider for the chosen tool, a row of the
// tab's tools, tabs. Processing runs in a worker (engine.js); the original never leaves the phone.
import "./ops/index.js";
import { ORDER } from "./ops/index.js";
import { REGISTRY, Pipeline, defaults } from "./core/pipeline.js";
import { FILTER_NAMES } from "./ops/filters.js";
import { LIP_COLORS, BLUSH_COLORS } from "./ops/makeup.js";
import { HAIR_NAMES } from "./ops/hair.js";
import { REPLACE } from "./ops/background.js";
import { LOOKS, BUILTIN, scaled as scaleLook } from "./core/presets.js";
import { Engine } from "./engine.js";
import { analyze } from "./face/analysis.js";

const PREVIEW = 1280; // preview long side (as on the desktop)
const FAST = 640;     // while a slider is held
const MAX_PIXELS = 16_000_000; // iOS canvas limit is 16.7 MP

// Tabs: what each one offers. {op, param} = a slider tool; {op, param, option} = a choice chip.
const TABS = [
  {
    name: "Образы",
    tools: [
      { kind: "auto", label: "✦ Авто" },
      ...Object.keys(LOOKS).map((name) => ({ kind: "look", name, label: name })),
      { kind: "strength", label: "Сила образа" },
      ...Object.keys(BUILTIN).map((name) => ({ kind: "preset", name, label: name })),
      { kind: "reset", label: "Без обработки" },
    ],
  },
  {
    name: "Лицо",
    tools: [["skin", "smooth"], ["skin", "blemish"], ["face_light", "matte"], ["skin_tone", "even"],
      ["skin_tone", "redness"], ["face_detail", "circles"], ["face_detail", "bags"], ["face_detail", "folds"],
      ["face_detail", "wrinkles"], ["face_light", "soften"], ["face_light", "fill"], ["skin_tone", "tan"],
      ["teeth_eyes", "teeth"], ["teeth_eyes", "sclera"], ["teeth_eyes", "iris"], ["skin", "texture"],
      ["skin_natural", "texture"], ["skin_natural", "volume"], ["skin", "body"]].map(([op, param]) => ({ op, param })),
  },
  {
    name: "Форма",
    tools: [["face_shape", "slim"], ["face_shape", "jaw"], ["face_shape", "chin"], ["face_shape", "eyes"],
      ["face_shape", "eye_open"], ["face_shape", "nose"], ["face_shape", "lips"], ["face_shape", "smile"],
      ["face_shape", "symmetry"]].map(([op, param]) => ({ op, param })),
  },
  {
    name: "Фигура",
    tools: [["body", "waist"], ["body", "hips"], ["body", "legs"], ["body", "length"], ["body", "arms"],
      ["body", "shoulders"], ["body", "neck"]].map(([op, param]) => ({ op, param })),
  },
  {
    name: "Макияж",
    tools: [
      { op: "makeup", param: "lips" },
      ...Object.keys(LIP_COLORS).map((n, k) => ({ op: "makeup", param: "lip_color", option: k, label: n })),
      { op: "makeup", param: "blush" },
      ...Object.keys(BLUSH_COLORS).map((n, k) => ({ op: "makeup", param: "blush_color", option: k, label: n })),
      { op: "makeup", param: "brows" }, { op: "makeup", param: "eyeliner" }, { op: "makeup", param: "contour" },
    ],
  },
  {
    name: "Волосы",
    tools: [
      ...HAIR_NAMES.map((n, k) => ({ op: "hair", param: "color", option: k, label: k ? n : "Свой цвет" })),
      { op: "hair", param: "amount" }, { op: "hair", param: "shine" }, { op: "hair", param: "volume" },
      { op: "hair", param: "roots" },
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
    name: "Коррекция",
    tools: [["light", "shadows"], ["light", "highlights"], ["brightness", "amount"], ["contrast", "amount"],
      ["color", "saturation"], ["color", "vibrance"], ["color", "temperature"], ["color", "tint"],
      ["sharpen", "sharpness"], ["sharpen", "clarity"]].map(([op, param]) => ({ op, param })),
  },
  {
    name: "Фильтры",
    tools: [
      ...FILTER_NAMES.map((n, k) => ({ op: "filter", param: "style", option: k, label: n })),
      { op: "filter", param: "amount", label: "Сила фильтра" },
      { op: "grain", param: "amount", label: "Зерно" },
      { op: "grain", param: "size", label: "Размер зерна" },
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
function snapshot() {
  return JSON.stringify(app.pipeline.toJSON());
}
function pushHistory() {
  const s = snapshot();
  if (app.history[app.history.length - 1] === s) return;
  app.history.push(s);
  app.future = [];
  updateButtons();
}
function restore(s) {
  app.pipeline = Pipeline.fromJSON(JSON.parse(s));
  renderTools();
  requestRender();
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

function selectTab(k) {
  app.tab = k;
  app.tool = TABS[k].tools.find((t) => (t.option === undefined && !t.kind) || t.kind === "strength") || null;
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
  if (push) pushHistory();
  requestRender();
}

async function runAuto() {
  if (!app.preview) return;
  if (!app.analysis) return toast("Подождите — фото ещё анализируется");
  $("busy").hidden = false;
  try {
    applyValues(await engine.auto("preview"));
    app.look = null;
    pushHistory();
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
  b.onclick = () => {
    if (t.kind === "auto") return runAuto();
    if (t.kind === "look") {
      app.look = t.name;
      app.tool = TABS[app.tab].tools.find((x) => x.kind === "strength");
      applyLook();
    } else if (t.kind === "preset") {
      app.look = null;
      applyValues(BUILTIN[t.name]);
      pushHistory();
      requestRender();
    } else if (t.kind === "reset") {
      app.look = null;
      applyValues({});
      pushHistory();
      requestRender();
    } else if (t.kind === "strength") app.tool = t;
    renderTools();
  };
}

function renderTools() {
  const row = $("tools");
  row.innerHTML = "";
  for (const t of TABS[app.tab].tools) {
    const b = document.createElement("button");
    row.appendChild(b);
    if (t.kind) {
      kindTool(t, b);
      continue;
    }
    const p = paramOf(t), v = values(t.op)[t.param];
    const isChoice = t.option !== undefined;
    const on = isChoice ? v === t.option : app.tool === t;
    const changed = !isChoice && v !== p.def;
    b.className = "tool" + (on ? " on" : "") + (changed ? " changed" : "");
    b.innerHTML = `<span class="dot"></span>${toolLabel(t)}`;
    b.onclick = () => {
      if (t.action === "pickBackground") return $("bg-file").click();
      if (isChoice) {
        setValue(t.op, t.param, t.option);
        pushHistory();
        requestRender();
      } else app.tool = t;
      renderTools();
    };
  }
  renderSlider();
}

function renderSlider() {
  const t = app.tool, s = $("slider");
  $("slider-row").style.visibility = t ? "visible" : "hidden";
  if (!t) return;
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
}

$("slider").addEventListener("input", (e) => {
  const t = app.tool;
  if (!t) return;
  const v = Number(e.target.value);
  if (t.kind === "strength") {
    app.lookStrength = v;
    $("tool-value").textContent = v;
    app.dragging = true;
    if (app.look) applyLook(false);
    return;
  }
  setValue(t.op, t.param, v);
  $("tool-value").textContent = v;
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
function requestRender() {
  if (!app.preview) return;
  engine.preview(app.dragging ? "fast" : "preview", app.pipeline.toJSON());
}

engine.onPreview = (image, ms) => {
  app.result = image;
  if (!beforeHeld) show(image);
  $("busy").hidden = true;
  console.debug(`preview ${ms.toFixed(0)} ms`);
};

function show(image) {
  if (view.width !== app.preview.width || view.height !== app.preview.height) {
    view.width = app.preview.width;
    view.height = app.preview.height;
  }
  if (image.width === view.width) vctx.putImageData(image, 0, 0);
  else createImageBitmap(image).then((bmp) => vctx.drawImage(bmp, 0, 0, view.width, view.height));
}

// "До": hold to see the original
let beforeHeld = false;
const before = $("btn-before");
before.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  beforeHeld = true;
  before.classList.add("on");
  vctx.putImageData(app.preview, 0, 0);
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
  return g.getImageData(0, 0, w, h);
}

// Decoded photo, EXIF rotation applied. createImageBitmap does not wait for the page to be
// visible (img.decode() does in background tabs); <img> is the fallback for older browsers.
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    return img;
  }
}

async function openFile(file) {
  if (!file) return;
  $("busy").hidden = false;
  try {
    const img = await decode(file);
    let [w, h] = [img.width, img.height];
    if (w * h > MAX_PIXELS) [w, h] = scaled({ width: w, height: h }, Math.floor(Math.sqrt(MAX_PIXELS * Math.max(w, h) / Math.min(w, h))));
    app.original = imageData(img, w, h);
    const [pw, ph] = scaled({ width: w, height: h }, PREVIEW), [fw, fh] = scaled({ width: w, height: h }, FAST);
    app.preview = imageData(img, pw, ph);
    app.imageId += 1;
    app.name = (file.name || "photo").replace(/\.[^.]+$/, "");
    engine.setImage("preview", app.preview, pw / w, app.imageId);
    engine.setImage("fast", imageData(img, fw, fh), fw / w, app.imageId);
    $("welcome").hidden = true;
    view.hidden = false;
    $("panel").hidden = false;
    before.hidden = false;
    view.width = pw;
    view.height = ph;
    vctx.putImageData(app.preview, 0, 0);
    app.result = null;
    if (!app.history.length) pushHistory();
    updateButtons();
    requestRender();
    runAnalysis(app.imageId);
  } catch (err) {
    console.error(err);
    toast("Не удалось открыть фото");
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
  } catch (err) {
    console.error(err);
    toast("Не удалось проанализировать фото");
  }
  $("busy").hidden = true;
}

$("file").addEventListener("change", (e) => openFile(e.target.files[0]));
$("bg-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const pic = await decode(file);
  const [w, h] = scaled(pic, 4096);
  const pid = `pic-${Date.now()}`;
  engine.setPicture(pid, imageData(pic, w, h));
  setValue("background", "image", pid);
  setValue("background", "replace", REPLACE.indexOf("Своя картинка"));
  pushHistory();
  renderTools();
  requestRender();
  e.target.value = "";
});
for (const id of ["btn-open", "btn-open-big"]) $(id).onclick = () => $("file").click();
$("btn-undo").onclick = undo;
$("btn-redo").onclick = redo;

// --- save ---------------------------------------------------------------------------------------
let savedFile = null;

async function save() {
  if (!app.original) return;
  $("busy").hidden = false;
  toast("Обрабатываю в полном размере…", 0);
  try {
    engine.setImage("full", app.original, 1, app.imageId);
    const { image } = await engine.render("full", app.pipeline.toJSON());
    engine.drop("full");
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    c.getContext("2d").putImageData(image, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
    savedFile = new File([blob], `${app.name}_kirson.jpg`, { type: "image/jpeg" });
    // Sharing needs a fresh tap on iPhone: offer the button.
    toast("Готово", 0, [["Сохранить в Фото", shareSaved]]);
  } catch (err) {
    console.error(err);
    toast("Не удалось сохранить");
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
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker", e));
}
window.kirson = { app, engine, openFile }; // for scripted checks
if (["localhost", "127.0.0.1"].includes(location.hostname)) import("./dev.js").then((m) => (window.kirson.dev = m));
