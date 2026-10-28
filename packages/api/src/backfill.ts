import { ScanCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { dayGsi1Pk, dayGsi1Sk } from './table.js';

/**
 * A one-off migration: give every registration written before the index keys
 * existed its place in GSI1.
 *
 * A day row is keyed DAY#<iso> / PLAYER#<id>, which answers who played on a
 * date. Asking the reverse — which dates one player played — needs
 * GSI1PK=PLAYER#<id>, GSI1SK=DAY#<iso> on that same row. Rows written since
 * carry them; the quarter of a century imported out of Domino does not.
 *
 * A Scan, because that is what a migration over rows with no common
 * partition key is. It runs once, reads each page and writes only the rows
 * that need it, so a second run costs a scan and no writes at all.
 */

export interface BackfillResult {
  /** Every item the scan looked at, registration or not. */
  scanned: number;
  /** Registrations given their keys — or that would have been, on a dry run. */
  updated: number;
}

export async function backfillPlayerDates({
  client,
  tableName,
  dryRun = false,
  onProgress,
}: {
  client: DynamoDBDocumentClient;
  tableName: string;
  /** Count the work without doing it. */
  dryRun?: boolean;
  /** Called after each page, for a long run that should say something. */
  onProgress?: (result: BackfillResult) => void;
}): Promise<BackfillResult> {
  const result: BackfillResult = { scanned: 0, updated: 0 };
  let startKey: Record<string, unknown> | undefined;

  do {
    const out = await client.send(
      new ScanCommand({
        TableName: tableName,
        // Only what the decision needs: the keys, and whether the row is
        // already indexed.
        ProjectionExpression: 'PK, SK, playerId, gameDate, GSI1PK',
        ExclusiveStartKey: startKey,
      }),
    );

    for (const item of out.Items ?? []) {
      result.scanned += 1;

      const pk = String(item.PK ?? '');
      // A registration, and nothing else: a profile row carries the index
      // keys that put it in the directory, and must not be rewritten.
      if (!pk.startsWith('DAY#')) continue;
      if (item.GSI1PK !== undefined) continue;

      const playerId = typeof item.playerId === 'string' ? item.playerId : undefined;
      const gameDate = typeof item.gameDate === 'string' ? item.gameDate : pk.slice('DAY#'.length);
      if (playerId === undefined) continue;

      result.updated += 1;
      if (dryRun) continue;

      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: 'SET #pk = :pk, #sk = :sk',
          ExpressionAttributeNames: { '#pk': 'GSI1PK', '#sk': 'GSI1SK' },
          ExpressionAttributeValues: {
            ':pk': dayGsi1Pk(playerId),
            ':sk': dayGsi1Sk(gameDate),
          },
          // Not an upsert, and not a second write to a row somebody indexed
          // while this was running.
          ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(GSI1PK)',
        }),
      );
    }

    startKey = out.LastEvaluatedKey;
    onProgress?.({ ...result });
  } while (startKey !== undefined);

  return result;
}
