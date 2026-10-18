// Export for social networks (kirson/core/social.py): the network's own pixel size — bigger
// photos are scaled down by the service anyway, with its softer resampling; other proportions
// are filled by cropping around the faces; a light unsharp mask after downscaling. The canvas
// works in sRGB and writes no EXIF (no location goes public).
import * as I from "./core/img.js";

export const FORMATS = {
  post: { label: "Пост 4:5", w: 1080, h: 1350, suffix: "post" },
  square: { label: "Квадрат 1:1", w: 1080, h: 1080, suffix: "square" },
  story: { label: "Сторис 9:16", w: 1080, h: 1920, suffix: "story" },
  long: { label: "Telegram / VK", w: 2560, h: 0, suffix: "2560" }, // long side limit, no crop
};
const SHARPEN = 0.35;

// the crop (in source pixels) of proportions w:h around focus (normalised x, y)
export function cropFor(W, H, fmt, focus = [0.5, 0.5]) {
  if (!fmt.h) return { x: 0, y: 0, w: W, h: H };
  const q = fmt.w / fmt.h;
  const [cw, ch] = W / H > q ? [Math.round(H * q), H] : [W, Math.round(W / q)];
  const clip = (v, a, b) => Math.max(a, Math.min(b, v));
  const x = Math.round(clip(focus[0] * W - cw / 2, 0, W - cw));
  const y = Math.round(clip(focus[1] * H - ch * 0.4, 0, H - ch)); // the face a little above the centre
  return { x, y, w: cw, h: ch };
}

// ImageData of the edited photo -> canvas of the format
export function fit(image, fmt, focus) {
  const r = cropFor(image.width, image.height, fmt, focus);
  let tw, th;
  if (fmt.h) [tw, th] = r.w > fmt.w ? [fmt.w, fmt.h] : [r.w, r.h];
  else {
    const k = Math.min(1, fmt.w / Math.max(r.w, r.h));
    [tw, th] = [Math.round(r.w * k), Math.round(r.h * k)];
  }
  const src = document.createElement("canvas");
  src.width = image.width;
  src.height = image.height;
  src.getContext("2d").putImageData(image, 0, 0);
  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  const g = out.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, tw, th);
  if (tw < r.w) { // resampling softens fine detail: give it back lightly
    const d = g.getImageData(0, 0, tw, th), rgb = new Uint8ClampedArray(tw * th * 3);
    for (let i = 0; i < tw * th; i++) for (let c = 0; c < 3; c++) rgb[3 * i + c] = d.data[4 * i + c];
    const f = I.toFloat({ w: tw, h: th, data: rgb }), blur = I.gaussian(f, 1.0);
    for (let i = 0; i < tw * th; i++)
      for (let c = 0; c < 3; c++) {
        const j = 3 * i + c;
        d.data[4 * i + c] = (f.data[j] * (1 + SHARPEN) - blur.data[j] * SHARPEN) * 255 + 0.5;
      }
    g.putImageData(d, 0, 0);
  }
  return out;
}

// focus: the middle of the faces (normalised in the photo), or the centre
export function facesFocus(faces) {
  if (!faces?.length) return [0.5, 0.5];
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const f of faces)
    for (let i = 0; i < f.pts.length; i += 2) {
      x0 = Math.min(x0, f.pts[i]); x1 = Math.max(x1, f.pts[i]);
      y0 = Math.min(y0, f.pts[i + 1]); y1 = Math.max(y1, f.pts[i + 1]);
    }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}
