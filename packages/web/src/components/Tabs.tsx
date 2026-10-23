import { HISTORY_PATH } from '../lib/routes.js';

/**
 * The bottom tab bar: the day's list and the history.
 *
 * `notices` is deliberately absent — that page is unlisted and reached only by
 * typing its address, and it renders no tab bar of its own either.
 */
export type Tab = 'today' | 'history';

export function Tabs({
  active,
  onNavigate,
}: {
  active: Tab;
  onNavigate: (tab: Tab) => void;
}): React.ReactElement {
  const link = (tab: Tab, label: string, href: string) => (
    <a
      className="tabs__link"
      href={href}
      {...(active === tab ? { 'aria-current': 'page' as const } : {})}
      onClick={(event) => {
        // A real href keeps the link keyboard-navigable and shareable; the
        // handler only avoids a full reload.
        event.preventDefault();
        onNavigate(tab);
      }}
    >
      {label}
    </a>
  );

  return (
    <nav className="tabs" aria-label="Sivut">
      {link('today', 'Tänään', '/')}
      {link('history', 'Historia', HISTORY_PATH)}
    </nav>
  );
}
