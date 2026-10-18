// «Сравнить версии»: up to four versions of the photo side by side (the desktop's
// app/compare_dialog.py). The thumbnails on top choose which ones; a tap on a card shows it large;
// «Вернуться к этой» makes it the current edit (one undo step).
//   openCompare({items: [{name, state, thumb}], render: (state) => Promise<ImageData>, onPick(item)})
const MAX = 4;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function openCompare({ items, render, onPick }) {
  const root = el("div", "compare");
  const head = el("div", "compare-head glass");
  const title = el("b", "", "Сравнение версий");
  const close = el("button", "icon compare-close");
  close.setAttribute("aria-label", "Закрыть");
  close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  head.append(title, close);
  const picks = el("div", "compare-picks");
  const grid = el("div", "compare-grid");
  root.append(head, picks, grid);
  document.body.appendChild(root);

  const cache = new Map(); // state -> ImageData
  let chosen = items.slice(0, MAX); // «Сейчас» first, then the newest versions
  let queue = Promise.resolve();
  const shut = () => root.remove();
  close.onclick = shut;

  function renderPicks() {
    picks.replaceChildren();
    for (const it of items) {
      const b = el("button", "compare-pick" + (chosen.includes(it) ? " on" : ""));
      if (it.thumb) {
        const img = el("img");
        img.src = it.thumb;
        img.alt = "";
        b.appendChild(img);
      }
      b.appendChild(el("span", "", it.name));
      b.onclick = () => {
        if (chosen.includes(it)) { if (chosen.length > 1) chosen = chosen.filter((x) => x !== it); }
        else chosen = [...chosen, it].slice(-MAX);
        renderPicks();
        renderGrid();
      };
      picks.appendChild(b);
    }
  }

  function draw(canvas, image) {
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d").putImageData(image, 0, 0);
    canvas.classList.remove("loading");
  }

  function renderGrid() {
    grid.replaceChildren();
    grid.dataset.n = String(chosen.length);
    for (const it of chosen) {
      const card = el("div", "compare-card glass");
      const c = el("canvas", "loading");
      card.append(c, el("span", "compare-name", it.name));
      if (!it.current) {
        const back = el("button", "compare-back", "Вернуться к этой");
        back.onclick = (e) => { e.stopPropagation(); onPick(it); shut(); };
        card.appendChild(back);
      }
      card.onclick = () => card.classList.toggle("big"); // a tap: this one large
      grid.appendChild(card);
      if (cache.has(it.state)) draw(c, cache.get(it.state));
      else queue = queue.then(async () => {
        if (!root.isConnected) return;
        const image = cache.get(it.state) || (await render(it.state));
        cache.set(it.state, image);
        draw(c, image);
      }).catch((err) => console.error(err));
    }
  }

  renderPicks();
  renderGrid();
  return shut;
}
