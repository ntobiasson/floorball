#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createXspClient } from './xsp-client.js';
import { parseArgs, resumePosition, type Checkpoint } from './cli-args.js';
import {
  collectPlayerIndex,
  walkActivityView,
  type HarvestedPlayer,
  type HarvestedRegistration,
  type PlayerIndexEntry,
} from './walk.js';

/**
 * Walks the live Domino view and writes the harvest to JSONL.
 *
 * `--url` is required and has no default: it names the activity view on the
 * Domino server to walk. Export it once as DOMINO_URL to keep the commands
 * below short.
 *
 *   npx tsx src/cli-scrape.ts --url <view> --limit 5   always dry-run first
 *   npx tsx src/cli-scrape.ts --url <view>             the full walk, ~2.5 hours
 *   npx tsx src/cli-scrape.ts --url <view> --resume    after an interruption
 *
 * Both output files are appended as each player completes, so an interruption
 * keeps everything already proved and `--resume` has something to build on.
 *
 * Before the sweep, the collapsed view is read once to get the authoritative
 * player list. That list is the yardstick the sweep is held to: the
 * per-player checksums cannot notice a player the walk never reached, and
 * that is the one way this tool could lose a quarter of the archive and still
 * exit 0.
 */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outDir, { recursive: true });

  const playersPath = path.join(args.outDir, 'players.jsonl');
  const registrationsPath = path.join(args.outDir, 'registrations.jsonl');
  const checkpointPath = path.join(args.outDir, 'checkpoint.json');
  const indexPath = path.join(args.outDir, 'player-index.json');

  let startAfterPosition = 0;
  if (args.resume) {
    if (!existsSync(checkpointPath)) {
      throw new Error(`--resume needs ${checkpointPath}; none found`);
    }
    startAfterPosition = resumePosition(
      JSON.parse(readFileSync(checkpointPath, 'utf8')) as Checkpoint,
    );
    console.log(`resuming after player position ${startAfterPosition}`);
  } else {
    writeFileSync(playersPath, '');
    writeFileSync(registrationsPath, '');
  }

  const client = createXspClient({ pageUrl: args.url, delayMs: args.delayMs });
  const started = Date.now();
  const elapsed = () => Math.round((Date.now() - started) / 1000);

  // The authoritative player list. Cached, so a resumed run is held to the
  // same yardstick without paying for the pre-pass again.
  let expected: PlayerIndexEntry[];
  if (args.resume && existsSync(indexPath)) {
    expected = JSON.parse(readFileSync(indexPath, 'utf8')) as PlayerIndexEntry[];
    console.log(`reusing the cached player index: ${expected.length} players`);
  } else {
    console.log('reading the collapsed player index…');
    expected = await collectPlayerIndex({ client });
    writeFileSync(indexPath, JSON.stringify(expected, null, 2));
    console.log(`[${elapsed()}s] ${expected.length} players listed`);
  }

  let registrationCount = 0;

  const onPlayer = (player: HarvestedPlayer, registrations: HarvestedRegistration[]): void => {
    // Both files, then the checkpoint: if the process dies between the two
    // appends, the checkpoint still points at the previous player, so the
    // resume redoes this one rather than skipping it.
    appendFileSync(playersPath, `${JSON.stringify(player)}\n`);
    for (const registration of registrations) {
      appendFileSync(registrationsPath, `${JSON.stringify(registration)}\n`);
      registrationCount += 1;
    }
    writeFileSync(
      checkpointPath,
      JSON.stringify({ lastPosition: player.position, at: new Date().toISOString() }),
    );
    console.log(
      `[${elapsed()}s] ${player.position.padStart(4)} ${player.name} — ${player.total} games`,
    );
  };

  const warned = new Set<string>();
  const onWarning = (message: string): void => {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(`warning: ${message}`);
  };

  const result = await walkActivityView({
    client,
    onPlayer,
    onWarning,
    expected,
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    startAfterPosition,
  });

  console.log(
    `\ndone: ${result.players.length} players, ${registrationCount} registrations, ` +
      `${result.pagesRead} pages, ${client.requestCount()} requests in ${elapsed()}s`,
  );
  console.log(`wrote ${playersPath}`);
  console.log(`wrote ${registrationsPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
