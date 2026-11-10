import { test, expect } from './fixtures.mjs';

test('CI acceptance: deliberate failure must make QA result red', async ({ page, installation }) => {
  await page.goto(installation.origin);
  await expect(page.getByRole('heading', { name: 'CI deliberate failure' })).toBeVisible({ timeout: 1000 });
});
