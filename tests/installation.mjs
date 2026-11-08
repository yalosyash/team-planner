// Реальный server.js запускается только из временной копии кода и данных.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { launcher } = require("../lib/launcher.cjs");
const source = fileURLToPath(new URL("../", import.meta.url));
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), "planner installation тест-"),
);
const tasks = ["2026-11-10", "2026-11-02"].map((start, i) => ({
  id: "t" + i,
  personId: "p",
  releaseId: "r",
  start,
  days: i + 0.5,
  type: "task",
  daysMode: "work",
  weekend: false,
  labels: ["FE", "BE"],
}));
const legacy = {
  version: 3,
  team: "Тестовая доска",
  theme: "dark",
  activeId: "r",
  people: [{ id: "p", name: "Анна", color: "#abcdef" }],
  releases: [{ id: "r", number: "1", start: "2026-11-02", end: "2026-11-30" }],
  tasks,
  calendar: { years: { 2026: { days: "0".repeat(365) } } },
};
const bytes = JSON.stringify(legacy, null, 2);
let child, origin;
const jsonFile = async (relative) =>
  JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
const get = async (kind) => (await fetch(origin + "/api/" + kind)).json();
const post = (kind, body) =>
  fetch(origin + "/api/" + kind, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
async function start() {
  child = spawn(
    process.execPath,
    [
      "--preserve-symlinks",
      "--preserve-symlinks-main",
      path.join(root, "server.js"),
      "--hidden",
      "--no-open",
      "--port=0",
    ],
    { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (v) => {
    output += v;
  });
  child.stderr.on("data", (v) => {
    output += v;
  });
  for (let i = 0; i < 400; i++) {
    if (child.exitCode !== null) throw new Error("Startup failed: " + output);
    try {
      const log = await fs.readFile(
        path.join(root, "runtime/server.log"),
        "utf8",
      );
      const matches = [...log.matchAll(/http:\/\/127\.0\.0\.1:\d+/g)];
      if (matches.length) {
        const url = matches.at(-1)[0];
        const health = await (await fetch(url + "/api/health")).json();
        if (health.pid === child.pid) {
          origin = url;
          return;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("Startup timeout: " + output);
}
async function stop() {
  const closed = once(child, "exit");
  await post("bye", { tab: "test" });
  await Promise.race([
    closed,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Graceful shutdown timeout")),
        14000,
      );
      timer.unref();
    }),
  ]);
  assert.equal(child.exitCode, 0);
  child = null;
  await assert.rejects(fs.stat(path.join(root, "runtime/server.pid")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.stat(path.join(root, "runtime/instance.lock")), {
    code: "ENOENT",
  });
}
try {
  async function copy(from, to) {
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      if (entry.isDirectory())
        await copy(path.join(from, entry.name), path.join(to, entry.name));
      else if (entry.isFile())
        await fs.copyFile(
          path.join(from, entry.name),
          path.join(to, entry.name),
        );
    }
  }
  for (const name of ["app", "lib"])
    await copy(path.join(source, name), path.join(root, name));
  await fs.copyFile(
    path.join(source, "server.js"),
    path.join(root, "server.js"),
  );
  await fs.mkdir(path.join(root, "data"));
  await fs.writeFile(path.join(root, "data/data.json"), bytes);
  await fs.writeFile(
    path.join(root, "data/launcher.json"),
    '{"desktopShortcutAsked":true,"desktopShortcutCreated":false}',
  );
  await fs.writeFile(path.join(root, "data/server.log"), "Original log\n");
  await fs.writeFile(path.join(root, "data/server.pid"), "99999999");
  await start();
  assert.equal((await get("health")).storageVersion, 4);
  const data = await get("data");
  assert.deepEqual(
    data.data.tasks.map((v) => v.id),
    ["t0", "t1"],
  );
  assert.deepEqual(
    data.data.tasks.map((v) => v.days),
    [0.5, 1.5],
  );
  assert.equal("theme" in data.data, false);
  assert.equal((await get("preferences")).data.theme, "dark");
  assert.equal((await get("system")).data.launcher.desktopShortcutAsked, true);
  assert.equal(
    await fs.readFile(path.join(root, "runtime/server.pid"), "utf8"),
    String(child.pid),
  );
  assert.ok(
    (
      await fs.readFile(path.join(root, "runtime/server.log"), "utf8")
    ).startsWith("Original log\n"),
  );
  for (const old of [
    "data/server.pid",
    "data/server.log",
    "data/launcher.json",
  ])
    await assert.rejects(fs.stat(path.join(root, old)), { code: "ENOENT" });
  const backups = await fs.readdir(
    path.join(root, "settings/migration-backups"),
  );
  assert.equal(backups.length, 1);
  assert.equal(
    await fs.readFile(
      path.join(root, "settings/migration-backups", backups[0], "data.json"),
      "utf8",
    ),
    bytes,
  );
  for (const url of [
    "/settings/system.json",
    "/runtime/server.pid",
    "/data/data.json",
  ])
    assert.equal((await fetch(origin + url)).status, 404);
  const boardBytes = await fs.readFile(
    path.join(root, "data/data.json"),
    "utf8",
  );
  const preferences = await get("preferences");
  assert.equal(
    (
      await post("preferences", {
        data: { ...preferences.data, theme: "light" },
        baseRevision: preferences.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    await fs.readFile(path.join(root, "data/data.json"), "utf8"),
    boardBytes,
  );
  // Общая CLI доступна при работающем сервере и сохраняет календарь.
  const calendar = (await get("system")).data.calendar;
  assert.equal(await launcher(root, "status"), "asked");
  await launcher(root, "answer", ["true"]);
  assert.deepEqual((await get("system")).data.calendar, calendar);
  // Настоящий WSH + CLI; единственное изменение тестовой VBS — путь
  // рабочего стола заменён временной папкой. Системный Desktop не читается.
  const vbs = await fs.readFile(
    path.join(source, "create-shortcut.vbs"),
    "utf8",
  );
  assert.ok(
    [...vbs].every((v) => v.charCodeAt(0) < 128),
    "VBS must remain ASCII",
  );
  await fs.mkdir(path.join(root, "desktop"));
  await fs.writeFile(
    path.join(root, "create-shortcut.vbs"),
    vbs.replace(
      'sh.SpecialFolders("Desktop")',
      'fso.BuildPath(dir, "desktop")',
    ),
  );
  await fs.copyFile(
    path.join(source, "start.bat"),
    path.join(root, "start.bat"),
  );
  const batch = await fs.readFile(path.join(root, "start.bat"), "utf8");
  assert.ok(batch.indexOf("where node") < batch.indexOf("cscript.exe"));
  assert.ok(batch.indexOf("\n:have_node") < batch.indexOf("cscript.exe"));
  await promisify(execFile)(
    "cscript.exe",
    ["//nologo", path.join(root, "create-shortcut.vbs"), process.execPath],
    {
      windowsHide: true,
      timeout: 15000,
      env: {
        ...process.env,
        NODE_OPTIONS: "--preserve-symlinks --preserve-symlinks-main",
      },
    },
  );
  assert.deepEqual(
    await fs.readdir(path.join(root, "desktop")),
    [],
    "Deleted shortcut must not be recreated",
  );
  assert.deepEqual((await get("system")).data.calendar, calendar);
  // Повторный запуск с тем же каталогом открывает существующий процесс.
  const duplicate = spawn(
    process.execPath,
    [
      "--preserve-symlinks",
      "--preserve-symlinks-main",
      path.join(root, "server.js"),
      "--no-open",
      "--port=" + new URL(origin).port,
    ],
    { windowsHide: true },
  );
  assert.equal((await once(duplicate, "exit"))[0], 0);
  assert.equal((await get("health")).pid, child.pid);
  await fs.writeFile(
    path.join(root, "runtime/server.log"),
    "x".repeat(1024 * 1024 + 1),
  );
  await stop();
  assert.ok(
    (await fs.stat(path.join(root, "runtime/server.log"))).size < 1024 * 1024,
  );
  await start();
  assert.equal((await get("preferences")).data.theme, "light");
  assert.equal(
    (await get("system")).data.launcher.desktopShortcutCreated,
    true,
  );
  assert.equal(
    await fs.readFile(path.join(root, "data/data.json"), "utf8"),
    boardBytes,
  );
  assert.equal(
    (await fs.readdir(path.join(root, "settings/migration-backups"))).length,
    1,
  );
  // Перенос только data/ в новое окружение: доска и история остаются,
  // личные настройки, календарь и ответ launcher не путешествуют с ними.
  const savedBackup = await (await post("backup", data.data)).json();
  assert.equal(savedBackup.ok, true);
  const transferred = path.join(root, "transferred-data");
  await stop();
  await copy(path.join(root, "data"), transferred);
  for (const name of ["data", "settings", "runtime"])
    await fs.rm(path.join(root, name), { recursive: true, force: true });
  await copy(transferred, path.join(root, "data"));
  await start();
  assert.deepEqual((await get("data")).data, data.data);
  // При отсутствии локального выбора миграция выбирает первый релиз доски.
  assert.deepEqual((await get("preferences")).data, {
    version: 1,
    theme: "light",
    activeId: "r",
  });
  assert.deepEqual((await get("system")).data.calendar, { years: {} });
  assert.equal(await launcher(root, "status"), "ask");
  assert.equal(
    await fs.readFile(
      path.join(root, "data/backups", savedBackup.name),
      "utf8",
    ),
    await fs.readFile(
      path.join(transferred, "backups", savedBackup.name),
      "utf8",
    ),
  );
  const transferredPacket = await get("data");
  assert.equal(
    (
      await post("restore", {
        name: savedBackup.name,
        baseRevision: transferredPacket.revision,
      })
    ).status,
    200,
  );
  assert.deepEqual((await get("data")).data, data.data);
  await stop();
  // Чистый запуск с тем же кодом, без прежних данных и настроек.
  for (const name of ["data", "settings", "runtime"])
    await fs.rm(path.join(root, name), { recursive: true, force: true });
  await start();
  assert.equal((await get("data")).data, null);
  assert.equal((await get("preferences")).data.theme, "light");
  assert.equal((await get("system")).data.migrations.splitStorage, 1);
  assert.equal(await launcher(root, "status"), "ask");
  await stop();
  await fs.mkdir(path.join(root, "data"), { recursive: true });
  await fs.writeFile(path.join(root, "data/data.json"), "{broken");
  await assert.rejects(start(), /Startup failed/);
  assert.equal(child.exitCode, 1);
  child = null;
  assert.equal(
    await fs.readFile(path.join(root, "data/data.json"), "utf8"),
    "{broken",
  );
  await assert.rejects(fs.stat(path.join(root, "runtime/instance.lock")), {
    code: "ENOENT",
  });
  await fs.writeFile(path.join(root, "data/data.json"), bytes);
  await fs.writeFile(path.join(root, "data/server.pid"), String(process.pid));
  await assert.rejects(start(), /Startup failed/);
  assert.equal(child.exitCode, 1);
  child = null;
  assert.equal(
    await fs.readFile(path.join(root, "data/data.json"), "utf8"),
    bytes,
  );
  assert.equal(
    await fs.readFile(path.join(root, "data/server.pid"), "utf8"),
    String(process.pid),
  );
  console.log(
    "Installation: real startup/migration, exact backups, runtime move, APIs, launcher, duplicate start, graceful stop and restart passed",
  );
} finally {
  if (child && child.exitCode === null) {
    const closed = once(child, "exit");
    child.kill();
    await closed;
  }
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
