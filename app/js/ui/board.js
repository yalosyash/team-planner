/* ============================================================
   ui/board.js — отрисовка доски: даты, шапки людей, карточки.

   Вся геометрия считается здесь, в одном месте: карточка — это
   абсолютно позиционированный блок внутри колонки человека.
   ============================================================ */
import { $, esc } from "../core/dom.js";
import {
  isWeekend,
  addDays,
  eachDay,
  diffDays,
  fmt,
  parseISO,
  todayISO,
  workdaysBetween,
} from "../core/dates.js";
import { COL_W, ROW_H, WD, fmtDur, round } from "../core/util.js";
import { isCalendarTask, taskDur, taskLayout } from "../core/schedule.js";
import { activeRelease, loadAt, state, tasksOf } from "../core/storage.js";
import { cardFill } from "../core/theme.js";
import { openPeople } from "../features/people.js";
import { openRelease } from "../features/release.js";
import { openTask } from "../features/task.js";
import { loadDemo } from "../features/demo.js";

export function renderBoard() {
  const board = $("#board");
  const release = activeRelease();

  if (!state.people.length) {
    board.innerHTML = `<div class="empty">
    <h2>Шаг 1. Заведите сотрудников</h2>
    <p>Добавьте людей отдела — они станут столбцами таблицы. Позже можно добавлять и удалять.</p>
    <div class="empty-actions">
      <button class="primary" id="ePeople">Добавить сотрудников</button>
      <button id="eDemo">Загрузить демо</button>
    </div></div>`;
    $("#ePeople").onclick = openPeople;
    $("#eDemo").onclick = loadDemo;
    return;
  }

  if (!release) {
    board.innerHTML = `<div class="empty">
    <h2>Шаг 2. Заведите релиз</h2>
    <p>Нажмите «+ Релиз» на панели вкладок выше, укажите номер и даты начала и окончания.</p>
    <button class="primary" id="eRel">+ Новый релиз</button></div>`;
    $("#eRel").onclick = () => openRelease(null);
    return;
  }

  const days = eachDay(release.start, release.end);
  const today = todayISO();

  board.innerHTML = `<div class="grid">
  <div class="left">${renderDates(days, today)}</div>
  <div class="cols">${renderHeads(release)}${renderBodies(release, days, today)}</div>
</div>`;

  bindCards();
}

/* левая колонка с датами */
function renderDates(days, today) {
  const cells = days
    .map((day, index) => {
      const weekend = [0, 6].includes(parseISO(day).getDay()) ? " wk" : "";
      const isToday = day === today;
      const title = isToday ? ' title="Сегодня"' : "";
      const todayMark = isToday ? '<span class="dtoday">сегодня</span>' : "";
      return `<div class="date-cell${weekend}${isToday ? " is-today" : ""}"${title}><span class="dwrap"><span class="dnum">${index + 1}</span><span class="ddate">${fmt(day)}, ${WD[parseISO(day).getDay()]}${todayMark}</span></span></div>`;
    })
    .join("");
  return `<div class="corner">Даты</div><div class="dates">${cells}</div>`;
}

/* шапка с людьми: имя и суммарная загрузка */
function renderHeads(release) {
  const norm = workdaysBetween(release.start, release.end);
  const heads = state.people
    .map((person) => {
      const all = tasksOf(person.id, release.id);
      const total = all.reduce((sum, task) => sum + task.days, 0);
      // с нормой сравниваем только задачи: отпуск/больничный — это не перегруз
      const taskDays = round(
        all
          .filter((task) => task.type === "task")
          .reduce((sum, task) => sum + task.days, 0),
      );
      const restDays = round(total - taskDays);
      const over = taskDays > norm + 1e-9;
      const hint = over
        ? `Задач больше, чем рабочих дней в релизе: ${taskDays} из ${norm}` +
          (restDays > 0
            ? `. Отпуск/больничный: ${restDays} дн — в сравнение не входят`
            : "")
        : `Задач: ${taskDays} дн, рабочих дней в релизе: ${norm}` +
          (restDays > 0 ? `. Отпуск/больничный: ${restDays} дн` : "");
      return `<div class="head" style="border-top:3px solid ${person.color}">
    <div class="pname">${esc(person.name || "Без имени")}</div>
    <div class="psum${over ? " is-over" : ""}" title="${esc(hint)}">Σ ${fmtDur(total)}</div></div>`;
    })
    .join("");
  return `<div class="heads">${heads}</div>`;
}

/* тела столбцов: выходные, линия «сегодня», перегруз, карточки */
function renderBodies(release, days, today) {
  const bodies = state.people
    .map((person) => {
      let inner = "";

      days.forEach((day, index) => {
        if ([0, 6].includes(parseISO(day).getDay()))
          inner += `<div class="wk-cell" style="top:${index * ROW_H}px;height:${ROW_H}px"></div>`;
      });

      const todayIndex = diffDays(release.start, today);
      if (todayIndex >= 0 && todayIndex < days.length)
        inner += `<div class="today" style="top:${todayIndex * ROW_H}px"></div>`;

      days.forEach((day, index) => {
        const load = loadAt(person.id, release, index);
        if (load > 1.001) {
          const first =
            loadAt(person.id, release, index - 1) > 1.001 ? "" : " first";
          inner += `<div class="over${first}" style="top:${index * ROW_H}px;height:${ROW_H}px" title="Перегрузка: ${round(load)} дн в этот день"></div>`;
        }
      });

      inner += renderCards(person, release);

      return `<div class="person-col">${inner}</div>`;
    })
    .join("");
  return `<div class="bodies">${bodies}</div>`;
}

/* карточки задач одной колонки, разложенные по дорожкам */
function renderCards(person, release) {
  const items = tasksOf(person.id, release.id)
    .map((task) => {
      const segs = taskLayout(task, release.start);
      const first = segs[0] || { i: diffDays(release.start, task.start) };
      const last = segs[segs.length - 1] || first;
      // единый блок от первого до последнего дня: выходные внутри
      // задачи попадают в блок и заштриховываются
      return { task, start: first.i, end: last.i + 1, segs };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // дорожки для пересекающихся задач — раскладываем жадно
  const lanes = [];
  items.forEach((item) => {
    let lane = lanes.findIndex((end) => end <= item.start + 1e-6);
    if (lane < 0) {
      lanes.push(item.end);
      lane = lanes.length - 1;
    } else {
      lanes[lane] = item.end;
    }
    item.lane = lane;
  });

  const laneCount = Math.max(1, lanes.length);
  const laneWidth = COL_W / laneCount;

  return items
    .map((item) => {
      const left = item.lane * laneWidth + 3;
      const width = laneWidth - 6;
      const top = item.start * ROW_H + 2;
      const height = Math.max(18, (item.end - item.start) * ROW_H - 4);
      return cardHTML(
        item.task,
        person,
        left,
        width,
        top,
        height,
        item.segs,
        release,
      );
    })
    .join("");
}

function cardHTML(task, person, left, width, top, height, segs, release) {
  const cls =
    task.type === "vacation" ? "vac" : task.type === "sick" ? "sick" : "task";
  const style =
    cls === "task"
      ? `background:${cardFill(person.color)};border-color:${person.color};`
      : "";
  const head =
    task.type === "vacation"
      ? "Отпуск"
      : task.type === "sick"
        ? "Больничный"
        : task.number || "Задача";
  const sub = task.title || "";
  // выходные внутри блока: заштриховываем, чтобы было видно, что работа
  // в эти дни не идёт, но карточка остаётся одним блоком.
  // Подряд идущие выходные (сб+вс) рисуем ОДНИМ элементом: у каждого своего
  // элемента фаза градиента начинается заново, и на стыке полосы сбиваются.
  let hatches = "";
  if (segs && release && !isCalendarTask(task)) {
    const first = segs[0].i;
    const last = segs[segs.length - 1].i;
    let runStart = -1;
    for (let i = first; i <= last + 1; i++) {
      const weekend = i <= last && isWeekend(addDays(release.start, i));
      if (weekend && runStart < 0) runStart = i;
      if (!weekend && runStart >= 0) {
        // позиция внутри карточки: она стоит на 2px ниже строки и имеет
        // рамку 1px, поэтому сдвиг дня = (i - first) * ROW_H - 3
        const hatchTop = (runStart - first) * ROW_H - 3;
        const hatchHeight = (i - runStart) * ROW_H;
        hatches += `<span class="c-off" style="top:${hatchTop}px;height:${hatchHeight}px"></span>`;
        runStart = -1;
      }
    }
  }

  return `<div class="card ${cls}" data-task="${task.id}"
    style="left:${left}px;width:${width}px;top:${top}px;height:${height}px;${style}">
  ${hatches}
  <div class="c-num">${esc(head)}</div>
  ${sub ? `<div class="c-txt">${esc(sub)}</div>` : ""}
  <div class="c-dur">${taskDur(task)}</div>
</div>`;
}

function bindCards() {
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => openTask(card.dataset.task));
  });
}
