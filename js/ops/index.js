// Importing this module registers every operation; ORDER is the pipeline order
// (the same as kirson/core/ops/__init__.py DEFAULT_ORDER; ops not ported yet are skipped).
import "./basic.js";
import "./filters.js";
import "./skin.js";
import "./tone.js";
import "./detail.js";
import "./shape.js";
import "./body.js";
import "./makeup.js";
import "./hair.js";
import "./background.js";
import "./crop.js";
import "./brushes.js";
import "./faces.js";
import "./object.js";
import "./relight.js";
import "./freckles.js";

export const ORDER = ["face_select", "mask_edit", "heal", "skin", "skin_natural", "skin_tone", "freckles", "face_light", "relight",
  "face_detail", "teeth_eyes", "makeup", "hair", "face_shape", "body", "clothes", "background", "object", "liquify",
  "light", "brightness", "contrast", "color", "filter", "sharpen", "grain", "crop"];
