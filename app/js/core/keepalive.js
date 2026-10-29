/* ============================================================
   core/keepalive.js — сообщает серверу, что вкладка ещё открыта.

   Сервер в «безоконном» режиме сам выключается, когда закрыта
   последняя вкладка. Если приложение открыто с диска (file://),
   этот модуль просто ничего не делает.
   ============================================================ */
import { backend, hasUnsaved, persistServer, setStatus } from "./storage.js";

const PING_INTERVAL = 30000;

export function initKeepalive() {
  if (location.protocol === "file:") return;

  // Идентификатор вкладки: у каждой вкладки свой (sessionStorage)
  const tab = (function () {
    const make = () =>
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    try {
      let id = sessionStorage.getItem("team-planner-tab");
      if (!id) {
        id = make();
        sessionStorage.setItem("team-planner-tab", id);
      }
      return id;
    } catch (e) {
      return make();
    }
  })();

  let alive = true;
  let fails = 0; // неудачных сигналов подряд

  function ping() {
    if (!alive) return;
    fetch("/api/alive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("bad status");
        fails = 0;
        // Сервер ответил. Если на диске всё уже записано — подтверждаем
        // зелёным. Если какая-то правка не дошла, не врем: сначала
        // пробуем дописать её, и только успешная запись даст «Сохранено».
        if (backend !== "server") return;
        if (hasUnsaved()) {
          persistServer();
          return;
        }
        setStatus("server", "Сохранено в data.json");
      })
      .catch(() => {
        // Сервер пропал. Показываем это сразу в индикаторе — иначе он
        // продолжает врать «сохранено», а правки уходят в пустоту.
        // Две неудачи подряд: одиночный таймаут при сворачивании
        // ноутбука не должен переключать индикатор.
        fails++;
        if (fails < 2) return;
        setStatus("error", "Нет подключения — данные не сохранены");
      });
  }

  function bye() {
    alive = false;
    try {
      navigator.sendBeacon("/api/bye", JSON.stringify({ tab }));
    } catch (e) {}
  }

  ping();
  setInterval(ping, PING_INTERVAL);

  // закрытие / перезагрузка вкладки
  window.addEventListener("pagehide", bye);
  window.addEventListener("beforeunload", bye);

  // вкладка вернулась из кэша браузера — снова сообщаем, что живы
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      alive = true;
      ping();
    }
  });
}
