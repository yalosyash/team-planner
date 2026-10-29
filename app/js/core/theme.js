/* ============================================================
   core/theme.js — светлая и тёмная тема.

   Тема живёт в двух местах: в state.theme (уезжает вместе с data.json)
   и в localStorage (работает и при открытии с диска, и до первой
   загрузки данных). При старте решает js/init/theme-boot.js, чтобы
   не было вспышки светлого фона; здесь — кнопка и синхронизация.
   ============================================================ */
import { $ } from "./dom.js";
import { render } from "./render.js";
import { state, save } from "./storage.js";
import { rgba } from "./util.js";

export const THEME_KEY = "team-planner-theme";

export function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

/* применить тему к документу; mirror — записать ещё и в localStorage */
export function applyTheme(theme, mirror = true) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  if (mirror) {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {}
  }
  renderThemeBtn();
}

/* кнопка: в светлой теме показываем луну (переключит на тёмную),
   в тёмной — солнце. Иконки переключаются чистым CSS. */
export function renderThemeBtn() {
  const btn = $("#btnTheme");
  if (!btn) return;
  const dark = isDark();
  const hint = dark ? "Светлая тема" : "Тёмная тема";
  btn.title = hint;
  btn.setAttribute("aria-label", hint);
  btn.setAttribute("aria-pressed", dark ? "true" : "false");
}

/* Переключение по кнопке: цвет меняется сразу, выбор сохраняется
   в state (уедет в data.json) и в localStorage. Доска перерисовывается:
   заливка карточек считается в JS и зависит от темы. */
function toggleTheme() {
  const next = isDark() ? "light" : "dark";
  applyTheme(next);
  state.theme = next;
  save();
  render();
}

/* Применить тему, пришедшую вместе с данными (data.json / импорт). */
export function syncThemeFromState() {
  if (state.theme === "dark" || state.theme === "light") {
    applyTheme(state.theme);
  } else {
    // старые данные без темы — оставляем выбранную в браузере и запоминаем,
    // чтобы дальше тема ехала вместе с data.json
    state.theme = isDark() ? "dark" : "light";
    save();
  }
}

/* заливка карточки цветом сотрудника: непрозрачность берём из темы
   (--card-alpha), потому что на тёмном фоне пастель нужна плотнее */
export function cardFill(hex) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    "--card-alpha",
  );
  const alpha = parseFloat(value);
  return rgba(hex, isFinite(alpha) && alpha > 0 ? alpha : 0.22);
}

export function initTheme() {
  const btn = $("#btnTheme");
  if (btn) btn.addEventListener("click", toggleTheme);
  renderThemeBtn();
}
