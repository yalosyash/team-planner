import assert from "node:assert/strict";
import { taskLabels } from "../app/js/core/task-labels.js";
// Хранилище регистрирует обработчик закрытия вкладки при импорте.
globalThis.window = { addEventListener() {} };
const { migrateTasks } = await import("../app/js/core/storage.js");

for (const labels of [[], ["FE"], ["BE"], ["FE", "BE"]]) {
  const task = { type: "task", labels, daysMode: "work" };
  assert.deepEqual(taskLabels(task), labels);
  // Тот же путь миграции используется при загрузке и импорте JSON.
  const data = migrateTasks(JSON.parse(JSON.stringify({ tasks: [task] })));
  assert.deepEqual(data.tasks[0].labels, labels);
  assert.deepEqual(migrateTasks(data).tasks[0].labels, labels);
}
assert.deepEqual(taskLabels({}), []);
assert.deepEqual(taskLabels({ labels: "FE" }), []);
assert.deepEqual(taskLabels({ labels: ["BE", "FE", "FE", "other"] }), [
  "FE",
  "BE",
]);
for (const type of ["vacation", "sick"]) {
  const data = migrateTasks({
    tasks: [{ type, labels: ["FE", "BE"], daysMode: "work" }],
  });
  assert.deepEqual(data.tasks[0].labels, []);
}
assert.deepEqual(
  migrateTasks({ tasks: [{ daysMode: "work" }] }).tasks[0].labels,
  [],
);
console.log("Task labels: all checks passed");
