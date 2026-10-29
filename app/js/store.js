/* ============================================================
   store.js — состояние, сохранение и загрузка данных
   ============================================================ */
/* ============ состояние и хранение ============ */
const KEY = "team-planner-v1";
let state = { team: "", people: [], releases: [], tasks: [], activeId: null };
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
  const cls =
    mode === "server"
      ? "on"
      : mode === "browser"
        ? "warn"
        : mode === "error"
          ? "err"
          : "";
  el.className = "store " + cls;
  el.innerHTML = '<span class="sdot"></span>' + text;
}

/* Запись не удалась. Держим это в памяти, чтобы индикатор не стал зелёным
   просто потому, что сервер ожил, — данные-то всё ещё не на диске. */
let pendingFailed = false;

/* Есть ли правки, которые не дошли до диска. По этому признаку сигнал
   вкладки (keepalive.js) решает, можно ли вернуть зелёный индикатор:
   сервер может отвечать, но последняя запись так и не прошла. */
function hasUnsaved() {
  return !!writeTimer || saving || dirtyWhileSaving || pendingFailed;
}

function markDirty() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(persist, 500);
}

function persist() {
  if (backend === "server") persistServer();
  else if (backend === "browser") persistBrowser();
}

/* Сохранить немедленно — вызывается при закрытии вкладки, чтобы
   последнее изменение (те самые 0.5 сек задержки) не потерялось. */
function flushBeacon() {
  if (!writeTimer) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  if (backend === "browser") {
    persistBrowser();
    return;
  }
  if (backend !== "server") return;
  try {
    navigator.sendBeacon(
      "/api/data",
      new Blob([JSON.stringify(state)], { type: "application/json" }),
    );
  } catch (e) {}
}

window.addEventListener("pagehide", flushBeacon);

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
      pendingFailed = false;
      setStatus("server", "Сохранено в data.json");
      dropBrowserCopy();
    })
    .catch(() => {
      // на диск не легло — хотя бы не теряем правки при перезагрузке вкладки:
      // при следующем старте приложение предложит взять их из браузера
      pendingFailed = true;
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {}
      setStatus("error", "Нет подключения — данные не сохранены");
    })
    .finally(() => {
      saving = false;
      if (dirtyWhileSaving) {
        dirtyWhileSaving = false;
        persistServer();
      }
    });
}

/* Когда данные легли на диск, браузерная копия больше не нужна: иначе при
   старте приложение будет каждый раз спрашивать «данные разные». */
function dropBrowserCopy() {
  if (backend !== "server") return;
  try {
    localStorage.removeItem(KEY);
  } catch (e) {}
}

function persistBrowser() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    setStatus("browser", "Хранение: в браузере (сервер не найден)");
  } catch (e) {
    setStatus("error", "Не удалось сохранить в браузере");
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

  if (initial) state = migrateTasks(initial);

  // предупредить, если в файле и в браузере разные данные
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const local = JSON.parse(raw);
      if (valid(local)) {
        // сравниваем уже в одной модели, иначе миграция даст ложное «разные»
        migrateTasks(local);
        if (!initial) {
          state = local; // файла нет — берём из браузера
        } else if (
          JSON.stringify(local.tasks) !== JSON.stringify(state.tasks) &&
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
/* загрузка дня: сумма долей задач, попавших на этот день */
function loadAt(personId, rel, dayIdx) {
  let sum = 0;
  tasksOf(personId, rel.id).forEach((t) => {
    taskLayout(t, rel.start).forEach((seg) => {
      if (seg.i === dayIdx) sum += seg.amount;
    });
  });
  return sum;
}

/* --- миграция старых данных ---
   До п.8 поле days считалось в календарных днях. Пересчитываем в рабочие
   так, чтобы карточка заканчивалась там же, где и раньше: суммируем доли
   только по рабочим дням прежнего периода. Отпуск/больничный остаются
   календарными (weekend = true). */
function migrateTasks(s) {
  (s.tasks || []).forEach((t) => {
    if (t.daysMode === "work") return; // уже новая модель
    const cal = t.type === "vacation" || t.type === "sick";
    if (cal) {
      t.weekend = true;
      t.daysMode = "work";
      return;
    }
    const D = Number(t.days) || 0;
    let wd = 0;
    for (let i = 0; i < Math.ceil(D); i++) {
      if (isWorkday(addDays(t.start, i))) wd = round(wd + Math.min(1, D - i));
    }
    if (wd > 0) {
      t.days = wd;
      t.weekend = false;
    } else {
      // задача целиком на выходных — оставляем как календарную
      t.weekend = true;
    }
    t.daysMode = "work";
  });
  s.version = 2;
  return s;
}
/* перевести уже загруженные локальные данные в новую модель */
function migrateState() {
  return migrateTasks(state);
}
