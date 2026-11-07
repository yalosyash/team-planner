/* Старые задачи могут не иметь labels; отсутствия всегда без меток. */
export function taskLabels(task) {
  if (task.type === "vacation" || task.type === "sick") return [];
  return ["FE", "BE"].filter(
    (label) => Array.isArray(task.labels) && task.labels.includes(label),
  );
}
