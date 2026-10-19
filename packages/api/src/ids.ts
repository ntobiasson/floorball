import { randomFillSync } from 'node:crypto';

/**
 * Time-sortable identifiers for players, announcements and audit rows.
 *
 * This was `ulid`, which could not be loaded at all in the ESM bundle Lambda
 * runs: it resolves its random source at module load through a CommonJS
 * `require('crypto')`, so every invocation died with "secure crypto unusable"
 * before handling a request. Nothing local caught that — tsx and vitest both
 * supply a `require` shim — so the bundle is now loaded in a real node
 * process by test/bundle.test.ts.
 *
 * Replacing it with `randomUUID` looked safe and was not. Audit rows sort by
 * `<iso>#<id>`, and two rows written in one request share a timestamp to the
 * millisecond, so the id alone decides whether a removal reads as happening
 * after the registration it removed. Random ids made that order arbitrary,
 * which CI caught and the reasoning behind the change had missed.
 *
 * So: the same shape ULID had, built from `node:crypto` and nothing else.
 * Crockford base32 — no padding, no URL escaping, and it sorts bytewise:
 *
 *   TTTTTTTTTT SSSS RRRRRRRR
 *   |          |    └─ random, so separate processes do not collide
 *   |          └────── sequence, so one process stays ordered within a ms
 *   └───────────────── milliseconds since the epoch, sortable to the year 10889
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const SEQUENCE_CHARS = 4;
const RANDOM_CHARS = 8;
const SEQUENCE_LIMIT = ALPHABET.length ** SEQUENCE_CHARS;

let lastTime = -1;
let sequence = 0;

function encode(value: number, length: number): string {
  let out = '';
  let rest = value;
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET[rest % ALPHABET.length] + out;
    rest = Math.floor(rest / ALPHABET.length);
  }
  return out;
}

function randomSuffix(): string {
  const bytes = randomFillSync(new Uint8Array(RANDOM_CHARS));
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export function newId(): string {
  const now = Date.now();

  if (now === lastTime) {
    sequence += 1;
    // Beyond a million ids in one millisecond the sequence would wrap and
    // ordering would silently break. Far better to say so.
    if (sequence >= SEQUENCE_LIMIT) {
      throw new Error(`more than ${SEQUENCE_LIMIT} ids generated in one millisecond`);
    }
  } else {
    lastTime = now;
    sequence = 0;
  }

  return encode(now, TIME_CHARS) + encode(sequence, SEQUENCE_CHARS) + randomSuffix();
}
