/* ============================================================
   board.js — отрисовка доски и перетаскивание карточек
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

  /* левая колонка с датами */
  let left = `<div class="corner">Даты</div><div class="dates">`;
  days.forEach((d, i) => {
    const wk = [0, 6].includes(parseISO(d).getDay()) ? " wk" : "";
    left += `<div class="date-cell${wk}"><span class="dnum">${i + 1}</span><span class="ddate">${fmt(d)}, ${WD[parseISO(d).getDay()]}</span></div>`;
  });
  left += `</div>`;

  /* шапка с людьми */
  let heads = `<div class="heads">`;
  state.people.forEach((p) => {
    const total = tasksOf(p.id, rel.id).reduce((a, t) => a + t.days, 0);
    heads += `<div class="head" style="border-top:3px solid ${p.color}">
    <div class="pname">${esc(p.name || "Без имени")}</div>
    <div class="psum">Σ ${fmtDur(total)}</div></div>`;
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
        inner += `<div class="over" style="top:${i * ROW_H}px;height:${ROW_H}px" title="Перегрузка: ${round(load)} дн в этот день"></div>`;
    });

    // дорожки для пересекающихся задач
    const items = tasksOf(p.id, rel.id)
      .map((t) => {
        const s = diffDays(rel.start, t.start);
        return { t, s, e: s + t.days };
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
      inner += cardHTML(it.t, p, left, w, top, h);
    });

    bodies += `<div class="person-col" data-person="${p.id}">${inner}</div>`;
  });
  bodies += `</div>`;

  board.innerHTML = `<div class="grid">
  <div class="left">${left}</div>
  <div class="cols">${heads}${bodies}</div>
</div>`;

  bindCards();
  bindDrop();
}

function cardHTML(t, p, left, w, top, h) {
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
  const sub = t.type === "task" ? t.title || "" : t.title || "";
  return `<div class="card ${cls}" data-task="${t.id}" draggable="true"
    style="left:${left}px;width:${w}px;top:${top}px;height:${h}px;${style}">
  <div class="c-num">${esc(head)}</div>
  ${sub ? `<div class="c-txt">${esc(sub)}</div>` : ""}
  <div class="c-dur">${fmtDur(t.days)}</div>
</div>`;
}

function bindCards() {
  document.querySelectorAll(".card").forEach((c) => {
    c.addEventListener("click", (e) => {
      if (c._moved) {
        c._moved = false;
        return;
      }
      openTask(c.dataset.task);
    });
    c.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", c.dataset.task);
      e.dataTransfer.effectAllowed = "move";
      c.classList.add("dragging");
      document
        .querySelectorAll(".person-col")
        .forEach((pc) => pc.classList.add("drop"));
    });
    c.addEventListener("dragend", () => {
      c.classList.remove("dragging");
      document
        .querySelectorAll(".person-col")
        .forEach((pc) => pc.classList.remove("drop"));
    });
  });
}

function bindDrop() {
  const rel = activeRelease();
  if (!rel) return;
  const days = eachDay(rel.start, rel.end);
  document.querySelectorAll(".person-col").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      if (!id) return;
      const t = state.tasks.find((x) => x.id === id);
      if (!t) return;
      const rect = col.getBoundingClientRect();
      let idx = Math.floor((e.clientY - rect.top) / ROW_H);
      idx = Math.max(0, Math.min(days.length - 1, idx));
      const newStart = addDays(rel.start, idx);
      const endIdx = diffDays(rel.start, newStart) + t.days;
      if (endIdx > days.length) {
        toast("Не влезает в границы релиза");
        return;
      }
      t.personId = col.dataset.person;
      t.start = newStart;
      save();
      render();
    });
  });
}

/* ============ рендер целиком ============ */
function render() {
  renderTabs();
  renderBoard();
}
