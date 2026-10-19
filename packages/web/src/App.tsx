import { useCallback, useEffect, useState } from 'react';
import type { PlayerSummary, TodayResponse } from '@sahlykanta/shared';
import { api as defaultApi, type Api } from './lib/api.js';
import { BallMark } from './components/Graphics.js';
import { Tabs, type Route } from './components/Tabs.js';
import { Today } from './pages/Today.js';
import { Activity } from './pages/Activity.js';
import { Notices } from './pages/Notices.js';

/**
 * The unlisted announcements page. Nothing links to it; knowing this address
 * is the only thing that gets you there.
 */
export const NOTICES_PATH = '/tiedotteet';

type View = Route | 'notices';

function viewFromPath(pathname: string): View {
  if (pathname.startsWith(NOTICES_PATH)) return 'notices';
  return pathname.startsWith('/peliaktiivisuus') ? 'activity' : 'today';
}

export function App({ api = defaultApi }: { api?: Api }): React.ReactElement {
  const [view, setView] = useState<View>(() =>
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

  const navigate = (next: Route): void => {
    setView(next);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', next === 'activity' ? '/peliaktiivisuus' : '/');
    }
  };

  return (
    <div className="app">
      <header className="masthead">
        <span className="masthead__mark">
          <BallMark />
        </span>
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
        ) : view === 'today' ? (
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
        ) : (
          <Activity directory={directory} loadPlayer={api.player} />
        )}
      </main>

      {view !== 'notices' && <Tabs active={view} onNavigate={navigate} />}
    </div>
  );
}
