/* ============================================================
   theme-boot.js — тема до первой отрисовки.

   Обычный (не module) скрипт: он подключается в <head> до стилей
   и выполняется сразу, поэтому тёмная тема успевает встать раньше,
   чем браузер покажет страницу. Как module он был бы отложен и
   дал бы вспышку светлого фона.

   До загрузки используем preferences браузера или старый кэш темы.
   Затем syncThemeFromState() применит тему из актуальных preferences.
   ============================================================ */
(function () {
  var KEY = "team-planner-theme";
  var theme = null;
  try {
    var raw = localStorage.getItem("team-planner-preferences-v1");
    theme = raw ? JSON.parse(raw).theme : localStorage.getItem(KEY);
  } catch (e) {
    /* приватный режим — остаёмся на светлой теме */
  }
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
})();
