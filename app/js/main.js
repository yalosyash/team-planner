/* ============================================================
   main.js — запуск приложения и верхняя панель
   ============================================================ */
/* кнопки верхней панели */
$("#btnPeople").addEventListener("click", openPeople);
$("#btnAddTask").addEventListener("click", () => openTask(null));

/* название команды: чип справа от заголовка, правится по клику */
function renderTeam(force) {
  const wrap = $("#teamWrap");
  if (!wrap) return;
  // не сбиваем ввод, если пользователь как раз правит название
  if (!force && wrap.querySelector("#teamInput")) return;
  const name = String(state.team || "").trim();
  wrap.innerHTML = `<button type="button" class="team-chip${name ? "" : " is-empty"}"
    id="teamBtn" title="${name ? "Изменить название команды" : "Указать, чья это команда"}"
  >${name ? esc(name) : "Название команды"}</button>`;
  $("#teamBtn").addEventListener("click", editTeam);
  document.title = name
    ? "Планировщик загрузки — " + name
    : "Планировщик загрузки команды";
}

function editTeam() {
  const wrap = $("#teamWrap");
  if (!wrap) return;
  wrap.innerHTML = `<input class="team-input" id="teamInput" maxlength="40"
    placeholder="Например, Тестирование" value="${esc(state.team || "")}">`;
  const inp = $("#teamInput");
  inp.focus();
  inp.select();
  let done = false;
  const finish = (apply) => {
    if (done) return;
    done = true;
    if (apply) {
      state.team = inp.value.trim();
      save();
    }
    renderTeam(true);
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  inp.addEventListener("blur", () => finish(true));
}

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
