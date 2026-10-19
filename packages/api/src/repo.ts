import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { ulid } from 'ulid';
import {
  cleanDisplayName,
  normalizeName,
  yearOf,
  type Announcement,
  type AnnouncementInput,
  type PlayerDetail,
  type PlayerSummary,
  type Registration,
} from '@sahlykanta/shared';
import {
  ANNOUNCEMENT_PK,
  GSI1,
  GSI1_PK,
  NAME_SK,
  PROFILE_SK,
  announcementSk,
  auditPk,
  dayPk,
  gsi1Sk,
  namePk,
  playerPk,
  playerSk,
  yearSk,
} from './table.js';

/** Audit rows are for spotting griefing, not for history. Three months is plenty. */
const AUDIT_TTL_DAYS = 90;

export class AlreadyRegisteredError extends Error {
  constructor(displayName: string) {
    super(`${displayName} is already registered for this day`);
    this.name = 'AlreadyRegisteredError';
  }
}

export class NotRegisteredError extends Error {
  constructor() {
    super('that player is not registered for this day');
    this.name = 'NotRegisteredError';
  }
}

export interface RegisterInput {
  gameDate: string;
  rawName: string;
  ipHash?: string;
}

export interface RegisterResult {
  playerId: string;
  displayName: string;
  /** True when this call brought a brand-new player into existence. */
  created: boolean;
}

export interface UnregisterInput {
  gameDate: string;
  playerId: string;
  ipHash?: string;
}

export interface Repo {
  register(input: RegisterInput): Promise<RegisterResult>;
  unregister(input: UnregisterInput): Promise<void>;
  listRegistrations(gameDate: string): Promise<Registration[]>;
  listPlayers(): Promise<PlayerSummary[]>;
  getPlayer(playerId: string): Promise<PlayerDetail | null>;
  listAnnouncements(onDate: string): Promise<Announcement[]>;
  createAnnouncement(input: AnnouncementInput): Promise<Announcement>;
}

export interface RepoConfig {
  client: DynamoDBDocumentClient;
  tableName: string;
  now?: () => Date;
}

interface ProfileItem {
  playerId: string;
  displayName: string;
  normalizedName: string;
  total: number;
  mergedInto?: string;
}

interface YearItem {
  SK: string;
  count: number;
}

function isConditionFailure(error: unknown): boolean {
  return (
    error instanceof TransactionCanceledException &&
    (error.CancellationReasons ?? []).some((r) => r.Code === 'ConditionalCheckFailed')
  );
}

export function createRepo({ client, tableName, now = () => new Date() }: RepoConfig): Repo {
  const auditItem = (
    action: 'register' | 'unregister',
    gameDate: string,
    name: string,
    ipHash?: string,
  ) => {
    const at = now();
    return {
      PK: auditPk(gameDate),
      SK: `${at.toISOString()}#${ulid()}`,
      action,
      gameDate,
      name,
      ipHash,
      at: at.toISOString(),
      ttl: Math.floor(at.getTime() / 1000) + AUDIT_TTL_DAYS * 24 * 60 * 60,
    };
  };

  async function readNameLookup(normalizedName: string): Promise<string | null> {
    const out = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: namePk(normalizedName), SK: NAME_SK },
      }),
    );
    const playerId = out.Item?.playerId;
    return typeof playerId === 'string' ? playerId : null;
  }

  async function readProfile(playerId: string): Promise<ProfileItem | null> {
    const out = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: playerPk(playerId), SK: PROFILE_SK },
      }),
    );
    return (out.Item as ProfileItem | undefined) ?? null;
  }

  /**
   * Find the player by normalized name, or create them. The NAME# item is put
   * under a condition, so when two people submit the same new name at once
   * exactly one creation wins and the loser reads back the winner's id.
   */
  async function resolvePlayer(
    rawName: string,
  ): Promise<{ playerId: string; displayName: string; created: boolean }> {
    const displayName = cleanDisplayName(rawName);
    const normalizedName = normalizeName(rawName);

    const existing = await readNameLookup(normalizedName);
    if (existing !== null) {
      const profile = await readProfile(existing);
      return {
        playerId: existing,
        displayName: profile?.displayName ?? displayName,
        created: false,
      };
    }

    const playerId = ulid();
    const createdAt = now().toISOString();
    try {
      await client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName,
                Item: { PK: namePk(normalizedName), SK: NAME_SK, playerId, normalizedName },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: {
                  PK: playerPk(playerId),
                  SK: PROFILE_SK,
                  GSI1PK: GSI1_PK,
                  GSI1SK: gsi1Sk(normalizedName),
                  playerId,
                  displayName,
                  normalizedName,
                  total: 0,
                  createdAt,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
      return { playerId, displayName, created: true };
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      // Someone else created this name between the read and the write.
      const winner = await readNameLookup(normalizedName);
      if (winner === null) throw error;
      const profile = await readProfile(winner);
      return {
        playerId: winner,
        displayName: profile?.displayName ?? displayName,
        created: false,
      };
    }
  }

  return {
    async register({ gameDate, rawName, ipHash }) {
      const player = await resolvePlayer(rawName);
      const at = now().toISOString();

      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: tableName,
                  Item: {
                    PK: dayPk(gameDate),
                    SK: playerSk(player.playerId),
                    playerId: player.playerId,
                    displayName: player.displayName,
                    rawName,
                    gameDate,
                    source: 'web',
                    createdAt: at,
                  },
                  // Also the guard against registering the same person twice.
                  ConditionExpression: 'attribute_not_exists(PK)',
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { PK: playerPk(player.playerId), SK: PROFILE_SK },
                  UpdateExpression: 'ADD #total :one SET #lastSeen = :date',
                  ExpressionAttributeNames: { '#total': 'total', '#lastSeen': 'lastSeen' },
                  ExpressionAttributeValues: { ':one': 1, ':date': gameDate },
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { PK: playerPk(player.playerId), SK: yearSk(yearOf(gameDate)) },
                  UpdateExpression: 'ADD #count :one',
                  ExpressionAttributeNames: { '#count': 'count' },
                  ExpressionAttributeValues: { ':one': 1 },
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: auditItem('register', gameDate, player.displayName, ipHash),
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (isConditionFailure(error)) throw new AlreadyRegisteredError(player.displayName);
        throw error;
      }

      return player;
    },

    async unregister({ gameDate, playerId, ipHash }) {
      const profile = await readProfile(playerId);
      const displayName = profile?.displayName ?? playerId;

      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Delete: {
                  TableName: tableName,
                  Key: { PK: dayPk(gameDate), SK: playerSk(playerId) },
                  ConditionExpression: 'attribute_exists(PK)',
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { PK: playerPk(playerId), SK: PROFILE_SK },
                  UpdateExpression: 'ADD #total :minusOne',
                  ExpressionAttributeNames: { '#total': 'total' },
                  ExpressionAttributeValues: { ':minusOne': -1 },
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { PK: playerPk(playerId), SK: yearSk(yearOf(gameDate)) },
                  UpdateExpression: 'ADD #count :minusOne',
                  ExpressionAttributeNames: { '#count': 'count' },
                  ExpressionAttributeValues: { ':minusOne': -1 },
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: auditItem('unregister', gameDate, displayName, ipHash),
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (isConditionFailure(error)) throw new NotRegisteredError();
        throw error;
      }
    },

    async listRegistrations(gameDate) {
      const out = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': dayPk(gameDate) },
        }),
      );
      return (out.Items ?? []).map((item) => ({
        playerId: String(item.playerId),
        displayName: String(item.displayName),
        createdAt: String(item.createdAt),
      }));
    },

    async listPlayers() {
      const players: PlayerSummary[] = [];
      let startKey: Record<string, unknown> | undefined;

      do {
        const out = await client.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: GSI1,
            KeyConditionExpression: 'GSI1PK = :pk',
            ExpressionAttributeValues: { ':pk': GSI1_PK },
            ExclusiveStartKey: startKey,
          }),
        );
        for (const item of out.Items ?? []) {
          // A merged duplicate is no longer its own entry in the directory.
          if (item.mergedInto !== undefined) continue;
          players.push({
            playerId: String(item.playerId),
            displayName: String(item.displayName),
            total: Number(item.total ?? 0),
          });
        }
        startKey = out.LastEvaluatedKey;
      } while (startKey !== undefined);

      return players;
    },

    async getPlayer(playerId) {
      const out = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': playerPk(playerId) },
        }),
      );
      const items = out.Items ?? [];
      const profile = items.find((item) => item.SK === PROFILE_SK) as ProfileItem | undefined;
      if (profile === undefined) return null;

      const years = items
        .filter((item): item is YearItem & Record<string, unknown> =>
          String(item.SK).startsWith('YEAR#'),
        )
        .map((item) => ({ year: String(item.SK).slice('YEAR#'.length), count: Number(item.count) }))
        .sort((a, b) => b.year.localeCompare(a.year));

      return {
        playerId: profile.playerId,
        displayName: profile.displayName,
        total: Number(profile.total ?? 0),
        years,
      };
    },

    async listAnnouncements(onDate) {
      const out = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': ANNOUNCEMENT_PK },
        }),
      );
      return (out.Items ?? [])
        .filter((item) => {
          const from = item.validFrom === undefined ? undefined : String(item.validFrom);
          const to = item.validTo === undefined ? undefined : String(item.validTo);
          if (from !== undefined && onDate < from) return false;
          if (to !== undefined && onDate > to) return false;
          return true;
        })
        .map((item) => ({
          id: String(item.id),
          body: String(item.body),
          ...(item.validFrom === undefined ? {} : { validFrom: String(item.validFrom) }),
          ...(item.validTo === undefined ? {} : { validTo: String(item.validTo) }),
        }));
    },

    async createAnnouncement(input) {
      const id = ulid();
      const validFrom = input.validFrom ?? now().toISOString().slice(0, 10);
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: ANNOUNCEMENT_PK,
            SK: announcementSk(validFrom, id),
            id,
            body: input.body,
            validFrom,
            validTo: input.validTo,
            createdAt: now().toISOString(),
          },
        }),
      );
      return {
        id,
        body: input.body,
        validFrom,
        ...(input.validTo === undefined ? {} : { validTo: input.validTo }),
      };
    },
  };
}
