/* ============================================================
   task.js — окно задачи
   ============================================================ */
/* --- задача --- */
const DESC_MAX = 500;
let editingTask = null;

/* задача считается в рабочих днях; отпуск/больничный и задачи
   с отметкой «работа в выходные» — в календарных */
function isCalendarTask(t) {
  return t.type === "vacation" || t.type === "sick" || !!t.weekend;
}

/* раскладка задачи по календарным дням релиза:
   [{ i: индекс дня от начала релиза, amount: доля дня }]
   выходные внутри задачи дают нулевые участки — они нужны только
   для геометрии карточки (единый блок с заштрихованными выходными) */
function taskLayout(t, relStart) {
  const out = [];
  let left = t.days || 0;
  let d = t.start;
  const calendar = isCalendarTask(t);
  let guard = 0;
  while (left > 1e-9 && guard++ < 800) {
    if (calendar || isWorkday(d)) {
      const amount = round(Math.min(1, left));
      out.push({ i: diffDays(relStart, d), amount });
      left = round(left - amount);
    }
    d = addDays(d, 1);
  }
  return out;
}

/* окно задачи: дата авто-подстановки = первый свободный рабочий день
   от начала релиза; null — если свободного дня нет */
function firstFreeWorkday(personId, rel) {
  for (const d of eachDay(rel.start, rel.end)) {
    if (!isWorkday(d)) continue;
    if (loadAt(personId, rel, diffDays(rel.start, d)) < 1e-9) return d;
  }
  return null;
}

/* сколько дней показывает задача (для подписи на карточке) */
function taskDur(t) {
  return fmtDur(t.days);
}

/* описание: подгоняем высоту под текст и обновляем счётчик символов */
function syncDesc() {
  const el = $("#tDesc");
  if (!el) return;
  // maxlength не спасает при вставке/автозаполнении — подрезаем явно
  if (el.value.length > DESC_MAX) el.value = el.value.slice(0, DESC_MAX);
  const count = $("#tDescCount");
  const len = el.value.length;
  if (count) {
    count.textContent = len + " / " + DESC_MAX;
    count.classList.toggle("full", len >= DESC_MAX);
  }
  // высота строго по содержимому — прокрутки внутри поля нет.
  // box-sizing: border-box, поэтому к scrollHeight добавляем рамку,
  // иначе последняя строка обрезается на 2 px и появляется скролл
  el.style.height = "auto";
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = el.scrollHeight + border + "px";
}
$("#tDesc").addEventListener("input", syncDesc);

/* тип задачи управляет подписями и доступностью чекбокса выходных */
function syncTaskType() {
  const type = $("#tType").value;
  const vac = type === "vacation" || type === "sick";
  $("#tDaysLabel").textContent = vac ? "Дней" : "Рабочих дней";
  $("#tWeekendWrap").style.display = vac ? "none" : "";
  if (vac) $("#tWeekend").checked = false;
}

/* дата начала: подставляем первый свободный рабочий день */
function applyAutoStart() {
  const rel = activeRelease();
  const personId = $("#tPerson").value;
  if (!rel || !personId) return;
  const free = firstFreeWorkday(personId, rel);
  // свободного дня нет — предлагаем ближайший рабочий, ошибку покажем при сохранении
  $("#tStart").value = free || nextWorkday(rel.start);
}
$("#tPerson").addEventListener("change", () => {
  applyAutoStart();
  $("#tErr").textContent = "";
});
$("#tType").addEventListener("change", syncTaskType);
$("#tWeekend").addEventListener("change", () => {
  // включили работу в выходные — можно ставить на любой день
  if ($("#tWeekend").checked) return;
  const d = $("#tStart").value;
  if (d && isWeekend(d)) $("#tStart").value = nextWorkday(d);
});

function openTask(id) {
  const rel = activeRelease();
  if (!rel) {
    toast("Сначала создайте релиз");
    return;
  }
  if (!state.people.length) {
    toast("Сначала заведите сотрудников");
    return;
  }
  editingTask = id || null;
  const t = id ? state.tasks.find((x) => x.id === id) : null;
  $("#taskTitle").textContent = t ? "Редактирование задачи" : "Новая задача";
  $("#tPerson").innerHTML = state.people
    .map(
      (p) => `<option value="${p.id}">${esc(p.name || "Без имени")}</option>`,
    )
    .join("");
  $("#tPerson").value = t ? t.personId : state.people[0].id;
  $("#tStart").min = rel.start;
  $("#tStart").max = rel.end;
  $("#tDays").value = t ? t.days : 1;
  $("#tType").value = t ? t.type || "task" : "task";
  $("#tWeekend").checked = t ? !!t.weekend : false;
  syncTaskType();
  if (t) {
    // существующую задачу не сдвигаем
    $("#tStart").value = t.start;
  } else {
    $("#tStart").value = rel.start;
    applyAutoStart();
  }
  $("#tNum").value = t ? t.number || "" : "";
  $("#tDesc").value = t ? t.title || "" : "";
  $("#tErr").textContent = "";
  $("#tDelete").style.display = t ? "" : "none";
  $("#tSave").textContent = t ? "Подтвердить" : "Добавить";
  openModal("#mTask");
  // высоту считаем после открытия: у скрытого поля scrollHeight = 0
  syncDesc();
  setTimeout(() => $("#tDays").focus(), 50);
}
$("#tSave").addEventListener("click", () => {
  const rel = activeRelease();
  const personId = $("#tPerson").value;
  const start = $("#tStart").value;
  const days = parseFloat($("#tDays").value);
  const type = $("#tType").value;
  // отпуск и больничный всегда календарные — фиксируем это в данных
  const calendarType = type === "vacation" || type === "sick";
  const weekend = calendarType || $("#tWeekend").checked;
  const number = $("#tNum").value.trim();
  const title = $("#tDesc").value.trim().slice(0, DESC_MAX);
  const err = $("#tErr");

  if (!personId) {
    err.textContent = "Выберите исполнителя";
    return;
  }
  if (!start) {
    err.textContent = "Укажите дату начала";
    return;
  }
  if (!(days > 0)) {
    err.textContent = "Время должно быть больше 0";
    return;
  }
  if (diffDays(rel.start, start) < 0 || diffDays(start, rel.end) < 0) {
    err.textContent = "Дата вне периода релиза";
    return;
  }
  if (!weekend && isWeekend(start)) {
    err.textContent =
      "Дата начала — выходной. Включите «Работа в выходные» или выберите рабочий день";
    return;
  }
  const span = taskLayout({ start, days, type, weekend }, rel.start);
  if (!span.length) {
    err.textContent = "Задача не занимает ни одного дня";
    return;
  }
  if (span[span.length - 1].i > diffDays(rel.start, rel.end)) {
    err.textContent = "Задача выходит за границы релиза";
    return;
  }
  if (editingTask) {
    const t = state.tasks.find((x) => x.id === editingTask);
    Object.assign(t, {
      personId,
      start,
      days,
      type,
      number,
      title,
      weekend,
      daysMode: "work",
    });
    toast("Задача обновлена");
  } else {
    state.tasks.push({
      id: uid(),
      releaseId: rel.id,
      personId,
      start,
      days,
      type,
      number,
      title,
      weekend,
      daysMode: "work",
    });
    toast("Задача добавлена");
  }
  save();
  render();
  closeModal("#mTask");
});
$("#tDelete").addEventListener("click", () => {
  if (!editingTask) return;
  if (!confirm("Удалить задачу?")) return;
  state.tasks = state.tasks.filter((t) => t.id !== editingTask);
  save();
  render();
  closeModal("#mTask");
  toast("Задача удалена");
});
