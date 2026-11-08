import { bindCalendar } from "./calendar.js";
import { round } from "./util.js";
import { planPerson } from "./plan.js";
import { isAbsence } from "./schedule.js";
import { createBrowserStore, createHttpStore } from "./split-storage.js";
import {
  defaults,
  validateDocument,
  canonicalJson,
  StorageError,
  STORAGE_KEYS,
} from "./storage-schema.js";
import { workingData, prepareStorageMigration } from "./storage-migration.js";
export { migrateTasks } from "./task-migration.js";

// Потребители работают с привычным state, но локальные свойства не входят
// в JSON доски. Их владельцы — отдельные документы preferences и system.
let preferences = defaults("preferences"),
  system = defaults("system");
function attach(board) {
  for (const [name, target] of [
    ["theme", preferences],
    ["activeId", preferences],
    ["calendar", system],
    ["queueNotice", system],
  ]) {
    Object.defineProperty(board, name, {
      configurable: true,
      enumerable: false,
      get: () => target[name],
      set: (value) => {
        target[name] = value;
      },
    });
  }
  return board;
}
export let state = attach(defaults("data"));
bindCalendar(() => system.calendar);
export let backend = null;
export let readOnly = false;
export let pendingLocal = null;
let store,
  ready = false,
  timer = null,
  saving = null,
  again = false,
  failed = false;
const packets = {},
  blocked = new Set();
const recoveryPrefix = "team-planner-unsaved-v4:";
const recoveryKey =
  recoveryPrefix +
  (globalThis.crypto?.randomUUID?.() || Date.now() + "-" + Math.random());
let offeredKey = null;
export const valid = (v) =>
  !!v && ["people", "releases", "tasks"].every((k) => Array.isArray(v[k]));
export function setPendingLocal(value) {
  pendingLocal = value;
}
export function setServerRevision(revision, data = state) {
  const { theme, activeId, calendar, queueNotice, ...board } = data;
  packets.data = {
    data: prepareStorageMigration({ data: JSON.parse(JSON.stringify(board)) })
      .data,
    revision,
  };
  blocked.delete("data");
}
function ensureActive() {
  if (!state.releases.some((r) => r.id === preferences.activeId))
    preferences.activeId = state.releases[0]?.id ?? null;
}
export function serverRevision() {
  return packets.data?.revision;
}
export function replaceState(next, { selectIncoming = false } = {}) {
  const { theme, activeId, calendar, queueNotice, ...working } = next;
  const board = workingData(working);
  if (!board) throw new StorageError("Нет данных доски");
  if (selectIncoming && Object.hasOwn(next, "activeId"))
    preferences.activeId = next.activeId;
  state = attach(board);
  ensureActive();
  return state;
}
export function setStatus(mode, text) {
  const el = document.getElementById("storeStatus");
  if (!el) return;
  el.className =
    "store " + ({ server: "on", browser: "warn", error: "err" }[mode] || "");
  el.title = text;
  const dot = document.createElement("span");
  dot.className = "sdot";
  const label = document.createElement("span");
  label.className = "store-label";
  label.textContent = text;
  el.replaceChildren(dot, label);
}
function documents() {
  ensureActive();
  return {
    data: validateDocument("data", JSON.parse(JSON.stringify(state))),
    preferences: validateDocument("preferences", structuredClone(preferences)),
    system: validateDocument("system", structuredClone(system)),
  };
}
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
export function hasUnsaved() {
  return !!timer || !!saving || again || failed;
}
function cacheBoard() {
  if (!ready) return;
  try {
    localStorage.setItem(
      recoveryKey,
      JSON.stringify({ data: state, savedAt: Date.now() }),
    );
  } catch {}
}
function clearRecovery() {
  try {
    localStorage.removeItem(recoveryKey);
    if (offeredKey) localStorage.removeItem(offeredKey);
  } catch {}
  offeredKey = null;
}
export function markDirty() {
  if (!ready) return;
  if (readOnly) {
    setStatus(
      "error",
      "Доступно только чтение и экспорт: браузер не поддерживает безопасную запись",
    );
    return;
  }
  if (saving) again = true;
  cacheBoard();
  setStatus("", "Сохранение…");
  clearTimeout(timer);
  timer = setTimeout(persist, 500);
}
export const save = markDirty;
async function writeSystem(next) {
  const base = packets.system;
  const patch = Object.fromEntries(
    ["calendar", "queueNotice"]
      .filter((k) => !equal(next[k], base.data[k]))
      .map((k) => [k, next[k]]),
  );
  if (!Object.keys(patch).length) return base;
  try {
    return await store.patch(patch, base.revision);
  } catch (e) {
    if (e.status !== 409) throw e;
    const fresh = await store.read("system");
    if (Object.keys(patch).some((k) => !equal(fresh.data[k], base.data[k])))
      throw e;
    // Launcher изменил другую секцию: повторяем только непересекающийся patch.
    return store.patch(patch, fresh.revision);
  }
}
export function persist() {
  clearTimeout(timer);
  timer = null;
  if (!ready || readOnly) return Promise.resolve();
  if (saving) {
    again = true;
    return saving;
  }
  let next;
  try {
    next = documents();
  } catch (e) {
    failed = true;
    setStatus("error", e.message);
    return Promise.resolve();
  }
  failed = false;
  const operations = Object.keys(next).map(async (kind) => {
    if (blocked.has(kind)) {
      failed = true;
      setStatus(
        "error",
        "Данные изменились в другой вкладке — обновите страницу",
      );
      return;
    }
    if (equal(next[kind], packets[kind].data ?? defaults(kind))) return;
    try {
      const result =
        kind === "system"
          ? await writeSystem(next[kind])
          : await store.write(kind, next[kind], packets[kind].revision);
      packets[kind] = result;
      if (kind === "system") {
        // Не подменять календарь, изменившийся в памяти за время запроса.
        for (const k of Object.keys(result.data))
          if (!["calendar", "queueNotice"].includes(k))
            system[k] = result.data[k];
      }
    } catch (e) {
      failed = true;
      if (e.status === 409) blocked.add(kind);
      setStatus(
        "error",
        e.status === 409
          ? "Данные изменились в другой вкладке — обновите страницу"
          : e.message,
      );
    }
  });
  saving = Promise.all(operations)
    .then(() => {
      if (!failed) {
        clearRecovery();
        setStatus(
          backend,
          backend === "server" ? "Сохранено" : "Хранение: в браузере",
        );
      } else cacheBoard();
    })
    .finally(() => {
      saving = null;
      if (again) {
        again = false;
        return persist();
      }
    });
  return saving;
}
export const persistServer = persist;
function flush() {
  if (!hasUnsaved() || !ready || readOnly) return;
  cacheBoard();
  // Уже отправленные keepalive-запросы не дублируем со старой ревизией.
  if (saving) return;
  if (backend === "server") {
    const next = documents();
    for (const kind of Object.keys(next)) {
      if (
        blocked.has(kind) ||
        equal(next[kind], packets[kind].data ?? defaults(kind))
      )
        continue;
      const body =
        kind === "system"
          ? {
              patch: Object.fromEntries(
                ["calendar", "queueNotice"]
                  .filter((k) => !equal(next.system[k], packets.system.data[k]))
                  .map((k) => [k, next.system[k]]),
              ),
              baseRevision: packets.system.revision,
            }
          : { data: next[kind], baseRevision: packets[kind].revision };
      try {
        navigator.sendBeacon(
          "/api/" + kind,
          new Blob([JSON.stringify(body)], { type: "application/json" }),
        );
      } catch {}
    }
  } else void persist();
}
window.addEventListener("pagehide", flush);

export async function initStorage() {
  ready = false;
  readOnly = false;
  pendingLocal = null;
  offeredKey = null;
  blocked.clear();
  setStatus("", "Загрузка данных…");
  // Только file:// либо явный 404 означают браузерный режим. Ошибка
  // работающего API или сети не должна открывать пустую локальную доску.
  if (globalThis.location?.protocol === "file:") backend = "browser";
  else {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (response.status === 404) backend = "browser";
    else {
      if (!response.ok)
        throw new StorageError("Сервер недоступен. Перезапустите планировщик.");
      const health = await response.json();
      if (health.storageVersion !== 4)
        throw new StorageError(
          "Сервер работает со старым кодом. Закройте планировщик и запустите снова.",
        );
      backend = "server";
    }
  }
  store = backend === "server" ? createHttpStore() : createBrowserStore();
  if (backend === "browser") {
    try {
      await store.migrate();
    } catch (e) {
      if (e.code === "READ_ONLY") readOnly = true;
      else throw e;
    }
  }
  for (const kind of ["data", "preferences", "system"])
    packets[kind] = await store.read(kind);
  if (readOnly) {
    const parse = (key) => {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    };
    const preview = prepareStorageMigration({
      data: parse(STORAGE_KEYS.data) ?? parse("team-planner-v1"),
      preferences: parse(STORAGE_KEYS.preferences),
      system: parse(STORAGE_KEYS.system),
      theme: localStorage.getItem("team-planner-theme"),
    });
    for (const kind of Object.keys(preview)) packets[kind].data = preview[kind];
  }
  preferences = structuredClone(packets.preferences.data);
  system = structuredClone(packets.system.data);
  state = attach(structuredClone(packets.data.data ?? defaults("data")));
  ensureActive();
  // Несохранённые правки имеют отдельные ключи для каждой вкладки.
  const candidates = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(recoveryPrefix)) candidates.push(key);
    }
  } catch {
    /* серверное хранение не зависит от доступности локального кэша */
  }
  if (backend === "server") candidates.push(STORAGE_KEYS.data);
  candidates.push("team-planner-v1");
  for (const key of candidates) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch {
      continue;
    }
    if (raw === null) continue;
    const parsed = JSON.parse(raw);
    const local = prepareStorageMigration({
      data: key.startsWith(recoveryPrefix) ? parsed.data : parsed,
    }).data;
    if (local && !equal(local, state)) {
      pendingLocal = local;
      offeredKey = key;
      break;
    }
    if (key.startsWith(recoveryPrefix) && !readOnly) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  }
  ready = true;
  setStatus(
    backend,
    readOnly
      ? "Только чтение и экспорт: нет Web Locks / Web Crypto"
      : backend === "server"
        ? "Сохранено"
        : "Хранение: в браузере",
  );
  if (!equal(preferences, packets.preferences.data)) save();
  return { legacy: false, localLegacy: false };
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
