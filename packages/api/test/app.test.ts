import { afterAll, beforeAll, beforeEach, describe, expect, it, test, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createTestTable, dropTestTable, localClient } from './harness.js';
import { CorruptedPlayerError, PlayerRaceError, createRepo, type Repo } from '../src/repo.js';
import { createApp } from '../src/app.js';
import type { VerifyTurnstile } from '../src/turnstile.js';
import {
  TURNSTILE_TOKEN_FIELD,
  type Announcement,
  type GameSlot,
  type PlayerDetail,
  type PlayerSummary,
  type TodayResponse,
} from '@sahlykanta/shared';

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** 2026-10-19 is a Monday, 2026-10-20 a Tuesday. */
const MONDAY_MORNING = new Date('2026-10-19T06:00:00Z');
const TUESDAY_MORNING = new Date('2026-10-20T06:00:00Z');

let client: DynamoDBDocumentClient;
let tableName: string;
let repo: Repo;

/**
 * Bot verification is the seam. These tests are about the routes, so they
 * stand in for "Cloudflare said yes" and "Cloudflare said no"; verification
 * itself — the siteverify call, the action and hostname checks — is covered
 * in turnstile.test.ts against a stubbed endpoint.
 */
const accept: VerifyTurnstile = async () => true;
const refuse: VerifyTurnstile = async () => false;

const appAt = (now: Date) => createApp({ repo, now: () => now, verifyTurnstile: accept });

beforeAll(async () => {
  client = localClient();
  tableName = await createTestTable(client);
});

afterAll(async () => {
  await dropTestTable(client, tableName);
});

beforeEach(async () => {
  await dropTestTable(client, tableName);
  tableName = await createTestTable(client);
  repo = createRepo({ client, tableName, now: () => MONDAY_MORNING });
});

describe('GET /api/today', () => {
  test('a Monday is a game day with an empty list', async () => {
    const res = await appAt(MONDAY_MORNING).request('/api/today');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      date: '2026-10-19',
      weekday: 1,
      isGameDay: true,
      registrations: [],
      announcements: [],
      schedule: [
        { id: 'default-monday', weekday: 1 },
        { id: 'default-wednesday', weekday: 3 },
        { id: 'default-saturday', weekday: 6 },
      ],
    });
  });

  test('a Tuesday is not a game day and names the next one', async () => {
    const res = await appAt(TUESDAY_MORNING).request('/api/today');

    expect(res.status).toBe(200);
    const body = await jsonBody<TodayResponse>(res);
    expect(body.isGameDay).toBe(false);
    expect(body.date).toBe('2026-10-20');
    expect(body.nextGameDate).toBe('2026-10-21');
  });

  test('lists who is already registered', async () => {
    await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });

    const body = await jsonBody<TodayResponse>(await appAt(MONDAY_MORNING).request('/api/today'));
    expect(body.registrations.map((r) => r.displayName)).toEqual(['Matti Virtanen']);
  });

  test('includes an announcement that is valid today', async () => {
    await repo.createAnnouncement({ body: 'Kenttä varattu' });

    const body = await jsonBody<TodayResponse>(await appAt(MONDAY_MORNING).request('/api/today'));
    expect(body.announcements.map((a) => a.body)).toEqual(['Kenttä varattu']);
  });
});

describe('POST /api/registrations', () => {
  const post = (now: Date, body: unknown) =>
    appAt(now).request('/api/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('registers on a game day', async () => {
    const res = await post(MONDAY_MORNING, { name: 'Matti Virtanen', gameDate: '2026-10-19' });

    expect(res.status).toBe(201);
    const body = await jsonBody<{ displayName: string }>(res);
    expect(body.displayName).toBe('Matti Virtanen');
    expect(await repo.listRegistrations('2026-10-19')).toHaveLength(1);
  });

  test('refuses on a Tuesday', async () => {
    const res = await post(TUESDAY_MORNING, { name: 'Matti Virtanen', gameDate: '2026-10-20' });

    expect(res.status).toBe(409);
    expect(await repo.listRegistrations('2026-10-20')).toEqual([]);
  });

  test.each([
    ['Thursday', new Date('2026-10-22T06:00:00Z'), '2026-10-22'],
    ['Friday', new Date('2026-10-23T06:00:00Z'), '2026-10-23'],
    ['Sunday', new Date('2026-10-25T06:00:00Z'), '2026-10-25'],
  ])('refuses on a %s', async (_label, now, date) => {
    const res = await post(now, { name: 'Matti Virtanen', gameDate: date });

    expect(res.status).toBe(409);
    expect(await repo.listRegistrations(date)).toEqual([]);
  });

  test('refuses a game date that is not today, and writes nothing', async () => {
    // A tab left open since Saturday, or someone trying to book Wednesday early.
    const res = await post(MONDAY_MORNING, { name: 'Matti Virtanen', gameDate: '2026-10-21' });

    expect(res.status).toBe(409);
    expect(await repo.listRegistrations('2026-10-21')).toEqual([]);
    expect(await repo.listRegistrations('2026-10-19')).toEqual([]);
  });

  test('refuses an empty name', async () => {
    const res = await post(MONDAY_MORNING, { name: '   ', gameDate: '2026-10-19' });

    expect(res.status).toBe(400);
  });

  test('refuses a name over 60 characters', async () => {
    const res = await post(MONDAY_MORNING, { name: 'a'.repeat(61), gameDate: '2026-10-19' });

    expect(res.status).toBe(400);
  });

  test('refuses a body that is not an object', async () => {
    const res = await post(MONDAY_MORNING, 'Matti Virtanen');

    expect(res.status).toBe(400);
  });

  test('puts a ticked goalkeeper box straight onto the day s list', async () => {
    const res = await post(MONDAY_MORNING, {
      name: 'Jukka Rantanen',
      gameDate: '2026-10-19',
      isGoalkeeper: true,
    });

    expect(res.status).toBe(201);
    const [entry] = await repo.listRegistrations('2026-10-19');
    expect(entry?.isGoalkeeper).toBe(true);
  });

  test('registers an ordinary player when the box was left empty', async () => {
    await post(MONDAY_MORNING, {
      name: 'Jukka Rantanen',
      gameDate: '2026-10-19',
      isGoalkeeper: false,
    });

    const [entry] = await repo.listRegistrations('2026-10-19');
    expect(entry?.isGoalkeeper).toBeUndefined();
  });

  test('registers an ordinary player when the flag is absent, as older clients send it', async () => {
    await post(MONDAY_MORNING, { name: 'Jukka Rantanen', gameDate: '2026-10-19' });

    const [entry] = await repo.listRegistrations('2026-10-19');
    expect(entry?.isGoalkeeper).toBeUndefined();
  });

  test('refuses a goalkeeper flag that is not a boolean, and writes nothing', async () => {
    const res = await post(MONDAY_MORNING, {
      name: 'Jukka Rantanen',
      gameDate: '2026-10-19',
      isGoalkeeper: 'kyllä',
    });

    expect(res.status).toBe(400);
    expect(await repo.listRegistrations('2026-10-19')).toEqual([]);
  });

  test('refuses the same player twice on one day', async () => {
    await post(MONDAY_MORNING, { name: 'Matti Virtanen', gameDate: '2026-10-19' });
    const res = await post(MONDAY_MORNING, { name: 'Matti  virtanen', gameDate: '2026-10-19' });

    expect(res.status).toBe(409);
    expect(await repo.listRegistrations('2026-10-19')).toHaveLength(1);
  });
});

describe('PATCH /api/registrations/:playerId/goalkeeper', () => {
  const patch = (playerId: string, isGoalkeeper: boolean, now = MONDAY_MORNING) =>
    appAt(now).request(`/api/registrations/${playerId}/goalkeeper`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isGoalkeeper }),
    });

  test('marks somebody on today list, and the day says so', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Jukka Rantanen' });

    const res = await patch(playerId, true);

    expect(res.status).toBe(204);
    const [entry] = await repo.listRegistrations('2026-10-19');
    expect(entry?.isGoalkeeper).toBe(true);
  });

  test('unmarks again', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Jukka Rantanen' });
    await patch(playerId, true);

    const res = await patch(playerId, false);

    expect(res.status).toBe(204);
    const [entry] = await repo.listRegistrations('2026-10-19');
    expect(entry?.isGoalkeeper).toBeUndefined();
  });

  test('the day list carries the flag', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Jukka Rantanen' });
    await repo.register({ gameDate: '2026-10-19', rawName: 'Mikko Laine' });
    await patch(playerId, true);

    const body = await jsonBody<TodayResponse>(await appAt(MONDAY_MORNING).request('/api/today'));

    expect(
      body.registrations.filter((r) => r.isGoalkeeper === true).map((r) => r.displayName),
    ).toEqual(['Jukka Rantanen']);
  });

  test('is a 404 when that player is not on today list', async () => {
    const res = await patch('nobody', true);

    expect(res.status).toBe(404);
    // The route's own refusal, not Hono's catch-all: without this the test
    // passes just as well when the route does not exist at all.
    expect(await jsonBody<{ error: string }>(res)).toEqual({
      error: 'nimeä ei löytynyt tämän päivän listalta',
    });
  });

  test('refuses a body that is not a boolean', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Jukka Rantanen' });

    const res = await appAt(MONDAY_MORNING).request(`/api/registrations/${playerId}/goalkeeper`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isGoalkeeper: 'kyllä' }),
    });

    expect(res.status).toBe(400);
  });

  test('refuses on a day that is not a game day', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Jukka Rantanen' });

    const res = await patch(playerId, true, TUESDAY_MORNING);

    expect(res.status).toBe(409);
  });

  test('is not gated on Turnstile, as removing a name is not', async () => {
    // A reversible toggle on a row that already exists. Gating it would mint
    // a token per tap for no gain, and removal — which is destructive — is
    // deliberately open too.
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Jukka Rantanen' });
    const app = createApp({ repo, now: () => MONDAY_MORNING, verifyTurnstile: refuse });

    const res = await app.request(`/api/registrations/${playerId}/goalkeeper`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isGoalkeeper: true }),
    });

    expect(res.status).toBe(204);
  });
});

describe('DELETE /api/registrations/:playerId', () => {
  test('removes a name from today', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });

    const res = await appAt(MONDAY_MORNING).request(`/api/registrations/${playerId}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(204);
    expect(await repo.listRegistrations('2026-10-19')).toEqual([]);
  });

  test('is a 404 when that player is not on today list', async () => {
    const res = await appAt(MONDAY_MORNING).request('/api/registrations/nobody', {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
  });

  test('refuses on a day that is not a game day', async () => {
    const res = await appAt(TUESDAY_MORNING).request('/api/registrations/anyone', {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
  });
});

describe('GET /api/players', () => {
  test('returns the directory', async () => {
    await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });

    const res = await appAt(MONDAY_MORNING).request('/api/players');

    expect(res.status).toBe(200);
    const body = await jsonBody<{ players: PlayerSummary[] }>(res);
    expect(body.players).toEqual([
      { playerId: expect.any(String), displayName: 'Matti Virtanen', total: 1 },
    ]);
  });

  test('is cacheable, since the directory changes rarely', async () => {
    const res = await appAt(MONDAY_MORNING).request('/api/players');

    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
  });
});

describe('GET /api/players/:playerId', () => {
  test('returns the per-year breakdown', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });

    const res = await appAt(MONDAY_MORNING).request(`/api/players/${playerId}`);

    expect(res.status).toBe(200);
    expect(await jsonBody<PlayerDetail>(res)).toEqual({
      playerId,
      displayName: 'Matti Virtanen',
      total: 1,
      years: [{ year: '2026', count: 1 }],
    });
  });

  test('is a 404 for an unknown player', async () => {
    const res = await appAt(MONDAY_MORNING).request('/api/players/nobody');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/players/:playerId/dates', () => {
  test('returns every date that player played, newest first', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });
    await repo.register({ gameDate: '2026-10-21', rawName: 'Matti Virtanen' });

    const res = await appAt(MONDAY_MORNING).request(`/api/players/${playerId}/dates`);

    expect(res.status).toBe(200);
    expect(await jsonBody<{ dates: string[] }>(res)).toEqual({
      dates: ['2026-10-21', '2026-10-19'],
    });
  });

  test('is a 404 for an unknown player, as the sibling route is', async () => {
    const res = await appAt(MONDAY_MORNING).request('/api/players/nobody/dates');

    expect(res.status).toBe(404);
  });

  test('is cacheable, the archive being what it is', async () => {
    const { playerId } = await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });

    const res = await appAt(MONDAY_MORNING).request(`/api/players/${playerId}/dates`);

    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
  });
});

describe('GET /api/history', () => {
  test('returns every player with their per-year counts', async () => {
    await repo.register({ gameDate: '2026-10-19', rawName: 'Matti Virtanen' });
    await repo.register({ gameDate: '2024-01-15', rawName: 'Matti Virtanen' });
    await repo.register({ gameDate: '2026-10-19', rawName: 'Liisa Korhonen' });

    const res = await appAt(MONDAY_MORNING).request('/api/history');

    expect(res.status).toBe(200);
    const body = await jsonBody<{ players: PlayerDetail[] }>(res);
    expect(body.players).toEqual([
      {
        playerId: expect.any(String),
        displayName: 'Liisa Korhonen',
        total: 1,
        years: [{ year: '2026', count: 1 }],
      },
      {
        playerId: expect.any(String),
        displayName: 'Matti Virtanen',
        total: 2,
        years: [
          { year: '2026', count: 1 },
          { year: '2024', count: 1 },
        ],
      },
    ]);
  });

  test('is cacheable, since the archive barely changes', async () => {
    const res = await appAt(MONDAY_MORNING).request('/api/history');

    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
  });

  test('is an empty list on an empty table', async () => {
    const res = await appAt(MONDAY_MORNING).request('/api/history');

    expect(await jsonBody<{ players: PlayerDetail[] }>(res)).toEqual({ players: [] });
  });
});

describe('unknown routes', () => {
  test('a missing API path is a 404 JSON error', async () => {
    const res = await appAt(MONDAY_MORNING).request('/api/nope');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});

describe('server-side faults are reported as JSON, not as a blank 500', () => {
  const stubRepo = (error: Error): Repo =>
    ({
      ...repo,
      register: vi.fn().mockRejectedValue(error),
    }) as Repo;

  const post = (brokenRepo: Repo) =>
    createApp({ repo: brokenRepo, now: () => MONDAY_MORNING, verifyTurnstile: accept }).request(
      '/api/registrations',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Matti Virtanen', gameDate: '2026-10-19' }),
      },
    );

  test('a lost creation race is a retryable conflict, not an internal error', async () => {
    const res = await post(stubRepo(new PlayerRaceError('matti virtanen')));

    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/uudelleen/i) });
  });

  test('a corrupted player is a 500 the client can display', async () => {
    const res = await post(stubRepo(new CorruptedPlayerError('ORPHAN01', 'no profile')));

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toHaveProperty('error');
  });
});

describe('managing announcements', () => {
  const app = () => createApp({ repo, now: () => MONDAY_MORNING, verifyTurnstile: accept });

  const post = (body: unknown) =>
    app().request('/api/announcements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('anyone can add one, with no secret to know', async () => {
    const res = await post({ body: 'Kenttä varattu' });

    expect(res.status).toBe(201);
    expect(await repo.listAnnouncements('2026-10-19')).toHaveLength(1);
  });

  test('an added announcement appears on the landing page straight away', async () => {
    await post({ body: 'Kenttä varattu' });

    const today = await jsonBody<TodayResponse>(await app().request('/api/today'));
    expect(today.announcements.map((a) => a.body)).toEqual(['Kenttä varattu']);
  });

  test('refuses an empty body', async () => {
    expect((await post({ body: '   ' })).status).toBe(400);
  });

  test('refuses a body over the length limit', async () => {
    expect((await post({ body: 'a'.repeat(501) })).status).toBe(400);
  });

  test('accepts a validity window', async () => {
    const res = await post({ body: 'Joulutauko', validFrom: '2026-12-20', validTo: '2026-12-28' });

    expect(res.status).toBe(201);
    // Outside the window today, so the landing page does not show it...
    expect(await repo.listAnnouncements('2026-10-19')).toEqual([]);
    // ...but the management list must.
    const all = await jsonBody<{ announcements: Announcement[] }>(
      await app().request('/api/announcements?all=1'),
    );
    expect(all.announcements.map((a) => a.body)).toEqual(['Joulutauko']);
  });

  test('the plain list shows only what is valid today', async () => {
    await repo.createAnnouncement({ body: 'Vanha', validTo: '2026-10-18' });
    await repo.createAnnouncement({ body: 'Voimassa' });

    const list = await jsonBody<{ announcements: Announcement[] }>(
      await app().request('/api/announcements'),
    );
    expect(list.announcements.map((a) => a.body)).toEqual(['Voimassa']);
  });

  test('anyone can remove one', async () => {
    const created = await repo.createAnnouncement({ body: 'Poistettava' });

    const res = await app().request(`/api/announcements/${created.id}`, { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(await repo.listAllAnnouncements()).toEqual([]);
  });

  test('removing one that is not there is a 404', async () => {
    const res = await app().request('/api/announcements/ei-ole', { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  test('removal works on a day that is not a game day', async () => {
    // Announcements are not tied to the game-day rule.
    const created = await repo.createAnnouncement({ body: 'Poistettava' });

    const res = await createApp({
      repo,
      now: () => TUESDAY_MORNING,
      verifyTurnstile: accept,
    }).request(`/api/announcements/${created.id}`, { method: 'DELETE' });

    expect(res.status).toBe(204);
  });
});

describe('bot verification gates the writes', () => {
  const gated = (verifyTurnstile: VerifyTurnstile) =>
    createApp({ repo, now: () => MONDAY_MORNING, verifyTurnstile });

  const register = (app: ReturnType<typeof gated>, body: unknown) =>
    app.request('/api/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const valid = { name: 'Uusi Pelaaja', gameDate: '2026-10-19' };

  test('an unverified registration is refused and writes nothing', async () => {
    const res = await register(gated(refuse), valid);

    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/varmistus/i) });
    expect(await repo.listRegistrations('2026-10-19')).toEqual([]);
  });

  test('a verified registration goes through as before', async () => {
    const res = await register(gated(accept), valid);

    expect(res.status).toBe(201);
    expect(await repo.listRegistrations('2026-10-19')).toHaveLength(1);
  });

  test('the token travels from the body, under the registration action', async () => {
    const seen = vi.fn<VerifyTurnstile>().mockResolvedValue(true);

    await register(gated(seen), { ...valid, [TURNSTILE_TOKEN_FIELD]: 'a-token' });

    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'a-token', action: 'register' }),
    );
  });

  test('the caller address is offered to the verifier as a hint', async () => {
    const seen = vi.fn<VerifyTurnstile>().mockResolvedValue(true);

    await gated(seen).request('/api/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      body: JSON.stringify(valid),
    });

    // The client, not the proxy that forwarded it.
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ remoteIp: '203.0.113.7' }));
  });

  test('verification runs before validation, so a bot learns nothing from the 400s', async () => {
    const res = await register(gated(refuse), { name: '', gameDate: 'not-a-date' });

    expect(res.status).toBe(403);
  });

  test('an unverified announcement is refused', async () => {
    const res = await gated(refuse).request('/api/announcements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Kenttä varattu' }),
    });

    expect(res.status).toBe(403);
    expect(await repo.listAllAnnouncements()).toEqual([]);
  });

  test('an unverified announcement removal is refused and the announcement stays', async () => {
    const created = await repo.createAnnouncement({ body: 'Jää paikalleen' });

    const res = await gated(refuse).request(`/api/announcements/${created.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(403);
    expect(await repo.listAllAnnouncements()).toHaveLength(1);
  });

  test('a removal carries its token in a header, since a DELETE has no body', async () => {
    const seen = vi.fn<VerifyTurnstile>().mockResolvedValue(true);
    const created = await repo.createAnnouncement({ body: 'Poistettava' });

    const res = await gated(seen).request(`/api/announcements/${created.id}`, {
      method: 'DELETE',
      headers: { [TURNSTILE_TOKEN_FIELD]: 'a-token' },
    });

    expect(res.status).toBe(204);
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'a-token', action: 'announce' }),
    );
  });

  test('reading is left open: the landing page is not gated', async () => {
    const app = gated(refuse);

    expect((await app.request('/api/today')).status).toBe(200);
    expect((await app.request('/api/players')).status).toBe(200);
    expect((await app.request('/api/announcements')).status).toBe(200);
  });
});

const app = {
  request: (path: string, init?: RequestInit) => appAt(MONDAY_MORNING).request(path, init),
};

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(body as object), [TURNSTILE_TOKEN_FIELD]: 'token' }),
  });

const del = (path: string) =>
  app.request(path, { method: 'DELETE', headers: { [TURNSTILE_TOKEN_FIELD]: 'token' } });

describe('GET /api/schedule', () => {
  it('is open, and empty before anything is stored', async () => {
    const res = await app.request('/api/schedule');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slots: [], initialised: false });
  });

  it('answers in display order, Monday first', async () => {
    await post('/api/schedule', { weekday: 6, startTime: '18:00' });
    await post('/api/schedule', { weekday: 1, startTime: '20:00' });
    const body = await jsonBody<{ slots: GameSlot[] }>(await app.request('/api/schedule'));
    expect(body.slots.map((s) => s.weekday)).toEqual([1, 6]);
  });
});

describe('POST /api/schedule', () => {
  it('stores a slot and answers 201 with it', async () => {
    const res = await post('/api/schedule', { weekday: 1, startTime: '20:00', endTime: '21:30' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ weekday: 1, startTime: '20:00', endTime: '21:30' });
  });

  it('refuses an unverified caller', async () => {
    // The app under test here is built with a verifier that always refuses.
    const res = await createApp({
      repo,
      now: () => MONDAY_MORNING,
      verifyTurnstile: refuse,
    }).request('/api/schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekday: 1, startTime: '20:00', [TURNSTILE_TOKEN_FIELD]: 'token' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a slot whose end is before its start', async () => {
    const res = await post('/api/schedule', { weekday: 1, startTime: '21:00', endTime: '20:00' });
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toMatch(/pelivuoro/i);
  });

  it('refuses a slot that is already there', async () => {
    await post('/api/schedule', { weekday: 1, startTime: '20:00', endTime: '21:30' });
    const res = await post('/api/schedule', { weekday: 1, startTime: '20:00', endTime: '21:30' });
    expect(res.status).toBe(409);
    const body = await jsonBody<{ slots: GameSlot[] }>(await app.request('/api/schedule'));
    expect(body.slots).toHaveLength(1);
  });

  it('allows a second slot on the same weekday at another time', async () => {
    await post('/api/schedule', { weekday: 1, startTime: '18:00' });
    expect((await post('/api/schedule', { weekday: 1, startTime: '20:00' })).status).toBe(201);
  });

  it('rejects a body that is not a slot', async () => {
    expect((await post('/api/schedule', { weekday: 9 })).status).toBe(400);
  });

  it('rejects a body that is not JSON at all', async () => {
    const res = await app.request('/api/schedule', { method: 'POST', body: 'ei json' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/schedule/:id', () => {
  it('removes a stored slot', async () => {
    const created = await jsonBody<GameSlot>(
      await post('/api/schedule', { weekday: 1, startTime: '20:00' }),
    );
    expect((await del(`/api/schedule/${created.id}`)).status).toBe(204);
    const body = await jsonBody<{ slots: GameSlot[] }>(await app.request('/api/schedule'));
    expect(body.slots).toEqual([]);
  });

  it('answers 404 for a slot that is not there', async () => {
    expect((await del('/api/schedule/ei-ole')).status).toBe(404);
  });

  it('refuses an unverified caller', async () => {
    const res = await createApp({
      repo,
      now: () => MONDAY_MORNING,
      verifyTurnstile: refuse,
    }).request('/api/schedule/mikä-vain', {
      method: 'DELETE',
      headers: { [TURNSTILE_TOKEN_FIELD]: 'token' },
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/today, with a stored schedule', () => {
  it('falls back to Monday, Wednesday and Saturday while nothing is stored', async () => {
    // The clock is pinned to Monday 19.10.2026.
    const body = await jsonBody<TodayResponse>(await app.request('/api/today'));
    expect(body.isGameDay).toBe(true);
    expect(body.schedule.map((s) => s.weekday)).toEqual([1, 3, 6]);
  });

  it('carries every stored slot, in Monday-first order', async () => {
    await post('/api/schedule', { weekday: 4, startTime: '19:00' });
    await post('/api/schedule', { weekday: 1, startTime: '20:00', endTime: '21:30' });
    const body = await jsonBody<TodayResponse>(await app.request('/api/today'));
    expect(body.schedule.map((s) => s.weekday)).toEqual([1, 4]);
  });

  it('follows the stored schedule rather than the old rule', async () => {
    await post('/api/schedule', { weekday: 4, startTime: '19:00' });
    const body = await jsonBody<TodayResponse>(await app.request('/api/today'));
    // Monday, but Thursday is the only slot now.
    expect(body.isGameDay).toBe(false);
    expect(body.nextGameDate).toBe('2026-10-22');
  });

  it('is a playing day the moment a slot for it is saved', async () => {
    await post('/api/schedule', { weekday: 1, startTime: '20:00' });
    const body = await jsonBody<TodayResponse>(await app.request('/api/today'));
    expect(body.isGameDay).toBe(true);
    expect(body.registrations).toEqual([]);
  });

  it('offers no next playing day once every slot has been removed', async () => {
    const created = await jsonBody<GameSlot>(
      await post('/api/schedule', { weekday: 1, startTime: '20:00' }),
    );
    await del(`/api/schedule/${created.id}`);
    const body = await jsonBody<TodayResponse>(await app.request('/api/today'));
    expect(body.isGameDay).toBe(false);
    expect(body.nextGameDate).toBeUndefined();
    expect(body.schedule).toEqual([]);
  });
});

describe('the write routes under a stored schedule', () => {
  it('refuses a registration on a day the stored schedule does not play', async () => {
    await post('/api/schedule', { weekday: 4, startTime: '19:00' });
    const res = await post('/api/registrations', { name: 'Testi', gameDate: '2026-10-19' });
    expect(res.status).toBe(409);
    expect((await jsonBody<{ nextGameDate?: string }>(res)).nextGameDate).toBe('2026-10-22');
  });

  it('accepts a registration on a day only the stored schedule plays', async () => {
    await post('/api/schedule', { weekday: 1, startTime: '20:00' });
    expect(
      (await post('/api/registrations', { name: 'Testi', gameDate: '2026-10-19' })).status,
    ).toBe(201);
  });

  it('refuses a registration when the schedule is empty, with no day to offer', async () => {
    const created = await jsonBody<GameSlot>(
      await post('/api/schedule', { weekday: 4, startTime: '19:00' }),
    );
    await del(`/api/schedule/${created.id}`);
    const res = await post('/api/registrations', { name: 'Testi', gameDate: '2026-10-19' });
    expect(res.status).toBe(409);
    expect(await jsonBody<object>(res)).not.toHaveProperty('nextGameDate');
  });
});
