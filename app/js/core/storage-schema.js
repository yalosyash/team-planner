// Общий контракт для файлового и браузерного хранилища. Без побочных эффектов.
import { validYear } from "./calendar.js";
import { normalizeLink } from "./util.js";
import { assertDuration } from "./planning-contract.js";
import { repackAll } from "./plan.js";

export class StorageError extends Error {
  constructor(message, code = "INVALID_DOCUMENT", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const STORAGE_KEYS = Object.freeze({
  data: "team-planner-data-v4",
  preferences: "team-planner-preferences-v1",
  system: "team-planner-system-v1",
});
export function storageKind(kind) {
  if (!Object.hasOwn(STORAGE_KEYS, kind))
    throw new StorageError("Неизвестное хранилище");
  return kind;
}
export function defaults(kind) {
  storageKind(kind);
  if (kind === "data")
    return { version: 4, team: "", people: [], releases: [], tasks: [] };
  if (kind === "preferences")
    return { version: 1, theme: "light", activeId: null };
  return {
    version: 1,
    calendar: { years: {} },
    launcher: { desktopShortcutAsked: false, desktopShortcutCreated: false },
    queueNotice: false,
    migrations: { splitStorage: 0 },
  };
}

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const key = (v) => typeof v === "string" && v.length > 0 && v.length <= 200;
const text = (v) => typeof v === "string";
function check(ok, where) {
  if (!ok) throw new StorageError(`Неверное поле: ${where}`);
}
function fields(v, allowed, required, where) {
  check(object(v), where);
  check(
    Object.keys(v).every((k) => allowed.includes(k)),
    where + ": лишние поля",
  );
  check(
    required.every((k) => Object.hasOwn(v, k)),
    where + ": отсутствуют поля",
  );
}
function date(v) {
  if (!text(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const year = Number(v.slice(0, 4));
  const time = Date.parse(v + "T00:00:00Z");
  return (
    year >= 1900 &&
    year <= 2100 &&
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === v
  );
}
function unique(items, where) {
  check(Array.isArray(items), where);
  check(
    items.every((v) => object(v) && key(v.id)),
    where + ".id",
  );
  check(
    new Set(items.map((v) => v.id)).size === items.length,
    where + ": повтор id",
  );
}
function keys(items, where) {
  check(Array.isArray(items) && items.every(key), where);
  check(new Set(items).size === items.length, where + ": повтор значения");
}
export function validateRelease(v, withId = true) {
  const required = ["number", "start", "end", ...(withId ? ["id"] : [])];
  fields(
    v,
    [...required, ...(withId ? ["exchange"] : [])],
    required,
    "release",
  );
  check(
    (!withId || key(v.id)) && text(v.number) && v.number.trim().length > 0,
    "release.number/id",
  );
  check(
    date(v.start) &&
      date(v.end) &&
      v.end >= v.start &&
      (Date.parse(v.end) - Date.parse(v.start)) / 86400000 <= 366,
    "release.dates",
  );
  if (Object.hasOwn(v, "exchange")) exchange(v.exchange);
}
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
  const allowed = snapshot
    ? taskFields.filter((k) => !["releaseId", "exchangeId"].includes(k))
    : taskFields;
  const required = [
    "id",
    "personId",
    "start",
    "days",
    "type",
    "labels",
    "weekend",
    "daysMode",
    ...(snapshot ? [] : ["releaseId"]),
  ];
  fields(v, allowed, required, "task");
  check(
    key(v.id) && key(v.personId) && (snapshot || key(v.releaseId)),
    "task.ids",
  );
  check(
    !Object.hasOwn(v, "exchangeId") || key(v.exchangeId),
    "task.exchangeId",
  );
  check(
    date(v.start) && Number.isFinite(v.days) && v.days > 0,
    "task.start/days",
  );
  try {
    assertDuration(v.days);
  } catch (error) {
    throw new StorageError(error.message);
  }
  check(
    ["task", "vacation", "sick"].includes(v.type) && v.daysMode === "work",
    "task.type/daysMode",
  );
  check(typeof v.weekend === "boolean", "task.weekend");
  check(
    Array.isArray(v.labels) &&
      v.labels.every((v) => ["FE", "BE"].includes(v)) &&
      new Set(v.labels).size === v.labels.length,
    "task.labels",
  );
  check(
    v.type === "task" || (v.weekend && v.labels.length === 0),
    "task.absence",
  );
  for (const name of ["number", "title", "status", "link"])
    check(!Object.hasOwn(v, name) || text(v[name]), "task." + name);
  check(
    [undefined, "", "waiting", "preprod"].includes(v.status),
    "task.status",
  );
  check(!v.link || normalizeLink(v.link) !== null, "task.link");
}
function snapshot(v) {
  fields(v, ["release", "tasks"], ["release", "tasks"], "snapshot");
  validateRelease(v.release, false);
  unique(v.tasks, "snapshot.tasks");
  v.tasks.forEach((v) => task(v, true));
}
function exchange(v) {
  fields(
    v,
    ["origin", "people", "parents", "base", "sent", "received", "lastImport"],
    ["origin", "people", "parents"],
    "exchange",
  );
  check(key(v.origin) && Array.isArray(v.people), "exchange.origin/people");
  for (const pair of v.people) {
    fields(pair, ["local", "remote"], ["local", "remote"], "exchange.people");
    check(key(pair.local) && key(pair.remote), "exchange.people.ids");
  }
  for (const name of ["local", "remote"])
    check(
      new Set(v.people.map((p) => p[name])).size === v.people.length,
      "exchange.people." + name,
    );
  keys(v.parents, "exchange.parents");
  if (Object.hasOwn(v, "base")) snapshot(v.base);
  if (Object.hasOwn(v, "sent")) {
    check(Array.isArray(v.sent) && v.sent.length <= 20, "exchange.sent");
    for (const entry of v.sent) {
      fields(
        entry,
        ["transferId", "snapshot"],
        ["transferId", "snapshot"],
        "exchange.sent",
      );
      check(key(entry.transferId), "exchange.sent.transferId");
      snapshot(entry.snapshot);
    }
  }
  if (Object.hasOwn(v, "received")) keys(v.received, "exchange.received");
  check(
    !Object.hasOwn(v, "lastImport") || key(v.lastImport),
    "exchange.lastImport",
  );
}

export function validateDocument(kind, v) {
  storageKind(kind);
  check(object(v), kind);
  if (v.version !== (kind === "data" ? 4 : 1))
    throw new StorageError(
      `Неподдерживаемая версия ${kind}: ${v.version}`,
      "UNSUPPORTED_VERSION",
    );
  if (kind === "data") {
    fields(
      v,
      ["version", "team", "people", "releases", "tasks"],
      ["version", "team", "people", "releases", "tasks"],
      kind,
    );
    check(text(v.team), "team");
    unique(v.people, "people");
    for (const p of v.people) {
      fields(p, ["id", "name", "color"], ["id", "name", "color"], "person");
      check(
        text(p.name) && /^#[\da-f]{6}$/i.test(p.color),
        "person.name/color",
      );
    }
    unique(v.releases, "releases");
    v.releases.forEach((v) => validateRelease(v));
    unique(v.tasks, "tasks");
    const people = new Set(v.people.map((p) => p.id));
    const releases = new Set(v.releases.map((r) => r.id));
    v.tasks.forEach((v) => {
      task(v);
      check(
        people.has(v.personId) && releases.has(v.releaseId),
        "task: отсутствующая связь",
      );
    });
    // Проверяем именно очередь: допустимая длительность сама по себе
    // не гарантирует размещение с учётом выходных и отсутствий.
    // Копии нужны, чтобы валидация не меняла даты исходного документа.
    const planned = v.tasks.map((task) => ({ ...task }));
    try {
      repackAll(v.releases, planned);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw new StorageError(error.message);
    }
    check(
      planned.every((task) => date(task.start)),
      "task: дата вне диапазона 1900–2100",
    );
  } else if (kind === "preferences") {
    fields(
      v,
      ["version", "theme", "activeId"],
      ["version", "theme", "activeId"],
      kind,
    );
    check(["light", "dark"].includes(v.theme), "theme");
    check(v.activeId === null || key(v.activeId), "activeId");
  } else {
    // Неизвестные системные секции сохраняются для расширений того же формата.
    check(
      ["calendar", "launcher", "queueNotice", "migrations"].every((k) =>
        Object.hasOwn(v, k),
      ),
      kind,
    );
    fields(v.calendar, ["years"], ["years"], "calendar");
    check(object(v.calendar.years), "calendar.years");
    for (const [year, entry] of Object.entries(v.calendar.years)) {
      fields(entry, ["days", "updatedAt", "source"], ["days"], "calendar.year");
      check(
        /^\d{4}$/.test(year) && validYear(year, entry.days),
        "calendar.days",
      );
      check(
        !Object.hasOwn(entry, "updatedAt") ||
          (text(entry.updatedAt) &&
            /^\d{4}-\d{2}-\d{2}T/.test(entry.updatedAt) &&
            Number.isFinite(Date.parse(entry.updatedAt))),
        "calendar.updatedAt",
      );
      check(
        !Object.hasOwn(entry, "source") || entry.source === "isdayoff.ru",
        "calendar.source",
      );
    }
    fields(
      v.launcher,
      ["desktopShortcutAsked", "desktopShortcutCreated"],
      ["desktopShortcutAsked", "desktopShortcutCreated"],
      "launcher",
    );
    check(
      Object.values(v.launcher).every((v) => typeof v === "boolean"),
      "launcher",
    );
    check(typeof v.queueNotice === "boolean", "queueNotice");
    fields(v.migrations, ["splitStorage"], ["splitStorage"], "migrations");
    check(
      [0, 1].includes(v.migrations.splitStorage),
      "migrations.splitStorage",
    );
  }
  return v;
}

export function patchSystem(current, patch, owner = "browser") {
  const allowed =
    owner === "launcher"
      ? ["launcher"]
      : owner === "browser"
        ? ["calendar", "queueNotice"]
        : [];
  fields(patch, allowed, [], "system.patch");
  check(Object.keys(patch).length > 0, "system.patch: пустой patch");
  return validateDocument("system", { ...current, ...patch });
}

// Сортировка ключей даёт одинаковый SHA-256 в Node и Web Crypto.
export function canonicalJson(value) {
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  if (object(value)) {
    if (Object.prototype.toString.call(value) !== "[object Object]")
      throw new StorageError("Документ содержит значения вне JSON");
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k]))
        .join(",") +
      "}"
    );
  }
  const result = JSON.stringify(value);
  if (
    result === undefined ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw new StorageError("Документ содержит значения вне JSON");
  return result;
}

export function copyDocument(value) {
  // Проверяем до stringify: иначе NaN/undefined молча превратятся в null/исчезнут.
  return JSON.parse(canonicalJson(value));
}
