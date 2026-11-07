import { initCalendar } from "../features/calendar.js";
/* ============================================================
   app/main.js — точка входа: собирает приложение и запускает его.

   Порядок важен: сначала подписываем части интерфейса на перерисовку,
   затем вешаем обработчики, затем загружаем данные и рисуем доску.
   ============================================================ */
import {
  initStorage,
  pendingLocal,
  replaceState,
  setPendingLocal,
  state,
  save,
} from "../core/storage.js";
import { onRender, render } from "../core/render.js";
import { initTheme, syncThemeFromState } from "../core/theme.js";
import { initKeepalive } from "../core/keepalive.js";
import { initModals } from "../ui/modal.js";
import { initTooltip } from "../ui/tooltip.js";
import { initDropdownHover } from "../ui/dropdown.js";
import { renderTeam } from "../ui/team.js";
import { renderTabs } from "../ui/tabs.js";
import { renderBoard } from "../ui/board.js";
import { initPeople, openPeople } from "../features/people.js";
import { initRelease } from "../features/release.js";
import { initTask, openTask } from "../features/task.js";
import { initDataIo } from "../features/data-io.js";
import { initUpdates } from "../features/updates.js";

/* части интерфейса перерисовываются в этом порядке */
onRender(renderTeam);
onRender(renderTabs);
onRender(renderBoard);

function bindTopbar() {
  document.querySelector("#btnPeople").addEventListener("click", openPeople);
  document
    .querySelector("#btnAddTask")
    .addEventListener("click", () => openTask(null));
}

/* выбрать активный релиз, если его ещё нет */
function ensureActiveRelease() {
  if (state.releases.length && !state.activeId)
    state.activeId = state.releases[0].id;
}

(async function start() {
  initTheme();
  initModals();
  initTooltip();
  initDropdownHover();
  bindTopbar();
  initPeople();
  initRelease();
  initTask();
  initDataIo();
  initUpdates();
  initKeepalive();

  let { legacy, localLegacy } = await initStorage();
  syncThemeFromState();
  ensureActiveRelease();
  initCalendar();
  render();

  // если в браузере есть данные, отличающиеся от файла — предложим выбрать
  if (pendingLocal) {
    const useLocal = confirm(
      "Найдены данные в браузере, отличающиеся от data.json.\n\n" +
        "OK — загрузить данные из браузера (они перезапишут файл)\n" +
        "Отмена — оставить данные из файла",
    );
    if (useLocal) {
      replaceState(pendingLocal);
      legacy = localLegacy;
      syncThemeFromState();
      ensureActiveRelease();
      save();
      render();
    }
    setPendingLocal(null);
  }

  // Только при запуске: импорт, демо и откат версии сюда не попадают.
  if (legacy && state.tasks.length && state.queueNotice !== "shown") {
    const notice = document.querySelector("#queueNotice");
    notice.hidden = false;
    notice.querySelector("button").addEventListener("click", () => {
      notice.hidden = true;
    });
    state.queueNotice = "shown";
    save();
  }
})();
