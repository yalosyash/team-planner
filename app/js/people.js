/* ============================================================
   people.js — окно сотрудников
   ============================================================ */
/* --- сотрудники --- */
function openPeople() {
  renderPeople();
  openModal("#mPeople");
}
function renderPeople() {
  const box = $("#plist");
  if (!state.people.length) {
    box.innerHTML = `<div class="hint">Пока нет сотрудников.</div>`;
    return;
  }
  box.innerHTML = state.people
    .map(
      (p) => `<div class="prow" data-id="${p.id}">
  <input type="color" value="${p.color}" data-c>
  <input type="text" value="${esc(p.name)}" data-n placeholder="Имя">
  <button class="ghost" data-x title="Удалить">✕</button>
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
    row.querySelector("[data-c]").addEventListener("input", (e) => {
      const p = state.people.find((x) => x.id === id);
      p.color = e.target.value;
      save();
      render();
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
  });
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
  if (e.target.closest("[data-close]")) render();
});
