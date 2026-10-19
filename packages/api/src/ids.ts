import { randomUUID } from 'node:crypto';

/**
 * Identifiers for players, announcements and audit rows.
 *
 * This was `ulid`, chosen for its lexicographic sortability. That turned out
 * to be sortability nothing used — every sorted key here already carries its
 * own prefix: an audit row sorts by `<iso>#<id>`, an announcement by
 * `<validFrom>#<id>`, and a player id is never ordered at all.
 *
 * What it did cost was a cold start. `ulid` resolves its random source at
 * module load through a CommonJS `require('crypto')`, and in the ESM bundle
 * Lambda actually runs there is no `require`, so every invocation died with
 * "secure crypto unusable, insecure Math.random not allowed". Nothing local
 * caught it: under tsx and under vitest a `require` shim exists.
 *
 * `node:crypto` has no such ceremony — no module-load detection, nothing to
 * bundle, and it is there on every runtime this will ever meet.
 */
export function newId(): string {
  return randomUUID();
}
