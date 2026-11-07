import assert from 'node:assert/strict';
globalThis.window = { addEventListener() {} };
globalThis.document = { querySelector() { return null; }, getElementById() { return null; } };
globalThis.localStorage = { getItem() { return null; } };
// Сохранение отложено: тест не обращается к пользовательским данным.
globalThis.setTimeout = () => 1;
globalThis.clearTimeout = () => {};
const storage = await import('../app/js/core/storage.js');
const { refreshCalendar, neededYears } = await import('../app/js/features/calendar.js');
const data = { people: [], releases: [{ id: 'r', start: '2025-12-30', end: '2026-01-05' }], tasks: [], calendar: { years: {} } };
const requests = [];
globalThis.fetch = async url => {
  if (url === '/api/data') return { ok: true, json: async () => ({ data }) };
  requests.push(url);
  return { ok: true, status: 200, text: async () => '0'.repeat(365) };
};
await storage.initStorage();
assert.deepEqual(neededYears(data, 2026), [2025, 2026]);
await refreshCalendar();
assert.equal(requests.length, 2);
assert.ok(data.calendar.years[2025]);
assert.ok(data.calendar.years[2026]);
await refreshCalendar();
assert.equal(requests.length, 2); // без повторных запросов при перерисовке
// Недоступный API сохраняет кэш.
const next = structuredClone(data);
storage.replaceState(next);
globalThis.fetch = async () => { throw new Error('offline'); };
await refreshCalendar();
assert.deepEqual(next.calendar, data.calendar);
// Старый сервер и некорректный ответ не записываются как календарь.
for (const response of [{ ok: false, status: 404 }, { ok: true, status: 200, text: async () => 'error' }]) {
  const fresh = { people: [], releases: [], tasks: [] };
  storage.replaceState(fresh);
  globalThis.fetch = async () => response;
  await refreshCalendar();
  assert.equal(fresh.calendar, undefined);
}
// Долгая задача за концом релиза требует календаря следующего года.
assert.deepEqual(neededYears({ releases: [{ id: 'r', start: '2026-12-31', end: '2026-12-31' }], tasks: [{ id: 't', personId: 'p', releaseId: 'r', days: 5 }] }, 2026), [2026, 2027]);
console.log('Automatic calendar: all checks passed');
