// «Лица на фото»: which faces the face operations edit — port of kirson/core/ops/faces.py.
// A hidden list of face indices (empty = every face), published in ctx.cache["face_select"];
// masks.getAnalysis then gives the face operations only the chosen faces.
import { register, hidden } from "../core/pipeline.js";

export function selectedFaces(p) {
  return [...new Set((Array.isArray(p.faces) ? p.faces : []).map((v) => Math.round(v)))].sort((a, b) => a - b);
}

register("face_select", "Лица на фото", [hidden("faces", [])], (img, p, ctx) => {
  ctx.cache.set("face_select", selectedFaces(p));
  return img;
}, { category: "Лицо", active: () => true }); // always runs: it (re)publishes the choice
