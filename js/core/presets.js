// Looks and built-in presets (generated from kirson/core/presets.py) + strength scaling.
import { REGISTRY } from "./pipeline.js";

export const LOOKS = {
  "Выразительный": {
    "skin": {
      "smooth": 55,
      "blemish": 85
    },
    "teeth_eyes": {
      "teeth": 25,
      "sclera": 45,
      "iris": 55
    },
    "makeup": {
      "lips": 55,
      "lip_color": 2,
      "brows": 70,
      "eyeliner": 70,
      "contour": 55,
      "blush": 25,
      "blush_color": 0
    },
    "face_shape": {
      "eyes": 25,
      "lips": 35
    },
    "light": {
      "shadows": 10
    },
    "contrast": {
      "amount": 8
    }
  },
  "Нюд": {
    "skin": {
      "smooth": 60,
      "texture": 90,
      "blemish": 85
    },
    "teeth_eyes": {
      "teeth": 30,
      "sclera": 30,
      "iris": 15
    },
    "makeup": {
      "lips": 55,
      "lip_color": 3,
      "blush": 30,
      "blush_color": 1,
      "brows": 20,
      "contour": 20
    },
    "light": {
      "shadows": 20
    },
    "brightness": {
      "amount": 12
    },
    "color": {
      "saturation": -8,
      "temperature": 5
    }
  },
  "Вечерний": {
    "skin": {
      "smooth": 65,
      "blemish": 90
    },
    "teeth_eyes": {
      "teeth": 30,
      "sclera": 40,
      "iris": 45
    },
    "makeup": {
      "lips": 75,
      "lip_color": 1,
      "eyeliner": 90,
      "brows": 60,
      "contour": 75,
      "blush": 20,
      "blush_color": 0
    },
    "face_shape": {
      "slim": 25,
      "eyes": 20,
      "nose": -25,
      "lips": 25
    },
    "light": {
      "highlights": -15
    },
    "contrast": {
      "amount": 15
    }
  },
  "Сияние": {
    "skin": {
      "smooth": 70,
      "texture": 85,
      "blemish": 85
    },
    "teeth_eyes": {
      "teeth": 35,
      "sclera": 50,
      "iris": 40
    },
    "makeup": {
      "lips": 40,
      "lip_color": 4,
      "blush": 45,
      "blush_color": 0,
      "brows": 30,
      "eyeliner": 25,
      "contour": 35
    },
    "light": {
      "shadows": 25
    },
    "brightness": {
      "amount": 8
    },
    "color": {
      "vibrance": 20,
      "temperature": 6
    }
  }
};

export const BUILTIN = {
  "Естественный": {
    "skin": {
      "smooth": 50,
      "blemish": 80
    },
    "teeth_eyes": {
      "teeth": 30,
      "sclera": 30,
      "iris": 20
    },
    "light": {
      "shadows": 15
    }
  },
  "Гламур": {
    "skin": {
      "smooth": 75,
      "texture": 80,
      "blemish": 100
    },
    "teeth_eyes": {
      "teeth": 50,
      "sclera": 50,
      "iris": 40
    },
    "makeup": {
      "lips": 40,
      "lip_color": 0,
      "blush": 40,
      "brows": 40
    },
    "face_shape": {
      "slim": 40,
      "eyes": 25,
      "nose": -30
    },
    "color": {
      "vibrance": 20,
      "temperature": 8
    }
  },
  "Портрет": {
    "skin": {
      "smooth": 55,
      "blemish": 80
    },
    "teeth_eyes": {
      "sclera": 30,
      "iris": 30
    },
    "background": {
      "blur": 70,
      "brightness": -15
    },
    "light": {
      "shadows": 20
    }
  },
  "Фигура": {
    "body": {
      "waist": 50,
      "hips": 30,
      "legs": 40,
      "length": 40
    },
    "face_shape": {
      "slim": 20
    }
  },
  "Плёнка": {
    "skin": {
      "smooth": 40,
      "blemish": 70
    },
    "filter": {
      "style": 3,
      "amount": 80
    }
  }
};

// Look at `strength` (0..1.5): every slider moves from its default toward the look's value
// (not multiplied: «Текстура» defaults to 100). Choices are kept as they are.
export function scaled(values, strength) {
  const out = {};
  for (const [op, params] of Object.entries(values)) {
    const res = {};
    for (const p of REGISTRY[op]?.params || []) {
      if (!(p.name in params)) continue;
      const v = params[p.name];
      res[p.name] = p.options ? v : Math.min(p.max, Math.max(p.min, p.def + (v - p.def) * strength));
    }
    out[op] = res;
  }
  return out;
}
