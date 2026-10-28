/* ============================================================
   tabs.js — вкладки релизов
   ============================================================ */
/* ============ вкладки релизов ============ */
function renderTabs() {
  const el = $("#tabs");
  let h = "";
  state.releases.forEach((r) => {
    const active = r.id === state.activeId ? " active" : "";
    h += `<div class="tab${active}" data-rel="${r.id}">
    <span class="tnum">Релиз ${esc(r.number || "—")}</span>
    <span class="tdate">${fmt(r.start)} – ${fmt(r.end)}</span>
    <span class="edit" data-edit="${r.id}" title="Изменить">✎</span>
    <span class="x" data-del="${r.id}" title="Удалить">✕</span>
  </div>`;
  });
  h += `<div class="addtab" id="addRelease" title="Новый релиз">+ Релиз</div>`;
  el.innerHTML = h;

  el.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      if (e.target.dataset.del) {
        e.stopPropagation();
        deleteRelease(e.target.dataset.del);
        return;
      }
      if (e.target.dataset.edit) {
        e.stopPropagation();
        openRelease(e.target.dataset.edit);
        return;
      }
      state.activeId = tab.dataset.rel;
      save();
      render();
    });
  });
  $("#addRelease").addEventListener("click", () => openRelease(null));
}
