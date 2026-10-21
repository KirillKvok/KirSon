// Brush tools — ports of kirson/core/ops/liquify.py, mask_edit.py, heal.py.
// A stroke is [mode, radius, strength, x0, y0, x1, y1, ...]: radius as a fraction of the long
// side, points as fractions of width / height — the same strokes on the preview and the export.
import { register, hidden } from "../core/pipeline.js";
import * as I from "../core/img.js";
import { Canvas, dilate, distance } from "../core/draw.js";
import { getMask } from "../face/masks.js";
import { Field } from "../core/warp.js";

export const BRUSH_TAB = "Кисти";
const SCALE_MAX = 0.22, PUSH_SPACING = 0.2, DAB_SPACING = 0.45;

export function strokesOf(v) {
  return Array.isArray(v) ? v.filter((s) => Array.isArray(s) && s.length >= 5) : [];
}

function pathPx(s, w, h) {
  const pts = [];
  for (let i = 3; i + 1 < s.length; i += 2) pts.push([s[i] * w, s[i + 1] * h]);
  return pts;
}

// points along the polyline every `step` px (keeps both ends)
function resample(pts, step) {
  if (pts.length < 2) return pts;
  step = Math.max(step, 0.5);
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > 0.01) out.push(last);
  return out;
}

// --- «Пластика»: push / shrink / enlarge ----------------------------------------------------
export const LIQUIFY_MODES = ["Сдвиг", "Сузить", "Расширить", "Вернуть как было", "Заморозить"];
const RESTORE = 3; // the deformation made by earlier strokes fades back to the photo where it passes
// «Заморозить»: painted places do not move at all — whatever strokes come before or after (an eye, a
// hand, the line of a door next to the waist being pulled)
export const FREEZE = 4;
const MOVES = (s) => { const m = Math.round(s[0]); return m !== RESTORE && m !== FREEZE; };

// `only`: the strokes to take (null = all); «Вернуть как было» always applies to what came before it
export function buildField(strokes, w, h, only = null) {
  const field = new Field(), long = Math.max(w, h);
  for (const s of strokes) {
    const mode = Math.round(s[0]), r = s[1] * long, k = Math.min(1, Math.max(0, s[2]));
    if (r < 1 || k <= 0) continue;
    if (mode === FREEZE) continue;
    const pts = pathPx(s, w, h);
    if (mode === RESTORE) field.fade(pts, r, k);
    else if (only && !only.has(s)) continue;
    else if (mode === 0) {
      const path = resample(pts, r * PUSH_SPACING);
      for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i], b = path[i + 1];
        field.push(a, [(b[0] - a[0]) * k, (b[1] - a[1]) * k], r * 0.5);
      }
    } else {
      const sign = mode === 1 ? -1 : 1;
      for (const c of resample(pts, r * DAB_SPACING)) field.scale(c, sign * SCALE_MAX * k, r);
    }
  }
  return field;
}

// «Защита фона» (hidden `protect`, on by default): a stroke drawn over a person moves the person; the
// background next to them follows only within a narrow band — enough to fill what the person uncovered —
// and is untouched beyond it (doors and shelves stay straight), as in «Фигура». A stroke drawn over the
// background itself moves everything (she means the background then).
const BG_BAND = 0.015;

function personOf(img, ctx) {
  try {
    const m = getMask(img, ctx, "person");
    for (let i = 0; i < m.data.length; i += 97) if (m.data[i] > 0.5) return m;
  } catch { /* no analysis yet: no people known */ }
  return null;
}

// share of the stroke's path over the person
function overPerson(s, person) {
  const { w, h } = person, pts = pathPx(s, w, h);
  let n = 0;
  for (const [x, y] of pts) n += person.data[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))];
  return n / pts.length;
}

register("liquify", "Ручная пластика", [hidden("strokes", []), hidden("protect", 1)],
  (img, p, ctx) => {
    const strokes = strokesOf(p.strokes);
    if (!strokes.some(MOVES)) return img;
    const { w, h } = img, frozen = rasterize(strokes, FREEZE, w, h);
    const keep = frozen && I.mapPlane(frozen, (v) => 1 - v);
    const warpOf = (only) => {
      const wp = buildField(strokes, w, h, only).compute(w, h);
      return wp && keep ? wp.attenuated(keep) : wp;
    };
    const person = (p.protect ?? 1) ? personOf(img, ctx) : null;
    const onPerson = new Set(person ? strokes.filter((s) => MOVES(s) && overPerson(s, person) >= 0.5) : []);
    if (!onPerson.size) {
      const wp = warpOf(null);
      return wp ? wp.apply(img) : img;
    }
    const free = new Set(strokes.filter((s) => MOVES(s) && !onPerson.has(s)));
    let out = img;
    const wp = warpOf(onPerson);
    if (wp) {
      // the person layer gets the whole warp, the background the same one fading out from the silhouette
      let dist = ctx.cache.get(`liquify_dist:${w}x${h}`);
      if (!dist || dist[0] !== person) ctx.cache.set(`liquify_dist:${w}x${h}`, (dist = [person, distance(person, (v) => v >= 0.5)]));
      const mv = wp.moved(w, h);
      let mvMax = 0;
      for (let i = 0; i < mv.data.length; i++) if (mv.data[i] > mvMax) mvMax = mv.data[i];
      // zero from max(3 % of the frame, 2.5x the largest move): the uncovered strip is filled by the
      // background stretched at most ~40 %, and beyond that the background is the photo's own (the
      // 3x-band of «Фигура» is too wide for hand strokes, which move much more)
      const reach = Math.max(BG_BAND * 2 * Math.max(w, h), 2.5 * mvMax);
      const fall = I.mapPlane(dist[1], (d) => { const t = Math.min(1, d / reach); return (1 - t) * (1 - t) * (1 + 2 * t); });
      const layer = wp.apply(img), alpha = wp.apply(person), bg = wp.attenuated(fall).apply(img);
      const data = new Uint8ClampedArray(img.data.length);
      for (let i = 0; i < w * h; i++) {
        const al = alpha.data[i];
        for (let c = 0; c < 3; c++) {
          const j = 3 * i + c;
          data[j] = layer.data[j] * al + bg.data[j] * (1 - al) + 0.5;
        }
      }
      out = { w, h, data };
    }
    // strokes over the background: everything moves
    if (free.size) {
      const fw = warpOf(free);
      if (fw) out = fw.apply(out);
    }
    return out;
  }, { category: BRUSH_TAB, active: (p) => strokesOf(p.strokes).length > 0 });

// --- «Маски»: corrections of the automatic masks ------------------------------------------------
export const MASK_LAYERS = ["Не трогать", "Это кожа", "Это человек", "Это фон"];
const RETOUCH = ["face_skin", "body_skin", "lips", "mouth_inner", "teeth", "eyes", "iris", "sclera", "brows", "cheeks",
  "eyeliner", "contour_shadow", "contour_light", "hair", "face_oval"];
const EFFECTS = [[-1, RETOUCH], [1, ["face_skin", "body_skin"]], [1, ["person"]], [-1, ["person", "hair"]]];

// soft 0..1 map of the strokes of one mode (null if none)
export function rasterize(strokes, mode, w, h) {
  const own = strokes.filter((s) => Math.round(s[0]) === mode);
  if (!own.length) return null;
  const long = Math.max(w, h), out = I.plane(w, h);
  for (const s of own) {
    const r = Math.max(1, s[1] * long), pts = pathPx(s, w, h), c = new Canvas(w, h);
    if (pts.length === 1) c.circle(pts[0], r);
    else c.polyline(pts, 2 * r); // round caps and joins
    const m = I.gaussian(c.plane(), Math.max(0.6, r * 0.25)), k = Math.min(1, Math.max(0, s[2]));
    for (let i = 0; i < out.data.length; i++) out.data[i] = Math.max(out.data[i], m.data[i] * k);
  }
  return out;
}

register("mask_edit", "Правка масок", [hidden("strokes", [])], (img, p, ctx) => {
  // publishes the strokes: masks.getMask applies them to every mask later operations ask for
  const strokes = strokesOf(p.strokes);
  ctx.cache.set("mask_edits_key", strokes.length ? JSON.stringify(strokes) : "");
  ctx.cache.set("mask_edits_apply", strokes.length ? (name, base) => {
    let out = base;
    EFFECTS.forEach(([sign, names], layer) => {
      if (!names.includes(name)) return;
      const m = rasterize(strokes, layer, base.w, base.h);
      if (!m) return;
      out = I.mapPlane(out, (v, i) => (sign > 0 ? Math.max(v, m.data[i]) : v * (1 - m.data[i])));
    });
    return out;
  } : null);
  return img;
}, { category: BRUSH_TAB, active: () => true });

// --- «Заплатка»: healing brush --------------------------------------------------------------------
// texture from the best-matching nearby patch, tone and colour from around the spot
const N_DIRECTIONS = 16;

function healSpot(img, mask, radius) {
  const { w, h } = img;
  const hb = I.bbox(mask, 0, 0.3);
  if (!hb) return img;
  const extent = Math.max(hb.x1 - hb.x0, hb.y1 - hb.y0);
  const dist = 2.2 * radius + extent / 4, pad = Math.ceil(dist + 3 * radius) + 4;
  const b = { x0: Math.max(0, hb.x0 - pad), y0: Math.max(0, hb.y0 - pad), x1: Math.min(w, hb.x1 + pad), y1: Math.min(h, hb.y1 + pad) };
  const f = I.cropFloat(img, b), m = I.crop(mask, b), cw = f.w, ch = f.h;
  const hole = I.mapPlane(m, (v) => (v > 0.3 ? 1 : 0));
  const ring = dilate(hole, Math.max(1, Math.round(radius / 2)));
  const holeIdx = [], ringIdx = [];
  for (let i = 0; i < cw * ch; i++) {
    if (hole.data[i]) holeIdx.push(i);
    else if (ring.data[i]) ringIdx.push(i);
  }
  let best = null, bestScore = Infinity;
  for (let k = 0; k < N_DIRECTIONS; k++)
    for (const scale of [1, 1.4]) {
      const a = (2 * Math.PI * k) / N_DIRECTIONS;
      const dy = Math.round(Math.sin(a) * dist * scale), dx = Math.round(Math.cos(a) * dist * scale);
      let ok = true;
      for (const i of holeIdx) { // the shifted hole stays in the crop and off the hole
        const x = (i % cw) + dx, y = Math.floor(i / cw) + dy;
        if (x < 0 || y < 0 || x >= cw || y >= ch || hole.data[y * cw + x]) { ok = false; break; }
      }
      if (!ok) continue;
      let sc = 0;
      for (const i of ringIdx) {
        const x = Math.min(cw - 1, Math.max(0, (i % cw) + dx)), y = Math.min(ch - 1, Math.max(0, Math.floor(i / cw) + dy));
        const j = y * cw + x;
        sc += Math.abs(f.data[3 * j] - f.data[3 * i]) + Math.abs(f.data[3 * j + 1] - f.data[3 * i + 1]) + Math.abs(f.data[3 * j + 2] - f.data[3 * i + 2]);
      }
      sc /= Math.max(1, ringIdx.length);
      if (sc < bestScore) { bestScore = sc; best = [dx, dy]; }
    }
  // tone: blur of the surroundings only (normalised, the hole ignored)
  const sigma = Math.max(1, radius * 0.6), keep = I.mapPlane(hole, (v) => 1 - v), fk = I.fimg(cw, ch, 3);
  for (let i = 0; i < cw * ch; i++) for (let c = 0; c < 3; c++) fk.data[3 * i + c] = f.data[3 * i + c] * keep.data[i];
  const num = I.gaussian(fk, sigma), den = I.gaussian(keep, sigma);
  const fill = I.fimg(cw, ch, 3);
  for (let i = 0; i < cw * ch; i++) for (let c = 0; c < 3; c++) fill.data[3 * i + c] = num.data[3 * i + c] / Math.max(den.data[i], 1e-4);
  if (best) { // only the fine texture comes from the source patch
    const fineS = Math.max(0.8, radius * 0.18), blur = I.gaussian(f, fineS), [dx, dy] = best;
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const sx = Math.min(cw - 1, Math.max(0, x + dx)), sy = Math.min(ch - 1, Math.max(0, y + dy)), j = sy * cw + sx, i = y * cw + x;
        for (let c = 0; c < 3; c++) fill.data[3 * i + c] += f.data[3 * j + c] - blur.data[3 * j + c];
      }
  }
  const grow = Math.max(1, Math.round(radius * 0.2)); // cover the blemish's soft rim too
  const alpha = I.mapPlane(I.gaussian(dilate(m, grow), Math.max(0.7, radius * 0.15)), (v) => Math.min(1, v * 1.25));
  for (let i = 0; i < cw * ch; i++) for (let c = 0; c < 3; c++) {
    const j = 3 * i + c;
    f.data[j] = f.data[j] * (1 - alpha.data[i]) + fill.data[j] * alpha.data[i];
  }
  return I.withPart(img, I.clamp01(f), b);
}

register("heal", "Заплатка", [hidden("strokes", [])], (img, p) => {
  let out = img;
  const long = Math.max(img.w, img.h);
  for (const s of strokesOf(p.strokes)) {
    const mask = rasterize([[0, s[1], 1, ...s.slice(3)]], 0, out.w, out.h);
    if (!mask) continue;
    const healed = healSpot(out, mask, s[1] * long), k = Math.min(1, Math.max(0, s[2]));
    out = k >= 0.999 ? healed : { w: out.w, h: out.h, data: out.data.map((v, i) => v + (healed.data[i] - v) * k) };
  }
  return out;
}, { category: BRUSH_TAB, active: (p) => strokesOf(p.strokes).length > 0 });
