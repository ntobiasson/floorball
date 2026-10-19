import { createHash } from 'node:crypto';
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
import {
  AlreadyRegisteredError,
  AnnouncementNotFoundError,
  CorruptedPlayerError,
  NotRegisteredError,
  PlayerRaceError,
  type Repo,
} from './repo.js';
import { EmptyNameError } from '@sahlykanta/shared';

export interface AppConfig {
  repo: Repo;
  now?: () => Date;
}

/** The directory is ~500 rows that change a few times a week. */
const PLAYERS_CACHE_SECONDS = 300;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createApp({ repo, now = () => new Date() }: AppConfig): Hono {
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

  /**
   * Announcements are managed from an unlisted page. There is no secret to
   * present here: the page's address is the only thing not widely known, and
   * that protects the page, not this endpoint. It is the same trust model as
   * registrations, where anyone can already add or remove any name.
   */
  app.get('/api/announcements', async (c) => {
    const announcements =
      c.req.query('all') === undefined
        ? await repo.listAnnouncements(today())
        : // The management page edits expired and future ones too; the
          // landing page must not show them.
          await repo.listAllAnnouncements();
    return c.json({ announcements });
  });

  app.post('/api/announcements', async (c) => {
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

  app.delete('/api/announcements/:id', async (c) => {
    try {
      await repo.deleteAnnouncement(c.req.param('id'));
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof AnnouncementNotFoundError) {
        return c.json({ error: 'tiedotetta ei löytynyt' }, 404);
      }
      throw error;
    }
  });

  app.notFound((c) => c.json({ error: 'not found' }, 404));

  /**
   * Every error leaves as JSON, because the SPA parses every response body as
   * JSON. Hono's default handler returns text/plain, which the client cannot
   * read and so reports as a parse failure rather than as the real problem.
   */
  app.onError((error, c) => {
    if (error instanceof PlayerRaceError) {
      // Transient: two people submitted the same new name at the same instant.
      c.header('retry-after', '1');
      return c.json({ error: 'yritä uudelleen' }, 503);
    }
    if (error instanceof CorruptedPlayerError) {
      console.error(error.message);
      return c.json({ error: 'pelaajan tiedot ovat epäkunnossa — ota yhteyttä ylläpitoon' }, 500);
    }
    console.error(error);
    return c.json({ error: 'palvelussa tapahtui virhe' }, 500);
  });

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
