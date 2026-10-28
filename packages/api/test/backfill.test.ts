import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PutCommand, GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createTestTable, dropTestTable, localClient } from './harness.js';
import { createRepo, type Repo } from '../src/repo.js';
import { backfillPlayerDates } from '../src/backfill.js';
import { dayPk, playerPk, playerSk, PROFILE_SK } from '../src/table.js';

/**
 * Every day row written before the index keys existed answers "who played on
 * this date" and nothing else. The backfill gives those rows their place in
 * GSI1, so a quarter of a century of imported games answers the reverse
 * question too.
 */

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
  await dropTestTable(client, tableName);
  tableName = await createTestTable(client);
  repo = createRepo({ client, tableName });
});

/** A registration as the table held them before the keys existed. */
async function oldStyleRegistration(date: string, playerId: string, name: string): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: dayPk(date),
        SK: playerSk(playerId),
        playerId,
        displayName: name,
        rawName: name,
        gameDate: date,
        source: 'domino-import',
        createdAt: `${date}T00:00:00.000Z`,
      },
    }),
  );
}

describe('backfillPlayerDates', () => {
  test('gives an old day row its place in the index', async () => {
    await oldStyleRegistration('2009-03-16', 'p-olli', 'Olli Väänänen');

    await backfillPlayerDates({ client, tableName });

    expect(await repo.listPlayerDates('p-olli')).toEqual(['2009-03-16']);
  });

  test('reports what it touched', async () => {
    await oldStyleRegistration('2009-03-16', 'p-olli', 'Olli Väänänen');
    await oldStyleRegistration('2009-03-18', 'p-olli', 'Olli Väänänen');

    const result = await backfillPlayerDates({ client, tableName });

    expect(result).toMatchObject({ scanned: expect.any(Number), updated: 2 });
  });

  test('is idempotent: a second run has nothing left to do', async () => {
    await oldStyleRegistration('2009-03-16', 'p-olli', 'Olli Väänänen');
    await backfillPlayerDates({ client, tableName });

    const second = await backfillPlayerDates({ client, tableName });

    expect(second.updated).toBe(0);
    expect(await repo.listPlayerDates('p-olli')).toEqual(['2009-03-16']);
  });

  test('leaves rows that already carry the keys exactly as they are', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });

    const result = await backfillPlayerDates({ client, tableName });

    expect(result.updated).toBe(0);
    expect(await repo.listPlayerDates(playerId)).toEqual(['2026-10-19']);
  });

  test('touches nothing that is not a registration', async () => {
    await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });
    const before = await repo.listPlayers();

    await backfillPlayerDates({ client, tableName });

    // A profile's own index keys put it in the directory; a day row must not
    // have overwritten them.
    expect(await repo.listPlayers()).toEqual(before);
  });

  test('a dry run says what it would do and changes nothing', async () => {
    await oldStyleRegistration('2009-03-16', 'p-olli', 'Olli Väänänen');

    const result = await backfillPlayerDates({ client, tableName, dryRun: true });

    expect(result.updated).toBe(1);
    expect(await repo.listPlayerDates('p-olli')).toEqual([]);
  });

  test('keeps every other attribute of the row it rewrites', async () => {
    await oldStyleRegistration('2009-03-16', 'p-olli', 'Olli Väänänen');

    await backfillPlayerDates({ client, tableName });

    const out = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: dayPk('2009-03-16'), SK: playerSk('p-olli') },
      }),
    );
    expect(out.Item).toMatchObject({
      displayName: 'Olli Väänänen',
      source: 'domino-import',
      createdAt: '2009-03-16T00:00:00.000Z',
    });
  });

  test('the day s own list still reads back afterwards', async () => {
    await oldStyleRegistration('2009-03-16', 'p-olli', 'Olli Väänänen');

    await backfillPlayerDates({ client, tableName });

    expect((await repo.listRegistrations('2009-03-16')).map((r) => r.displayName)).toEqual([
      'Olli Väänänen',
    ]);
  });

  test('a profile row is not mistaken for a registration', async () => {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: { PK: playerPk('p-ghost'), SK: PROFILE_SK, playerId: 'p-ghost', total: 0 },
      }),
    );

    const result = await backfillPlayerDates({ client, tableName });

    expect(result.updated).toBe(0);
  });
});
