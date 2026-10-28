/* ============================================================
   people.js — окно сотрудников
   ============================================================ */
/* --- сотрудники --- */
function openPeople() {
  renderPeople();
  openModal("#mPeople");
}
function renderPeople() {
  closePalette();
  const box = $("#plist");
  if (!state.people.length) {
    box.innerHTML = `<div class="hint">Пока нет сотрудников.</div>`;
    return;
  }
  box.innerHTML = state.people
    .map(
      (p) => `<div class="prow" data-id="${p.id}">
  <span class="phandle" draggable="true" title="Перетащите, чтобы изменить порядок">⋮⋮</span>
  <input type="text" value="${esc(p.name)}" data-n placeholder="Имя">
  <button class="pcolor" data-c-open title="Цвет столбца">
    <span class="pdot" style="background:${esc(p.color)}"></span>
  </button>
  <button class="pdel" data-x title="Удалить сотрудника" aria-label="Удалить сотрудника">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
  </button>
</div>`,
    )
    .join("");
  box.querySelectorAll(".prow").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector("[data-n]").addEventListener("input", (e) => {
      const p = state.people.find((x) => x.id === id);
      p.name = e.target.value;
      save();
      renderTabs(); // шапка обновится при закрытии
    });
    row.querySelector("[data-c-open]").addEventListener("click", () => {
      openPalette(row, id);
    });
    row.querySelector("[data-x]").addEventListener("click", () => {
      const p = state.people.find((x) => x.id === id);
      const cnt = state.tasks.filter((t) => t.personId === id).length;
      if (
        cnt &&
        !confirm(
          `У ${p.name} есть ${cnt} задач(и). Удалить сотрудника и его задачи?`,
        )
      )
        return;
      state.people = state.people.filter((x) => x.id !== id);
      state.tasks = state.tasks.filter((t) => t.personId !== id);
      save();
      renderPeople();
      render();
    });

    /* перетаскивание строк: ручка слева, как в списках файлов */
    row.addEventListener("dragstart", (e) => {
      dragPersonId = id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      dragPersonId = null;
      row.classList.remove("dragging");
      box
        .querySelectorAll(".prow")
        .forEach((r) => r.classList.remove("over-row", "under-row"));
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!dragPersonId || dragPersonId === id) return;
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      row.classList.toggle("over-row", after);
      row.classList.toggle("under-row", !after);
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("over-row", "under-row");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!dragPersonId || dragPersonId === id) return;
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      movePerson(dragPersonId, id, after);
    });
  });
}

let dragPersonId = null;

/* переставить сотрудника: from перед/после to */
function movePerson(fromId, toId, after) {
  const from = state.people.findIndex((p) => p.id === fromId);
  if (from < 0) return;
  const moving = state.people.splice(from, 1)[0];
  let to = state.people.findIndex((p) => p.id === toId);
  if (to < 0) {
    state.people.splice(from, 0, moving);
    return;
  }
  if (after) to += 1;
  state.people.splice(to, 0, moving);
  dragPersonId = null;
  save();
  renderPeople();
  render();
}

/* выбор цвета: маленький поповер рядом с кнопкой цвета */
let paletteCleanup = null;

function closePalette() {
  if (!paletteCleanup) return false;
  paletteCleanup();
  paletteCleanup = null;
  return true;
}

function openPalette(row, id) {
  const p = state.people.find((x) => x.id === id);
  if (!p) return;
  const btn = row.querySelector("[data-c-open]");
  // повторный клик по той же кнопке — закрыть
  if (paletteCleanup && btn.classList.contains("pal-open")) {
    closePalette();
    return;
  }
  closePalette();

  const pop = document.createElement("div");
  pop.className = "palgrid";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Цвет столбца");
  // если у сотрудника цвет не из палитры (старые данные) — покажем его первым
  const colors = PALETTE.includes(p.color) ? PALETTE : [p.color, ...PALETTE];
  pop.innerHTML = colors
    .map(
      (c) =>
        `<button type="button" class="sw${c === p.color ? " cur" : ""}" data-pal="${esc(c)}"
      style="background-color:${esc(c)}" title="${esc(c)}"
      aria-label="Цвет ${esc(c)}"${c === p.color ? ' aria-pressed="true"' : ""}></button>`,
    )
    .join("");
  document.body.appendChild(pop);
  btn.classList.add("pal-open");
  placePalette(pop, btn);

  const onOutside = (ev) => {
    const t = ev.target;
    if (
      t instanceof Element &&
      (pop.contains(t) || t.closest("[data-c-open]") === btn)
    )
      return;
    closePalette();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePalette();
    }
  };
  const onReflow = () => placePalette(pop, btn);

  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pal]");
    if (!b) return;
    p.color = b.dataset.pal;
    save();
    btn.innerHTML = `<span class="pdot" style="background:${esc(p.color)}"></span>`;
    closePalette();
    render();
  });

  paletteCleanup = () => {
    pop.remove();
    btn.classList.remove("pal-open");
    document.removeEventListener("mousedown", onOutside);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onReflow);
    window.removeEventListener("scroll", onReflow, true);
  };

  // обработчики вешаем после текущего клика, иначе он сразу закроет поповер
  setTimeout(() => {
    if (!pop.isConnected) return;
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
  }, 0);
}

/* ставим поповер рядом с кнопкой, не вылезая за окно */
function placePalette(pop, btn) {
  const b = btn.getBoundingClientRect();
  pop.style.visibility = "hidden";
  pop.style.left = "0px";
  pop.style.top = "0px";
  const size = pop.getBoundingClientRect();
  let left = b.right - size.width;
  left = Math.max(8, Math.min(left, window.innerWidth - size.width - 8));
  let top = b.bottom + 6;
  if (top + size.height > window.innerHeight - 8)
    top = Math.max(8, b.top - size.height - 6);
  pop.style.left = Math.round(left) + "px";
  pop.style.top = Math.round(top) + "px";
  pop.style.visibility = "";
}
$("#pAdd").addEventListener("click", () => {
  const color = PALETTE[state.people.length % PALETTE.length];
  const p = { id: uid(), name: "Новый сотрудник", color };
  state.people.push(p);
  save();
  renderPeople();
  render();
  setTimeout(() => {
    const inp = document.querySelector(`.prow[data-id="${p.id}"] [data-n]`);
    if (inp) {
      inp.focus();
      inp.select();
    }
  }, 30);
});
$("#mPeople").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) {
    closePalette();
    render();
  }
});
