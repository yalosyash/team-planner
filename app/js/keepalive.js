/* ============================================================
   keepalive.js — сообщает серверу, что вкладка ещё открыта
   Сервер в «безоконном» режиме сам выключается, когда закрыта
   последняя вкладка. Если приложение открыто с диска (file://),
   этот файл просто ничего не делает.
   ============================================================ */
(function () {
  if (location.protocol === "file:") return;

  // Идентификатор вкладки: у каждой вкладки свой (sessionStorage)
  const TAB = (function () {
    try {
      let id = sessionStorage.getItem("team-planner-tab");
      if (!id) {
        id =
          Date.now().toString(36) +
          "-" +
          Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem("team-planner-tab", id);
      }
      return id;
    } catch (e) {
      return (
        Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
      );
    }
  })();

  let alive = true;

  function ping() {
    if (!alive) return;
    fetch("/api/alive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: TAB }),
    }).catch(function () {});
  }

  function bye() {
    alive = false;
    try {
      navigator.sendBeacon("/api/bye", JSON.stringify({ tab: TAB }));
    } catch (e) {}
  }

  ping();
  setInterval(ping, 30000);

  // закрытие / перезагрузка вкладки
  window.addEventListener("pagehide", bye);
  window.addEventListener("beforeunload", bye);

  // вкладка вернулась из кэша браузера — снова сообщаем, что живы
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      alive = true;
      ping();
    }
  });
})();
