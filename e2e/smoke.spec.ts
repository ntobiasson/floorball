import { expect, test } from '@playwright/test';

/**
 * Runs against the real API and a real DynamoDB, with the server's date
 * pinned to Monday 19.10.2026 — a game day.
 *
 * The tests share one seeded table, so they run in declaration order and the
 * registration test cleans up after itself.
 */

test.describe.configure({ mode: 'serial' });

test('the landing page shows the game day and the imported announcement', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'maanantai' })).toBeVisible();
  await expect(page.getByText('19.10.2026')).toBeVisible();
  await expect(page.getByText('Kenttä varattu 21.10. klo 18-19.')).toBeVisible();
});

test('a name can be added and then removed again', async ({ page }) => {
  await page.goto('/');
  const count = page.locator('.today__count-number');
  await expect(count).toHaveText('0');

  await page.getByLabel('Nimi').fill('Testi Pelaaja');
  await page.getByRole('button', { name: 'Ilmoittaudu' }).click();

  await expect(page.getByText('Testi Pelaaja')).toBeVisible();
  await expect(count).toHaveText('1');

  // Removal takes two taps: the first only asks.
  await page.getByRole('button', { name: 'Poista Testi Pelaaja' }).click();
  await expect(count).toHaveText('1');
  await page.getByRole('button', { name: /Vahvista.*Testi Pelaaja/ }).click();

  await expect(count).toHaveText('0');
  await expect(page.getByText('Testi Pelaaja')).toBeHidden();
});

test('cancelling the removal prompt keeps the name on the list', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Nimi').fill('Varovainen Pelaaja');
  await page.getByRole('button', { name: 'Ilmoittaudu' }).click();
  await expect(page.locator('.today__count-number')).toHaveText('1');

  await page.getByRole('button', { name: 'Poista Varovainen Pelaaja' }).click();
  await page.getByRole('button', { name: /Peruuta.*Varovainen Pelaaja/ }).click();

  await expect(page.locator('.today__count-number')).toHaveText('1');
  await expect(page.getByText('Varovainen Pelaaja')).toBeVisible();

  // Clean up for the specs that follow.
  await page.getByRole('button', { name: 'Poista Varovainen Pelaaja' }).click();
  await page.getByRole('button', { name: /Vahvista.*Varovainen Pelaaja/ }).click();
  await expect(page.locator('.today__count-number')).toHaveText('0');
});

test('the same name cannot be added twice on one day', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Nimi').fill('Kaksoisilmoittautuja');
  await page.getByRole('button', { name: 'Ilmoittaudu' }).click();
  await expect(page.locator('.today__count-number')).toHaveText('1');

  await page.getByLabel('Nimi').fill('kaksoisilmoittautuja');
  await page.getByRole('button', { name: 'Ilmoittaudu' }).click();

  await expect(page.getByRole('alert')).toContainText('jo listalla');
  await expect(page.locator('.today__count-number')).toHaveText('1');

  await page.getByRole('button', { name: 'Poista Kaksoisilmoittautuja' }).click();
  await page.getByRole('button', { name: /Vahvista.*Kaksoisilmoittautuja/ }).click();
  await expect(page.locator('.today__count-number')).toHaveText('0');
});

test('an imported player is searchable with their per-year breakdown', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Peliaktiivisuus' }).click();

  await expect(page.getByRole('heading', { name: 'Peliaktiivisuus' })).toBeVisible();

  await page.getByLabel('Hae pelaajan nimellä').fill('aatu');
  const row = page.getByRole('button', { name: /Matti Virtanen/ });
  await expect(row).toBeVisible();
  await expect(page.getByText('Liisa Korhonen')).toBeHidden();

  await row.click();
  await expect(page.getByText('2026')).toBeVisible();
  await expect(page.getByText('2025')).toBeVisible();
});

test('a name typed without its diacritics still finds the player', async ({ page }) => {
  await page.goto('/peliaktiivisuus');

  await page.getByLabel('Hae pelaajan nimellä').fill('makela');

  await expect(page.getByText('Riikka Mäkelä')).toBeVisible();
});
