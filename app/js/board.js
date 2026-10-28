/* ============================================================
   board.js — отрисовка доски
   ============================================================ */
/* ============ доска ============ */
function renderBoard() {
  const board = $("#board");
  const rel = activeRelease();

  if (!state.people.length) {
    board.innerHTML = `<div class="empty">
    <h2>Шаг 1. Заведите сотрудников</h2>
    <p>Добавьте людей отдела — они станут столбцами таблицы. Позже можно добавлять и удалять.</p>
    <div style="display:flex;gap:10px">
      <button class="primary" id="ePeople">Добавить сотрудников</button>
      <button id="eDemo">Загрузить демо</button>
    </div></div>`;
    $("#ePeople").onclick = openPeople;
    $("#eDemo").onclick = loadDemo;
    return;
  }
  if (!rel) {
    board.innerHTML = `<div class="empty">
    <h2>Шаг 2. Заведите релиз</h2>
    <p>Нажмите «+ Релиз» на панели вкладок выше, укажите номер и даты начала и окончания.</p>
    <button class="primary" id="eRel">+ Новый релиз</button></div>`;
    $("#eRel").onclick = () => openRelease(null);
    return;
  }

  const days = eachDay(rel.start, rel.end);
  const today = todayISO();

  /* левая колонка с датами */
  let left = `<div class="corner">Даты</div><div class="dates">`;
  days.forEach((d, i) => {
    const wk = [0, 6].includes(parseISO(d).getDay()) ? " wk" : "";
    const isToday = d === today;
    left += `<div class="date-cell${wk}${isToday ? " is-today" : ""}"${isToday ? ' title="Сегодня"' : ""}><span class="dwrap"><span class="dnum">${i + 1}</span><span class="ddate">${fmt(d)}, ${WD[parseISO(d).getDay()]}${isToday ? '<span class="dtoday">сегодня</span>' : ""}</span></span></div>`;
  });
  left += `</div>`;

  /* шапка с людьми */
  const norm = workdaysBetween(rel.start, rel.end);
  let heads = `<div class="heads">`;
  state.people.forEach((p) => {
    const all = tasksOf(p.id, rel.id);
    const total = all.reduce((a, t) => a + t.days, 0);
    // с нормой сравниваем только задачи: отпуск/больничный — это не перегруз
    const taskDays = round(
      all.filter((t) => t.type === "task").reduce((a, t) => a + t.days, 0),
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
    heads += `<div class="head" style="border-top:3px solid ${p.color}">
    <div class="pname">${esc(p.name || "Без имени")}</div>
    <div class="psum${over ? " is-over" : ""}" title="${esc(hint)}">Σ ${fmtDur(total)}</div></div>`;
  });
  heads += `</div>`;

  /* тела столбцов */
  let bodies = `<div class="bodies">`;
  state.people.forEach((p) => {
    let inner = "";
    days.forEach((d, i) => {
      if ([0, 6].includes(parseISO(d).getDay()))
        inner += `<div class="wk-cell" style="top:${i * ROW_H}px;height:${ROW_H}px"></div>`;
    });
    const ti = diffDays(rel.start, todayISO());
    if (ti >= 0 && ti < days.length)
      inner += `<div class="today" style="top:${ti * ROW_H}px"></div>`;
    days.forEach((d, i) => {
      const load = loadAt(p.id, rel, i);
      if (load > 1.001)
        inner += `<div class="over${loadAt(p.id, rel, i - 1) > 1.001 ? "" : " first"}" style="top:${i * ROW_H}px;height:${ROW_H}px" title="Перегрузка: ${round(load)} дн в этот день"></div>`;
    });

    // дорожки для пересекающихся задач
    const items = tasksOf(p.id, rel.id)
      .map((t) => {
        const segs = taskLayout(t, rel.start);
        const first = segs[0] || { i: diffDays(rel.start, t.start) };
        const last = segs[segs.length - 1] || first;
        // единый блок от первого до последнего дня: выходные внутри
        // задачи попадают в блок и заштриховываются
        return { t, s: first.i, e: last.i + 1, segs };
      })
      .sort((a, b) => a.s - b.s || a.e - b.e);
    const lanes = [];
    items.forEach((it) => {
      let li = lanes.findIndex((end) => end <= it.s + 1e-6);
      if (li < 0) {
        lanes.push(it.e);
        li = lanes.length - 1;
      } else lanes[li] = it.e;
      it.lane = li;
    });
    const lc = Math.max(1, lanes.length);
    const laneW = COL_W / lc;
    items.forEach((it) => {
      const left = it.lane * laneW + 3,
        w = laneW - 6;
      const top = it.s * ROW_H + 2;
      const h = Math.max(18, (it.e - it.s) * ROW_H - 4);
      inner += cardHTML(it.t, p, left, w, top, h, it.segs, rel);
    });

    bodies += `<div class="person-col">${inner}</div>`;
  });
  bodies += `</div>`;

  board.innerHTML = `<div class="grid">
  <div class="left">${left}</div>
  <div class="cols">${heads}${bodies}</div>
</div>`;

  bindCards();
}

function cardHTML(t, p, left, w, top, h, segs, rel) {
  const cls =
    t.type === "vacation" ? "vac" : t.type === "sick" ? "sick" : "task";
  const style =
    cls === "task"
      ? `background:${rgba(p.color, 0.22)};border-color:${p.color};`
      : "";
  const head =
    t.type === "vacation"
      ? "Отпуск"
      : t.type === "sick"
        ? "Больничный"
        : t.number || "Задача";
  const sub = t.title || "";
  // выходные внутри блока: заштриховываем, чтобы было видно, что работа
  // в эти дни не идёт, но карточка остаётся одним блоком.
  // Подряд идущие выходные (сб+вс) рисуем ОДНИМ элементом: у каждого своего
  // элемента фаза градиента начинается заново, и на стыке полосы сбиваются.
  let hatches = "";
  if (segs && rel && !isCalendarTask(t)) {
    const first = segs[0].i,
      last = segs[segs.length - 1].i;
    let runStart = -1;
    for (let i = first; i <= last + 1; i++) {
      const wk = i <= last && isWeekend(addDays(rel.start, i));
      if (wk && runStart < 0) runStart = i;
      if (!wk && runStart >= 0) {
        // позиция внутри карточки: она стоит на 2px ниже строки и имеет
        // рамку 1px, поэтому сдвиг дня = (i - first) * ROW_H - 3
        const top = (runStart - first) * ROW_H - 3;
        const hgt = (i - runStart) * ROW_H;
        hatches += `<span class="c-off" style="top:${top}px;height:${hgt}px"></span>`;
        runStart = -1;
      }
    }
  }
  return `<div class="card ${cls}" data-task="${t.id}"
    style="left:${left}px;width:${w}px;top:${top}px;height:${h}px;${style}">
  ${hatches}
  <div class="c-num">${esc(head)}</div>
  ${sub ? `<div class="c-txt">${esc(sub)}</div>` : ""}
  <div class="c-dur">${taskDur(t)}</div>
</div>`;
}

function bindCards() {
  document.querySelectorAll(".card").forEach((c) => {
    c.addEventListener("click", () => openTask(c.dataset.task));
  });
}

/* ============ рендер целиком ============ */
function render() {
  renderTeam();
  renderTabs();
  renderBoard();
}
