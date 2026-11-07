/* ============================================================
   features/data-io.js — экспорт, импорт и версии данных.
   ============================================================ */
import { $, toast } from "../core/dom.js";
import {
  initReleaseTransfer,
  BACKUP_KEY,
  downloadJson,
} from "./release-transfer.js";
import { exportFilename } from "../core/export-filename.js";
import {
  backend,
  migrateTasks,
  replaceState,
  save,
  state,
  setServerRevision,
} from "../core/storage.js";
import { render } from "../core/render.js";
import { syncThemeFromState } from "../core/theme.js";
import { closeModal, openModal } from "../ui/modal.js";

function exportJson() {
  downloadJson(state, exportFilename(state));
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
    const raw = localStorage.getItem(BACKUP_KEY);
    if (raw) {
      hint.textContent =
        "Резервная копия перед последним импортом релиза (все данные).";
      const restore = document.createElement("button");
      restore.textContent = "Восстановить";
      restore.onclick = () => {
        if (
          !confirm(
            "Восстановить все данные из копии перед импортом? Текущие данные будут скачаны отдельным файлом.",
          )
        )
          return;
        try {
          const restored = migrateTasks(JSON.parse(raw));
          downloadJson(state, exportFilename(state, { purpose: "before-restore" }));
          replaceState(restored);
          syncThemeFromState();
          save();
          render();
          closeModal("#mBackups");
        } catch {
          alert("Не удалось прочитать резервную копию");
        }
      };
      list.append(restore);
      return;
    }
    hint.textContent =
      "Резервные копии доступны только при запуске через start.bat (сервер не найден).";
    return;
  }

  hint.textContent = "Загрузка…";
  try {
    const response = await fetch("/api/backups", { cache: "no-store" });
    const { backups } = await response.json();
    if (!backups.length) {
      hint.textContent =
        "Резервных копий пока нет. Они создаются при изменениях и при каждом запуске.";
      return;
    }

    hint.textContent =
      "Выберите копию для восстановления. Текущие данные будут сохранены.";
    list.innerHTML = backups
      .map(
        (backup) => `
    <div class="bkrow">
      <span class="bk-date">${backup.at.split(" ")[0]}</span>
      <span class="bk-time">${backup.at.split(" ")[1] || "—"}</span>
      <span class="bk-meta">Релизов: ${Number.isInteger(backup.releases) ? backup.releases : "—"}</span>
      <span class="bk-meta">Задач: ${Number.isInteger(backup.tasks) ? backup.tasks : "—"}</span>
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
    hint.textContent = "Не удалось получить список резервных копий.";
  }
}

async function restoreBackup(name) {
  if (
    !confirm(
      "Восстановить данные из этой резервной копии? Текущее состояние тоже будет сохранено в резервных копиях.",
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

    setServerRevision(result.revision);
    replaceState(migrateTasks(result.data));
    if (state.releases.length && !state.activeId)
      state.activeId = state.releases[0].id;
    syncThemeFromState(); // версия хранит и тему
    render();
    toast(
      `Восстановлено: релизов — ${state.releases.length}, задач — ${state.tasks.length}`,
    );
    closeModal("#mBackups");
  } catch (e) {
    if (e.message === "not found") {
      await openBackups();
      $("#bkHint").textContent =
        "Этой копии уже нет: старые копии удаляются при создании новых. Список обновлён — выберите другую копию.";
    } else {
      alert("Не удалось восстановить: " + e.message);
    }
  }
}

export function initDataIo() {
  initReleaseTransfer();
  initIoMenus();
  $("#btnExportAll").addEventListener("click", exportJson);
  $("#btnImportAll").addEventListener("click", () => $("#fileImport").click());
  $("#fileImport").addEventListener("change", importJson);
  $("#btnBackups").addEventListener("click", openBackups);
}

function initIoMenus() {
  const dropdowns = [...document.querySelectorAll(".io-dropdown")];
  function closeAll() {
    dropdowns.forEach((dropdown) => {
      dropdown.querySelector(".io-menu").hidden = true;
      dropdown
        .querySelector("[aria-expanded]")
        .setAttribute("aria-expanded", "false");
    });
  }
  dropdowns.forEach((dropdown) => {
    const trigger = dropdown.querySelector("[aria-expanded]");
    const menu = dropdown.querySelector(".io-menu");
    const items = [...menu.querySelectorAll("button")];
    function placeMenu() {
      menu.style.transform = "";
      const bounds = menu.getBoundingClientRect();
      const shift =
        bounds.left < 8
          ? 8 - bounds.left
          : bounds.right > window.innerWidth - 8
            ? window.innerWidth - 8 - bounds.right
            : 0;
      menu.style.transform = `translateX(${shift}px)`;
    }
    trigger.addEventListener("click", () => {
      const opening = menu.hidden;
      closeAll();
      menu.hidden = !opening;
      trigger.setAttribute("aria-expanded", String(opening));
      if (opening) placeMenu();
    });
    trigger.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      closeAll();
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      placeMenu();
      items[event.key === "ArrowDown" ? 0 : items.length - 1].focus();
    });
    menu.addEventListener("click", (event) => {
      if (event.target.closest("button")) closeAll();
    });
    menu.addEventListener("keydown", (event) => {
      const index = items.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        closeAll();
        trigger.focus();
      } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        items[
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
        ].focus();
      }
    });
    dropdown.addEventListener("focusout", (event) => {
      if (!dropdown.contains(event.relatedTarget)) closeAll();
    });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".io-dropdown")) closeAll();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
  window.addEventListener("resize", closeAll);
}
