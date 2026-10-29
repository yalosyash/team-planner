/* ============================================================
   env-check.js — понятное сообщение, если приложение открыли
   не тем способом.

   Приложение собрано на ES-модулях, а браузер не грузит модули
   со схемы file:// (CORS). Без этой проверки пользователь увидел бы
   пустую страницу и не понял, что случилось.

   Скрипт обычный, не module: он должен выполниться даже тогда,
   когда модули заблокированы.
   ============================================================ */
(function () {
  if (location.protocol !== "file:") return;

  document.addEventListener("DOMContentLoaded", function () {
    var main = document.getElementById("board");
    if (!main) return;
    main.innerHTML =
      '<div class="empty"><h2>Приложение открыто напрямую с диска</h2>' +
      "<p>Планировщик запускается через <b>start.bat</b>: он поднимает " +
      "локальный сервер и открывает браузер сам. Для этого нужен " +
      "<b>Node.js</b> (LTS-версия с nodejs.org).</p>" +
      "<p>Открыть файл <code>index.html</code> двойным кликом больше нельзя: " +
      "браузер не загружает модули со схемы <code>file://</code>.</p></div>";
    var status = document.getElementById("storeStatus");
    if (status) {
      status.className = "store err";
      status.textContent = "Запустите start.bat";
    }
  });
})();
