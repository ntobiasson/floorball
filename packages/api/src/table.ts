/**
 * Single-table key design. Every key this application writes is built here,
 * so the shape of the table is one file rather than a convention spread
 * across the repository.
 *
 *   DAY#<iso>          / PLAYER#<id>      a registration
 *   PLAYER#<id>        / PROFILE          a player
 *   PLAYER#<id>        / YEAR#<yyyy>      that player's count for a year
 *   NAME#<normalized>  / NAME             the name -> player lookup
 *   ANNOUNCEMENT       / <validFrom>#<id> an announcement
 *   AUDIT#<iso>        / <when>#<ulid>    one mutation, self-expiring
 *
 * GSI1 projects player profiles only: GSI1PK is the constant 'PLAYERS' and
 * GSI1SK is NAME#<normalized>, so the whole directory comes back from one
 * query, ordered by name.
 *
 * The index is deliberately NOT ordered by total. A total-ordered sort key
 * changes on every registration, which means each write would have to read
 * the current total and set the new key under an optimistic-concurrency
 * condition, with a retry loop. Nothing needs that ordering: the directory is
 * fetched whole and sorted in the browser, where the "most games" and
 * "name A-O" toggles live. Name ordering is stable, so a registration never
 * rewrites an index key.
 */

export const TABLE_NAME_ENV = 'TABLE_NAME';
export const GSI1 = 'GSI1';
export const GSI1_PK = 'PLAYERS';

export const PROFILE_SK = 'PROFILE';
export const NAME_SK = 'NAME';
export const ANNOUNCEMENT_PK = 'ANNOUNCEMENT';

export const dayPk = (isoDate: string): string => `DAY#${isoDate}`;
export const playerPk = (playerId: string): string => `PLAYER#${playerId}`;
export const playerSk = (playerId: string): string => `PLAYER#${playerId}`;
export const yearSk = (year: string): string => `YEAR#${year}`;
export const namePk = (normalizedName: string): string => `NAME#${normalizedName}`;
export const auditPk = (isoDate: string): string => `AUDIT#${isoDate}`;
export const announcementSk = (validFrom: string, id: string): string => `${validFrom}#${id}`;

export const gsi1Sk = (normalizedName: string): string => `NAME#${normalizedName}`;

