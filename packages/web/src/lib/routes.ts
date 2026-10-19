/**
 * Where the announcements page lives.
 *
 * Unguessable by design, and set through `VITE_NOTICES_PATH` so it can be
 * rotated at deploy time without a code change — if the address gets around
 * further than intended, change the variable and redeploy.
 *
 * What this buys, and what it does not: an address nobody can guess keeps the
 * page away from idle URL-poking and from crawlers. It is not a lock. This is
 * a client-rendered app, so the path is present in the JavaScript bundle and
 * anyone who opens devtools can read it — and in any case the API accepts
 * announcement writes from anyone who calls it directly, address or no
 * address. The address is a doorway nobody stumbles through, not a key.
 */

const DEFAULT_NOTICES_PATH = '/8q4f-2pda-vrsa';

function configured(): string | undefined {
  const value = import.meta.env?.VITE_NOTICES_PATH;
  return typeof value === 'string' && value.length > 1 ? value : undefined;
}

function normalise(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

export const NOTICES_PATH = normalise(configured() ?? DEFAULT_NOTICES_PATH);
