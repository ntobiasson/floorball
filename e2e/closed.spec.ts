import { expect, test } from '@playwright/test';

/** The same app against an API whose date is pinned to Tuesday 20.10.2026. */

test('a day that is not a game day offers no form at all', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Tänään ei pelata' })).toBeVisible();
  await expect(page.getByText('tiistai 20.10.2026')).toBeVisible();
  await expect(page.getByText('21.10.2026')).toBeVisible();

  await expect(page.getByLabel('Nimi')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ilmoittaudu' })).toHaveCount(0);
});
