import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import {
  AnnouncementInputSchema,
  RegistrationInputSchema,
  isGameDay,
  nextGameDay,
  todayInHelsinki,
  weekdayOf,
  type TodayResponse,
} from '@sahlykanta/shared';
import { AlreadyRegisteredError, NotRegisteredError, type Repo } from './repo.js';
import { EmptyNameError } from '@sahlykanta/shared';

export interface AppConfig {
  repo: Repo;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

/** The directory is ~500 rows that change a few times a week. */
const PLAYERS_CACHE_SECONDS = 300;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of the submitted PIN's hash against the configured
 * one. An unconfigured secret denies everything rather than letting anyone in.
 */
function pinAccepted(submitted: string | undefined, expectedHash: string | undefined): boolean {
  if (submitted === undefined || expectedHash === undefined) return false;
  const actual = Buffer.from(sha256Hex(submitted), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash.trim(), 'hex');
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createApp({ repo, now = () => new Date(), env = process.env }: AppConfig): Hono {
  const app = new Hono();

  /**
   * The one source of truth for "which day is it". Never taken from the
   * client, because a browser in another timezone — or a tab left open
   * overnight — would otherwise write to the wrong day.
   */
  const today = () => todayInHelsinki(now());

  app.get('/api/today', async (c) => {
    const date = today();
    const gameDay = isGameDay(date);
    const [registrations, announcements] = await Promise.all([
      gameDay ? repo.listRegistrations(date) : Promise.resolve([]),
      repo.listAnnouncements(date),
    ]);

    const body: TodayResponse = {
      date,
      weekday: weekdayOf(date),
      isGameDay: gameDay,
      ...(gameDay ? {} : { nextGameDate: nextGameDay(date) }),
      registrations,
      announcements,
    };
    return c.json(body);
  });

  app.post('/api/registrations', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'virheellinen pyyntö' }, 400);
    }

    const parsed = RegistrationInputSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'nimi tai päivä on virheellinen' }, 400);
    }

    const date = today();
    if (!isGameDay(date)) {
      return c.json({ error: 'tänään ei ole pelipäivä', nextGameDate: nextGameDay(date) }, 409);
    }
    if (parsed.data.gameDate !== date) {
      // Not 400: the request is well formed, it is just aimed at another day.
      return c.json({ error: 'ilmoittautuminen on auki vain tälle päivälle', date }, 409);
    }

    try {
      const result = await repo.register({
        gameDate: date,
        rawName: parsed.data.name,
        ...ipHashOf(c.req.header('x-forwarded-for')),
      });
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof AlreadyRegisteredError) {
        return c.json({ error: 'nimi on jo listalla' }, 409);
      }
      if (error instanceof EmptyNameError) {
        return c.json({ error: 'nimi puuttuu' }, 400);
      }
      throw error;
    }
  });

  app.delete('/api/registrations/:playerId', async (c) => {
    const date = today();
    if (!isGameDay(date)) {
      return c.json({ error: 'tänään ei ole pelipäivä' }, 409);
    }

    try {
      await repo.unregister({
        gameDate: date,
        playerId: c.req.param('playerId'),
        ...ipHashOf(c.req.header('x-forwarded-for')),
      });
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof NotRegisteredError) {
        return c.json({ error: 'nimeä ei löytynyt tämän päivän listalta' }, 404);
      }
      throw error;
    }
  });

  app.get('/api/players', async (c) => {
    const players = await repo.listPlayers();
    c.header('cache-control', `public, max-age=${PLAYERS_CACHE_SECONDS}`);
    return c.json({ players });
  });

  app.get('/api/players/:playerId', async (c) => {
    const player = await repo.getPlayer(c.req.param('playerId'));
    if (player === null) return c.json({ error: 'pelaajaa ei löytynyt' }, 404);
    return c.json(player);
  });

  app.get('/api/announcements', async (c) => {
    const announcements = await repo.listAnnouncements(today());
    return c.json({ announcements });
  });

  app.post('/api/announcements', async (c) => {
    if (!pinAccepted(c.req.header('x-admin-pin'), env.ANNOUNCEMENT_PIN_HASH)) {
      return c.json({ error: 'väärä tunnusluku' }, 401);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'virheellinen pyyntö' }, 400);
    }

    const parsed = AnnouncementInputSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'tiedote on virheellinen' }, 400);

    const created = await repo.createAnnouncement(parsed.data);
    return c.json(created, 201);
  });

  app.notFound((c) => c.json({ error: 'not found' }, 404));

  return app;
}

/**
 * The audit trail records a salted fingerprint, never the address itself:
 * enough to see that twenty deletions came from one place, not enough to
 * identify a teammate.
 */
function ipHashOf(forwardedFor: string | undefined): { ipHash?: string } {
  const first = forwardedFor?.split(',')[0]?.trim();
  if (first === undefined || first.length === 0) return {};
  const salt = process.env.IP_HASH_SALT ?? '';
  return { ipHash: sha256Hex(`${salt}:${first}`).slice(0, 16) };
}
