#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
 * The fixture is a genuine `--limit 5` harvest: five players, 363
 * registrations, spanning 2001 to 2026 across sixteen years. Real data rather
 * than invented rows, because the things worth seeing here — a 25-year
 * history, a player with 279 games beside one with 2, the `(EHKÄ)` duplicate,
 * the Torstai games that break the Mon/Wed/Sat rule — are exactly what
 * made-up data smooths away.
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

const here = path.dirname(fileURLToPath(import.meta.url));

function readJsonl<T>(name: string): T[] {
  return readFileSync(path.join(here, 'fixtures', name), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function main(): Promise<void> {
  await recreateTable();
  const result = await loadHarvest({
    client,
    tableName,
    players: readJsonl<LoadablePlayer>('history-players.jsonl'),
    registrations: readJsonl<HarvestedRegistration>('history-registrations.jsonl'),
  });
  const repo = createRepo({ client, tableName });
  await repo.createAnnouncement({ body: 'Kenttä varattu 21.10. klo 18-19.' });

  console.log(
    `seeded ${tableName}: ${result.players} players, ${result.registrations} registrations`,
  );
}

await main();
