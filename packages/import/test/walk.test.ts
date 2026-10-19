import { describe, expect, test } from 'vitest';
import { createFakeDomino, type FakePlayer } from './fake-domino.js';
import { collectPlayerIndex, walkActivityView } from '../src/walk.js';

const dates = (year: string, days: Array<[string, string]>) => ({
  year,
  dates: days.map(([date, weekday]) => ({ date: `${year}-${date}`, weekday })),
});

const DATA: FakePlayer[] = [
  {
    name: 'Matti Virtanen',
    years: [
      dates('2026', [
        ['01-12', 'Maanantai'],
        ['04-15', 'Keskiviikko'],
      ]),
      dates('2025', [['10-20', 'Maanantai']]),
    ],
  },
  { name: 'Liisa Korhonen', years: [dates('2026', [['01-12', 'Maanantai']])] },
  {
    name: 'Pekka Hämäläinen (mv)',
    years: [dates('2024', [['02-03', 'Lauantai']])],
  },
];

describe('walkActivityView', () => {
  test('harvests every player with their years and dates', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA) });

    expect(result.players.map((p) => p.name)).toEqual([
      'Matti Virtanen',
      'Liisa Korhonen',
      'Pekka Hämäläinen (mv)',
    ]);
    expect(result.players[0]?.total).toBe(3);
    expect(result.players[0]?.years).toEqual([
      { year: '2026', count: 2 },
      { year: '2025', count: 1 },
    ]);
  });

  test('emits one registration per date, tagged with its player', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA) });

    expect(result.registrations).toEqual([
      { name: 'Matti Virtanen', date: '2026-01-12', weekday: 'Maanantai' },
      { name: 'Matti Virtanen', date: '2026-04-15', weekday: 'Keskiviikko' },
      { name: 'Matti Virtanen', date: '2025-10-20', weekday: 'Maanantai' },
      { name: 'Liisa Korhonen', date: '2026-01-12', weekday: 'Maanantai' },
      { name: 'Pekka Hämäläinen (mv)', date: '2024-02-03', weekday: 'Lauantai' },
    ]);
  });

  test('works regardless of how small the page is', async () => {
    // Page size 2 forces the walker across many page turns and makes every
    // row index shift under it.
    for (const rowsPerPage of [1, 2, 3, 5, 50]) {
      const result = await walkActivityView({ client: createFakeDomino(DATA, rowsPerPage) });
      expect(result.registrations).toHaveLength(5);
      expect(result.players).toHaveLength(3);
    }
  });

  test('keeps Finnish characters and suffixes intact end to end', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA) });

    expect(result.players.map((p) => p.name)).toContain('Pekka Hämäläinen (mv)');
  });

  test('every player total equals the number of dates harvested for them', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA) });

    for (const player of result.players) {
      const harvested = result.registrations.filter((r) => r.name === player.name).length;
      expect(harvested).toBe(player.total);
    }
  });

  test('expands each node exactly once', async () => {
    const fake = createFakeDomino(DATA);

    await walkActivityView({ client: fake });

    // 3 players + 4 player-years = 7 nodes.
    expect(fake.expansions()).toBe(7);
  });

  test('reports progress as it goes', async () => {
    const seen: string[] = [];

    await walkActivityView({
      client: createFakeDomino(DATA),
      onPlayer: (player) => seen.push(player.name),
    });

    expect(seen).toEqual(['Matti Virtanen', 'Liisa Korhonen', 'Pekka Hämäläinen (mv)']);
  });

  test('a limit stops the walk early, for a dry run', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA), limit: 2 });

    expect(result.players.map((p) => p.name)).toEqual(['Matti Virtanen', 'Liisa Korhonen']);
    expect(result.registrations).toHaveLength(4);
  });

  test('handles a player with no games at all', async () => {
    const result = await walkActivityView({
      client: createFakeDomino([{ name: 'Ei Pelejä', years: [] }]),
    });

    expect(result.players).toEqual([{ name: 'Ei Pelejä', total: 0, position: '1', years: [] }]);
    expect(result.registrations).toEqual([]);
  });

  test('an empty view is not an error', async () => {
    const result = await walkActivityView({ client: createFakeDomino([]) });

    expect(result.players).toEqual([]);
    expect(result.registrations).toEqual([]);
  });

  test('refuses to finish if a player total disagrees with the dates harvested', async () => {
    const fake = createFakeDomino(DATA);
    // Simulate Domino dropping a date row: the walker must notice, because a
    // silent shortfall is exactly how 25 years of history gets quietly lost.
    const original = fake.submit.bind(fake);
    fake.submit = async (submitId: string) => {
      const html = await original(submitId);
      return html.replace('<tr><td></td><td></td><td>12.01.2026 Maanantai</td><td>1</td></tr>', '');
    };

    await expect(walkActivityView({ client: fake })).rejects.toThrow(/checksum/i);
  });
});

describe('resuming', () => {
  test('skips players already harvested, without expanding them again', async () => {
    const fake = createFakeDomino(DATA);

    const result = await walkActivityView({ client: fake, startAfterPosition: 1 });

    expect(result.players.map((p) => p.name)).toEqual(['Liisa Korhonen', 'Pekka Hämäläinen (mv)']);
    expect(result.registrations.map((r) => r.name)).toEqual([
      'Liisa Korhonen',
      'Pekka Hämäläinen (mv)',
    ]);
    // 2 remaining players + their 2 years. Matti Virtanen's 3 nodes stay closed,
    // which is the whole point: a resumed run does not redo that work.
    expect(fake.expansions()).toBe(4);
  });

  test('reports the position of each player so a run can be resumed', async () => {
    const seen: Array<[string, string]> = [];

    await walkActivityView({
      client: createFakeDomino(DATA),
      onPlayer: (player) => seen.push([player.name, player.position]),
    });

    expect(seen).toEqual([
      ['Matti Virtanen', '1'],
      ['Liisa Korhonen', '2'],
      ['Pekka Hämäläinen (mv)', '3'],
    ]);
  });

  test('skipping everything yields nothing but does not error', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA), startAfterPosition: 3 });

    expect(result.players).toEqual([]);
    expect(result.registrations).toEqual([]);
  });
});

describe('turning pages when the pager has no numbered links', () => {
  // A deep, fully expanded view renders only Prev/Next. A walker that follows
  // only numbered links stops early AND exits cleanly, which is the one
  // failure mode the per-player checksum structurally cannot see: it is
  // per-player, so a player never reached is never checked.
  const SIX: FakePlayer[] = Array.from({ length: 6 }, (_, i) => ({
    name: `Pelaaja ${i + 1}`,
    years: [dates('2026', [['01-12', 'Maanantai'], ['04-15', 'Keskiviikko']])],
  }));

  test('harvests every player via the Next control', async () => {
    const fake = createFakeDomino(SIX, { rowsPerPage: 4, groupLinks: false });

    const result = await walkActivityView({ client: fake });

    expect(result.players).toHaveLength(6);
    expect(result.registrations).toHaveLength(12);
  });

  test('harvests the same players whether or not numbered links exist', async () => {
    const withLinks = await walkActivityView({
      client: createFakeDomino(SIX, { rowsPerPage: 4, groupLinks: true }),
    });
    const withoutLinks = await walkActivityView({
      client: createFakeDomino(SIX, { rowsPerPage: 4, groupLinks: false }),
    });

    expect(withoutLinks.players).toEqual(withLinks.players);
    expect(withoutLinks.registrations).toEqual(withLinks.registrations);
  });
});

describe('the expected-player guard', () => {
  test('fails when the walk reaches fewer players than the collapsed view lists', async () => {
    const expected = await collectPlayerIndex({ client: createFakeDomino(DATA) });
    expect(expected).toHaveLength(3);

    // A clean truncation: the pager vanishes from every response, which is
    // what a session-expiry page looks like, and what a deep view looks like
    // to a walker that cannot follow Next. Page size 6 makes page one end
    // exactly on a player boundary, so Matti Virtanen's own checksum passes —
    // every harvested player is internally consistent and the walk returns
    // without error. The two players it never reached are invisible to the
    // per-player checksums, and visible only to this guard.
    const stripPager = (html: string) => html.replace(/<div class="xspPagerContainer">.*?<\/div>/s, '');
    const fake = createFakeDomino(DATA, { rowsPerPage: 6 });
    const original = fake.submit.bind(fake);
    const openOriginal = fake.open.bind(fake);
    fake.open = async () => stripPager(await openOriginal());
    fake.submit = async (submitId: string) => stripPager(await original(submitId));

    await expect(walkActivityView({ client: fake, expected })).rejects.toThrow(
      /expected 3 players|did not reach/i,
    );
  });

  test('that same truncation passes every per-player checksum, which is the point', async () => {
    const stripPager = (html: string) => html.replace(/<div class="xspPagerContainer">.*?<\/div>/s, '');
    const fake = createFakeDomino(DATA, { rowsPerPage: 6 });
    const original = fake.submit.bind(fake);
    const openOriginal = fake.open.bind(fake);
    fake.open = async () => stripPager(await openOriginal());
    fake.submit = async (submitId: string) => stripPager(await original(submitId));

    // Without `expected`, the walk resolves normally having silently lost two
    // of three players. This is the finding, reproduced.
    const result = await walkActivityView({ client: fake });

    expect(result.players).toHaveLength(1);
    expect(result.players[0]?.name).toBe('Matti Virtanen');
    expect(result.players[0]?.total).toBe(3);
  });

  test('passes when every expected player was harvested', async () => {
    const expected = await collectPlayerIndex({ client: createFakeDomino(DATA) });

    const result = await walkActivityView({ client: createFakeDomino(DATA), expected });

    expect(result.players).toHaveLength(3);
  });
});

describe('collectPlayerIndex', () => {
  test('lists every player with their position and total, without expanding anything', async () => {
    const fake = createFakeDomino(DATA);

    const index = await collectPlayerIndex({ client: fake });

    expect(index).toEqual([
      { position: '1', name: 'Matti Virtanen', total: 3 },
      { position: '2', name: 'Liisa Korhonen', total: 1 },
      { position: '3', name: 'Pekka Hämäläinen (mv)', total: 1 },
    ]);
    expect(fake.expansions()).toBe(0);
  });

  test('works without numbered pager links', async () => {
    const index = await collectPlayerIndex({
      client: createFakeDomino(DATA, { rowsPerPage: 2, groupLinks: false }),
    });

    expect(index.map((entry) => entry.name)).toEqual([
      'Matti Virtanen',
      'Liisa Korhonen',
      'Pekka Hämäläinen (mv)',
    ]);
  });
});

describe('the expand loop guard', () => {
  test('gives up instead of resubmitting the same node forever', async () => {
    // A stale view token, or a POST Domino decides to ignore, leaves the node
    // closed. Without a guard this floods someone else's production server at
    // 400ms intervals for as long as the process lives.
    const fake = createFakeDomino(DATA);
    const original = fake.submit.bind(fake);
    fake.submit = async (submitId: string) => {
      const html = await original(submitId);
      return html.replace(/__shrink:/g, '__expand:');
    };

    await expect(walkActivityView({ client: fake })).rejects.toThrow(/no progress|stuck/i);
  });

  test('the guard does not trip on a normal walk', async () => {
    const result = await walkActivityView({ client: createFakeDomino(DATA) });

    expect(result.players).toHaveLength(3);
  });
});

describe('incremental output', () => {
  test('hands each player their own registrations as they complete', async () => {
    // The scrape writes to disk from this callback. If registrations only
    // arrive in the final result, an interrupted 2.5-hour walk loses all of
    // them and the resume has nothing to build on.
    const seen: Array<[string, string[]]> = [];

    await walkActivityView({
      client: createFakeDomino(DATA),
      onPlayer: (player, registrations) =>
        seen.push([player.name, registrations.map((r) => r.date)]),
    });

    expect(seen).toEqual([
      ['Matti Virtanen', ['2026-01-12', '2026-04-15', '2025-10-20']],
      ['Liisa Korhonen', ['2026-01-12']],
      ['Pekka Hämäläinen (mv)', ['2024-02-03']],
    ]);
  });

  test('the per-player registrations add up to the full result', async () => {
    const collected: string[] = [];

    const result = await walkActivityView({
      client: createFakeDomino(DATA),
      onPlayer: (_player, registrations) => {
        for (const r of registrations) collected.push(`${r.name}#${r.date}`);
      },
    });

    expect(collected).toEqual(result.registrations.map((r) => `${r.name}#${r.date}`));
  });
});

describe('Domino pseudo-categories', () => {
  test('reports the Not Categorized bucket without dropping its games', async () => {
    // A categorized Domino view renders "Not Categorized" for documents whose
    // category field is empty. The live view has exactly one such row. It is
    // not a player, but it is a real registration, so dropping it would make
    // the archive disagree with Domino. Keep it, and say so.
    const withBucket: FakePlayer[] = [
      ...DATA,
      { name: 'Not Categorized', years: [dates('2019', [['05-06', 'Maanantai']])] },
    ];
    const warnings: string[] = [];

    const result = await walkActivityView({
      client: createFakeDomino(withBucket),
      onWarning: (message) => warnings.push(message),
    });

    expect(result.players.map((p) => p.name)).toContain('Not Categorized');
    expect(result.registrations.filter((r) => r.name === 'Not Categorized')).toHaveLength(1);
    expect(warnings.join(' ')).toMatch(/Not Categorized/);
  });

  test('says nothing when the view has no such bucket', async () => {
    const warnings: string[] = [];

    await walkActivityView({
      client: createFakeDomino(DATA),
      onWarning: (message) => warnings.push(message),
    });

    expect(warnings).toEqual([]);
  });
});

describe('the source data changing under the walk', () => {
  test('the expected-player guard matches on name, not on position', async () => {
    // The old app stays in use while the import runs, and a brand-new name is
    // inserted in sort order — which shifts the position of every player
    // after it. Positions are stable within a response, not across hours.
    const expected = await collectPlayerIndex({ client: createFakeDomino(DATA) });
    const shifted = expected.map((entry) => ({
      ...entry,
      position: String(Number(entry.position) + 1),
    }));

    const result = await walkActivityView({
      client: createFakeDomino(DATA),
      expected: shifted,
    });

    expect(result.players).toHaveLength(3);
  });

  test('it still catches a player genuinely missing by name', async () => {
    const expected = [
      ...(await collectPlayerIndex({ client: createFakeDomino(DATA) })),
      { position: '99', name: 'Kadonnut Pelaaja', total: 7 },
    ];

    await expect(
      walkActivityView({ client: createFakeDomino(DATA), expected }),
    ).rejects.toThrow(/Kadonnut Pelaaja/);
  });
});
