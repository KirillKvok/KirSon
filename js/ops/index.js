// Importing this module registers every operation; ORDER is the pipeline order
// (the same as kirson/core/ops/__init__.py DEFAULT_ORDER; ops not ported yet are skipped).
import "./basic.js";
import "./filters.js";
import "./skin.js";

export const ORDER = ["face_select", "mask_edit", "heal", "skin", "skin_natural", "skin_tone", "face_light",
  "face_detail", "teeth_eyes", "makeup", "hair", "face_shape", "body", "background", "object", "liquify",
  "light", "brightness", "contrast", "color", "filter", "sharpen", "grain", "crop"];
