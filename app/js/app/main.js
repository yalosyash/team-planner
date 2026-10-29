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
import { renderTeam } from "../ui/team.js";
import { renderTabs } from "../ui/tabs.js";
import { renderBoard } from "../ui/board.js";
import { initPeople, openPeople } from "../features/people.js";
import { initRelease } from "../features/release.js";
import { initTask, openTask } from "../features/task.js";
import { initDataIo } from "../features/data-io.js";

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
  bindTopbar();
  initPeople();
  initRelease();
  initTask();
  initDataIo();
  initKeepalive();

  await initStorage();
  syncThemeFromState();
  ensureActiveRelease();
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
      syncThemeFromState();
      ensureActiveRelease();
      save();
      render();
    }
    setPendingLocal(null);
  }
})();
