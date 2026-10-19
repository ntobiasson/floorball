import { useCallback, useEffect, useState } from 'react';
import type { PlayerSummary, TodayResponse } from '@sahlykanta/shared';
import { api as defaultApi, type Api } from './lib/api.js';
import { BallMark } from './components/Graphics.js';
import { Today } from './pages/Today.js';
import { Notices } from './pages/Notices.js';
import { NOTICES_PATH } from './lib/routes.js';

/**
 * Two pages: the day's list, and the unlisted announcements page. Any other
 * address falls back to the day's list.
 *
 * There is no history page. The 25-year archive is still imported and stored
 * — that is the point of the migration — it is simply not surfaced here.
 */
type View = 'today' | 'notices';

function viewFromPath(pathname: string): View {
  return pathname.startsWith(NOTICES_PATH) ? 'notices' : 'today';
}

export function App({ api = defaultApi }: { api?: Api }): React.ReactElement {
  // Fixed for the life of the page: neither view links to the other.
  const [view] = useState<View>(() =>
    viewFromPath(typeof window === 'undefined' ? '/' : window.location.pathname),
  );
  const [today, setToday] = useState<TodayResponse | undefined>(undefined);
  const [directory, setDirectory] = useState<PlayerSummary[]>([]);
  const [fatal, setFatal] = useState<string | undefined>(undefined);

  const refreshToday = useCallback(async () => {
    setToday(await api.today());
  }, [api]);

  useEffect(() => {
    // The announcements page needs none of this, and loading it there would
    // only make the page slower to appear.
    if (view === 'notices') return;
    void (async () => {
      try {
        const [todayResult, directoryResult] = await Promise.all([api.today(), api.players()]);
        setToday(todayResult);
        setDirectory(directoryResult.players);
      } catch (cause) {
        setFatal(cause instanceof Error ? cause.message : 'Palvelua ei saatu yhteyttä.');
      }
    })();
  }, [api, view]);

  return (
    <div className="app">
      <header className="masthead">
        {view === 'notices' ? (
          // The announcements page is reached by typing its address, so it
          // needs a way back that does not depend on the browser's history.
          // A plain href, since the two pages share no state worth keeping.
          <a className="masthead__home" href="/" aria-label="Takaisin ilmoittautumiseen">
            <span className="masthead__mark">
              <BallMark />
            </span>
          </a>
        ) : (
          <span className="masthead__mark">
            <BallMark />
          </span>
        )}
        <span className="masthead__name">PELEILLE</span>
      </header>

      <main className="app__main">
        {view === 'notices' ? (
          <Notices
            load={api.allAnnouncements}
            add={api.addAnnouncement}
            remove={api.removeAnnouncement}
          />
        ) : fatal !== undefined ? (
          <p className="state" role="alert">
            {fatal}
          </p>
        ) : today === undefined ? (
          <p className="state">Haetaan…</p>
        ) : (
          <Today
            today={today}
            directory={directory}
            onRegister={async (name) => {
              await api.register(name, today.date);
              await refreshToday();
              // A brand-new player belongs in the directory immediately, so
              // the next person can pick the name from the suggestions.
              setDirectory((await api.players()).players);
            }}
            onUnregister={async (playerId) => {
              await api.unregister(playerId);
              await refreshToday();
            }}
          />
        )}
      </main>

    </div>
  );
}
