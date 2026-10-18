// Line icons for the tool buttons (24 px grid, one stroke style — the desktop's app/icons.py look)
// and the choice of icon for every tool. Colour choices (lipstick, blush, hair, backgrounds) show
// the colour itself instead of an icon.
const P = {
  sparkle: '<path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  smooth: '<path d="M4 15c3-4 5-4 8 0s5 4 8 0"/><path d="M4 9c3-4 5-4 8 0s5 4 8 0" opacity=".45"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  drop: '<path d="M12 3.5c3.5 4.4 5.5 7.4 5.5 10a5.5 5.5 0 0 1-11 0c0-2.6 2-5.6 5.5-10z"/>',
  dropHalf: '<path d="M12 3.5c3.5 4.4 5.5 7.4 5.5 10a5.5 5.5 0 0 1-11 0c0-2.6 2-5.6 5.5-10z"/><path d="M12 4v15" />',
  dropPlus: '<path d="M12 3.5c3.5 4.4 5.5 7.4 5.5 10a5.5 5.5 0 0 1-11 0c0-2.6 2-5.6 5.5-10z"/><path d="M12 11v5M9.5 13.5h5"/>',
  tone: '<circle cx="9" cy="10" r="5.5"/><circle cx="15" cy="14" r="5.5"/>',
  flame: '<path d="M12 21c-3.6 0-6-2.4-6-5.7 0-3.6 3.3-5.3 3.8-9.3 2.8 1.7 3.5 4.3 3.3 6 .9-.5 1.6-1.6 1.8-2.8 1.8 1.5 3.1 3.6 3.1 6.1 0 3.3-2.4 5.7-6 5.7z"/>',
  eye: '<path d="M2.8 12s3.3-6 9.2-6 9.2 6 9.2 6-3.3 6-9.2 6-9.2-6-9.2-6z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeUnder: '<path d="M3.5 10s3-4.5 8.5-4.5 8.5 4.5 8.5 4.5-3 4.5-8.5 4.5S3.5 10 3.5 10z"/><path d="M6 17.5c3.6 2 8.4 2 12 0"/>',
  eyeOpen: '<path d="M2.8 13s3.3-5 9.2-5 9.2 5 9.2 5-3.3 5-9.2 5-9.2-5-9.2-5z"/><circle cx="12" cy="13" r="2.3"/><path d="M12 3.5v2.5M6.5 5.2l1.2 2.1M17.5 5.2l-1.2 2.1"/>',
  folds: '<path d="M8 5c-1.5 4-1.5 8 1 13M16 5c1.5 4 1.5 8-1 13"/><path d="M12 7v6"/>',
  wrinkles: '<path d="M4 8c2-1.5 4-1.5 6 0s4 1.5 6 0 2.5-1 4-.5M4 13c2-1.5 4-1.5 6 0s4 1.5 6 0 2.5-1 4-.5M4 18c2-1.5 4-1.5 6 0s4 1.5 6 0"/>',
  sunSoft: '<circle cx="12" cy="12" r="4"/><path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1 1M17.4 17.4l1 1M5.6 18.4l1-1M17.4 6.6l1-1" opacity=".55"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  bulb: '<path d="M9 17.5h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1v.5h5V16c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  moon: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/>',
  tooth: '<path d="M7.5 3.8c-2.5 0-4 2-4 4.6 0 2.4 1.2 3.7 1.8 6.3.6 2.8 1 5.8 2.6 5.8 1.7 0 1.7-4.5 4.1-4.5s2.4 4.5 4.1 4.5c1.6 0 2-3 2.6-5.8.6-2.6 1.8-3.9 1.8-6.3 0-2.6-1.5-4.6-4-4.6-1.7 0-2.6 1-4.5 1s-2.8-1-4.5-1z"/>',
  iris: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M14.5 9.5l1.5-1.5"/>',
  grain: '<circle cx="6" cy="6" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="18" cy="5.5" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="5.5" cy="18" r="1"/><circle cx="11.5" cy="17.5" r="1"/><circle cx="18" cy="17" r="1"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19c3-4 6-7 9-9"/>',
  mountain: '<path d="M3 19l6-9 4 5 3-3.5L21 19z"/><circle cx="16.5" cy="6.5" r="1.8"/>',
  body: '<circle cx="12" cy="4.8" r="2.2"/><path d="M8 21v-7l-2-1 1.5-5h9l1.5 5-2 1v7M10 21v-5M14 21v-5"/>',
  person: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  group: '<circle cx="8.5" cy="9" r="3"/><circle cx="16" cy="8" r="2.5"/><path d="M3 19.5c.6-3.3 2.7-5 5.5-5s4.9 1.7 5.5 5M14 14.2c3.3-.6 6 .9 6.8 4.8"/>',
  oval: '<path d="M12 3c-4 0-6.5 3.2-6.5 7.6 0 5 3 10.4 6.5 10.4s6.5-5.4 6.5-10.4C18.5 6.2 16 3 12 3z"/><path d="M3 12h2M19 12h2" opacity=".5"/>',
  jaw: '<path d="M5.5 5v5c0 4.5 3 9 6.5 9s6.5-4.5 6.5-9V5"/><path d="M8.5 14.5l-2.5 2M15.5 14.5l2.5 2" opacity=".5"/>',
  chin: '<path d="M6 4v6c0 5 2.7 9 6 9s6-4 6-9V4"/><path d="M12 19v2.5M10.3 20.8L12 22.5l1.7-1.7"/>',
  nose: '<path d="M12 4c0 5-3.5 8.5-3.5 11.5 0 1.6 1.3 2.5 2.5 2.5h2c1.2 0 2.5-.9 2.5-2.5"/><path d="M8.5 15.5c-1 0-2 .8-2 2M15.5 15.5" />',
  lips: '<path d="M3 12c2.5-3.5 5-4.5 6.5-3.5.8.5 1.6.5 2.5 0s1.7-.5 2.5 0c1.5-1 4 0 6.5 3.5-2.5 3.5-5.5 5-9 5s-6.5-1.5-9-5z"/><path d="M3 12h18"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8 14c2 2.5 6 2.5 8 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4"/>',
  symmetry: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M10 6c-3 0-5 2.5-5 6s2 6 5 6M14 6c3 0 5 2.5 5 6s-2 6-5 6"/>',
  waist: '<path d="M7 3c0 4 3 5 3 9s-3 5-3 9M17 3c0 4-3 5-3 9s3 5 3 9"/><path d="M5 12h3M16 12h3"/>',
  hips: '<path d="M8 3v4c-2 2-3 5-3 8v6M16 3v4c2 2 3 5 3 8v6"/><path d="M3 13l2 1M21 13l-2 1"/>',
  legs: '<path d="M8 3l1 18M16 3l-1 18M12 9v12"/>',
  length: '<path d="M12 3v18M8.5 6.5L12 3l3.5 3.5M8.5 17.5L12 21l3.5-3.5"/>',
  arms: '<path d="M5 4c0 5 1.5 9 3 16M19 4c0 5-1.5 9-3 16"/><path d="M3.5 11h3M17.5 11h3" opacity=".5"/>',
  shoulders: '<circle cx="12" cy="6" r="2.5"/><path d="M3 15c1-4 4-5.5 9-5.5s8 1.5 9 5.5"/><path d="M2.5 19h4M17.5 19h4"/>',
  neck: '<circle cx="12" cy="6" r="3.5"/><path d="M10.5 9.5v5M13.5 9.5v5M5 19c1-3 3.5-4.5 7-4.5s6 1.5 7 4.5"/>',
  cheek: '<circle cx="12" cy="12" r="8.5"/><circle cx="8.5" cy="14" r="2.2" opacity=".55"/><circle cx="15.5" cy="14" r="2.2" opacity=".55"/>',
  brows: '<path d="M3.5 11c2-3 5-3.5 7.5-2M13 9c2.5-1.5 5.5-1 7.5 2"/><path d="M5 15.5c1.6-1 3.4-1 5 0M14 15.5c1.6-1 3.4-1 5 0" opacity=".5"/>',
  eyeliner: '<path d="M3 13c3-4 6-5 9-5s6.5 1.5 8.5 4l1.5-2"/><path d="M3 13c3 2.5 6 3.5 9 3.5s5.5-1 7.5-3" opacity=".5"/>',
  contour: '<path d="M12 3c-4 0-6.5 3.2-6.5 7.6 0 5 3 10.4 6.5 10.4s6.5-5.4 6.5-10.4C18.5 6.2 16 3 12 3z"/><path d="M7 13c1.2 2 2.8 3 5 3" opacity=".55"/>',
  hair: '<path d="M5 21c-1-6 0-12 3-15 2.5-2.5 5.5-2.5 8 0 3 3 4 9 3 15"/><path d="M9 21c-.5-5 0-9 1.5-12M15 21c.5-5 0-9-1.5-12M12 9v12"/>',
  volume: '<path d="M6 20c-2-5-1-11 2-14 2-2 6-2 8 0 3 3 4 9 2 14"/><path d="M3 9l2 1M21 9l-2 1M4 4.5l2 2M20 4.5l-2 2"/>',
  roots: '<path d="M4 9c2.5-4 5-5 8-5s5.5 1 8 5"/><path d="M7 21c0-6 2-9 5-11 3 2 5 5 5 11" opacity=".5"/><path d="M8 7.5l1 2M12 6v2.5M16 7.5l-1 2"/>',
  blur: '<circle cx="12" cy="12" r="8" opacity=".35"/><circle cx="12" cy="12" r="5.5" opacity=".6"/><circle cx="12" cy="12" r="3"/>',
  cursor: '<path d="M6 3l12 7.5-5.2 1.3L15.5 19l-2.6 1.3-2.7-7.2L6 17z"/>',
  eraser: '<path d="M4 17l9-10 7 6-6 7H8z"/><path d="M9.5 11.5l6 5.5M8 20h12"/>',
  close: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
  push: '<path d="M4 12h12M12 7l5 5-5 5"/><circle cx="19.5" cy="12" r="1.2"/>',
  shrink: '<path d="M4 4l5 5M20 4l-5 5M4 20l5-5M20 20l-5-5"/><path d="M9 5v4H5M15 5v4h4M9 19v-4H5M15 19v-4h4"/>',
  expand: '<path d="M9 9L4 4M15 9l5-5M9 15l-5 5M15 15l5 5"/><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  bandage: '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="M10.5 11h.01M13.5 13h.01M12 10.2h.01M12 13.8h.01" stroke-width="2"/>',
  brush: '<path d="M14 4l6 6-8.5 8.5-6-6z"/><path d="M5.5 12.5C3 13.5 3 17 2.5 21c4-.5 7.5-.5 8.5-3"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  size: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.2"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  rect: '<rect x="5" y="4" width="14" height="16" rx="2"/>',
  tilt: '<rect x="5" y="5" width="14" height="14" rx="2" transform="rotate(-12 12 12)"/><path d="M3 21h18" opacity=".5"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>',
  flip: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L4 17h5zM15 7l5 10h-5z"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>',
  thermo: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 10v7"/>',
  tint: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/><path d="M12 8.6v6.8" opacity=".5"/>',
  sharp: '<path d="M12 3l9 16H3z"/><path d="M12 9v5" />',
  clarity: '<path d="M12 3l8 9-8 9-8-9z"/><path d="M12 3v18M4 12h16" opacity=".45"/>',
  slider: '<path d="M4 8h10M18 8h2M4 16h3M11 16h9"/><circle cx="16" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bookmark: '<path d="M7 3.5h10v17l-5-4-5 4z"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5" opacity=".55"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5v5l4.5-2.5z"/><path d="M3 9h2M3 15h2M19 9h2M19 15h2"/>',
  lamp: '<path d="M5 4l7 5 7-5"/><path d="M12 9v3"/><path d="M7 20l5-8 5 8" opacity=".5"/><circle cx="12" cy="12" r="1.6"/>',
  eyeshadow: '<path d="M3 14c3-3.5 6-5 9-5s6 1.5 9 5"/><path d="M5 10.5c2.2-3 4.6-4.5 7-4.5s4.8 1.5 7 4.5" opacity=".5"/><path d="M3 14c3 2.5 6 3.5 9 3.5s6-1 9-3.5" opacity=".5"/>',
  lashes: '<path d="M3 14c3-3.5 6-5 9-5s6 1.5 9 5"/><path d="M6 11.5L4.5 8.5M9 10l-1-3.5M12 9.3V5.5M15 10l1-3.5M18 11.5l1.5-3"/>',
  grid: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.5"/>',
  undo: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
};

const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${P[k] || P.slider}</svg>`;

// op.param -> icon
const BY_PARAM = {
  "skin.smooth": "smooth", "skin.blemish": "target", "skin.texture": "grain", "skin.body": "body",
  "face_light.matte": "drop", "face_light.soften": "sunSoft", "face_light.fill": "bulb", "relight.amount": "lamp", "relight.dir": "lamp",
  "skin_tone.even": "tone", "skin_tone.redness": "flame", "skin_tone.tan": "sun",
  "face_detail.circles": "eyeUnder", "face_detail.bags": "eyeUnder", "face_detail.folds": "folds", "face_detail.wrinkles": "wrinkles",
  "teeth_eyes.teeth": "tooth", "teeth_eyes.sclera": "eye", "teeth_eyes.iris": "iris",
  "skin_natural.texture": "leaf", "skin_natural.volume": "mountain",
  "face_shape.slim": "oval", "face_shape.jaw": "jaw", "face_shape.chin": "chin", "face_shape.eyes": "eye",
  "face_shape.eye_open": "eyeOpen", "face_shape.nose": "nose", "face_shape.lips": "lips", "face_shape.smile": "smile",
  "face_shape.symmetry": "symmetry",
  "body.waist": "waist", "body.hips": "hips", "body.legs": "legs", "body.length": "length", "body.arms": "arms",
  "body.shoulders": "shoulders", "body.neck": "neck",
  "makeup.lips": "lips", "makeup.blush": "cheek", "makeup.brows": "brows", "makeup.eyeliner": "eyeliner", "makeup.contour": "contour", "makeup.shadow": "eyeshadow", "makeup.mascara": "lashes", "makeup.highlight": "sparkle", "makeup.iris": "iris",
  "hair.thick": "hair", "hair.volume": "volume", "hair.amount": "dropHalf", "hair.shine": "sparkle", "hair.roots": "roots",
  "background.blur": "blur", "background.brightness": "sun", "background.saturation": "dropHalf",
  "object.brightness": "sun", "object.contrast": "contrast", "object.saturation": "dropHalf", "object.sharpness": "blur",
  "crop.angle": "tilt",
  "light.shadows": "moon", "light.highlights": "sun", "brightness.amount": "sunSoft", "contrast.amount": "contrast",
  "color.saturation": "dropHalf", "color.vibrance": "dropPlus", "color.temperature": "thermo", "color.tint": "tint",
  "sharpen.sharpness": "sharp", "sharpen.clarity": "clarity",
  "filter.amount": "slider", "grain.amount": "grain", "grain.size": "size",
};
const BY_KIND = {
  auto: "sparkle", strength: "slider", reset: "reset", facePick: "person", faceAll: "group",
  objectPick: "cursor", objectRemove: "eraser", objectClear: "close", brushSize: "size", brushStrength: "gauge",
  brushClear: "trash", aspect: "rect", rotate: "rotate", flip: "flip", frameReset: "reset",
  presetSave: "plus", versionSave: "bookmark", compare: "grid", batch: "layers", enhance: "sparkle", videoEdit: "film", myPreset: "layers", preset: "layers",
};
const BRUSH = { liquify: ["push", "shrink", "expand"], heal: ["bandage"], mask_edit: ["shield", "brush", "person", "mountain"] };

// colour of a colour choice (CSS), or null
export function swatchFor(t, colors) {
  const c = colors[`${t.op}.${t.param}`];
  return c ? c(t.option) : null;
}

export function iconFor(t) {
  if (t.kind === "brush") return svg(BRUSH[t.tool]?.[t.mode] || "brush");
  if (t.kind === "look") return null; // looks get a glass orb (CSS)
  if (t.kind) return svg(BY_KIND[t.kind] || "slider");
  return svg(BY_PARAM[`${t.op}.${t.param}`] || "slider");
}
