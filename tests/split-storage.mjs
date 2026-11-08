// Этап 2: настоящие файлы/HTTP и два экземпляра браузерного адаптера.
// Ни один тест не открывает рабочую data/ и не запускает start.bat/server.js.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import {
  defaults,
  STORAGE_KEYS,
  validateDocument,
} from "../app/js/core/storage-schema.js";
import {
  createBrowserStore,
  createHttpStore,
} from "../app/js/core/split-storage.js";
import { exportRelease } from "../app/js/core/release-transfer.js";

const require = createRequire(import.meta.url);
const { createFileStore } = require("../lib/file-store.cjs");
const { createStorageApi } = require("../lib/storage-api.cjs");
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "planner-split-storage-"),
);
const rejected = (code) => (error) => error.code === code;
const directory = (name) => path.join(temporary, name);
function board() {
  return {
    ...defaults("data"),
    team: "Команда",
    people: [{ id: "p", name: "Анна", color: "#aabbcc" }],
    releases: [
      { id: "r", number: "1.0", start: "2026-11-02", end: "2026-11-30" },
    ],
    tasks: [
      {
        id: "t",
        personId: "p",
        releaseId: "r",
        start: "2026-11-02",
        days: 1.5,
        type: "task",
        number: "42",
        title: "Задача",
        link: "https://example.org/42",
        status: "preprod",
        labels: ["FE", "BE"],
        weekend: false,
        daysMode: "work",
      },
      {
        id: "a",
        personId: "p",
        releaseId: "r",
        start: "2026-11-05",
        days: 2,
        type: "vacation",
        title: "Отпуск",
        labels: [],
        weekend: true,
        daysMode: "work",
      },
    ],
  };
}
const calendar = {
  years: { 2026: { days: "0".repeat(365), source: "isdayoff.ru" } },
};
const launcher = { desktopShortcutAsked: true, desktopShortcutCreated: false };

async function fileChecks() {
  const root = directory("files");
  const store = await createFileStore(root);
  const empty = await store.read("data");
  assert.equal(empty.data, null);
  await assert.rejects(fs.stat(path.join(root, "data/data.json")), {
    code: "ENOENT",
  });
  const pref = await store.read("preferences");
  const sys = await store.read("system");
  assert.deepEqual(pref.data, defaults("preferences"));
  assert.deepEqual(sys.data, defaults("system"));
  let rich = exportRelease(board(), "r").next;
  validateDocument("data", rich);
  const saved = await store.write("data", rich, empty.revision);
  assert.deepEqual((await store.read("data")).data, rich);
  assert.deepEqual(await store.read("preferences"), pref);
  assert.deepEqual(await store.read("system"), sys);
  await store.write(
    "preferences",
    { ...pref.data, theme: "dark", activeId: "r" },
    pref.revision,
  );
  assert.deepEqual(
    await store.read("data"),
    saved,
    "тема не меняет ревизию доски",
  );
  const updated = await store.patch({ calendar }, sys.revision);
  const launched = await store.updateLauncher(launcher);
  assert.deepEqual(launched.data.calendar, calendar);
  await assert.rejects(
    store.patch({ queueNotice: true }, updated.revision),
    rejected("CONFLICT"),
  );
  const noticed = await store.patch({ queueNotice: true }, launched.revision);
  assert.deepEqual(noticed.data.launcher, launcher);

  // Неизвестная системная секция переживает обновление известной секции.
  const sysFile = path.join(root, "settings/system.json");
  const withExtension = {
    ...noticed.data,
    extension: { enabled: true, nested: [1, null] },
  };
  await fs.writeFile(sysFile, JSON.stringify(withExtension));
  await store.updateLauncher({ ...launcher, desktopShortcutCreated: true });
  assert.deepEqual(
    (await store.read("system")).data.extension,
    withExtension.extension,
  );
  await assert.rejects(
    store.write("system", defaults("system"), "any"),
    rejected("INVALID_DOCUMENT"),
  );
  const revision = (await store.read("system")).revision;
  for (const patch of [
    { launcher },
    { version: 2 },
    { migrations: { splitStorage: 1 } },
    {},
  ])
    await assert.rejects(
      store.patch(patch, revision),
      rejected("INVALID_DOCUMENT"),
    );
  await assert.rejects(
    store.patch({ calendar: { years: { 2026: { days: "012" } } } }, revision),
    rejected("INVALID_DOCUMENT"),
  );

  const disk = await fs.readFile(path.join(root, "data/data.json"), "utf8");
  const invalids = [
    { ...rich, theme: "dark" },
    { ...rich, version: 99 },
    { ...rich, tasks: [...rich.tasks, rich.tasks[0]] },
    { ...rich, people: [] },
    { ...rich, tasks: [{ ...rich.tasks[0], start: "2026-02-30" }] },
    { ...rich, tasks: [{ ...rich.tasks[0], days: NaN }] },
    { ...rich, tasks: [{ ...rich.tasks[0], link: "javascript:alert(1)" }] },
  ];
  const leaked = structuredClone(rich);
  leaked.releases[0].exchange.base.tasks[0].theme = "dark";
  invalids.push(leaked);
  for (const value of invalids)
    await assert.rejects(store.write("data", value, saved.revision));
  assert.equal(
    await fs.readFile(path.join(root, "data/data.json"), "utf8"),
    disk,
  );

  // Ошибки write и rename не портят живой JSON и не оставляют tmp/lock.
  for (const operation of ["write", "rename"]) {
    const io = {
      ...fs,
      ...(operation === "rename"
        ? {
            rename: async () => {
              throw Object.assign(new Error("rename denied"), {
                code: "EPERM",
              });
            },
          }
        : {
            open: async (name, flags) => {
              const handle = await fs.open(name, flags);
              if (!name.endsWith(".tmp")) return handle;
              return {
                writeFile: async () => {
                  throw Object.assign(new Error("disk full"), {
                    code: "ENOSPC",
                  });
                },
                close: () => handle.close(),
                sync: () => handle.sync(),
              };
            },
          }),
    };
    const failing = await createFileStore(root, { io });
    await assert.rejects(
      failing.write("data", { ...rich, team: "Не записано" }, saved.revision),
    );
    assert.equal(
      await fs.readFile(path.join(root, "data/data.json"), "utf8"),
      disk,
    );
    assert.deepEqual(await fs.readdir(path.join(root, "data")), ["data.json"]);
    assert.deepEqual(await fs.readdir(path.join(root, "runtime")), []);
  }
  // Перезапуск адаптера и изменение порядка ключей не меняют ревизию.
  const restarted = await createFileStore(root);
  assert.deepEqual(await restarted.read("data"), saved);
  await fs.writeFile(
    path.join(root, "data/data.json"),
    JSON.stringify(Object.fromEntries(Object.entries(rich).reverse())),
  );
  assert.equal((await restarted.read("data")).revision, saved.revision);

  for (const [raw, code] of [
    ["{broken", "CORRUPT_DOCUMENT"],
    [JSON.stringify({ ...rich, version: 100 }), "UNSUPPORTED_VERSION"],
    [
      JSON.stringify({ ...rich, version: 3, theme: "dark" }),
      "UNSUPPORTED_VERSION",
    ],
  ]) {
    await fs.writeFile(path.join(root, "data/data.json"), raw);
    await assert.rejects(store.read("data"), rejected(code));
    await assert.rejects(
      store.write("data", rich, saved.revision),
      rejected(code),
    );
    assert.equal(
      await fs.readFile(path.join(root, "data/data.json"), "utf8"),
      raw,
    );
  }
  // Неизвестный/живой/мёртвый lock не удаляется по тайм-ауту.
  const impatient = await createFileStore(root, { lockTimeout: 35 });
  for (const metadata of [
    "",
    JSON.stringify({ pid: process.pid, token: "other" }),
    JSON.stringify({ pid: 2147483647, token: "dead" }),
  ]) {
    const lock = path.join(root, "runtime/preferences.lock");
    await fs.writeFile(lock, metadata);
    await assert.rejects(
      impatient.read("preferences"),
      rejected("STORAGE_LOCKED"),
    );
    assert.equal(await fs.readFile(lock, "utf8"), metadata);
    await fs.unlink(lock);
  }
  console.log(
    "Split files: isolation, roundtrip/exchange, validation, corrupt/new/legacy versions, disk failures, locks and restart passed",
  );
}

// Реальные независимые процессы, а не две очереди Promise в одном процессе.
function worker(root, operation, args = {}) {
  const modulePath = fileURLToPath(
    new URL("../lib/file-store.cjs", import.meta.url),
  );
  const code = `
    const { createFileStore } = require(process.argv[1]);
    (async () => {
      const store = await createFileStore(process.argv[2]);
      const args = JSON.parse(process.argv[4]);
      const result = process.argv[3] === 'launcher'
        ? await store.updateLauncher(args.launcher)
        : await store.write('data', args.data, args.revision);
      process.stdout.write(JSON.stringify({ ok: true, result }));
    })().catch(error => { process.stdout.write(JSON.stringify({ ok: false, code: error.code })); process.exitCode = 1; });`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--preserve-symlinks",
        "--preserve-symlinks-main",
        "-e",
        code,
        modulePath,
        root,
        operation,
        JSON.stringify(args),
      ],
      { windowsHide: true },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (v) => {
      stdout += v;
    });
    child.stderr.on("data", (v) => {
      stderr += v;
    });
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(stderr || stdout));
      }
    });
  });
}
async function processChecks() {
  const root = directory("processes");
  const store = await createFileStore(root);
  const initial = await store.read("data");
  const results = await Promise.all(
    ["A", "B"].map((team) =>
      worker(root, "data", {
        data: { ...board(), team },
        revision: initial.revision,
      }),
    ),
  );
  assert.equal(results.filter((v) => v.ok).length, 1);
  assert.equal(results.find((v) => !v.ok).code, "CONFLICT");
  assert.equal(
    (await store.read("data")).data.team,
    results.find((v) => v.ok).result.data.team,
  );
  const system = await store.read("system");
  const [fromCli, fromServer] = await Promise.all([
    worker(root, "launcher", { launcher }),
    store.patch({ calendar }, system.revision).then(
      (result) => ({ ok: true, result }),
      (error) => ({ ok: false, code: error.code }),
    ),
  ]);
  assert.equal(fromCli.ok, true);
  if (!fromServer.ok) {
    assert.equal(fromServer.code, "CONFLICT");
    await store.patch({ calendar }, (await store.read("system")).revision);
  }
  const final = (await store.read("system")).data;
  assert.deepEqual(final.launcher, launcher);
  assert.deepEqual(final.calendar, calendar);
  console.log(
    "Split processes: simultaneous board writes and launcher/calendar writes passed",
  );
}

async function httpChecks() {
  const root = directory("http");
  const api = createStorageApi(root);
  const server = http.createServer(async (req, res) => {
    if (!(await api(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (route, body) =>
    fetch(
      origin + route,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  try {
    const client = createHttpStore({
      fetch: (route, options) => fetch(origin + route, options),
    });
    const empty = await client.read("data");
    const saved = await client.write("data", board(), empty.revision);
    assert.deepEqual((await client.read("data")).data, board());
    await assert.rejects(
      client.write("data", { ...board(), team: "stale" }, empty.revision),
      rejected("CONFLICT"),
    );
    const pref = await client.read("preferences");
    await client.write(
      "preferences",
      { ...pref.data, theme: "dark" },
      pref.revision,
    );
    const system = await client.read("system");
    await client.patch({ calendar }, system.revision);
    assert.equal((await client.read("data")).revision, saved.revision);
    const current = await client.read("system");
    assert.equal(
      (
        await request("/api/system", {
          patch: { launcher },
          baseRevision: current.revision,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/data", {
          data: { ...board(), theme: "dark" },
          baseRevision: saved.revision,
        })
      ).status,
      400,
    );
    assert.equal((await request("/api/data", { data: board() })).status, 409);
    assert.equal(
      (await fetch(origin + "/api/data", { method: "POST", body: "{bad" }))
        .status,
      400,
    );
    assert.equal(
      (
        await fetch(origin + "/api/data", {
          method: "POST",
          body: "x".repeat(5 * 1024 * 1024 + 1),
        })
      ).status,
      413,
    );
    assert.equal(
      (await fetch(origin + "/api/data", { method: "DELETE" })).status,
      405,
    );
    for (const route of [
      "/settings/system.json",
      "/runtime/system.lock",
      "/data/data.json",
      "/api/toString",
    ])
      assert.equal((await fetch(origin + route)).status, 404);
    await fs.writeFile(path.join(root, "settings/preferences.json"), "broken");
    assert.equal((await request("/api/preferences")).status, 500);
    assert.equal(
      (
        await request("/api/preferences", {
          data: defaults("preferences"),
          baseRevision: pref.revision,
        })
      ).status,
      500,
    );
    assert.equal(
      await fs.readFile(path.join(root, "settings/preferences.json"), "utf8"),
      "broken",
    );
    const disconnected = createHttpStore({
      fetch: async () => {
        throw new Error("offline");
      },
    });
    await assert.rejects(
      disconnected.write("data", board(), saved.revision),
      /offline/,
    );
    console.log(
      "Split HTTP: real GET/POST, independent revisions, 400/409/413/405/500, private paths and HTTP client passed",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// Модель общего localStorage и Web Locks; каждый адаптер — отдельная вкладка.
function browserEnvironment() {
  const copies = new Map([
    ["team-planner-v1", "legacy untouched"],
    ["team-planner-theme", "dark"],
  ]);
  let failing = false;
  const storage = {
    getItem: (key) => copies.get(key) ?? null,
    setItem: (key, value) => {
      if (failing) throw new Error("QuotaExceededError");
      copies.set(key, value);
    },
  };
  const queues = new Map();
  const locks = {
    request(name, options, action) {
      const previous = queues.get(name) || Promise.resolve();
      const result = previous.then(action);
      queues.set(
        name,
        result.catch(() => {}),
      );
      return result;
    },
  };
  const handlers = new Set();
  const events = {
    addEventListener: (name, handler) => handlers.add(handler),
    removeEventListener: (name, handler) => handlers.delete(handler),
  };
  return {
    copies,
    storage,
    locks,
    crypto: webcrypto,
    events,
    handlers,
    fail: (v) => {
      failing = v;
    },
  };
}
async function browserChecks() {
  const env = browserEnvironment();
  const first = createBrowserStore(env),
    second = createBrowserStore(env);
  const empty = await first.read("data");
  const outcomes = await Promise.allSettled(
    [first, second].map((store, i) =>
      store.write("data", { ...board(), team: String(i) }, empty.revision),
    ),
  );
  assert.equal(outcomes.filter((v) => v.status === "fulfilled").length, 1);
  assert.equal(
    outcomes.find((v) => v.status === "rejected").reason.code,
    "CONFLICT",
  );
  const pref = await first.read("preferences");
  const sys = await first.read("system");
  const boardBefore = env.copies.get(STORAGE_KEYS.data);
  await first.write(
    "preferences",
    { ...pref.data, theme: "dark" },
    pref.revision,
  );
  await second.patch({ calendar }, sys.revision);
  assert.equal(env.copies.get(STORAGE_KEYS.data), boardBefore);
  assert.equal(env.copies.get("team-planner-v1"), "legacy untouched");
  assert.equal(env.copies.get("team-planner-theme"), "dark");
  const next = await first.read("system");
  await assert.rejects(
    first.patch({ launcher }, next.revision),
    rejected("INVALID_DOCUMENT"),
  );
  const updatedPref = await first.read("preferences");
  const beforeFailure = new Map(env.copies);
  env.fail(true);
  await assert.rejects(
    first.write(
      "preferences",
      { ...updatedPref.data, theme: "light" },
      updatedPref.revision,
    ),
    /Quota/,
  );
  assert.deepEqual(env.copies, beforeFailure);
  env.fail(false);
  env.copies.set(STORAGE_KEYS.preferences, "{broken");
  await assert.rejects(first.read("preferences"), rejected("CORRUPT_DOCUMENT"));
  await assert.rejects(
    first.write("preferences", defaults("preferences"), updatedPref.revision),
    rejected("CORRUPT_DOCUMENT"),
  );
  assert.equal(env.copies.get(STORAGE_KEYS.preferences), "{broken");
  env.copies.set(
    STORAGE_KEYS.preferences,
    JSON.stringify({ ...defaults("preferences"), version: 99 }),
  );
  await assert.rejects(
    first.read("preferences"),
    rejected("UNSUPPORTED_VERSION"),
  );

  const readOnlyEnv = browserEnvironment();
  const readOnly = createBrowserStore({ ...readOnlyEnv, locks: null });
  const before = new Map(readOnlyEnv.copies);
  const readable = await readOnly.read("preferences");
  assert.equal(readable.readOnly, true);
  assert.deepEqual(readable.data, defaults("preferences"));
  await assert.rejects(
    readOnly.write(
      "preferences",
      { ...readable.data, theme: "dark" },
      readable.revision,
    ),
    rejected("READ_ONLY"),
  );
  await assert.rejects(
    readOnly.patch(
      { queueNotice: true },
      (await readOnly.read("system")).revision,
    ),
    rejected("READ_ONLY"),
  );
  assert.deepEqual(
    readOnlyEnv.copies,
    before,
    "чтение без Web Locks не создаёт ключи",
  );
  assert.equal(
    (await createBrowserStore({ ...readOnlyEnv, crypto: null }).read("data"))
      .readOnly,
    true,
  );
  const inaccessible = createBrowserStore({
    ...env,
    storage: {
      getItem() {
        throw new Error("SecurityError");
      },
    },
  });
  await assert.rejects(inaccessible.read("data"), /SecurityError/);
  const notifications = [];
  const unsubscribe = first.subscribe((kind) => notifications.push(kind));
  for (const handler of env.handlers) {
    handler({ storageArea: env.storage, key: STORAGE_KEYS.system });
    handler({ storageArea: env.storage, key: "unrelated" });
    handler({ storageArea: env.storage, key: null });
  }
  assert.deepEqual(notifications, ["system", "data", "preferences", "system"]);
  unsubscribe();
  assert.equal(env.handlers.size, 0);
  // Совпадение ревизий у двух реализаций необходимо для переноса адаптеров.
  const fileStore = await createFileStore(directory("revision"));
  const fresh = createBrowserStore(browserEnvironment());
  assert.equal(
    (await fresh.read("data")).revision,
    (await fileStore.read("data")).revision,
  );
  const b = await fresh.write(
    "data",
    board(),
    (await fresh.read("data")).revision,
  );
  const f = await fileStore.write(
    "data",
    board(),
    (await fileStore.read("data")).revision,
  );
  assert.equal(b.revision, f.revision);
  console.log(
    "Split browser: two tabs, category isolation, quota/security errors, corrupt/new versions, read-only mode, notifications and shared SHA-256 passed",
  );
}

async function gitChecks() {
  const root = directory("git-guard");
  await fs.mkdir(root);
  await fs.copyFile(
    new URL("../.gitignore", import.meta.url),
    path.join(root, ".gitignore"),
  );
  const hooks = fileURLToPath(
    new URL("../.githooks", import.meta.url),
  ).replaceAll("\\", "/");
  const execute = promisify(execFile);
  const git = (...args) =>
    execute(
      "git",
      [
        "-c",
        "user.name=Storage Test",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "core.hooksPath=" + hooks,
        ...args,
      ],
      { cwd: root, windowsHide: true },
    );
  await git("init", "--quiet");
  // Проверяем и положительный путь: установленный хук не блокирует код.
  await fs.writeFile(path.join(root, "code.js"), "// allowed\n");
  await git("add", "code.js");
  await git("commit", "--quiet", "-m", "Allowed test code");
  for (const name of [
    "settings/system.json",
    "runtime/server.pid",
    "data/data.json",
  ]) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), "{}\n");
    const ignored = await git("check-ignore", "--", name);
    assert.equal(ignored.stdout.trim(), name);
    await git("add", "-f", "--", name);
    await assert.rejects(
      git("commit", "--quiet", "-m", "Must be rejected"),
      (error) =>
        error.code === 1 &&
        (error.stdout + error.stderr).includes("КОММИТ ОТКЛОНЁН"),
    );
    await git("reset", "--quiet", "HEAD", "--", name);
  }
  console.log(
    "Split Git: ignored local directories, allowed code and rejected forced settings/runtime/data commits passed (isolated repository)",
  );
}

try {
  await fileChecks();
  await processChecks();
  await httpChecks();
  await browserChecks();
  await gitChecks();
  console.log("Split storage: all checks passed (temporary data only)");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
