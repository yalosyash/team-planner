import assert from "node:assert/strict";
import { APP_VERSION, RELEASES_URL, compareVersions } from "../app/js/core/version.js";
import { initUpdates } from "../app/js/features/updates.js";

assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
assert.equal(compareVersions("v1.10.0", "1.9.9"), 1);
assert.equal(compareVersions("v1.0.9", "2.0.0"), -1);
assert.throws(() => compareVersions("v1.0.0-beta", APP_VERSION));
assert.throws(() => compareVersions("bad", APP_VERSION));
const elements = Object.fromEntries(
  ["btnUpdates", "toast", "appVersion"].map((id) => [id, {
    hidden: true, disabled: false, classList: { add() {}, remove() {} },
    addEventListener(event, handler) { this.click = handler; },
  }]),
);
globalThis.document = { querySelector: (selector) => elements[selector.slice(1)] };
let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error("Unexpected fetch"); };
initUpdates();
assert.equal(elements.appVersion.textContent, `Версия приложения ${APP_VERSION}`);
assert.equal(requests, 0, "Нет автоматических запросов при запуске");
const button = elements.btnUpdates;
const message = elements.toast;
let opened;
globalThis.window = { open(...args) { opened = args; } };
for (const [response, expected, showLink] of [
  [{ ok: true, json: async () => ({ tag_name: "v1.1.0" }) }, /Доступна версия v1.1.0/, true],
  [{ ok: true, json: async () => ({ tag_name: `v${APP_VERSION}` }) }, /последняя версия/, false],
  [{ ok: true, json: async () => ({ tag_name: "v0.9.0" }) }, /новее опубликованного/, false],
  [{ status: 404 }, /релизов пока нет/, false],
  [{ status: 403, ok: false }, /Не удалось/, false],
  [{ ok: true, json: async () => ({ tag_name: "bad" }) }, /Не удалось/, false],
  [{ ok: true, json: async () => ({ tag_name: "v2.0.0", prerelease: true }) }, /Не удалось/, false],
]) {
  initUpdates();
  globalThis.fetch = async () => response;
  await button.click();
  assert.match(message.textContent, expected);
  assert.equal(button.textContent, showLink ? "Открыть релиз" : "Проверить обновления");
  assert.equal(button.disabled, false);
  if (showLink) {
    await button.click();
    assert.deepEqual(opened, [RELEASES_URL, "_blank", "noopener,noreferrer"]);
  }
}
globalThis.fetch = async () => { throw new Error("offline"); };
await button.click();
assert.match(message.textContent, /Не удалось/);
let finish;
globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
const pending = button.click();
assert.equal(button.disabled, true);
assert.equal(button.textContent, "Проверка обновлений…");
await button.click(); // Повторный клик не запускает второй запрос.
finish({ status: 404 });
await pending;
assert.equal(button.disabled, false);
console.log("Проверка обновлений: OK");
