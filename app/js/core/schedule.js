/* ============================================================
   core/schedule.js — раскладка задачи по дням релиза.

   Здесь только расчёты, без DOM: этим пользуются и доска, и
   окно задачи, и подсчёт загрузки.
   ============================================================ */
import { addDays, diffDays, isWorkday } from "./dates.js";
import { fmtDur, round } from "./util.js";

const EPS = 1e-9;
const GUARD = 2000; // предохранитель от бесконечного цикла на битых данных

/* отпуск и больничный: стоят на своих датах и в очередь не встают */
export function isAbsence(task) {
  return task.type === "vacation" || task.type === "sick";
}

/* день, в который работа не идёт: выходной у рабочей задачи или день
   отсутствия человека (отпуск/больничный) */
function dayOff(task, date, absent) {
  if (absent && absent.has(date)) return true;
  return !task.weekend && !isWorkday(date);
}

/* Раскладка задачи по календарным дням релиза начиная с даты start.
   used — сколько дня уже занято предыдущей задачей (0…1): очередь
   идёт дробно, поэтому следующая задача может начаться в тот же
   день, где от предыдущей осталась половина.
   absent — Set дат отсутствия человека: такие дни задача
   «перепрыгивает» и не тратит на них длительность.
   Возвращает участки по дням, последний день и остаток в нём. */
export function layoutFrom(task, start, used, releaseStart, absent) {
  const segs = [];
  let day = start;
  let at = used || 0;
  let left = round(task.days || 0);
  let guard = 0;
  while (left > EPS && guard++ < GUARD) {
    if (dayOff(task, day, absent)) {
      day = addDays(day, 1);
      at = 0;
      continue;
    }
    const amount = round(Math.min(1 - at, left));
    segs.push({ i: diffDays(releaseStart, day), amount, at: round(at) });
    left = round(left - amount);
    at = round(at + amount);
    if (at >= 1 - EPS) {
      day = addDays(day, 1);
      at = 0;
    }
  }
  return { segs, day, used: at };
}

/* сколько дней показывает задача (для подписи на карточке) */
export function taskDur(task) {
  return fmtDur(task.days);
}
