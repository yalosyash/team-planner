/* ============================================================
   modals.js — общая механика модальных окон
   ============================================================ */
/* ============ модалки ============ */
function openModal(sel) {
  $(sel).classList.add("open");
}
function closeModal(sel) {
  $(sel).classList.remove("open");
  // если внутри был открыт поповер (палитра) — закрываем вместе с окном
  if (typeof closePalette === "function") closePalette();
}
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", (e) => {
    closeModal("#" + e.target.closest(".modal-back").id);
  }),
);
document.querySelectorAll(".modal-back").forEach((mb) =>
  mb.addEventListener("mousedown", (e) => {
    if (e.target !== mb) return;
    // первый клик по фону закрывает только поповер (палитру), окно остаётся
    if (typeof closePalette === "function" && closePalette()) return;
    closeModal("#" + mb.id);
  }),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape")
    document
      .querySelectorAll(".modal-back.open")
      .forEach((m) => closeModal("#" + m.id));
});
