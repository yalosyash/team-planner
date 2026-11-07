import assert from "node:assert/strict";
import {
  exportRelease,
  previewRelease,
  applyRelease,
  validatePacket,
  snapshot,
  importRevision,
} from "../app/js/core/release-transfer.js";
const clone = (x) => structuredClone(x);
const release = {
  id: "r",
  number: "1.2",
  start: "2026-11-02",
  end: "2026-11-20",
};
const person = { id: "p", name: "Женя", color: "#9db8f5" };
const task = {
  id: "t",
  releaseId: "r",
  personId: "p",
  type: "task",
  start: release.start,
  days: 0.5,
  daysMode: "work",
  weekend: false,
  number: "123",
  title: "Описание",
  status: "waiting",
  labels: ["FE", "BE"],
};
const empty = () => ({
  people: [],
  releases: [],
  tasks: [],
  calendar: { years: {} },
  theme: "dark",
});
let leader = {
  ...empty(),
  people: [person, { id: "unused", name: "Без задач", color: "#abcdef" }],
  releases: [release, { ...release, id: "other" }],
  tasks: [task, { ...task, id: "other-task", releaseId: "other" }],
  activeId: "r",
};
const original = clone(leader);
const exported = exportRelease(leader, "r");
assert.deepEqual(leader, original, "export planning must be pure");
leader = exported.next;
const file = JSON.parse(JSON.stringify(exported.packet));
assert.equal(file.people.length, 1);
assert.ok(!("calendar" in file));
validatePacket(file);
let deputy = empty();
const before = clone(deputy);
assert.throws(() => applyRelease(deputy, file, new Map()));

// Новая версия → старая → снова новая; повтор последней версии заблокирован.
const newerSource = clone(exported.next);
newerSource.tasks[0].title = "Новая правка";
const newerFile = exportRelease(newerSource, "r").packet;
let restored = empty();
restored = applyRelease(
  restored,
  newerFile,
  new Map([[file.people[0].id, "new"]]),
);
const restoreMapping = new Map([[file.people[0].id, restored.people[0].id]]);
assert.equal(previewRelease(restored, newerFile).repeated, true);
restored = applyRelease(restored, file, restoreMapping);
assert.equal(previewRelease(restored, file).repeated, true);
assert.equal(previewRelease(restored, newerFile).repeated, false);
restored = applyRelease(restored, newerFile, restoreMapping);
assert.equal(restored.tasks[0].title, "Новая правка");
assert.equal(previewRelease(restored, newerFile).repeated, true);
assert.throws(() => applyRelease(restored, newerFile, restoreMapping));
assert.deepEqual(deputy, before, "invalid mapping is atomic");
deputy = applyRelease(deputy, file, new Map([[file.people[0].id, "new"]]));
assert.equal(deputy.tasks[0].days, 0.5);
assert.deepEqual(deputy.tasks[0].labels, ["FE", "BE"]);
assert.equal(deputy.theme, "dark");
assert.equal(previewRelease(deputy, file).repeated, true);
assert.throws(() => applyRelease(deputy, file, new Map()));

// Изменение, удаление, новая задача и отсутствие; порядок файла — очередь.
deputy.tasks[0].title = "Изменено коллегой";
deputy.tasks.push({
  ...deputy.tasks[0],
  id: "added",
  exchangeId: undefined,
  number: "456",
});
deputy.tasks.push({
  ...deputy.tasks[0],
  id: "vacation",
  exchangeId: undefined,
  type: "vacation",
  days: 3,
  weekend: true,
  labels: [],
  number: "",
  title: "Отпуск",
});
let returned = exportRelease(deputy, deputy.activeId);
deputy = returned.next;
let preview = previewRelease(leader, returned.packet);
assert.equal(preview.conflict, false);
assert.equal(preview.added, 2);
assert.equal(preview.changed, 1);
assert.equal(preview.deleted, 0);
assert.equal(preview.stale, false);
const others = clone({
  release: leader.releases[1],
  task: leader.tasks[1],
  people: leader.people,
  calendar: leader.calendar,
});
const mapped = new Map([[file.people[0].id, "p"]]);
leader = applyRelease(leader, returned.packet, mapped);
assert.deepEqual(leader.people, others.people);
assert.deepEqual(
  leader.releases.find((r) => r.id === "other"),
  others.release,
);
assert.deepEqual(
  leader.tasks.find((t) => t.id === "other-task"),
  others.task,
);
assert.deepEqual(leader.calendar, others.calendar);
assert.equal(leader.releases[0].exchange.people[0].local, "p");

// Последовательная передача в обратную сторону; ID задач не теряются.
const taskIds = leader.tasks
  .filter((t) => t.releaseId === "r")
  .map((t) => t.exchangeId);
const again = exportRelease(leader, "r");
leader = again.next;
preview = previewRelease(deputy, again.packet);
assert.equal(preview.conflict, false);
assert.equal(preview.stale, false);
deputy = applyRelease(
  deputy,
  again.packet,
  new Map([[file.people[0].id, deputy.people[0].id]]),
);
deputy.tasks = deputy.tasks.filter((t) => t.type !== "vacation");
returned = exportRelease(deputy, deputy.activeId);
deputy = returned.next;
assert.equal(previewRelease(leader, returned.packet).deleted, 1);
assert.deepEqual(
  returned.packet.tasks.map((t) => t.id),
  taskIds.slice(0, 2),
);
const parallel = clone(leader);
parallel.tasks.find((t) => t.releaseId === "r").days = 2;
assert.equal(previewRelease(parallel, returned.packet).conflict, true);
leader = applyRelease(leader, returned.packet, mapped);
assert.equal(previewRelease(leader, file).stale, true);
assert.equal(previewRelease(leader, file).conflict, true);

// Независимо созданный Женя требует выбора; номер релиза не связывает копии.
const independent = {
  ...empty(),
  people: [{ ...person, id: "different" }],
  releases: [{ ...release, id: "independent" }],
};
assert.equal(previewRelease(independent, file).release, undefined);
const combined = applyRelease(
  independent,
  file,
  new Map([[file.people[0].id, "different"]]),
);
assert.equal(combined.releases.length, 2);
assert.equal(combined.people.length, 1);
assert.equal(combined.tasks[0].personId, "different");

// Даты очереди от другого календаря не являются параллельной правкой.
const recalculated = clone(exported.next);
recalculated.tasks[0].start = "2026-11-05";
assert.equal(previewRelease(recalculated, file).unchanged, true);
const absenceChanged = clone(deputy);
absenceChanged.tasks.push({
  ...absenceChanged.tasks[0],
  id: "absence",
  exchangeId: "absence",
  type: "sick",
  labels: [],
});
const a = snapshot(absenceChanged, absenceChanged.releases[0]);
absenceChanged.tasks.at(-1).start = "2026-11-09";
assert.notDeepEqual(snapshot(absenceChanged, absenceChanged.releases[0]), a);

for (const mutate of [
  (p) => {
    p.version = 2;
  },
  (p) => {
    p.tasks[0].personId = "missing";
  },
  (p) => {
    p.tasks.push(clone(p.tasks[0]));
  },
  (p) => {
    p.release.end = "2026-01-01";
  },
  (p) => {
    p.tasks[0].link = "javascript:alert(1)";
  },
  (p) => {
    p.people[0].color = "red";
  },
  (p) => {
    p.tasks[0].days = -1;
  },
  (p) => {
    p.tasks[0].start = "2026-02-30";
  },
]) {
  const bad = clone(file);
  mutate(bad);
  const unchanged = clone(leader);
  assert.throws(() => applyRelease(leader, bad, mapped));
  assert.deepEqual(leader, unchanged);
}
// Два сотрудника не могут случайно слиться в одного.
const two = clone(file);
two.people.push({ ...two.people[0], id: "second" });
assert.throws(() =>
  applyRelease(
    independent,
    two,
    new Map([
      [file.people[0].id, "different"],
      ["second", "different"],
    ]),
  ),
);
// Несколько экспортов без промежуточного возврата не создают ложный конфликт.
let sender = clone(exported.next);
let receiver = applyRelease(
  empty(),
  file,
  new Map([[file.people[0].id, "new"]]),
);
sender.tasks[0].title = "Первая отправка";
let sent = exportRelease(sender, "r");
sender = sent.next;
receiver = applyRelease(
  receiver,
  sent.packet,
  new Map([[file.people[0].id, receiver.people[0].id]]),
);
sender.tasks[0].title = "Вторая отправка";
sent = exportRelease(sender, "r");
sender = sent.next;
assert.equal(previewRelease(receiver, sent.packet).conflict, false);
receiver = applyRelease(
  receiver,
  sent.packet,
  new Map([[file.people[0].id, receiver.people[0].id]]),
);
receiver.tasks[0].title = "Возврат после двух отправок";
let back = exportRelease(receiver, receiver.activeId);
receiver = back.next;
assert.equal(previewRelease(sender, back.packet).conflict, false);
receiver.tasks[0].title = "Повторный экспорт с дополнительной правкой";
back = exportRelease(receiver, receiver.activeId);
assert.equal(previewRelease(sender, back.packet).conflict, false);
const brokenBase = clone(file);
brokenBase.base.tasks[0].days = -1;
assert.throws(() => validatePacket(brokenBase));
// Пустой релиз также переносится.
const noTasks = exportRelease({ ...empty(), releases: [release] }, "r");
assert.equal(
  applyRelease(empty(), noTasks.packet, new Map()).releases.length,
  1,
);
// Календарь и вычисляемые даты не сбрасывают предпросмотр; реальные правки — да.
const revisionData = {
  ...empty(),
  releases: [clone(release)],
  tasks: [clone(task)],
};
const revision = importRevision(revisionData);
revisionData.calendar = {
  years: { 2026: { days: "0".repeat(365), updatedAt: "new" } },
};
revisionData.tasks[0].start = "2026-11-10";
revisionData.activeId = "r";
revisionData.theme = "dark";
assert.equal(importRevision(revisionData), revision);
revisionData.tasks[0].title = "Правка";
assert.notEqual(importRevision(revisionData), revision);
delete revisionData.tasks[0].title;
revisionData.releases = [];
assert.notEqual(importRevision(revisionData), revision);
console.log("Release transfer: all checks passed");
