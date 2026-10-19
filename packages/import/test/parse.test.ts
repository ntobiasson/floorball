import { describe, expect, test } from 'vitest';
import {
  game,
  player,
  renderView,
  year,
  type MarkupRow,
} from './domino-markup.js';
import {
  harvestRows,
  parseDateCell,
  parseDates,
  parseNextPageLink,
  parseNodes,
  parsePageCount,
  parsePagerLinks,
  parsePlayers,
  parseViewId,
  parseYears,
} from '../src/parse.js';

/**
 * The shapes these tests describe were taken from live responses during the
 * migration work; `domino-markup.ts` reproduces them. See its header for what
 * that does and does not guarantee.
 */

/** A collapsed level-1 page: 30 players per page, 16 pages. */
const LEVEL1_PAGE1 = renderView({
  pageCount: 16,
  currentPage: 1,
  rows: [
    player('Olli Salo', 2, '1'),
    player('Olli Väänänen', 63, '2'),
    player('Matti Virtanen', 278, '3'),
    player('Matti Virtanen (EHKÄ)', 1, '4'),
    player('Sanna Peltola', 18, '5'),
    ...Array.from({ length: 25 }, (_, i) => player(`Pelaaja ${i + 6}`, i + 1, String(i + 6))),
  ],
});

/** Page two: row ids continue, positions continue, the pager moves on. */
const LEVEL1_PAGE2 = renderView({
  pageCount: 16,
  currentPage: 2,
  firstRowIndex: 30,
  rows: [
    player('Tuomas Aalto', 29, '31'),
    player('Tuomas Aalto (MV)', 43, '32'),
    player('Tuomas Mäkinen', 3, '33'),
    ...Array.from({ length: 27 }, (_, i) => player(`Pelaaja ${i + 34}`, i + 1, String(i + 34))),
  ],
});

/** Matti Virtanen opened: his years appear beneath him and everything shifts. */
const YEARS: Array<[string, number]> = [
  ['2026', 25],
  ['2025', 47],
  ['2024', 41],
  ['2023', 25],
  ['2022', 29],
  ['2021', 33],
  ['2020', 52],
  ['2019', 17],
  ['2018', 2],
  ['2017', 7],
];

const PLAYER_EXPANDED = renderView({
  pageCount: 16,
  currentPage: 1,
  rows: [
    player('Olli Salo', 2, '1'),
    player('Olli Väänänen', 63, '2'),
    player('Matti Virtanen', 278, '3', true),
    ...YEARS.map(([value, count], i) => year(value, count, `3.${i + 1}`)),
    player('Matti Virtanen (EHKÄ)', 1, '4'),
    ...Array.from({ length: 16 }, (_, i) => player(`Pelaaja ${i + 5}`, i + 1, String(i + 5))),
  ],
});

/** His 2026 opened in turn: the games themselves, with no control of their own. */
const YEAR_EXPANDED = renderView({
  pageCount: 17,
  currentPage: 1,
  rows: [
    player('Olli Salo', 2, '1'),
    player('Olli Väänänen', 63, '2'),
    player('Matti Virtanen', 278, '3', true),
    year('2026', 25, '3.1', true),
    game('12.01.2026 Maanantai'),
    game('09.03.2026 Maanantai'),
    game('23.03.2026 Maanantai'),
    game('06.04.2026 Maanantai'),
    game('13.04.2026 Maanantai'),
    game('15.04.2026 Keskiviikko'),
    game('04.05.2026 Maanantai'),
    game('13.05.2026 Keskiviikko'),
  ] as MarkupRow[],
});

describe('parseViewId', () => {
  test('reads the XPages view state token the POSTs must echo back', () => {
    expect(parseViewId(LEVEL1_PAGE1)).toMatch(/^!.+!$/);
  });

  test('throws rather than posting without one', () => {
    expect(() => parseViewId('<html><body>no form here</body></html>')).toThrow(/viewid/i);
  });
});

describe('parsePageCount', () => {
  test('the collapsed level-1 view is 16 pages', () => {
    expect(parsePageCount(LEVEL1_PAGE1)).toBe(16);
  });

  test('expanding adds rows and therefore pages', () => {
    // This is why the walker collapses nothing and sweeps forward: page
    // boundaries move while the view is being opened up.
    expect(parsePageCount(YEAR_EXPANDED)).toBeGreaterThan(16);
  });

  test('a view with no pager is a single page', () => {
    expect(parsePageCount('<html><body><table></table></body></html>')).toBe(1);
  });
});

describe('parsePlayers', () => {
  test('reads 30 players from the first page', () => {
    expect(parsePlayers(LEVEL1_PAGE1)).toHaveLength(30);
  });

  test('reads name, total and view position', () => {
    expect(parsePlayers(LEVEL1_PAGE1).slice(0, 3)).toEqual([
      { name: 'Olli Salo', total: 2, position: '1' },
      { name: 'Olli Väänänen', total: 63, position: '2' },
      { name: 'Matti Virtanen', total: 278, position: '3' },
    ]);
  });

  test('positions continue across pages rather than restarting', () => {
    const [first] = parsePlayers(LEVEL1_PAGE2);
    expect(first).toEqual({ name: 'Tuomas Aalto', total: 29, position: '31' });
  });

  test('decodes the entities Domino emits for Finnish letters', () => {
    expect(LEVEL1_PAGE2).toContain('&auml;');
    expect(parsePlayers(LEVEL1_PAGE2).map((p) => p.name)).toContain('Tuomas Mäkinen');
  });

  test('keeps a goalkeeper marker as part of the name', () => {
    // "Tuomas Aalto" and "Tuomas Aalto (MV)" are two rows in Domino and must
    // stay two players through the import.
    const names = parsePlayers(LEVEL1_PAGE2).map((p) => p.name);
    expect(names).toContain('Tuomas Aalto');
    expect(names).toContain('Tuomas Aalto (MV)');
  });

  test('ignores year and date rows', () => {
    expect(parsePlayers(YEAR_EXPANDED).map((p) => p.name)).not.toContain('');
  });
});

describe('parseYears', () => {
  test('reads a player year breakdown with its positions', () => {
    expect(parseYears(PLAYER_EXPANDED)).toEqual(
      YEARS.map(([value, count], i) => ({ year: value, count, position: `3.${i + 1}` })),
    );
  });

  test('the year counts sum to the total Domino reports for that player', () => {
    const total = parsePlayers(PLAYER_EXPANDED).find((p) => p.name === 'Matti Virtanen')?.total;
    const summed = parseYears(PLAYER_EXPANDED).reduce((acc, y) => acc + y.count, 0);
    expect(summed).toBe(total);
    expect(summed).toBe(278);
  });

  test('is empty on a collapsed view', () => {
    expect(parseYears(LEVEL1_PAGE1)).toEqual([]);
  });
});

describe('parseDateCell', () => {
  test('turns a Finnish date cell into an ISO date and weekday', () => {
    expect(parseDateCell('12.01.2026 Maanantai')).toEqual({
      date: '2026-01-12',
      weekday: 'Maanantai',
    });
  });

  test('handles a Wednesday', () => {
    expect(parseDateCell('15.04.2026 Keskiviikko')).toEqual({
      date: '2026-04-15',
      weekday: 'Keskiviikko',
    });
  });

  test('accepts a date with no weekday suffix', () => {
    expect(parseDateCell('01.02.2003')).toEqual({ date: '2003-02-01', weekday: undefined });
  });

  test('rejects an unparseable cell rather than guessing', () => {
    expect(() => parseDateCell('joskus 2003')).toThrow(/date cell/i);
  });
});

describe('parseDates', () => {
  test('reads the date rows revealed by expanding a year', () => {
    const dates = parseDates(YEAR_EXPANDED);

    expect(dates[0]).toEqual({ date: '2026-01-12', weekday: 'Maanantai', count: 1 });
    expect(dates.map((d) => d.date)).toContain('2026-04-15');
    expect(dates.every((d) => d.count === 1)).toBe(true);
  });

  test('every date is a real calendar date in the expected year', () => {
    for (const { date } of parseDates(YEAR_EXPANDED)) {
      expect(date).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10)).toBe(date);
    }
  });

  test('is empty before any year is expanded', () => {
    expect(parseDates(PLAYER_EXPANDED)).toEqual([]);
  });
});

describe('parseNodes', () => {
  test('reports a collapsed player node with the submit id a POST needs', () => {
    const node = parseNodes(LEVEL1_PAGE1).find((n) => n.position === '3');

    expect(node).toMatchObject({ position: '3', level: 1, expanded: false });
    expect(node?.submitId).toBe('view:_id1:_id2:callback2:viewPanel1:2:viewColumn1__expand:3');
  });

  test('reports the same node as expanded once it has been opened', () => {
    const node = parseNodes(PLAYER_EXPANDED).find((n) => n.position === '3');

    expect(node).toMatchObject({ expanded: true, level: 1 });
    expect(node?.submitId).toContain('__shrink:3');
  });

  test('reports a year node on the second column', () => {
    const node = parseNodes(PLAYER_EXPANDED).find((n) => n.position === '3.1');

    expect(node).toMatchObject({ position: '3.1', level: 2, expanded: false });
    expect(node?.submitId).toBe('view:_id1:_id2:callback2:viewPanel1:3:viewColumn2__expand:3.1');
  });

  test('row indexes shift as rows above are expanded', () => {
    // Position 4 sits at row 3 when everything is collapsed, and at row 13
    // once player 3 is showing ten years. Submit ids must be re-read, never
    // computed from the position.
    expect(parseNodes(LEVEL1_PAGE1).find((n) => n.position === '4')?.rowIndex).toBe(3);
    expect(parseNodes(PLAYER_EXPANDED).find((n) => n.position === '4')?.rowIndex).toBe(13);
  });
});

describe('parsePagerLinks', () => {
  test('maps every other page to the submit id that jumps there', () => {
    const links = parsePagerLinks(LEVEL1_PAGE1);

    expect(links).toHaveLength(15); // pages 2..16; page 1 is the current one
    expect(links[0]).toEqual({
      page: 2,
      submitId: 'view:_id1:_id2:callback2:viewPanel1:pager1__Group__lnk__1',
    });
    expect(links.at(-1)).toEqual({
      page: 16,
      submitId: 'view:_id1:_id2:callback2:viewPanel1:pager1__Group__lnk__15',
    });
  });

  test('the current page is not among the links', () => {
    expect(parsePagerLinks(LEVEL1_PAGE1).map((l) => l.page)).not.toContain(1);
  });

  test('is empty when there is only one page', () => {
    expect(parsePagerLinks('<html><body></body></html>')).toEqual([]);
  });
});

describe('parseNextPageLink', () => {
  test('finds the Next control, which exists even when the numbered group does not reach the next page', () => {
    expect(parseNextPageLink(LEVEL1_PAGE1)).toBe(
      'view:_id1:_id2:callback2:viewPanel1:pager1__Next__lnk',
    );
  });

  test('is present on a deep view that renders no numbered links at all', () => {
    const deep = renderView({
      pageCount: 700,
      currentPage: 300,
      groupLinks: false,
      rows: [player('Matti Virtanen', 278, '3')],
    });
    expect(parsePagerLinks(deep)).toEqual([]);
    expect(parseNextPageLink(deep)).toMatch(/pager1__Next__lnk$/);
  });

  test('is undefined when there is no pager at all', () => {
    expect(parseNextPageLink('<html><body></body></html>')).toBeUndefined();
  });

  test('is undefined on the last page, where Next has no link', () => {
    const last = renderView({ pageCount: 3, currentPage: 3, rows: [player('Olli Salo', 2, '1')] });
    expect(parseNextPageLink(last)).toBeUndefined();
  });
});

describe('decodeEntities, via the row harvester', () => {
  const row = (nimi: string) =>
    `<table><tr><td>${nimi}</td><td></td><td></td><td>1</td></tr></table>`;

  test('decodes the Finnish entities Domino emits', () => {
    expect(harvestRows(row('Riikka M&auml;kel&auml;'))[0]?.cells[0]).toBe('Riikka Mäkelä');
    expect(harvestRows(row('V&ouml;yri'))[0]?.cells[0]).toBe('Vöyri');
  });

  test('decodes an accented name the captures did not happen to contain', () => {
    expect(harvestRows(row('Ren&eacute; Virtanen'))[0]?.cells[0]).toBe('René Virtanen');
    expect(harvestRows(row('M&uuml;ller'))[0]?.cells[0]).toBe('Müller');
  });

  test('does not double-decode: a literal &auml; stays literal', () => {
    // &amp;auml; is the text "&auml;", not the letter ä. Decoding &amp; first
    // turns one into the other.
    expect(harvestRows(row('&amp;auml;'))[0]?.cells[0]).toBe('&auml;');
  });

  test('decodes a plain ampersand', () => {
    expect(harvestRows(row('Salo &amp; Poika'))[0]?.cells[0]).toBe('Salo & Poika');
  });

  test('classifies each row by which cell carries the value', () => {
    expect(harvestRows(YEAR_EXPANDED).slice(2, 5).map((r) => r.kind)).toEqual([
      'player',
      'year',
      'date',
    ]);
  });
});
