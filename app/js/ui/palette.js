/* ============================================================
   ui/palette.js — маленький поповер выбора цвета сотрудника.
   ============================================================ */
import { esc } from "../core/dom.js";
import { PALETTE } from "../core/util.js";
import { state, save } from "../core/storage.js";
import { render } from "../core/render.js";

let cleanup = null;

/* закрыть поповер, если он открыт; true — значит, что-то закрыли */
export function closePalette() {
  if (!cleanup) return false;
  cleanup();
  cleanup = null;
  return true;
}

/* поставить поповер рядом с кнопкой, не вылезая за окно */
function placePalette(pop, button) {
  const box = button.getBoundingClientRect();
  pop.style.visibility = "hidden";
  pop.style.left = "0px";
  pop.style.top = "0px";
  const size = pop.getBoundingClientRect();
  let left = box.right - size.width;
  left = Math.max(8, Math.min(left, window.innerWidth - size.width - 8));
  let top = box.bottom + 6;
  if (top + size.height > window.innerHeight - 8)
    top = Math.max(8, box.top - size.height - 6);
  pop.style.left = Math.round(left) + "px";
  pop.style.top = Math.round(top) + "px";
  pop.style.visibility = "";
}

/* row — строка сотрудника, id — сотрудник, onApplied — обновить доску */
export function openPalette(row, id) {
  const person = state.people.find((x) => x.id === id);
  if (!person) return;
  const button = row.querySelector("[data-c-open]");
  // повторный клик по той же кнопке — закрыть
  if (cleanup && button.classList.contains("pal-open")) {
    closePalette();
    return;
  }
  closePalette();

  const pop = document.createElement("div");
  pop.className = "palgrid";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Цвет столбца");
  // если у сотрудника цвет не из палитры (старые данные) — покажем его первым
  const colors = PALETTE.includes(person.color)
    ? PALETTE
    : [person.color, ...PALETTE];
  pop.innerHTML = colors
    .map(
      (color) =>
        `<button type="button" class="sw${color === person.color ? " cur" : ""}" data-pal="${esc(color)}"
      style="background-color:${esc(color)}" title="${esc(color)}"
      aria-label="Цвет ${esc(color)}"${color === person.color ? ' aria-pressed="true"' : ""}></button>`,
    )
    .join("");
  document.body.appendChild(pop);
  button.classList.add("pal-open");
  placePalette(pop, button);

  const onOutside = (event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      (pop.contains(target) || target.closest("[data-c-open]") === button)
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
  const onReflow = () => placePalette(pop, button);

  pop.addEventListener("click", (e) => {
    const swatch = e.target.closest("[data-pal]");
    if (!swatch) return;
    person.color = swatch.dataset.pal;
    save();
    button.innerHTML = `<span class="pdot" style="background:${esc(person.color)}"></span>`;
    closePalette();
    render();
  });

  cleanup = () => {
    pop.remove();
    button.classList.remove("pal-open");
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
