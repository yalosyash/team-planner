import assert from "node:assert/strict";
import { bindCalendar, validYear } from "../app/js/core/calendar.js";
import { isWorkday, nextWorkday, workdaysBetween } from "../app/js/core/dates.js";
import { planPerson, repackAll, previewPlacement, overflowDays } from "../app/js/core/plan.js";

const days = Array(365).fill("0");
// Праздник в пятницу и рабочая суббота; сокращённый день рабочий.
days[1] = "1"; days[2] = "2";
const calendar = { years: { 2026: { days: days.join("") } } };
bindCalendar(() => calendar);
assert.equal(validYear(2024, "0".repeat(366)), true);
assert.equal(validYear(2026, "0".repeat(366)), false);
assert.equal(validYear(2026, "x".repeat(365)), false);
assert.equal(isWorkday("2026-01-02"), false);
assert.equal(isWorkday("2026-01-03"), true);
assert.equal(nextWorkday("2026-01-02"), "2026-01-03");
assert.equal(workdaysBetween("2026-01-01", "2026-01-03"), 2);
assert.equal(isWorkday("2027-01-02"), false); // незагруженный год
const releases = ["r1", "r2"].map(id => ({ id, start: "2026-01-02", end: "2026-01-03" }));
const tasks = releases.flatMap(r => [
  { id: r.id + "a", personId: "p", releaseId: r.id, type: "task", days: 0.5 },
  { id: r.id + "b", personId: "p", releaseId: r.id, type: "task", days: 1 },
]);
assert.equal(repackAll(releases, tasks), true);
assert.ok(tasks.every(t => t.start === "2026-01-03"));
const plan = planPerson("p", releases[0], tasks);
assert.equal(plan.queue[1].segs[0].at, 0.5);
assert.equal(overflowDays(plan.queue[1].segs, releases[0]), 0.5);
assert.equal(previewPlacement(tasks[1], releases[0], tasks).start, tasks[1].start);
const absence = { id: "absence", personId: "p", releaseId: "r1", type: "vacation", start: "2026-01-02", days: 2 };
assert.equal(planPerson("p", releases[0], [...tasks, absence]).queue[0].start, "2026-01-04");
assert.equal(planPerson("p", releases[0], [{ ...tasks[0], weekend: true }]).queue[0].start, "2026-01-02");
assert.equal(planPerson("p", releases[0], [absence]).cards[0].segs.length, 2);
const restored = JSON.parse(JSON.stringify(calendar));
bindCalendar(() => restored);
assert.equal(isWorkday("2026-01-02"), false);
console.log("Calendar: all checks passed");
