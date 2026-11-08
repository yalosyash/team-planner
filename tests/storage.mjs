import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { defaults } from "../app/js/core/storage-schema.js";
const require = createRequire(import.meta.url);
const { createFileStore } = require("../lib/file-store.cjs");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-state-"));
const events = {};
globalThis.window = { addEventListener: (name, fn) => (events[name] = fn) };
globalThis.document = { getElementById: () => null };
globalThis.location = { protocol: "http:" };
const copies = new Map();
globalThis.localStorage = {
  getItem: (key) => copies.get(key) ?? null,
  setItem: (key, value) => copies.set(key, value),
  removeItem: (key) => copies.delete(key),
  key: (i) => [...copies.keys()][i] ?? null,
  get length() {
    return copies.size;
  },
};
const store = await createFileStore(root);
await store.migrate();
let disk = {
  ...defaults("data"),
  releases: [{ id: "r", number: "1", start: "2026-11-02", end: "2026-11-30" }],
};
await store.write("data", disk, (await store.read("data")).revision);
const posts = [];
let offline = false,
  defer = false,
  finish;
const api = async (url, options = {}) => {
  if (offline) throw new Error("offline");
  if (url === "/api/health")
    return { ok: true, status: 200, json: async () => ({ storageVersion: 4 }) };
  const kind = url.slice(5);
  try {
    let result;
    if (options.method === "POST") {
      assert.equal(options.keepalive, true);
      const body = JSON.parse(options.body);
      posts.push({ kind, body });
      if (defer)
        await new Promise((resolve) => {
          finish = resolve;
        });
      result =
        kind === "system"
          ? await store.patch(body.patch, body.baseRevision)
          : await store.write(kind, body.data, body.baseRevision);
    } else result = await store.read(kind);
    return { ok: true, status: 200, json: async () => result };
  } catch (e) {
    return {
      ok: false,
      status: e.status || 500,
      json: async () => ({ error: e.message, code: e.code }),
    };
  }
};
globalThis.fetch = api;
const storage = await import("../app/js/core/storage.js");
try {
  const deleted = { ...disk, version: 3, releases: [] };
  copies.set("team-planner-v1", JSON.stringify(deleted));
  await storage.initStorage();
  assert.equal(
    storage.pendingLocal.releases.length,
    0,
    "Deletion must be offered for recovery",
  );
  storage.replaceState(storage.pendingLocal);
  storage.save();
  defer = true;
  const pending = storage.persist();
  while (!finish) await new Promise((r) => setImmediate(r));
  assert.equal(storage.hasUnsaved(), true);
  let beacon;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      sendBeacon(url) {
        beacon = url;
        return true;
      },
    },
  });
  events.pagehide();
  assert.equal(
    beacon,
    undefined,
    "Do not duplicate in-flight keepalive writes",
  );
  defer = false;
  finish();
  await pending;
  assert.equal(storage.hasUnsaved(), false);
  assert.equal((await store.read("data")).data.releases.length, 0);
  assert.equal(copies.has("team-planner-v1"), false);
  const boardRevision = (await store.read("data")).revision;
  posts.length = 0;
  storage.state.theme = "dark";
  storage.save();
  await storage.persist();
  assert.deepEqual(
    posts.map((v) => v.kind),
    ["preferences"],
  );
  assert.equal((await store.read("data")).revision, boardRevision);
  assert.equal((await store.read("preferences")).data.theme, "dark");
  // Launcher изменился после чтения system: календарь повторяется с новой
  // ревизией только при отсутствии пересечения с изменёнными секциями.
  await store.updateLauncher({
    desktopShortcutAsked: true,
    desktopShortcutCreated: false,
  });
  posts.length = 0;
  storage.state.calendar.years[2026] = { days: "0".repeat(365) };
  storage.save();
  await storage.persist();
  assert.deepEqual(
    posts.map((v) => v.kind),
    ["system", "system"],
  );
  assert.equal(
    (await store.read("system")).data.launcher.desktopShortcutAsked,
    true,
  );
  assert.equal(
    (await store.read("system")).data.calendar.years[2026].days.length,
    365,
  );
  storage.replaceState(disk);
  storage.state.activeId = "r";
  storage.replaceState({ ...disk, activeId: "foreign", queueNotice: false });
  assert.equal(
    storage.state.activeId,
    "r",
    "Full import retains existing recipient selection",
  );
  storage.replaceState({ ...deleted, theme: "light", calendar: { years: {} } });
  assert.equal(
    storage.state.theme,
    "dark",
    "Replacing board preserves recipient theme",
  );
  assert.equal(storage.state.calendar.years[2026].days.length, 365);
  assert.equal("theme" in JSON.parse(JSON.stringify(storage.state)), false);
  offline = true;
  storage.state.team = "Unsaved";
  storage.save();
  await storage.persist();
  assert.equal(storage.backend, "server");
  assert.equal(storage.hasUnsaved(), true);
  assert.ok(
    [...copies.keys()].some((k) => k.startsWith("team-planner-unsaved-v4:")),
  );
  offline = false;
  await storage.persist();
  assert.equal(storage.hasUnsaved(), false);
  const current = await store.read("data");
  await store.write(
    "data",
    { ...current.data, team: "Other tab" },
    current.revision,
  );
  storage.state.team = "Stale";
  storage.save();
  await storage.persist();
  assert.equal(storage.hasUnsaved(), true);
  assert.equal((await store.read("data")).data.team, "Other tab");
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(storage.initStorage(), /Сервер недоступен/);
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  });
  await assert.rejects(storage.initStorage(), /старым кодом/);
  console.log(
    "State storage: recovery, category isolation, launcher merge, imports, keepalive, offline/conflicts and old-server guard passed",
  );
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
