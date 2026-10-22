import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createTestTable, dropTestTable, localClient } from './harness.js';
import {
  CorruptedPlayerError,
  PlayerRaceError,
  createRepo,
  type Repo,
} from '../src/repo.js';
import { createApp } from '../src/app.js';
import type { VerifyTurnstile } from '../src/turnstile.js';
import {
  TURNSTILE_TOKEN_FIELD,
  type Announcement,
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

  test('refuses the same player twice on one day', async () => {
    await post(MONDAY_MORNING, { name: 'Matti Virtanen', gameDate: '2026-10-19' });
    const res = await post(MONDAY_MORNING, { name: 'Matti  virtanen', gameDate: '2026-10-19' });

    expect(res.status).toBe(409);
    expect(await repo.listRegistrations('2026-10-19')).toHaveLength(1);
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
    }).request(
      `/api/announcements/${created.id}`,
      { method: 'DELETE' },
    );

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
