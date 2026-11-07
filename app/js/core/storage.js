import { bindCalendar } from "./calendar.js";
/* ============================================================
   core/storage.js — состояние приложения и его сохранение.

   Данные живут либо на сервере (data/data.json), либо, если сервера
   нет, в localStorage браузера. Оба режима пишутся одинаково —
   через markDirty() с небольшой задержкой.
   ============================================================ */
import { addDays, isWeekend } from "./dates.js";
import { round } from "./util.js";
import { planPerson } from "./plan.js";
import { isAbsence } from "./schedule.js";
import { taskLabels } from "./task-labels.js";

const KEY = "team-planner-v1";

export let state = {
  team: "",
  people: [],
  releases: [],
  tasks: [],
  activeId: null,
  theme: null, // 'light' | 'dark' — переезжает вместе с data.json
};

bindCalendar(() => state.calendar);

export let backend = null; // 'server' | 'browser'

/* данные из браузера, отличающиеся от файла: спросим после отрисовки */
export let pendingLocal = null;

let writeTimer = null;
let saving = false;
let dirtyWhileSaving = false;

/* Запись не удалась. Держим это в памяти, чтобы индикатор не стал
   зелёным просто потому, что сервер ожил, — данные-то всё ещё не
   на диске. */
let pendingFailed = false;

export function valid(data) {
  return (
    data &&
    Array.isArray(data.people) &&
    Array.isArray(data.releases) &&
    Array.isArray(data.tasks)
  );
}

/* Заменить состояние целиком (импорт, восстановление версии, выбор
   браузерной копии). Прямое присваивание импортированной переменной
   в ES-модулях нельзя, поэтому для этого есть отдельная функция. */
export function replaceState(next) {
  state = next;
  return state;
}

export function setPendingLocal(next) {
  pendingLocal = next;
}

/* Статус места хранения в шапке */
export function setStatus(mode, text) {
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

/* Есть ли правки, которые не дошли до диска. По этому признаку сигнал
   вкладки (core/keepalive.js) решает, можно ли вернуть зелёный индикатор:
   сервер может отвечать, но последняя запись так и не прошла. */
export function hasUnsaved() {
  return !!writeTimer || saving || dirtyWhileSaving || pendingFailed;
}

export function markDirty() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(persist, 500);
}

/* Привычный для вызывающего кода синоним: «данные изменились» */
export function save() {
  markDirty();
}

export function persist() {
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

export function persistServer() {
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

export async function initStorage() {
  setStatus("", "проверка…");
  let initial = null;
  let legacy = false;
  let localLegacy = false;
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

  if (initial) {
    legacy = !(initial.version >= 3);
    state = migrateTasks(initial);
  }

  // предупредить, если в файле и в браузере разные данные
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const local = JSON.parse(raw);
      if (valid(local)) {
        localLegacy = !(local.version >= 3);
        // сравниваем уже в одной модели, иначе миграция даст ложное «разные»
        migrateTasks(local);
        if (!initial) {
          state = local; // файла нет — берём из браузера
          legacy = localLegacy;
        } else if (
          ((JSON.stringify(local.tasks) !== JSON.stringify(state.tasks) && local.tasks.length) ||
            JSON.stringify(local.calendar || {}) !== JSON.stringify(state.calendar || {}))
        ) {
          pendingLocal = local; // разные — спросим после отрисовки
        }
      }
    }
  } catch (e) {}

  if (backend === "server") setStatus("server", "Сохранено в data.json");
  else setStatus("browser", "Хранение: в браузере (сервер не найден)");
  return { legacy, localLegacy };
}

/* ============ выборки по данным ============ */

export function activeRelease() {
  return state.releases.find((r) => r.id === state.activeId) || null;
}

export function tasksOf(personId, releaseId) {
  return state.tasks.filter(
    (t) => t.personId === personId && t.releaseId === releaseId,
  );
}

/* массив загрузки по дням релиза — считается один раз на человека.
   Раскладка берётся из очереди (core/plan.js), а не из task.start:
   после удаления задачи даты пересчитываются, и загрузка должна
   совпадать с карточками.
   Отпуск и больничный в загрузку не входят: их дни — это отсутствие,
   а не работа. Иначе задача, «повисшая» через отпуск, давала бы
   двойную загрузку и красную подсветку перегруза на ровном месте. */
export function personLoad(personId, release) {
  const out = [];
  planPerson(personId, release, state.tasks).cards.forEach(({ task, segs }) => {
    if (isAbsence(task)) return;
    segs.forEach((seg) => {
      if (seg.i < 0) return;
      out[seg.i] = round((out[seg.i] || 0) + seg.amount);
    });
  });
  return out;
}

/* ============ миграция старых данных ============
   До п.8 поле days считалось в календарных днях. Пересчитываем в рабочие
   так, чтобы карточка заканчивалась там же, где и раньше: суммируем доли
   только по рабочим дням прежнего периода. Отпуск/больничный остаются
   календарными (weekend = true).

   Затем (п.1+2) фиксируем порядок очереди: задачи каждого человека
   сортируем по прежнему start. Без этого очередь построилась бы по
   порядку создания задач, а он у старых данных случайный.

   Миграция идемпотентна и не смотрит на номер версии: старый код
   безусловно пишет version = 2, поэтому номер может откатиться.
   Повторная сортировка уже пересчитанных данных даёт тот же порядок. */
export function migrateTasks(data) {
  (data.tasks || []).forEach((task) => {
    task.labels = taskLabels(task);
    if (task.daysMode === "work") return; // уже новая модель
    const calendar = task.type === "vacation" || task.type === "sick";
    if (calendar) {
      task.weekend = true;
      task.daysMode = "work";
      return;
    }
    const total = Number(task.days) || 0;
    let workdays = 0;
    for (let i = 0; i < Math.ceil(total); i++) {
      if (!isWeekend(addDays(task.start, i)))
        workdays = round(workdays + Math.min(1, total - i));
    }
    if (workdays > 0) {
      task.days = workdays;
      task.weekend = false;
    } else {
      // задача целиком на выходных — оставляем как календарную
      task.weekend = true;
    }
    task.daysMode = "work";
  });

  sortQueue(data.tasks);
  data.version = 3;
  return data;
}

/* Порядок задач человека — это и есть его очередь (Р4). Сортируем только
   внутри пары «релиз + человек», не меняя общего чередования задач
   разных людей: каждая группа получает обратно свои же позиции. */
function sortQueue(tasks) {
  if (!Array.isArray(tasks)) return;
  const groups = new Map();
  tasks.forEach((task, index) => {
    const key = task.releaseId + "|" + task.personId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  groups.forEach((slots) => {
    const list = slots
      .map((index) => tasks[index])
      .sort((a, b) =>
        String(a.start || "").localeCompare(String(b.start || "")),
      );
    slots.forEach((index, position) => {
      tasks[index] = list[position];
    });
  });
}

