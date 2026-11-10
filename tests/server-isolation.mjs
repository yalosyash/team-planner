import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { defaults } from "../app/js/core/storage-schema.js";
import { startTestServer } from "./helpers/test-server.mjs";

const first = await startTestServer();
let second;
try {
  second = await startTestServer();
  assert.notEqual(first.origin, second.origin);
  const page = await fetch(first.origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/i);
  const get = async (fixture) => (await fetch(fixture.origin + "/api/data")).json();
  const initial = await get(first);
  const data = { ...defaults("data"), team: "Синтетическая QA-команда" };
  const saved = await fetch(first.origin + "/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, baseRevision: initial.revision }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await get(first)).data, data);
  assert.equal((await get(second)).data, null);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(first.root, "data/data.json"))), data);
  const oldOrigin = first.origin;
  await first.stop();
  await assert.rejects(fetch(oldOrigin));
  await first.restart();
  assert.deepEqual((await get(first)).data, data);
  for (const fixture of [first, second]) {
    for (const file of ["runtime/server.pid", "runtime/server.log"]) {
      await assert.rejects(fs.stat(path.join(fixture.root, file)), { code: "ENOENT" });
    }
  }
} finally {
  await Promise.all([first.dispose(), second?.dispose()]);
}
await assert.rejects(fs.stat(first.root), { code: "ENOENT" });
if (second) await assert.rejects(fs.stat(second.root), { code: "ENOENT" });
console.log("QA-01: isolated servers, HTTP persistence, restart and cleanup passed");
