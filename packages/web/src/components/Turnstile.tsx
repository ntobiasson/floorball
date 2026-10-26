import { useEffect, useRef } from 'react';
import type { TurnstileAction } from '@sahlykanta/shared';
import { TURNSTILE_SITEKEY, loadTurnstile } from '../lib/turnstile.js';

/**
 * The bot check that sits in front of a write. It identifies nobody — there
 * are still no accounts here — it only establishes that a person is filling
 * the form in rather than a script.
 *
 * Tokens are single-use: the API redeems each one exactly once, so the parent
 * bumps `resetKey` after every attempt to mint a fresh one. The widget itself
 * is rendered once and reset in place, because re-rendering it would make
 * Cloudflare issue a new challenge and visibly flicker the layout.
 *
 * It reports a failure up rather than drawing one itself. The page that owns
 * the token draws the message, beside the button the failure has disabled —
 * which is where somebody stuck is actually looking. See `reloadKey`.
 */
export function Turnstile({
  action,
  resetKey = 0,
  reloadKey = 0,
  onToken,
  onFailure,
}: {
  action: TurnstileAction;
  /** Incremented by the parent once a submission has consumed the token. */
  resetKey?: number;
  /**
   * Incremented by the parent to build the widget again from scratch, which
   * is what a retry after a failure needs: `reset` only works on a widget
   * that exists, and the failure may well have been the render itself.
   */
  reloadKey?: number;
  onToken: (token: string | undefined) => void;
  /**
   * Called with Cloudflare's error code, when it gave one. A widget that
   * could not be loaded at all reports `undefined` — there is no code,
   * because Cloudflare never got as far as issuing one.
   */
  onFailure?: (code: string | undefined) => void;
}): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const lastReset = useRef(resetKey);

  /**
   * Held in refs so that a parent re-render — which it does on every
   * keystroke in the name field — does not tear the widget down and build it
   * again.
   */
  const report = useRef(onToken);
  const reportFailure = useRef(onFailure);
  useEffect(() => {
    report.current = onToken;
  }, [onToken]);
  useEffect(() => {
    reportFailure.current = onFailure;
  }, [onFailure]);

  useEffect(() => {
    let abandoned = false;

    const fail = (code: string | undefined): void => {
      if (abandoned) return;
      // Logged as well as reported: the code names the cause, and whoever is
      // reading a console at 20:00 before a game is not the same person who
      // will read the screen.
      console.error('turnstile verification failed', code ?? '(no code)');
      report.current(undefined);
      reportFailure.current?.(code);
    };

    void (async () => {
      try {
        const turnstile = await loadTurnstile();
        if (abandoned || host.current === null) return;
        widgetId.current = turnstile.render(host.current, {
          sitekey: TURNSTILE_SITEKEY,
          action,
          callback: (token) => report.current(token),
          // A token expires after a few minutes. Someone who opened the page
          // and walked away must not submit a stale one and be refused.
          'expired-callback': () => report.current(undefined),
          'timeout-callback': () => report.current(undefined),
          'error-callback': (code) => fail(code),
        });
      } catch {
        fail(undefined);
      }
    })();

    return () => {
      abandoned = true;
      const id = widgetId.current;
      widgetId.current = undefined;
      if (id !== undefined) window.turnstile?.remove(id);
    };
  }, [action, reloadKey]);

  useEffect(() => {
    // Skipped on the first run: the widget has only just been built and the
    // token it is about to hand over is already fresh.
    if (lastReset.current === resetKey) return;
    lastReset.current = resetKey;

    const id = widgetId.current;
    if (id === undefined) return;
    window.turnstile?.reset(id);
    report.current(undefined);
  }, [resetKey]);

  return (
    <div className="turnstile">
      <div className="turnstile__widget" ref={host} />
    </div>
  );
}

/**
 * What a visitor sees when the check has failed: why they are stuck, and a
 * way out of it.
 *
 * This is drawn beside the button the failure has disabled rather than beside
 * the widget, which sits at the foot of the page as a footnote. A disabled
 * button under "Odotetaan varmistusta…" is a dead end if the verification is
 * never coming — the point of this is that there is always something to
 * press.
 */
export function TurnstileFailure({
  code,
  onRetry,
}: {
  /** Cloudflare's code, when it gave one. Shown so a report can name it. */
  code: string | undefined;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <>
      <p className="field__error" role="alert">
        Varmistusta ei saatu ladattua. Tarkista verkkoyhteys ja yritä uudelleen.
        {code !== undefined && ` (virhekoodi ${code})`}
      </p>
      <button className="button button--quiet" type="button" onClick={onRetry}>
        Yritä varmistusta uudelleen
      </button>
    </>
  );
}
