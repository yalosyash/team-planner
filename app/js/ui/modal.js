/* ============================================================
   ui/modal.js — общая механика модальных окон.
   ============================================================ */
import { $ } from "../core/dom.js";
import { closePalette } from "./palette.js";

export function openModal(selector) {
  $(selector).classList.add("open");
}

export function closeModal(selector) {
  $(selector).classList.remove("open");
  // если внутри был открыт поповер (палитра) — закрываем вместе с окном
  closePalette();
}

export function initModals() {
  document.querySelectorAll("[data-close]").forEach((button) =>
    button.addEventListener("click", (e) => {
      closeModal("#" + e.target.closest(".modal-back").id);
    }),
  );

  document.querySelectorAll(".modal-back").forEach((backdrop) =>
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target !== backdrop) return;
      // первый клик по фону закрывает только поповер (палитру), окно остаётся
      if (closePalette()) return;
      closeModal("#" + backdrop.id);
    }),
  );

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document
      .querySelectorAll(".modal-back.open")
      .forEach((modal) => closeModal("#" + modal.id));
  });
}
