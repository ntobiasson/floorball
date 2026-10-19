# Runbook

## Before the first deploy

Nothing deploys until these four exist. The Deploy workflow checks for them
first and **skips** the deploy job when any is missing, so an unconfigured
repository gets a clean skip rather than a failed run; the skip names what is
absent in the run summary.

| Name | Kind | Example |
| --- | --- | --- |
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
./scripts/create-deploy-role.sh                 # prints the ARN to set
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
repository *and* one environment. A workflow on a branch, a pull request from
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

Re-running `./scripts/create-deploy-role.sh` refreshes the trust policy to
whatever GitHub currently sends.

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
announcement writes from any caller regardless of the page, and anyone can
already add or remove any name on the day's list. Nobody is identified
anywhere in this system.

If that stops being acceptable, the realistic options are a shared secret on
the write endpoints, or CloudFront with a signed cookie. Neither is in place.


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

Re-running after a *failed or partial* load is fine and expected. Player ids
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
returns the expected player count with matching totals. Note that the history
is not visible in the interface, so the API is the only way to check it — do
not take a working-looking app as evidence that the import succeeded. Compare that count
against `out/player-index.json`, which is the authoritative list read from the
collapsed Domino view. Keep the
`out/players.jsonl` and `out/registrations.jsonl` files somewhere durable —
they are the raw extraction, and once that server is gone they cannot be
produced again.
