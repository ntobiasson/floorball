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
 *   AUDIT#<iso>        / <when>#<id>      one mutation, self-expiring
 *   SETTINGS           / SLOT#<id>        a playing slot
 *   SETTINGS           / INITIALISED      marks the partition as written
 *   SETTINGS           / VALUE#<key>      reserved for a future scalar setting;
 *                                         nothing writes this key yet
 *
 * GSI1 carries two kinds of row, under partition keys that cannot collide.
 * A player profile sits under the constant 'PLAYERS' with GSI1SK
 * NAME#<normalized>, so the whole directory comes back from one query,
 * ordered by name. A registration sits under PLAYER#<id> with GSI1SK
 * DAY#<iso>, which is the only way to ask which dates one player played: the
 * base table answers the opposite question, who played on one date. The date
 * is the sort key itself, so the index needs to project nothing extra.
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
export const SETTINGS_PK = 'SETTINGS';
export const INITIALISED_SK = 'INITIALISED';

export const dayPk = (isoDate: string): string => `DAY#${isoDate}`;
export const playerPk = (playerId: string): string => `PLAYER#${playerId}`;
export const playerSk = (playerId: string): string => `PLAYER#${playerId}`;
export const yearSk = (year: string): string => `YEAR#${year}`;
export const namePk = (normalizedName: string): string => `NAME#${normalizedName}`;
export const auditPk = (isoDate: string): string => `AUDIT#${isoDate}`;
export const announcementSk = (validFrom: string, id: string): string => `${validFrom}#${id}`;
export const slotSk = (id: string): string => `SLOT#${id}`;

export const gsi1Sk = (normalizedName: string): string => `NAME#${normalizedName}`;

/** A registration's own place in GSI1: one partition per player, by date. */
export const dayGsi1Pk = (playerId: string): string => `PLAYER#${playerId}`;
export const dayGsi1Sk = (isoDate: string): string => `DAY#${isoDate}`;
