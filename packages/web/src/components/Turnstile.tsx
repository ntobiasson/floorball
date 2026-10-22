import { useEffect, useRef, useState } from 'react';
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
 */
export function Turnstile({
  action,
  resetKey = 0,
  onToken,
}: {
  action: TurnstileAction;
  /** Incremented by the parent once a submission has consumed the token. */
  resetKey?: number;
  onToken: (token: string | undefined) => void;
}): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const lastReset = useRef(resetKey);
  const [failed, setFailed] = useState(false);

  /**
   * Held in a ref so that a parent re-render — which it does on every
   * keystroke in the name field — does not tear the widget down and build it
   * again.
   */
  const report = useRef(onToken);
  useEffect(() => {
    report.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let abandoned = false;

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
          'error-callback': () => {
            report.current(undefined);
            setFailed(true);
          },
        });
      } catch {
        if (!abandoned) setFailed(true);
      }
    })();

    return () => {
      abandoned = true;
      const id = widgetId.current;
      widgetId.current = undefined;
      if (id !== undefined) window.turnstile?.remove(id);
    };
  }, [action]);

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
      {failed && (
        <p className="field__error" role="alert">
          Varmistusta ei saatu ladattua. Tarkista verkkoyhteys ja päivitä sivu.
        </p>
      )}
    </div>
  );
}
