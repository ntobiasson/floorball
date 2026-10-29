import { createHash } from 'node:crypto';
import { Hono, type Context } from 'hono';
import {
  AnnouncementInputSchema,
  DEFAULT_SCHEDULE,
  GoalkeeperInputSchema,
  RegistrationInputSchema,
  TURNSTILE_ACTIONS,
  TURNSTILE_TOKEN_FIELD,
  isGameDay,
  nextGameDay,
  todayInHelsinki,
  weekdayOf,
  type TodayResponse,
  type TurnstileAction,
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
import type { VerifyTurnstile } from './turnstile.js';

export interface AppConfig {
  repo: Repo;
  now?: () => Date;
  /**
   * Bot verification for the three write routes. Required, not optional, so
   * that a new entry point cannot forget it and silently serve an unprotected
   * form — the compiler asks for one.
   */
  verifyTurnstile: VerifyTurnstile;
}

/** The directory is ~500 rows that change a few times a week. */
const PLAYERS_CACHE_SECONDS = 300;

/**
 * The archive behind the history page. Same cadence as the directory — it
 * moves only when somebody registers — but this one is assembled by a Scan,
 * so the cache is what keeps the page from paying for it on every visit.
 */
const HISTORY_CACHE_SECONDS = 300;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createApp({ repo, now = () => new Date(), verifyTurnstile }: AppConfig): Hono {
  const app = new Hono();

  /**
   * The write routes are gated, not replaced: verification runs first and
   * everything after it is the handler that was already there. There is still
   * no account and no password anywhere in this application — anyone can
   * register anyone and remove anyone — this only establishes that the caller
   * is a person rather than a script.
   */
  const verified = async (c: Context, action: TurnstileAction, body: unknown): Promise<boolean> =>
    verifyTurnstile({ token: tokenFrom(c, body), action, remoteIp: clientIpOf(c) });

  const refused = (c: Context) =>
    c.json({ error: 'varmistus ei onnistunut — päivitä sivu ja yritä uudelleen' }, 403);

  /**
   * The one source of truth for "which day is it". Never taken from the
   * client, because a browser in another timezone — or a tab left open
   * overnight — would otherwise write to the wrong day.
   */
  const today = () => todayInHelsinki(now());

  app.get('/api/today', async (c) => {
    const date = today();
    const gameDay = isGameDay(DEFAULT_SCHEDULE, date);
    const [registrations, announcements] = await Promise.all([
      gameDay ? repo.listRegistrations(date) : Promise.resolve([]),
      repo.listAnnouncements(date),
    ]);

    const nextGameDate = gameDay ? undefined : nextGameDay(DEFAULT_SCHEDULE, date);
    const body: TodayResponse = {
      date,
      weekday: weekdayOf(date),
      isGameDay: gameDay,
      ...(nextGameDate === undefined ? {} : { nextGameDate }),
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

    if (!(await verified(c, TURNSTILE_ACTIONS.register, raw))) return refused(c);

    const parsed = RegistrationInputSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'nimi tai päivä on virheellinen' }, 400);
    }

    const date = today();
    if (!isGameDay(DEFAULT_SCHEDULE, date)) {
      const nextGameDate = nextGameDay(DEFAULT_SCHEDULE, date);
      return c.json(
        { error: 'tänään ei ole pelipäivä', ...(nextGameDate === undefined ? {} : { nextGameDate }) },
        409,
      );
    }
    if (parsed.data.gameDate !== date) {
      // Not 400: the request is well formed, it is just aimed at another day.
      return c.json({ error: 'ilmoittautuminen on auki vain tälle päivälle', date }, 409);
    }

    try {
      const result = await repo.register({
        gameDate: date,
        rawName: parsed.data.name,
        // Spread rather than passed as `undefined`: an absent flag is how
        // every client before the form's box phrased an ordinary player.
        ...(parsed.data.isGoalkeeper === undefined
          ? {}
          : { isGoalkeeper: parsed.data.isGoalkeeper }),
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
    if (!isGameDay(DEFAULT_SCHEDULE, date)) {
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

  /**
   * Who is in goal tonight. Deliberately not gated on Turnstile: it is a
   * reversible toggle on a row that already exists, the destructive sibling
   * below — removing a name outright — is not gated either, and a widget
   * token per tap would buy nothing. Whoever can reach the form can already
   * add and remove any name.
   */
  app.patch('/api/registrations/:playerId/goalkeeper', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'virheellinen pyyntö' }, 400);
    }

    const parsed = GoalkeeperInputSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'virheellinen pyyntö' }, 400);

    const date = today();
    if (!isGameDay(DEFAULT_SCHEDULE, date)) {
      return c.json({ error: 'tänään ei ole pelipäivä' }, 409);
    }

    try {
      await repo.setGoalkeeper({
        gameDate: date,
        playerId: c.req.param('playerId'),
        isGoalkeeper: parsed.data.isGoalkeeper,
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

  /**
   * The whole archive, for the history page: every player with their per-year
   * counts. One response rather than a call per player, because the page
   * ranks everybody within a chosen year and so needs all of it at once. The
   * filtering and sorting happen in the browser, as they already do for the
   * directory.
   */
  app.get('/api/history', async (c) => {
    const players = await repo.listHistory();
    c.header('cache-control', `public, max-age=${HISTORY_CACHE_SECONDS}`);
    return c.json({ players });
  });

  app.get('/api/players/:playerId', async (c) => {
    const player = await repo.getPlayer(c.req.param('playerId'));
    if (player === null) return c.json({ error: 'pelaajaa ei löytynyt' }, 404);
    return c.json(player);
  });

  /**
   * The dates behind one player's counts. Separate from the route above, and
   * fetched only when somebody asks for that player: the history page needs
   * none of it, and a quarter of a century of dates for five hundred players
   * has no business in the response every visit begins with.
   *
   * The profile is read first so an unknown id is a 404 rather than an empty
   * list, which would otherwise be indistinguishable from somebody who has
   * registered and never played.
   */
  app.get('/api/players/:playerId/dates', async (c) => {
    const playerId = c.req.param('playerId');
    const player = await repo.getPlayer(playerId);
    if (player === null) return c.json({ error: 'pelaajaa ei löytynyt' }, 404);

    const dates = await repo.listPlayerDates(playerId);
    c.header('cache-control', `public, max-age=${HISTORY_CACHE_SECONDS}`);
    return c.json({ dates });
  });

  /**
   * Announcements are managed from an unlisted page. There is still no secret
   * to present: the page's address is the only thing not widely known, and
   * that protects the page, not these endpoints. The writes below are gated
   * on Turnstile, which keeps scripts out but identifies nobody — it is the
   * same trust model as registrations, where anyone can add or remove any
   * name. Reading is left open, as the landing page reads this too.
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

    if (!(await verified(c, TURNSTILE_ACTIONS.announce, raw))) return refused(c);

    const parsed = AnnouncementInputSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'tiedote on virheellinen' }, 400);

    const created = await repo.createAnnouncement(parsed.data);
    return c.json(created, 201);
  });

  app.delete('/api/announcements/:id', async (c) => {
    // A DELETE carries no body, so its token arrives in a header instead.
    if (!(await verified(c, TURNSTILE_ACTIONS.announce, undefined))) return refused(c);

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
  const first = firstHop(forwardedFor);
  if (first === undefined) return {};
  const salt = process.env.IP_HASH_SALT ?? '';
  return { ipHash: sha256Hex(`${salt}:${first}`).slice(0, 16) };
}

function firstHop(forwardedFor: string | undefined): string | undefined {
  const first = forwardedFor?.split(',')[0]?.trim();
  return first === undefined || first.length === 0 ? undefined : first;
}

/** Passed to siteverify as `remoteip`, which Cloudflare treats as a hint. */
function clientIpOf(c: Context): string | undefined {
  return firstHop(c.req.header('x-forwarded-for'));
}

/**
 * The POST routes carry the token in the JSON body, as the widget's own form
 * field would; the bodyless DELETE carries it in a header of the same name.
 * Both are read here so neither route has to care which it was.
 */
function tokenFrom(c: Context, body: unknown): unknown {
  if (typeof body === 'object' && body !== null && TURNSTILE_TOKEN_FIELD in body) {
    return (body as Record<string, unknown>)[TURNSTILE_TOKEN_FIELD];
  }
  return c.req.header(TURNSTILE_TOKEN_FIELD);
}
