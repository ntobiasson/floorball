#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createApp } from './app.js';
import { createRepo } from './repo.js';
import { TABLE_NAME_ENV } from './table.js';

/**
 * Local development and end-to-end tests only. In AWS the same Hono app runs
 * behind handler.ts on Lambda, so what is exercised here is the real routing,
 * validation and DynamoDB code — not a stand-in.
 *
 * FAKE_TODAY pins the server's idea of today so a test can ask for a Monday
 * or a Tuesday without touching the machine clock.
 */

const tableName = process.env[TABLE_NAME_ENV];
if (tableName === undefined || tableName.length === 0) {
  throw new Error(`${TABLE_NAME_ENV} is not set`);
}

const endpoint = process.env.DYNAMODB_ENDPOINT;
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient(
    endpoint === undefined
      ? {}
      : { endpoint, region: 'eu-north-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } },
  ),
  { marshallOptions: { removeUndefinedValues: true } },
);

const fakeToday = process.env.FAKE_TODAY;
const now =
  fakeToday === undefined
    ? () => new Date()
    : // Midday Helsinki, so the date is unambiguous in either DST offset.
      () => new Date(`${fakeToday}T09:00:00Z`);

const app = createApp({ repo: createRepo({ client, tableName, now }), now });
const port = Number(process.env.PORT ?? '3000');

serve({ fetch: app.fetch, port });
console.log(`api listening on http://127.0.0.1:${port} (table ${tableName}, today ${now().toISOString().slice(0, 10)})`);
