/* ============================================================
   theme-boot.js — тема до первой отрисовки.

   Обычный (не module) скрипт: он подключается в <head> до стилей
   и выполняется сразу, поэтому тёмная тема успевает встать раньше,
   чем браузер покажет страницу. Как module он был бы отложен и
   дал бы вспышку светлого фона.

   Выбор хранится в localStorage. Значение из data.json подхватится
   позже — в syncThemeFromState() (core/theme.js).
   ============================================================ */
(function () {
  var KEY = "team-planner-theme";
  var theme = null;
  try {
    theme = localStorage.getItem(KEY);
  } catch (e) {
    /* приватный режим — остаёмся на светлой теме */
  }
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
})();
