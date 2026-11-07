import assert from "node:assert/strict";

const events = {};
globalThis.window = { addEventListener(name, handler) { events[name] = handler; } };
globalThis.document = { getElementById() { return null; } };
const copies = new Map();
globalThis.localStorage = {
  getItem: key => copies.get(key) ?? null,
  setItem: (key, value) => copies.set(key, value),
  removeItem: key => copies.delete(key),
};
const storage = await import("../app/js/core/storage.js");
const old = { version: 3, people: [], releases: [{ id: "r" }], tasks: [] };
const deleted = { ...old, releases: [] };
copies.set("team-planner-v1", JSON.stringify(deleted));
globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: structuredClone(old) }) });
await storage.initStorage();
assert.deepEqual(storage.pendingLocal, deleted, "Deletion without tasks must be offered for recovery");

storage.replaceState(deleted);
let finish;
globalThis.fetch = (url, options) => {
  assert.equal(options.keepalive, true);
  assert.deepEqual(JSON.parse(options.body).data.releases, []);
  return new Promise(resolve => { finish = resolve; });
};
storage.save();
storage.persistServer();
assert.equal(storage.hasUnsaved(), true);
let beacon;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  sendBeacon(url, body) { beacon = body; return true; },
} });
events.pagehide();
assert.equal(beacon, undefined, "Reload must not duplicate an in-flight keepalive request");
finish({ ok: true, json: async () => ({ ok: true }) });
await new Promise(resolve => setImmediate(resolve));
assert.equal(storage.hasUnsaved(), false, "Completed save must clear the pending timer");
console.log("Storage deletion recovery and reload: passed");
