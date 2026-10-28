# Security

## Reporting something

Use GitHub's private vulnerability reporting: **Security → Report a
vulnerability** on this repository. That keeps the report private until there
is a fix. Please don't open a public issue for anything exploitable.

This is a hobby project run for one floorball team by one person. Expect a
reply within a week or so, not within hours.

## What is deliberately open

Several things that look like vulnerabilities are the design, documented here
so they don't have to be rediscovered and reported each time. The application
replaced a Lotus Domino app that had no accounts either, for a group of people
who already know each other and share a gym booking.

- **There is no authentication anywhere.** No accounts, no login, no password,
  no PIN. This is a named goal in `docs/superpowers/specs/`, not an omission.
- **Anyone can register anyone.** You pick a previous player or type a name.
  There is no proof that you are that person.
- **Anyone can remove any name.** A single confirmation, no undo.
- **The announcements page is unlisted, not protected.** `/tiedotteet` is
  linked from nowhere, but the address is guessable and anyone who visits it
  can write and delete announcements. "Unlisted" is the only barrier and is
  not treated as a security control.
- **Cloudflare Turnstile gates writes, not people.** The three write endpoints
  redeem a Turnstile token before the handler runs. It keeps scripts out. It
  identifies nobody, and it is not authorization.
- **The Turnstile sitekey in `packages/web/.env.production` is public by
  design.** A sitekey appears in the page source on every visit. The secret it
  pairs with is in AWS Secrets Manager and is not in this repository.

Reports that amount to "there is no login" or "the sitekey is committed" will
be closed with a link to this section.

## What is in scope

Worth reporting:

- A way to read or modify data that the UI does not already permit — for
  example reaching DynamoDB items outside the documented access patterns, or
  getting the API to return another table's contents.
- Anything that bypasses the Turnstile check on the write endpoints.
- A way to make the API or CloudFront serve something it should not: an API
  path answering with the SPA shell and a 200, cache poisoning, injection into
  a rendered announcement.
- Anything that exposes the Turnstile secret, the deploy role, or the contents
  of Secrets Manager.
- Dependency vulnerabilities that are actually reachable from this code.

## Personal data

The deployed instance holds real people's names and, for the imported archive,
the dates they played going back to 2001. **None of that data is in this
repository** — the import output is gitignored and a CI job fails the build if
it is ever committed. The sample data in `e2e/seed.ts` is invented.

If you are in the archive and want your name removed, the app's own history
and registration pages let anyone remove a name, or open an issue and it will
be handled.
