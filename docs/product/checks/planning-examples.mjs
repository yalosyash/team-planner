// Воспроизводимые примеры справочника. Только синтетическая память, без I/O.
import assert from "node:assert/strict";
import { bindCalendar } from "../../../app/js/core/calendar.js";
import { addDays, workdaysBetween } from "../../../app/js/core/dates.js";
import {
  planPerson,
  overflowDays,
  repackAll,
  previewPlacement,
} from "../../../app/js/core/plan.js";
globalThis.window = { addEventListener() {} };
const { state, personLoad } = await import("../../../app/js/core/storage.js");
const r = { id: "r", start: "2026-11-16", end: "2026-11-20" };
const task = (id, days, extra = {}) => ({
  id,
  days,
  personId: "p",
  releaseId: "r",
  type: "task",
  weekend: false,
  start: r.start,
  ...extra,
});
const positions = (release, tasks, person = "p") =>
  planPerson(person, release, tasks).queue.map((c) => [
    c.task.id,
    c.segs.map((s) => [addDays(release.start, s.i), s.amount, s.at]),
  ]);
function check(id, release, tasks, expected, indicators) {
  assert.deepEqual(positions(release, tasks), expected, id);
  state.tasks = tasks;
  const norm = workdaysBetween(release.start, release.end);
  const own = tasks.filter(
    (t) => t.personId === "p" && t.releaseId === release.id,
  );
  const total = own.reduce((n, t) => n + t.days, 0);
  const work = own
    .filter((t) => t.type === "task")
    .reduce((n, t) => n + t.days, 0);
  const out = planPerson("p", release, tasks).queue.reduce(
    (n, c) => n + overflowDays(c.segs, release),
    0,
  );
  assert.deepEqual(
    [total, norm, work > norm + 1e-9, out],
    indicators,
    id + " indicators",
  );
  const load = personLoad("p", release);
  assert.ok(
    load.every((v) => v <= 1.001),
    id + " no daily overload",
  );
  console.log(id + ": OK");
}
bindCalendar(() => ({}));
check(
  "EX-01",
  r,
  [task("A", 1.5), task("B", 0.5)],
  [
    [
      "A",
      [
        ["2026-11-16", 1, 0],
        ["2026-11-17", 0.5, 0],
      ],
    ],
    ["B", [["2026-11-17", 0.5, 0.5]]],
  ],
  [2, 5, false, 0],
);
const fri = { ...r, start: "2026-11-20", end: "2026-11-23" };
check(
  "EX-02",
  fri,
  [task("A", 2)],
  [
    [
      "A",
      [
        ["2026-11-20", 1, 0],
        ["2026-11-23", 1, 0],
      ],
    ],
  ],
  [2, 2, false, 0],
);
check(
  "EX-03",
  fri,
  [task("A", 3, { weekend: true })],
  [
    [
      "A",
      [
        ["2026-11-20", 1, 0],
        ["2026-11-21", 1, 0],
        ["2026-11-22", 1, 0],
      ],
    ],
  ],
  [3, 2, true, 0],
);
const absence = task("V", 1, {
  type: "vacation",
  weekend: true,
  start: "2026-11-18",
});
check(
  "EX-04",
  r,
  [task("A", 5), absence],
  [
    [
      "A",
      [
        ["2026-11-16", 1, 0],
        ["2026-11-17", 1, 0],
        ["2026-11-19", 1, 0],
        ["2026-11-20", 1, 0],
        ["2026-11-23", 1, 0],
      ],
    ],
  ],
  [6, 5, false, 1],
);
assert.equal(personLoad("p", r)[2] || 0, 0);
const half = { ...absence, days: 0.5 };
check(
  "EX-05",
  r,
  [task("A", 1), { ...half, start: r.start }],
  [["A", [["2026-11-17", 1, 0]]]],
  [1.5, 5, false, 0],
);
const overlaps = [
  task("A", 1),
  { ...absence, start: r.start, days: 2 },
  task("S", 2, { type: "sick", weekend: true, start: "2026-11-17" }),
];
check("EX-06", r, overlaps, [["A", [["2026-11-19", 1, 0]]]], [5, 5, false, 0]);
assert.equal(planPerson("p", r, overlaps).absent.size, 3);
const one = { ...r, end: r.start };
check(
  "EX-07",
  one,
  [task("A", 1.5), task("B", 0.5)],
  [
    [
      "A",
      [
        ["2026-11-16", 1, 0],
        ["2026-11-17", 0.5, 0],
      ],
    ],
    ["B", [["2026-11-17", 0.5, 0.5]]],
  ],
  [2, 1, true, 1],
);
const days = Array(365).fill("0");
days[323] = "1"; // 20 ноября — синтетический праздник
days[324] = "2"; // 21 ноября — синтетическая рабочая суббота
bindCalendar(() => ({ years: { 2026: { days: days.join("") } } }));
check(
  "EX-08",
  { ...fri, end: "2026-11-21" },
  [task("A", 1)],
  [["A", [["2026-11-21", 1, 0]]]],
  [1, 1, false, 0],
);
bindCalendar(() => ({}));
const base = [task("A", 1), task("B", 1)];
const startOfB = (tasks) =>
  planPerson("p", r, tasks).queue.find((c) => c.task.id === "B").start;
assert.equal(startOfB(base), "2026-11-17");
assert.equal(startOfB([{ ...base[0], days: 2 }, base[1]]), "2026-11-18");
assert.equal(startOfB([base[1], base[0]]), "2026-11-16");
assert.equal(startOfB([base[1]]), "2026-11-16");
assert.equal(
  planPerson("p", { ...r, start: "2026-11-17" }, base).queue[0].start,
  "2026-11-17",
);
assert.equal(
  planPerson("p", r, [...base, { ...absence, start: r.start }]).queue[0].start,
  "2026-11-17",
);
assert.equal(
  planPerson("p", r, [...base, { ...absence, start: "2026-11-17" }]).queue[0]
    .start,
  "2026-11-16",
);
const moved = { ...base[0], personId: "q" };
assert.equal(
  previewPlacement(moved, r, [...base, task("Q", 2, { personId: "q" })]).start,
  "2026-11-18",
);
assert.equal(planPerson("p", r, [base[1], moved]).queue[0].start, "2026-11-16");
const stale = base.map((t) => ({ ...t, start: "2026-12-01" }));
assert.equal(repackAll([r], stale), true);
assert.deepEqual(
  stale.map((t) => t.start),
  ["2026-11-16", "2026-11-17"],
);
assert.equal(repackAll([r], stale), false);
assert.deepEqual(
  positions(
    r,
    base.map((t) => ({ ...t, status: "preprod", labels: ["FE", "BE"] })),
  ),
  positions(r, base),
);
console.log(
  "EX-09: edits, reassignment preview, order, repack, status/labels: OK",
);
check(
  "EX-10",
  { ...r, end: r.start },
  [
    task("A", 1, { weekend: true }),
    task("V", 1, { type: "vacation", weekend: true, start: "2026-11-17" }),
  ],
  [["A", [["2026-11-16", 1, 0]]]],
  [2, 1, false, 0],
);
assert.equal(
  planPerson("p", r, [
    task("A", 1, { weekend: true }),
    { ...half, start: r.start },
  ]).queue[0].start,
  "2026-11-17",
);
assert.throws(
  () => planPerson("p", r, [task("A", 2001, { weekend: true })]),
  /Длительность/,
);
console.log(
  "Limits: weekend still skips absence; unsupported duration is rejected: OK",
);
