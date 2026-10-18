// Face / person analysis on the main thread with MediaPipe for the web — port of
// kirson/core/face/analysis.py. Runs once per photo; the plain-data result goes to the worker.
//
// Result: {faces: [{pts: Float32Array(478*2) normalised}], seg: {w, h, c: 6, data} class
// confidences (SEG_CLASSES), poses: [{pts, vis}], person: plane | null, hair: plane | null}
import { FilesetResolver, FaceLandmarker, ImageSegmenter, InteractiveSegmenter, PoseLandmarker } from "../../vendor/mediapipe/vision_bundle.mjs";
import { FACE_OVAL } from "./topology.js";

export const SEG_CLASSES = ["background", "hair", "body_skin", "face_skin", "clothes", "other"];
const ANALYSIS_SIDE = 1280;
const CROP_SIDE = 512;
const MIN_FACE_SKIN = 0.35;
const base = new URL("../../", import.meta.url);

let models = null;

async function create(cls, options) {
  // GPU first (fast on iPhone), CPU if WebGL refuses
  const fileset = await (models.fileset ||= FilesetResolver.forVisionTasks(new URL("vendor/mediapipe/wasm", base).href));
  for (const delegate of ["GPU", "CPU"]) {
    try {
      return await cls.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate } });
    } catch (err) {
      if (delegate === "CPU") throw err;
    }
  }
}

export async function loadModels() {
  if (models?.ready) return models.ready;
  models = {};
  models.ready = (async () => {
    const m = (f) => new URL(`models/${f}`, base).href;
    const [landmarker, segmenter, pose, hair] = await Promise.all([
      create(FaceLandmarker, { baseOptions: { modelAssetPath: m("face_landmarker.task") }, runningMode: "IMAGE",
        numFaces: 4, minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.4 }),
      create(ImageSegmenter, { baseOptions: { modelAssetPath: m("selfie_multiclass_256x256.tflite") }, runningMode: "IMAGE",
        outputConfidenceMasks: true, outputCategoryMask: false }),
      create(PoseLandmarker, { baseOptions: { modelAssetPath: m("pose_landmarker_full.task") }, runningMode: "IMAGE",
        numPoses: 3, minPoseDetectionConfidence: 0.4, outputSegmentationMasks: true }),
      create(ImageSegmenter, { baseOptions: { modelAssetPath: m("hair_segmenter.tflite") }, runningMode: "IMAGE",
        outputConfidenceMasks: true, outputCategoryMask: false }),
    ]);
    Object.assign(models, { landmarker, segmenter, pose, hair });
    return models;
  })();
  return models.ready;
}

function canvasOf(source, w, h, sx = 0, sy = 0, sw = null, sh = null) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  if (source instanceof ImageData) {
    if (sw === null) {
      if (source.width === w && source.height === h) g.putImageData(source, 0, 0);
      else {
        const t = canvasOf(source, source.width, source.height);
        g.drawImage(t, 0, 0, w, h);
      }
    } else {
      const t = canvasOf(source, source.width, source.height);
      g.drawImage(t, sx, sy, sw, sh, 0, 0, w, h);
    }
  } else if (sw === null) g.drawImage(source, 0, 0, w, h);
  else g.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  return c;
}

const toPts = (lms) => {
  const a = new Float32Array(lms.length * 2);
  lms.forEach((l, i) => { a[2 * i] = l.x; a[2 * i + 1] = l.y; });
  return a;
};

function landmarks(canvas) {
  return models.landmarker.detect(canvas).faceLandmarks.map(toPts);
}

function ptp(pts) { // largest extent of a point set (normalised)
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return { x0, y0, x1, y1, size: Math.max(x1 - x0, y1 - y0), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
function centre(pts) {
  let x = 0, y = 0;
  for (let i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; }
  return [(2 * x) / pts.length, (2 * y) / pts.length];
}

// connected components of a binary mask: [{x0, y0, x1, y1, area, cx, cy}]
function blobs(bin, w, h) {
  const lab = new Int32Array(w * h), out = [], stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!bin[s] || lab[s]) continue;
    const id = out.length + 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0, sx = 0, sy = 0;
    stack.push(s);
    lab[s] = id;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || lab[q] || !bin[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        lab[q] = id;
        stack.push(q);
      }
    }
    out.push({ x0, y0, x1, y1, area, cx: sx / area, cy: sy / area });
  }
  return out;
}

// share of the face oval (polygon) covered by face skin
function ovalSkinShare(pts, faceSkin, w, h) {
  const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
  g.beginPath();
  FACE_OVAL.forEach((k, i) => (i ? g.lineTo : g.moveTo).call(g, pts[2 * k] * w, pts[2 * k + 1] * h));
  g.closePath();
  g.fill();
  const a = g.getImageData(0, 0, w, h).data;
  let n = 0, s = 0;
  for (let i = 0; i < w * h; i++) if (a[i * 4 + 3] > 127) { n++; s += faceSkin[i]; }
  return n ? s / n : 0;
}

function maskPlane(mpMask) {
  const data = mpMask.getAsFloat32Array();
  return { w: mpMask.width, h: mpMask.height, c: 1, data: new Float32Array(data) };
}

// Analyse a photo: `full` = full-size ImageData (crops for small faces come from it).
export async function analyze(full) {
  await loadModels();
  const W = full.width, H = full.height;
  const k = Math.min(1, ANALYSIS_SIDE / Math.max(W, H));
  const sw = Math.max(1, Math.round(W * k)), sh = Math.max(1, Math.round(H * k));
  const small = canvasOf(full, sw, sh);

  const segRes = models.segmenter.segment(small);
  const planes = segRes.confidenceMasks.map(maskPlane);
  segRes.close?.();
  const sw2 = planes[0].w, sh2 = planes[0].h;
  const seg = { w: sw2, h: sh2, c: 6, data: new Float32Array(sw2 * sh2 * 6) };
  for (let i = 0; i < sw2 * sh2; i++) for (let c = 0; c < 6; c++) seg.data[i * 6 + c] = planes[c].data[i];
  const faceSkin = planes[SEG_CLASSES.indexOf("face_skin")].data;

  const candidates = landmarks(small);

  // pass 2: face-skin blobs with no face found -> landmarks on a full-resolution crop
  const bin = new Uint8Array(sw2 * sh2);
  for (let i = 0; i < bin.length; i++) bin[i] = faceSkin[i] > 0.5 ? 1 : 0;
  for (const b of blobs(bin, sw2, sh2)) {
    if (b.area < 150 * (sw2 * sh2) / (sw * sh)) continue;
    const c = [b.cx / sw2, b.cy / sh2];
    if (candidates.some((f) => { const [fx, fy] = centre(f); return Math.hypot(fx - c[0], fy - c[1]) < 0.5 * ptp(f).size; })) continue;
    const side = 2.2 * Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) * (W / sw2);
    const cx = c[0] * W, cy = c[1] * H;
    const x0 = Math.max(0, Math.round(cx - side / 2)), y0 = Math.max(0, Math.round(cy - side / 2));
    const x1 = Math.min(W, Math.round(cx + side / 2)), y1 = Math.min(H, Math.round(cy + side / 2));
    if (x1 - x0 < 8 || y1 - y0 < 8) continue;
    const s = CROP_SIDE / Math.max(x1 - x0, y1 - y0);
    const crop = canvasOf(full, Math.round((x1 - x0) * s), Math.round((y1 - y0) * s), x0, y0, x1 - x0, y1 - y0);
    for (const f of landmarks(crop)) {
      for (let i = 0; i < f.length; i += 2) {
        f[i] = (f[i] * (x1 - x0) + x0) / W;
        f[i + 1] = (f[i + 1] * (y1 - y0) + y0) / H;
      }
      candidates.push(f);
    }
  }

  const faces = [];
  for (const pts of candidates) {
    if (ovalSkinShare(pts, faceSkin, sw2, sh2) < MIN_FACE_SKIN) continue; // e.g. a printed face
    const [cx, cy] = centre(pts);
    if (faces.some((f) => { const [fx, fy] = centre(f.pts); return Math.hypot(fx - cx, fy - cy) < 0.5 * ptp(pts).size; })) continue;
    faces.push({ pts });
  }

  const poseRes = models.pose.detect(small);
  const poses = poseRes.landmarks.map((p) => ({
    pts: toPts(p),
    vis: Float32Array.from(p.map((l) => l.visibility ?? 0)),
  }));
  let person = null;
  if (poseRes.segmentationMasks?.length) {
    const ms = poseRes.segmentationMasks.map(maskPlane);
    person = ms[0];
    for (const m of ms.slice(1)) for (let i = 0; i < m.data.length; i++) person.data[i] = Math.max(person.data[i], m.data[i]);
  }
  poseRes.close?.();

  const hairRes = models.hair.segment(small);
  const hm = hairRes.confidenceMasks;
  const hair = hm?.length ? maskPlane(hm[hm.length - 1]) : null;
  hairRes.close?.();

  return { faces, seg, poses, person, hair, width: W, height: H };
}

// --- face parsing (precise lips, brows, skin, hairline) -------------------------------------------
// BiSeNet in its own worker (face/onnx-worker.js) on a full-resolution crop around every face
// (bbox + PARSE_MARGIN of the face width), 512 px: f.parse = class per pixel, f.parseBox =
// the crop (normalised). Runs after the main analysis: the masks get sharper when it is done.
export const PARSE_CLASSES = ["background", "skin", "l_brow", "r_brow", "l_eye", "r_eye", "eye_g", "l_ear", "r_ear",
  "ear_r", "nose", "mouth", "u_lip", "l_lip", "neck", "neck_l", "cloth", "hair", "hat"];
const PARSE_MARGIN = 0.35, PARSE_SIDE = 512;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
let parser = null, parseId = 0;
const parseWaiting = new Map();

// the graphics card (WebGPU) for the ONNX models: decided before the worker starts (its runtime differs)
let gpu = false;
export function setGpu(on) { if (!parser) gpu = !!on; }
export const onnxInfo = () => onnxCall({ model: "info" });

function parseWorker() {
  if (!parser) {
    parser = new Worker(new URL(`./onnx-worker.js${gpu ? "?gpu=1" : ""}`, import.meta.url), { type: "module" });
    parser.onmessage = (e) => {
      const w = parseWaiting.get(e.data.id);
      parseWaiting.delete(e.data.id);
      if (w) e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data);
    };
    parser.onerror = (e) => { for (const w of parseWaiting.values()) w.reject(new Error(e.message || "parse worker")); parseWaiting.clear(); };
  }
  return parser;
}
function onnxCall(msg, transfer = []) {
  const id = ++parseId;
  return new Promise((resolve, reject) => {
    parseWaiting.set(id, { resolve, reject });
    parseWorker().postMessage({ ...msg, id }, transfer);
  });
}
const parseCall = async (data) => (await onnxCall({ model: "parse", data }, [data.buffer])).labels;
export const warmUpParsing = () => onnxCall({ model: "parse" }).catch(() => {}); // loads the model in the background

// adds parse / parseBox to every face; false if parsing is not available here
export async function parseFaces(full, faces) {
  const W = full.width, H = full.height;
  let src = null;
  for (const f of faces) {
    const b = ptp(f.pts), fw = (b.x1 - b.x0) * W, m = fw * PARSE_MARGIN;
    const X0 = Math.max(0, Math.round(b.x0 * W - m)), Y0 = Math.max(0, Math.round(b.y0 * H - m));
    const X1 = Math.min(W, Math.round(b.x1 * W + m)), Y1 = Math.min(H, Math.round(b.y1 * H + m));
    if (X1 - X0 < 8 || Y1 - Y0 < 8) continue;
    src ||= canvasOf(full, W, H);
    const c = canvasOf(src, PARSE_SIDE, PARSE_SIDE, X0, Y0, X1 - X0, Y1 - Y0);
    const px = c.getContext("2d").getImageData(0, 0, PARSE_SIDE, PARSE_SIDE).data, n = PARSE_SIDE * PARSE_SIDE;
    const x = new Float32Array(3 * n);
    for (let i = 0; i < n; i++)
      for (let ch = 0; ch < 3; ch++) x[ch * n + i] = (px[4 * i + ch] / 255 - MEAN[ch]) / STD[ch];
    f.parse = await parseCall(x);
    f.parseBox = [X0 / W, Y0 / H, X1 / W, Y1 / H];
  }
}

// --- object removal (MI-GAN) -------------------------------------------------------------------------
// As kirson/core/objects.remove_object: the object (grown a little, to take its soft edge and
// contact shadow) in a square crop with ~1x its size of context, scaled to 512 px; the filled crop
// comes back as a patch in normalised photo coordinates (the same on the preview and the export):
// {box: [x0, y0, x1, y1], w, h, rgb: Uint8Array(w*h*3), hole: Float32Array(w*h)}.
const FILL_SIDE = 512;
export async function removeFill(full, conf) {
  const W = full.width, H = full.height, cw = conf.w, ch = conf.h;
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++)
      if (conf.data[y * cw + x] > 0.5) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const grow = Math.max(3, Math.max(W, H) * 0.006); // in photo pixels
  const sx = W / cw, sy = H / ch;
  const bx0 = x0 * sx - grow, by0 = y0 * sy - grow, bx1 = (x1 + 1) * sx + grow, by1 = (y1 + 1) * sy + grow;
  let side = Math.round(Math.max(bx1 - bx0, by1 - by0) * 2) + 16;
  side = Math.min(side, Math.max(W, H));
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const X0 = Math.round(Math.min(Math.max(0, cx - side / 2), Math.max(0, W - side)));
  const Y0 = Math.round(Math.min(Math.max(0, cy - side / 2), Math.max(0, H - side)));
  const X1 = Math.min(W, X0 + side), Y1 = Math.min(H, Y0 + side);
  // the crop keeps its proportions (at the photo's edges it is not square): long side FILL_SIDE
  const k = FILL_SIDE / Math.max(X1 - X0, Y1 - Y0);
  const fw = Math.max(8, Math.round((X1 - X0) * k)), fh = Math.max(8, Math.round((Y1 - Y0) * k)), n = fw * fh;
  const px = canvasOf(full, fw, fh, X0, Y0, X1 - X0, Y1 - Y0).getContext("2d").getImageData(0, 0, fw, fh).data;
  // the hole: the object mask (nearest), grown by `grow` (+1 px like the desktop)
  const g = Math.max(1, Math.round(grow * k)) + 1;
  const hard = new Uint8Array(n);
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const u = Math.min(cw - 1, Math.floor(((X0 + (x + 0.5) / k) / W) * cw));
      const v = Math.min(ch - 1, Math.floor(((Y0 + (y + 0.5) / k) / H) * ch));
      hard[y * fw + x] = conf.data[v * cw + u] > 0.5 ? 1 : 0;
    }
  const hole = new Float32Array(n);
  for (let y = 0; y < fh; y++) // square dilation (the crop is small)
    for (let x = 0; x < fw; x++) {
      if (!hard[y * fw + x]) continue;
      for (let yy = Math.max(0, y - g); yy <= Math.min(fh - 1, y + g); yy++)
        hole.fill(1, yy * fw + Math.max(0, x - g), yy * fw + Math.min(fw - 1, x + g) + 1);
    }
  const image = new Uint8Array(3 * n), mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) image[c * n + i] = px[4 * i + c];
    mask[i] = hole[i] ? 0 : 255;
  }
  const out = (await onnxCall({ model: "migan", image, mask, w: fw, h: fh }, [image.buffer, mask.buffer])).image;
  const rgb = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) rgb[3 * i + c] = out[c * n + i];
  return { box: [X0 / W, Y0 / H, X1 / W, Y1 / H], w: fw, h: fh, rgb, hole };
}

// --- «Улучшить качество»: Real-ESRGAN x4 on tiles (a photo of long side `inSide` -> 4x) -----------------
// Tiles of TILE px with PAD px of context (no seams); the progress goes to onProgress(0..1).
const PAD = 8; // tiles: small on the processor (memory), big on the graphics card (fewer round trips)
const tileSide = () => (gpu ? 384 : 128);
export async function superResolve(small, onProgress = () => {}) { // small: ImageData
  const TILE = tileSide();
  const w = small.width, h = small.height, W = 4 * w, H = 4 * h, out = new Uint8ClampedArray(W * H * 4);
  const tiles = [];
  for (let y = 0; y < h; y += TILE) for (let x = 0; x < w; x += TILE) tiles.push([x, y]);
  let done = 0;
  for (const [tx, ty] of tiles) {
    const x0 = Math.max(0, tx - PAD), y0 = Math.max(0, ty - PAD);
    const x1 = Math.min(w, tx + TILE + PAD), y1 = Math.min(h, ty + TILE + PAD), tw = x1 - x0, th = y1 - y0, n = tw * th;
    const data = new Float32Array(3 * n);
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        const s = 4 * ((y0 + y) * w + x0 + x), i = y * tw + x;
        for (let c = 0; c < 3; c++) data[c * n + i] = small.data[s + c] / 255;
      }
    const img = (await onnxCall({ model: "esrgan", data, w: tw, h: th }, [data.buffer])).image, N = 16 * n;
    // keep only the tile's own part (the padding was context)
    const ox = 4 * (tx - x0), oy = 4 * (ty - y0), cw = 4 * Math.min(TILE, w - tx), ch = 4 * Math.min(TILE, h - ty);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const i = (oy + y) * 4 * tw + ox + x, o = 4 * ((4 * ty + y) * W + 4 * tx + x);
        out[o] = img[i]; out[o + 1] = img[N + i]; out[o + 2] = img[2 * N + i]; out[o + 3] = 255;
      }
    onProgress(++done / tiles.length);
  }
  return new ImageData(out, W, H);
}

// The selfie coach's face tracker: VIDEO mode (follows the face between frames), with the head pose matrix.
let tracker = null;
export async function faceTracker() {
  await loadModels(); // the fileset is shared
  tracker ||= await create(FaceLandmarker, { baseOptions: { modelAssetPath: new URL("models/face_landmarker.task", base).href },
    runningMode: "VIDEO", numFaces: 1, outputFacialTransformationMatrixes: true });
  return tracker;
}

// «Объект»: the object under a tap (MediaPipe magic touch), confidence plane at 1024 px.
let interactive = null;
export async function objectMask(full, x, y) {
  await loadModels();
  interactive ||= await create(InteractiveSegmenter, {
    baseOptions: { modelAssetPath: new URL("models/magic_touch.tflite", base).href },
    outputConfidenceMasks: true, outputCategoryMask: false });
  const k = Math.min(1, 1024 / Math.max(full.width, full.height));
  const small = canvasOf(full, Math.max(1, Math.round(full.width * k)), Math.max(1, Math.round(full.height * k)));
  const res = interactive.segment(small, { keypoint: { x, y } });
  const plane = maskPlane(res.confidenceMasks[0]);
  res.close?.();
  return plane;
}
