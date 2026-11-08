import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { prepareStorageMigration } from "../app/js/core/storage-migration.js";
import { migrateTasks } from "../app/js/core/task-migration.js";
import { defaults } from "../app/js/core/storage-schema.js";
import { bindCalendar } from "../app/js/core/calendar.js";
import { planPerson } from "../app/js/core/plan.js";
import { exportRelease } from "../app/js/core/release-transfer.js";
import { createBrowserStore } from "../app/js/core/split-storage.js";
import { STORAGE_KEYS } from "../app/js/core/storage-schema.js";
import { webcrypto } from "node:crypto";

const require = createRequire(import.meta.url);
const { createFileStore } = require("../lib/file-store.cjs");
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "planner-migration-"),
);
const board = () => ({
  version: 3,
  team: "Команда",
  theme: "dark",
  activeId: "r",
  queueNotice: true,
  calendar: { years: { 2026: { days: "0".repeat(365) } } },
  people: [{ id: "p", name: "Анна", color: "#aabbcc" }],
  releases: [{ id: "r", number: "1", start: "2026-11-02", end: "2026-11-30" }],
  // Намеренно противоположно start: очередь уже задана пользователем.
  tasks: ["2026-11-10", "2026-11-02"].map((start, i) => ({
    id: "t" + i,
    personId: "p",
    releaseId: "r",
    type: "task",
    days: i + 0.5,
    start,
    daysMode: "work",
    weekend: false,
    labels: ["FE", "BE"],
    title: "Задача " + i,
  })),
});
const code = (value) => (error) => error.code === value;
async function write(root, relative, value) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
}
const read = (root, relative) => fs.readFile(path.join(root, relative), "utf8");
async function initialize(name, options = {}) {
  const root = path.join(temporary, name);
  await write(root, "data/data.json", board());
  await write(root, "data/launcher.json", {
    desktopShortcutAsked: true,
    desktopShortcutCreated: false,
  });
  return { root, store: await createFileStore(root, options) };
}

try {
  const source = board();
  const original = structuredClone(source);
  const prepared = prepareStorageMigration({ data: source });
  assert.deepEqual(source, original, "исходник не мутирует");
  assert.deepEqual(
    prepared.data.tasks.map((t) => t.id),
    ["t0", "t1"],
  );
  assert.deepEqual(
    prepared.data.tasks.map((t) => t.days),
    [0.5, 1.5],
  );
  bindCalendar(() => original.calendar);
  const placement = (v) =>
    planPerson("p", v.releases[0], v.tasks).cards.map(
      ({ task, start, segs }) => ({ id: task.id, start, segs }),
    );
  assert.deepEqual(placement(source), placement(prepared.data));
  assert.deepEqual(migrateTasks(structuredClone(prepared.data)), prepared.data);
  assert.equal(prepared.preferences.theme, "dark");
  assert.equal(prepared.system.queueNotice, true);
  assert.deepEqual(prepared.system.calendar, source.calendar);
  assert.deepEqual(prepareStorageMigration({ data: null }).data, null);
  const priority = prepareStorageMigration({
    data: source,
    preferences: { version: 1, theme: "light", activeId: null },
    launcher: { desktopShortcutAsked: true, desktopShortcutCreated: true },
    system: {
      version: 1,
      calendar: { years: {} },
      queueNotice: false,
      launcher: { desktopShortcutAsked: false, desktopShortcutCreated: false },
      extension: { keep: true },
    },
  });
  assert.equal(priority.preferences.theme, "light");
  assert.deepEqual(priority.system.calendar, { years: {} });
  assert.equal(priority.system.queueNotice, false);
  assert.equal(priority.system.launcher.desktopShortcutAsked, false);
  assert.deepEqual(priority.system.extension, { keep: true });
  const rich = exportRelease(prepared.data, "r").next;
  assert.deepEqual(
    prepareStorageMigration({ data: { ...rich, version: 3 } }).data,
    rich,
    "связи обмена и история сохраняются",
  );
  const leaked = board();
  leaked.people[0].theme = "dark";
  leaked.tasks[0].calendar = { years: {} };
  const filtered = prepareStorageMigration({ data: leaked });
  assert.equal("theme" in filtered.data.people[0], false);
  assert.equal("calendar" in filtered.data.tasks[0], false);
  for (const mutate of [
    (v) => (v.version = 99),
    (v) => (v.tasks[0].days = -1),
    (v) => (v.tasks[0].personId = "missing"),
    (v) => (v.tasks[0].start = "2026-02-31"),
    (v) => (v.tasks[0].labels = ["unknown"]),
    (v) => (v.tasks[0].daysMode = "future"),
    (v) => v.people.push(v.people[0]),
  ]) {
    const bad = board();
    mutate(bad);
    assert.throws(() => prepareStorageMigration({ data: bad }));
  }
  // Старый формат: преобразуется только группа со старыми задачами.
  const old = board();
  old.version = 2;
  old.people.push({ ...old.people[0], id: "q" });
  old.tasks.push(
    ...old.tasks.map((v) => ({ ...v, id: v.id + "q", personId: "q" })),
  );
  old.tasks.slice(0, 2).forEach((v) => {
    delete v.daysMode;
    v.days = 3;
  });
  const migrated = prepareStorageMigration({ data: old }).data;
  assert.deepEqual(
    migrated.tasks.map((v) => v.id),
    ["t1", "t0", "t0q", "t1q"],
  );
  assert.equal(migrated.tasks.find((v) => v.id === "t0").days, 3);
  assert.deepEqual(migrateTasks(structuredClone(migrated)), migrated);
  const absence = board();
  absence.tasks.push({
    id: "a",
    personId: "p",
    releaseId: "r",
    type: "vacation",
    start: "2026-11-04",
    days: 2,
  });
  assert.deepEqual(
    prepareStorageMigration({ data: absence }).data.tasks.map((v) => v.id),
    ["t0", "t1", "a"],
    "отсутствие без старого маркера не сортирует современную рабочую очередь",
  );
  const collision = {
    tasks: [
      {
        id: "old",
        releaseId: "a|b",
        personId: "c",
        start: "2026-11-10",
        days: 1,
      },
      {
        id: "modern1",
        releaseId: "a",
        personId: "b|c",
        start: "2026-11-10",
        days: 1,
        daysMode: "work",
      },
      {
        id: "modern2",
        releaseId: "a",
        personId: "b|c",
        start: "2026-11-02",
        days: 1,
        daysMode: "work",
      },
    ],
  };
  assert.deepEqual(
    migrateTasks(collision).tasks.map((v) => v.id),
    ["old", "modern1", "modern2"],
  );

  const { root, store } = await initialize("normal");
  const bytes = await read(root, "data/data.json");
  const result = await store.migrate();
  assert.equal(result.migrated, true);
  const manifest = JSON.parse(
    await fs.readFile(path.join(result.backup, "manifest.json"), "utf8"),
  );
  for (const entry of manifest.sources) {
    if (!entry.present) continue;
    const saved = await fs.readFile(path.join(result.backup, entry.copy));
    assert.equal(
      createHash("sha256").update(saved).digest("hex"),
      entry.sha256,
    );
  }
  assert.equal(
    await fs.readFile(path.join(result.backup, "data.json"), "utf8"),
    bytes,
  );
  assert.deepEqual((await store.read("data")).data, prepared.data);
  assert.equal((await store.read("system")).data.migrations.splitStorage, 1);
  const once = await read(root, "data/data.json");
  assert.deepEqual(await store.migrate(), { migrated: false, backup: null });
  assert.equal(await read(root, "data/data.json"), once);
  assert.equal(
    (await fs.readdir(path.join(root, "settings/migration-backups"))).length,
    1,
  );
  // Исходники launcher не удаляем до переключения цепочки запуска.
  assert.equal(
    JSON.parse(await read(root, "data/launcher.json")).desktopShortcutAsked,
    true,
  );

  const emptyRoot = path.join(temporary, "empty");
  const emptyStore = await createFileStore(emptyRoot);
  await emptyStore.migrate();
  assert.equal((await emptyStore.read("data")).data, null);
  assert.deepEqual(
    (await emptyStore.read("preferences")).data,
    defaults("preferences"),
  );

  // Отказ каждой отдельной записи, включая финальный маркер. Повторный
  // запуск из сохранённого частичного состояния должен закончить переход.
  for (const phase of ["backup", "preferences", "system", "data", "marker"]) {
    let systemWrites = 0;
    const io = {
      ...fs,
      async open(file, ...args) {
        if (phase === "backup" && file.endsWith("manifest.json"))
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        return fs.open(file, ...args);
      },
      async rename(from, to) {
        if (to.endsWith(path.join("settings", "system.json"))) systemWrites++;
        if (
          (phase === "preferences" && to.endsWith("preferences.json")) ||
          (phase === "system" && to.endsWith("system.json")) ||
          (phase === "data" && to.endsWith("data.json")) ||
          (phase === "marker" &&
            systemWrites === 2 &&
            to.endsWith("system.json"))
        )
          throw Object.assign(new Error("access denied"), { code: "EPERM" });
        return fs.rename(from, to);
      },
    };
    const failed = await initialize("fail-" + phase, { io });
    const before = await read(failed.root, "data/data.json");
    await assert.rejects(
      failed.store.migrate(),
      (e) => !!e.backup && e.message.includes(e.backup),
    );
    if (phase !== "marker")
      assert.equal(await read(failed.root, "data/data.json"), before);
    const recovered = await createFileStore(failed.root);
    await recovered.migrate();
    assert.deepEqual((await recovered.read("data")).data, prepared.data);
    assert.equal((await recovered.read("preferences")).data.theme, "dark");
    assert.equal(
      (await recovered.read("system")).data.launcher.desktopShortcutAsked,
      true,
    );
    assert.equal(
      (await recovered.read("system")).data.migrations.splitStorage,
      1,
    );
    assert.deepEqual(await fs.readdir(path.join(failed.root, "runtime")), []);
  }
  const concurrent = await initialize("concurrent");
  const other = await createFileStore(concurrent.root);
  const runs = await Promise.all([concurrent.store.migrate(), other.migrate()]);
  assert.equal(runs.filter((v) => v.migrated).length, 1);
  for (const pid of [String(process.pid), "invalid"]) {
    const blocked = await initialize("pid-" + pid);
    await write(blocked.root, "data/server.pid", pid);
    const before = await read(blocked.root, "data/data.json");
    await assert.rejects(
      blocked.store.migrate(),
      code(pid === "invalid" ? "MIGRATION_PID" : "MIGRATION_RUNNING"),
    );
    assert.equal(await read(blocked.root, "data/data.json"), before);
    assert.equal(await read(blocked.root, "data/server.pid"), pid);
  }
  const corrupt = await initialize("corrupt");
  await write(corrupt.root, "data/data.json", "{broken");
  await assert.rejects(corrupt.store.migrate(), code("CORRUPT_DOCUMENT"));
  assert.equal(await read(corrupt.root, "data/data.json"), "{broken");
  // Если старый писатель изменил исходник во время подготовки, отказ
  // сохраняет его новые байты вместо записи устаревшей доски.
  const changedRoot = path.join(temporary, "external-writer");
  await write(changedRoot, "data/data.json", board());
  const changed = { ...board(), team: "Внешняя правка" };
  const externalIO = {
    ...fs,
    async rename(from, to) {
      await fs.rename(from, to);
      if (to.endsWith("preferences.json"))
        await write(changedRoot, "data/data.json", changed);
    },
  };
  const changedStore = await createFileStore(changedRoot, { io: externalIO });
  await assert.rejects(changedStore.migrate(), code("CONFLICT"));
  assert.deepEqual(
    JSON.parse(await read(changedRoot, "data/data.json")),
    changed,
  );
  // Настоящие протоколы адаптера с управляемыми отказами localStorage.
  function browser(phase) {
    const values = new Map([["team-planner-v1", JSON.stringify(board())]]);
    const tails = new Map();
    const locks = {
      request(key, options, action) {
        const next = (tails.get(key) ?? Promise.resolve()).then(action);
        tails.set(
          key,
          next.catch(() => {}),
        );
        return next;
      },
    };
    let systemWrites = 0;
    let fail = true;
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem(key, value) {
        if (key === STORAGE_KEYS.system) systemWrites++;
        if (
          fail &&
          ((phase === "backup" && key === "team-planner-migration-v1") ||
            (phase === "preferences" && key === STORAGE_KEYS.preferences) ||
            (phase === "system" && key === STORAGE_KEYS.system) ||
            (phase === "data" && key === STORAGE_KEYS.data) ||
            (phase === "marker" &&
              key === STORAGE_KEYS.system &&
              systemWrites === 2))
        )
          throw new Error("QuotaExceededError");
        values.set(key, value);
      },
    };
    return {
      values,
      storage,
      locks,
      retry: () => {
        fail = false;
      },
      adapter: () =>
        createBrowserStore({ storage, locks, crypto: webcrypto, events: null }),
    };
  }
  for (const phase of [
    null,
    "backup",
    "preferences",
    "system",
    "data",
    "marker",
  ]) {
    const fixture = browser(phase);
    const legacy = fixture.values.get("team-planner-v1");
    const adapter = fixture.adapter();
    if (phase !== null) {
      await assert.rejects(adapter.migrate(), /QuotaExceededError/);
      fixture.retry();
    }
    const first = await adapter.migrate();
    assert.equal(first.migrated, true);
    assert.equal(fixture.values.has("team-planner-v1"), false);
    const backup = fixture.values.get("team-planner-migration-v1");
    assert.equal(JSON.parse(backup).sources["team-planner-v1"], legacy);
    assert.deepEqual((await adapter.read("data")).data, prepared.data);
    assert.equal(
      (await adapter.read("system")).data.migrations.splitStorage,
      1,
    );
    assert.deepEqual(await fixture.adapter().migrate(), {
      migrated: false,
      backup: null,
    });
    assert.equal(fixture.values.get("team-planner-migration-v1"), backup);
  }
  const tabs = browser();
  const simultaneous = await Promise.all([
    tabs.adapter().migrate(),
    tabs.adapter().migrate(),
  ]);
  assert.equal(simultaneous.filter((v) => v.migrated).length, 1);
  const readOnly = createBrowserStore({
    storage: tabs.storage,
    locks: null,
    crypto: webcrypto,
  });
  await assert.rejects(readOnly.migrate(), code("READ_ONLY"));
  const brokenBackup = browser();
  brokenBackup.values.set("team-planner-migration-v1", "{bad");
  await assert.rejects(
    brokenBackup.adapter().migrate(),
    code("MIGRATION_BACKUP"),
  );
  assert.equal(brokenBackup.values.has(STORAGE_KEYS.data), false);
  console.log(
    "Storage migration: queue/placement, backups, restart, interrupted writes, concurrency and PID: passed",
  );
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
