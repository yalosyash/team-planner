import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

// Настоящие обработчики people/modal/palette, синтетический DOM и хранилище.
// Не запускает сервер и не читает рабочие data/settings/runtime.
class Node extends EventTarget {
  constructor() {
    super(); this.dataset = {}; this.children = []; this.style = {};
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => this.classes.add(n)),
      remove: (...names) => names.forEach((n) => this.classes.delete(n)),
      contains: (n) => this.classes.has(n),
      toggle: (n, on) => on ? this.classes.add(n) : this.classes.delete(n),
    };
  }
  set innerHTML(value) {
    this.html = value;
    if (this === list) this.children = [...value.matchAll(/class="prow" data-id="([^"]+)"/g)].map((m) => {
      const row = new Node(); row.dataset.id = m[1];
      row.controls = Object.fromEntries(["[data-n]", "[data-c-open]", "[data-x]"].map((k) => [k, new Node()]));
      return row;
    });
  }
  get innerHTML() { return this.html; }
  querySelector(q) { return this.controls?.[q] ?? null; }
  querySelectorAll(q) { return q === ".prow" ? this.children : []; }
  closest(q) { return q === ".modal-back" ? modal : q === "[data-pal]" ? this : null; }
  getBoundingClientRect() { return { top: 10, height: 20, bottom: 30, right: 100, width: 80 }; }
  setAttribute() {}
  appendChild(node) { this.children.push(node); node.isConnected = true; }
  remove() { this.isConnected = false; }
  contains(node) { return node === this || this.children.includes(node); }
  focus() {}
  select() {}
}
const list = new Node(), modal = new Node(), add = new Node(), done = new Node(), cross = new Node();
modal.id = "mPeople";
const document = new Node(); document.body = new Node();
const elements = { "#plist": list, "#mPeople": modal, "#pAdd": add, "#pDone": done };
document.querySelector = (q) => elements[q] ?? null;
document.querySelectorAll = (q) => q === "[data-close]" ? [cross] : q === ".modal-back" ? [modal] : q === ".modal-back.open" && modal.classes.has("open") ? [modal] : [];
document.createElement = () => new Node();
const window = new Node(); window.innerWidth = 900; window.innerHeight = 900;
let saves = 0, renders = 0, answer = true, confirmations = [], nextId = 0;
const state = {
  people: [{ id: "a", name: "Анна", color: "#111111" }, { id: "b", name: "Борис", color: "#222222" }],
  tasks: [{ id: "t1", personId: "a", releaseId: "r1", type: "task" }, { id: "t2", personId: "a", releaseId: "r2", type: "vacation" }, { id: "t3", personId: "b", releaseId: "r2", type: "sick" }],
};
const context = vm.createContext({ document, window, Element: Node, Event, setTimeout: (fn) => fn(), confirm: (s) => { confirmations.push(s); return answer; } });
const stubs = {
  "core/dom.js": { $: (q) => document.querySelector(q), esc: (s) => String(s) },
  "core/util.js": { PALETTE: ["#111111", "#222222", "#333333"], uid: () => "new" + ++nextId },
  "core/storage.js": { state, save: () => saves++ },
  "core/render.js": { render: () => renders++ },
};
const cache = new Map();
async function load(name) {
  if (cache.has(name)) return cache.get(name);
  let module;
  if (stubs[name]) {
    const exports = stubs[name];
    module = new vm.SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); }, { context });
  } else {
    module = new vm.SourceTextModule(await fs.readFile(new URL("../app/js/" + name, import.meta.url), "utf8"), { context, identifier: name });
  }
  cache.set(name, module);
  await module.link((specifier, parent) => load(new URL(specifier, "https://test/" + parent.identifier).pathname.slice(1)));
  return module;
}
const people = await load("features/people.js"); await people.evaluate();
const modals = cache.get("ui/modal.js"); modals.namespace.initModals(); people.namespace.initPeople();
const fire = (node, type, props = {}) => {
  const event = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(event, k, { value: v });
  node.dispatchEvent(event);
};
const click = (node) => fire(node, "click");
const row = (id) => list.children.find((r) => r.dataset.id === id);
const rename = (id, name) => { const input = row(id).querySelector("[data-n]"); input.value = name; fire(input, "input"); };
const color = (id, value) => {
  click(row(id).querySelector("[data-c-open]"));
  const pop = document.body.children.at(-1), swatch = new Node(); swatch.dataset.pal = value;
  fire(pop, "click", { target: swatch });
};
const reorder = () => {
  const dataTransfer = { setData() {} };
  fire(row("b"), "dragstart", { dataTransfer });
  fire(row("a"), "drop", { clientY: 10 });
};
const original = JSON.stringify(state);
for (const cancel of [() => fire(document, "keydown", { key: "Escape" }), () => click(cross), () => fire(modal, "mousedown")]) {
  people.namespace.openPeople();
  rename("a", "Черновик"); color("a", "#333333"); reorder(); click(add);
  click(row("a").querySelector("[data-x]"));
  assert.equal(JSON.stringify(state), original, "редактирование не меняет общую доску");
  assert.equal(saves, 0); assert.equal(renders, 0);
  cancel(); assert.equal(modal.classes.has("open"), false);
  people.namespace.openPeople();
  assert.deepEqual(list.children.map((r) => r.dataset.id), ["a", "b"], "отмена возвращает исходный список");
  click(done); assert.equal(saves, 0, "Готово без изменений не пишет данные");
}
people.namespace.openPeople(); answer = false;
click(row("a").querySelector("[data-x]")); assert.ok(row("a"), "отмена подтверждения сохраняет строку");
answer = true;
rename("a", "Анна новая"); color("a", "#333333"); reorder(); click(add);
assert.equal(JSON.stringify(state), original);
click(done);
assert.deepEqual(state.people.map((p) => p.id), ["b", "a", "new4"]);
assert.equal(state.people[1].name, "Анна новая"); assert.equal(state.people[1].color, "#333333");
assert.equal(state.tasks.length, 3); assert.equal(saves, 1); assert.equal(renders, 1);
people.namespace.openPeople(); click(row("a").querySelector("[data-x]"));
assert.equal(state.tasks.length, 3, "до Готово связанные записи не удаляются");
click(done);
assert.deepEqual(state.tasks.map((t) => t.id), ["t3"], "применение удаляет работы и отсутствия во всех релизах");
assert.equal(saves, 2); assert.equal(renders, 2);
assert.ok(confirmations.some((text) => text.includes("2 задач(и)") && text.includes("Готово")));
assert.equal(modal.classes.has("open"), false);
console.log("People draft: apply, cancel (Escape/cross/backdrop), colors, order, add, delete and confirmation passed");
