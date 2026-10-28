/* ============================================================
   store.js — состояние, сохранение и загрузка данных
   ============================================================ */
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
