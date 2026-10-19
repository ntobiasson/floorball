# Sählykanta

Online registration for the team's floorball sessions, plus 25 years of play
history. Replaces an application that ran on an unmaintained Lotus Domino
server.

- **Registration** is open on **Monday, Wednesday and Saturday**, and only for
  the current day. Any other day shows a "not a game day" screen.
- **No accounts.** Anyone can register anyone, by picking a previous player or
  typing a new name, and anyone can remove a name.
- **Peliaktiivisuus** lists every player with their total game count,
  searchable by name and expandable to a per-year breakdown.

## Stack

TypeScript throughout. React + Vite for the SPA, a single Node 22 Lambda
running Hono for the API, DynamoDB for storage, and one CloudFront
distribution in front of both so there is no CORS anywhere. All infrastructure
is AWS CDK.

| Package | What it is |
| --- | --- |
| `packages/shared` | Date rules, name normalization, Zod schemas. Consumed as TypeScript source. |
| `packages/api` | Hono routes and the DynamoDB repository. `handler.ts` is the Lambda entry; `serve.ts` is for local use only. |
| `packages/web` | The SPA. All imagery is inline SVG — no raster assets. |
| `packages/infra` | The CDK stack. |
| `packages/import` | One-off extraction of the history out of Domino. |
| `e2e` | Playwright smoke flow against a real API and DynamoDB. |

## Local development

Requires Node 22 (`.nvmrc`) and Docker.

```sh
npm ci
docker compose up -d          # DynamoDB Local on port 8001

# One terminal: the API, with today pinned to a Monday
TABLE_NAME=sahlykanta-e2e DYNAMODB_ENDPOINT=http://127.0.0.1:8001 \
  AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_REGION=eu-north-1 \
  FAKE_TODAY=2026-10-19 npm run serve -w @sahlykanta/api

# Another: the SPA
API_ORIGIN=http://127.0.0.1:3000 npm run dev -w @sahlykanta/web
```

`npx tsx e2e/seed.ts` creates the local table and fills it with a few real
players, which is the quickest way to get something on screen.

DynamoDB Local is published on **8001**, not the usual 8000, because 8000 is
so often already taken that a clash silently points the tests at another
server.

## Checks

```sh
npm run lint
npm run typecheck
npm test        # 237 unit and integration tests; needs docker compose up
npm run e2e     # Playwright, starts its own servers
```

`npm run typecheck` runs three passes: the root packages, then `packages/infra`
and `packages/web`, which need their own compiler settings (CDK's types are not
written for `exactOptionalPropertyTypes`; web needs JSX and the DOM lib).

## Importing the history from Domino

See [docs/runbook.md](docs/runbook.md). In short:

```sh
cd packages/import
npx tsx src/cli-scrape.ts --limit 5          # always dry-run first
npx tsx src/cli-scrape.ts                    # the full walk, ~2.5 hours
npx tsx src/cli-scrape.ts --resume           # after an interruption
TABLE_NAME=<table> npx tsx src/cli-load.ts --out ./out
```

The scraper only ever talks to `peliaktiivisuus.xsp`, which has no write
controls. It refuses any other URL by construction, and it refuses to follow
redirects, because a POST to `pelit.xsp` would create a real registration on
the live system.

Both output files are written as each player completes, so an interruption
keeps what it had already proved. Correctness rests on two checks: per-player
counts against what Domino prints, and the harvested player set against the
collapsed index — the second because the first cannot see a player the walk
never reached. **Load before anyone starts using the app**; the loader refuses
to overwrite totals that live registrations have already moved.

## Deploying

Pushing to `main` deploys via GitHub Actions using OIDC — there are no AWS keys
in this repository. The workflow needs these repository variables and secret:

| Name | Kind | Example |
| --- | --- | --- |
| `SAHLYKANTA_DOMAIN` | variable | `sahly.example.fi` |
| `SAHLYKANTA_HOSTED_ZONE_ID` | variable | `Z0123456789ABCDEFGHIJ` |
| `SAHLYKANTA_BUDGET_EMAIL` | variable | `ops@example.fi` |
| `AWS_DEPLOY_ROLE_ARN` | secret | `arn:aws:iam::123456789012:role/sahlykanta-deploy` |

The stack lives in `us-east-1` because CloudFront only accepts ACM
certificates from there, and keeping the certificate with everything else
avoids a second cross-region stack. At this traffic every service stays inside
the free tier; a budget alarm covers the rest.

Before the first deploy, create the announcement PIN parameter — see the
runbook.
