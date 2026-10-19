#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ACTIVITY_PAGE, createXspClient } from './xsp-client.js';
import { walkActivityView, type HarvestedPlayer } from './walk.js';

/**
 * Walks the live Domino view and writes the harvest to JSONL.
 *
 *   npm run scrape -w @sahlykanta/import -- --limit 5
 *   npm run scrape -w @sahlykanta/import -- --resume
 *
 * Output and progress are written as each player completes, so an interrupted
 * run keeps everything it had already proved. `--resume` picks up after the
 * last completed player instead of re-expanding thousands of nodes.
 */

const DEFAULT_URL =
  'http://sofordmz1.sofor.fi/sofor/fun/sahlykanta.nsf/' + ACTIVITY_PAGE;

interface Args {
  url: string;
  outDir: string;
  limit: number | undefined;
  delayMs: number;
  resume: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const limit = get('--limit');
  return {
    url: get('--url') ?? process.env.DOMINO_URL ?? DEFAULT_URL,
    outDir: get('--out') ?? path.join(process.cwd(), 'out'),
    limit: limit === undefined ? undefined : Number(limit),
    delayMs: Number(get('--delay') ?? '400'),
    resume: argv.includes('--resume'),
  };
}

function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outDir, { recursive: true });

  const playersPath = path.join(args.outDir, 'players.jsonl');
  const registrationsPath = path.join(args.outDir, 'registrations.jsonl');
  const checkpointPath = path.join(args.outDir, 'checkpoint.json');

  let startAfterPosition = 0;
  if (args.resume && existsSync(checkpointPath)) {
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as {
      lastPosition?: string;
    };
    startAfterPosition = Number(checkpoint.lastPosition ?? '0');
    console.log(`resuming after player position ${startAfterPosition}`);
  } else {
    writeFileSync(playersPath, '');
    writeFileSync(registrationsPath, '');
  }

  const client = createXspClient({ pageUrl: args.url, delayMs: args.delayMs });

  const started = Date.now();
  let registrationCount = 0;

  const onPlayer = (player: HarvestedPlayer): void => {
    appendFileSync(playersPath, `${JSON.stringify(player)}\n`);
    writeFileSync(
      checkpointPath,
      JSON.stringify({ lastPosition: player.position, at: new Date().toISOString() }),
    );
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(
      `[${elapsed}s] ${player.position.padStart(4)} ${player.name} — ${player.total} games`,
    );
  };

  return walkActivityView({
    client,
    onPlayer,
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    startAfterPosition,
  }).then((result) => {
    for (const registration of result.registrations) {
      appendFileSync(registrationsPath, `${JSON.stringify(registration)}\n`);
      registrationCount += 1;
    }
    console.log(
      `\ndone: ${result.players.length} players, ${registrationCount} registrations, ` +
        `${result.pagesRead} pages, ${client.requestCount()} requests in ` +
        `${Math.round((Date.now() - started) / 1000)}s`,
    );
    console.log(`wrote ${playersPath}`);
    console.log(`wrote ${registrationsPath}`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
