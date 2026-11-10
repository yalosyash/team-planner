import { test, expect } from './fixtures.mjs';

// QA-DOC-01 / UC-START-001 / UI-SCREEN-001: empty installation.
test('QA-START-001: пустая установка готова к добавлению сотрудников', async ({ page, installation }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(installation.origin);
  await expect(page.getByText('Добавьте сотрудников', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Загрузить демо', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сотрудники', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Добавить сотрудников', exact: true }).click();
  await expect(page.locator('#mPeople .modal-h').filter({ hasText: 'Сотрудники отдела' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Добавить сотрудника', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Готово', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

// Loading failure must remain distinguishable from an empty board.
test('QA-START-002: ошибка загрузки блокирует редактор', async ({ page, installation }) => {
  await page.route('**/api/data', route => route.fulfill({
    status: 500, contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'QA: чтение недоступно' }),
  }));
  await page.goto(installation.origin);
  await expect(page.getByText(/Не удалось загрузить данные:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сотрудники', exact: true })).toBeDisabled();
  await expect(page.getByText('Добавьте сотрудников', { exact: true })).toHaveCount(0);
});

