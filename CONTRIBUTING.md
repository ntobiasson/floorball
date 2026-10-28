# Contributing

This is a small project that runs one floorball team's registration page. It
is open source because the problem — rescuing 25 years of data off a dying
Lotus Domino server and replacing the app on top of it — turned out to be
generally interesting, not because it needs a team. Issues and pull requests
are welcome; nobody is owed a fast review.

## Before a large change

Open an issue first. The design is written down in
`docs/superpowers/specs/2026-10-19-sahlykanta-design.md`, including the
non-goals and the anti-goals — things that would make this a failure even if
they worked. Reading that will save you building something that gets declined:
accounts, future-date registration, waiting lists and player caps are all
deliberate omissions, not gaps.

Small fixes — a bug, a test, a typo, a dependency bump — need no issue.

## Getting it running

Node 24 (see `.nvmrc`) and Docker.

```sh
npm ci
docker compose up -d      # DynamoDB Local on port 8001
```

`README.md` has the rest: seeding the local table, running the API and the
SPA, and the `FAKE_TODAY` trick for reaching the registration form on a day
that is not Monday, Wednesday or Saturday. Turnstile needs no setup locally —
the dev server uses Cloudflare's published testing keys.

## What has to pass

```sh
npm run lint
npm run typecheck
npm test                  # needs docker compose up
npm run e2e               # Playwright; starts its own servers
```

CI runs the first three on every branch and every pull request. Run them
before pushing.

## House style

- **Tests first.** Everything here was built that way: a failing test, then
  the code that passes it. A pull request that changes behaviour without a
  test that would have caught the old behaviour will be sent back.
- **Comments say why, not what.** The existing ones explain the reasoning
  behind a choice — why the delay has a floor, why `index.html` must not be
  cached, why the limit is validated rather than coerced. Match that. Don't
  narrate the code.
- `npm run format` before committing (Prettier, settings in
  `.prettierrc.json`).
- Dates and the game-day rule are Europe/Helsinki, always. A UTC-based date
  implementation is a named anti-goal — it breaks Saturday registrations after
  02:00 in summer, and the deploy smoke test asserts against it.

## Two things not to commit

- **Harvested player data.** `packages/import/out/` holds real names and real
  attendance dates. It is gitignored, and a CI job fails the build if anything
  under it is ever tracked. Don't work around either. Test fixtures use
  invented names — `e2e/seed.ts` generates its sample, and the names in the
  Playwright specs are Finnish filler.
- **Credentials.** There are none in this repository and there is no reason to
  add any. Deploys use GitHub OIDC; the Turnstile secret lives in AWS Secrets
  Manager. The only key in the repo is a Turnstile _sitekey_, which is public
  by definition.

See `SECURITY.md` for the threat model and how to report something privately.
