// «Авто»: measure the photo and suggest gentle slider values — port of kirson/core/auto.py
// (ramps calibrated on the 18 test photos). Runs in the worker on the preview.
import * as I from "./img.js";
import { getAnalysis, getMask, refFaceWidth } from "../face/masks.js";
import { blemishMask } from "../ops/skin.js";
import { nblur } from "../ops/tone.js";
import { zones } from "../ops/detail.js";
import { skinCast } from "../ops/basic.js";

function measure(img, ctx) {
  if (!getAnalysis(ctx).faces.length) return null;
  const fw = refFaceWidth(img, ctx), skin = getMask(img, ctx, "face_skin");
  const sel = [];
  for (let i = 0; i < skin.data.length; i++) if (skin.data[i] > 0.9) sel.push(i);
  if (sel.length < 200) return null;
  const f = I.toFloat(img), lab = I.rgbToLab(f), n = img.w * img.h;
  const L = I.fimg(img.w, img.h, 1), chroma = I.fimg(img.w, img.h, 1);
  for (let i = 0; i < n; i++) {
    L.data[i] = lab.data[3 * i];
    chroma.data[i] = Math.hypot(lab.data[3 * i + 1], lab.data[3 * i + 2]);
  }
  const blur = I.gaussian(L, Math.max(1, 0.01 * fw)), base = nblur(L, skin, 0.12 * fw);
  const medChroma = I.percentile(sel.map((i) => chroma.data[i]), 0.5);
  let r2 = 0, rm = 0, shine = 0;
  for (const i of sel) {
    const r = L.data[i] - blur.data[i];
    rm += r; r2 += r * r;
    if (L.data[i] - base.data[i] > 6 && chroma.data[i] < medChroma) shine++;
  }
  rm /= sel.length;
  const [eye] = zones(img, ctx);
  const zone = sel.filter((i) => eye.data[i] > 0.6), cheek = sel.filter((i) => eye.data[i] < 0.05);
  const spots = blemishMask(I.gaussian(f, Math.max(0.6, fw * 0.004)), skin, fw);
  const a = sel.map((i) => lab.data[3 * i + 1]), Ls = sel.map((i) => L.data[i]);
  return {
    roughness: Math.sqrt(r2 / sel.length - rm * rm),
    spots: sel.filter((i) => spots.data[i] > 0.5).length / sel.length,
    shine: shine / sel.length,
    circles: zone.length > 50 ? I.percentile(cheek.map((i) => L.data[i]), 0.5) - I.percentile(zone.map((i) => L.data[i]), 0.5) : 0,
    redness: I.percentile(a, 0.95) - I.percentile(a, 0.5),
    faceL: I.percentile(Ls, 0.5),
    spread: I.percentile(Ls, 0.9) - I.percentile(Ls, 0.1),
  };
}

const ramp = (x, lo, hi, a, b) => Math.round(a + Math.min(1, Math.max(0, (x - lo) / (hi - lo))) * (b - a));

// The whole photo: exposure, clipped highlights, flat contrast (lightness percentiles over every 7th pixel)
function photoLight(img) {
  const f = I.toFloat(img), Ls = [];
  for (let i = 0; i < f.data.length; i += 21) {
    const y = 0.2126 * f.data[i] + 0.7152 * f.data[i + 1] + 0.0722 * f.data[i + 2];
    Ls.push(116 * Math.cbrt(Math.max(0.008856, y)) - 16);
  }
  const p = (q) => I.percentile(Ls, q), clipped = Ls.filter((v) => v > 97).length / Ls.length;
  return {
    brightness: { amount: ramp(42 - p(0.5), 0, 15, 0, 20) },
    light: { highlights: -ramp(clipped, 0.01, 0.06, 0, 35) },
    contrast: { amount: ramp(60 - (p(0.95) - p(0.05)), 0, 20, 0, 15) },
  };
}

export function suggest(img, ctx) {
  const m = measure(img, ctx), whole = photoLight(img);
  const merge = (vals) => {
    for (const [op, d] of Object.entries(whole)) vals[op] = { ...(vals[op] || {}), ...d };
    const cast = skinCast(img, ctx); // the lamp's colour cast, read off the face
    if (cast && Math.abs(cast.hue - 55) > 3) vals.color = { ...(vals.color || {}), skin_wb: 70 };
    if (getAnalysis(ctx).poses.length) vals.clothes = { smooth: 30 }; // creased clothes: a little
    return vals;
  };
  if (!m) {
    const L = I.rgbToLab(I.toFloat(img)), Ls = [];
    for (let i = 0; i < L.data.length; i += 3) Ls.push(L.data[i]);
    return keep(merge({ light: { shadows: ramp(55 - I.percentile(Ls, 0.5), 0, 25, 0, 30) } }));
  }
  const vals = merge({
    skin: { smooth: ramp(m.roughness, 1, 2.2, 25, 60), blemish: ramp(m.spots, 0.003, 0.03, 40, 85) },
    skin_natural: { texture: 25 },
    skin_tone: { even: 30, redness: ramp(m.redness, 6, 14, 0, 60) },
    face_light: { matte: ramp(m.shine, 0.03, 0.15, 0, 60), soften: ramp(m.spread, 25, 45, 0, 40) },
    face_detail: { circles: ramp(m.circles, 2, 10, 0, 50) },
    teeth_eyes: { teeth: 30, sclera: 30, iris: 20 },
    light: { shadows: ramp(60 - m.faceL, 0, 20, 0, 30) },
    color: { vibrance: 10 },
    sharpen: { sharpness: 20 },
  });
  return keep(vals);
}

// only what changes something (zeros dropped)
function keep(vals) {
  const out = {};
  for (const [op, d] of Object.entries(vals)) {
    const kept = Object.fromEntries(Object.entries(d).filter(([, v]) => v));
    if (Object.keys(kept).length) out[op] = kept;
  }
  return out;
}
