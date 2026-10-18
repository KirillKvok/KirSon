// A preset shared as a link: {name, values} → JSON → deflate → base64url after «#preset=». The part
// after # never reaches a server: the preset goes from phone to phone only. A QR code of the same link
// (qrcode-generator by Kazuhiko Arase, MIT) for a friend's phone nearby.
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encodePreset(preset) {
  const raw = new TextEncoder().encode(JSON.stringify({ n: preset.name, v: preset.values }));
  if (typeof CompressionStream !== "undefined") {
    try { return "z" + b64url(await pipe(raw, new CompressionStream("deflate-raw"))); } catch { /* plain then */ }
  }
  return "j" + b64url(raw);
}

export async function decodePreset(code) {
  let bytes = unb64url(code.slice(1));
  if (code[0] === "z") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  const d = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof d.n !== "string" || typeof d.v !== "object" || !d.v) throw new Error("not a preset");
  return { name: d.n.slice(0, 40), values: d.v };
}

export async function presetLink(preset) {
  return `${location.origin}${location.pathname}#preset=${await encodePreset(preset)}`;
}

// the preset in the address the app was opened with (and the address cleaned of it)
export async function presetFromAddress() {
  const m = location.hash.match(/#preset=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  try { return await decodePreset(m[1]); } catch { return null; }
}

let qrLoaded = null;
function loadQr() {
  qrLoaded ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("../vendor/qrcode/qrcode.js", import.meta.url).href;
    s.onload = () => resolve(window.qrcode);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return qrLoaded;
}

// a sheet with the QR code, «Поделиться» (the phone's share menu) and «Скопировать ссылку»
export async function showShare(preset, toast) {
  const url = await presetLink(preset), qrcode = await loadQr();
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const root = document.createElement("div");
  root.className = "share-sheet";
  root.innerHTML = `<div class="share-card glass"><b></b><p>Наведите камеру другого телефона — пресет откроется в KirSon.</p>
    <div class="share-qr">${qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true })}</div>
    <div class="share-actions"><button class="primary" data-a="share">Поделиться</button>
    <button class="secondary" data-a="copy">Скопировать ссылку</button><button class="secondary" data-a="close">Закрыть</button></div></div>`;
  root.querySelector("b").textContent = `Пресет «${preset.name}»`;
  const close = () => root.remove();
  root.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (e.target === root || a === "close") return close();
    if (a === "share") {
      if (navigator.share) {
        try { await navigator.share({ title: `Пресет KirSon «${preset.name}»`, text: `Мой пресет для KirSon: «${preset.name}»`, url }); } catch { /* cancelled */ }
      } else a === "share" && copy();
    }
    if (a === "copy") copy();
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast("Ссылка скопирована", 1800); } catch { toast("Не удалось скопировать", 1800); }
  };
  document.body.appendChild(root);
}
