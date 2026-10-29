#!/usr/bin/env node
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadHarvest } from '@sahlykanta/import/src/load.js';
import type { LoadablePlayer } from '@sahlykanta/import/src/load.js';
import type { HarvestedRegistration } from '@sahlykanta/import/src/walk.js';
import { createRepo } from '@sahlykanta/api/src/repo.js';

/**
 * Creates the local/e2e table and loads a slice of the real Domino export
 * through the production loader, so both the smoke tests and local
 * development run against data shaped exactly like the imported archive.
 *
 * The sample is invented, but shaped like the real archive, because the
 * things worth seeing are exactly what bland test data smooths away: a span
 * of years rather than weeks, a long-standing player beside a rare one, the
 * `(EHKÄ)` duplicate that must stay a separate player, somebody who stopped
 * in 2009 and survives only in the directory, and Torstai games that predate
 * the Mon/Wed/Sat rule.
 *
 * Generated rather than listed, so the shape is visible at a glance instead
 * of buried in hundreds of literal rows. One game falls on 19.10.2026, the
 * Monday the end-to-end run pins its clock to, so the day's list does not
 * start empty.
 */

const tableName = process.env.TABLE_NAME ?? 'sahlykanta-e2e';
const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8001';

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    endpoint,
    region: 'eu-north-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

async function recreateTable(): Promise<void> {
  try {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
  } catch {
    // First run: there is nothing to delete.
  }
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: {
            ProjectionType: 'INCLUDE',
            NonKeyAttributes: ['playerId', 'displayName', 'total', 'mergedInto'],
          },
        },
      ],
    }),
  );
}

const WEEKDAYS_FI = [
  'Maanantai',
  'Tiistai',
  'Keskiviikko',
  'Torstai',
  'Perjantai',
  'Lauantai',
  'Sunnuntai',
] as const;

/** Every `nth` matching weekday between the two years, inclusive. */
function playedOn(
  fromYear: number,
  toYear: number,
  weekdays: number[],
  nth: number,
  extra: string[] = [],
): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(fromYear, 0, 1));
  const end = Date.UTC(toYear, 11, 31);
  let seen = 0;
  while (cursor.getTime() <= end) {
    // getUTCDay is Sunday-first; shift to Monday-first.
    const weekday = (cursor.getUTCDay() + 6) % 7;
    if (weekdays.includes(weekday)) {
      seen += 1;
      if (seen % nth === 0) dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return [...new Set([...dates, ...extra])].sort().reverse();
}

const MONDAY = 0;
const WEDNESDAY = 2;
const THURSDAY = 3;

const HISTORY: Array<{ name: string; dates: string[] }> = [
  // The regular, still playing — including the day the e2e run pins to.
  { name: 'Matti Virtanen', dates: playedOn(2017, 2026, [MONDAY, WEDNESDAY], 11, ['2026-10-19']) },
  // A suffixed duplicate: one game, and must stay its own player.
  { name: 'Matti Virtanen (EHKÄ)', dates: ['2023-03-13'] },
  { name: 'Liisa Korhonen', dates: playedOn(2021, 2026, [MONDAY, WEDNESDAY], 17) },
  // Stopped in 2009; survives only in the imported directory. Some Thursdays,
  // from before the schedule settled on Mon/Wed/Sat.
  { name: 'Olli Väänänen', dates: playedOn(2001, 2009, [MONDAY, WEDNESDAY, THURSDAY], 29) },
  { name: 'Sanna Peltola', dates: playedOn(2025, 2026, [MONDAY, WEDNESDAY], 13) },
];

const PLAYERS: LoadablePlayer[] = HISTORY.map(({ name, dates }) => {
  const years = new Map<string, number>();
  for (const date of dates) {
    const year = date.slice(0, 4);
    years.set(year, (years.get(year) ?? 0) + 1);
  }
  return {
    name,
    total: dates.length,
    years: [...years]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year, count]) => ({ year, count })),
  };
});

const REGISTRATIONS: HarvestedRegistration[] = HISTORY.flatMap(({ name, dates }) =>
  dates.map((date) => ({
    name,
    date,
    weekday: WEEKDAYS_FI[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7] as string,
  })),
);

async function main(): Promise<void> {
  await recreateTable();
  const result = await loadHarvest({
    client,
    tableName,
    players: PLAYERS,
    registrations: REGISTRATIONS,
  });
  const repo = createRepo({ client, tableName });
  /**
   * validFrom is explicit, and early, on purpose. Left to default it would be
   * the real date on the machine doing the seeding, while the API under test
   * is pinned to Monday 19.10.2026 — so from 20.10.2026 onwards the seeded
   * announcement would be filtered out as not yet valid and the landing page
   * would come up without it.
   */
  await repo.createAnnouncement({
    body: 'Kenttä varattu 21.10. klo 18-19.',
    validFrom: '2026-10-01',
  });

  /**
   * The schedule, written rather than left on the fallback: once any slot is
   * written the table is "initialised" and `DEFAULT_SCHEDULE` no longer
   * applies to it, so the fallback's Mon/Wed/Sat has to be replaced here,
   * now carrying times, or every existing spec that expects a game on
   * Monday 19.10.2026 loses its game day the moment the schedule settings
   * feature ships.
   */
  await repo.createSlot({ weekday: 1, startTime: '20:00', endTime: '21:30' }); // Monday
  await repo.createSlot({ weekday: 3, startTime: '20:00', endTime: '21:30' }); // Wednesday
  await repo.createSlot({ weekday: 6, startTime: '18:00', endTime: '19:30' }); // Saturday

  console.log(
    `seeded ${tableName}: ${result.players} players, ${result.registrations} registrations`,
  );
}

await main();
