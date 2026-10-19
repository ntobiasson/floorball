import type { LoadablePlayer } from './load.js';
import type { HarvestedRegistration, PlayerIndexEntry } from './walk.js';

/**
 * The checks that stand between a correct archive and a quiet data loss,
 * gathered in one place so there is somewhere obvious to add the next one.
 *
 * They come in two kinds, and the distinction is the whole point:
 *
 *  - **Per-player**: the harvested dates for a player must match the total
 *    Domino prints next to them. Enforced during the walk, and again before
 *    loading. Catches a lost row.
 *  - **Global**: the set of players harvested must match the set the
 *    collapsed view lists. Catches a lost *player*, which no per-player check
 *    can see — a truncated walk is internally consistent about everything it
 *    did reach.
 */

export interface VerificationProblem {
  kind: 'missing-player' | 'extra-player' | 'count-mismatch' | 'unknown-player';
  detail: string;
}

export function verifyHarvest({
  expected,
  players,
  registrations,
}: {
  expected: PlayerIndexEntry[];
  players: LoadablePlayer[];
  registrations: HarvestedRegistration[];
}): VerificationProblem[] {
  const problems: VerificationProblem[] = [];

  const harvestedNames = new Set(players.map((player) => player.name));
  for (const entry of expected) {
    if (!harvestedNames.has(entry.name)) {
      problems.push({
        kind: 'missing-player',
        detail: `${entry.position} ${entry.name} (${entry.total} games) was never harvested`,
      });
    }
  }

  const expectedByName = new Map(expected.map((entry) => [entry.name, entry]));
  for (const player of players) {
    const entry = expectedByName.get(player.name);
    if (entry === undefined) {
      problems.push({
        kind: 'extra-player',
        detail: `${player.name} was harvested but is not in the collapsed index`,
      });
      continue;
    }
    if (entry.total !== player.total) {
      problems.push({
        kind: 'count-mismatch',
        detail: `${player.name}: index says ${entry.total}, harvest says ${player.total}`,
      });
    }
  }

  const counted = new Map<string, number>();
  for (const registration of registrations) {
    counted.set(registration.name, (counted.get(registration.name) ?? 0) + 1);
    if (!harvestedNames.has(registration.name)) {
      problems.push({
        kind: 'unknown-player',
        detail: `registration on ${registration.date} names ${registration.name}, who has no player row`,
      });
    }
  }

  for (const player of players) {
    const actual = counted.get(player.name) ?? 0;
    if (actual !== player.total) {
      problems.push({
        kind: 'count-mismatch',
        detail: `${player.name}: total is ${player.total} but ${actual} registrations were harvested`,
      });
    }
  }

  return problems;
}

export function describeProblems(problems: VerificationProblem[]): string {
  return problems.map((problem) => `  [${problem.kind}] ${problem.detail}`).join('\n');
}
