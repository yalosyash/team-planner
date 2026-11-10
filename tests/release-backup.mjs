// Настоящий HTTP-обработчик сервера с отдельным временным каталогом данных.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { once } from "node:events";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "planner-backup-test-"),
);
const require = createRequire(import.meta.url);
const { createPlannerServer } = require("../server.js");
const application = createPlannerServer({ root: directory });
const { server } = application;
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const disk = {
    version: 4,
    people: [],
    releases: [],
    tasks: [],
    team: "На диске",
  };
  const memory = { ...disk, team: "Ещё не сохранённая правка" };
  fs.mkdirSync(path.join(directory, "data"), { recursive: true });
  const dataFile = path.join(directory, "data/data.json");
  fs.writeFileSync(dataFile, JSON.stringify(disk));
  const post = (body) =>
    fetch(origin + "/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  for (let i = 0; i < 2; i++) {
    const response = await post(memory);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(directory, "data/backups", result.name)),
      ),
      memory,
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(dataFile)),
      disk,
      "backup must not replace working data",
    );
  }
  const backups = await (await fetch(origin + "/api/backups")).json();
  assert.equal(backups.backups.length, 2, "both backups appear in Versions");
  assert.equal((await post({ tasks: [] })).status, 400);
  // Две вкладки прочитали одну версию; старая не должна вернуть удалённый релиз.
  const loaded = await (await fetch(origin + "/api/data")).json();
  const write = (body) =>
    fetch(origin + "/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const withRelease = {
    ...disk,
    releases: [
      { id: "r", number: "1", start: "2026-11-02", end: "2026-11-30" },
    ],
  };
  const first = await write({
    data: withRelease,
    baseRevision: loaded.revision,
  });
  assert.equal(first.status, 200);
  const saved = await first.json();
  assert.equal(
    (await write({ data: disk, baseRevision: saved.revision })).status,
    200,
  );
  assert.equal(
    (await write({ data: withRelease, baseRevision: saved.revision })).status,
    409,
  );
  assert.equal(
    (await write(withRelease)).status,
    400,
    "Old application tabs must also be rejected",
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(dataFile)), disk);
  const restore = async (name, baseRevision) => {
    baseRevision ??= (await (await fetch(origin + "/api/data")).json())
      .revision;
    return fetch(origin + "/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, baseRevision }),
    });
  };
  const staleRevision = (await (await fetch(origin + "/api/data")).json())
    .revision;
  const concurrent = await write({
    data: { ...disk, team: "Concurrent" },
    baseRevision: staleRevision,
  });
  assert.equal(concurrent.status, 200);
  assert.equal(
    (await restore(backups.backups[0].name, staleRevision)).status,
    409,
  );
  assert.equal(JSON.parse(fs.readFileSync(dataFile)).team, "Concurrent");
  const concurrentRevision = (await concurrent.json()).revision;
  assert.equal(
    (await write({ data: disk, baseRevision: concurrentRevision })).status,
    200,
  );
  const mixed = {
    ...memory,
    theme: "dark",
    activeId: "foreign",
    calendar: { invalid: true },
    queueNotice: true,
  };
  const cleanBackup = await (await post(mixed)).json();
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(directory, "data/backups", cleanBackup.name)),
    ),
    memory,
  );
  const historicalName = "data_2020-01-01_00-00-00_historical.json";
  const historicalPath = path.join(directory, "data/backups", historicalName);
  const historicalBytes = JSON.stringify({ ...mixed, version: 3 });
  fs.writeFileSync(historicalPath, historicalBytes);
  assert.equal((await restore(historicalName)).status, 200);
  assert.equal(fs.readFileSync(historicalPath, "utf8"), historicalBytes);
  assert.deepEqual(JSON.parse(fs.readFileSync(dataFile)), memory);
  const resetRevision = (await (await fetch(origin + "/api/data")).json())
    .revision;
  await write({ data: disk, baseRevision: resetRevision });
  const restored = await restore(backups.backups[0].name);
  assert.equal(restored.status, 200);
  const restoredResult = await restored.json();
  assert.deepEqual(restoredResult.data, memory);
  const versions = await (await fetch(origin + "/api/backups")).json();
  const beforeRestore = versions.backups.find((b) =>
    b.name.includes("before-restore"),
  );
  assert.ok(beforeRestore, "Snapshot before restoration must be listed");
  assert.equal((await restore(beforeRestore.name)).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(dataFile)), disk);
  fs.rmSync(path.join(directory, "data/backups"), { recursive: true });
  fs.writeFileSync(path.join(directory, "data/backups"), "blocked");
  assert.equal((await post(memory)).status, 400);
  assert.deepEqual(JSON.parse(fs.readFileSync(dataFile)), disk);
  console.log(
    "Release backup: all checks passed (real HTTP handler, exact memory snapshot, listing, validation and write failure)",
  );
} finally {
  server.closeAllConnections();
  await application.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
