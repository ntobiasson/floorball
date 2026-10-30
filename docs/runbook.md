# Runbook

## Before the first deploy

Nothing deploys until these four exist. The Deploy workflow checks for them
first and **skips** the deploy job when any is missing, so an unconfigured
repository gets a clean skip rather than a failed run; the skip names what is
absent in the run summary.

| Name                  | Kind   | Example                                           |
| --------------------- | ------ | ------------------------------------------------- |
| `AWS_DEPLOY_ROLE_ARN` | secret | `arn:aws:iam::123456789012:role/floorball-deploy` |

```sh
gh secret set AWS_DEPLOY_ROLE_ARN --body 'arn:aws:iam::...:role/...'
```

The cost alarm is created separately and once, because AWS Budgets is a global
service that only exists in `us-east-1` while the stack is regional:

```sh
BUDGET_EMAIL=you@example.fi ./scripts/create-budget.sh
```

### The deploy role

Run these once, locally, with credentials that can create IAM roles:

```sh
npx cdk bootstrap aws://<account>/eu-north-1   # once per account and region
REPO=<owner>/<repo> ./scripts/create-deploy-role.sh    # prints the ARN
```

The order matters: the role works by assuming the roles `cdk bootstrap`
creates, so bootstrapping has to come first.

**The role holds almost no permissions of its own**, which is the point. The
CDK does its work through five roles that bootstrap already created
(`cdk-hnb659fds-{deploy,file-publishing,image-publishing,lookup,cfn-exec}-role-<account>-<region>`),
and the deploy role's main grant is `sts:AssumeRole` on those. It never holds
CloudFormation or IAM powers itself. Beyond that it can write to the site
bucket and invalidate the distribution, because the workflow does those two
things directly rather than through the CDK, and read the bootstrap version
parameter.

**Nothing long-lived is created.** GitHub mints a short OIDC token per run and
AWS trades it for temporary credentials, so there is no access key to leak or
rotate. Trust is scoped to `repo:<owner>/<repo>:environment:production` — one
repository _and_ one environment. A workflow on a branch, a pull request from
a fork, or any other repository in your account cannot assume it.

**The subject claim is read from GitHub, not assembled from the names.**
GitHub does not always send the documented `repo:owner/name:environment:x`
form — this repository gets
`repo:owner@<ownerId>/name@<repoId>:environment:x`, with numeric ids embedded
so that deleting a repository and recreating it under the same name cannot
inherit its trust. A trust policy written against the names alone is rejected.

If assuming the role ever fails with **"Not authorized to perform
sts:AssumeRoleWithWebIdentity"**, the Actions log will not say why: it only
reports the refusal. CloudTrail holds the subject AWS actually saw, which is
how to find the mismatch in one step:

```sh
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-results 3 --region eu-north-1 \
  --query 'Events[].CloudTrailEvent' --output text | grep -o 'repo:[^"]*'
```

Re-running the script refreshes the trust policy to whatever GitHub currently
sends. `REPO` is required and has no default, so it cannot quietly point a
fork's role back at the upstream repository.

That scoping needs the environment to exist:

```sh
gh api -X PUT repos/ntobiasson/floorball/environments/production
```

If you would rather scope to a branch instead, change the `sub` condition to
`repo:<owner>/<repo>:ref:refs/heads/main` and drop `environment: production`
from the deploy job. The environment form is tighter, because an environment
can also carry required reviewers.

Optionally set `SAHLYKANTA_REGION` to move the stack off its `eu-north-1`
default. Do that before the first deploy, not after — the table is in the
region, and moving it later is a migration rather than a setting.

## Turnstile

Writing — registering a name, adding or removing an announcement, or changing
the playing schedule — carries a Cloudflare Turnstile token that the API
redeems before the handler runs. The
widget solves itself for an ordinary visitor; nobody is asked to click
anything, and nobody is identified. Reading is not gated, and neither is
removing a name from the day's list.

The sitekey is public and lives in `packages/web/.env.production`. The secret
does not go in this repository.

### Putting the secret in

The secret lives in Secrets Manager as **`prod/floorball/turnstile`**, in
`eu-north-1`. The stack _imports_ it and grants the Lambda
`GetSecretValue`/`DescribeSecret` on that one entry and nothing else.

It is deliberately not created by the stack. The value cannot come from
source control, so it is put in by hand — and if CloudFormation also owned
the resource it would refuse to adopt an entry that already existed, failing
the deploy. **The secret therefore has to exist before the first deploy.** If
it does not, cold starts still succeed and reads keep working; only the first
gated write fails, when the function tries to read it.

The name is a constant in `packages/infra/lib/sahlykanta-stack.ts`
(`TURNSTILE_SECRET_NAME`). Changing it there is the only place that matters.

**Store it as plaintext, not as a key/value pair.** The whole of
`SecretString` is sent to Cloudflare as the `secret` parameter — nothing
parses it as JSON — so a key/value entry arrives at siteverify as a literal
`{"...":"..."}` and every write comes back 403. The AWS console defaults to
the key/value editor; the Plaintext tab beside it is the one to use.

Copy the secret key from the Cloudflare dashboard (Turnstile → the widget →
Settings) and put it in without it passing through a shell argument, your
history, or this repository:

```sh
# First time only — create it. Paste at the prompt; nothing is echoed.
read -rs -p 'Turnstile secret: ' s && printf '%s' "$s" | \
  aws secretsmanager create-secret \
    --name prod/floorball/turnstile \
    --region eu-north-1 \
    --secret-string file:///dev/stdin
unset s

# Rotating it later is the same thing with put-secret-value.
read -rs -p 'Turnstile secret: ' s && printf '%s' "$s" | \
  aws secretsmanager put-secret-value \
    --secret-id prod/floorball/turnstile \
    --region eu-north-1 \
    --secret-string file:///dev/stdin
unset s
```

**Only when replacing a value that already worked** does the function need a
cold start: a successful read is cached for the life of an execution
environment. A read that _failed_ is not cached — `createSecretReader` clears
it so one throttled response cannot disable every write until the next cold
start — so a secret created after a `ResourceNotFoundException` is picked up
by the very next write, with nothing to restart.

To force one when rotating:

```sh
aws lambda update-function-configuration \
  --function-name <the ApiFn name> \
  --region eu-north-1 \
  --environment "Variables={TABLE_NAME=...,TURNSTILE_SECRET_ARN=...,TURNSTILE_HOSTNAMES=...,NODE_OPTIONS=--enable-source-maps}"
```

A redeploy does the same thing and is less error-prone than retyping the whole
environment.

### The widget's domain list must match the distribution

Turnstile reports the hostname the widget was solved on, and the API accepts
only the one in `TURNSTILE_HOSTNAMES` — which the stack sets to this
distribution's own `d<something>.cloudfront.net` name. **That name has to be
in the widget's domain list in the Cloudflare dashboard**, or the widget will
not render for visitors and every write will be refused.

Take the name from the `SiteDomain` output and add it there. Do not add
`localhost` or `127.0.0.1`: the Lambda refuses to start if either appears in
its allowlist, because a widget solved on somebody's own copy of the page
must not be good here. Local development does not need them — it uses
Cloudflare's testing keys instead.

### When writes start failing

| What you see                                                | What it means                                                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every write is 403, the widget renders                      | The secret is the wrong value — Cloudflare answered `invalid-input-secret`. Put the real one in; no cold start needed.                                               |
| Every write is 500, `ResourceNotFoundException` in the logs | `prod/floorball/turnstile` does not exist, or is in another region. The read in `secret.ts` throws before siteverify is ever called, so this is a 500 and not a 403. |
| The widget does not render at all                           | The distribution's hostname is missing from the widget's domain list.                                                                                                |
| Cold starts fail, the whole API 500s                        | `TURNSTILE_SECRET_ARN` or `TURNSTILE_HOSTNAMES` is unset, or the allowlist contains a local hostname. The function says which in its first log line.                 |
| `invalid-input-secret` in the logs                          | The value in Secrets Manager is not this widget's secret.                                                                                                            |
| Writes work for one person and not another                  | A token is single-use and expires in a few minutes. A page left open overnight mints a fresh one on its own; a replay does not.                                      |

## There is no custom domain

The app answers on the address CloudFront gives the distribution,
`https://d<something>.cloudfront.net`, with the certificate CloudFront
provides. The deploy prints it in the run summary, and `cdk deploy` reports
it as the `SiteUrl` output.

That means no hosted zone, no ACM certificate, no DNS records, nothing to
renew or validate, and no registrar bill. The cost is an unmemorable address,
which for a team that bookmarks it once is a fair trade.

**DuckDNS and similar free services cannot be used here**, which is worth
recording so nobody spends an evening on it. ACM validates a certificate with
a CNAME record, and DuckDNS only sets A, AAAA and TXT. Even with a certificate
in hand, pointing the name at CloudFront needs a CNAME or a Route 53 alias,
and an A record cannot do it because CloudFront has no fixed address. Both
halves fail independently.

Adding a real domain later is a small change: a hosted zone, a `Certificate`
in `us-east-1`, `domainNames` on the distribution and an alias record. The
commit that removed them is the guide.

Optionally set `IP_HASH_SALT` on the Lambda. The audit trail stores a salted
16-character fingerprint of the caller's address, never the address itself —
enough to see that twenty deletions came from one place, not enough to identify
a teammate. Rotating the salt makes older fingerprints incomparable with newer
ones.

## Announcements

Announcements are managed at `/tiedotteet`. Nothing in the application links
there, and the page asks not to be indexed, but the address is an obvious one:
treat the page as reachable by anyone who visits the site.

That is deliberate and consistent with the rest of the app — the API accepts
announcement writes from any caller who can solve a Turnstile challenge,
regardless of the page, and anyone can already add or remove any name on the
day's list. Nobody is identified anywhere in this system.

Turnstile changes who can write only in the sense of keeping scripts out: it
proves a person is there, not which person. If _that_ stops being acceptable
— if some people should manage announcements and others should not — the
realistic options are still a shared secret on the write surfaces, or
CloudFront with a signed cookie. Neither is in place.

## The playing schedule

The schedule — which weekdays the group plays, and at what time — is changed
at `/asetukset`. A saved slot is in force immediately: there is no validity
window and no pending state, and the next load of the landing page reflects
it.

Removing every slot does not revert to any default; it closes registration
entirely. Every day shows the "not a game day" screen and the API refuses
registrations, because an empty schedule means the group is not currently
playing, not that nobody has said otherwise.

An installation that has never had its schedule touched plays **Monday,
Wednesday and Saturday**, with no times, until the first save. That default
lives in the code, not in the table, and it stops applying the moment
anything is saved — including a save that leaves no slots at all.

Nothing in the application links to `/asetukset`, and the page asks not to be
indexed, but the address is an obvious one: treat the page as reachable by
anyone who visits the site, the same as `/tiedotteet`.

That is deliberate and consistent with the rest of the app — the API accepts
schedule writes from any caller who can solve a Turnstile challenge,
regardless of the page, and anyone can already add or remove any name on the
day's list or manage announcements. Nobody is identified anywhere in this
system.

Turnstile changes who can write only in the sense of keeping scripts out: it
proves a person is there, not which person. If _that_ stops being acceptable
— if some people should set the schedule and others should not — the
realistic options are still a shared secret on the write surfaces, or
CloudFront with a signed cookie. Neither is in place.

## Languages

The app speaks Finnish, English and Ukrainian. It reads the browser's
languages on load, takes the first one it has, and falls back to Finnish for
anything else — Swedish included. A `<select>` in the header overrides that,
and the choice is kept in `localStorage` under `peleille.locale`. Clearing
site data forgets it and the browser decides again.

To see another language without changing browser settings, set the key from
the console and reload:

```js
localStorage.setItem('peleille.locale', 'uk');
```

Nothing is per-language on the server. There are no translated URLs: the
addresses stay Finnish in every language, `/tiedotteet` and `/asetukset`
included, because they are meant to be speakable over the phone. The HTML
shell is served as Finnish and its `lang` is corrected in the browser once
the app knows better, so a crawler sees the Finnish page — which is what
this page is.

**What is not translated, and will not be.** Announcement bodies are free
text somebody typed, with no language recorded; a translated interface does
not touch them, so an announcement a teammate cannot read stays unreadable.
Writing it in two languages is the only fix, and that is a matter for
whoever posts it. Player names are names. The retro page at seven taps on
the mark is a reproduction of the 2002 Domino application and has exactly
one language, permanently — two of its images have Finnish rendered into the
pixels anyway.

**Changing or adding wording.** Everything the app says lives in
`packages/web/src/lib/i18n/`: `fi.ts` is the Finnish copy and also the
contract, and `en.ts` and `uk.ts` are checked against it at build time. A key
missing from one of them fails `npm run typecheck` rather than showing
`undefined` to somebody. Dates, times and the ordering of names come from
`Intl` via `packages/web/src/lib/format.ts`, so no weekday names or month
orders are written down anywhere.

The Ukrainian was drafted rather than written by a speaker. It is worth
having one read `uk.ts` — corrections belong in that file alone and need no
other change.

## Importing the history out of Domino

Do this **before the Domino server is switched off**. There is no other copy of
this data.

**Pick a day nobody is playing.** The old application stays in use throughout,
so a 2.5-hour walk is not a point-in-time snapshot: a registration made while
the walk is past that player is simply not captured, and a brand-new name is
inserted in sort order, shifting the view position of everyone after it. (The
walk is built for this — the completeness check matches on name, not position —
but the quieter the source, the less there is to reconcile afterwards.) A
Tuesday, Thursday, Friday or Sunday is ideal. Expect the figures below to have
crept up by then; that is the application working, not a fault.

### 1. Dry run

```sh
cd packages/import
# Required, no default: the activity view this walk reads.
export DOMINO_URL=http://<domino-host>/<db>.nsf/peliaktiivisuus.xsp

npx tsx src/cli-scrape.ts --limit 5 --out ./out-dryrun
```

Expect five players and a few hundred registrations in about three minutes.
Check the names and totals it prints against the live Peliaktiivisuus page.

The run begins by reading the collapsed player index — about 16 pages — and
caches it as `player-index.json`. As of 2026-10-19 that index holds **464
entries**, and it is the number to check the finished import against.

The last entry is `Not Categorized`. That is Domino's bucket for documents
whose category field is empty, not a person. Its row is kept so the
archive reconciles with Domino, and the scraper warns about it; decide
afterwards whether to delete that one player or leave it as a curiosity. The known
figures are `Olli Salo` 2, `Olli Väänänen` 63, `Matti Virtanen` 278,
`Matti Virtanen (EHKÄ)` 1, `Sanna Peltola` 18. If the run fails with
`import checksum failed`, **stop** — the view changed shape and the parser
needs revisiting. Never load a harvest that failed its checksum.

### 2. Full walk

```sh
npx tsx src/cli-scrape.ts --out ./out
```

Roughly **2.5 hours** at the default 400 ms spacing, which is deliberate: this
is someone else's production server. Progress prints per player, and both
output files plus `out/checkpoint.json` are written as each player completes —
so an interruption keeps every player already proved.

If it stops partway:

```sh
npx tsx src/cli-scrape.ts --out ./out --resume
```

A resumed run leaves the already-harvested players collapsed, so it pages past
them cheaply instead of re-expanding thousands of nodes.

### 3. The two checks that are the gate

**Per-player.** For every player and every year, the count Domino prints must
equal the number of date rows harvested. Enforced during the walk, and again
before loading.

**Global.** The set of players harvested must equal the set the collapsed
index lists. This one matters because the per-player checks are structurally
blind to it: a walk that stops early is perfectly self-consistent about
everything it did reach, so without the global check it would exit 0 having
silently dropped half the archive. The index is read before the sweep for
exactly this purpose.

Neither check is optional and there is no flag to skip either. If a run fails
with `import checksum failed`, **stop and investigate** — never load a harvest
that failed.

A run that dies with `import walk stalled` hit the guard against resubmitting
the same view node forever, which usually means the session went stale.
`--resume` is the right response.

### 4. Load

```sh
TABLE_NAME=<the deployed table> npx tsx src/cli-load.ts --out ./out
```

**Load before anyone starts using the app.** The loader overwrites each
player's `total` and year counts with the import's figures, so running it over
a table that already holds live registrations would drop those games from the
counts while their day rows stayed in the table. It refuses to do that: if any
player's stored total is already higher than the import's, the load aborts and
names them. `--force` overrides it, and should only be used by someone who
means to discard those games.

Re-running after a _failed or partial_ load is fine and expected. Player ids
are read back from the existing `NAME#` lookup, so a second load neither
duplicates players nor orphans history, and totals are recomputed from the rows
being written so they always agree with the number of day rows.

Watch the output for merged names. Two Domino rows whose names fold to the same
match key — the same person typed two ways — become one player, and the
duplicate day rows are dropped. The load prints each group so the decision is
visible rather than silent.

### 5. Verify

```sh
aws dynamodb scan --table-name <table> --select COUNT
curl -s https://<domain>/api/players | jq '.players | length, (map(.total) | add)'
jq 'length' out/player-index.json
```

Three things must line up:

1. The number of players loaded against `player-index.json` (464 as of
   2026-10-19). `/api/players` will report slightly fewer if any names folded
   to one match key — the load prints every such group — and it hides players
   with no games.
2. The sum of all player totals against the number of `DAY#` rows.
3. Spot-checks against the live Peliaktiivisuus page on the day. Pick two or
   three players — one with a large total, one whose last game was years ago —
   and confirm the figures match. No expected totals are recorded here on
   purpose: this repository holds no real player data, and the numbers keep
   moving until Domino is switched off.

## Indexing the registrations by player

Run once, after deploying the version that introduced it. Skip it and nothing
breaks: a player's own dates simply come back empty for every game written
before the change, which is all of them.

A registration is keyed `DAY#<iso> / PLAYER#<id>`, so the table answers "who
played on this date" and cannot answer the reverse. The reverse needs
`GSI1PK=PLAYER#<id>`, `GSI1SK=DAY#<iso>` on the same row, which the API and
the importer now write and which the rows already in the table lack.

```sh
export TABLE_NAME=sahlykanta-prod
export AWS_REGION=eu-north-1

npx tsx scripts/backfill-player-dates.ts --dry-run
npx tsx scripts/backfill-player-dates.ts
```

The dry run prints how many rows it would touch; that number should be the
number of registrations in the table, which `GET /api/history` totals.
Nothing else in the table is a `DAY#` row, and a row that already carries the
keys is skipped, so a second run writes nothing and costs one scan. It is
safe to run while the application is serving: each write is conditional on
the keys still being absent, so a registration made mid-run is never
overwritten.

It is a Scan, which reads the whole table once — a few thousand rows here,
well inside the free tier.

## Merging two players

The import stays faithful to Domino, which means `Matti Virtanen (EHKÄ)` and
`Pekka Hämäläinen (mv)` arrive as their own players. Merging is deliberate and
not a one-liner, because DynamoDB has no `UPDATE ... JOIN`:

1. Repoint the loser's name lookup: set `NAME#<loser's normalized name>`'s
   `playerId` to the winner. **Do this or the merge leaks.** The lookup is what
   live registrations resolve through, so leaving it alone means the next person
   typing the merged-away spelling creates a registration against a player that
   `listPlayers` hides — a row in the table, invisible in the directory, and the
   totals drift below the day-row count permanently. (The API also follows
   `mergedInto` one hop as a safety net, but do not rely on it.)
2. Rewrite every `DAY#<date>/PLAYER#<loser>` row to the winner's `playerId`,
   dropping any day where the winner is already present.
3. Recompute the winner's `total` and `YEAR#` counts from its day rows, and zero
   the loser's `total` and `YEAR#` items so a scan-based audit agrees.
4. Set `mergedInto` on the loser's profile. `listPlayers` skips profiles that
   carry it, so the duplicate leaves the directory without its history being
   deleted.

Keep the loser's profile. It is what makes the merge reversible. Never chain
merges — point every duplicate at the one surviving player, not at each other.

## Restoring from a backup

Point-in-time recovery is on, with a 35-day window. A restore creates a **new**
table; it never overwrites the live one.

```sh
aws dynamodb restore-table-to-point-in-time \
  --source-table-name <table> \
  --target-table-name <table>-restore \
  --restore-date-time 2026-10-19T06:00:00Z
```

Check the restored table, then repoint the Lambda's `TABLE_NAME` at it, or copy
the rows back.

The table's removal policy is `RETAIN`, so even `cdk destroy` leaves the data
behind — but note the trap: the table name is CloudFormation-generated, so a
redeploy after an accidental destroy creates a **new, empty** table while the
real data sits in an orphan. The app comes back working and blank. Recovery is
to find the orphaned table in the console and either repoint `TABLE_NAME` at it
or copy its rows across.

## The budget alarm fired

It is created by `scripts/create-budget.sh`, not by the stack, and set at 80%
of a $10 month, which this app should never approach — expect
around a euro, almost all of it the Route 53 hosted zone. If it fires, the
likely causes in order:

1. CloudFront egress from something hotlinking the distribution.
2. A loop in a client hammering `/api/today`. The HTTP API stage is throttled
   at 10 requests per second with a burst of 20; check the Lambda invocation
   count against that.
3. Someone left a restored table from a PITR exercise lying around. Restored
   tables are billed normally.

## Switching off Domino

Only after the full import has been loaded and verified, and `/api/players`
returns the expected player count with matching totals. Compare that count
against `out/player-index.json`, which is the authoritative list read from the
collapsed Domino view. The Peliaktiivisuus page is a quick sanity check — it
shows the span of years and every player's totals — but it reads the same
table through the same API, so it can only agree with what was loaded; only
`player-index.json` says what Domino held. Keep the
`out/players.jsonl` and `out/registrations.jsonl` files somewhere durable —
they are the raw extraction, and once that server is gone they cannot be
produced again.
