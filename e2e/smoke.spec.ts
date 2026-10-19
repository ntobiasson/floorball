import { expect, test, type Page } from '@playwright/test';

/**
 * Runs against the real API and a real DynamoDB, seeded from a genuine Domino
 * harvest, with the server's date pinned to Monday 19.10.2026 — a game day.
 *
 * The seeded history includes a registration for that Monday, so the day's
 * list does not start empty. Assertions are relative to whatever is already
 * there: the tests care that adding a name adds one and removing it removes
 * one, not what the list happened to be seeded with.
 */

test.describe.configure({ mode: 'serial' });

const countOf = async (page: Page): Promise<number> =>
  Number((await page.locator('.today__count-number').textContent()) ?? '0');

const expectCount = async (page: Page, expected: number): Promise<void> => {
  await expect(page.locator('.today__count-number')).toHaveText(String(expected));
};

test('the landing page shows the game day and the imported announcement', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'maanantai' })).toBeVisible();
  await expect(page.getByText('19.10.2026')).toBeVisible();
  await expect(page.getByText('Kenttä varattu 21.10. klo 18-19.')).toBeVisible();
});

test('the imported registration for that day is on the list', async ({ page }) => {
  await page.goto('/');

  // Scoped to the day's list: the directory also holds "Matti Virtanen (EHKÄ)".
  const list = page.getByRole('list', { name: 'Ilmoittautuneet' });
  await expect(list.getByText('Matti Virtanen')).toBeVisible();
  expect(await countOf(page)).toBeGreaterThan(0);
});

test('a name can be added and then removed again', async ({ page }) => {
  await page.goto('/');
  const before = await countOf(page);

  await page.getByLabel('Nimi').fill('Testi Pelaaja');
  await page.getByRole('button', { name: 'Ilmoittaudu' }).click();

  await expect(page.getByText('Testi Pelaaja')).toBeVisible();
  await expectCount(page, before + 1);

  // Removal takes two taps: the first only asks.
  await page.getByRole('button', { name: 'Poista Testi Pelaaja' }).click();
  await expectCount(page, before + 1);
  await page.getByRole('button', { name: /Vahvista.*Testi Pelaaja/ }).click();

  await expectCount(page, before);
  await expect(page.getByText('Testi Pelaaja')).toBeHidden();
});

test('cancelling the removal prompt keeps the name on the list', async ({ page }) => {
  await page.goto('/');
  const before = await countOf(page);

  await page.getByLabel('Nimi').fill('Varovainen Pelaaja');
  await page.getByRole('button', { name: 'Ilmoittaudu' }).click();
  await expectCount(page, before + 1);

  await page.getByRole('button', { name: 'Poista Varovainen Pelaaja' }).click();
  await page.getByRole('button', { name: /Peruuta.*Varovainen Pelaaja/ }).click();

  await expectCount(page, before + 1);
  await expect(page.getByText('Varovainen Pelaaja')).toBeVisible();

  // Clean up for the specs that follow.
  await page.getByRole('button', { name: 'Poista Varovainen Pelaaja' }).click();
  await page.getByRole('button', { name: /Vahvista.*Varovainen Pelaaja/ }).click();
  await expectCount(page, before);
});

test('the same name cannot be added twice on one day', async ({ page }) => {
  await page.goto('/');
  const before = await countOf(page);

  await page.getByLabel('Nimi').fill('Kaksoisilmoittautuja');
  await page.getByRole('button', { name: 'Ilmoittaudu' }).click();
  await expectCount(page, before + 1);

  await page.getByLabel('Nimi').fill('kaksoisilmoittautuja');
  await page.getByRole('button', { name: 'Ilmoittaudu' }).click();

  await expect(page.getByRole('alert')).toContainText('jo listalla');
  await expectCount(page, before + 1);

  await page.getByRole('button', { name: 'Poista Kaksoisilmoittautuja' }).click();
  await page.getByRole('button', { name: /Vahvista.*Kaksoisilmoittautuja/ }).click();
  await expectCount(page, before);
});

test('a player already on the list is not suggested again', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Nimi').fill('aatu');

  // Matti Virtanen is already registered for this day; the (EHKÄ) duplicate is not.
  const suggestions = page.getByRole('list', { name: 'Ehdotukset' });
  await expect(suggestions.getByRole('button', { name: 'Matti Virtanen (EHKÄ)' })).toBeVisible();
  await expect(suggestions.getByRole('button', { name: 'Matti Virtanen', exact: true })).toHaveCount(0);
});

test('25 years of history are searchable with a per-year breakdown', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Peliaktiivisuus' }).click();

  await expect(page.getByRole('heading', { name: 'Peliaktiivisuus' })).toBeVisible();

  await page.getByLabel('Hae pelaajan nimellä').fill('aatu');
  await expect(page.getByText('Sanna Peltola')).toBeHidden();

  await page.getByRole('button', { name: /Matti Virtanen 279/ }).click();
  await expect(page.getByText('2026')).toBeVisible();
  await expect(page.getByText('2017')).toBeVisible();
});

test('a player whose last game was years ago is still there', async ({ page }) => {
  await page.goto('/peliaktiivisuus');

  // Olli Väänänen stopped playing in 2009; the archive is the point.
  await page.getByLabel('Hae pelaajan nimellä').fill('vaananen');
  await page.getByRole('button', { name: /Olli Väänänen 63/ }).click();

  await expect(page.getByText('2001')).toBeVisible();
});

test('a name typed without its diacritics still finds the player', async ({ page }) => {
  await page.goto('/peliaktiivisuus');

  await page.getByLabel('Hae pelaajan nimellä').fill('vaananen');

  await expect(page.getByText('Olli Väänänen')).toBeVisible();
});
