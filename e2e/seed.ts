#!/usr/bin/env node
import { DynamoDBClient, CreateTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadHarvest } from '@sahlykanta/import/src/load.js';
import { createRepo } from '@sahlykanta/api/src/repo.js';

/**
 * Creates the end-to-end table and loads a small slice of the real Domino
 * export through the production loader, so the smoke test runs against data
 * shaped exactly like the imported archive.
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

/** Real figures from the Domino export, trimmed to three players. */
const PLAYERS = [
  {
    name: 'Matti Virtanen',
    total: 4,
    years: [
      { year: '2026', count: 2 },
      { year: '2025', count: 2 },
    ],
  },
  { name: 'Liisa Korhonen', total: 2, years: [{ year: '2026', count: 2 }] },
  { name: 'Riikka Mäkelä', total: 1, years: [{ year: '2024', count: 1 }] },
];

const REGISTRATIONS = [
  { name: 'Matti Virtanen', date: '2026-01-12', weekday: 'Maanantai' },
  { name: 'Matti Virtanen', date: '2026-04-15', weekday: 'Keskiviikko' },
  { name: 'Matti Virtanen', date: '2025-10-20', weekday: 'Maanantai' },
  { name: 'Matti Virtanen', date: '2025-10-22', weekday: 'Keskiviikko' },
  { name: 'Liisa Korhonen', date: '2026-01-12', weekday: 'Maanantai' },
  { name: 'Liisa Korhonen', date: '2026-04-15', weekday: 'Keskiviikko' },
  { name: 'Riikka Mäkelä', date: '2024-02-03', weekday: 'Lauantai' },
];

async function main(): Promise<void> {
  await recreateTable();
  const result = await loadHarvest({
    client,
    tableName,
    players: PLAYERS,
    registrations: REGISTRATIONS,
  });
  const repo = createRepo({ client, tableName });
  await repo.createAnnouncement({ body: 'Kenttä varattu 21.10. klo 18-19.' });

  console.log(
    `seeded ${tableName}: ${result.players} players, ${result.registrations} registrations`,
  );
}

await main();
