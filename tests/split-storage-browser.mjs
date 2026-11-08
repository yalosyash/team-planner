// Настоящие Web Locks/localStorage в двух вкладках Chrome, чистый временный профиль.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createStorageApi } = require("../lib/storage-api.cjs");
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "planner-split-browser-"),
);
const app = fileURLToPath(new URL("../app", import.meta.url));
const api = createStorageApi(path.join(temporary, "installation"));
const server = http.createServer(async (req, res) => {
  if (await api(req, res)) return;
  if (req.url.split("?")[0] === "/test") {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Isolated storage test</title>");
    return;
  }
  const target = path.resolve(
    app,
    "." + (req.url === "/" ? "/index.html" : req.url),
  );
  if (!target.startsWith(app + path.sep)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const body = await fs.readFile(target);
    res.setHeader(
      "Content-Type",
      target.endsWith(".html")
        ? "text/html; charset=utf-8"
        : target.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/javascript; charset=utf-8",
    );
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
let chrome, ws;
const connections = [];
const requests = new Map();
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(
    process.env.CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--remote-debugging-port=0",
      `--user-data-dir=${path.join(temporary, "profile")}`,
      "about:blank",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  const browserUrl = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(
      () => reject(new Error("Chrome startup timeout: " + stderr)),
      15000,
    );
    chrome.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    chrome.stderr.on("data", (value) => {
      stderr += value;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  let sequence = 0;
  async function connect(url) {
    const socket = new WebSocket(url);
    connections.push(socket);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const pending = requests.get(msg.id);
      if (!pending) return;
      requests.delete(msg.id);
      clearTimeout(pending.timer);
      msg.error
        ? pending.reject(new Error(JSON.stringify(msg.error)))
        : pending.resolve(msg.result);
    };
    return socket;
  }
  ws = await connect(browserUrl);
  function cdp(method, params = {}, socket = ws) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(
          new Error(
            "CDP timeout: " +
              method +
              " " +
              (params.expression || "").slice(0, 180),
          ),
        );
      }, 15000);
      requests.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(session, expression) {
    const result = await cdp(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
      session,
    );
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function ready(session) {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if (
        await evaluate(
          session,
          `location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`,
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error("Page load timeout");
  }
  async function tab() {
    const { targetId } = await cdp("Target.createTarget", {
      url: origin + "/test",
    });
    const targets = await (
      await fetch(`http://${new URL(browserUrl).host}/json/list`)
    ).json();
    const socket = await connect(
      targets.find((target) => target.id === targetId).webSocketDebuggerUrl,
    );
    await cdp("Runtime.enable", {}, socket);
    await ready(socket);
    return socket;
  }
  const first = await tab(),
    second = await tab();
  const init = `(async () => {
    globalThis.adapters = await import('/js/core/split-storage.js');
    globalThis.schema = await import('/js/core/storage-schema.js');
    globalThis.store = adapters.createBrowserStore();
    return { locks: !!navigator.locks, crypto: !!crypto.subtle };
  })()`;
  assert.deepEqual(await evaluate(first, init), { locks: true, crypto: true });
  await evaluate(second, init);
  const initial = await evaluate(first, "store.read('data')");
  const writes = await Promise.all(
    [first, second].map((session, i) =>
      evaluate(
        session,
        `(async () => {
    try { return { ok: true, packet: await store.write('data', { ...schema.defaults('data'), team: '${i}' }, '${initial.revision}') }; }
    catch (e) { return { ok: false, code: e.code }; }
  })()`,
      ),
    ),
  );
  assert.equal(writes.filter((v) => v.ok).length, 1);
  assert.equal(writes.find((v) => !v.ok).code, "CONFLICT");
  const saved = await evaluate(first, "store.read('data')");
  assert.deepEqual(await evaluate(second, "store.read('data')"), saved);
  await evaluate(
    first,
    `globalThis.notices = []; globalThis.unsubscribe = store.subscribe(kind => notices.push(kind));`,
  );
  await evaluate(
    second,
    `(async () => {
    const pref = await store.read('preferences');
    await store.write('preferences', { ...pref.data, theme: 'dark' }, pref.revision);
    const system = await store.read('system');
    await store.patch({ calendar: { years: { 2026: { days: '0'.repeat(365) } } } }, system.revision);
  })()`,
  );
  const notices = await evaluate(
    first,
    `(async () => {
    const end = Date.now() + 3000;
    while (!notices.includes('system') && Date.now() < end) await new Promise(r => setTimeout(r, 20));
    return notices;
  })()`,
  );
  assert.ok(notices.includes("preferences") && notices.includes("system"));
  assert.equal(
    (await evaluate(first, "store.read('data')")).revision,
    saved.revision,
  );
  await evaluate(first, "unsubscribe()");

  // Проверяем тот же адаптер на реальном HTTP, сопоставляем ревизии с браузером.
  const httpPacket = await evaluate(
    first,
    `(async () => {
    const remote = adapters.createHttpStore();
    const empty = await remote.read('data');
    return remote.write('data', (await store.read('data')).data, empty.revision);
  })()`,
  );
  assert.equal(httpPacket.revision, saved.revision);
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(temporary, "installation/data/data.json"),
        "utf8",
      ),
    ),
    saved.data,
  );
  await assert.rejects(
    fs.stat(path.join(temporary, "installation/settings/preferences.json")),
    { code: "ENOENT" },
  );
  await cdp("Page.enable", {}, first);
  await cdp("Page.navigate", { url: origin + "/test?reload" }, first);
  // /test?reload возвращает ту же тестовую страницу.
  await ready(first);
  await evaluate(first, init);
  assert.equal(
    (await evaluate(first, "store.read('preferences')")).data.theme,
    "dark",
  );
  assert.equal(
    (await evaluate(first, "store.read('system')")).data.calendar.years[2026]
      .days.length,
    365,
  );
  assert.deepEqual(await evaluate(first, "store.read('data')"), saved);
  const readonly = await evaluate(
    first,
    `(async () => {
    const reader = adapters.createBrowserStore({ locks: null });
    const packet = await reader.read('preferences');
    try { await reader.write('preferences', { ...packet.data, theme: 'light' }, packet.revision); }
    catch(e) { return { code: e.code, theme: (await store.read('preferences')).data.theme }; }
  })()`,
  );
  assert.deepEqual(readonly, { code: "READ_ONLY", theme: "dark" });
  // Отдельная старая установка в том же изолированном тестовом профиле.
  await evaluate(
    first,
    `(() => {
    localStorage.clear();
    const data = { version: 3, team: 'Legacy', theme: 'dark', activeId: 'r',
      calendar: { years: { 2026: { days: '0'.repeat(365) } } },
      people: [{ id: 'p', name: 'Anna', color: '#aabbcc' }],
      releases: [{ id: 'r', number: '1', start: '2026-11-02', end: '2026-11-30' }],
      tasks: ['2026-11-10', '2026-11-02'].map((start, i) => ({
        id: 't' + i, personId: 'p', releaseId: 'r', type: 'task', start,
        days: i + 0.5, daysMode: 'work', weekend: false, labels: ['FE'] })) };
    localStorage.setItem('team-planner-v1', JSON.stringify(data));
  })()`,
  );
  const migrations = await Promise.all(
    [first, second].map((session) => evaluate(session, "store.migrate()")),
  );
  assert.equal(migrations.filter((v) => v.migrated).length, 1);
  const migrated = await evaluate(
    first,
    `(async () => ({
    data: (await store.read('data')).data,
    preferences: (await store.read('preferences')).data,
    system: (await store.read('system')).data,
    backup: JSON.parse(localStorage.getItem('team-planner-migration-v1')),
    legacy: localStorage.getItem('team-planner-v1')
  }))()`,
  );
  assert.deepEqual(
    migrated.data.tasks.map((v) => v.id),
    ["t0", "t1"],
  );
  assert.deepEqual(
    migrated.data.tasks.map((v) => v.days),
    [0.5, 1.5],
  );
  assert.equal(migrated.preferences.theme, "dark");
  assert.equal(migrated.system.migrations.splitStorage, 1);
  assert.equal(migrated.system.calendar.years[2026].days.length, 365);
  assert.equal(migrated.legacy, null);
  assert.deepEqual(
    JSON.parse(migrated.backup.sources["team-planner-v1"]).tasks.map(
      (t) => t.id,
    ),
    ["t0", "t1"],
  );
  await cdp("Page.navigate", { url: origin + "/test?migration-reload" }, first);
  await ready(first);
  await evaluate(first, init);
  assert.deepEqual(await evaluate(first, "store.migrate()"), {
    migrated: false,
    backup: null,
  });
  assert.deepEqual(
    (await evaluate(first, "store.read('data')")).data,
    migrated.data,
  );
  // Штатная точка входа целиком: /api/health отсутствует — browser backend.
  await cdp(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `
    const originalFetch = window.fetch;
    window.fetch = (url, options) => String(url).includes('isdayoff.ru')
      ? Promise.resolve(new Response('0'.repeat(365))) : originalFetch(url, options);
  `,
    },
    first,
  );
  async function waitApp(expression) {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if (await evaluate(first, expression)) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(
      "App timeout: " + (await evaluate(first, "document.body.innerText")),
    );
  }
  await cdp("Page.navigate", { url: origin + "/" }, first);
  await ready(first);
  await waitApp(
    `document.querySelector('#storeStatus')?.textContent.includes('Хранение: в браузере')`,
  );
  const appState = await evaluate(
    first,
    `(async () => {
    const app = await import('/js/core/storage.js');
    return { backend: app.backend, ids: app.state.tasks.map(t => t.id), theme: app.state.theme,
      raw: localStorage.getItem('team-planner-data-v4') };
  })()`,
  );
  assert.deepEqual(appState.ids, ["t0", "t1"]);
  assert.equal(appState.theme, "dark");
  await evaluate(first, "document.querySelector('#btnTheme').click()");
  await waitApp(
    `JSON.parse(localStorage.getItem('team-planner-preferences-v1')).theme === 'light'`,
  );
  assert.equal(
    await evaluate(first, "localStorage.getItem('team-planner-data-v4')"),
    appState.raw,
  );
  await waitApp(
    `(async () => !(await import('/js/core/storage.js')).hasUnsaved())()`,
  );
  await evaluate(first, "localStorage.setItem('team-planner-theme', 'dark')");
  const allKeys = `Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]))`;
  const beforeReadonly = await evaluate(first, allKeys);
  await cdp(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `Object.defineProperty(navigator, 'locks', { value: undefined });`,
    },
    first,
  );
  await cdp("Page.navigate", { url: origin + "/" }, first);
  await ready(first);
  await waitApp(
    `document.querySelector('#storeStatus')?.textContent.includes('Только чтение')`,
  );
  assert.equal(
    await evaluate(first, "document.querySelector('#btnAddTask').disabled"),
    true,
  );
  assert.equal(
    await evaluate(first, "document.querySelector('#btnExportAll').disabled"),
    false,
  );
  assert.equal(
    await evaluate(first, "localStorage.getItem('team-planner-data-v4')"),
    appState.raw,
  );
  assert.deepEqual(
    await evaluate(first, allKeys),
    beforeReadonly,
    "Read-only startup must not change any storage key",
  );
  console.log(
    "Split Chrome: two tabs, migration/reload, app startup, isolated theme writes, read-only controls and real HTTP passed",
  );
  console.log(
    "Migration Chrome: simultaneous migration, exact legacy backup, preserved queue/durations/theme/calendar and reload passed",
  );
} finally {
  for (const connection of connections)
    if (connection.readyState === WebSocket.OPEN) connection.close();
  for (const pending of requests.values()) clearTimeout(pending.timer);
  if (chrome && chrome.exitCode === null) {
    const closed = once(chrome, "close");
    chrome.kill();
    await closed;
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
