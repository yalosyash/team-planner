import { state, save, backend } from "../core/storage.js";
import { validYear } from "../core/calendar.js";
import { onRender, render } from "../core/render.js";
import { planPerson } from "../core/plan.js";
import { addDays } from "../core/dates.js";

// На каждый запуск обновляем необходимые годы; неудачные запросы повторяем
// при следующем изменении доски через 5 минут или при восстановлении сети.
let attempts = new WeakMap();
const failures = new Map();
const RETRY = 5 * 60 * 1000;

export function neededYears(data, currentYear = new Date().getFullYear()) {
  const years = new Set([currentYear]);
  function range(start, end = start) {
    const from = Number(String(start).slice(0, 4));
    const to = Number(String(end).slice(0, 4));
    if (from < 1900 || to > 2100 || !Number.isInteger(from) || !Number.isInteger(to)) return;
    for (let year = from; year <= to; year++) years.add(year);
  }
  data.releases.forEach(release => {
    range(release.start, release.end);
    const people = new Set(data.tasks.filter(t => t.releaseId === release.id).map(t => t.personId));
    people.forEach(person => {
      planPerson(person, release, data.tasks).cards.forEach(card => {
        const last = card.segs.at(-1);
        range(card.start, last ? addDays(release.start, last.i) : card.start);
      });
    });
  });
  return [...years].filter(y => y >= 1900 && y <= 2100).sort();
}

function showFailures() {
  const notice = document.querySelector("#calendarNotice");
  if (!notice) return;
  notice.hidden = failures.size === 0;
  notice.textContent = failures.size ? [...failures.values()].join(" ") : "";
}

export async function refreshCalendar() {
  const target = state;
  let tried = attempts.get(target);
  if (!tried) { tried = new Map(); attempts.set(target, tried); failures.clear(); }
  const years = neededYears(target).filter(year => !tried.has(year) || Date.now() - tried.get(year) >= RETRY);
  years.forEach(year => tried.set(year, Infinity)); // резервируем до первого await
  for (const year of years) {
    if (state !== target) return;
    try {
      const url = backend === "server" ? `/api/calendar?year=${year}`
        : `https://isdayoff.ru/api/getdata?year=${year}&cc=ru&pre=1`;
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (response.status === 404 && backend === "server") throw new Error("restart");
      if (!response.ok) throw new Error("network");
      const days = (await response.text()).trim();
      if (!validYear(year, days)) throw new Error("format");
      if (state !== target) return;
      target.calendar ||= { years: {} };
      target.calendar.years ||= {};
      target.calendar.years[year] = { days, updatedAt: new Date().toISOString(), source: "isdayoff.ru" };
      failures.delete(year);
      save();
      render(); // в том числе обнаруживает годы задач, сдвинувшихся за конец релиза
    } catch (error) {
      if (state !== target) return;
      tried.set(year, Date.now());
      const cached = validYear(year, target.calendar?.years?.[year]?.days);
      failures.set(year, error.message === "restart"
        ? "Для автоматической загрузки календаря перезапустите планировщик: сервер работает со старым кодом."
        : `Календарь ${year} недоступен. ${cached ? "Используется сохранённый календарь." : "Пока учитываются только субботы и воскресенья."}`);
    }
  }
  showFailures();
}

export function initCalendar() {
  onRender(() => { void refreshCalendar(); });
  window.addEventListener("online", () => {
    attempts = new WeakMap();
    void refreshCalendar();
  });
}
