/* ============================================================
   ui/tabs.js — вкладки релизов над доской.
   ============================================================ */
import { $, esc } from "../core/dom.js";
import { fmt } from "../core/dates.js";
import { state, save } from "../core/storage.js";
import { render } from "../core/render.js";
import { openRelease, deleteRelease } from "../features/release.js";

export function renderTabs() {
  const el = $("#tabs");
  el.innerHTML =
    state.releases
      .map((release) => {
        const active = release.id === state.activeId ? " active" : "";
        return `<div class="tab${active}" data-rel="${release.id}">
    <span class="tnum">Релиз ${esc(release.number || "—")}</span>
    <span class="tdate">${fmt(release.start)} – ${fmt(release.end)}</span>
    <span class="edit" data-edit="${release.id}" title="Изменить">✎</span>
    <span class="x" data-del="${release.id}" title="Удалить">✕</span>
  </div>`;
      })
      .join("") +
    `<div class="addtab" id="addRelease" title="Новый релиз">+ Релиз</div>`;

  el.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      const { del, edit } = e.target.dataset;
      if (del) {
        e.stopPropagation();
        deleteRelease(del);
        return;
      }
      if (edit) {
        e.stopPropagation();
        openRelease(edit);
        return;
      }
      state.activeId = tab.dataset.rel;
      save();
      render();
    });
  });

  $("#addRelease").addEventListener("click", () => openRelease(null));
}
