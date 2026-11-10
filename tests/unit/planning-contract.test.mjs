import { beforeEach, expect, test } from "vitest";
import { bindCalendar } from "../../app/js/core/calendar.js";
import { layoutFrom } from "../../app/js/core/schedule.js";
import { planPerson, repackAll } from "../../app/js/core/plan.js";
import { validateDocument } from "../../app/js/core/storage-schema.js";

const release = { id: "r", number: "QA", start: "2026-11-16", end: "2026-11-20" };
const task = (days, overrides = {}) => ({
  id: "t", releaseId: "r", personId: "p", start: release.start,
  days, type: "task", weekend: true, daysMode: "work", labels: [], ...overrides,
});
const board = (tasks) => ({
  version: 4, team: "QA", releases: [release], tasks,
  people: [{ id: "p", name: "Анна", color: "#9db8f5" }],
});

beforeEach(() => bindCalendar(() => ({})));

test.each([0.001, 0.009, 1.234, 2001, 3000, Infinity, NaN])(
  "A08: неподдерживаемая длительность %s отвергается расчётом и схемой",
  (days) => {
    expect(() => layoutFrom(task(days), release.start, 0, release.start)).toThrow();
    expect(() => validateDocument("data", board([task(days)]))).toThrow();
  },
);

test.each([0.01, 0.29, 1.25, 2000])("A08: длительность %s рассчитывается полностью", (days) => {
  const data = board([task(days)]);
  const original = structuredClone(data);
  expect(validateDocument("data", data)).toBe(data);
  const { segs } = layoutFrom(task(days), release.start, 0, release.start);
  expect(segs.reduce((total, segment) => total + segment.amount, 0)).toBeCloseTo(days, 8);
  expect(data).toEqual(original);
});

test("A08: выходные и отсутствие учитываются в пределе календарных шагов", () => {
  const working = task(2000, { weekend: false });
  expect(() => validateDocument("data", board([working]))).toThrow(/2000 календарных дней/);
  const absence = task(2000, { id: "vacation", type: "vacation" });
  const data = board([absence, task(1)]);
  const original = structuredClone(data);
  expect(() => validateDocument("data", data)).toThrow(/2000 календарных дней/);
  expect(data).toEqual(original);
});

test("A08: сотые доли сохраняются в очереди следующей задачи", () => {
  const plan = planPerson("p", release, [task(0.01), task(0.29, { id: "next" })]);
  expect(plan.queue.map(({ segs }) => segs)).toEqual([
    [{ i: 0, at: 0, amount: 0.01 }],
    [{ i: 0, at: 0.01, amount: 0.29 }],
  ]);
});

test("A08: ошибка поздней очереди не изменяет даты предыдущих", () => {
  const tasks = [
    task(1, { start: "2026-01-01" }),
    task(2000, { id: "bad", personId: "p2", weekend: false }),
  ];
  const original = structuredClone(tasks);
  expect(() => repackAll([release], tasks)).toThrow(/2000 календарных дней/);
  expect(tasks).toEqual(original);
});
