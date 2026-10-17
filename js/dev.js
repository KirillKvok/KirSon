// Development helpers (loaded only on localhost): open a test photo, render a variant and save
// a "before | after" collage to out/web/ through the dev server (tools/web_dev_server.py).
import { Pipeline } from "./core/pipeline.js";

const K = () => window.kirson;

export async function load(name = "IMG_8955.jpg") {
  const blob = await (await fetch(`/_dev/${name}`)).blob();
  await K().openFile(new File([blob], name, { type: "image/jpeg" }));
  for (let i = 0; i < 200 && !K().app.analysis; i++) await new Promise((r) => setTimeout(r, 300));
  return { faces: K().app.analysis?.faces.length, w: K().app.original.width, h: K().app.original.height };
}

function faceBox(W, H, pad = 0.15) {
  const pts = K().app.analysis.faces[0].pts;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  const px = (x1 - x0) * pad, py = (y1 - y0) * pad;
  x0 = Math.max(0, x0 - px); y0 = Math.max(0, y0 - py); x1 = Math.min(1, x1 + px); y1 = Math.min(1, y1 + py);
  return [Math.round(x0 * W), Math.round(y0 * H), Math.round((x1 - x0) * W), Math.round((y1 - y0) * H)];
}

function canvasFrom(imageData) {
  const c = document.createElement("canvas");
  c.width = imageData.width;
  c.height = imageData.height;
  c.getContext("2d").putImageData(imageData, 0, 0);
  return c;
}

// variants: [[label, {op: {param: value}}], ...]; crop: "face" | "full"; key: "preview" | "full"
export async function grid(name, variants, { crop = "face", key = "preview", tile = 520 } = {}) {
  const { app, engine } = K();
  if (key === "full") engine.setImage("full", app.original, 1, app.imageId);
  const tiles = [];
  for (const [label, vals] of variants) {
    const st = Pipeline.fromJSON(app.pipeline.toJSON());
    for (const [op, v] of Object.entries(vals)) Object.assign(st.step(op).values, v);
    const t = performance.now();
    const { image } = await engine.render(key, st.toJSON());
    tiles.push({ label: `${label} (${Math.round(performance.now() - t)} ms)`, c: canvasFrom(image) });
  }
  if (key === "full") engine.drop("full");
  const W = tiles[0].c.width, H = tiles[0].c.height;
  const box = crop === "face" && app.analysis?.faces.length ? faceBox(W, H) : [0, 0, W, H];
  const th = Math.round((tile * box[3]) / box[2]);
  const cols = Math.min(3, tiles.length), rows = Math.ceil(tiles.length / cols);
  const out = document.createElement("canvas");
  out.width = cols * tile;
  out.height = rows * th;
  const g = out.getContext("2d");
  g.font = "bold 22px sans-serif";
  tiles.forEach((t, k) => {
    const x = (k % cols) * tile, y = Math.floor(k / cols) * th;
    g.drawImage(t.c, box[0], box[1], box[2], box[3], x, y, tile, th);
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(x, y, g.measureText(t.label).width + 16, 32);
    g.fillStyle = "#fff";
    g.fillText(t.label, x + 8, y + 24);
  });
  const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", 0.92));
  const res = await fetch(`/__save?name=${encodeURIComponent(name)}`, { method: "POST", body: blob });
  return res.text();
}
