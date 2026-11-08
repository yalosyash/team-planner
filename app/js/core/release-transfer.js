import { workingData } from "./storage-migration.js";
// Формат обмена не содержит общего календаря и настроек приложения.
import { normalizeLink } from "./util.js";

const copy = (value) => JSON.parse(JSON.stringify(value));
const id = () => crypto.randomUUID();
const fail = () => {
  throw new Error("Неверный формат файла релиза или нарушены связи данных");
};
const key = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 200;
const date = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number(value.slice(0, 4)) >= 1900 &&
  Number(value.slice(0, 4)) <= 2100 &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
function unique(items) {
  if (
    !Array.isArray(items) ||
    items.some((x) => !x || !key(x.id)) ||
    new Set(items.map((x) => x.id)).size !== items.length
  )
    fail();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      // У обычной задачи start — результат расчёта по локальному календарю.
      Object.keys(value)
        .filter((k) => !(k === "start" && value.type === "task"))
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Фоновое обновление календаря и пересчёт start обычных задач не требуют
// повторного подтверждения импорта. Пользовательские правки сохраняют защиту.
export function importRevision(data) {
  const { calendar, theme, activeId, ...content } = data;
  return JSON.stringify(canonical(content));
}

// Только содержимое релиза: служебные связи и свойства общих людей не сравниваем.
export function snapshot(data, release) {
  const { exchange, id: releaseId, ...fields } = release;
  return {
    release: fields,
    tasks: data.tasks
      .filter((t) => t.releaseId === releaseId)
      .map((task) => {
        const {
          exchangeId,
          id: taskId,
          releaseId: unused,
          personId,
          ...rest
        } = task;
        return {
          ...rest,
          id: exchangeId || taskId,
          personId:
            exchange?.people?.find((pair) => pair.local === personId)?.remote ||
            personId,
        };
      }),
  };
}

export function exportRelease(data, releaseId) {
  const next = workingData(data);
  if (Object.hasOwn(data, "activeId")) next.activeId = data.activeId;
  const release = next.releases.find((r) => r.id === releaseId);
  if (!release) throw new Error("Сначала выберите релиз");
  release.exchange ||= { origin: id(), people: [], parents: [] };
  const exchange = release.exchange;
  next.tasks
    .filter((t) => t.releaseId === releaseId)
    .forEach((task) => {
      task.exchangeId ||= id();
    });
  const used = new Set(
    next.tasks.filter((t) => t.releaseId === releaseId).map((t) => t.personId),
  );
  for (const personId of used) {
    if (!exchange.people.some((pair) => pair.local === personId))
      exchange.people.push({ local: personId, remote: id() });
  }
  const current = snapshot(next, release);
  const packet = {
    format: "team-planner-release",
    version: 1,
    transferId: id(),
    origin: exchange.origin,
    exportedAt: new Date().toISOString(),
    parents: exchange.parents || [],
    base: exchange.base || current,
    release: { id: exchange.origin, ...current.release },
    tasks: current.tasks.map((t) => ({ ...t, releaseId: exchange.origin })),
    people: next.people
      .filter((p) => used.has(p.id))
      .map((p) => ({
        id: exchange.people.find((pair) => pair.local === p.id).remote,
        name: p.name,
        color: p.color,
      })),
  };
  // Снимок последней передачи позволяет обнаружить локальные изменения при возврате.
  exchange.base ||= current;
  exchange.sent = [
    ...(exchange.sent || []),
    { transferId: packet.transferId, snapshot: current },
  ].slice(-20);
  exchange.parents = [...new Set([...packet.parents, packet.transferId])];
  return { next, packet };
}

export function validatePacket(packet, checkBase = true) {
  if (
    !packet ||
    packet.format !== "team-planner-release" ||
    packet.version !== 1 ||
    !key(packet.origin) ||
    !key(packet.transferId) ||
    !Array.isArray(packet.parents) ||
    packet.parents.some((p) => !key(p)) ||
    packet.parents.includes(packet.transferId)
  )
    fail();
  const r = packet.release;
  if (
    !r ||
    r.id !== packet.origin ||
    typeof r.number !== "string" ||
    !r.number.trim() ||
    !date(r.start) ||
    !date(r.end) ||
    r.end < r.start ||
    (Date.parse(r.end) - Date.parse(r.start)) / 86400000 > 366
  )
    fail();
  unique(packet.people);
  unique(packet.tasks);
  if (
    packet.people.some(
      (p) => typeof p.name !== "string" || !/^#[\da-f]{6}$/i.test(p.color),
    )
  )
    fail();
  const people = new Set(packet.people.map((p) => p.id));
  for (const t of packet.tasks) {
    if (
      t.releaseId !== r.id ||
      !people.has(t.personId) ||
      !date(t.start) ||
      !Number.isFinite(t.days) ||
      t.days <= 0 ||
      !["task", "vacation", "sick"].includes(t.type) ||
      t.daysMode !== "work" ||
      typeof t.weekend !== "boolean" ||
      !Array.isArray(t.labels) ||
      t.labels.some((l) => !["FE", "BE"].includes(l)) ||
      (t.type !== "task" && (t.labels.length > 0 || !t.weekend)) ||
      !["", "waiting", "preprod"].includes(t.status || "") ||
      [t.number, t.title].some((v) => typeof v !== "string") ||
      (t.link && (typeof t.link !== "string" || normalizeLink(t.link) === null))
    )
      fail();
  }
  if (checkBase) {
    if (
      !packet.base ||
      !packet.base.release ||
      !Array.isArray(packet.base.tasks)
    )
      fail();
    const basePeople = [...new Set(packet.base.tasks.map((t) => t?.personId))];
    validatePacket(
      {
        ...packet,
        release: { ...packet.base.release, id: packet.origin },
        tasks: packet.base.tasks.map((t) => ({
          ...t,
          releaseId: packet.origin,
        })),
        people: basePeople.map((personId) => ({
          id: personId,
          name: "",
          color: "#000000",
        })),
      },
      false,
    );
  }
  return packet;
}

export function previewRelease(data, packet) {
  validatePacket(packet);
  const release = data.releases.find(
    (r) => r.exchange?.origin === packet.origin,
  );
  const current = release ? snapshot(data, release) : null;
  const incoming = {
    release: Object.fromEntries(
      Object.entries(packet.release).filter(([k]) => k !== "id"),
    ),
    tasks: packet.tasks.map(({ releaseId, ...t }) => t),
  };
  const old = new Map((current?.tasks || []).map((t) => [t.id, t]));
  const position = (tasks) => {
    const counts = new Map();
    return new Map(
      tasks.map((t) => {
        const index = counts.get(t.personId) || 0;
        counts.set(t.personId, index + 1);
        return [t.id, index];
      }),
    );
  };
  const oldOrder = position(current?.tasks || []),
    newOrder = position(incoming.tasks);
  const added = incoming.tasks.filter((t) => !old.has(t.id)).length;
  const changed = incoming.tasks.filter(
    (t) =>
      old.has(t.id) &&
      (!same(old.get(t.id), t) || oldOrder.get(t.id) !== newOrder.get(t.id)),
  ).length;
  const deleted = [...old.keys()].filter(
    (k) => !incoming.tasks.some((t) => t.id === k),
  ).length;
  // Блокируем только последний применённый файл: после другой версии
  // ранее загруженный файл снова можно применить.
  const repeated = release?.exchange?.lastImport === packet.transferId;
  const stale =
    !!release?.exchange?.lastImport &&
    !packet.parents.includes(release.exchange.lastImport);
  const conflict =
    !!current &&
    !same(current, packet.base) &&
    !same(current, incoming) &&
    !(
      release.exchange.lastImport &&
      packet.parents.includes(release.exchange.lastImport) &&
      same(current, release.exchange.base)
    ) &&
    !release.exchange.sent?.some(
      (sent) =>
        packet.parents.includes(sent.transferId) &&
        same(current, sent.snapshot),
    );
  return {
    release,
    incoming,
    added,
    changed,
    deleted,
    repeated,
    stale,
    conflict,
    unchanged: !!current && same(current, incoming),
  };
}

// Чистая операция: при любой ошибке исходное состояние остаётся нетронутым.
export function applyRelease(data, packet, mapping) {
  const preview = previewRelease(data, packet);
  if (preview.repeated)
    throw new Error(
      "Этот файл уже импортирован. Повторная загрузка не применяется.",
    );
  const next = copy(data);
  const target = preview.release
    ? next.releases.find((r) => r.id === preview.release.id)
    : null;
  const releaseId = target?.id || id();
  const pairs = [];
  for (const person of packet.people) {
    const selected = mapping.get(person.id);
    if (selected !== "new" && !next.people.some((p) => p.id === selected))
      throw new Error("Выберите сотрудника для каждой строки");
    const local = selected === "new" ? id() : selected;
    if (pairs.some((p) => p.local === local))
      throw new Error(
        "Разных сотрудников нельзя сопоставить с одним человеком",
      );
    if (selected === "new") next.people.push({ ...person, id: local });
    pairs.push({ remote: person.id, local });
  }
  const oldTasks = new Map(
    next.tasks
      .filter((t) => t.releaseId === releaseId)
      .map((t) => [t.exchangeId || t.id, t.id]),
  );
  const release = {
    ...packet.release,
    id: releaseId,
    exchange: {
      origin: packet.origin,
      people: pairs,
      base: preview.incoming,
      parents: [...new Set([...packet.parents, packet.transferId])],
      received: [
        ...new Set([...(target?.exchange?.received || []), packet.transferId]),
      ],
      sent: target?.exchange?.sent || [],
      lastImport: packet.transferId,
    },
  };
  if (target) next.releases[next.releases.indexOf(target)] = release;
  else next.releases.push(release);
  next.tasks = next.tasks
    .filter((t) => t.releaseId !== releaseId)
    .concat(
      packet.tasks.map((t) => ({
        ...t,
        id: oldTasks.get(t.id) || id(),
        exchangeId: t.id,
        releaseId,
        personId: pairs.find((p) => p.remote === t.personId).local,
      })),
    );
  next.activeId = releaseId;
  return next;
}
