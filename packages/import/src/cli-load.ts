#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadHarvest } from './load.js';
import type { HarvestedPlayer, HarvestedRegistration } from './walk.js';

/**
 * Loads a harvest into DynamoDB.
 *
 *   TABLE_NAME=Sahlykanta... npm run load -w @sahlykanta/import -- --out ./out
 *
 * Safe to re-run: see load.ts.
 */

function readJsonl<T>(file: string): T[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex === -1 ? path.join(process.cwd(), 'out') : (argv[outIndex + 1] as string);

  const force = argv.includes('--force');
  const tableName = process.env.TABLE_NAME;
  if (tableName === undefined || tableName.length === 0) {
    throw new Error('TABLE_NAME must be set');
  }

  const endpoint = process.env.DYNAMODB_ENDPOINT;
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient(endpoint === undefined ? {} : { endpoint }),
    { marshallOptions: { removeUndefinedValues: true } },
  );

  const players = readJsonl<HarvestedPlayer>(path.join(outDir, 'players.jsonl'));
  const registrations = readJsonl<HarvestedRegistration>(path.join(outDir, 'registrations.jsonl'));

  console.log(`loading ${players.length} players and ${registrations.length} registrations`);
  if (force) {
    console.warn('force: any registrations made since the import will be dropped from the counts');
  }

  const result = await loadHarvest({ client, tableName, players, registrations, force });

  console.log(`players:      ${result.players}`);
  console.log(`registrations:${result.registrations}`);
  console.log(`items written:${result.itemsWritten}`);
  if (result.mergedNames.length > 0) {
    console.log(`\n${result.mergedNames.length} name groups merged on their match key:`);
    for (const group of result.mergedNames) {
      console.log(`  ${group.key}: ${group.names.join(' | ')}`);
    }
    console.log(`${result.duplicateDayRows} duplicate day rows dropped as a result.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
