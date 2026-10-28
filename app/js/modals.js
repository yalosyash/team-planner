/* ============================================================
   modals.js — общая механика модальных окон
   ============================================================ */
/* ============ модалки ============ */
function openModal(sel) {
  $(sel).classList.add("open");
}
function closeModal(sel) {
  $(sel).classList.remove("open");
}
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", (e) => {
    e.target.closest(".modal-back").classList.remove("open");
  }),
);
document.querySelectorAll(".modal-back").forEach((mb) =>
  mb.addEventListener("mousedown", (e) => {
    if (e.target === mb) mb.classList.remove("open");
  }),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape")
    document
      .querySelectorAll(".modal-back.open")
      .forEach((m) => m.classList.remove("open"));
});
