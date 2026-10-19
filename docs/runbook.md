# Runbook

## Before the first deploy

The announcement PIN is a shared secret held in SSM, never in this repository.
Pick a PIN, store its SHA-256:

```sh
PIN=<choose one>
aws ssm put-parameter \
  --name /sahlykanta/announcement-pin-hash \
  --type String \
  --value "$(printf %s "$PIN" | shasum -a 256 | cut -d' ' -f1)" \
  --region us-east-1
```

The API compares a submitted PIN's hash against this value in constant time.
**A deployment with no parameter rejects every announcement** rather than
leaving the endpoint open, so if announcements stop working, check this first.

Optionally set `IP_HASH_SALT` on the Lambda. The audit trail stores a salted
16-character fingerprint of the caller's address, never the address itself —
enough to see that twenty deletions came from one place, not enough to identify
a teammate. Rotating the salt makes older fingerprints incomparable with newer
ones.

Also create the Route 53 hosted zone and the deploy role (OIDC trust to this
repository) before the first run; `cdk deploy` assumes both exist.

## Importing the history out of Domino

Do this **before the Domino server is switched off**. There is no other copy of
this data.

### 1. Dry run

```sh
cd packages/import
npx tsx src/cli-scrape.ts --limit 5 --out ./out-dryrun
```

Expect five players and ~362 registrations in about three minutes. The known
figures are `Olli Salo` 2, `Olli Väänänen` 63, `Matti Virtanen` 278,
`Matti Virtanen (EHKÄ)` 1, `Sanna Peltola` 18. If the run fails with
`import checksum failed`, **stop** — the view changed shape and the parser
needs revisiting. Never load a harvest that failed its checksum.

### 2. Full walk

```sh
npx tsx src/cli-scrape.ts --out ./out
```

Roughly **2.5 hours** at the default 400 ms spacing, which is deliberate: this
is someone else's production server. Progress prints per player and is written
to `out/checkpoint.json` as it goes.

If it stops partway:

```sh
npx tsx src/cli-scrape.ts --out ./out --resume
```

A resumed run leaves the already-harvested players collapsed, so it pages past
them cheaply instead of re-expanding thousands of nodes.

### 3. The checksum is the gate

The walker compares, for every player and every year, the count Domino prints
against the number of date rows it harvested, and refuses to finish on any
mismatch. That check is the only thing standing between a quiet data loss and
a correct archive. It is not optional and there is no flag to skip it.

### 4. Load

```sh
TABLE_NAME=<the deployed table> npx tsx src/cli-load.ts --out ./out
```

Safe to re-run: player ids are read back from the existing `NAME#` lookup, so a
second load neither duplicates players nor orphans history. Totals and year
counts are recomputed from the rows being written, so they always agree with
the number of day rows.

Watch the output for merged names. Two Domino rows whose names fold to the same
match key — the same person typed two ways — become one player, and the
duplicate day rows are dropped. The load prints each group so the decision is
visible rather than silent.

### 5. Verify

```sh
aws dynamodb scan --table-name <table> --select COUNT
curl -s https://<domain>/api/players | jq '.players | length, (map(.total) | add)'
```

The sum of all player totals must equal the number of `DAY#` rows. Spot-check
`Matti Virtanen` at 278 and confirm 2026 shows 25.

## Merging two players

The import stays faithful to Domino, which means `Matti Virtanen (EHKÄ)` and
`Pekka Hämäläinen (mv)` arrive as their own players. Merging is deliberate and
not a one-liner, because DynamoDB has no `UPDATE ... JOIN`:

1. Rewrite every `DAY#<date>/PLAYER#<loser>` row to the winner's `playerId`,
   dropping any day where the winner is already present.
2. Recompute the winner's `total` and `YEAR#` counts from its day rows.
3. Set `mergedInto` on the loser's profile. `listPlayers` skips profiles that
   carry it, so the duplicate leaves the directory without its history being
   deleted.

Keep the loser's profile. It is what makes the merge reversible.

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
the rows back. The table's removal policy is `RETAIN`, so even
`cdk destroy` leaves the data behind.

## The budget alarm fired

It is set at 80% of a $10 month, which this app should never approach — expect
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
returns the expected player count with matching totals. Keep the
`out/players.jsonl` and `out/registrations.jsonl` files somewhere durable —
they are the raw extraction, and once that server is gone they cannot be
produced again.
