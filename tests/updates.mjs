import assert from "node:assert/strict";
import {
  APP_VERSION,
  RELEASES_URL,
  compareVersions,
} from "../app/js/core/version.js";
import { initUpdates } from "../app/js/features/updates.js";

assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
assert.equal(compareVersions("v1.10.0", "1.9.9"), 1);
assert.equal(compareVersions("v1.0.9", "2.0.0"), -1);
assert.throws(() => compareVersions("v1.0.0-beta", APP_VERSION));
assert.throws(() => compareVersions("bad", APP_VERSION));
const elements = Object.fromEntries(
  ["btnUpdates", "toast", "appVersion", "updateNotice", "btnMore"].map((id) => [
    id,
    {
      hidden: true,
      disabled: false,
      classList: { add() {}, remove() {} },
      addEventListener(event, handler) {
        this.click = handler;
      },
      setAttribute(name, value) {
        this[name] = value;
      },
    },
  ]),
);
const listeners = {};
globalThis.document = {
  visibilityState: "visible",
  querySelector: (selector) => elements[selector.slice(1)],
  addEventListener(type, fn) {
    listeners[type] = fn;
  },
  removeEventListener() {},
};
let periodic;
globalThis.setInterval = (fn, delay) => {
  assert.equal(delay, 3600000);
  periodic = fn;
  return 1;
};
globalThis.clearInterval = () => {};
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
let requests = 0;
globalThis.fetch = async () => {
  requests++;
  throw new Error("Unexpected fetch");
};
globalThis.window = {
  addEventListener(type, fn) {
    listeners[type] = fn;
  },
  removeEventListener() {},
  open(...args) {
    opened = args;
  },
};
let opened;
initUpdates();
await settle();
assert.equal(
  elements.appVersion.textContent,
  `Версия приложения ${APP_VERSION}`,
);
assert.equal(requests, 1, "Автоматическая проверка при запуске");
assert.equal(
  elements.toast.textContent,
  undefined,
  "Ошибка фоновой проверки не мешает работе",
);
periodic();
assert.equal(requests, 1, "Повторная проверка только через час");
const button = elements.btnUpdates;
const message = elements.toast;
for (const [response, expected, showLink] of [
  [
    { ok: true, json: async () => ({ tag_name: "v1.1.0" }) },
    /Доступна версия v1.1.0/,
    true,
  ],
  [
    { ok: true, json: async () => ({ tag_name: `v${APP_VERSION}` }) },
    /последняя версия/,
    false,
  ],
  [
    { ok: true, json: async () => ({ tag_name: "v0.9.0" }) },
    /новее опубликованного/,
    false,
  ],
  [{ status: 404 }, /релизов пока нет/, false],
  [{ status: 403, ok: false }, /Не удалось/, false],
  [{ ok: true, json: async () => ({ tag_name: "bad" }) }, /Не удалось/, false],
  [
    { ok: true, json: async () => ({ tag_name: "v2.0.0", prerelease: true }) },
    /Не удалось/,
    false,
  ],
]) {
  globalThis.fetch = async () => ({ status: 404 });
  initUpdates();
  await settle();
  globalThis.fetch = async () => response;
  await button.click();
  assert.match(message.textContent, expected);
  assert.equal(
    button.textContent,
    showLink ? "Доступна версия 1.1.0" : "Проверить обновления",
  );
  assert.equal(button.disabled, false);
  if (showLink) {
    assert.equal(elements.updateNotice.hidden, false);
    assert.match(elements.btnMore["aria-label"], /v1.1.0/);
    await button.click();
    assert.deepEqual(opened, [RELEASES_URL, "_blank", "noopener,noreferrer"]);
  }
}
globalThis.fetch = async () => {
  throw new Error("offline");
};
await button.click();
assert.match(message.textContent, /Не удалось/);
let finish;
globalThis.fetch = () =>
  new Promise((resolve) => {
    finish = resolve;
  });
const pending = button.click();
assert.equal(button.disabled, true);
assert.equal(button.textContent, "Проверка обновлений…");
await button.click(); // Повторный клик не запускает второй запрос.
finish({ status: 404 });
await pending;
assert.equal(button.disabled, false);
console.log("Проверка обновлений: OK");

let now = Date.now();
const realNow = Date.now;
Date.now = () => now;
globalThis.fetch = async () => {
  requests++;
  return { ok: true, json: async () => ({ tag_name: "v1.2.0" }) };
};
now += 3600001;
listeners.visibilitychange();
await settle();
assert.match(elements.btnMore.title, /v1.2.0/);
const count = requests;
periodic();
assert.equal(requests, count);
now += 3600001;
document.visibilityState = "hidden";
periodic();
assert.equal(requests, count);
document.visibilityState = "visible";
listeners.focus();
await settle();
assert.equal(requests, count + 1);
Date.now = realNow;
