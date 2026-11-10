// Расчёт ведётся в сотых долях дня. Горизонт ограничивает календарные
// шаги одной задачи, включая выходные и отсутствие сотрудника.
export const PLANNING_HORIZON = 2000;

export function validDuration(days) {
  return (
    Number.isFinite(days) &&
    days >= 0.01 &&
    days <= PLANNING_HORIZON &&
    Math.abs(days - Math.round(days * 100) / 100) <=
      Number.EPSILON * Math.max(1, days)
  );
}

export function assertDuration(days) {
  if (!validDuration(days))
    throw new RangeError(
      `Длительность: от 0.01 до ${PLANNING_HORIZON} дней, не более двух знаков после запятой`,
    );
}
