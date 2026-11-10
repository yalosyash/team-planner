import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';

// QA-DOC-01/03/05/06/07/09/16; first vertical scenario, steps 1–6.
test('QA-FLOW-001: черновик, дробная очередь, отсутствие и сохранение', async ({ page, installation }) => {
  const writes = [];
  page.on('response', response => {
    if (response.url().endsWith('/api/data') && response.request().method() === 'POST') writes.push(response);
  });
  await page.clock.setFixedTime(new Date('2026-11-16T09:00:00+03:00'));
  // Synthetic five-day calendar; never depend on the production calendar service.
  const days = Array.from({ length: 365 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, i + 1)).getUTCDay();
    return day === 0 || day === 6 ? '1' : '0';
  }).join('');
  await page.route('**/api/calendar?*', route => route.fulfill({ status: 200, body: days }));
  const read = async () => (await (await fetch(installation.origin + '/api/data')).json()).data;
  const memory = () => page.evaluate(async () => {
    const { state } = await import('/js/core/storage.js');
    return JSON.parse(JSON.stringify(state));
  });
  const saved = async () => {
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await expect.poll(read).toEqual(expect.objectContaining(await memoryBoard()));
  };
  const memoryBoard = async () => {
    const state = await memory();
    return { people: state.people, releases: state.releases, tasks: state.tasks };
  };
  await page.goto(installation.origin);
  await page.getByRole('button', { name: 'Добавить сотрудников', exact: true }).click();
  await page.locator('#pAdd').click();
  await page.locator('#plist input[data-n]').fill('Анна');
  expect((await memory()).people).toEqual([]);
  expect((await read())?.people ?? []).toEqual([]);
  await expect(page.getByText('Добавьте сотрудников', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Сотрудники', exact: true }).click();
  await expect(page.locator('#plist input')).toHaveCount(0);
  await page.locator('#pAdd').click();
  await page.locator('#plist input[data-n]').fill('Анна');
  await page.locator('#pDone').click();
  await expect(page.getByText('Создайте релиз', { exact: true })).toBeVisible();
  await saved();
  await page.getByRole('button', { name: '+ Новый релиз', exact: true }).click();
  await page.locator('#rNum').fill('QA-1');
  await page.locator('#rStart').fill('2026-11-16');
  await page.locator('#rEnd').fill('2026-11-20');
  await page.locator('#rSave').click();
  await expect(page.locator('.date-cell')).toHaveCount(5);
  await expect(page.locator('.pname')).toHaveText('Анна');
  await expect(page.locator('.psum')).toHaveText('Σ 0 дн');

  async function addTask(number, duration, absence = false) {
    await page.getByRole('button', { name: '+ Задача', exact: true }).click();
    if (absence) {
      await page.locator('#tType').selectOption('vacation');
      await page.locator('#tStart').fill('2026-11-16');
    } else {
      await page.locator('#tNum').fill(number);
      await page.locator('#tDesc').fill('Задача ' + number);
    }
    await page.locator('#tDays').fill(String(duration));
    await page.locator('#tSave').click();
    await expect(page.locator('#mTask')).not.toBeVisible();
  }
  const card = number => page.locator('.card.task').filter({ has: page.locator('.c-num', { hasText: number }) });
  // Compare visible geometry with independent day boundaries (EX-01), not plan.js.
  async function placement(number, start, end) {
    const rows = await page.locator('.date-cell').evaluateAll(nodes => nodes.map(n => ({ y: n.getBoundingClientRect().y, height: n.getBoundingClientRect().height })));
    const box = await card(number).boundingBox();
    expect(box).not.toBeNull();
    const unit = rows[0].height;
    expect(Math.abs(box.y - (rows[0].y + start * unit))).toBeLessThanOrEqual(3);
    expect(Math.abs(box.y + box.height - (rows[0].y + end * unit))).toBeLessThanOrEqual(3);
  }
  await addTask('A', 1.5);
  await addTask('B', 0.5);
  await expect(page.locator('.psum')).toHaveText('Σ 2 дн');
  await placement('A', 0, 1.5);
  await placement('B', 1.5, 2);
  await addTask('', 1, true);
  await expect(page.locator('.psum')).toHaveText('Σ 3 дн');
  await expect(page.locator('.psum')).toHaveAttribute('title', /Задач: 2 дн, рабочих дней в релизе: 5/);
  await placement('A', 1, 2.5);
  await placement('B', 2.5, 3);
  await card('A').click();
  await page.locator('#tDays').fill('0');
  await page.locator('#tSave').click();
  await expect(page.locator('#tErr')).toHaveText('Время должно быть больше 0');
  await expect(page.locator('#mTask')).toBeVisible();
  await page.keyboard.press('Escape');
  await saved();
  const expected = await read();
  expect(writes.length).toBeGreaterThan(0);
  for (const response of writes) expect(response.status()).toBe(200);
  expect(await writes.at(-1).json()).toEqual(expect.objectContaining({ ok: true, data: expected }));
  expect(expected.people.map(p => p.name)).toEqual(['Анна']);
  expect(expected.releases.map(r => [r.number, r.start, r.end])).toEqual([['QA-1', '2026-11-16', '2026-11-20']]);
  expect(expected.tasks.map(t => [t.number, t.days, t.start, t.type])).toEqual([
    ['A', 1.5, '2026-11-17', 'task'], ['B', 0.5, '2026-11-18', 'task'], ['', 1, '2026-11-16', 'vacation'],
  ]);
  expect(JSON.parse(await fs.readFile(path.join(installation.root, 'data/data.json'), 'utf8'))).toEqual(expected);
  await page.reload();
  await expect(page.locator('.psum')).toHaveText('Σ 3 дн');
  expect(await memoryBoard()).toEqual({ people: expected.people, releases: expected.releases, tasks: expected.tasks });
  await page.goto('about:blank');
  await installation.restart();
  await page.goto(installation.origin);
  await expect(page.locator('.pname')).toHaveText('Анна');
  await expect(page.locator('.psum')).toHaveText('Σ 3 дн');
  await placement('A', 1, 2.5);
  await placement('B', 2.5, 3);
  expect(await read()).toEqual(expected);
  expect(await memoryBoard()).toEqual({ people: expected.people, releases: expected.releases, tasks: expected.tasks });
});


