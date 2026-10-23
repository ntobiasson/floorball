import { expect, test, type Page } from '@playwright/test';

/**
 * The history page, against the real API and a real DynamoDB seeded from a
 * Domino-shaped harvest, with the server's date pinned to Monday 19.10.2026.
 *
 * The seeded archive, which these assertions are written against:
 *
 *   Matti Virtanen          94   2026:9 2025:10 2024:9 … 2017:9
 *   Matti Virtanen (EHKÄ)    1   2023:1
 *   Liisa Korhonen          36   2026:6 2025:6 … 2021:6
 *   Olli Väänänen           48   2009:5 2008:6 … 2001:5
 *   Sanna Peltola           16   2026:8 2025:8
 *
 * Nobody played 2010–2016, which is why the year chips are expected to skip
 * them: they are the years somebody actually played, not a range.
 */

const openHistory = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Historia' }).click();
  await expect(page.getByRole('heading', { name: 'Peliaktiivisuus' })).toBeVisible();
};

/** The player names the list is showing, in order. */
const listedNames = async (page: Page): Promise<string[]> => {
  const labels = await page
    .getByRole('list', { name: 'Pelaajat' })
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label') ?? ''));
  return labels.map((label) => label.split(',')[0] ?? '');
};

test('the tab bar leads to the history and back', async ({ page }) => {
  await openHistory(page);

  await page.getByRole('link', { name: 'Tänään' }).click();
  await expect(page.getByRole('heading', { name: 'maanantai' })).toBeVisible();
});

test('the address opens the history directly', async ({ page }) => {
  await page.goto('/peliaktiivisuus');

  await expect(page.getByRole('heading', { name: 'Peliaktiivisuus' })).toBeVisible();
  await expect(page.getByText('Kaikki pelikerrat 2001–2026')).toBeVisible();
});

test('the imported archive is ranked by games played', async ({ page }) => {
  await openHistory(page);

  // Matti has the most; the (EHKÄ) duplicate is its own player with one game.
  expect((await listedNames(page)).slice(0, 4)).toEqual([
    'Matti Virtanen',
    'Olli Väänänen',
    'Liisa Korhonen',
    'Sanna Peltola',
  ]);
  await expect(page.getByRole('button', { name: 'Matti Virtanen, 94 peliä' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Matti Virtanen (EHKÄ), 1 peli' })).toBeVisible();
});

test('the year chips offer only the years somebody played', async ({ page }) => {
  await openHistory(page);

  const chips = await page
    .getByRole('group', { name: 'Vuosi' })
    .getByRole('button')
    .allTextContents();

  // 2010-2016 are absent: nobody in the archive played them.
  expect(chips).toEqual([
    'Kaikki',
    '2026',
    '2025',
    '2024',
    '2023',
    '2022',
    '2021',
    '2020',
    '2019',
    '2018',
    '2017',
    '2009',
    '2008',
    '2007',
    '2006',
    '2005',
    '2004',
    '2003',
    '2002',
    '2001',
  ]);
});

test('a year ranks by that year, not by the lifetime total', async ({ page }) => {
  await openHistory(page);

  await page.getByRole('button', { name: '2026', exact: true }).click();

  // Sanna has 16 games in all and Liisa 36, but over 2026 Sanna played more.
  expect((await listedNames(page)).slice(0, 3)).toEqual([
    'Matti Virtanen',
    'Sanna Peltola',
    'Liisa Korhonen',
  ]);
  await expect(page.getByRole('button', { name: 'Sanna Peltola, 8 peliä' })).toBeVisible();
});

test('a year leaves out everyone who did not play it', async ({ page }) => {
  await openHistory(page);

  await page.getByRole('button', { name: '2009', exact: true }).click();

  // Olli stopped in 2009 and is the only one who was there.
  expect(await listedNames(page)).toEqual(['Olli Väänänen']);
  await expect(page.getByRole('button', { name: 'Olli Väänänen, 5 peliä' })).toBeVisible();
});

test('the name search narrows the list, and combines with a year', async ({ page }) => {
  await openHistory(page);

  await page.getByLabel('Hae pelaajan nimellä').fill('virtanen');
  expect(await listedNames(page)).toEqual(['Matti Virtanen', 'Matti Virtanen (EHKÄ)']);

  // 2023 is the duplicate's only year, and Matti played it too.
  await page.getByRole('button', { name: '2023', exact: true }).click();
  expect(await listedNames(page)).toEqual(['Matti Virtanen', 'Matti Virtanen (EHKÄ)']);

  await page.getByRole('button', { name: '2026', exact: true }).click();
  expect(await listedNames(page)).toEqual(['Matti Virtanen']);
});

test('the list can be put in Finnish name order', async ({ page }) => {
  await openHistory(page);

  await page.getByRole('button', { name: 'Nimi A–Ö' }).click();

  expect(await listedNames(page)).toEqual([
    'Liisa Korhonen',
    'Matti Virtanen',
    'Matti Virtanen (EHKÄ)',
    'Olli Väänänen',
    'Sanna Peltola',
  ]);
});

test('a player expands into their year-by-year breakdown', async ({ page }) => {
  await openHistory(page);

  await page.getByRole('button', { name: 'Sanna Peltola, 16 peliä' }).click();

  const years = page.getByRole('list', { name: 'Sanna Peltola vuosittain' });
  const rows = await years
    .getByRole('listitem')
    .evaluateAll((items) => items.map((li) => li.getAttribute('aria-label') ?? ''));
  expect(rows).toEqual(['2026: 8 peliä', '2025: 8 peliä']);
});

test('a search matching nobody says so', async ({ page }) => {
  await openHistory(page);

  await page.getByLabel('Hae pelaajan nimellä').fill('zzzz');

  await expect(page.getByRole('list', { name: 'Pelaajat' })).toHaveCount(0);
  await expect(page.getByText(/zzzz/)).toBeVisible();
});
