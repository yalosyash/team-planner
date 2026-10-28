/* ============================================================
   utils.js — константы и вспомогательные функции
   ============================================================ */
/* ============ константы и утилиты ============ */
const ROW_H = 46,
  COL_W = 190;
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const PALETTE = [
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
const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);

function iso(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}
function todayISO() {
  return iso(new Date());
}
function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
function diffDays(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}
function fmt(s) {
  const d = parseISO(s);
  return (
    String(d.getDate()).padStart(2, "0") +
    "." +
    String(d.getMonth() + 1).padStart(2, "0")
  );
}
function eachDay(a, b) {
  const out = [];
  let n = diffDays(a, b);
  for (let i = 0; i <= n; i++) out.push(addDays(a, i));
  return out;
}
function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}
function round(n) {
  return Math.round(n * 100) / 100;
}
function fmtDur(n) {
  return round(n) + " дн";
}
function rgba(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 1900);
}
