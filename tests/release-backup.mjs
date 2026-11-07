// Настоящий HTTP-обработчик сервера с отдельным временным каталогом данных.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { once } from "node:events";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "planner-backup-test-"));
const module = { exports: {} };
const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
// Не запускаем поиск рабочего сервера, браузер, обработчики завершения и таймеры.
vm.runInNewContext(source.slice(0, source.indexOf('process.on("SIGINT"')) + "\nmodule.exports = server;", {
  require: createRequire(import.meta.url), __dirname: directory, module,
  process: { argv: [], pid: process.pid }, console, URL, Buffer,
  setInterval: () => ({ unref() {} }), setTimeout, clearTimeout,
});
const server = module.exports;
try {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const disk = { people: [], releases: [], tasks: [], team: "На диске" };
  const memory = { ...disk, team: "Ещё не сохранённая правка" };
  fs.mkdirSync(path.join(directory, "data"));
  const dataFile = path.join(directory, "data/data.json");
  fs.writeFileSync(dataFile, JSON.stringify(disk));
  const post = body => fetch(origin + "/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  for (let i = 0; i < 2; i++) {
    const response = await post(memory); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "data/backups", result.name))), memory);
    assert.deepEqual(JSON.parse(fs.readFileSync(dataFile)), disk, "backup must not replace working data");
  }
  const backups = await (await fetch(origin + "/api/backups")).json();
  assert.equal(backups.backups.length, 2, "both backups appear in Versions");
  assert.equal((await post({ tasks: [] })).status, 400);
  fs.rmSync(path.join(directory, "data/backups"), { recursive: true });
  fs.writeFileSync(path.join(directory, "data/backups"), "blocked");
  assert.equal((await post(memory)).status, 400);
  assert.deepEqual(JSON.parse(fs.readFileSync(dataFile)), disk);
  console.log("Release backup: all checks passed (real HTTP handler, exact memory snapshot, listing, validation and write failure)");
} finally {
  server.closeAllConnections(); server.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
