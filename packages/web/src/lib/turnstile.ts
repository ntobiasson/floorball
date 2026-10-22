/**
 * Loading Cloudflare's Turnstile script, once per page.
 *
 * The widget is rendered explicitly rather than by scanning the document for
 * `.cf-turnstile` elements: this is a single-page application, the forms come
 * and go, and an explicit render is the only way to hold on to a widget's id
 * and reset it between submissions. A token is good for one submission.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Public by nature — it is in the page source on every visit. The value comes
 * from `.env.production` for a build and `.env.development` for the dev
 * server, which uses Cloudflare's testing key because the real widget is
 * registered for the deployed hostname only.
 */
export const TURNSTILE_SITEKEY: string = import.meta.env.VITE_TURNSTILE_SITEKEY ?? '';

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  'error-callback'?: () => void;
}

export interface TurnstileApi {
  render: (host: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let pending: Promise<TurnstileApi> | undefined;

export function loadTurnstile(): Promise<TurnstileApi> {
  // Already present: either a previous mount loaded the script, or the tests
  // installed a stand-in for it.
  const existing = window.turnstile;
  if (existing !== undefined) return Promise.resolve(existing);

  pending ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      const api = window.turnstile;
      if (api === undefined) {
        reject(new Error('the Turnstile script loaded without defining turnstile'));
        return;
      }
      resolve(api);
    });
    script.addEventListener('error', () =>
      reject(new Error('the Turnstile script could not be loaded')),
    );
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // A blocked request or a dropped connection should not disable the form
    // for the rest of the visit, so the next mount is allowed to try again.
    pending = undefined;
    throw error;
  });

  return pending;
}
