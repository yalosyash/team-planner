/* ============================================================
   features/task.js — окно задачи: создание, правка, удаление.
   ============================================================ */
import { $, esc, toast } from "../core/dom.js";
import { diffDays, eachDay, isWeekend, nextWorkday } from "../core/dates.js";
import { activeRelease, loadAt, state, save } from "../core/storage.js";
import { uid } from "../core/util.js";
import { taskLayout } from "../core/schedule.js";
import { render } from "../core/render.js";
import { closeModal, openModal } from "../ui/modal.js";

const DESC_MAX = 500;
let editingId = null;

/* окно задачи: дата авто-подстановки = первый свободный рабочий день
   от начала релиза; null — если свободного дня нет */
function firstFreeWorkday(personId, release) {
  for (const day of eachDay(release.start, release.end)) {
    if (isWeekend(day)) continue;
    if (loadAt(personId, release, diffDays(release.start, day)) < 1e-9)
      return day;
  }
  return null;
}

/* описание: подгоняем высоту под текст и обновляем счётчик символов */
function syncDesc() {
  const el = $("#tDesc");
  if (!el) return;
  // maxlength не спасает при вставке/автозаполнении — подрезаем явно
  if (el.value.length > DESC_MAX) el.value = el.value.slice(0, DESC_MAX);
  const count = $("#tDescCount");
  const length = el.value.length;
  if (count) {
    count.textContent = length + " / " + DESC_MAX;
    count.classList.toggle("full", length >= DESC_MAX);
  }
  // высота строго по содержимому — прокрутки внутри поля нет.
  // box-sizing: border-box, поэтому к scrollHeight добавляем рамку,
  // иначе последняя строка обрезается на 2 px и появляется скролл
  el.style.height = "auto";
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = el.scrollHeight + border + "px";
}

/* тип задачи управляет подписями и доступностью чекбокса выходных */
function syncTaskType() {
  const type = $("#tType").value;
  const calendar = type === "vacation" || type === "sick";
  $("#tDaysLabel").textContent = calendar ? "Дней" : "Рабочих дней";
  $("#tWeekendWrap").hidden = calendar;
  if (calendar) $("#tWeekend").checked = false;
}

/* дата начала: подставляем первый свободный рабочий день */
function applyAutoStart() {
  const release = activeRelease();
  const personId = $("#tPerson").value;
  if (!release || !personId) return;
  const free = firstFreeWorkday(personId, release);
  // свободного дня нет — предлагаем ближайший рабочий, ошибку покажем при сохранении
  $("#tStart").value = free || nextWorkday(release.start);
}

export function openTask(id) {
  const release = activeRelease();
  if (!release) {
    toast("Сначала создайте релиз");
    return;
  }
  if (!state.people.length) {
    toast("Сначала заведите сотрудников");
    return;
  }

  editingId = id || null;
  const task = id ? state.tasks.find((x) => x.id === id) : null;

  $("#taskTitle").textContent = task ? "Редактирование задачи" : "Новая задача";
  $("#tPerson").innerHTML = state.people
    .map(
      (person) =>
        `<option value="${person.id}">${esc(person.name || "Без имени")}</option>`,
    )
    .join("");
  $("#tPerson").value = task ? task.personId : state.people[0].id;
  $("#tStart").min = release.start;
  $("#tStart").max = release.end;
  $("#tDays").value = task ? task.days : 1;
  $("#tType").value = task ? task.type || "task" : "task";
  $("#tWeekend").checked = task ? !!task.weekend : false;
  syncTaskType();

  if (task) {
    // существующую задачу не сдвигаем
    $("#tStart").value = task.start;
  } else {
    $("#tStart").value = release.start;
    applyAutoStart();
  }

  $("#tNum").value = task ? task.number || "" : "";
  $("#tDesc").value = task ? task.title || "" : "";
  $("#tErr").textContent = "";
  $("#tDelete").hidden = !task;
  $("#tSave").textContent = task ? "Подтвердить" : "Добавить";

  openModal("#mTask");
  // высоту считаем после открытия: у скрытого поля scrollHeight = 0
  syncDesc();
  setTimeout(() => $("#tDays").focus(), 50);
}

function saveTask() {
  const release = activeRelease();
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
  if (diffDays(release.start, start) < 0 || diffDays(start, release.end) < 0) {
    err.textContent = "Дата вне периода релиза";
    return;
  }
  if (!weekend && isWeekend(start)) {
    err.textContent =
      "Дата начала — выходной. Включите «Работа в выходные» или выберите рабочий день";
    return;
  }

  const span = taskLayout({ start, days, type, weekend }, release.start);
  if (!span.length) {
    err.textContent = "Задача не занимает ни одного дня";
    return;
  }
  if (span[span.length - 1].i > diffDays(release.start, release.end)) {
    err.textContent = "Задача выходит за границы релиза";
    return;
  }

  if (editingId) {
    const task = state.tasks.find((x) => x.id === editingId);
    Object.assign(task, {
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
      releaseId: release.id,
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
}

function deleteTask() {
  if (!editingId) return;
  if (!confirm("Удалить задачу?")) return;
  state.tasks = state.tasks.filter((task) => task.id !== editingId);
  save();
  render();
  closeModal("#mTask");
  toast("Задача удалена");
}

export function initTask() {
  $("#tDesc").addEventListener("input", syncDesc);
  $("#tPerson").addEventListener("change", () => {
    applyAutoStart();
    $("#tErr").textContent = "";
  });
  $("#tType").addEventListener("change", syncTaskType);
  $("#tWeekend").addEventListener("change", () => {
    // включили работу в выходные — можно ставить на любой день
    if ($("#tWeekend").checked) return;
    const day = $("#tStart").value;
    if (day && isWeekend(day)) $("#tStart").value = nextWorkday(day);
  });
  $("#tSave").addEventListener("click", saveTask);
  $("#tDelete").addEventListener("click", deleteTask);
}
