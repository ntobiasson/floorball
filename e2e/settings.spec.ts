import { expect, test, type Page } from '@playwright/test';

/**
 * The unlisted schedule settings page, against the real API and a real
 * DynamoDB — the equivalent spec for `/asetukset` that `notices.spec.ts` is
 * for `/tiedotteet`.
 *
 * Serial, because these specs share one seeded table with the smoke and
 * notices flows, and each test here cleans up the slot it adds. Driven
 * against the Monday-pinned server, like the announcements page, since the
 * settings page itself does not care what day it is.
 *
 * A stored slot carries no validity window or pending state — it is simply
 * in force — so unlike an announcement there is nothing here that is
 * "editable but not shown". A slot either exists or it does not, which is
 * what the two add/remove tests below are built to show.
 */

test.describe.configure({ mode: 'serial' });

const SETTINGS = '/asetukset';

/**
 * The list of every stored slot on the settings page. Assertions about a
 * newly added slot belong here rather than on the page as a whole, so that
 * waiting for the row is what makes a test wait for the write to actually
 * reach the server, as `notices.spec.ts` does for its own list.
 */
const pelivuorot = (page: Page) => page.getByRole('region', { name: 'Pelivuorot' });

/**
 * Set by whichever test just added a slot through the form, read and
 * cleared by the `afterEach` below. A hook that always runs, rather than a
 * tidy-up step at the end of each test body, is what keeps a leak out of
 * the serial run even when the test fails partway through: a tidy-up step
 * placed after the assertions is exactly the code a failing assertion skips,
 * and the assertion most likely to fail — the one checking the regression
 * this spec exists to catch — would otherwise be the one most likely to
 * leave its slot behind for every spec that runs after it.
 */
let createdLabel: string | undefined;

test.afterEach(async ({ page }) => {
  if (createdLabel === undefined) return;
  const label = createdLabel;
  createdLabel = undefined;
  await page.goto(SETTINGS);
  const remove = page.getByRole('button', { name: `Poista pelivuoro ${label}` });
  // A no-op when the test already removed its own slot as part of what it
  // was testing — but that has to be told apart from the list simply not
  // having loaded yet: the schedule is fetched after mount, so counting the
  // button right after `goto` resolves races the fetch and reads 0 for
  // "not there yet" as readily as for "already removed". Waiting for it is
  // what tells the two apart.
  try {
    await remove.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return;
  }
  await remove.click();
  await page.getByRole('button', { name: new RegExp(`Vahvista.*${label}`) }).click();
  await expect(pelivuorot(page).getByText(label)).toBeHidden();
});

test('nothing on the app links to the settings page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'maanantai' })).toBeVisible();

  const hrefs = await page
    .getByRole('link')
    .evaluateAll((links) => links.map((l) => l.getAttribute('href')));
  expect(hrefs).not.toContain(SETTINGS);

  // The tab bar is the only navigation there is, and it offers the day and
  // the history — there is nowhere a link to this page could hide.
  expect(hrefs).toEqual(['/', '/peliaktiivisuus']);
});

test('the mark at the top leads back to the registration page', async ({ page }) => {
  await page.goto(SETTINGS);
  await expect(page.getByRole('heading', { name: 'Pelivuoro', exact: true })).toBeVisible();

  await page.getByRole('link', { name: /ilmoittautumi/i }).click();

  await expect(page.getByRole('heading', { name: 'maanantai' })).toBeVisible();
  await expect(page.getByLabel('Nimi')).toBeVisible();
});

test('the page opens for anyone who knows the address', async ({ page }) => {
  await page.goto(SETTINGS);

  await expect(page.getByRole('heading', { name: 'Pelivuoro', exact: true })).toBeVisible();
  await expect(pelivuorot(page)).toBeVisible();
  // No password, PIN or sign-in anywhere on it — the same arrangement as
  // the announcements page.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test('the seeded slots are listed with their times', async ({ page }) => {
  await page.goto(SETTINGS);

  const list = pelivuorot(page);
  await expect(list.getByText('Maanantai klo 20–21.30')).toBeVisible();
  await expect(list.getByText('Keskiviikko klo 20–21.30')).toBeVisible();
  await expect(list.getByText('Lauantai klo 18–19.30')).toBeVisible();
});

test('a slot added on the page is live on the front page at once', async ({ page }) => {
  await page.goto(SETTINGS);
  // Weekday is left on its default, Monday, so this slot lands on the
  // seeded Monday evening slot's own day.
  await page.getByLabel('Alkaa').fill('07:15');
  await page.getByLabel('Päättyy').fill('08:45');
  await page.getByRole('button', { name: 'Lisää pelivuoro' }).click();

  const label = 'Maanantai klo 7.15–8.45';
  // Recorded before the assertions below, so `afterEach` still has it to
  // remove if one of them fails.
  createdLabel = label;
  await expect(pelivuorot(page).getByText(label)).toBeVisible();

  await page.goto('/');
  // One line holds both slots for the day — the new one beside the seeded
  // one — rather than only the first or the last write winning.
  const todayLine = page.locator('.today__date');
  await expect(todayLine).toContainText('klo 7.15–8.45');
  await expect(todayLine).toContainText('klo 20–21.30');
});

test('a slot removed on the page is gone from the front page', async ({ page }) => {
  await page.goto(SETTINGS);
  await page.getByLabel('Alkaa').fill('06:00');
  await page.getByLabel('Päättyy').fill('07:00');
  await page.getByRole('button', { name: 'Lisää pelivuoro' }).click();

  const label = 'Maanantai klo 6–7';
  // Recorded before the assertions below, so `afterEach` still has it to
  // remove if one of them fails.
  createdLabel = label;
  await expect(pelivuorot(page).getByText(label)).toBeVisible();

  await page.goto('/');
  await expect(page.locator('.today__date')).toContainText('klo 6–7');

  // The removal itself is the thing under test here, not cleanup — it is
  // what the final assertion below depends on.
  await page.goto(SETTINGS);
  await page.getByRole('button', { name: `Poista pelivuoro ${label}` }).click();
  await page.getByRole('button', { name: new RegExp(`Vahvista.*${label}`) }).click();
  await expect(pelivuorot(page).getByText(label)).toBeHidden();

  await page.goto('/');
  await expect(page.locator('.today__date')).not.toContainText('klo 6–7');
});

test('removing a slot asks first', async ({ page }) => {
  await page.goto(SETTINGS);
  await page.getByLabel('Alkaa').fill('05:00');
  await page.getByLabel('Päättyy').fill('05:30');
  await page.getByRole('button', { name: 'Lisää pelivuoro' }).click();

  const label = 'Maanantai klo 5–5.30';
  // Recorded before the assertions below, so `afterEach` removes this slot
  // either way — cancelling here is not supposed to be permanent.
  createdLabel = label;
  await expect(pelivuorot(page).getByText(label)).toBeVisible();

  await page.getByRole('button', { name: `Poista pelivuoro ${label}` }).click();
  // The question is asked in words, not only by a colour change.
  await expect(page.getByText('Poistetaanko?')).toBeVisible();
  await expect(pelivuorot(page).getByText(label)).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`Peruuta.*${label}`) }).click();
  await expect(pelivuorot(page).getByText(label)).toBeVisible();
});
