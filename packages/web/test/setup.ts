import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';
import type { TurnstileApi, TurnstileRenderOptions } from '../src/lib/turnstile.js';

/**
 * Turnstile, under jsdom.
 *
 * The real widget is an iframe served by Cloudflare: jsdom will not load it
 * and nothing here could solve it. So the browser's side of the contract is
 * stood in for — render hands a token straight back, as a managed widget does
 * without interaction, and reset hands over another. The component being
 * tested is the real one; `loadTurnstile` finds `window.turnstile` already
 * present and uses it as it would the real script's.
 *
 * Installed fresh for every test, because the widget ids and the spies are
 * asserted on.
 */
export const TEST_TURNSTILE_TOKEN = 'test-turnstile-token';

beforeEach(() => {
  let widgets = 0;

  const turnstile: TurnstileApi = {
    render: vi.fn((_host: HTMLElement, options: TurnstileRenderOptions) => {
      const id = `test-widget-${(widgets += 1)}`;
      // A microtask, not synchronously: the real callback never fires inside
      // the render call, and a component that assumed it did would pass here
      // and fail in a browser.
      queueMicrotask(() => options.callback?.(TEST_TURNSTILE_TOKEN));
      return id;
    }),
    reset: vi.fn(() => undefined),
    remove: vi.fn(() => undefined),
  };

  window.turnstile = turnstile;
});
