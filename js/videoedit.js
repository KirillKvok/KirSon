// Retouch of a short video (selfie videos up to MAX_SECONDS): every frame goes through the same
// edit as a photo (its own face analysis), then the video is put together again with its sound.
//  1. frames: the video is sought frame by frame (FPS), drawn at the output size, edited by
//     `processFrame(ImageData) -> ImageData`, kept as JPEG (hundreds of raw frames would not fit
//     in a phone's memory);
//  2. sound: the file's audio decoded whole (AudioContext.decodeAudioData — AAC in MP4/MOV works
//     in Safari and Chrome); none if that fails;
//  3. assembly in real time: the sound plays into a MediaStreamDestination, frames are drawn by the
//     sound's clock on a canvas, MediaRecorder records both (MP4 on iPhone and in Chrome).
const MAX_SECONDS = 15, MAX_FRAMES = 180;

function once(target, ev) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); }, bad = () => { cleanup(); reject(new Error(`video ${ev} failed`)); };
    const cleanup = () => { target.removeEventListener(ev, ok); target.removeEventListener("error", bad); };
    target.addEventListener(ev, ok);
    target.addEventListener("error", bad);
  });
}

function mimeType() {
  for (const t of ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"])
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

export const videoEditSupported = () => typeof MediaRecorder !== "undefined" && !!mimeType()
  && !!HTMLCanvasElement.prototype.captureStream;

// an AudioContext made during the user's tap (iPhone allows sound only then)
export function audioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  ctx.resume?.();
  return ctx;
}

export async function editVideo(file, { longSide, processFrame, onProgress, audio }) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  Object.assign(video, { muted: true, playsInline: true, preload: "auto", src: url });
  video.setAttribute("playsinline", "");
  await once(video, "loadeddata");
  const duration = Math.min(video.duration || 0, MAX_SECONDS);
  if (!(duration > 0.2)) throw new Error("empty video");
  const fps = Math.min(15, Math.max(6, Math.floor(MAX_FRAMES / duration)));
  const k = Math.min(1, longSide / Math.max(video.videoWidth, video.videoHeight));
  const W = Math.round((video.videoWidth * k) / 2) * 2, H = Math.round((video.videoHeight * k) / 2) * 2;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });

  // 1. frames
  const n = Math.max(1, Math.floor(duration * fps)), frames = [];
  for (let i = 0; i < n; i++) {
    video.currentTime = Math.min(duration - 0.01, (i + 0.5) / fps);
    await once(video, "seeked");
    g.drawImage(video, 0, 0, W, H);
    const out = await processFrame(g.getImageData(0, 0, W, H), i);
    g.putImageData(out, 0, 0);
    frames.push(await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9)));
    onProgress?.("frames", (i + 1) / n);
  }

  // 2. sound
  let buffer = null;
  if (audio) {
    try {
      buffer = await audio.decodeAudioData(await file.arrayBuffer());
    } catch { buffer = null; } // no sound track, or a codec the browser cannot decode
  }

  // 3. assembly in real time
  const stream = c.captureStream(30);
  let src = null;
  if (buffer) {
    const dest = audio.createMediaStreamDestination();
    src = audio.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
  }
  const type = mimeType();
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  const bitmaps = new Map(); // a few frames decoded ahead
  const bitmap = (i) => {
    if (!bitmaps.has(i)) bitmaps.set(i, createImageBitmap(frames[i]));
    return bitmaps.get(i);
  };
  g.drawImage(await bitmap(0), 0, 0);
  for (let i = 1; i < Math.min(4, n); i++) bitmap(i);
  rec.start(250);
  const t0 = buffer ? audio.currentTime : performance.now() / 1000;
  src?.start();
  let shown = 0;
  await new Promise((resolve) => {
    const tick = async () => {
      const t = (buffer ? audio.currentTime : performance.now() / 1000) - t0;
      const i = Math.min(n - 1, Math.floor(t * fps));
      if (i !== shown) {
        const bmp = await bitmap(i);
        g.drawImage(bmp, 0, 0);
        for (const j of [...bitmaps.keys()]) if (j < i) { (await bitmaps.get(j)).close?.(); bitmaps.delete(j); }
        for (let j = i + 1; j < Math.min(n, i + 4); j++) bitmap(j);
        shown = i;
      }
      onProgress?.("record", Math.min(1, t / duration));
      if (t >= duration) return resolve();
      setTimeout(tick, 1000 / 60);
    };
    tick();
  });
  src?.stop();
  rec.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  URL.revokeObjectURL(url);
  const ext = type.includes("mp4") ? "mp4" : "webm";
  const name = (file.name || "video").replace(/\.[^.]+$/, "");
  return { file: new File(chunks, `${name}_kirson.${ext}`, { type: type.split(";")[0] }), fps, frames: n, sound: !!buffer, cut: (video.duration || 0) > MAX_SECONDS };
}
