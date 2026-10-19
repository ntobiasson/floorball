import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createTestTable, dropTestTable, localClient } from './harness.js';
import { createRepo, type Repo } from '../src/repo.js';
import { auditPk } from '../src/table.js';

const MONDAY = '2026-10-19';
const WEDNESDAY = '2026-10-21';

let client: DynamoDBDocumentClient;
let tableName: string;
let repo: Repo;

beforeAll(async () => {
  client = localClient();
  tableName = await createTestTable(client);
});

afterAll(async () => {
  await dropTestTable(client, tableName);
});

beforeEach(async () => {
  // A fresh table per test keeps totals independent without a delete sweep.
  await dropTestTable(client, tableName);
  tableName = await createTestTable(client);
  repo = createRepo({ client, tableName, now: () => new Date('2026-10-19T06:00:00Z') });
});

describe('register', () => {
  test('creates the player, the registration, the total and the year count', async () => {
    const result = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });

    expect(result.created).toBe(true);
    expect(result.displayName).toBe('Matti Virtanen');

    const today = await repo.listRegistrations(MONDAY);
    expect(today.map((r) => r.displayName)).toEqual(['Matti Virtanen']);

    const player = await repo.getPlayer(result.playerId);
    expect(player?.total).toBe(1);
    expect(player?.years).toEqual([{ year: '2026', count: 1 }]);
  });

  test('preserves the name as typed while matching case-insensitively', async () => {
    const first = await repo.register({ gameDate: MONDAY, rawName: 'antti aalto' });
    const second = await repo.register({ gameDate: WEDNESDAY, rawName: 'Antti  ALAPIHA' });

    expect(second.playerId).toBe(first.playerId);
    expect(second.created).toBe(false);
    const player = await repo.getPlayer(first.playerId);
    expect(player?.displayName).toBe('antti aalto');
    expect(player?.total).toBe(2);
  });

  test('rejects the same player twice on the same day and leaves the total alone', async () => {
    const first = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });
    await expect(repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' })).rejects.toThrow(
      /already registered/i,
    );

    const player = await repo.getPlayer(first.playerId);
    expect(player?.total).toBe(1);
    expect(await repo.listRegistrations(MONDAY)).toHaveLength(1);
  });

  test('treats a parenthesised suffix as a different player', async () => {
    const plain = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });
    const maybe = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen (EHKÄ)' });

    expect(maybe.playerId).not.toBe(plain.playerId);
    expect(await repo.listRegistrations(MONDAY)).toHaveLength(2);
  });

  test('two concurrent registrations of the same new name converge on one player', async () => {
    const [a, b] = await Promise.all([
      repo.register({ gameDate: MONDAY, rawName: 'Uusi Pelaaja' }),
      repo.register({ gameDate: WEDNESDAY, rawName: 'Uusi Pelaaja' }),
    ]);

    expect(a.playerId).toBe(b.playerId);
    const players = await repo.listPlayers();
    expect(players.filter((p) => p.displayName === 'Uusi Pelaaja')).toHaveLength(1);
    expect(players.find((p) => p.displayName === 'Uusi Pelaaja')?.total).toBe(2);
  });

  test('counts two different years separately', async () => {
    const first = await repo.register({ gameDate: '2025-10-20', rawName: 'Matti Virtanen' });
    await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });

    const player = await repo.getPlayer(first.playerId);
    expect(player?.total).toBe(2);
    expect(player?.years).toEqual([
      { year: '2026', count: 1 },
      { year: '2025', count: 1 },
    ]);
  });
});

describe('unregister', () => {
  test('removes the row and decrements both the total and the year count', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });

    await repo.unregister({ gameDate: MONDAY, playerId });

    expect(await repo.listRegistrations(MONDAY)).toEqual([]);
    const player = await repo.getPlayer(playerId);
    expect(player?.total).toBe(0);
    expect(player?.years).toEqual([{ year: '2026', count: 0 }]);
  });

  test('rejects removing a registration that is not there', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });

    await expect(repo.unregister({ gameDate: WEDNESDAY, playerId })).rejects.toThrow(
      /not registered/i,
    );
  });

  test('a player can register again after being removed', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });
    await repo.unregister({ gameDate: MONDAY, playerId });
    await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });

    expect(await repo.listRegistrations(MONDAY)).toHaveLength(1);
    expect((await repo.getPlayer(playerId))?.total).toBe(1);
  });
});

describe('listPlayers', () => {
  test('returns every player with their total, ordered by name', async () => {
    await repo.register({ gameDate: MONDAY, rawName: 'Liisa Korhonen' });
    await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });
    await repo.register({ gameDate: WEDNESDAY, rawName: 'Matti Virtanen' });

    const players = await repo.listPlayers();
    expect(players.map((p) => p.displayName)).toEqual(['Matti Virtanen', 'Liisa Korhonen']);
    expect(players.map((p) => p.total)).toEqual([2, 1]);
  });

  test('is empty before anyone registers', async () => {
    expect(await repo.listPlayers()).toEqual([]);
  });
});

describe('getPlayer', () => {
  test('returns null for an unknown player', async () => {
    expect(await repo.getPlayer('nobody')).toBeNull();
  });
});

describe('audit trail', () => {
  const auditRows = async () => {
    const out = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': auditPk(MONDAY) },
      }),
    );
    return out.Items ?? [];
  };

  test('records a register and an unregister, each with an expiry', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });
    await repo.unregister({ gameDate: MONDAY, playerId });

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['register', 'unregister']);
    expect(rows.every((r) => typeof r.ttl === 'number' && r.ttl > 0)).toBe(true);
    expect(rows[0]?.name).toBe('Matti Virtanen');
  });

  test('records the caller fingerprint when one is supplied', async () => {
    await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen', ipHash: 'abc123' });

    const rows = await auditRows();
    expect(rows[0]?.ipHash).toBe('abc123');
  });
});

describe('announcements', () => {
  test('returns an announcement that is valid today', async () => {
    await repo.createAnnouncement({ body: 'Kenttä varattu 21.10. klo 18-19.' });

    const list = await repo.listAnnouncements(MONDAY);
    expect(list.map((a) => a.body)).toEqual(['Kenttä varattu 21.10. klo 18-19.']);
  });

  test('hides one whose validity has passed', async () => {
    await repo.createAnnouncement({ body: 'Vanha tiedote', validTo: '2026-10-18' });

    expect(await repo.listAnnouncements(MONDAY)).toEqual([]);
  });

  test('hides one that has not started yet', async () => {
    await repo.createAnnouncement({ body: 'Tuleva tiedote', validFrom: '2026-10-20' });

    expect(await repo.listAnnouncements(MONDAY)).toEqual([]);
  });

  test('shows one whose window includes today', async () => {
    await repo.createAnnouncement({
      body: 'Voimassa',
      validFrom: '2026-10-19',
      validTo: '2026-10-19',
    });

    expect(await repo.listAnnouncements(MONDAY)).toHaveLength(1);
  });
});
