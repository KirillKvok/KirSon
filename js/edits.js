// «Мои правки»: every edit of this photo as a list — what was changed and how much — each with a switch
// (off: the step is skipped, its values kept; any later edit stays) and «×» (back to its defaults).
//   openEdits({rows: () => [{op, title, detail, on}], onToggle(op), onReset(op)})
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function openEdits({ rows, onToggle, onReset }) {
  document.querySelector(".edits")?.remove();
  const root = el("div", "edits glass");
  const head = el("div", "edits-head");
  const close = el("button", "icon edits-close");
  close.setAttribute("aria-label", "Закрыть");
  close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  head.append(el("b", "", "Мои правки"), close);
  const list = el("div", "edits-list");
  root.append(head, list);
  document.body.appendChild(root);
  close.onclick = () => root.remove();

  function render() {
    list.replaceChildren();
    const rs = rows();
    if (!rs.length) list.append(el("p", "edits-empty", "Правок пока нет — фото как было."));
    for (const r of rs) {
      const row = el("div", "edits-row" + (r.on ? "" : " off"));
      const text = el("div", "edits-text");
      text.append(el("b", "", r.title), el("span", "", r.detail));
      const sw = el("input");
      sw.type = "checkbox";
      sw.className = "edits-switch";
      sw.checked = r.on;
      sw.setAttribute("aria-label", r.on ? `Выключить: ${r.title}` : `Включить: ${r.title}`);
      sw.onchange = () => { onToggle(r.op); render(); };
      const x = el("button", "icon edits-reset", "×");
      x.setAttribute("aria-label", `Убрать: ${r.title}`);
      x.onclick = () => { onReset(r.op); render(); };
      row.append(text, sw, x);
      list.append(row);
    }
  }
  render();
  return { refresh: () => document.body.contains(root) && render(), close: () => root.remove() };
}
