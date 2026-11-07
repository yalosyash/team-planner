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
    <button type="button" class="ghost edit" data-edit="${release.id}" aria-label="Изменить релиз ${esc(release.number || "—")}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m7.5 2.5 2 2M2 10l.5-3L8 1.5a.7.7 0 0 1 1 0L10.5 3a.7.7 0 0 1 0 1L5 9.5Z"/></svg></button>
    <button type="button" class="ghost x" data-del="${release.id}" aria-label="Удалить релиз ${esc(release.number || "—")}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6"/></svg></button>
  </div>`;
      })
      .join("") +
    `<button type="button" class="ghost addtab" id="addRelease" aria-label="Добавить релиз"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2 6h8"/></svg></button>`;

  el.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      const { del, edit } =
        e.target.closest("[data-del], [data-edit]")?.dataset || {};
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
