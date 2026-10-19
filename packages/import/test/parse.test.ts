import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  parseDateCell,
  parseDates,
  parseNodes,
  parsePageCount,
  parsePagerLinks,
  parsePlayers,
  parseViewId,
  parseYears,
} from '../src/parse.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => readFileSync(path.join(fixtures, `${name}.html`), 'utf8');

const level1 = fixture('level1-page1');
const level1Page2 = fixture('level1-page2');
const playerExpanded = fixture('player-expanded');
const yearExpanded = fixture('year-expanded');

describe('parseViewId', () => {
  test('reads the XPages view state token the POSTs must echo back', () => {
    expect(parseViewId(level1)).toMatch(/^!.+!$/);
  });

  test('throws rather than posting without one', () => {
    expect(() => parseViewId('<html><body>no form here</body></html>')).toThrow(/viewid/i);
  });
});

describe('parsePageCount', () => {
  test('the collapsed level-1 view is 16 pages', () => {
    expect(parsePageCount(level1)).toBe(16);
  });

  test('expanding adds rows and therefore pages', () => {
    // This is why the walker collapses a player before paging on: the page
    // boundaries move while anything is expanded.
    expect(parsePageCount(yearExpanded)).toBeGreaterThan(16);
  });

  test('a view with no pager is a single page', () => {
    expect(parsePageCount('<html><body><table></table></body></html>')).toBe(1);
  });
});

describe('parsePlayers', () => {
  test('reads 30 players from the first page', () => {
    expect(parsePlayers(level1)).toHaveLength(30);
  });

  test('reads name, total and view position', () => {
    expect(parsePlayers(level1).slice(0, 3)).toEqual([
      { name: 'Olli Salo', total: 2, position: '1' },
      { name: 'Olli Väänänen', total: 63, position: '2' },
      { name: 'Matti Virtanen', total: 278, position: '3' },
    ]);
  });

  test('positions continue across pages rather than restarting', () => {
    const [first] = parsePlayers(level1Page2);
    expect(first).toEqual({ name: 'Tuomas Aalto', total: 29, position: '31' });
  });

  test('keeps Finnish characters intact', () => {
    const names = parsePlayers(level1Page2).map((p) => p.name);
    expect(names).toContain('Tuomas Mäkinen');
  });

  test('keeps a goalkeeper marker as part of the name', () => {
    // "Tuomas Aalto" and "Tuomas Aalto (MV)" are two separate rows in Domino and
    // must stay two separate players through the import.
    const names = parsePlayers(level1Page2).map((p) => p.name);
    expect(names).toContain('Tuomas Aalto');
    expect(names).toContain('Tuomas Aalto (MV)');
  });

  test('ignores year and date rows', () => {
    expect(parsePlayers(yearExpanded).map((p) => p.name)).not.toContain('');
  });
});

describe('parseYears', () => {
  test('reads a player year breakdown with its positions', () => {
    expect(parseYears(playerExpanded)).toEqual([
      { year: '2026', count: 25, position: '3.1' },
      { year: '2025', count: 47, position: '3.2' },
      { year: '2024', count: 41, position: '3.3' },
      { year: '2023', count: 25, position: '3.4' },
      { year: '2022', count: 29, position: '3.5' },
      { year: '2021', count: 33, position: '3.6' },
      { year: '2020', count: 52, position: '3.7' },
      { year: '2019', count: 17, position: '3.8' },
      { year: '2018', count: 2, position: '3.9' },
      { year: '2017', count: 7, position: '3.10' },
    ]);
  });

  test('the year counts sum to the total Domino reports for that player', () => {
    const total = parsePlayers(playerExpanded).find((p) => p.name === 'Matti Virtanen')?.total;
    const summed = parseYears(playerExpanded).reduce((acc, y) => acc + y.count, 0);
    expect(summed).toBe(total);
    expect(summed).toBe(278);
  });

  test('is empty on a collapsed view', () => {
    expect(parseYears(level1)).toEqual([]);
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
    const dates = parseDates(yearExpanded);

    expect(dates[0]).toEqual({ date: '2026-01-12', weekday: 'Maanantai', count: 1 });
    expect(dates.map((d) => d.date)).toContain('2026-04-15');
    expect(dates.every((d) => d.count === 1)).toBe(true);
  });

  test('every date is a real calendar date in the expected year', () => {
    for (const { date } of parseDates(yearExpanded)) {
      expect(date).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10)).toBe(date);
    }
  });

  test('is empty before any year is expanded', () => {
    expect(parseDates(playerExpanded)).toEqual([]);
  });
});

describe('parseNodes', () => {
  test('reports a collapsed player node with the submit id a POST needs', () => {
    const node = parseNodes(level1).find((n) => n.position === '3');

    expect(node).toMatchObject({ position: '3', level: 1, expanded: false });
    expect(node?.submitId).toBe('view:_id1:_id2:callback2:viewPanel1:2:viewColumn1__expand:3');
  });

  test('reports the same node as expanded once it has been opened', () => {
    const node = parseNodes(playerExpanded).find((n) => n.position === '3');

    expect(node).toMatchObject({ expanded: true, level: 1 });
    expect(node?.submitId).toContain('__shrink:3');
  });

  test('reports a year node on the second column', () => {
    const node = parseNodes(playerExpanded).find((n) => n.position === '3.1');

    expect(node).toMatchObject({ position: '3.1', level: 2, expanded: false });
    expect(node?.submitId).toBe('view:_id1:_id2:callback2:viewPanel1:3:viewColumn2__expand:3.1');
  });

  test('row indexes shift as rows above are expanded', () => {
    // Position 4 sits at row 3 when everything is collapsed, and at row 13
    // once player 3 is showing ten years. Submit ids must be re-read, never
    // computed from the position.
    expect(parseNodes(level1).find((n) => n.position === '4')?.rowIndex).toBe(3);
    expect(parseNodes(playerExpanded).find((n) => n.position === '4')?.rowIndex).toBe(13);
  });
});

describe('parsePagerLinks', () => {
  test('maps every other page to the submit id that jumps there', () => {
    const links = parsePagerLinks(level1);

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
    expect(parsePagerLinks(level1).map((l) => l.page)).not.toContain(1);
  });

  test('is empty when there is only one page', () => {
    expect(parsePagerLinks('<html><body></body></html>')).toEqual([]);
  });
});
