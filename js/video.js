// «До / после» video for stories: 1080×1920, the photo cropped around the faces (as the stories
// export), a divider sweeps from «до» to «после», holds, and settles in the middle. Recorded in
// real time from a canvas with MediaRecorder (MP4 on iPhone, WebM elsewhere).

const W = 1080, H = 1920, FPS = 30;
const T = { before: 0.9, sweep: 1.6, after: 1.3, back: 0.9, split: 1.6 }; // seconds

export function videoSupported() {
  return typeof MediaRecorder !== "undefined" && !!HTMLCanvasElement.prototype.captureStream && !!mimeType();
}

function mimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"])
    if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// the divider position (share of the width showing «после», from the left) at time t
function position(t) {
  let s = t;
  if ((s -= T.before) < 0) return 0;
  if (s < T.sweep) return ease(s / T.sweep);
  if ((s -= T.sweep) < T.after) return 1;
  if ((s -= T.after) < T.back) return 1 - 0.5 * ease(s / T.back);
  return 0.5;
}

function tag(g, text, x, y, alignRight) {
  g.font = "700 46px Manrope, 'Segoe UI', sans-serif";
  const w = g.measureText(text).width + 44, h = 70, x0 = alignRight ? x - w : x;
  g.fillStyle = "rgba(0, 0, 0, 0.42)";
  g.beginPath();
  if (g.roundRect) g.roundRect(x0, y, w, h, 22);
  else g.rect(x0, y, w, h); // older Safari
  g.fill();
  g.fillStyle = "#fff";
  g.textBaseline = "middle";
  g.fillText(text, x0 + 22, y + h / 2 + 2);
}

function frame(g, before, after, p) {
  g.drawImage(before, 0, 0, W, H);
  const x = Math.round(p * W);
  if (x > 0) g.drawImage(after, 0, 0, x, H, 0, 0, x, H);
  if (p > 0.002 && p < 0.998) { // the divider with its handle
    g.fillStyle = "#fff";
    g.shadowColor = "rgba(0, 0, 0, 0.45)";
    g.shadowBlur = 10;
    g.fillRect(x - 3, 0, 6, H);
    g.beginPath();
    g.arc(x, H / 2, 38, 0, 2 * Math.PI);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#3B241C";
    g.beginPath();
    g.moveTo(x - 8, H / 2 - 12); g.lineTo(x - 22, H / 2); g.lineTo(x - 8, H / 2 + 12);
    g.moveTo(x + 8, H / 2 - 12); g.lineTo(x + 22, H / 2); g.lineTo(x + 8, H / 2 + 12);
    g.fill();
  }
  if (p < 0.92) tag(g, "до", W - 48, 270, true); // below the stories header (avatar, progress)
  if (p > 0.08) tag(g, "после", 48, 270, false);
}

// before, after: canvases of W×H (social.fit with the stories format); resolves to a File
export async function record(before, after, name, onProgress = () => {}) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  frame(g, before, after, 0);
  const type = mimeType(), stream = c.captureStream(FPS);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((resolve) => (rec.onstop = resolve));
  const total = T.before + T.sweep + T.after + T.back + T.split;
  rec.start(250);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      frame(g, before, after, position(Math.min(t, total)));
      onProgress(Math.min(1, t / total));
      if (t >= total) return resolve();
      setTimeout(tick, 1000 / FPS); // timers, not animation frames: they keep going in the background
    };
    tick();
  });
  rec.stop();
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  const ext = type.includes("mp4") ? "mp4" : "webm";
  return new File(chunks, `${name}_до-после.${ext}`, { type: type.split(";")[0] });
}
