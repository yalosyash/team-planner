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

export const uid = () => Math.random().toString(36).slice(2, 10);

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
