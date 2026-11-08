// Подготовка перехода без I/O и без изменения переданных исходников.
import {
  defaults,
  validateDocument,
  copyDocument,
  StorageError,
} from "./storage-schema.js";
import { migrateTasks } from "./task-migration.js";

const own = (v, k) => v != null && Object.hasOwn(v, k);
const pick = (v, names) =>
  Object.fromEntries(
    names.filter((k) => own(v, k) && v[k] !== undefined).map((k) => [k, v[k]]),
  );
const taskFields = [
  "id",
  "releaseId",
  "personId",
  "start",
  "days",
  "type",
  "number",
  "title",
  "status",
  "link",
  "labels",
  "weekend",
  "daysMode",
  "exchangeId",
];
function task(v, snapshot = false) {
  const result = pick(
    v,
    snapshot
      ? taskFields.filter((k) => !["releaseId", "exchangeId"].includes(k))
      : taskFields,
  );
  for (const key of ["number", "title", "status", "link"])
    if (result[key] == null) result[key] = "";
  if (!own(v, "type")) result.type = "task";
  if (!own(v, "weekend")) result.weekend = result.type !== "task";
  if (!own(v, "labels")) result.labels = [];
  // Не пропускать повреждённые известные поля через старую нормализацию.
  if (
    !Number.isFinite(result.days) ||
    result.days <= 0 ||
    (result.daysMode !== "work" && result.days > 100000) ||
    typeof result.start !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(result.start) ||
    !Number.isFinite(Date.parse(result.start + "T00:00:00Z")) ||
    new Date(result.start + "T00:00:00Z").toISOString().slice(0, 10) !==
      result.start
  )
    throw new StorageError(`Неверные дата/длительность задачи ${result.id}`);
  if (
    own(v, "labels") &&
    (!Array.isArray(v.labels) ||
      v.labels.some((label) => !["FE", "BE"].includes(label)))
  )
    throw new StorageError(`Неверные метки задачи ${result.id}`);
  if (own(v, "daysMode") && v.daysMode !== "work")
    throw new StorageError(
      `Неизвестная модель длительности задачи ${result.id}`,
    );
  return result;
}
function snapshot(v) {
  return {
    release: pick(v.release, ["number", "start", "end"]),
    tasks: v.tasks.map((v) => task(v, true)),
  };
}
function release(v) {
  const result = pick(v, ["id", "number", "start", "end"]);
  if (own(v, "exchange")) {
    const ex = v.exchange;
    result.exchange = pick(ex, ["origin", "parents", "received", "lastImport"]);
    result.exchange.people = ex.people.map((v) => pick(v, ["local", "remote"]));
    if (own(ex, "base")) result.exchange.base = snapshot(ex.base);
    if (own(ex, "sent"))
      result.exchange.sent = ex.sent.map((v) => ({
        transferId: v.transferId,
        snapshot: snapshot(v.snapshot),
      }));
  }
  return result;
}

// Явный контракт обмена, включая вложенные снимки, без локального окружения.
export function workingData(source) {
  if (
    !source ||
    !["people", "releases", "tasks"].every((k) => Array.isArray(source[k]))
  )
    throw new StorageError("Неверная структура доски");
  if (own(source, "version") && ![1, 2, 3, 4].includes(source.version))
    throw new StorageError(
      "Неподдерживаемая версия доски",
      "UNSUPPORTED_VERSION",
    );
  const board = copyDocument({
    version: source.version ?? 1,
    team: own(source, "team") ? source.team : "",
    people: source.people.map((v) => pick(v, ["id", "name", "color"])),
    releases: source.releases.map(release),
    tasks: source.tasks.map((v) => task(v)),
  });
  migrateTasks(board);
  board.version = 4;
  return validateDocument("data", board);
}

export function prepareStorageMigration({
  data = null,
  preferences = null,
  system = null,
  launcher = null,
  theme = null,
} = {}) {
  // Копия одновременно отклоняет значения вне JSON, а не молча заменяет их.
  const source = data === null ? null : copyDocument(data);
  let board = null;
  if (source !== null) {
    if (source.version === 4) board = validateDocument("data", source);
    else {
      if (own(source, "version") && ![1, 2, 3].includes(source.version))
        throw new StorageError(
          `Неподдерживаемая версия доски: ${source.version}`,
          "UNSUPPORTED_VERSION",
        );
      if (
        !["people", "releases", "tasks"].every((k) => Array.isArray(source[k]))
      )
        throw new StorageError("Неверная структура старой доски");
      board = {
        version: source.version ?? 1,
        team: own(source, "team") ? source.team : "",
        people: source.people.map((v) => pick(v, ["id", "name", "color"])),
        releases: source.releases.map(release),
        tasks: source.tasks.map((v) => task(v)),
      };
      migrateTasks(board);
      board.version = 4;
      validateDocument("data", board);
    }
  }
  const pref = {
    ...defaults("preferences"),
    ...copyDocument(preferences ?? {}),
  };
  if (!own(preferences, "theme"))
    pref.theme = ["light", "dark"].includes(source?.theme)
      ? source.theme
      : ["light", "dark"].includes(theme)
        ? theme
        : "light";
  if (!own(preferences, "activeId")) pref.activeId = source?.activeId ?? null;
  // Невалидное известное поле не скрывается выбором первого релиза.
  validateDocument("preferences", pref);
  if (!board?.releases.some((v) => v.id === pref.activeId))
    pref.activeId = board?.releases[0]?.id ?? null;
  const sys = { ...defaults("system"), ...copyDocument(system ?? {}) };
  if (!own(system, "calendar") && own(source, "calendar"))
    sys.calendar = source.calendar;
  if (!own(system, "queueNotice") && own(source, "queueNotice"))
    sys.queueNotice = source.queueNotice;
  sys.launcher = {
    ...defaults("system").launcher,
    ...copyDocument(launcher ?? {}),
    ...copyDocument(system?.launcher ?? {}),
  };
  sys.migrations = {
    splitStorage: 0,
    ...copyDocument(system?.migrations ?? {}),
  };
  validateDocument("system", sys);
  validateDocument("preferences", pref);
  return { data: board, preferences: pref, system: sys };
}
