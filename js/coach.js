// «Снять селфи» with hints: the live front camera, MediaPipe follows the face ~5 times a second and
// the one most important hint is shown — light (dark, too bright, from one side, from behind), framing
// (too far / close, off centre), angle (camera below the face — the least flattering one, head tilt).
// «Отлично» when all is well. The shutter takes a frame at the camera's full resolution; «Камера
// телефона» switches to the phone's own camera app (the best quality: HDR, its own processing).
//   openCoach({tracker: () => Promise<FaceLandmarker VIDEO>, onShot(File), onNativeCamera()})
const TICK_MS = 200;
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const CHEEK_L = 50, CHEEK_R = 280; // cheek points (one on each side of the face)

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// mean luminance (0..1) of a small disc / of the samples given
function lumaAt(d, w, h, x, y, r) {
  let s = 0, n = 0;
  for (let yy = Math.max(0, y - r | 0); yy < Math.min(h, y + r); yy++)
    for (let xx = Math.max(0, x - r | 0); xx < Math.min(w, x + r); xx++) {
      const i = 4 * (yy * w + xx);
      s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n++;
    }
  return n ? s / n / 255 : 0;
}

// the hint for this frame: [text, ok]
export function judge(face, matrix, pixels, w, h) {
  if (!face) return ["Покажите лицо в кадре", false];
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const k of OVAL) { const p = face[k]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const fw = x1 - x0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const d = pixels.data;
  const L = lumaAt(d, w, h, cx * w, cy * h, fw * w * 0.18);
  const left = lumaAt(d, w, h, face[CHEEK_L].x * w, face[CHEEK_L].y * h, fw * w * 0.1);
  const right = lumaAt(d, w, h, face[CHEEK_R].x * w, face[CHEEK_R].y * h, fw * w * 0.1);
  // the background: the frame's top corners and sides away from the face
  const bg = (lumaAt(d, w, h, w * 0.08, h * 0.12, w * 0.07) + lumaAt(d, w, h, w * 0.92, h * 0.12, w * 0.07)) / 2;
  if (L < 0.22) return ["Темновато — повернитесь лицом к окну или лампе", false];
  if (bg - L > 0.28) return ["Свет сзади — встаньте лицом к окну", false];
  if (fw < 0.28) return ["Поднесите телефон чуть ближе", false];
  if (fw > 0.75) return ["Чуть дальше — лицо не помещается", false];
  if (Math.abs(cx - 0.5) > 0.16 || cy < 0.25 || cy > 0.68) return ["Поставьте лицо в центр кадра", false];
  if (matrix) { // the angle matters more for a flattering selfie than a little side light
    const m = matrix, pitch = (Math.asin(Math.max(-1, Math.min(1, m[9]))) * 180) / Math.PI;
    const roll = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    // checked on the test photos: chin up / camera below ≈ +23°, an ordinary selfie −12…−20°
    if (pitch > 8) return ["Камера ниже лица — поднимите телефон до уровня глаз", false];
    if (pitch < -42) return ["Камера слишком высоко — опустите чуть ниже", false];
    if (Math.abs(roll) > 14) return ["Выпрямите голову", false];
  }
  if (Math.abs(left - right) > 0.12 * Math.max(left, right, 0.2) + 0.04) return ["Свет с одной стороны — повернитесь к свету лицом", false];
  if (L > 0.9) return ["Слишком ярко — отойдите от прямого света", false];
  return ["Отлично — снимайте!", true];
}

export async function openCoach({ tracker, onShot, onNativeCamera }) {
  const root = el("div", "coach");
  const video = el("video", "coach-video");
  Object.assign(video, { muted: true, playsInline: true, autoplay: true });
  video.setAttribute("playsinline", "");
  const frame = el("div", "coach-frame");
  const hint = el("div", "coach-hint glass", "Включаю камеру…");
  const bar = el("div", "coach-bar");
  const close = el("button", "coach-btn glass", "Закрыть");
  const shutter = el("button", "coach-shutter");
  shutter.setAttribute("aria-label", "Снять");
  const timerBtn = el("button", "coach-btn glass", "Таймер 3 с");
  const native = el("button", "coach-native", "Камера телефона — максимальное качество");
  bar.append(close, shutter, timerBtn);
  root.append(video, frame, hint, bar, native);
  document.body.appendChild(root);

  let stream = null, alive = true, timer = false, last = 0;
  const shut = () => {
    alive = false;
    stream?.getTracks().forEach((t) => t.stop());
    root.remove();
  };
  close.onclick = shut;
  native.onclick = () => { shut(); onNativeCamera(); };
  timerBtn.onclick = () => { timer = !timer; timerBtn.classList.toggle("on", timer); };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
  } catch {
    shut();
    onNativeCamera(); // no access to the camera here: the phone's camera app instead
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  const lm = await tracker();
  // the oval follows the face: video -> screen (object-fit: cover, mirrored preview)
  const placeFrame = (face) => {
    if (!face) { frame.removeAttribute("style"); return; }
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const k of OVAL) { const q = face[k]; x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const W = root.clientWidth, H = root.clientHeight, vw = video.videoWidth, vh = video.videoHeight;
    const k = Math.max(W / vw, H / vh), dw = vw * k, dh = vh * k, ox = (W - dw) / 2, oy = (H - dh) / 2;
    const cx = W - (ox + ((x0 + x1) / 2) * dw), cy = oy + ((y0 + y1) / 2) * dh;
    const fw = (x1 - x0) * dw * 1.25, fh = (y1 - y0) * dh * 1.2;
    Object.assign(frame.style, { left: `${cx}px`, top: `${cy}px`, width: `${fw}px`, height: `${fh}px`, aspectRatio: "auto" });
  };
  const small = document.createElement("canvas"), sg = small.getContext("2d", { willReadFrequently: true });

  const loop = () => {
    if (!alive) return;
    const now = performance.now();
    if (now - last >= TICK_MS && video.readyState >= 2) {
      last = now;
      const k = 320 / Math.max(video.videoWidth, video.videoHeight);
      small.width = Math.round(video.videoWidth * k);
      small.height = Math.round(video.videoHeight * k);
      sg.drawImage(video, 0, 0, small.width, small.height);
      let face = null, matrix = null;
      try {
        const r = lm.detectForVideo(video, now);
        face = r.faceLandmarks?.[0] || null;
        matrix = r.facialTransformationMatrixes?.[0]?.data || null;
      } catch { /* a frame the model could not take */ }
      const [text, ok] = judge(face, matrix, sg.getImageData(0, 0, small.width, small.height), small.width, small.height);
      hint.textContent = text;
      root.classList.toggle("ok", ok);
      placeFrame(face);
    }
    setTimeout(loop, TICK_MS / 2);
  };
  loop();

  shutter.onclick = async () => {
    if (timer) {
      for (let s = 3; s > 0; s--) {
        hint.textContent = String(s);
        await new Promise((r) => setTimeout(r, 1000));
        if (!alive) return;
      }
    }
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0); // not mirrored: the photo as others see you
    root.classList.add("flash");
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
    shut();
    const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
    onShot(new File([blob], `selfie_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}.jpg`,
      { type: "image/jpeg" }));
  };
}
