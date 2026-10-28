/* ============================================================
   connection.js — связь с локальным сервером
   Следит, отвечает ли сервер, показывает красную плашку внизу
   и умеет переподключаться без перезапуска приложения.
   Ещё здесь кнопка «Завершить»: гасит сервер и переводит
   вкладку в экран «Сервер остановлен».
   ============================================================ */
(function () {
  const CHECK_EVERY = 20000; // как часто проверять сервер
  const CHECK_TIMEOUT = 4000; // дольше этого — считаем, что не ответил
  const FAILS_TO_SHOW = 2; // одиночный таймаут не должен мигать плашкой
  // порт по умолчанию из server.js — нужен только при открытии файлом
  const DEFAULT_URL = "http://127.0.0.1:8787/";

  const banner = document.getElementById("serverBanner");
  const bannerText = document.getElementById("bannerText");
  const btnRetry = document.getElementById("bannerRetry");
  const btnQuit = document.getElementById("btnQuit");
  const statusEl = document.getElementById("storeStatus");
  const bye = document.getElementById("byeScreen");

  let fails = 0; // неудачных проверок подряд
  let checking = false; // проверка уже идёт
  let stoppedWhy = ""; // 'manual' | 'other' — сервер остановлен штатно

  function api(path) {
    return new URL(path, location.href).href;
  }

  /* Один запрос к серверу. Таймаут обязателен: если сервер умер,
     fetch может висеть очень долго и «залипнет» проверка. */
  async function checkHealth() {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT);
    try {
      const r = await fetch(api("/api/health"), {
        cache: "no-store",
        signal: ctrl.signal,
      });
      return r.ok;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  function setBannerText(text) {
    if (bannerText) bannerText.textContent = text;
  }

  function setBannerBusy(on) {
    if (!banner) return;
    banner.classList.toggle("busy", on);
    if (btnRetry) btnRetry.disabled = on;
  }

  /* Возвращает true, если данные на экране заменены данными сервера. */
  function adoptServer(server, hadLocal) {
    if (!server) return false; // файла ещё нет — оставляем то, что на экране
    let same = false;
    try {
      same = JSON.stringify(server) === JSON.stringify(state);
    } catch (e) {}
    if (same) return false;

    if (hadLocal) {
      // и на экране, и в файле есть изменения — выбирает человек
      const keepMine = confirm(
        "Сервер снова на связи, но в data.json другие данные, чем сейчас на экране.\n\n" +
          "OK — оставить то, что на экране (перезапишет data.json)\n" +
          "Отмена — загрузить данные из data.json",
      );
      if (keepMine) return false;
    }

    state = migrateTasks(server);
    if (state.releases.length && !state.activeId)
      state.activeId = state.releases[0].id;
    return true;
  }

  /* Сервер снова с нами: гасим плашку, возвращаем зелёный индикатор.
     Если за время простоя были правки — отправляем их на диск.
     Если на диске лежит другое и правок не было — берём файл, чтобы
     не потерять чужую работу молча. */
  async function recover() {
    if (checking || quitting || stoppedWhy) return false;
    checking = true;
    setBannerBusy(true);
    const ok = await checkHealth();
    if (!ok) {
      checking = false;
      setBannerBusy(false);
      return false;
    }

    let server = null;
    try {
      const r = await fetch(api("/api/data"), { cache: "no-store" });
      const j = await r.json();
      if (valid(j.data)) server = j.data;
    } catch (e) {}

    const hadLocal = !!writeTimer || unsaved;
    const adopted = adoptServer(server, hadLocal);
    if (adopted && typeof render === "function") render();

    backend = "server";
    unsaved = false;
    fails = 0;
    checking = false;
    setBannerBusy(false);
    setStatus("server", "Сохранено в data.json");
    // состояние только что прочитали с диска или оно там уже есть
    if (hadLocal && !adopted) persist();
    return true;
  }

  /* Ручная проверка из индикатора в шапке и из плашки. */
  async function retry(manual) {
    if (!SERVED) {
      if (!manual) return;
      // открыто файлом: сервера нет по определению, но он может быть запущен
      if (
        confirm(
          "Приложение открыто как файл, поэтому данные пишутся только в браузер.\n\n" +
            "Открыть версию с сохранением в data.json?\n" +
            DEFAULT_URL +
            "\n\nЕсли она не откроется — запустите start.bat.",
        )
      )
        window.open(DEFAULT_URL, "_blank");
      return;
    }
    const ok = await recover();
    if (!ok && manual) {
      setBannerText(
        "Сервер не отвечает — изменения не сохраняются. Запустите start.bat",
      );
      toast("Сервер не отвечает — запустите start.bat");
    }
  }

  /* Фоновая проверка. Работает всегда, но плашку показывает только после
     двух неудач подряд: одиночный таймаут (ноутбук уснул, вкладка в фоне)
     не должен мигать красным. */
  async function tick() {
    if (!SERVED || checking || quitting || stoppedWhy) return;
    checking = true;
    const ok = await checkHealth();
    checking = false;
    if (ok) {
      fails = 0;
      if (linkLost) recover();
      return;
    }
    fails++;
    if (fails < FAILS_TO_SHOW) return;
    if (!linkLost) {
      setBannerText("Сервер остановлен — изменения не сохраняются");
      if (typeof setStatus === "function")
        setStatus("error", "Нет подключения — данные не сохранены");
    }
  }

  if (!SERVED) {
    // открыто файлом: останавливать нечего, плашка не нужна.
    // Индикатор остаётся кликабельным — по клику предложим открыть localhost.
    if (btnQuit) btnQuit.style.display = "none";
    if (banner) banner.style.display = "none";
  } else {
    setInterval(tick, CHECK_EVERY);
    // вернулись на вкладку — проверяем сразу, не ждём 20 сек
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && (linkLost || fails))
        tick();
    });
  }

  /* Индикатор в шапке в состояниях err/browser кликабелен */
  if (statusEl)
    statusEl.addEventListener("click", function () {
      if (statusMode === "server") return;
      retry(true);
    });
  if (btnRetry)
    btnRetry.addEventListener("click", function () {
      retry(true);
    });

  /* --- завершение работы --- */
  function showBye() {
    if (!bye) return;
    bye.classList.add("show");
    document.body.classList.add("is-stopped");
    setBannerBusy(false);
  }

  /* Другие вкладки того же приложения переводим в тот же экран —
     иначе там останется живой интерфейс без сервера. */
  let channel = null;
  try {
    channel = new BroadcastChannel("team-planner");
    channel.addEventListener("message", function (e) {
      if (e.data === "quit" && !quitting) {
        quitting = true;
        stoppedWhy = "other";
        setBannerBusy(false);
        showBye();
      }
    });
  } catch (e) {}

  async function quitApp() {
    if (quitting) return;
    // останавливать нечего: приложение работает без сервера
    if (backend !== "server") {
      toast("Сервер не запущен — останавливать нечего");
      return;
    }
    if (
      !confirm(
        "Остановить сервер и закрыть приложение?\n\n" +
          "Данные сохранятся в data.json, их версия — в backups.\n" +
          "Вкладку браузер сам не закроет: после остановки её можно закрыть вручную.",
      )
    )
      return;

    quitting = true;
    // пишем состояние принудительно: таймер мог не сработать, а прошлая
    // запись — не дойти до диска. Только после этого гасим сервер.
    try {
      await pushState();
    } catch (e) {}
    setStatus("browser", "Останавливаю сервер…");
    try {
      const r = await fetch(api("/api/quit"), { method: "POST" });
      if (!r.ok) throw new Error("bad status");
    } catch (e) {
      // сервер уже не отвечает — для человека результат тот же
    }
    if (channel) {
      try {
        channel.postMessage("quit");
      } catch (e) {}
    }
    stoppedWhy = "manual";
    showBye();
    // вкладку, открытую руками, браузер не закроет — просто пробуем
    setTimeout(function () {
      window.close();
    }, 60);
  }

  if (btnQuit) btnQuit.addEventListener("click", quitApp);
})();
