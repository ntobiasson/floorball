import { expect, test } from '@playwright/test';

/** The same app against an API whose date is pinned to Tuesday 20.10.2026. */

test('a day that is not a game day offers no form at all', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Tänään ei pelata' })).toBeVisible();
  await expect(page.getByText('tiistai 20.10.2026')).toBeVisible();
  // Weekday and date on one line, the time on its own beneath. Both come from
  // the seeded schedule rather than the calendar, so between them they prove
  // the next-playing-day block is reading the stored slot — a bare date would
  // have matched here before a time existed to show at all.
  await expect(page.getByText('keskiviikko 21.10.2026')).toBeVisible();
  // By element, because the seeded Monday and Wednesday share a time, so the
  // week list further down the page carries this same string twice.
  await expect(page.locator('.closed__next-time')).toHaveText('klo 20–21.30');

  await expect(page.getByLabel('Nimi')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ilmoittaudu' })).toHaveCount(0);
});
