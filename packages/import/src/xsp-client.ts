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

  let cookie = '';
  let viewId = '';
  let requests = 0;
  let lastRequestAt = 0;

  function rememberCookie(response: Response): void {
    const header = response.headers.get('set-cookie');
    if (header === null) return;
    const first = header.split(';')[0];
    if (first !== undefined && first.length > 0) cookie = first;
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
        if (cookie.length > 0) headers.cookie = cookie;

        const response = await fetchImpl(endpoint, { ...init, headers });
        requests += 1;
        lastRequestAt = Date.now();

        if (!response.ok) {
          lastError = new Error(`${endpoint} answered HTTP ${response.status}`);
        } else {
          rememberCookie(response);
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
