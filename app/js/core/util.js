/* ============================================================
   core/util.js — константы и небольшие чистые функции
   ============================================================ */

export const ROW_H = 46;
export const COL_W = 190;

/* воскресенье — первый: так удобнее брать WD[date.getDay()] */
export const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/* палитра цветов сотрудников */
export const PALETTE = [
  "#9db8f5",
  "#b3a3f0",
  "#8fcfd4",
  "#f0b58f",
  "#a8dcb5",
  "#e0a8d8",
  "#e8d488",
  "#a3d8cf",
  "#c2c8d4",
  "#e8a3a3",
  "#8fc0f0",
  "#d8b0f0",
];

/* подписи статусов задачи (п.4): одна строка на статус, чтобы значок на
   карточке, пилюля в подсказке и окно задачи говорили одно и то же.
   Формулировки короткие — они же стоят в сегментах окна задачи.
   Ключа нет для обычной задачи: у неё статус пустой строкой и иконки нет. */
export const STATUS_LABEL = {
  waiting: "Не передано",
  preprod: "Готово",
};

export const uid = () => Math.random().toString(36).slice(2, 10);

/* Ссылка задачи (п.5). Пустая строка — ссылки нет, null — адрес недопустим.
   Без схемы дописываем https:// («jira.company.ru/browse/…» работает как
   есть). Разрешаем только http/https: javascript:, data: и прочие схемы
   отбрасываем, иначе значение попало бы в href как XSS-дырка. */
export function normalizeLink(raw) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value) return "";
  // чужая схема (ftp:, mailto:, javascript:, data:) — не чиним её, а
  // отбрасываем. Порт (localhost:8787/…) схемой не считаем.
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !/^https?:/i.test(value) &&
    !/^[^:/]+:\d+(\/|$)/.test(value)
  )
    return null;
  const url = /^https?:\/\//i.test(value) ? value : "https://" + value;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  return parsed.href;
}

export function round(n) {
  return Math.round(n * 100) / 100;
}

export function fmtDur(n) {
  return round(n) + " дн";
}

/* hex + прозрачность → rgba() для заливки карточки */
export function rgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
