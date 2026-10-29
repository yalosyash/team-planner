/* ============================================================
   core/schedule.js — раскладка задачи по дням релиза.

   Здесь только расчёты, без DOM: этим пользуются и доска, и
   окно задачи, и подсчёт загрузки.
   ============================================================ */
import { addDays, diffDays, isWorkday } from "./dates.js";
import { fmtDur, round } from "./util.js";

/* задача считается в рабочих днях; отпуск/больничный и задачи
   с отметкой «работа в выходные» — в календарных */
export function isCalendarTask(task) {
  return task.type === "vacation" || task.type === "sick" || !!task.weekend;
}

/* раскладка задачи по календарным дням релиза:
   [{ i: индекс дня от начала релиза, amount: доля дня }]
   выходные внутри задачи дают нулевые участки — они нужны только
   для геометрии карточки (единый блок с заштрихованными выходными) */
export function taskLayout(task, releaseStart) {
  const out = [];
  let left = task.days || 0;
  let day = task.start;
  const calendar = isCalendarTask(task);
  let guard = 0;
  while (left > 1e-9 && guard++ < 800) {
    if (calendar || isWorkday(day)) {
      const amount = round(Math.min(1, left));
      out.push({ i: diffDays(releaseStart, day), amount });
      left = round(left - amount);
    }
    day = addDays(day, 1);
  }
  return out;
}

/* сколько дней показывает задача (для подписи на карточке) */
export function taskDur(task) {
  return fmtDur(task.days);
}
