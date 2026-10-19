# Peleille — design

Date: 2026-10-19

The application is called **Peleille**. It was referred to as Sählykanta
during design, after the Domino database it replaces (`sahlykanta.nsf`),
which is still the name of the package scope and the AWS resources.

## Intent and why

The team's floorball registration app runs on a Lotus Domino server
(`sofordmz1.sofor.fi`) that is old and no longer maintained, and will be switched off.
The app is small, but it holds **25 years of registration history** (2001–2026, ~500
distinct names, roughly 20k registrations) that exists nowhere else. The history must be
extracted through the public XPages UI before the server disappears, because nobody has
admin access to it.

The replacement runs on AWS, fully serverless and managed, so that the failure mode
driving this rebuild — an unmaintained host — cannot recur.

## Goals

- A mobile-first registration form. Registration is accepted on **Monday, Wednesday and
  Saturday** only, and only for the **current day**. Any other day shows a clear
  "not a game day" state.
- Open to everyone, no accounts. Anyone may register anyone, choosing from previously
  seen players or typing a new name. Anyone may remove any name, confirming once first:
  the chips sit close together on a phone and a removal has nothing to undo it.
- All historical registrations preserved, presented as a **Peliaktiivisuus** list of
  players with total game counts, searchable by name and expandable to a per-year
  breakdown.
- The **Tiedotteita / uutisia** announcements block carries over, with a way to write
  announcements.

## Non-goals

- The **Käyttöaste** utilization page is dropped.
- No accounts, login, email or push notifications.
- No registering for future dates, no waiting list, no player cap.
- No asset reused from the existing application.
- Cancelled game days are not modelled; a game day is purely Mon/Wed/Sat.

## Anti-goals

Things that would make this a failure even if it technically worked:

- Losing or silently corrupting any part of the 25-year history. The import carries a
  per-player checksum against the figure Domino reports, and fails loudly on mismatch.
- Writing a registration to the wrong date. "Today" is computed server-side in
  `Europe/Helsinki`; a UTC-based implementation breaks Saturday registrations after
  02:00 in summer.
- Touching the live Domino application in a way that creates data. The extraction drives
  `peliaktiivisuus.xsp`, which has no write controls; `pelit.xsp` is never POSTed to.
- Requiring anyone to maintain a server.

## Constraints

- AWS. TypeScript end to end. Mobile browsers are the primary client.
- No admin access to the Domino server: extraction is through the public UI only.
- The data is messy by nature — `Pekka N` vs `Pekka Nurmi`, `antti aalto`,
  `Matti Virtanen (EHKÄ)`. The import stays faithful to what Domino holds; tidying is a
  later, deliberate, reversible act.

## Decisions made by the user

- Stack: React + Vite SPA on S3 + CloudFront, Node 22 Lambda, DynamoDB, AWS CDK.
- Removal model: anyone can remove any name.
- Scope: announcements carry over; Käyttöaste does not.
- Visual direction: layout A ("Tänään-kortti") with imagery option 1 (pure SVG graphics).

## Decisions left to the builder

- Single-table DynamoDB key design and the transactional write path.
- Hono as the Lambda router; Zod as the shared schema layer.
- Client-side name search over a cached player directory.
- Test strategy and the structure of the extraction tool.

## Open questions

- The hostname the app should answer on.

## Decisions taken after the design was written

- Announcements are managed from an unlinked page at `/tiedotteet` rather than
  behind a shared PIN. The address was briefly randomised; the user chose the
  fixed, readable one instead, knowing it is guessable. In practice the page
  is open to anyone who visits, which matches the API — it accepts
  announcement writes from any caller either way.
- Removing a name from the day's list takes a confirmation.
- The application is named Peleille.
- **The history is no longer shown in the interface.** The Peliaktiivisuus
  page and its navigation were removed at the user's request. Importing and
  storing the archive is unchanged — that remains the point of the migration —
  and it is still readable through `GET /api/players` and
  `GET /api/players/:id`. The player directory is still fetched by the client,
  because the registration form suggests previously seen names from it, so
  names and totals remain publicly readable from the API.
