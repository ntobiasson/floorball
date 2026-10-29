import { afterAll, beforeAll, beforeEach, describe, expect, it, test } from 'vitest';
import {
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { createTestTable, dropTestTable, localClient } from './harness.js';
import { createRepo, NotRegisteredError, SlotNotFoundError, type Repo } from '../src/repo.js';
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
    const second = await repo.register({ gameDate: WEDNESDAY, rawName: 'Antti  AALTO' });

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

  test('marks the goalkeeper in the same write that puts the name on the list', async () => {
    await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen', isGoalkeeper: true });

    const [entry] = await repo.listRegistrations(MONDAY);
    expect(entry?.isGoalkeeper).toBe(true);
  });

  test('leaves no mark behind when nobody said goalkeeper', async () => {
    await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen', isGoalkeeper: false });

    const [entry] = await repo.listRegistrations(MONDAY);
    expect(entry?.isGoalkeeper).toBeUndefined();
  });

  test('a goalkeeper still counts as a game played, like any other night', async () => {
    const { playerId } = await repo.register({
      gameDate: MONDAY,
      rawName: 'Jukka Rantanen',
      isGoalkeeper: true,
    });

    const player = await repo.getPlayer(playerId);
    expect(player?.total).toBe(1);
    expect(player?.years).toEqual([{ year: '2026', count: 1 }]);
  });

  test('registering as goalkeeper is still a fact about that one night', async () => {
    await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen', isGoalkeeper: true });

    await repo.register({ gameDate: WEDNESDAY, rawName: 'Jukka Rantanen' });

    const [wednesday] = await repo.listRegistrations(WEDNESDAY);
    expect(wednesday?.isGoalkeeper).toBeUndefined();
  });
});

/**
 * A registration is stored under its day, which answers "who played on this
 * date". The reverse question — "which dates did this player play" — is what
 * the index keys on the day row are for.
 */
describe('listPlayerDates', () => {
  test('gives back every date that player registered for, newest first', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });
    await repo.register({ gameDate: WEDNESDAY, rawName: 'Jukka Rantanen' });

    expect(await repo.listPlayerDates(playerId)).toEqual([WEDNESDAY, MONDAY]);
  });

  test('spans the years, as the archive does', async () => {
    const { playerId } = await repo.register({ gameDate: '2024-10-21', rawName: 'Jukka Rantanen' });
    await repo.register({ gameDate: '2025-10-20', rawName: 'Jukka Rantanen' });
    await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });

    expect(await repo.listPlayerDates(playerId)).toEqual([MONDAY, '2025-10-20', '2024-10-21']);
  });

  test('carries nobody else s dates', async () => {
    const mine = await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });
    await repo.register({ gameDate: WEDNESDAY, rawName: 'Matti Virtanen' });

    expect(await repo.listPlayerDates(mine.playerId)).toEqual([MONDAY]);
  });

  test('a date that was unregistered is gone from it', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });
    await repo.register({ gameDate: WEDNESDAY, rawName: 'Jukka Rantanen' });

    await repo.unregister({ gameDate: MONDAY, playerId });

    expect(await repo.listPlayerDates(playerId)).toEqual([WEDNESDAY]);
  });

  test('is empty for somebody who has never played', async () => {
    expect(await repo.listPlayerDates('EI-OLE')).toEqual([]);
  });

  test('leaves the directory query alone, sharing the index with it', async () => {
    await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });

    // The day rows now live in GSI1 too, under their own partition key.
    const players = await repo.listPlayers();
    expect(players.map((p) => p.displayName)).toEqual(['Jukka Rantanen']);
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
    // Ordered by normalized name, not by total.
    expect(players.map((p) => p.displayName)).toEqual(['Liisa Korhonen', 'Matti Virtanen']);
    expect(players.map((p) => p.total)).toEqual([1, 2]);
  });

  test('is empty before anyone registers', async () => {
    expect(await repo.listPlayers()).toEqual([]);
  });
});

describe('listHistory', () => {
  test('returns every player with their per-year counts, ordered by name', async () => {
    await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });
    await repo.register({ gameDate: '2026-10-21', rawName: 'Matti Virtanen' });
    await repo.register({ gameDate: '2024-01-15', rawName: 'Matti Virtanen' });
    await repo.register({ gameDate: '2026-10-19', rawName: 'Liisa Korhonen' });

    const players = await repo.listHistory();

    expect(players.map((p) => p.displayName)).toEqual(['Liisa Korhonen', 'Matti Virtanen']);
    expect(players[0]?.years).toEqual([{ year: '2026', count: 1 }]);
    // Newest year first, as getPlayer already orders them.
    expect(players[1]?.years).toEqual([
      { year: '2026', count: 2 },
      { year: '2024', count: 1 },
    ]);
    expect(players[1]?.total).toBe(3);
  });

  test('is empty before anyone registers', async () => {
    expect(await repo.listHistory()).toEqual([]);
  });

  test('leaves out a player who has registered for nothing', async () => {
    // resolvePlayer creates a profile for any name submitted, so a name typed
    // into the form but never registered must not appear in the history.
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });
    await repo.unregister({ gameDate: '2026-10-19', playerId });

    expect(await repo.listHistory()).toEqual([]);
  });

  test('leaves out a year the player ended up not playing', async () => {
    // An unregister decrements the year row to zero rather than deleting it,
    // so a year with nothing in it must not reach the page as an empty bar.
    await repo.register({ gameDate: '2024-01-15', rawName: 'Matti Virtanen' });
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });
    await repo.unregister({ gameDate: '2026-10-19', playerId });

    const players = await repo.listHistory();
    expect(players[0]?.years).toEqual([{ year: '2024', count: 1 }]);
  });

  test('leaves out a player merged into another', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Pekka N' });
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `PLAYER#${playerId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET mergedInto = :into',
        ExpressionAttributeValues: { ':into': 'p-other' },
      }),
    );

    expect(await repo.listHistory()).toEqual([]);
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

describe('a table left in a corrupted state', () => {
  // These states are reachable: load.ts writes NAME#, PROFILE and YEAR# items
  // in BatchWriteItem chunks of 25, so a chunk boundary can fall between a
  // name lookup and its profile. `ADD` upserts, so without conditions the
  // write path invents the missing item instead of refusing.

  test('register refuses a name whose lookup points at a missing profile', async () => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: 'NAME#matti virtanen',
          SK: 'NAME',
          playerId: 'ORPHAN01',
          normalizedName: 'matti virtanen',
        },
      }),
    );

    await expect(repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' })).rejects.toThrow(
      /ORPHAN01|profile/i,
    );
  });

  test('that refusal writes nothing at all', async () => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: 'NAME#matti virtanen',
          SK: 'NAME',
          playerId: 'ORPHAN01',
          normalizedName: 'matti virtanen',
        },
      }),
    );

    await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' }).catch(() => undefined);

    expect(await repo.listRegistrations(MONDAY)).toEqual([]);
    const planted = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'PLAYER#ORPHAN01' },
      }),
    );
    // No fabricated profile, and therefore no player that is invisible to
    // listPlayers while holding a day row.
    expect(planted.Items ?? []).toEqual([]);
  });

  test('unregister refuses rather than driving a total negative', async () => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `DAY#${MONDAY}`,
          SK: 'PLAYER#GHOST01',
          playerId: 'GHOST01',
          displayName: 'Ghost',
          createdAt: '2026-10-19T06:00:00Z',
        },
      }),
    );

    await expect(repo.unregister({ gameDate: MONDAY, playerId: 'GHOST01' })).rejects.toThrow();

    const planted = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'PLAYER#GHOST01' },
      }),
    );
    expect(planted.Items ?? []).toEqual([]);
  });

  test('no total can be negative after a failed removal', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });
    await repo.unregister({ gameDate: MONDAY, playerId });

    await expect(repo.unregister({ gameDate: MONDAY, playerId })).rejects.toThrow(
      /not registered/i,
    );

    expect((await repo.getPlayer(playerId))?.total).toBe(0);
  });

  test('a lost creation race whose winner cannot be read back fails clearly', async () => {
    // The loser of a NAME# creation race re-reads the lookup to find the
    // winner's id. If that read comes back empty the raw
    // TransactionCanceledException used to escape as an unhandled 500.
    const cancelling = {
      send: async (command: unknown) => {
        if (command instanceof TransactWriteCommand) {
          throw new TransactionCanceledException({
            message: 'simulated',
            $metadata: {},
            CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
          });
        }
        return client.send(command as never);
      },
    } as unknown as DynamoDBDocumentClient;

    const brittle = createRepo({ client: cancelling, tableName });

    await expect(brittle.register({ gameDate: MONDAY, rawName: 'Uusi Nimi' })).rejects.toThrow(
      /could not be resolved|race/i,
    );
  });
});

describe('a merged player', () => {
  test('registering the merged-away name lands on the surviving player', async () => {
    const winner = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });
    const loser = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen (EHKÄ)' });

    // What the runbook's merge procedure leaves behind.
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `PLAYER#${loser.playerId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET mergedInto = :winner',
        ExpressionAttributeValues: { ':winner': winner.playerId },
      }),
    );

    const again = await repo.register({ gameDate: WEDNESDAY, rawName: 'Matti Virtanen (EHKÄ)' });

    expect(again.playerId).toBe(winner.playerId);
    expect(again.displayName).toBe('Matti Virtanen');
  });

  test('a merged player is not listed in the directory', async () => {
    const winner = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });
    const loser = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen (EHKÄ)' });
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `PLAYER#${loser.playerId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET mergedInto = :winner',
        ExpressionAttributeValues: { ':winner': winner.playerId },
      }),
    );

    expect((await repo.listPlayers()).map((p) => p.displayName)).toEqual(['Matti Virtanen']);
  });

  test('a merge chain is followed only one hop, and never loops', async () => {
    const a = await repo.register({ gameDate: MONDAY, rawName: 'A Pelaaja' });
    const b = await repo.register({ gameDate: MONDAY, rawName: 'B Pelaaja' });
    // A deliberately pathological pair of mutual merges.
    for (const [from, to] of [
      [a.playerId, b.playerId],
      [b.playerId, a.playerId],
    ]) {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: `PLAYER#${from}`, SK: 'PROFILE' },
          UpdateExpression: 'SET mergedInto = :to',
          ExpressionAttributeValues: { ':to': to },
        }),
      );
    }

    await expect(
      repo.register({ gameDate: WEDNESDAY, rawName: 'A Pelaaja' }),
    ).resolves.toBeDefined();
  });
});

describe('the directory', () => {
  test('omits a player with no games, so junk names cannot pollute it', async () => {
    // resolvePlayer creates a profile for any new name and unregister never
    // removes it, so without this an open form lets anyone permanently add
    // hundreds of names to the SPA's directory and combobox.
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Yhden Kerran' });
    await repo.unregister({ gameDate: MONDAY, playerId });

    expect(await repo.listPlayers()).toEqual([]);
    // The player still exists and is still reachable directly.
    expect((await repo.getPlayer(playerId))?.total).toBe(0);
  });

  test('a player returns to the directory when they register again', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Yhden Kerran' });
    await repo.unregister({ gameDate: MONDAY, playerId });
    await repo.register({ gameDate: WEDNESDAY, rawName: 'Yhden Kerran' });

    expect((await repo.listPlayers()).map((p) => p.displayName)).toEqual(['Yhden Kerran']);
  });
});

describe('announcement validity dates', () => {
  test('defaults validFrom to the Helsinki date, not the UTC date', async () => {
    // 21:30Z in June is already the 14th in Helsinki. A UTC slice dates the
    // announcement a day early and skews its sort key.
    const lateEvening = createRepo({
      client,
      tableName,
      now: () => new Date('2026-06-13T21:30:00Z'),
    });

    const created = await lateEvening.createAnnouncement({ body: 'Myöhäinen tiedote' });

    expect(created.validFrom).toBe('2026-06-14');
    expect(await lateEvening.listAnnouncements('2026-06-14')).toHaveLength(1);
  });

  test('an announcement written late in the evening is not visible yesterday', async () => {
    const lateEvening = createRepo({
      client,
      tableName,
      now: () => new Date('2026-06-13T21:30:00Z'),
    });

    await lateEvening.createAnnouncement({ body: 'Myöhäinen tiedote' });

    expect(await lateEvening.listAnnouncements('2026-06-13')).toEqual([]);
  });
});

describe('managing announcements', () => {
  test('lists every announcement, including ones outside their validity window', async () => {
    // The management page must show what the landing page hides, or an
    // expired announcement can never be deleted.
    await repo.createAnnouncement({ body: 'Vanha', validTo: '2026-10-18' });
    await repo.createAnnouncement({ body: 'Voimassa' });
    await repo.createAnnouncement({ body: 'Tuleva', validFrom: '2026-12-01' });

    expect((await repo.listAnnouncements(MONDAY)).map((a) => a.body)).toEqual(['Voimassa']);
    expect((await repo.listAllAnnouncements()).map((a) => a.body).sort()).toEqual([
      'Tuleva',
      'Vanha',
      'Voimassa',
    ]);
  });

  test('deletes an announcement by id', async () => {
    const created = await repo.createAnnouncement({ body: 'Poistettava' });

    await repo.deleteAnnouncement(created.id);

    expect(await repo.listAllAnnouncements()).toEqual([]);
  });

  test('deletes the one asked for and leaves the others', async () => {
    const keep = await repo.createAnnouncement({ body: 'Jää' });
    const drop = await repo.createAnnouncement({ body: 'Poistuu' });

    await repo.deleteAnnouncement(drop.id);

    expect((await repo.listAllAnnouncements()).map((a) => a.id)).toEqual([keep.id]);
  });

  test('deletes one whose validity has passed', async () => {
    // Its sort key is built from validFrom, so deleting by id alone has to
    // find it rather than assume today's date.
    const old = await repo.createAnnouncement({ body: 'Vanha', validFrom: '2024-01-01' });

    await repo.deleteAnnouncement(old.id);

    expect(await repo.listAllAnnouncements()).toEqual([]);
  });

  test('refuses to delete an id that is not there', async () => {
    await expect(repo.deleteAnnouncement('ei-ole')).rejects.toThrow(/not found|ei löytynyt/i);
  });
});

describe('setGoalkeeper', () => {
  test('marks a registered player, and the day s list says so', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });

    await repo.setGoalkeeper({ gameDate: MONDAY, playerId, isGoalkeeper: true });

    const [entry] = await repo.listRegistrations(MONDAY);
    expect(entry?.isGoalkeeper).toBe(true);
  });

  test('unmarks again, because it is decided on the night and changes', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });
    await repo.setGoalkeeper({ gameDate: MONDAY, playerId, isGoalkeeper: true });

    await repo.setGoalkeeper({ gameDate: MONDAY, playerId, isGoalkeeper: false });

    const [entry] = await repo.listRegistrations(MONDAY);
    expect(entry?.isGoalkeeper).toBeUndefined();
  });

  test('leaves everyone else alone', async () => {
    const keeper = await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });
    await repo.register({ gameDate: MONDAY, rawName: 'Mikko Laine' });

    await repo.setGoalkeeper({ gameDate: MONDAY, playerId: keeper.playerId, isGoalkeeper: true });

    const marked = (await repo.listRegistrations(MONDAY))
      .filter((r) => r.isGoalkeeper === true)
      .map((r) => r.displayName);
    expect(marked).toEqual(['Jukka Rantanen']);
  });

  test('several keepers on one night are allowed', async () => {
    const a = await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });
    const b = await repo.register({ gameDate: MONDAY, rawName: 'Matti Virtanen' });

    await repo.setGoalkeeper({ gameDate: MONDAY, playerId: a.playerId, isGoalkeeper: true });
    await repo.setGoalkeeper({ gameDate: MONDAY, playerId: b.playerId, isGoalkeeper: true });

    const marked = (await repo.listRegistrations(MONDAY)).filter((r) => r.isGoalkeeper === true);
    expect(marked).toHaveLength(2);
  });

  test('is a fact about one night, not about the player', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });
    await repo.setGoalkeeper({ gameDate: MONDAY, playerId, isGoalkeeper: true });

    await repo.register({ gameDate: WEDNESDAY, rawName: 'Jukka Rantanen' });

    const [wednesday] = await repo.listRegistrations(WEDNESDAY);
    expect(wednesday?.isGoalkeeper).toBeUndefined();
  });

  test('refuses somebody who is not on that day s list', async () => {
    const { playerId } = await repo.register({ gameDate: MONDAY, rawName: 'Jukka Rantanen' });

    await expect(
      repo.setGoalkeeper({ gameDate: WEDNESDAY, playerId, isGoalkeeper: true }),
    ).rejects.toThrow(NotRegisteredError);
  });
});

describe('slots', () => {
  it('reports an untouched table as uninitialised, with no slots', async () => {
    expect(await repo.listSlots()).toEqual({ slots: [], initialised: false });
  });

  it('stores a slot and hands back its id', async () => {
    const slot = await repo.createSlot({ weekday: 1, startTime: '20:00', endTime: '21:30' });
    expect(slot.id).toMatch(/\S/);
    expect(await repo.listSlots()).toEqual({ slots: [{ ...slot }], initialised: true });
  });

  it('omits an end time that was not given', async () => {
    const slot = await repo.createSlot({ weekday: 3, startTime: '20:00' });
    expect(slot.endTime).toBeUndefined();
  });

  it('keeps two slots on the same weekday apart', async () => {
    await repo.createSlot({ weekday: 1, startTime: '18:00' });
    await repo.createSlot({ weekday: 1, startTime: '20:00' });
    expect((await repo.listSlots()).slots).toHaveLength(2);
  });

  it('never returns the marker as a slot', async () => {
    await repo.createSlot({ weekday: 1, startTime: '20:00' });
    // One slot written, two rows in the partition.
    const { slots } = await repo.listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0]?.weekday).toBe(1);
  });

  it('removes a slot and leaves the table initialised', async () => {
    const slot = await repo.createSlot({ weekday: 1, startTime: '20:00' });
    await repo.deleteSlot(slot.id);
    expect(await repo.listSlots()).toEqual({ slots: [], initialised: true });
  });

  it('refuses to remove a slot that is not there', async () => {
    await expect(repo.deleteSlot('ei-ole')).rejects.toThrow(SlotNotFoundError);
  });
});
