// Локальный сервер планировщика: отдаёт приложение, хранит данные в data.json
// и держит версии в папке backups/ (для отката случайных изменений).
// Запуск: node server.js   (или двойной клик по start.bat)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { createFileStore } = require("./lib/file-store.cjs");
const { createStorageApi } = require("./lib/storage-api.cjs");
const { prepareInstallation } = require("./lib/installation.cjs");

function createPlannerServer(options = {}) {
  const ROOT = path.resolve(options.root || __dirname);
  const APP = path.join(__dirname, "app"); // публичный код приложения
  const DATA_DIR = path.join(ROOT, "data"); // личные данные (в git не попадают)
  const DATA = path.join(DATA_DIR, "data.json");
  const BACKUPS = path.join(DATA_DIR, "backups");
  const RUNTIME = path.join(ROOT, "runtime");
  const PID_FILE = path.join(RUNTIME, "server.pid"); // чтобы найти фоновый сервер
  const LOG = path.join(RUNTIME, "server.log"); // журнал (окно-то скрытое)
  const KEEP = 20; // сколько версий хранить
  const SNAP_GAP = 15 * 1000; // не чаще одного снимка в 15 сек при сохранении
  const CLOSE_GRACE = 10 * 1000; // пауза перед остановкой, когда вкладок не осталось
  // Вкладка шлёт сигнал раз в 30 сек. Браузер «душит» таймеры в фоновых
  // вкладках (до одного пробуждения в минуту), поэтому запас двойной:
  // обычное закрытие сервер замечает сразу или через пару минут, а открытое
  // приложение не будет выключено по ошибке.
  const PING_TTL = 3 * 60 * 1000;
  const STOP_CONFIRM = 60 * 1000; // вторая проверка перед остановкой сервера

  // Скрытый режим: запуск из start.bat, без консольного окна.
  // В нём сервер сам останавливается, когда закрыта последняя вкладка приложения.
  const HIDDEN = options.hidden ?? false;

  // В скрытом режиме сообщения некуда печатать — пишем их в runtime/server.log
  function initLog() {
    if (!HIDDEN) return;
    const say = (...args) => {
      try {
        fs.mkdirSync(RUNTIME, { recursive: true });
        if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1024 * 1024) {
          fs.writeFileSync(LOG, ""); // журнал не должен расти бесконечно
        }
        fs.appendFileSync(
          LOG,
          `[${new Date().toISOString()}] ${args.join(" ")}\n`,
          "utf8",
        );
      } catch (e) {}
    };
    console.log = say;
    console.error = say;
  }

  const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };
  const MAX_BODY = 5 * 1024 * 1024; // 5 МБ
  const NAME_RE = /^data_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_[\w-]+)?\.json$/;

  let lastSnap = 0;

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  }

  function validShape(o) {
    return (
      o &&
      Array.isArray(o.people) &&
      Array.isArray(o.releases) &&
      Array.isArray(o.tasks)
    );
  }

  /* Снимок текущих данных в backups/ с ротацией */
  function snapshot(reason, force) {
    try {
      if (!fs.existsSync(DATA)) return;
      const now = Date.now();
      if (!force && now - lastSnap < SNAP_GAP) return;
      fs.mkdirSync(BACKUPS, { recursive: true });
      const body = fs.readFileSync(DATA, "utf8");
      if (!body.trim()) return;
      JSON.parse(body); // не бэкапим битый файл
      const name = `data_${stamp()}_${reason || "snapshot"}_${require("node:crypto").randomUUID()}.json`;
      const fd = fs.openSync(path.join(BACKUPS, name), "wx");
      try {
        fs.writeFileSync(fd, body, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      lastSnap = now;
      prune();
    } catch (e) {
      console.error("Снимок не создан:", e.message);
      throw e;
    }
  }

  function prune() {
    const files = fs
      .readdirSync(BACKUPS)
      .filter((f) => NAME_RE.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(BACKUPS, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.slice(KEEP).forEach((x) => {
      try {
        fs.rmSync(path.join(BACKUPS, x.f), { force: true });
      } catch (e) {}
    });
  }

  function listBackups() {
    if (!fs.existsSync(BACKUPS)) return [];
    return fs
      .readdirSync(BACKUPS)
      .filter((f) => NAME_RE.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUPS, f));
        // дата берётся из имени файла, а не из mtime
        const m = f.match(
          /^data_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/,
        );
        const at = m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}:${m[6]}` : "";
        let releases = null;
        let tasks = null;
        try {
          const data = JSON.parse(
            fs.readFileSync(path.join(BACKUPS, f), "utf8"),
          );
          releases = data.releases?.length ?? null;
          tasks = data.tasks?.length ?? null;
        } catch (e) {}
        return { name: f, at, size: st.size, releases, tasks };
      })
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  /* ============ слежение за открытыми вкладками ============ */
  // Каждая вкладка раз в 30 сек шлёт /api/alive. Если сигналов нет дольше
  // PING_TTL, считаем, что вкладка закрыта. Когда закрыта последняя — в скрытом
  // режиме сервер сам выключается, чтобы не висел в памяти незаметно.
  const lives = new Map(); // id вкладки -> время последнего сигнала
  let stopTimer = null;
  let finalTimer = null;
  let used = false; // хотя бы одна вкладка когда-либо подключалась

  function shutdown(reason, exitCode = 0) {
    try {
      if (
        fs.existsSync(PID_FILE) &&
        fs.readFileSync(PID_FILE, "utf8").trim() === String(process.pid)
      )
        fs.rmSync(PID_FILE, { force: true });
    } catch (e) {}
    server.close(() => process.exit(exitCode));
    setTimeout(() => process.exit(exitCode), 1000).unref();
  }

  function scheduleStop(explicit) {
    if (!HIDDEN || stopTimer || finalTimer) return;
    stopTimer = setTimeout(() => {
      stopTimer = null;
      const alive = [...lives.values()].some((t) => Date.now() - t < PING_TTL);
      if (alive) return;
      if (explicit) {
        // Браузер сам сообщил, что вкладка закрывается — ждать нечего.
        console.log("Все вкладки закрыты — останавливаю сервер.");
        shutdown("idle");
        return;
      }
      // Догадка по молчанию: после сна/гибернации таймеры сервера срабатывают
      // раньше, чем успевает ответить вкладка. Даём приложению шанс отозваться.
      console.log("Вкладок нет — проверю ещё раз через минуту.");
      finalTimer = setTimeout(() => {
        finalTimer = null;
        console.log("Все вкладки закрыты — останавливаю сервер.");
        shutdown("idle");
      }, STOP_CONFIRM);
      finalTimer.unref();
    }, CLOSE_GRACE);
    stopTimer.unref();
  }

  /* Запрос от приложения доказывает, что вкладка жива — отменяем остановку. */
  function cancelStop() {
    if (finalTimer) {
      clearTimeout(finalTimer);
      finalTimer = null;
    }
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
  }

  // Вкладка могла закрыться аварийно (без прощального запроса) — тогда её
  // сигнал просто перестаёт приходить. Раз в 20 секунд убираем «мёртвых»
  // и проверяем, не осталось ли ни одной живой вкладки.
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    let removed = false;
    for (const [id, t] of lives) {
      if (now - t > PING_TTL) {
        lives.delete(id);
        removed = true;
      }
    }
    if (removed) scheduleStop(false);
  }, 20 * 1000).unref();

  // Страховка: вкладки были, но все закрылись, не успев попрощаться
  // (например, браузер упал). Тогда сервер не нужен — проверяем в фоне.
  const idleTimer = setInterval(() => {
    if (HIDDEN && used && lives.size === 0) scheduleStop(false);
  }, 30 * 1000).unref();

  const store = createFileStore(ROOT, {
    beforeWrite: (kind) => {
      if (kind === "data") snapshot("auto", false);
    },
  });
  const storageApi = createStorageApi(ROOT, { store });
  async function handleRequest(req, res) {
    let url;
    try {
      url = decodeURIComponent((req.url || "").split("?")[0]);
    } catch {
      res.writeHead(400);
      res.end("Invalid URL");
      return;
    }
    if (url.startsWith("/api/")) cancelStop(); // вкладка жива — не выключаемся

    // Фиксированный источник: браузеру не требуется CORS у внешнего API.
    if (url === "/api/calendar" && req.method === "GET") {
      const year = new URL(req.url, "http://localhost").searchParams.get(
        "year",
      );
      if (
        !/^\d{4}$/.test(year || "") ||
        Number(year) < 1900 ||
        Number(year) > 2100
      ) {
        res.writeHead(400);
        res.end("Invalid year");
        return;
      }
      const upstream = require("https").get(
        `https://isdayoff.ru/api/getdata?year=${year}&cc=ru&pre=1`,
        { headers: { "User-Agent": "isdayoff-nodejs-app/team-planner" } },
        (reply) => {
          let body = "";
          reply.on("data", (chunk) => {
            body += chunk;
            if (body.length > 1024)
              upstream.destroy(new Error("Response too large"));
          });
          reply.on("error", () => {
            if (!res.writableEnded) {
              res.writeHead(502);
              res.end();
            }
          });
          reply.on("end", () => {
            if (res.writableEnded) return;
            body = body.trim();
            const count =
              new Date(Date.UTC(Number(year), 1, 29)).getUTCMonth() === 1
                ? 366
                : 365;
            if (
              reply.statusCode !== 200 ||
              body.length !== count ||
              !/^[012]+$/.test(body)
            ) {
              res.writeHead(502);
              res.end("Calendar unavailable");
              return;
            }
            res.writeHead(200, {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(body);
          });
        },
      );
      upstream.setTimeout(12000, () => upstream.destroy(new Error("Timeout")));
      upstream.on("error", () => {
        if (!res.writableEnded) {
          res.writeHead(502);
          res.end("Calendar unavailable");
        }
      });
      return;
    }

    if (await storageApi(req, res)) return;

    // --- запись данных ---
    if (url === "/api/backup" && req.method === "POST") {
      let body = "";
      let tooBig = false;
      req.on("data", (chunk) => {
        if (!tooBig) body += chunk;
        if (Buffer.byteLength(body) > MAX_BODY) tooBig = true;
      });
      req.on("end", async () => {
        if (tooBig) {
          res.writeHead(413);
          res.end('{"ok":false,"error":"too big"}');
          return;
        }
        try {
          const packet = JSON.parse(body);
          const obj = await require("./lib/file-migration.cjs").prepareBoard(
            packet,
          );
          if (url === "/api/backup") {
            fs.mkdirSync(BACKUPS, { recursive: true });
            const name = `data_${stamp()}_release_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
            const target = path.join(BACKUPS, name);
            const encoded = JSON.stringify(obj, null, 2);
            const fd = fs.openSync(target, "wx");
            try {
              fs.writeFileSync(fd, encoded, "utf8");
              fs.fsyncSync(fd);
            } finally {
              fs.closeSync(fd);
            }
            if (fs.readFileSync(target, "utf8") !== encoded)
              throw new Error("backup verification failed");
            prune();
            res.writeHead(200, { "Content-Type": TYPES[".json"] });
            res.end(JSON.stringify({ ok: true, name }));
            return;
          }
        } catch (e) {
          res.writeHead(e.status || 400, { "Content-Type": TYPES[".json"] });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // --- список версий ---
    if (url === "/api/backups" && req.method === "GET") {
      const backups = listBackups();
      res.writeHead(200, {
        "Content-Type": TYPES[".json"],
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ backups }));
      return;
    }

    // --- восстановление из версии ---
    if (url === "/api/restore" && req.method === "POST") {
      let body = "";
      let tooBig = false;
      req.on("data", (c) => {
        if (!tooBig) body += c;
        if (Buffer.byteLength(body) > MAX_BODY) tooBig = true;
      });
      req.on("end", async () => {
        try {
          if (tooBig) {
            res.writeHead(413);
            res.end(JSON.stringify({ ok: false, error: "too big" }));
            return;
          }
          const { name, baseRevision } = JSON.parse(body || "{}");
          if (typeof baseRevision !== "string")
            throw new Error("baseRevision required");
          if (
            typeof name !== "string" ||
            !NAME_RE.test(name) ||
            name.includes("/") ||
            name.includes("\\")
          ) {
            throw new Error("bad name");
          }
          const src = path.join(BACKUPS, name);
          if (!fs.existsSync(src)) throw new Error("not found");
          const raw = JSON.parse(fs.readFileSync(src, "utf8"));
          const data = await require("./lib/file-migration.cjs").prepareBoard(
            raw,
          );
          if (!validShape(data)) throw new Error("bad backup");
          const restored = await (
            await store
          ).write("data", data, baseRevision, () =>
            snapshot("before-restore", true),
          );
          res.writeHead(200, { "Content-Type": TYPES[".json"] });
          res.end(JSON.stringify({ ok: true, ...restored }));
        } catch (e) {
          res.writeHead(e.status || 400, { "Content-Type": TYPES[".json"] });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (url === "/api/health") {
      res.writeHead(200, { "Content-Type": TYPES[".json"] });
      res.end(
        JSON.stringify({
          ok: true,
          storageVersion: 4,
          pid: process.pid,
          dataFile: DATA,
          backupsDir: BACKUPS,
        }),
      );
      return;
    }

    // --- вкладка сообщает, что она жива ---
    if (url === "/api/alive") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { tab } = JSON.parse(body || "{}");
          if (typeof tab === "string" && tab) {
            lives.set(tab, Date.now());
            used = true;
          }
        } catch (e) {}
        res.writeHead(200, { "Content-Type": TYPES[".json"] });
        res.end('{"ok":true}');
      });
      return;
    }

    // --- вкладка закрывается ---
    if (url === "/api/bye") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const { tab } = JSON.parse(body || "{}");
          if (typeof tab === "string") lives.delete(tab);
        } catch (e) {}
        res.writeHead(200, { "Content-Type": TYPES[".json"] });
        res.end('{"ok":true}');
        scheduleStop(true); // вкладка попрощалась сама — ждать не нужно
      });
      return;
    }

    // --- статика (только из app/, папка data/ недоступна по HTTP) ---
    let file = url === "/" ? "/index.html" : url;
    const full = path.join(
      APP,
      path.normalize(file).replace(/^(\.\.[/\\])+/, ""),
    );
    if (!full.startsWith(APP + path.sep)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(full, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type":
          TYPES[path.extname(full).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(buf);
    });
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("Ошибка HTTP-запроса:", req.method, req.url, error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { "Content-Type": TYPES[".json"] });
      res.end(JSON.stringify({ ok: false, error: "Внутренняя ошибка сервера" }));
    });
  });

  function start(port, attempt = 0) {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE" && attempt < 10) {
        console.log(`Порт ${port} занят, пробую ${port + 1}...`);
        start(port + 1, attempt + 1);
      } else {
        console.error("Ошибка сервера:", err.message);
        process.exit(1);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = `http://127.0.0.1:${server.address().port}`;
      try {
        snapshot("start", true);
      } catch (e) {
        console.error("Запуск отменён:", e.message);
        shutdown("backup-failed", 1);
        return;
      }
      try {
        fs.mkdirSync(RUNTIME, { recursive: true });
        fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
      } catch (e) {}
      console.log("");
      console.log("  Планировщик загрузки команды запущен");
      console.log("  Адрес:   " + addr);
      console.log("  Данные:  " + DATA);
      console.log("  Версии:  " + BACKUPS);
      console.log("");
      if (HIDDEN) {
        console.log("  Режим без окна: сервер остановится сам, когда");
        console.log("  закроется последняя вкладка планировщика.");
      } else {
        console.log(
          "  Не закрывайте это окно, пока работаете с планировщиком.",
        );
        console.log("  Остановить: Ctrl+C или просто закройте окно.");
      }
      console.log("");
      if (!process.argv.includes("--no-open"))
        exec('start "" ' + addr, () => {});

      // Страховка: если браузер так и не открылся, сервер не должен висеть
      // в памяти незаметно до перезагрузки.
      if (HIDDEN) {
        const guard = setTimeout(
          () => {
            if (!used && lives.size === 0) {
              console.log(
                "Ни одна вкладка не подключилась — останавливаю сервер.",
              );
              shutdown("never-used");
            }
          },
          10 * 60 * 1000,
        );
        guard.unref();
      }
    });
  }

  /* Уже запущенный экземпляр: просто открываем его, второй сервер не поднимаем —
   иначе два процесса писали бы в один data.json наперегонки. */
  function findRunning(port, attempt, done) {
    if (attempt > 10) return done(null);
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 800 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          // проверяем, что на порту именно наш планировщик
          let ok = false;
          try {
            const j = JSON.parse(body);
            ok = res.statusCode === 200 && j && j.ok && j.dataFile === DATA;
          } catch (e) {}
          if (ok) done(port);
          else findRunning(port + 1, attempt + 1, done);
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => findRunning(port + 1, attempt + 1, done));
  }

  function runCli() {
    process.on("SIGINT", () => shutdown("sigint"));
    process.on("SIGTERM", () => shutdown("sigterm"));

    const portArg = process.argv.find((v) => v.startsWith("--port="));
    const BASE_PORT = portArg ? Number(portArg.slice(7)) : 8787;
    if (!Number.isInteger(BASE_PORT) || BASE_PORT < 0 || BASE_PORT > 65535)
      throw new Error("Invalid port");
    findRunning(BASE_PORT, 0, (port) => {
      if (port) {
        const addr = `http://127.0.0.1:${port}`;
        console.log("Сервер уже запущен — открываю " + addr);
        if (!process.argv.includes("--no-open"))
          exec('start "" ' + addr, () => {});
        // даём браузеру время открыться, затем выходим
        setTimeout(() => process.exit(0), 1500);
        return;
      }
      prepareInstallation(ROOT, { store })
        .then(() => {
          initLog();
          start(BASE_PORT);
        })
        .catch((error) => {
          initLog();
          console.error("Запуск отменён:", error.message);
          process.exit(1);
        });
    });
  }

  let installation;
  async function listen(port = 0) {
    installation = await prepareInstallation(ROOT, { store });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    return `http://127.0.0.1:${server.address().port}`;
  }

  async function close() {
    clearInterval(sweepTimer);
    clearInterval(idleTimer);
    cancelStop();
    if (server.listening) {
      const closed = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await closed;
    }
    if (installation) {
      process.removeListener("exit", installation.release);
      installation.release();
      installation = null;
    }
  }

  return { server, listen, close, runCli };
}

module.exports = { createPlannerServer };
if (require.main === module) {
  createPlannerServer({ hidden: process.argv.includes("--hidden") }).runCli();
}
