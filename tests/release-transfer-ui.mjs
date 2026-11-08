// Headless Chrome + CDP, без внешних зависимостей и без доступа к рабочим данным.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { exportRelease } from "../app/js/core/release-transfer.js";
const root = fileURLToPath(new URL("../app/", import.meta.url));
const chromePath =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "planner-transfer-ui-"));
const initial = {
  version: 3,
  team: "Тест",
  people: [{ id: "local", name: "Женя", color: "#abcdef" }],
  releases: [],
  tasks: [],
  activeId: null,
};
const source = {
  version: 3,
  people: [{ id: "remote", name: "Женя", color: "#123456" }],
  releases: [
    { id: "r", number: "1.2", start: "2026-11-02", end: "2026-11-20" },
  ],
  tasks: [
    {
      id: "t",
      releaseId: "r",
      personId: "remote",
      type: "task",
      start: "2026-11-02",
      days: 1,
      daysMode: "work",
      weekend: false,
      labels: ["FE", "BE"],
      number: "123",
      title: "Тест",
      status: "",
    },
  ],
};
const exported = exportRelease(source, "r");
let backupFails = false;
let backup = null;
let missingVersion = false;
const server = http.createServer(async (req, res) => {
  if (req.url === "/api/backups") {
    res.end(
      JSON.stringify({
        backups: [
          {
            name: "test.json",
            at: "07.11.2026",
            size: 100,
            releases: 1,
            tasks: 1,
          },
        ],
      }),
    );
    return;
  }
  if (req.url === "/api/restore") {
    res.end(
      JSON.stringify(
        missingVersion
          ? { ok: false, error: "not found" }
          : { ok: true, data: structuredClone(source), revision: "restored" },
      ),
    );
    return;
  }
  if (req.url === "/api/data") {
    for await (const chunk of req) {
    } // запись тоже изолирована
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(req.method === "GET" ? { data: initial } : { ok: true }),
    );
    return;
  }
  if (req.url === "/api/backup") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (backupFails) {
      res.writeHead(500);
      res.end("{}");
      return;
    }
    backup = JSON.parse(raw);
    res.end('{"ok":true}');
    return;
  }
  if (req.url.startsWith("/api/calendar")) {
    res.end("0".repeat(365));
    return;
  }
  if (req.url.startsWith("/api/")) {
    res.end('{"ok":true}');
    return;
  }
  const target = path.resolve(
    root,
    "." + (req.url === "/" ? "/index.html" : req.url.split("?")[0]),
  );
  if (!target.startsWith(root) || !fs.existsSync(target)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    target.endsWith(".js")
      ? "text/javascript"
      : target.endsWith(".css")
        ? "text/css"
        : "text/html",
  );
  res.end(fs.readFileSync(target));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
try {
  let stderr = "";
  const browserUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Chrome startup timeout: " + stderr)),
      15000,
    );
    chrome.on("error", reject);
    chrome.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  const endpoint = new URL(browserUrl);
  const targets = await (
    await fetch(`http://${endpoint.host}/json/list`)
  ).json();
  ws = new WebSocket(
    targets.find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let sequence = 0;
  const requests = new Map();
  const errors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.exceptionThrown")
      errors.push(msg.params.exceptionDetails.text);
    if (requests.has(msg.id)) {
      const { resolve, reject, timer } = requests.get(msg.id);
      requests.delete(msg.id);
      clearTimeout(timer);
      msg.error
        ? reject(new Error(JSON.stringify(msg.error)))
        : resolve(msg.result);
    }
  };
  function cdp(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, 15000);
      requests.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await cdp("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      replMode: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function waitFor(expression) {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Timed out: " + expression);
  }
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Page.navigate", { url: origin });
  await waitFor(
    'document.querySelector("#storeStatus")?.textContent.includes("Сохранено")',
  );
  // Короткие задачи остаются внутри своих интервалов, включая рамки
  // и padding; скрытая шапка всегда доступна в подсказке и по клику.
  const shortCards = await evaluate(`await (async () => {
    const storage = await import('/js/core/storage.js');
    const { renderBoard } = await import('/js/ui/board.js');
    const previous = storage.state;
    const durations = [0.01, 0.1, 0.25, 0.5, 1];
    storage.replaceState({ ...previous,
      people: [{ id: 'short', name: 'Тест', color: '#abcdef' }],
      activeId: 'short',
      releases: [{ id: 'short', number: 'short', start: '2026-11-02', end: '2026-11-20' }],
      tasks: durations.map((days, i) => ({ id: 'short' + i,
        personId: 'short', releaseId: 'short', start: '2026-11-02',
        type: 'task', days, daysMode: 'work', number: 'SHORT-' + i }))
    });
    renderBoard();
    const cards = [...document.querySelectorAll('.card')];
    const result = cards.map(card => {
      const rect = card.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height,
        tiny: card.classList.contains('is-tiny'), tip: card.dataset.tip,
        headingHidden: getComputedStyle(card.querySelector('.c-top')).display === 'none' };
    });
    cards[0].click();
    const opened = document.querySelector('#tNum').value;
    const { closeModal } = await import('/js/ui/modal.js');
    closeModal('#mTask');
    storage.replaceState(previous);
    renderBoard();
    return { cards: result, opened };
  })()`);
  assert.equal(shortCards.cards.length, 5);
  for (let i = 0; i < shortCards.cards.length; i++) {
    const card = shortCards.cards[i];
    assert.ok(card.height > 0);
    if (i > 0) assert.ok(shortCards.cards[i - 1].bottom <= card.top, JSON.stringify(shortCards.cards));
    assert.equal(card.tiny, i < 3);
    assert.equal(card.headingHidden, i < 3);
    if (i < 3) assert.ok(card.tip.includes('SHORT-' + i));
  }
  assert.equal(shortCards.opened, 'SHORT-0');
  assert.ok(Math.abs(shortCards.cards[3].height - 19) < 0.1);
  assert.ok(Math.abs(shortCards.cards[4].height - 42) < 0.1);
  // Длинный релиз: шапка закреплена сверху, даты — слева.
  const scrollLayout = await evaluate(`await (async () => {
    const storage = await import('/js/core/storage.js');
    const { renderBoard } = await import('/js/ui/board.js');
    const previous = storage.state;
    const people = Array.from({ length: 12 }, (_, i) => ({
      id: 'p' + i, name: 'Сотрудник ' + i, color: '#abcdef'
    }));
    storage.replaceState({ ...previous, people, tasks: [], activeId: 'scroll',
      releases: [{ id: 'scroll', number: 'scroll', start: '2026-01-01', end: '2026-04-30' }] });
    renderBoard();
    const board = document.querySelector('#board');
    board.scrollTop = 900;
    board.scrollLeft = 300;
    await new Promise(requestAnimationFrame);
    const top = board.getBoundingClientRect().top;
    const heads = document.querySelector('.heads').getBoundingClientRect();
    const corner = document.querySelector('.corner').getBoundingClientRect();
    const date = document.querySelector('.date-cell').getBoundingClientRect();
    const column = document.querySelector('.person-col').getBoundingClientRect();
    const result = { top, headsTop: heads.top, cornerTop: corner.top,
      cornerLeft: corner.left, boardLeft: board.getBoundingClientRect().left,
      headsLeft: heads.left, dateTop: date.top, columnHeight: column.height,
      datesHeight: document.querySelector('.dates').getBoundingClientRect().height,
      scrollTop: board.scrollTop, scrollLeft: board.scrollLeft };
    storage.replaceState(previous);
    renderBoard();
    board.scrollTop = board.scrollLeft = 0;
    return result;
  })()`);
  assert.ok(
    scrollLayout.scrollTop > 0 && scrollLayout.scrollLeft > 0,
    JSON.stringify(scrollLayout),
  );
  assert.ok(Math.abs(scrollLayout.headsTop - scrollLayout.top) < 1);
  assert.ok(Math.abs(scrollLayout.cornerTop - scrollLayout.top) < 1);
  assert.ok(Math.abs(scrollLayout.cornerLeft - scrollLayout.boardLeft) < 1);
  assert.ok(scrollLayout.headsLeft < scrollLayout.cornerLeft);
  assert.ok(scrollLayout.dateTop < scrollLayout.top);
  assert.ok(Math.abs(scrollLayout.columnHeight - scrollLayout.datesHeight) < 1);
  await evaluate('document.querySelector("#mTask").classList.add("open")');
  for (const theme of ["light", "dark"]) {
    await evaluate(
      `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`,
    );
    const heights =
      await evaluate(`['#tNum', '#tType', '#tPerson', '#tLink', '#tDays', '#tDesc', '#tStatus', '#tLabelsWrap .seg'].map(selector =>
      document.querySelector(selector).getBoundingClientRect().height)`);
    for (const height of heights.slice(1)) {
      assert.ok(
        Math.abs(height - heights[0]) < 1,
        `Select/input heights must match in ${theme}: ${heights}`,
      );
    }
  }
  await evaluate(
    'document.documentElement.dataset.theme = "light"; document.querySelector("#mTask").classList.remove("open")',
  );
  // Шапка переносит действия целиком и не перекрывает название команды.
  for (const width of [1440, 1130, 1129, 1024, 768, 560, 375, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const name of [
      "Тест",
      "Очень длинное название команды для проверки переноса",
    ]) {
      await evaluate(
        `document.querySelector(".team-chip").textContent = ${JSON.stringify(name)}`,
      );
      const layout = await evaluate(`(() => {
        const brand = document.querySelector(".brand").getBoundingClientRect();
        const actions = document.querySelector(".actions").getBoundingClientRect();
        const title = document.querySelector(".brand-title").getBoundingClientRect();
        const buttons = [...document.querySelectorAll(".actions > button, .actions > .io-dropdown")];
        return {
          overlap: brand.left < actions.right && brand.right > actions.left &&
            brand.top < actions.bottom && brand.bottom > actions.top,
          fits: [title, ...buttons.map(el => el.getBoundingClientRect())]
            .every(r => r.left >= 0 && r.right <= innerWidth),
        };
      })()`);
      assert.equal(
        layout.overlap,
        false,
        `Header overlap at ${width}px (${name})`,
      );
      assert.equal(
        layout.fits,
        true,
        `Header overflow at ${width}px (${name})`,
      );
    }
  }
  // CDP подтверждает сброс до доставки resize в страницу. Дожидаемся
  // самого события: обработчик меню закрывает их при изменении окна.
  await evaluate(`globalThis.viewportRestored = new Promise(resolve => {
    window.addEventListener('resize', () => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }, { once: true });
  }); void 0`);
  await cdp("Emulation.clearDeviceMetricsOverride");
  await evaluate("viewportRestored");
  // Экспорт → удаление → импорт, с фоновым обновлением календаря в предпросмотре.
  await evaluate(
    `(await import('/js/core/storage.js')).replaceState(${JSON.stringify(exported.next)})`,
  );
  await evaluate(`{
    const { state } = await import('/js/core/storage.js');
    state.releases = []; state.tasks = []; state.activeId = null;
  }`);
  await loadFile(exported.packet);
  await evaluate(`{
    const { state } = await import('/js/core/storage.js');
    state.calendar = { years: {} };
    document.querySelector('#riPeople select').value = 'remote';
    document.querySelector('#riApply').click();
  }`);
  await waitFor(
    '!document.querySelector("#mReleaseImport").classList.contains("open")',
  );
  assert.equal(
    await evaluate(
      '(await import("/js/core/storage.js")).state.releases.length',
    ),
    1,
  );
  console.log("Deleted release import with calendar update: passed");
  await evaluate(
    `(await import('/js/core/storage.js')).replaceState(${JSON.stringify(initial)})`,
  );
  // Меню экспорта, импорта и дополнительных действий.
  assert.equal(
    await evaluate('document.querySelectorAll(".io-dropdown").length'),
    3,
  );
  await evaluate('document.querySelector("#btnMore").click()');
  assert.equal(
    await evaluate('!document.querySelector("#moreMenu").hidden && document.querySelector("#moreMenu").contains(document.querySelector("#btnUpdates")) && document.querySelector("#moreMenu").contains(document.querySelector("#btnBackups"))'),
    true,
  );
  await evaluate('document.querySelector("#btnExport").click()');
  assert.equal(
    await evaluate('document.querySelector("#moreMenu").hidden'),
    true,
  );
  assert.equal(
    await evaluate('document.querySelector("#exportMenu").hidden'),
    false,
  );
  await evaluate('document.querySelector("#btnImport").click()');
  assert.equal(
    await evaluate('document.querySelector("#exportMenu").hidden'),
    true,
  );
  assert.equal(
    await evaluate('document.querySelector("#importMenu").hidden'),
    false,
  );
  await evaluate("document.body.click()");
  assert.equal(
    await evaluate('document.querySelector("#importMenu").hidden'),
    true,
  );
  await evaluate(
    'document.querySelector("#btnExport").click(); document.querySelector("#btnExportRelease").click()',
  );
  assert.equal(
    await evaluate('document.querySelector("#reExport").disabled'),
    true,
  );
  assert.equal(
    await evaluate('document.querySelector("#reRelease").disabled'),
    true,
  );
  await evaluate(
    'document.querySelector("#mReleaseExport [data-close]").click()',
  );
  await evaluate(
    `(await import('/js/core/storage.js')).replaceState(${JSON.stringify({ ...source, releases: [...source.releases, { ...source.releases[0], id: "second", number: "2.0" }], activeId: "r" })})`,
  );
  await evaluate(`globalThis.downloads = []; HTMLAnchorElement.prototype.click = function() {
    fetch(this.href).then(r => r.json()).then(data => downloads.push(data));
  }`);
  await evaluate(
    'document.querySelector("#btnExport").click(); document.querySelector("#btnExportRelease").click()',
  );
  assert.equal(
    await evaluate('document.querySelector("#reRelease").options.length'),
    2,
  );
  assert.equal(
    await evaluate('document.querySelector("#reRelease").disabled'),
    false,
  );
  await evaluate(
    'document.querySelector("#reRelease").value = "second"; document.querySelector("#reExport").click()',
  );
  await waitFor("downloads.length === 1");
  assert.equal(await evaluate("downloads[0].release.number"), "2.0");
  assert.equal(await evaluate("downloads[0].tasks.length"), 0);
  assert.equal(
    await evaluate('(await import("/js/core/storage.js")).state.activeId'),
    "r",
  );
  assert.equal(
    await evaluate(
      'document.querySelector("#mReleaseExport").classList.contains("open")',
    ),
    false,
  );
  await evaluate(
    'document.querySelector("#btnExport").click(); document.querySelector("#btnExportAll").click()',
  );
  await waitFor("downloads.length === 2");
  assert.equal(await evaluate("downloads[1].releases.length"), 2);
  await evaluate(`globalThis.fileClicks = []; for (const selector of ['#fileImport', '#fileReleaseImport']) {
    document.querySelector(selector).addEventListener('click', e => { e.preventDefault(); fileClicks.push(selector); });
  }`);
  await evaluate(
    'document.querySelector("#btnImport").click(); document.querySelector("#btnImportAll").click(); document.querySelector("#btnImport").click(); document.querySelector("#btnImportRelease").click()',
  );
  assert.deepEqual(await evaluate("fileClicks"), [
    "#fileImport",
    "#fileReleaseImport",
  ]);
  await evaluate(
    `(await import('/js/core/storage.js')).replaceState(${JSON.stringify(initial)})`,
  );
  async function loadFile(packet) {
    await evaluate(`(() => {
      const input = document.querySelector('#fileReleaseImport');
      const transfer = new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(JSON.stringify(packet))}], 'release.json', {type:'application/json'}));
      input.files = transfer.files; input.dispatchEvent(new Event('change'));
    })()`);
    await waitFor(
      'document.querySelector("#mReleaseImport").classList.contains("open")',
    );
  }
  await loadFile(exported.packet);
  assert.equal(
    await evaluate('document.querySelector("#riPeople select").value'),
    "local",
    "unique matching name is selected automatically",
  );
  // Ручной выбор по-прежнему доступен; отсутствие выбора проверяется при импорте.
  await evaluate('document.querySelector("#riPeople select").value = ""');
  await evaluate('document.querySelector("#riApply").click()');
  await waitFor('document.querySelector("#riError").textContent.length > 0');
  assert.equal(
    await evaluate(
      '(await import("/js/core/storage.js")).state.releases.length',
    ),
    0,
  );
  // Отмена не меняет состояние.
  await evaluate(
    'document.querySelector("#mReleaseImport [data-close]").click()',
  );
  assert.equal(
    await evaluate(
      '(await import("/js/core/storage.js")).state.releases.length',
    ),
    0,
  );
  await loadFile(exported.packet);
  await evaluate('document.querySelector("#riPeople select").value = "local"');
  backupFails = true;
  await evaluate('document.querySelector("#riApply").click()');
  await waitFor(
    'document.querySelector("#riError").textContent.includes("резервную копию")',
  );
  assert.equal(
    await evaluate(
      '(await import("/js/core/storage.js")).state.releases.length',
    ),
    0,
  );
  backupFails = false;
  await evaluate('document.querySelector("#riApply").click()');
  await waitFor(
    '!document.querySelector("#mReleaseImport").classList.contains("open")',
  );
  assert.equal(backup.releases.length, 0);
  assert.equal(
    await evaluate('(await import("/js/core/storage.js")).state.tasks.length'),
    1,
  );
  assert.equal(
    await evaluate(
      '(await import("/js/core/storage.js")).state.people[0].color',
    ),
    "#abcdef",
  );
  // Повторный файл заблокирован.
  await loadFile(exported.packet);
  assert.equal(
    await evaluate('document.querySelector("#riWarning").textContent'),
    "Этот файл уже импортирован. Повторная загрузка заблокирована.",
  );
  assert.equal(
    await evaluate('document.querySelector("#riApply").disabled'),
    true,
  );
  // Даже принудительный вызов обработчика не должен включать кнопку в finally.
  await evaluate(
    'document.querySelector("#riApply").dispatchEvent(new Event("click"))',
  );
  assert.equal(
    await evaluate('document.querySelector("#riApply").disabled'),
    true,
  );
  await evaluate(
    'document.querySelector("#mReleaseImport [data-close]").click()',
  );
  // Возврат/обновление с сохранённым сопоставлением и явным подтверждением.
  const changedSource = structuredClone(exported.next);
  changedSource.tasks[0].title = "Новое описание";
  const changed = exportRelease(changedSource, "r");
  await evaluate(
    '(await import("/js/core/storage.js")).state.tasks[0].title = "Местная правка"',
  );
  await loadFile(changed.packet);
  assert.equal(
    await evaluate('document.querySelector("#riPeople select").value'),
    "local",
  );
  assert.match(
    await evaluate('document.querySelector("#riWarning").textContent'),
    /параллельные/,
  );
  await evaluate('document.querySelector("#riApply").click()');
  assert.equal(
    await evaluate('document.querySelector("#riApply").disabled'),
    true,
  );
  assert.equal(
    await evaluate('document.querySelector("#riError").textContent'),
    "",
  );
  assert.deepEqual(
    await evaluate(`(() => {
    const style = getComputedStyle(document.querySelector('#riApply'));
    return [style.cursor, style.opacity];
  })()`),
    ["not-allowed", "0.45"],
  );
  await evaluate('document.querySelector("#riConfirm").click()');
  assert.equal(
    await evaluate('document.querySelector("#riApply").disabled'),
    false,
  );
  await evaluate('document.querySelector("#riConfirm").click()');
  assert.equal(
    await evaluate('document.querySelector("#riApply").disabled'),
    true,
  );
  await evaluate(
    'document.querySelector("#riConfirm").click(); document.querySelector("#riApply").click()',
  );
  await waitFor(
    '!document.querySelector("#mReleaseImport").classList.contains("open")',
  );
  assert.equal(backup.tasks[0].title, "Местная правка");
  assert.equal(
    await evaluate(
      '(await import("/js/core/storage.js")).state.tasks[0].title',
    ),
    "Новое описание",
  );
  // На узком экране форма помещается, элементы доступны прокруткой.
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await loadFile(changed.packet);
  assert.equal(
    await evaluate(
      'document.querySelector("#mReleaseImport .modal").getBoundingClientRect().width <= innerWidth',
    ),
    true,
  );
  // Восстановление новой версии после отката на старый файл доступно в UI.
  await evaluate(
    'document.querySelector("#mReleaseImport [data-close]").click()',
  );
  await evaluate(
    `(await import('/js/core/storage.js')).replaceState(${JSON.stringify(initial)})`,
  );
  for (const packet of [changed.packet, exported.packet, changed.packet]) {
    await loadFile(packet);
    const needsConfirmation = await evaluate(
      '!document.querySelector("#riConfirmWrap").hidden',
    );
    if (needsConfirmation)
      await evaluate('document.querySelector("#riConfirm").click()');
    assert.equal(
      await evaluate('document.querySelector("#riApply").disabled'),
      false,
    );
    await evaluate('document.querySelector("#riApply").click()');
    await waitFor(
      '!document.querySelector("#mReleaseImport").classList.contains("open")',
    );
  }
  assert.equal(
    await evaluate(
      '(await import("/js/core/storage.js")).state.tasks[0].title',
    ),
    "Новое описание",
  );
  await loadFile(changed.packet);
  assert.equal(
    await evaluate('document.querySelector("#riApply").disabled'),
    true,
  );
  await evaluate(
    'document.querySelector("#mReleaseImport [data-close]").click(); window.confirm = () => true',
  );
  await evaluate(
    `(await import('/js/core/storage.js')).replaceState(${JSON.stringify(initial)})`,
  );
  await evaluate('document.querySelector("#btnBackups").click()');
  await waitFor('document.querySelector("[data-restore]")');
  assert.ok(
    await evaluate(
      'document.querySelector("#bklist").textContent.includes("Релизов: 1") && document.querySelector("#bklist").textContent.includes("Задач: 1")',
    ),
  );
  await evaluate('document.querySelector("[data-restore]").click()');
  await waitFor(
    '!document.querySelector("#mBackups").classList.contains("open")',
  );
  assert.equal(
    await evaluate(
      '(await import("/js/core/storage.js")).state.releases.length',
    ),
    1,
  );
  missingVersion = true;
  await evaluate('document.querySelector("#btnBackups").click()');
  await waitFor('document.querySelector("[data-restore]")');
  await evaluate('document.querySelector("[data-restore]").click()');
  await waitFor(
    'document.querySelector("#bkHint").textContent.includes("Список обновлён")',
  );
  assert.deepEqual(errors, []);
  console.log(
    "Release transfer UI: all checks passed (Chrome, desktop/mobile, cancellation, backup failure, conflict and repeat)",
  );
} finally {
  if (ws) ws.close();
  chrome.kill();
  server.closeAllConnections();
  server.close();
  await new Promise((resolve) => {
    if (chrome.exitCode !== null) resolve();
    else {
      chrome.once("exit", resolve);
      setTimeout(resolve, 2000);
    }
  });
  // Chromium может ненадолго удерживать профиль после завершения.
  try {
    fs.rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  } catch {}
}
