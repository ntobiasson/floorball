import { expect, test } from '@playwright/test';

/**
 * The unlisted announcements page, against the real API.
 *
 * Serial, because these specs share one seeded table with the smoke flow and
 * each cleans up the announcement it creates.
 */

test.describe.configure({ mode: 'serial' });

const NOTICES = '/tiedotteet';

test('nothing on the app links to the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'maanantai' })).toBeVisible();

  const hrefs = await page.getByRole('link').evaluateAll((links) =>
    links.map((l) => l.getAttribute('href')),
  );
  expect(hrefs).not.toContain(NOTICES);

  await page.goto('/peliaktiivisuus');
  const activityHrefs = await page.getByRole('link').evaluateAll((links) =>
    links.map((l) => l.getAttribute('href')),
  );
  expect(activityHrefs).not.toContain(NOTICES);
});

test('the page opens for anyone who knows the address, with no secret asked', async ({ page }) => {
  await page.goto(NOTICES);

  await expect(page.getByRole('heading', { name: 'Tiedotteet', exact: true })).toBeVisible();
  // No password, PIN or sign-in anywhere on it.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test('an announcement added here shows up on the landing page', async ({ page }) => {
  await page.goto(NOTICES);
  await page.getByRole('textbox', { name: 'Tiedote', exact: true }).fill('E2E-tiedote');
  await page.getByRole('button', { name: 'Lisää tiedote' }).click();
  await expect(page.getByText('E2E-tiedote')).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('E2E-tiedote')).toBeVisible();
});

test('removing one asks first, then takes it off the landing page', async ({ page }) => {
  await page.goto(NOTICES);

  await page.getByRole('button', { name: /Poista tiedote E2E-tiedote/ }).click();
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
  await expect(page.getByText('Joulutauko')).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('Joulutauko')).toBeHidden();

  await page.goto(NOTICES);
  await page.getByRole('button', { name: /Poista tiedote Joulutauko/ }).click();
  await page.getByRole('button', { name: /Vahvista.*Joulutauko/ }).click();
  await expect(page.getByText('Joulutauko')).toBeHidden();
});
