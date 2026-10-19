import { BatchWriteCommand, GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { normalizeName, yearOf } from '@sahlykanta/shared';
import {
  GSI1_PK,
  NAME_SK,
  PROFILE_SK,
  dayPk,
  gsi1Sk,
  namePk,
  playerPk,
  playerSk,
  yearSk,
} from '@sahlykanta/api/src/table.js';
import type { HarvestedPlayer, HarvestedRegistration } from './walk.js';

/**
 * Loads a harvested Domino export into the table.
 *
 * Deliberately not the API's transactional write path: that exists to keep
 * concurrent live registrations consistent, and replaying it twenty thousand
 * times would be slow for no benefit. Totals and year counts are computed
 * here from the registration rows themselves, so a reload always converges on
 * the same numbers.
 *
 * Idempotent: player ids are read back from the NAME# lookup when one already
 * exists, so re-running after a failure neither duplicates players nor
 * orphans the history already attached to them.
 */

const BATCH_SIZE = 25;
const MAX_BATCH_ATTEMPTS = 5;

/**
 * The loader needs a player's name, total and year counts. `position` is the
 * walker's own bookkeeping for resuming a scrape and is irrelevant here, so
 * it is not required.
 */
export type LoadablePlayer = Pick<HarvestedPlayer, 'name' | 'total' | 'years'>;

export interface LoadInput {
  client: DynamoDBDocumentClient;
  tableName: string;
  players: LoadablePlayer[];
  registrations: HarvestedRegistration[];
}

export interface LoadResult {
  players: number;
  registrations: number;
  /**
   * Domino rows whose names collapse to the same match key — the same person
   * typed two ways. They become one player, and the duplicate day rows are
   * dropped.
   */
  mergedNames: Array<{ key: string; names: string[] }>;
  duplicateDayRows: number;
  itemsWritten: number;
}

export class HarvestMismatchError extends Error {
  constructor(message: string) {
    super(`harvest mismatch: ${message}`);
    this.name = 'HarvestMismatchError';
  }
}

type Item = Record<string, unknown>;

function validate(players: LoadablePlayer[], registrations: HarvestedRegistration[]): void {
  const byName = new Map(players.map((p) => [p.name, p]));

  const counted = new Map<string, number>();
  for (const registration of registrations) {
    if (!byName.has(registration.name)) {
      throw new HarvestMismatchError(
        `unknown player ${JSON.stringify(registration.name)} on ${registration.date}`,
      );
    }
    counted.set(registration.name, (counted.get(registration.name) ?? 0) + 1);
  }

  for (const player of players) {
    const actual = counted.get(player.name) ?? 0;
    if (actual !== player.total) {
      throw new HarvestMismatchError(
        `player ${player.name}: Domino reports ${player.total} registrations but ` +
          `${actual} were harvested`,
      );
    }
    const summed = player.years.reduce((acc, y) => acc + y.count, 0);
    if (summed !== player.total) {
      throw new HarvestMismatchError(
        `player ${player.name}: year counts sum to ${summed}, total is ${player.total}`,
      );
    }
  }
}

async function resolvePlayerIds(
  client: DynamoDBDocumentClient,
  tableName: string,
  keys: string[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const key of keys) {
    const existing = await client.send(
      new GetCommand({ TableName: tableName, Key: { PK: namePk(key), SK: NAME_SK } }),
    );
    const found = existing.Item?.playerId;
    ids.set(key, typeof found === 'string' ? found : ulid());
  }
  return ids;
}

async function writeAll(
  client: DynamoDBDocumentClient,
  tableName: string,
  items: Item[],
): Promise<number> {
  let written = 0;

  for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
    let pending = items
      .slice(offset, offset + BATCH_SIZE)
      .map((item) => ({ PutRequest: { Item: item } }));

    for (let attempt = 1; pending.length > 0 && attempt <= MAX_BATCH_ATTEMPTS; attempt += 1) {
      const out = await client.send(
        new BatchWriteCommand({ RequestItems: { [tableName]: pending } }),
      );
      written += pending.length;
      const unprocessed = out.UnprocessedItems?.[tableName] ?? [];
      written -= unprocessed.length;
      pending = unprocessed as typeof pending;
      if (pending.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }

    if (pending.length > 0) {
      throw new Error(`${pending.length} items could not be written after ${MAX_BATCH_ATTEMPTS} attempts`);
    }
  }

  return written;
}

export async function loadHarvest({
  client,
  tableName,
  players,
  registrations,
}: LoadInput): Promise<LoadResult> {
  validate(players, registrations);

  // Group Domino rows by their match key. Two rows sharing a key are the same
  // person spelled two ways; they become one player.
  const groups = new Map<string, { displayName: string; names: string[] }>();
  for (const player of players) {
    const key = normalizeName(player.name);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { displayName: player.name, names: [player.name] });
    } else {
      group.names.push(player.name);
    }
  }

  const playerIds = await resolvePlayerIds(client, tableName, [...groups.keys()]);
  const idByName = new Map<string, string>();
  for (const player of players) {
    const key = normalizeName(player.name);
    idByName.set(player.name, playerIds.get(key) as string);
  }

  // Dedupe on (day, player): after a merge, the same person can appear twice
  // on one day, and the table holds one row per player per day.
  const dayRows = new Map<string, HarvestedRegistration & { playerId: string }>();
  let duplicateDayRows = 0;
  for (const registration of registrations) {
    const playerId = idByName.get(registration.name) as string;
    const key = `${registration.date}#${playerId}`;
    if (dayRows.has(key)) {
      duplicateDayRows += 1;
      continue;
    }
    dayRows.set(key, { ...registration, playerId });
  }

  // Totals come from the rows actually being written, never from Domino's
  // claim, so sum(total) always equals the number of day rows.
  const totals = new Map<string, number>();
  const yearCounts = new Map<string, Map<string, number>>();
  const firstSeen = new Map<string, string>();
  const lastSeen = new Map<string, string>();

  for (const row of dayRows.values()) {
    totals.set(row.playerId, (totals.get(row.playerId) ?? 0) + 1);
    const years = yearCounts.get(row.playerId) ?? new Map<string, number>();
    const year = yearOf(row.date);
    years.set(year, (years.get(year) ?? 0) + 1);
    yearCounts.set(row.playerId, years);

    const earliest = firstSeen.get(row.playerId);
    if (earliest === undefined || row.date < earliest) firstSeen.set(row.playerId, row.date);
    const latest = lastSeen.get(row.playerId);
    if (latest === undefined || row.date > latest) lastSeen.set(row.playerId, row.date);
  }

  const items: Item[] = [];

  for (const [key, group] of groups) {
    const playerId = playerIds.get(key) as string;
    items.push({ PK: namePk(key), SK: NAME_SK, playerId, normalizedName: key });
    items.push({
      PK: playerPk(playerId),
      SK: PROFILE_SK,
      GSI1PK: GSI1_PK,
      GSI1SK: gsi1Sk(key),
      playerId,
      displayName: group.displayName,
      normalizedName: key,
      total: totals.get(playerId) ?? 0,
      firstSeen: firstSeen.get(playerId),
      lastSeen: lastSeen.get(playerId),
      source: 'domino-import',
    });

    for (const [year, count] of yearCounts.get(playerId) ?? []) {
      items.push({ PK: playerPk(playerId), SK: yearSk(year), count });
    }
  }

  for (const row of dayRows.values()) {
    items.push({
      PK: dayPk(row.date),
      SK: playerSk(row.playerId),
      playerId: row.playerId,
      displayName: groups.get(normalizeName(row.name))?.displayName ?? row.name,
      rawName: row.name,
      gameDate: row.date,
      weekday: row.weekday,
      source: 'domino-import',
      createdAt: `${row.date}T00:00:00.000Z`,
    });
  }

  const itemsWritten = await writeAll(client, tableName, items);

  return {
    players: groups.size,
    registrations: dayRows.size,
    mergedNames: [...groups.entries()]
      .filter(([, group]) => group.names.length > 1)
      .map(([key, group]) => ({ key, names: group.names })),
    duplicateDayRows,
    itemsWritten,
  };
}
