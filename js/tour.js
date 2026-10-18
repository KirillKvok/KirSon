// In-app guide: a spotlight on the real control with a short card ("Далее" / "Пропустить").
// Steps: {target: CSS selector or null (centred card), title, text, gesture: "pinch" | "tap2" | "hold" | null}.
// Seen tours are remembered in localStorage; the "?" button replays them.

const SEEN = "kirson-tour-";

export function seen(name) {
  try {
    return localStorage.getItem(SEEN + name) === "1";
  } catch {
    return false;
  }
}

function remember(name) {
  try {
    localStorage.setItem(SEEN + name, "1");
  } catch { /* private mode: the tour simply shows again next time */ }
}

const GESTURES = {
  pinch: `<div class="g g-pinch"><i></i><i></i></div>`,
  tap2: `<div class="g g-tap2"><i></i></div>`,
  hold: `<div class="g g-hold"><i></i></div>`,
  paint: `<div class="g g-paint"><i></i></div>`,
};

let active = null;

export function runTour(name, steps, { onDone } = {}) {
  if (active) active.close();
  const root = document.createElement("div");
  root.className = "tour";
  root.innerHTML = `<div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite">
    <div class="tour-gesture"></div><h3></h3><p></p>
    <div class="tour-row"><span class="tour-count"></span><button class="tour-skip">Пропустить</button>
    <button class="tour-next primary">Далее</button></div></div>`;
  document.body.appendChild(root);
  const spot = root.querySelector(".tour-spot"), card = root.querySelector(".tour-card");
  let k = 0;

  const place = () => {
    const st = steps[k];
    const el = st.target && document.querySelector(st.target);
    const visible = el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
    root.querySelector("h3").textContent = st.title;
    root.querySelector("p").textContent = st.text;
    root.querySelector(".tour-gesture").innerHTML = GESTURES[st.gesture] || "";
    root.querySelector(".tour-count").textContent = `${k + 1} / ${steps.length}`;
    root.querySelector(".tour-next").textContent = k === steps.length - 1 ? "Понятно" : "Далее";
    const vw = window.innerWidth, vh = window.innerHeight;
    if (visible) {
      el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      const r = el.getBoundingClientRect(), pad = 6;
      Object.assign(spot.style, { display: "block", left: `${r.left - pad}px`, top: `${r.top - pad}px`,
        width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
      const cw = Math.min(340, vw - 24);
      card.style.width = `${cw}px`;
      card.style.left = `${Math.min(vw - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2))}px`;
      const below = r.bottom + 14, ch = card.offsetHeight || 180;
      card.style.top = below + ch < vh - 10 ? `${below}px` : `${Math.max(10, r.top - ch - 14)}px`;
    } else { // no target (or not on screen): a centred card over a dimmed screen
      Object.assign(spot.style, { display: "block", left: `${vw / 2}px`, top: `${vh / 2}px`, width: "0px", height: "0px" });
      const cw = Math.min(340, vw - 24);
      Object.assign(card.style, { width: `${cw}px`, left: `${(vw - cw) / 2}px`, top: `${Math.max(20, vh / 2 - 120)}px` });
    }
  };

  const close = (done) => {
    window.removeEventListener("resize", place);
    root.remove();
    active = null;
    remember(name);
    if (done && onDone) onDone();
  };
  root.querySelector(".tour-skip").onclick = () => close(false);
  root.querySelector(".tour-next").onclick = () => {
    if (++k >= steps.length) close(true);
    else place();
  };
  window.addEventListener("resize", place);
  active = { close: () => close(false) };
  requestAnimationFrame(place);
}

// --- the KirSon tours ---------------------------------------------------------------------------
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export function welcomeSteps() {
  const steps = [
    { target: "#welcome", title: "Это KirSon", text: "Естественная ретушь лица и фигуры. Фото обрабатываются прямо на телефоне и никуда не отправляются." },
    { target: "#btn-open-big", title: "Начните с фото", text: "Нажмите «Открыть фото» и выберите снимок из галереи — или «Снять селфи», чтобы сразу открыть камеру. Первый раз загрузка нейросетей займёт немного времени." },
  ];
  if (ios() && !standalone())
    steps.push({ target: null, title: "Установите на экран «Домой»",
      text: "В Safari нажмите «Поделиться» (квадрат со стрелкой) → «На экран „Домой“». KirSon откроется как обычное приложение и будет работать без интернета." });
  steps.push({ target: "#btn-help", title: "Подсказки всегда рядом", text: "Кнопка «?» снова покажет это обучение." });
  return steps;
}

export function editorSteps() {
  return [
    { target: "#tabs", title: "Разделы", text: "Образы, лицо, форма, фигура, макияж, волосы, фон, объект, кисти, цвет, фильтры, кадр. Листайте ряд пальцем." },
    { target: "#tools", title: "Инструменты раздела", text: "Выберите инструмент — его сила настраивается ползунком выше. Точка на кнопке значит, что инструмент уже изменён." },
    { target: "#slider-row", title: "Один ползунок", text: "Двигайте ползунок. Нажмите на число справа, чтобы вернуть значение по умолчанию." },
    { target: ".tool.accent", title: "✦ Авто", text: "В разделе «Образы» кнопка «Авто» сама оценит кожу, блеск и свет и подберёт мягкие значения." },
    { target: "#view", title: "Увеличение", text: "Разведите два пальца, чтобы приблизить нужное место. Двойное касание — приблизить или вернуть фото целиком.", gesture: "pinch" },
    { target: "#btn-before", title: "Сравнить с оригиналом", text: "Удерживайте «До», чтобы увидеть фото без обработки.", gesture: "hold" },
    { target: null, title: "Кисти", text: "В разделе «Кисти» рисуйте пальцем: пластика, заплатка для прыщей и пятен, маски. Двумя пальцами в этом режиме — масштаб.", gesture: "paint" },
    { target: "#btn-undo", title: "Отмена", text: "Стрелки отменяют и возвращают шаги. Каждый мазок кисти — отдельный шаг." },
    { target: "#btn-save", title: "Сохранение", text: "«Сохранить» обработает фото целиком, затем нажмите «Сохранить в Фото» → «Сохранить изображение»." },
  ];
}
