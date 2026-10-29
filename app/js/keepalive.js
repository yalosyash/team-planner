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
  let fails = 0; // неудачных сигналов подряд

  function ping() {
    if (!alive) return;
    fetch("/api/alive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: TAB }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("bad status");
        fails = 0;
        // Сервер ответил. Если на диске всё уже записано — подтверждаем
        // зелёным. Если какая-то правка не дошла, не врем: сначала
        // пробуем дописать её, и только успешная запись даст «Сохранено».
        if (backend !== "server") return;
        if (typeof hasUnsaved === "function" && hasUnsaved()) {
          if (typeof persistServer === "function") persistServer();
          return;
        }
        if (typeof setStatus === "function")
          setStatus("server", "Сохранено в data.json");
      })
      .catch(function () {
        // Сервер пропал. Показываем это сразу в индикаторе — иначе он
        // продолжает врать «сохранено», а правки уходят в пустоту.
        // Две неудачи подряд: одиночный таймаут при сворачивании
        // ноутбука не должен переключать индикатор.
        fails++;
        if (fails < 2) return;
        if (typeof setStatus === "function")
          setStatus("error", "Нет подключения — данные не сохранены");
      });
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
