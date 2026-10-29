/* ============================================================
   features/data-io.js — экспорт, импорт и версии данных.
   ============================================================ */
import { $, toast } from "../core/dom.js";
import { todayISO } from "../core/dates.js";
import {
  backend,
  migrateTasks,
  replaceState,
  save,
  state,
} from "../core/storage.js";
import { render } from "../core/render.js";
import { syncThemeFromState } from "../core/theme.js";
import { closeModal, openModal } from "../ui/modal.js";

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "team-planner-" + todayISO() + ".json";
  link.click();
  URL.revokeObjectURL(link.href);
  toast("Файл сохранён");
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.people || !data.releases || !data.tasks) throw new Error();
      replaceState(migrateTasks(data));
      if (!state.activeId && state.releases[0])
        state.activeId = state.releases[0].id;
      syncThemeFromState(); // тема из файла, если она там была
      save();
      render();
      toast("Данные загружены");
    } catch (e) {
      alert("Не удалось прочитать файл");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

/* --- версии (автобэкапы) --- */

async function openBackups() {
  openModal("#mBackups");
  const hint = $("#bkHint");
  const list = $("#bklist");
  list.innerHTML = "";

  if (backend !== "server") {
    hint.textContent =
      "Версии доступны только при запуске через start.bat (сервер не найден).";
    return;
  }

  hint.textContent = "Загрузка…";
  try {
    const response = await fetch("/api/backups", { cache: "no-store" });
    const { backups } = await response.json();
    if (!backups.length) {
      hint.textContent =
        "Версий пока нет. Они создаются при изменениях и при каждом запуске.";
      return;
    }

    hint.textContent =
      "Нажмите «Восстановить» — данные файла вернутся к выбранной версии.";
    list.innerHTML = backups
      .map(
        (backup, index) => `
    <div class="bkrow">
      <span class="bk-when">${backup.at}</span>
      <span class="bk-meta">${index === 0 ? "самый свежий снимок" : "снимок"} · ${(backup.size / 1024).toFixed(1)} КБ</span>
      <button data-restore="${backup.name}">Восстановить</button>
    </div>`,
      )
      .join("");

    list.querySelectorAll("[data-restore]").forEach((button) => {
      button.addEventListener("click", () =>
        restoreBackup(button.dataset.restore),
      );
    });
  } catch (e) {
    hint.textContent = "Не удалось получить список версий.";
  }
}

async function restoreBackup(name) {
  if (
    !confirm(
      "Восстановить данные из этой версии? Текущее состояние тоже будет сохранено в backups.",
    )
  )
    return;

  try {
    const response = await fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error);

    replaceState(migrateTasks(result.data));
    if (state.releases.length && !state.activeId)
      state.activeId = state.releases[0].id;
    syncThemeFromState(); // версия хранит и тему
    render();
    toast("Данные восстановлены");
    closeModal("#mBackups");
  } catch (e) {
    alert("Не удалось восстановить: " + e.message);
  }
}

export function initDataIo() {
  $("#btnExport").addEventListener("click", exportJson);
  $("#btnImport").addEventListener("click", () => $("#fileImport").click());
  $("#fileImport").addEventListener("change", importJson);
  $("#btnBackups").addEventListener("click", openBackups);
}
