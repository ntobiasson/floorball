# Peleille

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
docker compose up -d                       # DynamoDB Local on port 8001

# Create the table and fill it with a few real players.
TABLE_NAME=sahlykanta-local DYNAMODB_ENDPOINT=http://127.0.0.1:8001 \
  npx tsx e2e/seed.ts

# One terminal: the API.
TABLE_NAME=sahlykanta-local DYNAMODB_ENDPOINT=http://127.0.0.1:8001 \
  AWS_REGION=eu-north-1 AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
  PORT=3400 npm run serve -w @sahlykanta/api

# Another: the SPA. Open http://127.0.0.1:5273
API_ORIGIN=http://127.0.0.1:3400 npm run dev -w @sahlykanta/web -- --port 5273
```

Vite proxies `/api` to the API, mirroring the single CloudFront origin used in
production, so there is no CORS locally either.

The seed is a real `--limit 5` Domino harvest held in `e2e/fixtures/`: five
players and 363 registrations spanning 2001 to 2026, loaded through the
production loader. It is deliberately real rather than invented, because the
things worth seeing — a 25-year history, a player on 279 games beside one on
2, the `(EHKÄ)` duplicate, the Torstai games that predate the Mon/Wed/Sat
rule — are exactly what made-up rows smooth away. One of those registrations
falls on 19.10.2026, so the day's list does not start empty.

Add `FAKE_TODAY=2026-10-20` to the API's environment to see the
not-a-game-day screen without waiting for a Tuesday. It is read only by
`serve.ts`, which is never deployed.

**On ports.** DynamoDB Local is published on **8001** and these examples use
**3400** and **5273** rather than 8000/3000/5173, which are routinely occupied
on a development machine — and a clash there is quiet and confusing, because
the client happily talks to whatever is listening. Change them freely if they
are taken on yours.

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
