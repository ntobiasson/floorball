import { expect, test, type Page } from '@playwright/test';

/**
 * The three languages, against the real app.
 *
 * Every other spec in this suite asserts Finnish copy, which only holds
 * because `playwright.config.ts` pins the context to `fi-FI`. That pin is
 * what this file leans on too: the app opens Finnish here because the
 * browser asks for Finnish, not because Finnish is hardcoded anywhere.
 *
 * Nothing here cleans up after itself, unlike `settings.spec.ts`. The choice
 * lives in `localStorage`, Playwright gives each test its own context, and
 * so each one starts with nobody having chosen anything.
 *
 * The switcher is found by its class rather than its accessible name on
 * purpose: that name is itself translated, so a locator built from it stops
 * matching the instant the thing it drives has been used.
 */
const chooser = (page: Page) => page.locator('.masthead__language');

test('opens in the language the browser asks for', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'maanantai' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fi');
  // Named in the language it is currently speaking.
  await expect(chooser(page)).toHaveAttribute('aria-label', 'Kieli');
});

test('offers each language under its own name', async ({ page }) => {
  await page.goto('/');

  // Not translated into whatever is showing: somebody hunting for theirs is
  // looking for the word they recognise.
  await expect(chooser(page).locator('option')).toHaveText(['Suomi', 'English', 'Українська']);
});

test('switching changes the page and the document language', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { name: 'maanantai' }).waitFor();

  await chooser(page).selectOption('uk');

  await expect(page.getByRole('link', { name: 'Сьогодні' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'понеділок' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
});

test('the choice outlives the tab, against a browser asking for Finnish', async ({ page }) => {
  await page.goto('/');
  await chooser(page).selectOption('en');
  await expect(page.getByRole('link', { name: 'Today' })).toBeVisible();

  await page.reload();

  // The browser still asks for Finnish; the stored choice wins, which is
  // what makes the switcher an override rather than a suggestion.
  await expect(page.getByRole('link', { name: 'Today' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('the times follow the language, and the dates with them', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.today__date')).toContainText('19.10.2026 klo 20–21.30');

  await chooser(page).selectOption('en');

  // The seeded Monday slot, said the way English says it: a day-first date,
  // because a bare `en` would have made it American, and a colon in the
  // clock, because only Finnish drops a whole hour's minutes.
  await expect(page.locator('.today__date')).toContainText('19/10/2026 at 20:00–21:30');
});

test('2002 stays Finnish whatever the app is speaking', async ({ page }) => {
  await page.goto('/');
  await chooser(page).selectOption('uk');
  await expect(page.getByRole('link', { name: 'Сьогодні' })).toBeVisible();

  // Seven taps on the mark, as the easter egg asks for.
  const mark = page.getByRole('button', { name: 'Peleille' });
  for (let tap = 0; tap < 7; tap += 1) await mark.click();

  // The replica reproduces a Finnish application from 2002 and follows no
  // language but its own — and offers no way to change it.
  await expect(page.getByText('on pelipäivä')).toBeVisible();
  await expect(chooser(page)).toHaveCount(0);
});
