/* ============================================================
   core/dates.js — даты в формате YYYY-MM-DD и рабочие дни.
   Все функции работают со строками, а не с Date: так проще
   хранить данные и сравнивать их.
   ============================================================ */

export function iso(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

export function todayISO() {
  return iso(new Date());
}

export function parseISO(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(value, amount) {
  const date = parseISO(value);
  date.setDate(date.getDate() + amount);
  return iso(date);
}

export function diffDays(from, to) {
  return Math.round((parseISO(to) - parseISO(from)) / 86400000);
}

/* --- рабочие дни: выходные — суббота и воскресенье --- */
export function isWeekend(value) {
  const weekday = parseISO(value).getDay();
  return weekday === 0 || weekday === 6;
}

export function isWorkday(value) {
  return !isWeekend(value);
}

/* ближайший рабочий день вперёд (если день и так рабочий — он же) */
export function nextWorkday(value) {
  let day = value;
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}

/* сколько рабочих дней в периоде [from, to] включительно */
export function workdaysBetween(from, to) {
  if (diffDays(from, to) < 0) return 0;
  return eachDay(from, to).filter(isWorkday).length;
}

/* n-й рабочий день, считая от value включительно */
export function addWorkdays(value, amount) {
  let day = nextWorkday(value);
  let left = amount;
  while (left > 0) {
    day = addDays(day, 1);
    if (isWorkday(day)) left--;
  }
  return day;
}

/* ДД.ММ — как на доске */
export function fmt(value) {
  const date = parseISO(value);
  return (
    String(date.getDate()).padStart(2, "0") +
    "." +
    String(date.getMonth() + 1).padStart(2, "0")
  );
}

export function eachDay(from, to) {
  const out = [];
  const count = diffDays(from, to);
  for (let i = 0; i <= count; i++) out.push(addDays(from, i));
  return out;
}
