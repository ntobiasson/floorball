import { expect, test, type Page } from '@playwright/test';

/**
 * Runs against the real API and a real DynamoDB, seeded from a genuine Domino
 * harvest, with the server's date pinned to Monday 19.10.2026 — a game day.
 *
 * The seeded history includes a registration for that Monday, so the day's
 * list does not start empty. Assertions are relative to whatever is already
 * there: the tests care that adding a name adds one and removing it removes
 * one, not what the list happened to be seeded with.
 *
 * The history has its own spec; this one stays on the day's list.
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
  // The time comes from the seeded schedule, not just the date, so this also
  // proves the day's card is reading the stored slot rather than a fallback.
  await expect(page.getByText('19.10.2026 klo 20–21.30')).toBeVisible();
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

test('a registered player can be marked as goalkeeper, and unmarked', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Nimi').fill('Testi Maalivahti');
  await page.getByRole('button', { name: 'Ilmoittaudu' }).click();

  const list = page.getByRole('list', { name: 'Ilmoittautuneet' });
  const chip = list.locator('li', { hasText: 'Testi Maalivahti' });
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveClass(/chip--goalkeeper/);

  // Tapping the name is what opens the goalkeeper question.
  await page.getByRole('button', { name: 'Testi Maalivahti', exact: true }).click();
  // click, not check: ticking it closes the panel on success, so the checkbox
  // is gone by the time check() would read its state back.
  await page.getByRole('checkbox', { name: 'Maalivahti (MV)' }).click();

  await expect(chip).toHaveClass(/chip--goalkeeper/);
  await expect(chip.getByText('MV')).toBeVisible();

  // It survives a reload, so it really reached DynamoDB and not just the tab.
  await page.reload();
  const afterReload = page
    .getByRole('list', { name: 'Ilmoittautuneet' })
    .locator('li', { hasText: 'Testi Maalivahti' });
  await expect(afterReload.getByText('MV')).toBeVisible();

  await page.getByRole('button', { name: 'Testi Maalivahti', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Maalivahti (MV)' }).click();
  await expect(afterReload.getByText('MV')).toBeHidden();

  // Tidy up, so the serial specs after this one see the list they expect.
  await page.getByRole('button', { name: 'Poista Testi Maalivahti' }).click();
  await page.getByRole('button', { name: /Vahvista.*Testi Maalivahti/ }).click();
  await expect(page.getByText('Testi Maalivahti')).toBeHidden();
});

test('the form can register somebody as goalkeeper in one go', async ({ page }) => {
  await page.goto('/');

  // The box is answerable before the name is, and starts empty.
  const box = page.getByRole('checkbox', { name: 'Ilmoittaudun maalivahdiksi' });
  await expect(box).not.toBeChecked();

  await page.getByLabel('Nimi').fill('Testi Alkuvahti');
  await box.check();
  await page.getByRole('button', { name: 'Ilmoittaudu' }).click();

  const chip = page
    .getByRole('list', { name: 'Ilmoittautuneet' })
    .locator('li', { hasText: 'Testi Alkuvahti' });
  await expect(chip).toHaveClass(/chip--goalkeeper/);
  await expect(chip.getByText('MV')).toBeVisible();

  // The mark rode along in the registration itself, so it is in DynamoDB
  // without anybody having tapped the name on the list.
  await page.reload();
  const afterReload = page
    .getByRole('list', { name: 'Ilmoittautuneet' })
    .locator('li', { hasText: 'Testi Alkuvahti' });
  await expect(afterReload.getByText('MV')).toBeVisible();

  // And the box did not keep the answer for whoever registers next.
  await expect(
    page.getByRole('checkbox', { name: 'Ilmoittaudun maalivahdiksi' }),
  ).not.toBeChecked();

  // Tidy up, so the serial specs after this one see the list they expect.
  await page.getByRole('button', { name: 'Poista Testi Alkuvahti' }).click();
  await page.getByRole('button', { name: /Vahvista.*Testi Alkuvahti/ }).click();
  await expect(page.getByText('Testi Alkuvahti')).toBeHidden();
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

  await page.getByLabel('Nimi').fill('matti');

  // Matti Virtanen is already registered for this day; the (EHKÄ) duplicate is not.
  const suggestions = page.getByRole('list', { name: 'Ehdotukset' });
  await expect(suggestions.getByRole('button', { name: 'Matti Virtanen (EHKÄ)' })).toBeVisible();
  await expect(
    suggestions.getByRole('button', { name: 'Matti Virtanen', exact: true }),
  ).toHaveCount(0);
});

test('the day shows no history of its own', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'maanantai' })).toBeVisible();

  // The archive has its own page. On this one there is no search over it and
  // no historical total — the only number shown is today's count.
  await expect(page.getByLabel('Hae pelaajan nimellä')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Vuosi' })).toHaveCount(0);
  await expect(page.getByText(/^\d{2,}$/)).toHaveCount(0);
});

test('the stored history still reaches the form as name suggestions', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Nimi').fill('vaana');

  // Olli Väänänen last played in 2009 and is in the directory only because
  // the archive was imported.
  const suggestions = page.getByRole('list', { name: 'Ehdotukset' });
  await expect(suggestions.getByRole('button', { name: 'Olli Väänänen' })).toBeVisible();
});
