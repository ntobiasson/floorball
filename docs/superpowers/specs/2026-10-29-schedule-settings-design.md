# Playing slots as a managed setting — design

**Date:** 2026-10-29

## Intent

The playing days are written into the code: `GAME_WEEKDAYS = [1, 3, 6]` in
`packages/shared/src/dates.ts`, repeated as a literal in `Today.tsx`. Changing
when this group plays means a commit and a deploy. Times are not in the
application at all — the week strip says "Ma Ke La" and everyone is expected to
know what time that means.

This moves the schedule out of the code and into the table, behind a management
page of the same kind as `/tiedotteet`, and makes the time visible everywhere a
playing date is shown.

The page is `/asetukset` rather than a schedule-only address, because the
schedule is the first of what may become several application settings. The
schedule is one card on it; a later setting is another card.

## Goals

- Add, change and remove playing slots — a weekday and a time — from a page,
  with no deploy.
- **A saved change is in force immediately and visible immediately.** The page
  shows the schedule as it is right now; the landing page shows the same thing
  on its next load. There is no third state between edited and live.
- Show the time wherever a playing date is shown.
- Leave room for further settings in the same partition and on the same page.

## Non-goals

- **Scheduling a change in advance.** No validity windows, no "shown from",
  no pending rows. A slot is either stored, and therefore live, or gone. This
  was considered — announcements carry exactly such a window — and dropped
  deliberately: a setting that is saved but not yet true is a second kind of
  truth on the page, and the page's whole job is to say what is true now. A
  December change is made in December.
- **Per-date exceptions.** "No play on 24.12." and "Monday at 19 just this
  once" are not in this. A single changed evening is what `/tiedotteet` is for,
  and it is already there.
- **Authentication.** Unchanged, and deliberately: the address is unlisted,
  writes are gated on Turnstile, and nothing identifies the caller. The same
  trust model as announcements and as the day's list, where anyone can already
  add or remove any name. (See the comment at the head of `pages/Notices.tsx`.)
- **Venue, cost, pitch, or anything else about a slot.** A weekday, a start, an
  optional end.
- **Times in the archive.** `/peliaktiivisuus` lists dates somebody registered
  on, going back a quarter of a century. What time those games started is not
  recorded and inventing it would be a lie. Times appear where a *playing* date
  is shown — today, the next playing day, the schedule itself — and nowhere
  else.

## Anti-goals

Failure, even if it technically works:

- An empty `SETTINGS` partition stops the application working, or a first save
  that drops a slot takes the landing page down with it. The hardcoded
  Mon/Wed/Sat rule stays in the code as the schedule used when nothing is
  stored, so the application behaves exactly as it does today until somebody
  saves something, and never ends up with no answer to "when do we play".
- A wrong time on the landing page. The schedule that existed before this
  feature knew no times, so the fallback carries none and the page shows none
  for it — rather than a plausible invented 20:00.
- Deleting the last slot silently bringing Mon/Wed/Sat back. Removing every
  slot is a legitimate "we do not play at the moment"; it must not be
  indistinguishable from an empty table.

That last one is the one real tension in the design, and it is settled with a
stored marker: the fallback applies only while the partition has never been
written. See *Fallback*, below.

## The decisions

### A slot

```
weekday     0–6, Sunday = 0 (the numbering `weekdayOf` already returns)
startTime   "HH:MM", 24-hour, Europe/Helsinki — optional in stored data,
            required on anything the form creates
endTime     "HH:MM", optional; must be later than startTime
```

That is the whole record. Times are strings in the Helsinki wall clock, for
exactly the reason dates already are (`dates.ts`): a `Date` carries no answer
to "what time is it here", and the answer must not depend on where the code
runs. Nothing converts a slot time to a `Date` anywhere.

`startTime` is optional in the schema that reads a slot and required in the
schema that creates one. That asymmetry is the same one `isGoalkeeper` already
has: the field is absent from data that predates it — here, the fallback
schedule — and present on everything written since.

Several slots may share a weekday: two groups on a Monday, an early and a late
turn. An **exact** duplicate — same weekday, same start, same end — is refused,
because it is never meant and it would show the same line on the landing page
twice.

### Fallback

`effectiveSchedule(slots, initialised)` answers "what is the schedule". While
the settings partition has never been written, it answers with the hardcoded
Mon/Wed/Sat (no times) and the application behaves as it does today. Once
anything has been saved, the stored slots are the whole answer — including
when they are an empty list, which means "we do not play at the moment".

The marker is one row in the same partition, written by the first save and
never removed.

### Storage

One partition in the existing single table. No infrastructure change.

```
SETTINGS / SLOT#<id>      one playing slot
SETTINGS / INITIALISED    the marker above
SETTINGS / VALUE#<key>    reserved: a later scalar setting
```

The partition holds a handful of rows and is fetched whole, so the sort key
buys no ordering worth encoding; display order (Monday first, then by time) is
decided in one shared function instead.

### API

Mirrors the announcement routes, including their trust model.

```
GET    /api/schedule        -> { slots, initialised }   open, as the landing page reads it too
POST   /api/schedule                                     Turnstile, action "settings"
DELETE /api/schedule/:id                                 Turnstile, token in a header
```

`GET /api/today` carries the schedule with it, so the landing page needs no
second request: one `schedule` field, every slot in force, in display order.
With no windows there is nothing date-dependent about it — the slots for today
and the slots for the next playing day are both a weekday filter away, done in
the browser from the same list.

`isGameDay` and `nextGameDay` stop being pure functions of the calendar and
take the schedule as their first argument. `nextGameDay` can now return
nothing — an empty schedule has no next playing day — and the response field it
feeds is already optional. The three write routes gate on `isGameDay` and so
read the schedule too; it is one query on a handful of rows, alongside the
announcement query the same route already makes.

### Where the time appears

- Today's card, under the date: `klo 20–21.30`.
- The closed card's next playing day, beside the date.
- The "Pelipäivät" card, retitled **Pelivuorot** — it now lists slots with
  times, not bare days. The week strip keeps its highlighting, now from the
  schedule, and under it goes one line per slot — `Maanantai klo 20–21.30`.
  The strip alone cannot hold a time in a 7-column grid, and it is worth
  keeping: it is the only thing on that card that reads at a glance.
- The 2002 easter egg's "tänään on pelipäivä" line, as plain text.

Finnish convention, which the app's own placeholder text already follows
("Kenttä varattu 21.10. klo 18–19."): `klo` before the time, a period for
minutes, and no `.00` on a whole hour. `20:00` reads `klo 20`; `21:30` reads
`klo 21.30`; a range is `klo 20–21.30` with an en dash.

### The page

`/asetukset`, titled **Asetukset**, `noindex`, no tab bar, the masthead mark as
the way back — the same treatment `/tiedotteet` gets, for the same reasons.

- **Pelivuoro** — the add form: weekday, `Alkaa`, optional `Päättyy`. Three
  controls, and a hint under the button saying the change is live at once.
- **Pelivuorot** — the list, in display order, each row `Maanantai klo 20–21.30`
  with a `Poista` that asks before it removes. Every row is in force; there is
  no expired or pending row to mark, which is the point of dropping the window.
- One Turnstile widget at the foot, spent by both adding and removing, exactly
  as on `/tiedotteet`.

The list reuses the `.notice-row` CSS family. It is the same row — text and
confirm-before-remove — and the alternative is a second copy of it under a
different name.

## Left to the builder

- Whether the week strip's slot lines live in `Today.tsx` or a small component
  of their own.
- The exact wording of validation errors, in Finnish, in the style of the ones
  already in `app.ts`.
- Whether `effectiveSchedule` reads the marker as a boolean or as the row.
