/* ============================================================
   features/people.js — окно сотрудников: список, цвета, порядок.
   ============================================================ */
import { $, esc } from "../core/dom.js";
import { PALETTE, uid } from "../core/util.js";
import { state, save } from "../core/storage.js";
import { render } from "../core/render.js";
import { openModal } from "../ui/modal.js";
import { closePalette, openPalette } from "../ui/palette.js";
import { renderTabs } from "../ui/tabs.js";

let dragPersonId = null;

export function openPeople() {
  renderPeople();
  openModal("#mPeople");
}

export function renderPeople() {
  closePalette();
  const box = $("#plist");
  if (!state.people.length) {
    box.innerHTML = `<div class="hint">Пока нет сотрудников.</div>`;
    return;
  }

  box.innerHTML = state.people
    .map(
      (person) => `<div class="prow" data-id="${person.id}">
  <span class="phandle" draggable="true" title="Перетащите, чтобы изменить порядок">⋮⋮</span>
  <input type="text" value="${esc(person.name)}" data-n placeholder="Имя">
  <button class="pcolor" data-c-open title="Цвет столбца">
    <span class="pdot" style="background:${esc(person.color)}"></span>
  </button>
  <button class="pdel" data-x title="Удалить сотрудника" aria-label="Удалить сотрудника">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
  </button>
</div>`,
    )
    .join("");

  box.querySelectorAll(".prow").forEach((row) => bindRow(row, box));
}

function bindRow(row, box) {
  const id = row.dataset.id;
  const person = () => state.people.find((x) => x.id === id);

  row.querySelector("[data-n]").addEventListener("input", (e) => {
    person().name = e.target.value;
    save();
    renderTabs(); // шапка обновится при закрытии
  });

  row.querySelector("[data-c-open]").addEventListener("click", () => {
    openPalette(row, id);
  });

  row.querySelector("[data-x]").addEventListener("click", () => {
    const target = person();
    const count = state.tasks.filter((t) => t.personId === id).length;
    if (
      count &&
      !confirm(
        `У ${target.name} есть ${count} задач(и). Удалить сотрудника и его задачи?`,
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
    const after = isAfter(e, row);
    row.classList.toggle("over-row", after);
    row.classList.toggle("under-row", !after);
  });

  row.addEventListener("dragleave", () => {
    row.classList.remove("over-row", "under-row");
  });

  row.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!dragPersonId || dragPersonId === id) return;
    movePerson(dragPersonId, id, isAfter(e, row));
  });
}

/* курсор ниже середины строки — значит, вставим после неё */
function isAfter(event, row) {
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}

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

export function initPeople() {
  $("#pAdd").addEventListener("click", () => {
    const color = PALETTE[state.people.length % PALETTE.length];
    const person = { id: uid(), name: "Новый сотрудник", color };
    state.people.push(person);
    save();
    renderPeople();
    render();
    setTimeout(() => {
      const input = document.querySelector(
        `.prow[data-id="${person.id}"] [data-n]`,
      );
      if (input) {
        input.focus();
        input.select();
      }
    }, 30);
  });

  $("#mPeople").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) {
      closePalette();
      render();
    }
  });
}
