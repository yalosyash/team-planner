/* ============================================================
   main.js — запуск приложения и верхняя панель
   ============================================================ */
/* кнопки верхней панели */
$("#btnPeople").addEventListener("click", openPeople);
$("#btnAddTask").addEventListener("click", () => openTask(null));

/* ============ старт ============ */
(async function () {
  await initStorage();
  if (state.releases.length && !state.activeId)
    state.activeId = state.releases[0].id;
  render();

  // если в браузере есть данные, отличающиеся от файла — предложим выбрать
  if (pendingLocal) {
    const useLocal = confirm(
      "Найдены данные в браузере, отличающиеся от data.json.\n\n" +
        "OK — загрузить данные из браузера (они перезапишут файл)\n" +
        "Отмена — оставить данные из файла",
    );
    if (useLocal) {
      state = pendingLocal;
      if (state.releases.length && !state.activeId)
        state.activeId = state.releases[0].id;
      persist();
      render();
    }
    pendingLocal = null;
  }
})();
