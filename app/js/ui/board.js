/* ============================================================
   ui/board.js — отрисовка доски: даты, шапки людей, карточки.

   Вся геометрия считается здесь, в одном месте: карточка — это
   абсолютно позиционированный блок внутри колонки человека.
   ============================================================ */
import { $, esc } from "../core/dom.js";
import {
  isWorkday,
  addDays,
  eachDay,
  diffDays,
  fmt,
  parseISO,
  todayISO,
  workdaysBetween,
} from "../core/dates.js";
import {
  COL_W,
  ROW_H,
  WD,
  STATUS_LABEL,
  fmtDur,
  normalizeLink,
  round,
} from "../core/util.js";
import { isAbsence, taskDur } from "../core/schedule.js";
import { overflowDays, planPerson } from "../core/plan.js";
import { activeRelease, personLoad, state, tasksOf } from "../core/storage.js";
import { cardFill } from "../core/theme.js";
import { openPeople } from "../features/people.js";
import { openRelease } from "../features/release.js";
import { openTask } from "../features/task.js";
import { loadDemo } from "../features/demo.js";
import { taskLabels } from "../core/task-labels.js";

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
      const weekend = !isWorkday(day) ? " wk" : "";
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
          .filter((task) => !isAbsence(task))
          .reduce((sum, task) => sum + task.days, 0),
      );
      const restDays = round(total - taskDays);
      const out = personOutflow(person, release);
      const over = taskDays > norm + 1e-9;
      const hint = over
        ? `Задач больше, чем рабочих дней в релизе: ${taskDays} из ${norm}` +
          (restDays > 0
            ? `. Отпуск/больничный: ${restDays} дн — в сравнение не входят`
            : "")
        : `Задач: ${taskDays} дн, рабочих дней в релизе: ${norm}` +
          (restDays > 0 ? `. Отпуск/больничный: ${restDays} дн` : "");
      const outHint = out
        ? ` Часть задач не влезает в релиз: ${fmtDur(out)} за концом — они обрезаны на доске.`
        : "";
      const outBadge = out
        ? `<span class="pout" title="Не влезает в релиз: ${fmtDur(out)}">+${fmtDur(out)} за релизом</span>`
        : "";
      return `<div class="head" style="border-top:3px solid ${person.color}">
    <div class="pname">${esc(person.name || "Без имени")}</div>
    <div class="psum${over ? " is-over" : ""}" title="${esc(hint + outHint)}">Σ ${fmtDur(total)}${outBadge}</div></div>`;
    })
    .join("");
  return `<div class="heads">${heads}</div>`;
}

/* сколько дней задач человека не влезает в конец релиза */
function personOutflow(person, release) {
  const { queue } = planPerson(person.id, release, state.tasks);
  return round(
    queue.reduce((sum, card) => sum + overflowDays(card.segs, release), 0),
  );
}

/* тела столбцов: выходные, линия «сегодня», перегруз, карточки */
function renderBodies(release, days, today) {
  const bodies = state.people
    .map((person) => {
      let inner = "";
      const load = personLoad(person.id, release);

      days.forEach((day, index) => {
        if (!isWorkday(day))
          inner += `<div class="wk-cell" style="top:${index * ROW_H}px;height:${ROW_H}px"></div>`;
      });

      const todayIndex = diffDays(release.start, today);
      if (todayIndex >= 0 && todayIndex < days.length)
        inner += `<div class="today" style="top:${todayIndex * ROW_H}px"></div>`;

      days.forEach((day, index) => {
        const value = load[index] || 0;
        if (value > 1.001) {
          const first = (load[index - 1] || 0) > 1.001 ? "" : " first";
          inner += `<div class="over${first}" style="top:${index * ROW_H}px;height:${ROW_H}px" title="Перегрузка: ${round(value)} дн в этот день"></div>`;
        }
      });

      inner += renderCards(person, release, days.length, todayIndex);

      return `<div class="person-col">${inner}</div>`;
    })
    .join("");
  return `<div class="bodies">${bodies}</div>`;
}

/* карточки задач одной колонки.
   Раскладка берётся из planPerson(): start и участки по дням уже
   посчитаны очередью. Полдня — это полдня: если в одном дне стыкуются
   две задачи, они делят день пополам (верхняя половина — первой задаче,
   нижняя — второй), а не сужают весь блок. */
function renderCards(person, release, dayCount, todayIndex) {
  const { cards, absent } = planPerson(person.id, release, state.tasks);
  const items = cards
    .map((card) => {
      const segs = card.segs.filter((seg) => seg.i >= 0 && seg.i < dayCount);
      const out = card.segs.some((seg) => seg.i >= dayCount || seg.i < 0);
      if (!segs.length) {
        // задача целиком за концом релиза: показываем её полоской в
        // последнем дне — иначе до неё нельзя было бы добраться с доски.
        // Дни в полоске уже учтены в бейдже «+N дн за релизом».
        if (!out || isAbsence(card.task)) return null;
        return {
          task: card.task,
          start: dayCount - 1,
          end: dayCount,
          segs: [{ i: dayCount - 1, amount: 1 }],
          cut: true,
        };
      }
      const first = segs[0];
      const last = segs[segs.length - 1];
      return {
        task: card.task,
        start: first.i,
        end: last.i + 1,
        todayIndex,
        segs,
        // границы блока внутри первого и последнего дня: задача может
        // занимать не целый день, тогда её блок сдвигается и укорачивается
        from: first.at || 0,
        to: Math.min(1, round((last.at || 0) + last.amount)),
        cut: out,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // Отпуск и больничный стоят на своих датах. Если задача «повисла»
  // через отпуск, отпуск рисуется поверх неё, но уже — по краям видна
  // штриховка дней отсутствия, а сам отпуск остаётся видимым и
  // кликабельным, чтобы поправить его даты.
  const absences = items.filter((item) => isAbsence(item.task));
  const queued = items.filter((item) => !isAbsence(item.task));
  const overlapped = (item) =>
    queued.some((task) => task.start < item.end && item.start < task.end);

  // Дорожки нужны только при настоящем наложении (старые данные с
  // параллельными задачами и раздвоение дня отпуском). Обычное
  // стыкование половин дня дорожек не требует.
  const clusters = [];
  queued.forEach((item) => {
    const hits = clusters.filter((cluster) =>
      cluster.some((other) => conflict(other, item)),
    );
    if (!hits.length) {
      clusters.push([item]);
      return;
    }
    const target = hits[0];
    target.push(item);
    hits.slice(1).forEach((cluster) => {
      target.push(...cluster);
      clusters.splice(clusters.indexOf(cluster), 1);
    });
  });

  const under = absences
    .map((item) => {
      // если отпуск лежит поперёк задачи, делаем его уже: по краям видна
      // штриховка дней отсутствия, а сам отпуск остаётся кликабельным
      const narrow = overlapped(item);
      const inset = narrow ? 18 : 3;
      return cardHTML(item, person, inset, COL_W - inset * 2, release, absent);
    })
    .join("");

  const overlap = clusters
    .map((cluster) => {
      const lanes = [];
      cluster.forEach((item) => {
        let lane = lanes.findIndex((end) => end <= item.start + 1e-6);
        if (lane < 0) {
          lanes.push(item.end);
          lane = lanes.length - 1;
        } else {
          lanes[lane] = item.end;
        }
        item.lane = lane;
      });

      const laneWidth = COL_W / Math.max(1, lanes.length);
      return cluster
        .map((item) =>
          cardHTML(
            item,
            person,
            item.lane * laneWidth + 3,
            laneWidth - 6,
            release,
            absent,
          ),
        )
        .join("");
    })
    .join("");

  return under + overlap;
}

function cardHTML(item, person, left, width, release, absent) {
  const { task, segs } = item;
  const from = item.from || 0;
  const cls =
    task.type === "vacation" ? "vac" : task.type === "sick" ? "sick" : "task";
  // Статус (п.4) — только у обычной задачи: у отпуска и больничного его
  // нет и в данных. Класс вешает подсветку, иконка встаёт в верхнюю строку
  // за «дн», а заливку накладываем отдельным градиентом (см. .card.st-*
  // в board.css) — инлайновый цвет сотрудника при этом сохраняется.
  const status = cls === "task" ? taskStatus(task) : "";
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
  // Номер с ссылкой (п.5) — обычная ссылка в новой вкладке. Окно задачи
  // по ней не открывается: bindCards() пропускает клики по <a>.
  // Адрес перепроверяем при отрисовке: в данных он уже нормализован, но
  // в импортированном файле может оказаться что угодно.
  const link = cls === "task" ? normalizeLink(task.link) : "";
  // Адрес не дублируем отдельной подсказкой на номере: он и так есть
  // в подсказке карточки (cardHint → hint.link), а своя data-tip на ссылке
  // перекрыла бы подсказку с описанием у обрезанных карточек.
  const headHTML =
    cls === "task" && task.number && link
      ? `<a class="c-num" href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(head)} — открыть ссылку в новой вкладке">${esc(head)}</a>`
      : `<div class="c-num">${esc(head)}</div>`;
  const sub = task.title || "";
  const labelsHTML = taskLabels(task)
    .map((label) => `<span class="c-label">${label}</span>`)
    .join("");

  // дни, когда работа не идёт: выходные и отсутствие человека.
  // Заштриховываем, чтобы было видно, но карточка остаётся одним блоком.
  // Подряд идущие дни рисуем ОДНИМ элементом: у каждого своего элемента
  // фаза градиента начинается заново, и на стыке полосы сбиваются.
  let hatches = "";
  if (segs.length && release) {
    const first = segs[0].i;
    const last = segs[segs.length - 1].i;
    const offDay = (i) => {
      const day = addDays(release.start, i);
      // у отпуска и больничного свои дни не штрихуем: это и есть его блок
      if (!isAbsence(task) && absent && absent.has(day)) return true;
      if (task.weekend) return false;
      return !isWorkday(day);
    };
    let runStart = -1;
    for (let i = first; i <= last + 1; i++) {
      const off = i <= last && offDay(i);
      if (off && runStart < 0) runStart = i;
      if (!off && runStart >= 0) {
        // позиция внутри карточки: она стоит на 2px ниже строки и имеет
        // рамку 1px. Верх карточки может быть в середине первого дня,
        // поэтому день i отстоит от него на (i - first - from) * ROW_H,
        // а штриховка начинается на 1px выше границы строки, под рамкой.
        const hatchTop = (runStart - first - from) * ROW_H - 3;
        const hatchHeight = (i - runStart) * ROW_H;
        hatches += `<span class="c-off" style="top:${hatchTop}px;height:${hatchHeight}px"></span>`;
        runStart = -1;
      }
    }
  }

  // Верх блока — начало первого дня плюс уже занятая его часть; низ —
  // конец последнего дня. Задача на полдня занимает половину ряда и
  // может начинаться в середине дня, сразу за предыдущей (Р9).
  const to = item.to == null ? 1 : item.to;
  const top = (item.start + from) * ROW_H + 2;
  const bottom = (item.end - 1 + to) * ROW_H - 2;
  const height = Math.max(18, bottom - top);
  // Продолжаем общую линию внутри карточки на той же высоте.
  // Её слой ниже текста, а клики по-прежнему получает карточка.
  const todayTop = item.todayIndex * ROW_H - top - 1;
  const todayLine =
    todayTop >= 0 && todayTop < height - 2
      ? `<span class="c-today" style="top:${todayTop}px" aria-hidden="true"></span>`
      : "";
  // overflow:hidden обрезает внутреннюю линию у рамки. Два внешних
  // отрезка продолжают её поверх боковых рамок, не затрагивая текст.
  const todayEdges = todayLine
    ? [left, left + width - 1]
        .map(
          (edge) =>
            `<span class="today-edge" style="left:${edge}px;top:${item.todayIndex * ROW_H}px" aria-hidden="true"></span>`,
        )
        .join("")
    : "";

  // задача не влезла в релиз — обрезана по его концу (Р3).
  // Это не ошибка, поэтому только метка и подсказка.
  const out = item.cut && cls === "task";

  // Полный текст карточки кладём в data-hint: на маленьких карточках
  // описание обрезается (overflow: hidden), и подсказка — единственный
  // способ увидеть его целиком. В подсказку (data-tip) он попадает
  // только там, где текст реально не влез — см. applyHints().
  const hint = cardHint(item, cls, head);

  // иконка статуса: «!» в круге или «✓». Идёт последней в строке сверху —
  // там же, где номер и «дн», поэтому никогда не наезжает на них.
  // Подпись отдаём своей плашке (ui/tooltip.js) через data-tip, а не
  // системному title: иначе рядом с подсказками карточек появлялся бы
  // чужой браузерный тултип. data-tip на самой иконке перекрывает
  // data-tip карточки, поэтому наведение на значок показывает статус.
  // Тот же ключ, что и в подсказке карточки, — плашка рисует пилюлю.
  const statusLabel = status ? STATUS_LABEL[status] : "";
  const markTip = status
    ? esc(JSON.stringify({ status: statusLabel, statusKind: status }))
    : "";
  const mark = status
    ? `<span class="c-st" data-tip="${markTip}" aria-label="${esc(statusLabel)}">${status === "preprod" ? "✓" : "!"}</span>`
    : "";

  return `<div class="card ${cls}${status ? " st-" + status : ""}${out ? " is-out" : ""}" data-task="${task.id}" data-hint="${esc(JSON.stringify(hint))}"
    style="left:${left}px;width:${width}px;top:${top}px;height:${height}px;${style}">
  ${hatches}
  ${todayLine}
  <div class="c-top"><div class="c-heading">${labelsHTML}${headHTML}</div><div class="c-right"><div class="c-dur">${taskDur(task)}</div>${mark}</div></div>
  ${sub ? `<div class="c-txt">${esc(sub)}</div>` : ""}
</div>${todayEdges}`;
}

/* статус из данных: пустая строка и любые неизвестные значения — «обычная».
   Отдельная функция, чтобы класс на карточке и подпись в подсказке брали
   статус из одного места. */
function taskStatus(task) {
  return task.status === "waiting" || task.status === "preprod"
    ? task.status
    : "";
}

/* Содержимое подсказки отдельными полями, а не одной строкой: номер,
   описание и длительность рисуются разными стилями (номер — акцентом,
   дни — приглушённо), поэтому границы между ними видно сразу.
   Статус отдаём не текстом, а ключом: плашка в ui/tooltip.js рисует по
   нему пилюлю в цветах статуса (см. .tip-pill в board.css).
   Дата начала и окончания в подсказку не входит — в TODO п.3 её нет.
   Ссылка (п.5) — отдельной строкой, чтобы адрес можно было прочитать,
   даже если номер на карточке обрезан. */
function cardHint(item, cls, head) {
  const { task } = item;
  const hint = {
    head,
    title: task.title || "",
    dur: taskDur(task),
  };
  if (cls === "task") {
    hint.labels = taskLabels(task);
    const status = taskStatus(task);
    if (status) {
      hint.status = STATUS_LABEL[status];
      hint.statusKind = status;
    }
    if (task.link) hint.link = normalizeLink(task.link) || undefined;
    if (item.cut) hint.cut = "Не влезает в релиз — обрезано на доске";
  }
  return hint;
}

/* пересекаются ли две карточки: общий день и настоящий нахлёст по
   вертикали. Стык «половина дня — половина дня» нахлёстом не считается. */
function conflict(a, b) {
  if (a.start >= b.end || b.start >= a.end) return false;
  const spans = new Map();
  a.segs.forEach((seg) =>
    spans.set(seg.i, [seg.at || 0, (seg.at || 0) + seg.amount]),
  );
  return b.segs.some((seg) => {
    const span = spans.get(seg.i);
    if (!span) return false;
    const at = seg.at || 0;
    return span[0] < at + seg.amount - 1e-6 && at < span[1] - 1e-6;
  });
}

function bindCards() {
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", (event) => {
      // ссылка в номере открывается сама, окно задачи не всплывает
      if (event.target instanceof Element && event.target.closest("a")) return;
      openTask(card.dataset.task);
    });
  });
  applyHints();
}

/* Подсказку ставим только там, где текст действительно обрезан: свой
   тултип (ui/tooltip.js) читает data-tip. Считаем, сколько строк
   названия влезло в высоту карточки, и заодно обрезаем лишнее
   многоточием. Карточки «не влезает в релиз» получают подсказку всегда —
   иначе их обрезка осталась бы без объяснения. */
function applyHints() {
  document.querySelectorAll(".card").forEach((card) => {
    // Высоту на сетке не меняем: две задачи на полдня должны стыковаться.
    card.classList.toggle("is-compact", card.getBoundingClientRect().height < 30);
    const txt = card.querySelector(".c-txt");
    const clippedV = clipTitle(card, txt);
    const num = card.querySelector(".c-num");
    const clippedH =
      (num && num.scrollWidth > num.clientWidth + 1) ||
      card.scrollWidth > card.clientWidth + 1;
    const hint = card.dataset.hint;
    if (hint && (clippedV || clippedH || card.classList.contains("is-out")))
      card.dataset.tip = hint;
    else delete card.dataset.tip;
  });
}
/* Обрезаем название по высоте карточки и ставим многоточие: без этого
   последняя строка обрубается рамкой «на полуслове» и наезжает на
   количество дней. Сколько строк влезает, считаем по фактической высоте,
   поэтому работает и на карточке в один день, и на длинной.
   Возвращает true, если название пришлось обрезать (для подсказки).
   У карточки на полдня (≈19 px) места нет даже под одну строку: там
   `room` выходит отрицательным, и это тоже считается обрезкой — иначе
   полностью скрытый заголовок остался бы без подсказки. */
function clipTitle(card, txt) {
  if (!txt) return false;
  txt.hidden = false;
  txt.classList.remove("clamp");
  txt.style.removeProperty("-webkit-line-clamp");
  const top = card.querySelector(".c-top");
  const cs = getComputedStyle(txt);
  const cardStyle = getComputedStyle(card);
  const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
  const room =
    card.getBoundingClientRect().bottom -
    parseFloat(cardStyle.borderBottomWidth) -
    parseFloat(cardStyle.paddingBottom) -
    top.getBoundingClientRect().bottom -
    parseFloat(cs.marginTop);
  if (room < lineH) {
    txt.hidden = true;
    return true;
  }
  const lines = Math.max(1, Math.floor(room / lineH));
  const fits =
    room >= lineH && txt.getBoundingClientRect().height <= lines * lineH + 1;
  if (fits) return false;
  txt.classList.add("clamp");
  txt.style.webkitLineClamp = String(lines);
  return true;
}
