import { parseViewId } from './parse.js';

/**
 * The only page this tool is allowed to touch.
 *
 * `peliaktiivisuus.xsp` renders a read-only view panel: its form holds nothing
 * but XPages state fields, so driving it cannot write anything. `pelit.xsp`,
 * by contrast, carries the "Ilmoittaudu tästä" button — a POST there would
 * create a real registration on a live system that other people depend on.
 * The guard below is the reason that can never happen by accident.
 */
export const ACTIVITY_PAGE = 'peliaktiivisuus.xsp';

/** The partial-refresh target for the view panel; constant for this page. */
export const EXEC_ID = 'view:_id1:_id2:callback2:viewPanel1_OUTER_TABLE';

/** The XPages form id on this page. */
const FORM_ID = 'view:_id1';

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface XspClientConfig {
  pageUrl: string;
  fetchImpl?: FetchImpl;
  /** Spacing between requests. The default is deliberately unhurried. */
  delayMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
}

export interface XspClient {
  open(): Promise<string>;
  submit(submitId: string): Promise<string>;
  viewId(): string;
  requestCount(): number;
}

export class RedirectRefusedError extends Error {
  constructor(status: number, location: string) {
    super(
      `refusing to follow an HTTP ${status} redirect to ${location}: ` +
        'the request is not re-sent anywhere this tool has not vetted',
    );
    this.name = 'RedirectRefusedError';
  }
}

export class ForbiddenPageError extends Error {
  constructor(pageUrl: string) {
    super(
      `refusing to drive ${pageUrl}: this tool only ever talks to ${ACTIVITY_PAGE}, ` +
        'because other pages in that database can create registrations',
    );
    this.name = 'ForbiddenPageError';
  }
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

export function createXspClient({
  pageUrl,
  fetchImpl = fetch,
  delayMs = 400,
  retryDelayMs = 1000,
  maxAttempts = 4,
}: XspClientConfig): XspClient {
  const parsed = new URL(pageUrl);
  if (!parsed.pathname.toLowerCase().endsWith(`/${ACTIVITY_PAGE}`)) {
    throw new ForbiddenPageError(pageUrl);
  }
  // Query strings carry Domino session ids we neither need nor want to echo.
  const endpoint = `${parsed.origin}${parsed.pathname}`;

  /** Cookie name -> value. A whole jar, not just whichever arrived first. */
  const cookies = new Map<string, string>();
  let viewId = '';
  let requests = 0;
  let lastRequestAt = 0;

  /**
   * Domino sets more than one cookie, and `headers.get('set-cookie')`
   * comma-joins them. Keeping only the first value silently discards the
   * SessionID the moment anything else is set, and a dropped session shows
   * up hours into an unattended walk as retry exhaustion.
   */
  function rememberCookies(response: Response): void {
    const raw: string[] =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : (response.headers.get('set-cookie')?.split(/,(?=[^;,]+=)/) ?? []);

    for (const entry of raw) {
      const pair = entry.split(';')[0]?.trim();
      if (pair === undefined || pair.length === 0) continue;
      const equals = pair.indexOf('=');
      if (equals <= 0) continue;
      cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
  }

  function cookieHeader(): string {
    return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async function request(init: RequestInit): Promise<string> {
    // Space requests out from the previous one rather than sleeping blindly,
    // so parsing time counts toward the delay.
    const since = Date.now() - lastRequestAt;
    if (requests > 0 && since < delayMs) await sleep(delayMs - since);

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const headers: Record<string, string> = {
          'accept-language': 'fi-FI,fi;q=0.9',
          ...((init.headers ?? {}) as Record<string, string>),
        };
        const jar = cookieHeader();
        if (jar.length > 0) headers.cookie = jar;

        const response = await fetchImpl(endpoint, {
          ...init,
          headers,
          // Never follow a redirect. A 307/308 preserves the method and body,
          // so a followed redirect would re-POST this multipart form to
          // wherever Domino points — and Domino does redirect on session
          // expiry. Not following it is how the page guard stays meaningful.
          redirect: 'manual',
        });
        requests += 1;
        lastRequestAt = Date.now();

        if (response.status >= 300 && response.status < 400) {
          // Not retryable: the session is gone or the app moved. Fail with
          // the destination so it is diagnosable.
          throw new RedirectRefusedError(
            response.status,
            response.headers.get('location') ?? '(no location header)',
          );
        }

        if (!response.ok) {
          lastError = new Error(`${endpoint} answered HTTP ${response.status}`);
        } else {
          rememberCookies(response);
          const html = await response.text();
          // Each response carries a fresh view state token; the next POST
          // must echo the newest one or Domino rejects it.
          try {
            viewId = parseViewId(html);
          } catch {
            // A partial response without view state leaves the previous token
            // in place; the caller will fail loudly if it is stale.
          }
          return html;
        }
      } catch (error) {
        // A refused redirect will not resolve itself by trying again.
        if (error instanceof RedirectRefusedError) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < maxAttempts) await sleep(retryDelayMs * attempt);
    }

    throw lastError ?? new Error(`${endpoint} could not be reached`);
  }

  return {
    async open() {
      return request({ method: 'GET' });
    },

    async submit(submitId: string) {
      if (viewId.length === 0) {
        throw new Error('call open() before submit(): there is no view state to post');
      }

      // The page's form is multipart/form-data; FormData makes fetch set the
      // boundary itself.
      const body = new FormData();
      body.set('$$viewid', viewId);
      body.set(FORM_ID, FORM_ID);
      body.set('$$xspsubmitid', submitId);
      body.set('$$xspexecid', EXEC_ID);
      body.set('$$xspsubmitvalue', '');
      body.set('$$xspsubmitscroll', '');

      return request({ method: 'POST', body });
    },

    viewId: () => viewId,
    requestCount: () => requests,
  };
}
