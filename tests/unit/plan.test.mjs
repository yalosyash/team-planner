import { beforeEach, describe, expect, test } from "vitest";
import { bindCalendar } from "../../app/js/core/calendar.js";
import {
  loadByDay,
  overflowDays,
  planPerson,
  previewPlacement,
  repackAll,
} from "../../app/js/core/plan.js";

const release = { id: "r1", start: "2026-11-16", end: "2026-11-20" };
const task = (id, overrides = {}) => ({
  id,
  releaseId: release.id,
  personId: "p1",
  type: "task",
  days: 0.5,
  weekend: false,
  start: "2026-01-01",
  ...overrides,
});

beforeEach(() => bindCalendar(() => ({})));

describe("planning invariants", () => {
  test("fractional tasks share a day in array order without mutating inputs", () => {
    const tasks = [task("b"), task("a"), task("c")];
    const original = structuredClone(tasks);
    const plan = planPerson("p1", release, tasks);
    expect(plan.queue.map(({ task, start }) => [task.id, start])).toEqual([
      ["b", "2026-11-16"],
      ["a", "2026-11-16"],
      ["c", "2026-11-17"],
    ]);
    expect(plan.queue.map(({ segs }) => segs)).toEqual([
      [{ i: 0, amount: 0.5, at: 0 }],
      [{ i: 0, amount: 0.5, at: 0.5 }],
      [{ i: 1, amount: 0.5, at: 0 }],
    ]);
    expect(loadByDay(plan)).toEqual([1, 0.5]);
    expect(tasks).toEqual(original);
  });

  test("absence blocks work but contributes no workload", () => {
    const tasks = [
      task("work", { days: 2 }),
      task("vacation", { type: "vacation", days: 1, start: release.start }),
      task("sick", { type: "sick", days: 1, start: "2026-11-18" }),
    ];
    const plan = planPerson("p1", release, tasks);
    expect([...plan.absent]).toEqual(["2026-11-16", "2026-11-18"]);
    expect(plan.queue[0].segs.map(({ i }) => i)).toEqual([1, 3]);
    const load = loadByDay(plan);
    expect(load[0] ?? 0).toBe(0);
    expect(load[1]).toBe(1);
    expect(load[2] ?? 0).toBe(0);
    expect(load[3]).toBe(1);
    expect(plan.cards).toHaveLength(3);
  });

  test("weekends and overflow remain part of the same queue", () => {
    const plan = planPerson("p1", release, [task("long", { days: 6 })]);
    expect(plan.queue[0].segs.map(({ i }) => i)).toEqual([0, 1, 2, 3, 4, 7]);
    expect(overflowDays(plan.queue[0].segs, release)).toBe(1);
    expect(loadByDay(plan)[7]).toBe(1);
    const weekend = planPerson("p1", release, [
      task("long", { days: 6, weekend: true }),
    ]);
    expect(weekend.queue[0].segs.at(-1).i).toBe(5);
  });

  test("repacking isolates people and releases, preserves order, and is idempotent", () => {
    const other = { id: "r2", start: "2026-11-23", end: "2026-11-27" };
    const tasks = [
      task("first", { days: 1 }),
      task("other-person", { personId: "p2" }),
      task("other-release", { releaseId: other.id }),
      task("second"),
      task("unknown-release", { releaseId: "missing" }),
      task("absence", { type: "vacation", start: "2026-11-20" }),
    ];
    const ids = tasks.map(({ id }) => id);
    expect(repackAll([release, other], tasks)).toBe(true);
    expect(tasks.map(({ start }) => start)).toEqual([
      "2026-11-16", "2026-11-16", "2026-11-23", "2026-11-17",
      "2026-01-01", "2026-11-20",
    ]);
    expect(tasks.map(({ id }) => id)).toEqual(ids);
    expect(repackAll([release, other], tasks)).toBe(false);
    expect(repackAll([], tasks)).toBe(false);
    expect(repackAll([release], [])).toBe(false);
  });

  test("moving a task to another person previews the end of their queue", () => {
    const tasks = [task("moving"), task("existing", { personId: "p2", days: 1 })];
    const draft = { ...tasks[0], personId: "p2" };
    const preview = previewPlacement(draft, release, tasks);
    expect(preview.start).toBe("2026-11-17");
    const saved = [tasks[1], draft];
    repackAll([release], saved);
    expect(draft.start).toBe(preview.start);
  });

  test("editing in place preserves priority while a new task joins the end", () => {
    const tasks = [task("first"), task("second")];
    const edited = previewPlacement({ ...tasks[0], days: 1 }, release, tasks);
    expect(edited.start).toBe("2026-11-16");
    expect(edited.segs).toEqual([{ i: 0, amount: 1, at: 0 }]);
    expect(previewPlacement(task("new"), release, tasks).start).toBe("2026-11-17");
  });

  test("calendar changes apply on the next calculation", () => {
    const tasks = [task("work", { days: 1 })];
    expect(planPerson("p1", release, tasks).queue[0].start).toBe(release.start);
    const days = Array(365).fill("0");
    days[319] = "1"; // 16 November 2026 is an explicitly declared day off.
    bindCalendar(() => ({ years: { 2026: { days: days.join("") } } }));
    expect(planPerson("p1", release, tasks).queue[0].start).toBe("2026-11-17");
  });
});
