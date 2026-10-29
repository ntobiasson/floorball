# Playing Slots as a Managed Setting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the playing days out of the code into the table, managed from an unlisted `/asetukset` page of the same kind as `/tiedotteet`, each slot carrying a time that is shown wherever a playing date is shown.

**Architecture:** A playing slot is a weekday, a start time and an optional end time, stored in one `SETTINGS` partition of the existing single table. A stored slot is live — there are no validity windows and no pending state. `isGameDay` and `nextGameDay` stop being pure functions of the calendar and take the schedule as their first argument; the hardcoded Mon/Wed/Sat rule survives as the schedule used while the partition has never been written. `GET /api/today` carries the schedule with it, so the landing page needs no second request.

**Tech Stack:** TypeScript (Node 24, ESM), Zod schemas in `packages/shared`, Hono + DynamoDB in `packages/api`, React 19 + Vite in `packages/web`, Vitest per package, Playwright for e2e. No infrastructure change.

**Spec:** `docs/superpowers/specs/2026-10-29-schedule-settings-design.md`

## Global Constraints

- Every date is an ISO `YYYY-MM-DD` string and every time an `HH:MM` 24-hour string, both in the Europe/Helsinki calendar. A `Date` never crosses a module boundary (`packages/shared/src/dates.ts` header).
- Weekday numbers are `Date#getUTCDay` numbers: Sunday = 0 … Saturday = 6, as `weekdayOf` returns. Display order is Monday first.
- A stored slot is in force. Nothing anywhere carries a validity window, a "shown from" date or a pending state.
- All user-facing copy is Finnish, lower-case sentence style, matching the strings already in `app.ts` and the web pages.
- Times render in Finnish convention: `klo` prefix, period for minutes, no `.00` on a whole hour, en dash (`–`, U+2013) in a range. `klo 20`, `klo 21.30`, `klo 20–21.30`.
- Both `/api/schedule` write routes are gated on Turnstile; the POST carries its token in the JSON body, the DELETE in a header of the same name (`app.ts` `tokenFrom`). Reading is open.
- `/asetukset` adds no link anywhere in the application. `e2e/notices.spec.ts` asserts `hrefs` equals exactly `['/', '/peliaktiivisuus']`; that assertion must still pass.
- No change to `packages/infra`. The schedule lives in the existing table, under a new partition key.
- `startTime` is optional in `GameSlotSchema` (what may be read) and required in `GameSlotInputSchema` (what the form creates) — the same asymmetry `isGoalkeeper` already has in `schemas.ts`.
- API tests need DynamoDB Local: `docker compose up -d` before running `@sahlykanta/api` suites.

## Review Focus

1. **A stored schedule with no slots.** Once the marker exists, an empty slot list means "we do not play at the moment": `nextGameDay` returns `undefined`, the closed card must not draw a "Seuraava pelipäivä" heading over nothing, and `POST /api/registrations` must 409 without a `nextGameDate` field. — Tasks 2, 5, 8.
2. **Two slots on the same weekday.** Today's card and the week list must show both, in time order, not the first one found. — Tasks 2, 8.
3. **The same slot added twice.** An exact duplicate is refused with a 409, so the landing page never shows one evening's time on two lines. — Tasks 2, 4.
4. **`endTime` not after `startTime`.** Rejected at the boundary with a Finnish message, never stored. — Tasks 2, 4.
5. **The marker row.** `listSlots` must never return `SETTINGS / INITIALISED` as a slot, and deleting an unknown id is a 404. — Task 3.

---

### Task 1: `addDays` in the date module

**Files:**
- Modify: `packages/shared/src/dates.ts`
- Test: `packages/shared/test/dates.test.ts`

**Interfaces:**
- Produces: `addDays(iso: string, days: number): string`

- [ ] **Step 1: Write the failing tests** in `packages/shared/test/dates.test.ts`

```ts
describe('addDays', () => {
  it('steps forward a day', () => {
    expect(addDays('2026-10-19', 1)).toBe('2026-10-20');
  });

  it('crosses a month boundary', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('crosses the end of a year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('is unmoved by the autumn clock change', () => {
    // Finland turns the clocks back in the small hours of 25.10.2026.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('steps backwards', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('rejects a date that is not ISO', () => {
    expect(() => addDays('19.10.2026', 1)).toThrow(InvalidDateError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @sahlykanta/shared -- test/dates.test.ts`
Expected: FAIL — `addDays` is not exported.

- [ ] **Step 3: Implement `addDays(iso: string, days: number): string` in `packages/shared/src/dates.ts`**

Use the file's existing `assertIsoDate` and `toUtcNoon` helpers; midday UTC is what makes a whole-day step immune to an offset change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @sahlykanta/shared -- test/dates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dates.ts packages/shared/test/dates.test.ts
git commit -m "feat(shared): step whole days without a timezone deciding which day it is"
```

---

### Task 2: The schedule module

The schedule becomes a value the calendar functions are asked about, rather than a constant they close over. `isGameDay` and `nextGameDay` change shape, so this task also updates their five call sites to pass `DEFAULT_SCHEDULE` — the stored schedule arrives in Task 5, and the build stays green in between.

**Files:**
- Create: `packages/shared/src/schedule.ts`
- Modify: `packages/shared/src/index.ts` (export it), `packages/shared/src/dates.ts` (remove `GAME_WEEKDAYS`, `isGameDay`, `nextGameDay`), `packages/api/src/app.ts:77,87,110,111,143,181`, `packages/web/src/pages/Today.tsx:9,92`
- Test: `packages/shared/test/schedule.test.ts` (new), `packages/shared/test/dates.test.ts` (remove the `isGameDay` describe block, lines 27–43, and the `nextGameDay` describe block, lines 88–109 — leaving the `todayInHelsinki` and `addDays` blocks between and after them untouched)

**Interfaces:**
- Consumes: `addDays`, `weekdayOf` (Task 1 / `dates.ts`)
- Produces:
  - `IsoTimeSchema: ZodString`
  - `GameSlotSchema` / `type GameSlot = { id: string; weekday: number; startTime?: string; endTime?: string }`
  - `GameSlotInputSchema` / `type GameSlotInput = { weekday: number; startTime: string; endTime?: string }`
  - `DEFAULT_SCHEDULE: readonly GameSlot[]`
  - `effectiveSchedule(slots: readonly GameSlot[], initialised: boolean): readonly GameSlot[]`
  - `orderSlots(slots: readonly GameSlot[]): GameSlot[]` — Monday first, then by start time
  - `slotsOn(slots: readonly GameSlot[], iso: string): GameSlot[]`
  - `isGameDay(slots: readonly GameSlot[], iso: string): boolean`
  - `nextGameDay(slots: readonly GameSlot[], iso: string): string | undefined`
  - `hasSameSlot(slots: readonly GameSlot[], input: GameSlotInput): boolean`

- [ ] **Step 1: Write the failing tests** in `packages/shared/test/schedule.test.ts`

```ts
const MON = { id: 'a', weekday: 1, startTime: '20:00', endTime: '21:30' };
const WED = { id: 'b', weekday: 3, startTime: '20:00' };
const SAT = { id: 'c', weekday: 6, startTime: '18:00' };

describe('GameSlotInputSchema', () => {
  it('accepts a weekday and a start time', () => {
    expect(GameSlotInputSchema.safeParse({ weekday: 1, startTime: '20:00' }).success).toBe(true);
  });

  it('requires a start time', () => {
    expect(GameSlotInputSchema.safeParse({ weekday: 1 }).success).toBe(false);
  });

  it.each(['24:00', '7:00', '20:60', '20.00', '', 'klo 20'])('rejects %s as a time', (time) => {
    expect(GameSlotInputSchema.safeParse({ weekday: 1, startTime: time }).success).toBe(false);
  });

  it('rejects an end that is not after the start', () => {
    const same = { weekday: 1, startTime: '20:00', endTime: '20:00' };
    expect(GameSlotInputSchema.safeParse(same).success).toBe(false);
    expect(GameSlotInputSchema.safeParse({ ...same, endTime: '19:00' }).success).toBe(false);
  });

  it.each([-1, 7, 1.5])('rejects %s as a weekday', (weekday) => {
    expect(GameSlotInputSchema.safeParse({ weekday, startTime: '20:00' }).success).toBe(false);
  });

  it('has no place for a validity window', () => {
    const windowed = { weekday: 1, startTime: '20:00', validFrom: '2026-12-01' };
    expect(GameSlotInputSchema.parse(windowed)).not.toHaveProperty('validFrom');
  });
});

describe('GameSlotSchema', () => {
  it('accepts a slot with no time, as the fallback schedule carries', () => {
    expect(GameSlotSchema.safeParse({ id: 'a', weekday: 1 }).success).toBe(true);
  });
});

describe('effectiveSchedule', () => {
  it('is the Monday, Wednesday and Saturday rule until something is stored', () => {
    expect(effectiveSchedule([], false)).toEqual(DEFAULT_SCHEDULE);
  });

  it('carries no times in the fallback, rather than inventing one', () => {
    expect(DEFAULT_SCHEDULE.map((s) => s.weekday)).toEqual([1, 3, 6]);
    expect(DEFAULT_SCHEDULE.every((s) => s.startTime === undefined)).toBe(true);
  });

  it('is the stored slots once the partition has been written', () => {
    expect(effectiveSchedule([SAT], true)).toEqual([SAT]);
  });

  it('is empty once every slot has been removed — not the fallback again', () => {
    expect(effectiveSchedule([], true)).toEqual([]);
  });
});

describe('orderSlots', () => {
  it('is Monday first, then by start time', () => {
    const early = { id: 'd', weekday: 1, startTime: '18:00' };
    const sunday = { id: 'e', weekday: 0, startTime: '12:00' };
    const order = orderSlots([sunday, SAT, WED, MON, early]);
    expect(order.map((s) => s.id)).toEqual(['d', 'a', 'b', 'c', 'e']);
  });

  it('puts a slot with no time before one with a time on the same day', () => {
    const untimed = { id: 'd', weekday: 1 };
    expect(orderSlots([MON, untimed]).map((s) => s.id)).toEqual(['d', 'a']);
  });
});

describe('slotsOn', () => {
  it('is only the slots for that date’s weekday', () => {
    // 19.10.2026 is a Monday.
    expect(slotsOn([MON, WED, SAT], '2026-10-19').map((s) => s.id)).toEqual(['a']);
  });

  it('returns both of two slots sharing a weekday, in time order', () => {
    const late = { id: 'd', weekday: 1, startTime: '21:45' };
    expect(slotsOn([late, MON], '2026-10-19').map((s) => s.id)).toEqual(['a', 'd']);
  });

  it('is empty on a day nobody plays', () => {
    expect(slotsOn([MON, WED, SAT], '2026-10-20')).toEqual([]);
  });
});

describe('isGameDay', () => {
  it.each([
    ['2026-10-19', true],
    ['2026-10-20', false],
    ['2026-10-21', true],
    ['2026-10-24', true],
    ['2026-10-25', false],
  ])('%s under the default schedule is %s', (iso, expected) => {
    expect(isGameDay(DEFAULT_SCHEDULE, iso)).toBe(expected);
  });

  it('follows a schedule that is not the default one', () => {
    const thursdays = [{ id: 'a', weekday: 4, startTime: '20:00' }];
    expect(isGameDay(thursdays, '2026-10-22')).toBe(true);
    expect(isGameDay(thursdays, '2026-10-19')).toBe(false);
  });

  it('is false for every day under an empty schedule', () => {
    expect(isGameDay([], '2026-10-19')).toBe(false);
  });
});

describe('nextGameDay', () => {
  it('is the next day a slot falls on, never the given day itself', () => {
    expect(nextGameDay(DEFAULT_SCHEDULE, '2026-10-19')).toBe('2026-10-21');
    expect(nextGameDay(DEFAULT_SCHEDULE, '2026-10-20')).toBe('2026-10-21');
  });

  it('crosses a month boundary', () => {
    expect(nextGameDay(DEFAULT_SCHEDULE, '2026-10-31')).toBe('2026-11-02');
  });

  it('wraps the week for a single weekday', () => {
    const mondays = [{ id: 'a', weekday: 1, startTime: '20:00' }];
    expect(nextGameDay(mondays, '2026-10-19')).toBe('2026-10-26');
  });

  it('is undefined when the schedule is empty', () => {
    expect(nextGameDay([], '2026-10-19')).toBeUndefined();
  });
});

describe('hasSameSlot', () => {
  it('finds a slot with the same weekday and the same times', () => {
    expect(hasSameSlot([MON], { weekday: 1, startTime: '20:00', endTime: '21:30' })).toBe(true);
  });

  it('does not count a different end time as the same slot', () => {
    expect(hasSameSlot([MON], { weekday: 1, startTime: '20:00' })).toBe(false);
    expect(hasSameSlot([MON], { weekday: 1, startTime: '20:00', endTime: '22:00' })).toBe(false);
  });

  it('does not count another weekday or another start as the same slot', () => {
    expect(hasSameSlot([MON], { weekday: 2, startTime: '20:00', endTime: '21:30' })).toBe(false);
    expect(hasSameSlot([MON], { weekday: 1, startTime: '18:00', endTime: '21:30' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @sahlykanta/shared -- test/schedule.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `packages/shared/src/schedule.ts`** with the Interfaces block's exports, and export it from `index.ts`

Three things the signatures do not determine:

- Display order is Monday first, so `orderSlots` sorts on `(weekday + 6) % 7` and then on `startTime`, a missing time sorting first. `slotsOn` filters and returns that order.
- `nextGameDay` walks forward with `addDays`. Seven steps are enough — with no validity windows, a non-empty schedule recurs every week — and an empty schedule returns `undefined` rather than walking anywhere.
- The `endTime > startTime` check is a `.refine` on `GameSlotInputSchema`; `HH:MM` compares correctly as a string. `GameSlotInputSchema` is a strict object in the sense that matters here: it declares three fields and no more, so a stray `validFrom` is dropped rather than carried.

- [ ] **Step 4: Remove `GAME_WEEKDAYS`, `isGameDay` and `nextGameDay` from `packages/shared/src/dates.ts`**, and the `isGameDay` / `nextGameDay` describe blocks from `packages/shared/test/dates.test.ts`

- [ ] **Step 5: Pass `DEFAULT_SCHEDULE` at the five call sites**

In `packages/api/src/app.ts`, every `isGameDay(date)` becomes `isGameDay(DEFAULT_SCHEDULE, date)` and every `nextGameDay(date)` becomes `nextGameDay(DEFAULT_SCHEDULE, date)`. `nextGameDay` can now be `undefined`, so line 87's spread and line 111's 409 body both become conditional on it — the `nextGameDate` field is already optional in `TodayResponseSchema`.

In `packages/web/src/pages/Today.tsx`, delete the local `GAME_WEEKDAYS` literal (line 9) and derive the week strip's highlighting from `DEFAULT_SCHEDULE` — Task 8 replaces it with the real schedule.

- [ ] **Step 6: Run the whole suite and the typecheck**

Run: `docker compose up -d && npm test && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/shared packages/api/src/app.ts packages/web/src/pages/Today.tsx
git commit -m "feat(shared): ask a schedule which days are playing days"
```

---

### Task 3: The settings partition

**Files:**
- Modify: `packages/api/src/table.ts` (keys and the header comment's key map), `packages/api/src/repo.ts`
- Test: `packages/api/test/table.test.ts`, `packages/api/test/repo.test.ts`

**Interfaces:**
- Consumes: `GameSlot`, `GameSlotInput` (Task 2), `newId` (`ids.ts`)
- Produces:
  - `table.ts`: `SETTINGS_PK = 'SETTINGS'`, `INITIALISED_SK = 'INITIALISED'`, `slotSk(id: string): string`, `settingSk(key: string): string`
  - `repo.ts`: `SlotNotFoundError`, and on `Repo` —
    `listSlots(): Promise<{ slots: GameSlot[]; initialised: boolean }>`,
    `createSlot(input: GameSlotInput): Promise<GameSlot>`,
    `deleteSlot(id: string): Promise<void>`

`listSlots` returns the marker alongside the slots because the two always travel together: every caller needs both to answer "what is the schedule", and they come from the one query.

- [ ] **Step 1: Write the failing key tests** in `packages/api/test/table.test.ts`

```ts
it('builds a slot sort key from its id', () => {
  expect(slotSk('abc')).toBe('SLOT#abc');
});

it('keeps a later scalar setting out of the slots', () => {
  expect(settingSk('jotain')).toBe('VALUE#jotain');
  expect(settingSk('jotain').startsWith('SLOT#')).toBe(false);
});
```

- [ ] **Step 2: Write the failing repo tests** in `packages/api/test/repo.test.ts`

```ts
describe('slots', () => {
  it('reports an untouched table as uninitialised, with no slots', async () => {
    expect(await repo.listSlots()).toEqual({ slots: [], initialised: false });
  });

  it('stores a slot and hands back its id', async () => {
    const slot = await repo.createSlot({ weekday: 1, startTime: '20:00', endTime: '21:30' });
    expect(slot.id).toMatch(/\S/);
    expect(await repo.listSlots()).toEqual({ slots: [{ ...slot }], initialised: true });
  });

  it('omits an end time that was not given', async () => {
    const slot = await repo.createSlot({ weekday: 3, startTime: '20:00' });
    expect(slot.endTime).toBeUndefined();
  });

  it('keeps two slots on the same weekday apart', async () => {
    await repo.createSlot({ weekday: 1, startTime: '18:00' });
    await repo.createSlot({ weekday: 1, startTime: '20:00' });
    expect((await repo.listSlots()).slots).toHaveLength(2);
  });

  it('never returns the marker as a slot', async () => {
    await repo.createSlot({ weekday: 1, startTime: '20:00' });
    // One slot written, two rows in the partition.
    const { slots } = await repo.listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].weekday).toBe(1);
  });

  it('removes a slot and leaves the table initialised', async () => {
    const slot = await repo.createSlot({ weekday: 1, startTime: '20:00' });
    await repo.deleteSlot(slot.id);
    expect(await repo.listSlots()).toEqual({ slots: [], initialised: true });
  });

  it('refuses to remove a slot that is not there', async () => {
    await expect(repo.deleteSlot('ei-ole')).rejects.toThrow(SlotNotFoundError);
  });
});
```

- [ ] **Step 3: Run both suites to verify they fail**

Run: `docker compose up -d && npm test -w @sahlykanta/api -- test/table.test.ts test/repo.test.ts`
Expected: FAIL — `slotSk` and `repo.listSlots` are not defined.

- [ ] **Step 4: Implement the keys in `table.ts` and the three methods in `repo.ts`**

Follow the announcement methods directly below them in the file: one `QueryCommand` on `PK = :pk` for the whole partition, a `PutCommand` per slot, and a `DeleteCommand` under a `ConditionExpression` of `attribute_exists(PK)` so a missing row raises rather than silently succeeding — unlike an announcement, a slot's sort key is its id, so no lookup is needed first. `createSlot` writes the marker row in the same call, a `PutCommand` with no condition, so a re-write is harmless. Add a `toSlot(item)` mapper beside `toAnnouncement`, spreading the optional `endTime` the way it does, and keep only items whose `SK` starts `SLOT#` so the marker is never fed to it. Extend `table.ts`'s header key map with the three `SETTINGS` rows.

- [ ] **Step 5: Run both suites to verify they pass**

Run: `npm test -w @sahlykanta/api -- test/table.test.ts test/repo.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/table.ts packages/api/src/repo.ts packages/api/test/table.test.ts packages/api/test/repo.test.ts
git commit -m "feat(api): keep the playing slots in a settings partition"
```

---

### Task 4: The schedule routes

**Files:**
- Modify: `packages/shared/src/turnstile.ts` (a third action), `packages/api/src/app.ts`
- Test: `packages/api/test/app.test.ts`

**Interfaces:**
- Consumes: `repo.listSlots`, `repo.createSlot`, `repo.deleteSlot`, `SlotNotFoundError` (Task 3); `GameSlotInputSchema`, `hasSameSlot`, `orderSlots` (Task 2)
- Produces: `TURNSTILE_ACTIONS.settings = 'settings'`; routes `GET /api/schedule`, `POST /api/schedule`, `DELETE /api/schedule/:id`

- [ ] **Step 1: Write the failing tests** in `packages/api/test/app.test.ts`

```ts
describe('GET /api/schedule', () => {
  it('is open, and empty before anything is stored', async () => {
    const res = await app.request('/api/schedule');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slots: [], initialised: false });
  });

  it('answers in display order, Monday first', async () => {
    await post('/api/schedule', { weekday: 6, startTime: '18:00' });
    await post('/api/schedule', { weekday: 1, startTime: '20:00' });
    const body = await (await app.request('/api/schedule')).json();
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
    expect((await post('/api/schedule', { weekday: 1, startTime: '20:00' })).status).toBe(403);
  });

  it('rejects a slot whose end is before its start', async () => {
    const res = await post('/api/schedule', { weekday: 1, startTime: '21:00', endTime: '20:00' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/pelivuoro/i);
  });

  it('refuses a slot that is already there', async () => {
    await post('/api/schedule', { weekday: 1, startTime: '20:00', endTime: '21:30' });
    const res = await post('/api/schedule', { weekday: 1, startTime: '20:00', endTime: '21:30' });
    expect(res.status).toBe(409);
    expect((await (await app.request('/api/schedule')).json()).slots).toHaveLength(1);
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
    const created = await (await post('/api/schedule', { weekday: 1, startTime: '20:00' })).json();
    expect((await del(`/api/schedule/${created.id}`)).status).toBe(204);
    expect((await (await app.request('/api/schedule')).json()).slots).toEqual([]);
  });

  it('answers 404 for a slot that is not there', async () => {
    expect((await del('/api/schedule/ei-ole')).status).toBe(404);
  });

  it('refuses an unverified caller', async () => {
    expect((await del('/api/schedule/mikä-vain')).status).toBe(403);
  });
});
```

Reuse whatever helpers the suite already has for a verified POST, a verified DELETE and the refusing-verifier app; `test/app.test.ts` sets these up for the announcement routes.

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm test -w @sahlykanta/api -- test/app.test.ts`
Expected: FAIL — 404 from every `/api/schedule` request.

- [ ] **Step 3: Add `settings: 'settings'` to `TURNSTILE_ACTIONS`** in `packages/shared/src/turnstile.ts`, and extend the comment above it: a third surface, a third widget, a token that is not transferable to the other two

- [ ] **Step 4: Implement the three routes in `packages/api/src/app.ts`**, directly below the announcement routes

Copy their shape: `verified(c, TURNSTILE_ACTIONS.settings, raw)` first, then `GameSlotInputSchema.safeParse`, then the repo call. `GET` returns the stored slots through `orderSlots` with `initialised` beside them, and sets no cache header — only the management page reads this route; the landing page gets the schedule from `/api/today`. `POST` reads the partition before writing and answers 409 `'pelivuoro on jo listalla'` when `hasSameSlot` says so, next to the registrations' `'nimi on jo listalla'`; the invalid-slot message is `'pelivuoro on virheellinen'`. Carry a comment saying what the trust model is, as the announcement block above does.

- [ ] **Step 5: Run the suite to verify it passes**

Run: `npm test -w @sahlykanta/api -- test/app.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/turnstile.ts packages/api/src/app.ts packages/api/test/app.test.ts
git commit -m "feat(api): add, read and remove playing slots over HTTP"
```

---

### Task 5: The day's response carries the schedule

**Files:**
- Modify: `packages/shared/src/schemas.ts` (`TodayResponseSchema`), `packages/api/src/app.ts`
- Test: `packages/api/test/app.test.ts`, `packages/shared/test/schemas.test.ts`, and the `TodayResponse` fixtures in `packages/web/test/app.test.tsx:51,62`, `packages/web/test/retro.test.tsx:63,79`, `packages/web/test/notices.test.tsx:20`

**Interfaces:**
- Consumes: `effectiveSchedule`, `orderSlots`, `isGameDay`, `nextGameDay` (Task 2); `repo.listSlots` (Task 3)
- Produces: `TodayResponse` gains `schedule: GameSlot[]` — every slot in force, any weekday, in display order

One field, not two: with no validity windows, the slots for the next playing day are a weekday filter on the same list, which the browser does with `slotsOn`.

- [ ] **Step 1: Write the failing tests** in `packages/api/test/app.test.ts`

```ts
describe('GET /api/today, with a stored schedule', () => {
  it('falls back to Monday, Wednesday and Saturday while nothing is stored', async () => {
    // The clock is pinned to Monday 19.10.2026.
    const body = await (await app.request('/api/today')).json();
    expect(body.isGameDay).toBe(true);
    expect(body.schedule.map((s) => s.weekday)).toEqual([1, 3, 6]);
  });

  it('carries every stored slot, in Monday-first order', async () => {
    await post('/api/schedule', { weekday: 4, startTime: '19:00' });
    await post('/api/schedule', { weekday: 1, startTime: '20:00', endTime: '21:30' });
    const body = await (await app.request('/api/today')).json();
    expect(body.schedule.map((s) => s.weekday)).toEqual([1, 4]);
  });

  it('follows the stored schedule rather than the old rule', async () => {
    await post('/api/schedule', { weekday: 4, startTime: '19:00' });
    const body = await (await app.request('/api/today')).json();
    // Monday, but Thursday is the only slot now.
    expect(body.isGameDay).toBe(false);
    expect(body.nextGameDate).toBe('2026-10-22');
  });

  it('is a playing day the moment a slot for it is saved', async () => {
    await post('/api/schedule', { weekday: 1, startTime: '20:00' });
    const body = await (await app.request('/api/today')).json();
    expect(body.isGameDay).toBe(true);
    expect(body.registrations).toEqual([]);
  });

  it('offers no next playing day once every slot has been removed', async () => {
    const created = await (await post('/api/schedule', { weekday: 1, startTime: '20:00' })).json();
    await del(`/api/schedule/${created.id}`);
    const body = await (await app.request('/api/today')).json();
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
    expect((await res.json()).nextGameDate).toBe('2026-10-22');
  });

  it('accepts a registration on a day only the stored schedule plays', async () => {
    await post('/api/schedule', { weekday: 1, startTime: '20:00' });
    expect((await post('/api/registrations', { name: 'Testi', gameDate: '2026-10-19' })).status).toBe(201);
  });

  it('refuses a registration when the schedule is empty, with no day to offer', async () => {
    const created = await (await post('/api/schedule', { weekday: 4, startTime: '19:00' })).json();
    await del(`/api/schedule/${created.id}`);
    const res = await post('/api/registrations', { name: 'Testi', gameDate: '2026-10-19' });
    expect(res.status).toBe(409);
    expect(await res.json()).not.toHaveProperty('nextGameDate');
  });
});
```

- [ ] **Step 2: Write the failing schema test** in `packages/shared/test/schemas.test.ts`

```ts
it('requires the schedule on a day response', () => {
  const { schedule, ...withoutSchedule } = gameDayResponse;
  expect(TodayResponseSchema.safeParse(withoutSchedule).success).toBe(false);
});

it('accepts a day response whose slots carry no times', () => {
  const body = { ...gameDayResponse, schedule: [{ id: 'a', weekday: 1 }] };
  expect(TodayResponseSchema.safeParse(body).success).toBe(true);
});
```

- [ ] **Step 3: Run both suites to verify they fail**

Run: `npm test -w @sahlykanta/api -- test/app.test.ts && npm test -w @sahlykanta/shared -- test/schemas.test.ts`
Expected: FAIL — `body.schedule` is undefined and the schema accepts a response without it.

- [ ] **Step 4: Add `schedule` to `TodayResponseSchema`** in `packages/shared/src/schemas.ts`

Required, an array of `GameSlotSchema`. Comment that it is the whole schedule rather than today's slots: the "Pelivuorot" card draws all of it, and today's and the next playing day's times are both a weekday filter away.

- [ ] **Step 5: Read the schedule in `packages/api/src/app.ts`**

Add one helper beside `today()`:

```ts
const schedule = async (): Promise<readonly GameSlot[]> => {
  const { slots, initialised } = await repo.listSlots();
  return effectiveSchedule(slots, initialised);
};
```

`/api/today` awaits it in the existing `Promise.all`, then computes `isGameDay`, `nextGameDay` and `orderSlots(slots)` for the `schedule` field. The three write routes replace their `isGameDay(DEFAULT_SCHEDULE, date)` from Task 2 with the awaited schedule. `DEFAULT_SCHEDULE` is then imported nowhere in `app.ts`.

- [ ] **Step 6: Add `schedule: []` to the five web `TodayResponse` fixtures**

The game-day fixtures take the three default weekdays; the closed ones take whatever reads naturally with their `nextGameDate`. These only have to typecheck and satisfy the schema — Task 8 is where the web pages read the field.

- [ ] **Step 7: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/shared packages/api packages/web/test
git commit -m "feat(api): answer the day with the schedule it was decided by"
```

---

### Task 6: Finnish times

**Files:**
- Modify: `packages/web/src/lib/finnish.ts`
- Test: `packages/web/test/finnish.test.ts` (new)

**Interfaces:**
- Consumes: `GameSlot` (Task 2)
- Produces:
  - `finnishTime(hhmm: string): string` — `'20:00'` → `'20'`, `'21:30'` → `'21.30'`
  - `finnishTimeRange(start: string, end?: string): string` — `'klo 20–21.30'`
  - `slotTime(slot: GameSlot): string | undefined` — the range, or `undefined` when the slot carries no start

- [ ] **Step 1: Write the failing tests** in `packages/web/test/finnish.test.ts`

```ts
describe('finnishTime', () => {
  it('drops the minutes from a whole hour', () => {
    expect(finnishTime('20:00')).toBe('20');
  });

  it('separates the minutes with a period', () => {
    expect(finnishTime('21:30')).toBe('21.30');
  });

  it('keeps a leading zero off the hour', () => {
    expect(finnishTime('09:15')).toBe('9.15');
  });

  it('hands back anything it does not recognise', () => {
    expect(finnishTime('kahdeksalta')).toBe('kahdeksalta');
  });
});

describe('finnishTimeRange', () => {
  it('joins the two with an en dash', () => {
    expect(finnishTimeRange('20:00', '21:30')).toBe('klo 20–21.30');
  });

  it('is a single time when there is no end', () => {
    expect(finnishTimeRange('20:00')).toBe('klo 20');
  });
});

describe('slotTime', () => {
  it('is the slot’s range', () => {
    expect(slotTime({ id: 'a', weekday: 1, startTime: '20:00', endTime: '21:30' })).toBe('klo 20–21.30');
  });

  it('is nothing at all for a slot with no time', () => {
    expect(slotTime({ id: 'a', weekday: 1 })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @sahlykanta/web -- test/finnish.test.ts`
Expected: FAIL — the helpers are not exported.

- [ ] **Step 3: Implement the three helpers in `packages/web/src/lib/finnish.ts`**

The dash is U+2013. `finnishTime` returning its input unchanged when it is not `HH:MM` matches `finnishDate` directly above it, which does the same for a date it cannot split.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @sahlykanta/web -- test/finnish.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/finnish.ts packages/web/test/finnish.test.ts
git commit -m "feat(web): say a time the way Finnish says it"
```

---

### Task 7: The settings page

**Files:**
- Create: `packages/web/src/pages/Settings.tsx`
- Modify: `packages/web/src/lib/routes.ts`, `packages/web/src/lib/api.ts`, `packages/web/src/App.tsx`, `packages/web/src/theme.css`
- Test: `packages/web/test/settings.test.tsx` (new), `packages/web/test/api.test.ts`

**Interfaces:**
- Consumes: `GameSlot`, `GameSlotInput`, `orderSlots` (Task 2); `slotTime`, `weekdayName` (Task 6 / `finnish.ts`); `TURNSTILE_ACTIONS.settings` (Task 4)
- Produces:
  - `routes.ts`: `SETTINGS_PATH = '/asetukset'`
  - `api.ts`: `schedule(): Promise<{ slots: GameSlot[]; initialised: boolean }>`, `addSlot(input: GameSlotInput, turnstileToken: string): Promise<GameSlot>`, `removeSlot(id: string, turnstileToken: string): Promise<void>`
  - `Settings.tsx`: `Settings({ load, add, remove })`, with the same prop shape `Notices` has

- [ ] **Step 1: Write the failing page tests** in `packages/web/test/settings.test.tsx`

Mirror `packages/web/test/notices.test.tsx`, including however it stubs the Turnstile widget.

```ts
it('lists the stored slots, Monday first, with their times', async () => { /* 'Maanantai klo 20–21.30', 'Lauantai klo 18' */ });
it('says the fallback is in use when no slot has been stored', async () => { /* names maanantai, keskiviikko, lauantai */ });
it('says so when every slot has been removed', async () => { /* 'Yhtään pelivuoroa ei ole' */ });
it('adds a slot from the form', async () => { /* weekday + start + end -> add called with exactly those three */ });
it('leaves out an end time that was not filled in', async () => { /* add called without the key */ });
it('will not submit without a start time', async () => { /* the button is disabled */ });
it('shows the new slot in the list without a reload', async () => { /* add resolves -> load called again */ });
it('asks before removing, and removes on the second tap', async () => { /* Poista -> Poistetaanko? -> Kyllä */ });
it('leaves the slot alone when the question is cancelled', async () => { /* Peru */ });
it('waits for the bot check before enabling the form', async () => { /* 'Odotetaan varmistusta…' */ });
it('reports a refused duplicate without losing what was typed', async () => { /* add rejects with the 409 message */ });
```

- [ ] **Step 2: Write the failing client test** in `packages/web/test/api.test.ts`

```ts
it('sends the Turnstile token in the body when adding a slot', async () => { /* body carries cf-turnstile-response */ });
it('sends the Turnstile token in a header when removing a slot', async () => { /* a DELETE has no body */ });
it('escapes a slot id in the path', async () => { /* removeSlot('a/b') */ });
```

- [ ] **Step 3: Run both suites to verify they fail**

Run: `npm test -w @sahlykanta/web -- test/settings.test.tsx test/api.test.ts`
Expected: FAIL — neither the page nor the client methods exist.

- [ ] **Step 4: Add `SETTINGS_PATH` and the three client methods**

`routes.ts` gets the constant with a comment in the voice of `NOTICES_PATH`'s: an unlisted, speakable address, protecting the page from being stumbled into and nothing more. `api.ts` gets the three methods beside the announcement ones, the DELETE carrying its token in a header for the same reason.

- [ ] **Step 5: Implement `packages/web/src/pages/Settings.tsx`**

Take `pages/Notices.tsx` as the pattern and keep its structure: the `noindex` meta and the document title in a mount effect (title `Asetukset`), one load on mount, one Turnstile widget last on the page spent by both the add and the removals, `confirming` holding the id being asked about, `busy` / `error` / `token` / `attempt` / `failure` / `reload` exactly as they are there.

Two cards:

- **Pelivuoro** — the form: a weekday `<select>` labelled `Viikonpäivä` (options Monday-first, `weekdayName` capitalised), then `Alkaa` and `Päättyy` as `type="time"` inputs in a `.field__row`, then a `Lisää pelivuoro` button disabled while `startTime` is empty, a request is in flight, or no token has arrived. Under the button, the hint `Muutos on voimassa heti, ja näkyy heti etusivulla.` — that is the page's promise and the reason it carries no dates.
- **Pelivuorot** — the list in `orderSlots` order, each row `.notice-row` whose `.notice-row__text` is `{weekdayName(slot.weekday)} {slotTime(slot)}`, capitalised, with no second line: every stored slot is in force, so there is nothing to qualify. The `Poista` → `Poistetaanko?` / `Kyllä` / `Peru` sequence is `Notices.tsx`'s, unchanged.

When nothing has ever been stored (`initialised === false`), the list card says so and names the days in force, so the page is honest about where the current schedule comes from: `Pelivuoroja ei ole vielä asetettu. Käytössä: maanantai, keskiviikko, lauantai.` When it has been stored and is empty: `Yhtään pelivuoroa ei ole — tällä hetkellä ei pelata.`

- [ ] **Step 6: Wire the page into `packages/web/src/App.tsx`**

`View` gains `'settings'`; `viewFromPath` returns it for `SETTINGS_PATH`. The three places that currently test `view === 'notices'` — the day's fetch being skipped, the masthead's home link, the tab bar being hidden — become a single `const bare = view === 'notices' || view === 'settings'`, since both pages want the same treatment for the same reason. Update that comment block above `View` to say three unlisted pages, not one.

- [ ] **Step 7: Add the CSS** to `packages/web/src/theme.css`

A `.field__time` beside `.field__date` (same box, narrower), and a `.field__select` for the weekday. Note in a comment above the `.notice-row` family that it now serves both management lists — it is the same row, and a second copy under another name would drift.

- [ ] **Step 8: Run the web suite and the typecheck**

Run: `npm test -w @sahlykanta/web && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/web/src packages/web/test
git commit -m "feat(web): manage the playing slots from an unlisted settings page"
```

---

### Task 8: The time on the pages that show a playing date

**Files:**
- Modify: `packages/web/src/pages/Today.tsx:64-104,152-155`, `packages/web/src/pages/Retro.tsx:146-151`, `packages/web/src/theme.css`
- Test: `packages/web/test/app.test.tsx`, `packages/web/test/retro.test.tsx`

**Interfaces:**
- Consumes: `today.schedule` (Task 5); `slotsOn`, `orderSlots` (Task 2); `slotTime` (Task 6)

- [ ] **Step 1: Write the failing tests** in `packages/web/test/app.test.tsx`

```ts
it('shows tonight’s time after the date on the same line', async () => { /* '19.10.2026 klo 20–21.30' as one text node */ });
it('shows both times when two slots fall on the same evening', async () => { /* '19.10.2026 klo 18, klo 20' */ });
it('shows no time for a slot that carries none', async () => { /* the fallback schedule: date, no 'klo' */ });
it('shows the next playing day’s time beside its date', async () => { /* closed fixture, schedule carries that weekday */ });
it('draws the week strip from the schedule, not from Monday-Wednesday-Saturday', async () => { /* a Thursday-only schedule */ });
it('lists each slot under the strip with its weekday and time', async () => { /* 'Maanantai klo 20–21.30' */ });
it('offers no next playing day when the schedule is empty', async () => { /* no 'Seuraava pelipäivä' heading */ });
```

And in `packages/web/test/retro.test.tsx`:

```ts
it('says the time after the date in 2002 too', async () => { /* 'on pelipäivä' line carries 'klo 20' */ });
```

- [ ] **Step 2: Run both suites to verify they fail**

Run: `npm test -w @sahlykanta/web -- test/app.test.tsx test/retro.test.tsx`
Expected: FAIL — no time is rendered anywhere.

- [ ] **Step 3: Show the time in `packages/web/src/pages/Today.tsx`**

Five changes, all reading `today.schedule` instead of the `DEFAULT_SCHEDULE` Task 2 left there:

- The game-day card: the time follows the date **on the same line**, inside `.today__date`, as a `.today__time` span — `19.10.2026 klo 20–21.30`. It is the times of `slotsOn(today.schedule, today.date)` joined with `', '` (`19.10.2026 klo 18, klo 20`), and the span is left out entirely when no slot of that day carries a time.
- The closed card's `.closed__next`: the date followed by the time from `slotsOn(today.schedule, today.nextGameDate)`. The `Seuraava pelipäivä` heading and the hint under it render only when `nextGameDate` is defined — an empty schedule has no next playing day and must not leave a heading over nothing.
- The week strip: `isGame` comes from the weekdays present in `today.schedule`.
- Under the strip, one `.weekslots__row` per slot in `today.schedule`: the weekday name, capitalised, and `slotTime(slot)`. The card says `Pelivuoroja ei ole asetettu` when the schedule is empty.
- The card's heading changes from `Pelipäivät` to `Pelivuorot`: it lists slots with times now, not bare days. `aria-labelledby` and the `gamedays-title` id stay as they are.

- [ ] **Step 4: Show the time in `packages/web/src/pages/Retro.tsx`**

Append the time for today's slots to the `on pelipäivä` line, inside a `xspTextComputedField` span like the date's. 2002 had no en dash problem worth solving — `slotTime` is reused as-is.

- [ ] **Step 5: Add `.today__time` and the `.weekslots` pair** to `packages/web/src/theme.css`

`.today__time` is an inline span inside `.today__date`, so it inherits that line's size and weight — not bold, because the date it follows is not, and the day's card already has its shout in the weekday heading. It carries only a colour (`--accent-ink`) to be findable in the line. (The closed card's next-playing-day time keeps the weight of the bold date it sits under.) `.weekslots__row` is a quiet two-column line, weekday left, time right, under the strip it belongs to.

- [ ] **Step 6: Run the web suite and the typecheck**

Run: `npm test -w @sahlykanta/web && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/web/src packages/web/test
git commit -m "feat(web): say what time we play, wherever the day is shown"
```

---

### Task 9: End to end

**Files:**
- Create: `e2e/settings.spec.ts`
- Modify: `e2e/seed.ts`, `e2e/smoke.spec.ts`, `e2e/closed.spec.ts`
- Test: the specs themselves

**Interfaces:**
- Consumes: everything above, through the real API and the built bundle

- [ ] **Step 1: Seed the real schedule** in `e2e/seed.ts`

Three slots through `repo.createSlot`, so the seeded table is initialised and carries times: Monday `20:00–21:30`, Wednesday `20:00–21:30`, Saturday `18:00–19:30`. Say in the comment that this replaces the Mon/Wed/Sat fallback with the same three days, now with times, so the existing specs still find their game day.

- [ ] **Step 2: Write the failing spec** in `e2e/settings.spec.ts`

Mirror `e2e/notices.spec.ts`, serial, cleaning up what it creates.

```ts
test('nothing on the app links to the settings page', async ({ page }) => { /* hrefs still ['/', '/peliaktiivisuus'] */ });
test('the mark at the top leads back to the registration page', async ({ page }) => { /* as the notices spec does */ });
test('the page opens for anyone who knows the address', async ({ page }) => { /* 'Pelivuorot' region visible */ });
test('the seeded slots are listed with their times', async ({ page }) => { /* 'Maanantai klo 20–21.30' */ });
test('a slot added on the page is live on the front page at once', async ({ page }) => {
  // Add Monday 07:15–08:45, reload '/', expect 'klo 7.15–8.45' on the day's
  // card beside the seeded 'klo 20–21.30', then remove it again.
});
test('a slot removed on the page is gone from the front page', async ({ page }) => { /* add, remove, reload, absent */ });
test('removing a slot asks first', async ({ page }) => { /* Poista -> Poistetaanko? -> Peru, still there */ });
```

- [ ] **Step 3: Add the time to the two existing assertions**

`e2e/smoke.spec.ts` asserts the day's card; `e2e/closed.spec.ts:11` asserts `21.10.2026` as the next playing day. Both now carry a time from the seed.

- [ ] **Step 4: Run the end-to-end suite**

Run: `docker compose up -d && npm run e2e`
Expected: PASS, all specs.

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint && npm run e2e`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add e2e
git commit -m "test(e2e): drive the settings page against the real API"
```

---

### Task 10: The runbook

**Files:**
- Modify: `docs/runbook.md`, `README.md`

- [ ] **Step 1: Write the entry**

In `docs/runbook.md`, how to change the schedule: open `/asetukset`, that a saved slot is in force immediately, that removing every slot closes registration entirely, and that an untouched installation plays Mon/Wed/Sat with no times until the first save. In `README.md`, add `/asetukset` wherever `/tiedotteet` is already named.

- [ ] **Step 2: Commit**

```bash
git add docs/runbook.md README.md
git commit -m "docs: how to change the playing slots"
```
