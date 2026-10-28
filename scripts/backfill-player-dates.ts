#!/usr/bin/env node
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { backfillPlayerDates } from '@sahlykanta/api/src/backfill.js';

/**
 * One-off: index every registration by player as well as by day, so a
 * player's own dates can be read back. See `packages/api/src/backfill.ts` for
 * what it writes and why.
 *
 *   TABLE_NAME=sahlykanta-prod AWS_REGION=eu-north-1 \
 *     npx tsx scripts/backfill-player-dates.ts --dry-run
 *
 * Safe to run twice: the second run writes nothing. Run it with --dry-run
 * first and compare the count against the number of registrations expected.
 */

const tableName = process.env.TABLE_NAME;
if (tableName === undefined || tableName.length === 0) {
  console.error('TABLE_NAME is required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const endpoint = process.env.DYNAMODB_ENDPOINT;

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    ...(endpoint === undefined ? {} : { endpoint }),
    region: process.env.AWS_REGION ?? 'eu-north-1',
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const result = await backfillPlayerDates({
  client,
  tableName,
  dryRun,
  onProgress: ({ scanned, updated }) => {
    // A full table is several thousand rows; say something per page rather
    // than nothing for a minute.
    process.stdout.write(`\rscanned ${scanned}, ${dryRun ? 'to update' : 'updated'} ${updated}`);
  },
});

process.stdout.write('\n');
console.log(
  dryRun
    ? `dry run: ${result.updated} of ${result.scanned} rows would be indexed`
    : `indexed ${result.updated} of ${result.scanned} rows`,
);
