/* ============================================================
   features/task.js — окно задачи: создание, правка, удаление.
   ============================================================ */
import { $, esc, toast } from "../core/dom.js";
import { activeRelease, state, save } from "../core/storage.js";
import { normalizeLink, uid } from "../core/util.js";
import { previewPlacement } from "../core/plan.js";
import { render } from "../core/render.js";
import { closeModal, openModal } from "../ui/modal.js";

const DESC_MAX = 500;
let editingId = null;

/* отпуск и больничный стоят на своих датах, остальные задачи в очереди */
function isAbsenceType(type) {
  return type === "vacation" || type === "sick";
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

/* тип задачи управляет подписями, датой начала и чекбоксом выходных */
function syncTaskType() {
  const type = $("#tType").value;
  const calendar = isAbsenceType(type);
  $("#tDaysLabel").textContent = calendar ? "Дней" : "Рабочих дней";
  $("#tWeekendWrap").hidden = calendar;
  $("#tStartWrap").hidden = !calendar;
  // поля задачи не нужны отпуску и больничному
  $("#tNumWrap").hidden = calendar;
  $("#tDescWrap").hidden = calendar;
  $("#tStatusWrap").hidden = calendar;
  $("#tLinkWrap").hidden = calendar;
  if (calendar) $("#tWeekend").checked = false;
  else syncDesc();
}

/* выбранный статус в переключателе (п.4) */
function readStatus() {
  const checked = document.querySelector('input[name="tStatus"]:checked');
  return checked ? checked.value : "";
}

function setStatus(value) {
  const want = value === "waiting" || value === "preprod" ? value : "";
  const radio = document.querySelector(
    `input[name="tStatus"][value="${want}"]`,
  );
  if (radio) radio.checked = true;
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
  $("#tDays").value = task ? task.days : 1;
  $("#tType").value = task ? task.type || "task" : "task";
  $("#tWeekend").checked = task ? !!task.weekend : false;
  $("#tNum").value = task ? task.number || "" : "";
  $("#tLink").value = task ? task.link || "" : "";
  $("#tDesc").value = task ? task.title || "" : "";
  setStatus(task ? task.status : "");

  syncTaskType();
  $("#tStart").min = release.start;
  $("#tStart").max = release.end;
  $("#tStart").value = task ? task.start : release.start;

  $("#tErr").textContent = "";
  $("#tDelete").hidden = !task;
  $("#tSave").textContent = task ? "Подтвердить" : "Добавить";

  openModal("#mTask");
  // высоту считаем после открытия: у скрытого поля scrollHeight = 0
  if (!isAbsenceType($("#tType").value)) syncDesc();
  setTimeout(() => $("#tDays").focus(), 50);
}

function saveTask() {
  const release = activeRelease();
  const personId = $("#tPerson").value;
  const days = parseFloat($("#tDays").value);
  const type = $("#tType").value;
  const calendarType = isAbsenceType(type);
  // отпуск и больничный всегда календарные — фиксируем это в данных
  const weekend = calendarType || $("#tWeekend").checked;
  const number = calendarType ? "" : $("#tNum").value.trim();
  const title = calendarType ? "" : $("#tDesc").value.trim().slice(0, DESC_MAX);
  // у отпуска и больничного статуса нет — не записываем его даже если
  // в скрытом переключателе что-то осталось
  const status = calendarType ? "" : readStatus();
  // ссылка: пусто → поля нет, без схемы → https://, чужая схема → ошибка
  const link = calendarType ? "" : normalizeLink($("#tLink").value);
  const err = $("#tErr");

  if (!personId) {
    err.textContent = "Выберите исполнителя";
    return;
  }
  if (!(days > 0)) {
    err.textContent = "Время должно быть больше 0";
    return;
  }
  if (link === null) {
    err.textContent = "Ссылка может быть только http:// или https://";
    return;
  }

  // дата начала осталась только у отпуска/больничного: они не в очереди
  let start;
  if (calendarType) {
    start = $("#tStart").value;
    if (!start) {
      err.textContent = "Укажите дату начала";
      return;
    }
  } else {
    // у задачи место считается очередью; для существующей задачи
    // сохраняем прежний start — очередь пересчитается в render()
    const prev = editingId ? state.tasks.find((x) => x.id === editingId) : null;
    start = prev ? prev.start : release.start;
  }

  // У отпуска/больничного место своё; у задач очередь не может дать
  // пустую раскладку при днях > 0, но проверка дешёвая — пусть будет.
  if (!calendarType) {
    const place = previewPlacement(
      {
        id: editingId || "__new",
        releaseId: release.id,
        personId,
        start,
        days,
        type,
        weekend,
      },
      release,
      state.tasks,
    );
    if (!place.segs.length) {
      err.textContent = "Задача не занимает ни одного дня";
      return;
    }
  }

  if (editingId) {
    const task = state.tasks.find((x) => x.id === editingId);
    const movedPerson = task.personId !== personId;
    Object.assign(task, {
      personId,
      start,
      days,
      type,
      number,
      title,
      status,
      weekend,
      daysMode: "work",
    });
    // пустая ссылка — поля в данных нет (как у старых задач)
    if (link) task.link = link;
    else delete task.link;
    // Сменили исполнителя — задача уходит в конец очереди нового
    // человека: её прежнее место в массиве относилось к другому столбцу.
    if (movedPerson) {
      state.tasks = state.tasks.filter((x) => x.id !== task.id).concat(task);
    }
    toast("Задача обновлена");
  } else {
    // новая задача — в конец state.tasks, то есть в конец очереди
    state.tasks.push({
      id: uid(),
      releaseId: release.id,
      personId,
      start,
      days,
      type,
      number,
      title,
      status,
      // пустая строка → поля нет: старая версия и экспорт видят те же данные
      link: link || undefined,
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
    $("#tErr").textContent = "";
  });
  $("#tType").addEventListener("change", syncTaskType);
  $("#tSave").addEventListener("click", saveTask);
  $("#tDelete").addEventListener("click", deleteTask);
}
