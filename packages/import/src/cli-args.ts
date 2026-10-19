import path from 'node:path';
import { ACTIVITY_PAGE } from './xsp-client.js';

/**
 * Argument parsing for the scraper, kept separate so it can be tested.
 *
 * Every flag here is validated rather than coerced. The reason is specific:
 * this tool walks a live third-party production server for hours, so a
 * mistyped `--limit` must not quietly turn a five-player dry run into a full
 * one. `Number(undefined)` is `NaN`, and `players.length >= NaN` is false
 * forever, which is exactly that failure.
 */

export const DEFAULT_URL = `http://sofordmz1.sofor.fi/sofor/fun/sahlykanta.nsf/${ACTIVITY_PAGE}`;

export const DEFAULT_DELAY_MS = 400;

/** Below this the walk stops being a polite guest on someone else's server. */
export const MIN_DELAY_MS = 100;

export interface ScrapeArgs {
  url: string;
  outDir: string;
  limit: number | undefined;
  delayMs: number;
  resume: boolean;
}

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  // A following flag is a missing value, not a value.
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

export function parseArgs(argv: string[]): ScrapeArgs {
  const rawLimit = valueOf(argv, '--limit');
  let limit: number | undefined;
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`--limit must be a whole number of players, got ${JSON.stringify(rawLimit)}`);
    }
    limit = parsed;
  }

  const rawDelay = valueOf(argv, '--delay');
  const delayMs = rawDelay === undefined ? DEFAULT_DELAY_MS : Number(rawDelay);
  if (!Number.isFinite(delayMs) || delayMs < MIN_DELAY_MS) {
    throw new Error(`--delay must be at least ${MIN_DELAY_MS}ms, got ${JSON.stringify(rawDelay)}`);
  }

  const url = valueOf(argv, '--url') ?? process.env.DOMINO_URL ?? DEFAULT_URL;
  if (!new URL(url).pathname.toLowerCase().endsWith(`/${ACTIVITY_PAGE}`)) {
    throw new Error(`--url must point at ${ACTIVITY_PAGE}, got ${url}`);
  }

  return {
    url,
    outDir: valueOf(argv, '--out') ?? path.join(process.cwd(), 'out'),
    limit,
    delayMs,
    resume: argv.includes('--resume'),
  };
}

export interface Checkpoint {
  lastPosition?: string;
  at?: string;
}

/**
 * The level-1 position to resume after. Refuses anything that is not a whole
 * number: `Number('')` is 0, which would silently restart the whole walk and
 * append duplicate players to an existing output file.
 */
export function resumePosition(checkpoint: Checkpoint): number {
  const raw = checkpoint.lastPosition;
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new Error(
      `checkpoint has no usable lastPosition (${JSON.stringify(raw)}); ` +
        'delete the output directory and start a fresh run',
    );
  }
  return Number(raw);
}
