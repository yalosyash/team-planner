/* ============ константы и утилиты ============ */
const ROW_H = 46,
  COL_W = 190;
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const PALETTE = [
  "#9db8f5",
  "#b3a3f0",
  "#8fcfd4",
  "#f0b58f",
  "#a8dcb5",
  "#e0a8d8",
  "#e8d488",
  "#a3d8cf",
  "#c2c8d4",
  "#e8a3a3",
  "#8fc0f0",
  "#d8b0f0",
];
const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);

function iso(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}
function todayISO() {
  return iso(new Date());
}
function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
function diffDays(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}
function fmt(s) {
  const d = parseISO(s);
  return (
    String(d.getDate()).padStart(2, "0") +
    "." +
    String(d.getMonth() + 1).padStart(2, "0")
  );
}
function eachDay(a, b) {
  const out = [];
  let n = diffDays(a, b);
  for (let i = 0; i <= n; i++) out.push(addDays(a, i));
  return out;
}
function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}
function round(n) {
  return Math.round(n * 100) / 100;
}
function fmtDur(n) {
  return round(n) + " дн";
}
function rgba(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 1900);
}

/* ============ состояние и хранение ============ */
const KEY = "team-planner-v1";
let state = { people: [], releases: [], tasks: [], activeId: null };
let backend = null; // 'server' | 'browser'
let writeTimer = null;
let saving = false,
  dirtyWhileSaving = false;

function valid(s) {
  return (
    s &&
    Array.isArray(s.people) &&
    Array.isArray(s.releases) &&
    Array.isArray(s.tasks)
  );
}

/* Статус места хранения в шапке */
function setStatus(mode, text) {
  const el = document.getElementById("storeStatus");
  if (!el) return;
  el.className =
    "store " + (mode === "server" ? "on" : mode === "browser" ? "off" : "");
  el.innerHTML = '<span class="sdot"></span>' + text;
}

function markDirty() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(persist, 500);
}

function persist() {
  if (backend === "server") persistServer();
  else if (backend === "browser") persistBrowser();
}

function persistServer() {
  if (saving) {
    dirtyWhileSaving = true;
    return;
  }
  saving = true;
  fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(r)))
    .then(() => {
      setStatus("server", "Сохранено в data.json");
    })
    .catch(() => {
      setStatus("", "Не удалось сохранить — проверьте, запущен ли сервер");
    })
    .finally(() => {
      saving = false;
      if (dirtyWhileSaving) {
        dirtyWhileSaving = false;
        persistServer();
      }
    });
}

function persistBrowser() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    setStatus("browser", "Хранение: в браузере (сервер не найден)");
  } catch (e) {
    setStatus("", "Не удалось сохранить в браузере");
  }
}

async function initStorage() {
  setStatus("", "проверка…");
  let initial = null;
  try {
    const r = await fetch("/api/data", { cache: "no-store" });
    if (r.ok) {
      backend = "server";
      const j = await r.json();
      initial = valid(j.data) ? j.data : null;
    }
  } catch (e) {
    backend = null;
  }

  if (!backend) {
    // сервер недоступен — работаем локально
    backend = "browser";
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (valid(s)) initial = s;
      }
    } catch (e) {}
  }

  if (initial) state = initial;

  // предупредить, если в файле и в браузере разные данные
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const local = JSON.parse(raw);
      if (valid(local)) {
        if (!initial) {
          state = local; // файла нет — берём из браузера
        } else if (
          JSON.stringify(local.tasks) !== JSON.stringify(initial.tasks) &&
          local.tasks.length
        ) {
          pendingLocal = local; // разные — спросим после отрисовки
        }
      }
    }
  } catch (e) {}

  if (backend === "server") setStatus("server", "Сохранено в data.json");
  else setStatus("browser", "Хранение: в браузере (сервер не найден)");
}

let pendingLocal = null;

function activeRelease() {
  return state.releases.find((r) => r.id === state.activeId) || null;
}
function save() {
  markDirty();
}
function tasksOf(personId, releaseId) {
  return state.tasks.filter(
    (t) => t.personId === personId && t.releaseId === releaseId,
  );
}
function loadAt(personId, rel, dayIdx) {
  let sum = 0;
  tasksOf(personId, rel.id).forEach((t) => {
    const s = diffDays(rel.start, t.start),
      e = s + t.days;
    const ov = Math.max(0, Math.min(e, dayIdx + 1) - Math.max(s, dayIdx));
    sum += ov;
  });
  return sum;
}

/* ============ вкладки релизов ============ */
function renderTabs() {
  const el = $("#tabs");
  let h = "";
  state.releases.forEach((r) => {
    const active = r.id === state.activeId ? " active" : "";
    h += `<div class="tab${active}" data-rel="${r.id}">
    <span class="tnum">Релиз ${esc(r.number || "—")}</span>
    <span class="tdate">${fmt(r.start)} – ${fmt(r.end)}</span>
    <span class="edit" data-edit="${r.id}" title="Изменить">✎</span>
    <span class="x" data-del="${r.id}" title="Удалить">✕</span>
  </div>`;
  });
  h += `<div class="addtab" id="addRelease" title="Новый релиз">+ Релиз</div>`;
  el.innerHTML = h;

  el.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      if (e.target.dataset.del) {
        e.stopPropagation();
        deleteRelease(e.target.dataset.del);
        return;
      }
      if (e.target.dataset.edit) {
        e.stopPropagation();
        openRelease(e.target.dataset.edit);
        return;
      }
      state.activeId = tab.dataset.rel;
      save();
      render();
    });
  });
  $("#addRelease").addEventListener("click", () => openRelease(null));
}

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

/* ============ модалки ============ */
function openModal(sel) {
  $(sel).classList.add("open");
}
function closeModal(sel) {
  $(sel).classList.remove("open");
}
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", (e) => {
    e.target.closest(".modal-back").classList.remove("open");
  }),
);
document.querySelectorAll(".modal-back").forEach((mb) =>
  mb.addEventListener("mousedown", (e) => {
    if (e.target === mb) mb.classList.remove("open");
  }),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape")
    document
      .querySelectorAll(".modal-back.open")
      .forEach((m) => m.classList.remove("open"));
});

/* --- релиз --- */
let editingRel = null;
function openRelease(id) {
  editingRel = id;
  const rel = id ? state.releases.find((r) => r.id === id) : null;
  $("#relTitle").textContent = rel ? "Редактирование релиза" : "Новый релиз";
  $("#rNum").value = rel ? rel.number : nextRelNum();
  const st = rel ? rel.start : todayISO();
  $("#rStart").value = st;
  $("#rEnd").value = rel ? rel.end : addDays(st, 9);
  $("#rErr").textContent = "";
  $("#rDelete").style.display = rel ? "" : "none";
  openModal("#mRelease");
  setTimeout(() => $("#rNum").focus(), 50);
}
function nextRelNum() {
  if (!state.releases.length) return "1.0";
  return "1." + state.releases.length;
}
$("#rSave").addEventListener("click", () => {
  const num = $("#rNum").value.trim();
  const a = $("#rStart").value,
    b = $("#rEnd").value;
  if (!num) {
    $("#rErr").textContent = "Укажите номер релиза";
    return;
  }
  if (!a || !b) {
    $("#rErr").textContent = "Укажите обе даты";
    return;
  }
  if (diffDays(a, b) < 0) {
    $("#rErr").textContent = "Дата окончания раньше даты начала";
    return;
  }
  if (diffDays(a, b) > 366) {
    $("#rErr").textContent = "Слишком длинный период (макс. 366 дней)";
    return;
  }
  if (editingRel) {
    const rel = state.releases.find((r) => r.id === editingRel);
    rel.number = num;
    rel.start = a;
    rel.end = b;
    toast("Релиз обновлён");
  } else {
    const rel = { id: uid(), number: num, start: a, end: b };
    state.releases.push(rel);
    state.activeId = rel.id;
    toast("Релиз создан");
  }
  save();
  render();
  closeModal("#mRelease");
});
$("#rDelete").addEventListener("click", () => deleteRelease(editingRel, true));

function deleteRelease(id, fromModal) {
  const rel = state.releases.find((r) => r.id === id);
  if (!rel) return;
  if (!confirm(`Удалить релиз ${rel.number} и все его задачи?`)) return;
  state.releases = state.releases.filter((r) => r.id !== id);
  state.tasks = state.tasks.filter((t) => t.releaseId !== id);
  if (state.activeId === id)
    state.activeId = state.releases.length
      ? state.releases[state.releases.length - 1].id
      : null;
  save();
  render();
  if (fromModal) closeModal("#mRelease");
  toast("Релиз удалён");
}

/* --- задача --- */
let editingTask = null;
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
  $("#tStart").value = t ? t.start : rel.start;
  $("#tDays").value = t ? t.days : 1;
  $("#tType").value = t ? t.type || "task" : "task";
  $("#tNum").value = t ? t.number || "" : "";
  $("#tDesc").value = t ? t.title || "" : "";
  $("#tErr").textContent = "";
  $("#tDelete").style.display = t ? "" : "none";
  $("#tSave").textContent = t ? "Подтвердить" : "Добавить";
  openModal("#mTask");
  setTimeout(() => $("#tDays").focus(), 50);
}
$("#tSave").addEventListener("click", () => {
  const rel = activeRelease();
  const personId = $("#tPerson").value;
  const start = $("#tStart").value;
  const days = parseFloat($("#tDays").value);
  const type = $("#tType").value;
  const number = $("#tNum").value.trim();
  const title = $("#tDesc").value.trim();
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
  if (
    diffDays(start, addDays(rel.start, 0)) >= 0 &&
    diffDays(rel.start, start) + days > diffDays(rel.start, rel.end) + 1
  ) {
    err.textContent = "Задача выходит за границы релиза";
    return;
  }
  if (editingTask) {
    const t = state.tasks.find((x) => x.id === editingTask);
    Object.assign(t, { personId, start, days, type, number, title });
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

/* --- сотрудники --- */
function openPeople() {
  renderPeople();
  openModal("#mPeople");
}
function renderPeople() {
  const box = $("#plist");
  if (!state.people.length) {
    box.innerHTML = `<div class="hint">Пока нет сотрудников.</div>`;
    return;
  }
  box.innerHTML = state.people
    .map(
      (p) => `<div class="prow" data-id="${p.id}">
  <input type="color" value="${p.color}" data-c>
  <input type="text" value="${esc(p.name)}" data-n placeholder="Имя">
  <button class="ghost" data-x title="Удалить">✕</button>
</div>`,
    )
    .join("");
  box.querySelectorAll(".prow").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector("[data-n]").addEventListener("input", (e) => {
      const p = state.people.find((x) => x.id === id);
      p.name = e.target.value;
      save();
      renderTabs(); // шапка обновится при закрытии
    });
    row.querySelector("[data-c]").addEventListener("input", (e) => {
      const p = state.people.find((x) => x.id === id);
      p.color = e.target.value;
      save();
      render();
    });
    row.querySelector("[data-x]").addEventListener("click", () => {
      const p = state.people.find((x) => x.id === id);
      const cnt = state.tasks.filter((t) => t.personId === id).length;
      if (
        cnt &&
        !confirm(
          `У ${p.name} есть ${cnt} задач(и). Удалить сотрудника и его задачи?`,
        )
      )
        return;
      state.people = state.people.filter((x) => x.id !== id);
      state.tasks = state.tasks.filter((t) => t.personId !== id);
      save();
      renderPeople();
      render();
    });
  });
}
$("#pAdd").addEventListener("click", () => {
  const color = PALETTE[state.people.length % PALETTE.length];
  const p = { id: uid(), name: "Новый сотрудник", color };
  state.people.push(p);
  save();
  renderPeople();
  render();
  setTimeout(() => {
    const inp = document.querySelector(`.prow[data-id="${p.id}"] [data-n]`);
    if (inp) {
      inp.focus();
      inp.select();
    }
  }, 30);
});
$("#mPeople").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) render();
});

/* ============ экспорт / импорт ============ */
$("#btnExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "team-planner-" + todayISO() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Файл сохранён");
});
$("#btnImport").addEventListener("click", () => $("#fileImport").click());
$("#fileImport").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!s.people || !s.releases || !s.tasks) throw 0;
      state = s;
      if (!state.activeId && state.releases[0])
        state.activeId = state.releases[0].id;
      save();
      render();
      toast("Данные загружены");
    } catch (err) {
      alert("Не удалось прочитать файл");
    }
  };
  r.readAsText(f);
  e.target.value = "";
});

/* ============ версии (автобэкапы) ============ */
$("#btnBackups").addEventListener("click", openBackups);

async function openBackups() {
  openModal("#mBackups");
  const hint = $("#bkHint"),
    list = $("#bklist");
  list.innerHTML = "";
  if (backend !== "server") {
    hint.textContent =
      "Версии доступны только при запуске через start.bat (сервер не найден).";
    return;
  }
  hint.textContent = "Загрузка…";
  try {
    const r = await fetch("/api/backups", { cache: "no-store" });
    const { backups } = await r.json();
    if (!backups.length) {
      hint.textContent =
        "Версий пока нет. Они создаются при изменениях и при каждом запуске.";
      return;
    }
    hint.textContent =
      "Нажмите «Восстановить» — данные файла вернутся к выбранной версии.";
    list.innerHTML = backups
      .map(
        (b, i) => `
    <div class="bkrow">
      <span class="bk-when">${b.at}</span>
      <span class="bk-meta">${i === 0 ? "самый свежий снимок" : "снимок"} · ${(b.size / 1024).toFixed(1)} КБ</span>
      <button data-restore="${b.name}">Восстановить</button>
    </div>`,
      )
      .join("");
    list.querySelectorAll("[data-restore]").forEach((btn) => {
      btn.addEventListener("click", () => restoreBackup(btn.dataset.restore));
    });
  } catch (e) {
    hint.textContent = "Не удалось получить список версий.";
  }
}

async function restoreBackup(name) {
  if (
    !confirm(
      "Восстановить данные из этой версии? Текущее состояние тоже будет сохранено в backups.",
    )
  )
    return;
  try {
    const r = await fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    state = j.data;
    if (state.releases.length && !state.activeId)
      state.activeId = state.releases[0].id;
    render();
    toast("Данные восстановлены");
    closeModal("#mBackups");
  } catch (e) {
    alert("Не удалось восстановить: " + e.message);
  }
}

/* кнопки верхней панели */
$("#btnPeople").addEventListener("click", openPeople);
$("#btnAddTask").addEventListener("click", () => openTask(null));

/* ============ демо ============ */
function loadDemo() {
  const st = todayISO();
  const names = [
    "Женя Л.",
    "Никита",
    "Даниил",
    "Влад",
    "Женя Ш.",
    "Юра",
    "Захар",
    "Оля",
  ];
  state.people = names.map((n, i) => ({
    id: uid(),
    name: n,
    color: PALETTE[i % PALETTE.length],
  }));
  const rel = {
    id: uid(),
    number: "3.14",
    start: st,
    end: addDays(st, 9),
  };
  state.releases = [rel];
  state.activeId = rel.id;
  const P = state.people;
  state.tasks = [
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[0].id,
      start: addDays(st, 0),
      days: 2,
      type: "task",
      number: "SPEKTR-9523",
      title: "Логику создания снэпшота при публикации",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[0].id,
      start: addDays(st, 3),
      days: 4,
      type: "task",
      number: "SPEKTR-10725",
      title: "Переход на общее окно для WS-V3",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[1].id,
      start: addDays(st, 0),
      days: 3,
      type: "task",
      number: "SPEKTR-9712",
      title: "Фильтрация и сортировка в корзине",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[1].id,
      start: addDays(st, 3),
      days: 1,
      type: "task",
      number: "SPEKTR-10021",
      title: "Инструмент управления настройками",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[1].id,
      start: addDays(st, 6),
      days: 1.5,
      type: "task",
      number: "SPEKTR-10652",
      title: "Адаптивная вёрстка",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[2].id,
      start: addDays(st, 0),
      days: 1,
      type: "task",
      number: "SPEKTR-9882",
      title: "Дополнить блок технических данных",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[2].id,
      start: addDays(st, 4),
      days: 3,
      type: "task",
      number: "SPEKTR-10071",
      title: "Контекстный доступ к ширифтам",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[3].id,
      start: addDays(st, 0),
      days: 5,
      type: "vacation",
      title: "",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[4].id,
      start: addDays(st, 0),
      days: 5,
      type: "task",
      number: "SPEKTR-9218",
      title: "Перенести элементы на следующую строку",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[4].id,
      start: addDays(st, 5),
      days: 1,
      type: "task",
      number: "SPEKTR-9675",
      title: "Проверка выхода за края",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[4].id,
      start: addDays(st, 6),
      days: 1.5,
      type: "task",
      number: "SPEKTR-10173",
      title: "Переход на единый редактор",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[5].id,
      start: addDays(st, 0),
      days: 4,
      type: "task",
      number: "SPEKTR-9381",
      title: "Доработать определение навигации ширифтов",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[5].id,
      start: addDays(st, 4),
      days: 3,
      type: "task",
      number: "SPEKTR-9382",
      title: "Доработать определение навигации ширифтов",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[6].id,
      start: addDays(st, 0),
      days: 2.5,
      type: "task",
      number: "SPEKTR-9870",
      title: "Поиск команды на вкладке Команды в ЛК",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[6].id,
      start: addDays(st, 7),
      days: 3,
      type: "vacation",
      title: "",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[7].id,
      start: addDays(st, 0),
      days: 1,
      type: "task",
      number: "SPEKTR-10957",
      title: "Починить русский сеансовый PROD",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[7].id,
      start: addDays(st, 0),
      days: 1,
      type: "task",
      number: "SPEKTR-10158",
      title: "Включить сеансовый PROD",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[7].id,
      start: addDays(st, 2),
      days: 5,
      type: "task",
      number: "SPEKTR-10170",
      title: "Оптимизация взаимодействия с vectorNetwork",
    },
  ];
  save();
  render();
  toast("Демо-данные загружены");
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
