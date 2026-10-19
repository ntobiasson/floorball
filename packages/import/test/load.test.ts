import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createRepo } from '@sahlykanta/api/src/repo.js';
import { createTestTable, dropTestTable, localClient } from '@sahlykanta/api/test/harness.js';
import { loadHarvest } from '../src/load.js';
import type { LoadablePlayer } from '../src/load.js';
import type { HarvestedRegistration } from '../src/walk.js';

const PLAYERS: LoadablePlayer[] = [
  {
    name: 'Matti Virtanen',
    total: 3,
    years: [
      { year: '2026', count: 2 },
      { year: '2025', count: 1 },
    ],
  },
  { name: 'Matti Virtanen (EHKÄ)', total: 1, years: [{ year: '2026', count: 1 }] },
  { name: 'Liisa Korhonen', total: 1, years: [{ year: '2024', count: 1 }] },
];

const REGISTRATIONS: HarvestedRegistration[] = [
  { name: 'Matti Virtanen', date: '2026-01-12', weekday: 'Maanantai' },
  { name: 'Matti Virtanen', date: '2026-04-15', weekday: 'Keskiviikko' },
  { name: 'Matti Virtanen', date: '2025-10-20', weekday: 'Maanantai' },
  { name: 'Matti Virtanen (EHKÄ)', date: '2026-01-12', weekday: 'Maanantai' },
  { name: 'Liisa Korhonen', date: '2024-02-03', weekday: 'Lauantai' },
];

let client: DynamoDBDocumentClient;
let tableName: string;

beforeAll(async () => {
  client = localClient();
  tableName = await createTestTable(client);
});

afterAll(async () => {
  await dropTestTable(client, tableName);
});

beforeEach(async () => {
  await dropTestTable(client, tableName);
  tableName = await createTestTable(client);
});

const load = () =>
  loadHarvest({
    client,
    tableName,
    players: PLAYERS,
    registrations: REGISTRATIONS,
  });

const scanAll = async () => {
  const out = await client.send(new ScanCommand({ TableName: tableName }));
  return out.Items ?? [];
};

describe('loadHarvest', () => {
  test('reports what it wrote', async () => {
    const result = await load();

    expect(result.players).toBe(3);
    expect(result.registrations).toBe(5);
  });

  test('every registration becomes one day row', async () => {
    await load();

    const dayRows = (await scanAll()).filter((i) => String(i.PK).startsWith('DAY#'));
    expect(dayRows).toHaveLength(5);
    expect(dayRows.every((i) => i.source === 'domino-import')).toBe(true);
  });

  test('the totals sum to the number of registration rows', async () => {
    await load();

    const items = await scanAll();
    const totals = items
      .filter((i) => i.SK === 'PROFILE')
      .reduce((acc, i) => acc + Number(i.total), 0);
    const dayRows = items.filter((i) => String(i.PK).startsWith('DAY#')).length;

    expect(totals).toBe(dayRows);
    expect(totals).toBe(5);
  });

  test('the loaded data reads back through the API repository', async () => {
    await load();
    const repo = createRepo({ client, tableName });

    const players = await repo.listPlayers();
    expect(players.map((p) => p.displayName)).toEqual([
      'Matti Virtanen',
      'Matti Virtanen (EHKÄ)',
      'Liisa Korhonen',
    ]);

    const aatu = players.find((p) => p.displayName === 'Matti Virtanen');
    const detail = await repo.getPlayer(aatu?.playerId ?? '');
    expect(detail?.total).toBe(3);
    expect(detail?.years).toEqual([
      { year: '2026', count: 2 },
      { year: '2025', count: 1 },
    ]);
  });

  test("today's list reads back for a historical date", async () => {
    await load();
    const repo = createRepo({ client, tableName });

    const onThatMonday = await repo.listRegistrations('2026-01-12');
    expect(onThatMonday.map((r) => r.displayName).sort()).toEqual([
      'Matti Virtanen',
      'Matti Virtanen (EHKÄ)',
    ]);
  });

  test('a parenthesised suffix stays a separate player', async () => {
    await load();
    const repo = createRepo({ client, tableName });

    const players = await repo.listPlayers();
    const ids = new Set(players.map((p) => p.playerId));
    expect(ids.size).toBe(3);
  });

  test('is idempotent: loading twice leaves the same totals and rows', async () => {
    await load();
    const first = await scanAll();

    await load();
    const second = await scanAll();

    expect(second).toHaveLength(first.length);
    const totalsOf = (items: typeof first) =>
      items
        .filter((i) => i.SK === 'PROFILE')
        .map((i) => [i.displayName, i.total])
        .sort();
    expect(totalsOf(second)).toEqual(totalsOf(first));
  });

  test('a reload keeps the same player ids rather than orphaning history', async () => {
    await load();
    const repo = createRepo({ client, tableName });
    const before = (await repo.listPlayers()).map((p) => p.playerId).sort();

    await load();
    const after = (await repo.listPlayers()).map((p) => p.playerId).sort();

    expect(after).toEqual(before);
  });

  test('refuses a harvest whose totals disagree with its registrations', async () => {
    await expect(
      loadHarvest({
        client,
        tableName,
        players: [{ name: 'Matti Virtanen', total: 9, years: [{ year: '2026', count: 9 }] }],
        registrations: [{ name: 'Matti Virtanen', date: '2026-01-12', weekday: 'Maanantai' }],
      }),
    ).rejects.toThrow(/9 .*1|disagree|mismatch/i);
  });

  test('refuses a registration whose player is not in the harvest', async () => {
    await expect(
      loadHarvest({
        client,
        tableName,
        players: [],
        registrations: [{ name: 'Kuka Tahansa', date: '2026-01-12', weekday: 'Maanantai' }],
      }),
    ).rejects.toThrow(/unknown player/i);
  });

  test('writes more than one batch when there are over 25 items', async () => {
    const many: LoadablePlayer[] = [];
    const manyRegistrations: HarvestedRegistration[] = [];
    for (let i = 0; i < 40; i += 1) {
      many.push({ name: `Pelaaja ${i}`, total: 1, years: [{ year: '2026', count: 1 }] });
      manyRegistrations.push({
        name: `Pelaaja ${i}`,
        date: '2026-01-12',
        weekday: 'Maanantai',
      });
    }

    const result = await loadHarvest({
      client,
      tableName,
      players: many,
      registrations: manyRegistrations,
    });

    expect(result.players).toBe(40);
    const repo = createRepo({ client, tableName });
    expect(await repo.listPlayers()).toHaveLength(40);
  });
});

describe('re-running over a table that is already in use', () => {
  test('refuses rather than silently discarding games played since the import', async () => {
    // The runbook points the loader at the deployed table and calls a re-run
    // safe. A blind profile overwrite sets `total` back to the import figure
    // while the newer DAY# rows stay in the table: three day rows, totals
    // saying two, and the game someone played yesterday gone from
    // Peliaktiivisuus.
    await load();
    const repo = createRepo({ client, tableName });
    await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });

    await expect(load()).rejects.toThrow(/live|since the import|--force/i);
  });

  test('that refusal leaves the live registration intact', async () => {
    await load();
    const repo = createRepo({ client, tableName });
    const before = await repo.getPlayer(
      (await repo.listPlayers()).find((p) => p.displayName === 'Matti Virtanen')?.playerId ?? '',
    );
    await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });

    await load().catch(() => undefined);

    const after = await repo.getPlayer(
      (await repo.listPlayers()).find((p) => p.displayName === 'Matti Virtanen')?.playerId ?? '',
    );
    expect(after?.total).toBe((before?.total ?? 0) + 1);
  });

  test('an identical re-run after a crash is still allowed', async () => {
    // Partial loads must stay recoverable: a profile written with a smaller
    // total, or not written at all, is not evidence of live use.
    await load();

    await expect(load()).resolves.toMatchObject({ players: 3 });
  });

  test('--force overrides the refusal, for an operator who means it', async () => {
    await load();
    const repo = createRepo({ client, tableName });
    await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });

    const result = await loadHarvest({
      client,
      tableName,
      players: PLAYERS,
      registrations: REGISTRATIONS,
      force: true,
    });

    expect(result.players).toBe(3);
  });

  test('names the players whose totals disagree, not just that something is wrong', async () => {
    await load();
    const repo = createRepo({ client, tableName });
    await repo.register({ gameDate: '2026-10-19', rawName: 'Liisa Korhonen' });

    await expect(load()).rejects.toThrow(/Liisa Korhonen/);
  });
});
