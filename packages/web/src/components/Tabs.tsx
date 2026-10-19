export type Route = 'today' | 'activity';

export function Tabs({
  active,
  onNavigate,
}: {
  active: Route;
  onNavigate: (route: Route) => void;
}): React.ReactElement {
  const link = (route: Route, label: string, href: string) => (
    <a
      className="tabs__link"
      href={href}
      {...(active === route ? { 'aria-current': 'page' as const } : {})}
      onClick={(event) => {
        // A real href keeps the link keyboard-navigable and shareable; the
        // handler just avoids a full reload.
        event.preventDefault();
        onNavigate(route);
      }}
    >
      {label}
    </a>
  );

  return (
    <nav className="tabs" aria-label="Sivut">
      {link('today', 'Ilmoittautuminen', '/')}
      {link('activity', 'Peliaktiivisuus', '/peliaktiivisuus')}
    </nav>
  );
}
