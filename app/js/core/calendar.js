// Общий календарь: загруженный год → обычная пятидневка.
let current = () => ({});
export function bindCalendar(getCalendar) {
  current = getCalendar;
}
export function yearLength(year) {
  return new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
}
export function validYear(year, days) {
  return (
    Number.isInteger(Number(year)) &&
    Number(year) >= 1900 &&
    Number(year) <= 2100 &&
    typeof days === "string" &&
    days.length === yearLength(Number(year)) &&
    /^[012]+$/.test(days)
  );
}
export function calendarWorkday(date) {
  const calendar = current() || {};
  const year = Number(date.slice(0, 4));
  const days = calendar.years?.[year]?.days;
  if (validYear(year, days)) {
    const index = Math.round(
      (Date.parse(date + "T00:00:00Z") - Date.UTC(year, 0, 1)) / 86400000,
    );
    return days[index] !== "1"; // сокращённый день остаётся рабочим
  }
  const weekday = new Date(date + "T12:00:00").getDay();
  return weekday !== 0 && weekday !== 6;
}
