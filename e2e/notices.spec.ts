import { expect, test, type Page } from '@playwright/test';

/**
 * The unlisted announcements page, against the real API.
 *
 * Serial, because these specs share one seeded table with the smoke flow and
 * each cleans up the announcement it creates.
 */

test.describe.configure({ mode: 'serial' });

const NOTICES = '/tiedotteet';

/**
 * The list of every announcement on the management page. Assertions about a
 * newly written announcement belong here rather than on the page as a whole,
 * because the form's textarea also carries the text and would answer first.
 */
const notices = (page: Page) => page.getByRole('region', { name: 'Kaikki tiedotteet' });

test('nothing on the app links to the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'maanantai' })).toBeVisible();

  const hrefs = await page.getByRole('link').evaluateAll((links) =>
    links.map((l) => l.getAttribute('href')),
  );
  expect(hrefs).not.toContain(NOTICES);

  // The tab bar is the only navigation there is, and it offers the day and
  // the history — there is nowhere a link to this page could hide.
  expect(hrefs).toEqual(['/', '/peliaktiivisuus']);
});

test('the mark at the top leads back to the registration page', async ({ page }) => {
  await page.goto(NOTICES);
  await expect(page.getByRole('heading', { name: 'Tiedote', exact: true })).toBeVisible();

  await page.getByRole('link', { name: /ilmoittautumi/i }).click();

  await expect(page.getByRole('heading', { name: 'maanantai' })).toBeVisible();
  await expect(page.getByLabel('Nimi')).toBeVisible();
});

test('the page opens for anyone who knows the address, with no secret asked', async ({ page }) => {
  await page.goto(NOTICES);

  await expect(page.getByRole('heading', { name: 'Tiedote', exact: true })).toBeVisible();
  // No password, PIN or sign-in anywhere on it.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test('an unrelated address does not open it', async ({ page }) => {
  for (const guess of ['/admin', '/hallinta', '/peliaktiivisuus']) {
    await page.goto(guess);
    // The SPA serves index.html for any path, so the wrong address lands on
    // the registration page rather than 404ing — which is the intent.
    await expect(page.getByRole('button', { name: 'Lisää tiedote' })).toHaveCount(0);
  }
});

test('the page asks not to be indexed', async ({ page }) => {
  await page.goto(NOTICES);
  await expect(page.getByRole('heading', { name: 'Tiedote', exact: true })).toBeVisible();

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  );
});

test('an announcement added here shows up on the landing page', async ({ page }) => {
  await page.goto(NOTICES);
  await page.getByRole('textbox', { name: 'Tiedote', exact: true }).fill('E2E-tiedote');
  await page.getByRole('button', { name: 'Lisää tiedote' }).click();

  // Scoped to the list, not the page. A page-wide getByText matches the
  // textarea this test just filled — Playwright reads a textarea's value as
  // its text — so the assertion passed the instant the text was typed,
  // without ever waiting for the POST. The navigation below then aborted the
  // request in flight and the announcement was never written. Waiting for the
  // row is what makes this test wait for the server.
  await expect(notices(page).getByText('E2E-tiedote')).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('E2E-tiedote')).toBeVisible();
});

test('removing one asks first, then takes it off the landing page', async ({ page }) => {
  await page.goto(NOTICES);

  await page.getByRole('button', { name: /Poista tiedote E2E-tiedote/ }).click();
  // The question is asked in words, not only by a colour change.
  await expect(page.getByText('Poistetaanko?')).toBeVisible();
  await expect(page.getByText('E2E-tiedote')).toBeVisible();
  await page.getByRole('button', { name: /Vahvista.*E2E-tiedote/ }).click();
  await expect(page.getByText('E2E-tiedote')).toBeHidden();

  await page.goto('/');
  await expect(page.getByText('E2E-tiedote')).toBeHidden();
});

test('an announcement outside its validity window is editable but not shown', async ({ page }) => {
  await page.goto(NOTICES);
  await page.getByRole('textbox', { name: 'Tiedote', exact: true }).fill('Joulutauko');
  await page.getByLabel('Näytetään alkaen').fill('2026-12-20');
  await page.getByRole('button', { name: 'Lisää tiedote' }).click();
  // Scoped for the same reason, and here it matters more: the landing-page
  // assertion below is `toBeHidden`, so without a real wait for the write
  // this test passed whether or not the announcement was ever created.
  await expect(notices(page).getByText('Joulutauko')).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('Joulutauko')).toBeHidden();

  await page.goto(NOTICES);
  await page.getByRole('button', { name: /Poista tiedote Joulutauko/ }).click();
  await page.getByRole('button', { name: /Vahvista.*Joulutauko/ }).click();
  await expect(page.getByText('Joulutauko')).toBeHidden();
});
