// Преобразование старой календарной модели. Уже преобразованные группы
// сохраняют пользовательскую очередь, даже если start больше ей не соответствует.
import { addDays, isWeekend } from "./dates.js";
import { round } from "./util.js";
import { taskLabels } from "./task-labels.js";

export function migrateTasks(data) {
  const legacyGroups = new Set(
    (data.tasks || [])
      .filter(
        (task) =>
          task.daysMode !== "work" && !["vacation", "sick"].includes(task.type),
      )
      .map((task) => JSON.stringify([task.releaseId, task.personId])),
  );
  (data.tasks || []).forEach((task) => {
    task.labels = taskLabels(task);
    if (task.daysMode === "work") return; // уже новая модель
    const calendar = task.type === "vacation" || task.type === "sick";
    if (calendar) {
      task.weekend = true;
      task.daysMode = "work";
      return;
    }
    const total = Number(task.days) || 0;
    let workdays = 0;
    for (let i = 0; i < Math.ceil(total); i++) {
      if (!isWeekend(addDays(task.start, i)))
        workdays = round(workdays + Math.min(1, total - i));
    }
    if (workdays > 0) {
      task.days = workdays;
      task.weekend = false;
    } else {
      // задача целиком на выходных — оставляем как календарную
      task.weekend = true;
    }
    task.daysMode = "work";
  });

  sortQueue(data.tasks, legacyGroups);
  if (!(data.version >= 3)) data.version = 3;
  return data;
}

/* Порядок задач человека — это и есть его очередь (Р4). Сортируем только
   внутри пары «релиз + человек», не меняя общего чередования задач
   разных людей: каждая группа получает обратно свои же позиции. */
function sortQueue(tasks, legacyGroups) {
  if (!Array.isArray(tasks)) return;
  const groups = new Map();
  tasks.forEach((task, index) => {
    const key = JSON.stringify([task.releaseId, task.personId]);
    if (!legacyGroups.has(key)) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  groups.forEach((slots) => {
    const list = slots
      .map((index) => tasks[index])
      .sort((a, b) =>
        String(a.start || "").localeCompare(String(b.start || "")),
      );
    slots.forEach((index, position) => {
      tasks[index] = list[position];
    });
  });
}
