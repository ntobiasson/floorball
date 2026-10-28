import { useCallback, useEffect, useState } from 'react';
import type { PlayerDetail, PlayerSummary, TodayResponse } from '@sahlykanta/shared';
import { api as defaultApi, type Api } from './lib/api.js';
import { BallMark } from './components/Graphics.js';
import { Tabs, type Tab } from './components/Tabs.js';
import { Today } from './pages/Today.js';
import { History } from './pages/History.js';
import { Notices } from './pages/Notices.js';
import { HISTORY_PATH, NOTICES_PATH } from './lib/routes.js';

/**
 * Three pages: the day's list, the history, and the unlisted announcements
 * page. The first two are the tab bar; announcements is reached only by
 * typing its address and shows no tab bar at all. Any other address falls
 * back to the day's list.
 */
type View = Tab | 'notices';

function viewFromPath(pathname: string): View {
  if (pathname.startsWith(NOTICES_PATH)) return 'notices';
  if (pathname.startsWith(HISTORY_PATH)) return 'history';
  return 'today';
}

const currentPath = (): string => (typeof window === 'undefined' ? '/' : window.location.pathname);

export function App({ api = defaultApi }: { api?: Api }): React.ReactElement {
  const [view, setView] = useState<View>(() => viewFromPath(currentPath()));
  const [today, setToday] = useState<TodayResponse | undefined>(undefined);
  const [directory, setDirectory] = useState<PlayerSummary[]>([]);
  const [fatal, setFatal] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<PlayerDetail[] | undefined>(undefined);
  const [historyError, setHistoryError] = useState<string | undefined>(undefined);

  const refreshToday = useCallback(async () => {
    setToday(await api.today());
  }, [api]);

  /**
   * The day's data is fetched once, on mount, and survives a trip to the
   * history and back — switching tabs is not a reason to ask again. It is
   * skipped entirely when the announcements page is the one that opened,
   * since that page needs none of it.
   */
  useEffect(() => {
    if (viewFromPath(currentPath()) === 'notices') return;
    void (async () => {
      try {
        const [todayResult, directoryResult] = await Promise.all([api.today(), api.players()]);
        setToday(todayResult);
        setDirectory(directoryResult.players);
      } catch (cause) {
        setFatal(cause instanceof Error ? cause.message : 'Palvelua ei saatu yhteyttä.');
      }
    })();
  }, [api]);

  /**
   * The archive is a separate, larger fetch, so it waits until somebody opens
   * the history — most visits are somebody registering for tonight. Once it
   * has arrived it is kept: filtering and ranking happen in the browser.
   */
  useEffect(() => {
    if (view !== 'history' || history !== undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.history();
        if (!cancelled) setHistory(result.players);
      } catch (cause) {
        if (!cancelled) {
          setHistoryError(cause instanceof Error ? cause.message : 'Historiaa ei saatu haettua.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, view, history]);

  // The tab bar pushes history entries, so the browser's back button has to
  // move between the pages rather than leave the application.
  useEffect(() => {
    const onPopState = (): void => setView(viewFromPath(currentPath()));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (tab: Tab): void => {
    window.history.pushState({}, '', tab === 'history' ? HISTORY_PATH : '/');
    setView(tab);
  };

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
        ) : view === 'history' ? (
          historyError !== undefined ? (
            <p className="state" role="alert">
              {historyError}
            </p>
          ) : history === undefined ? (
            <p className="state">Haetaan…</p>
          ) : (
            <History players={history} />
          )
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
            onRegister={async (name, turnstileToken, isGoalkeeper) => {
              await api.register(name, today.date, turnstileToken, isGoalkeeper);
              await refreshToday();
              // A brand-new player belongs in the directory immediately, so
              // the next person can pick the name from the suggestions.
              setDirectory((await api.players()).players);
              // And the archive it is now part of is stale; it will be
              // fetched again next time the history is opened.
              setHistory(undefined);
            }}
            onUnregister={async (playerId) => {
              await api.unregister(playerId);
              await refreshToday();
              setHistory(undefined);
            }}
            onSetGoalkeeper={async (playerId, isGoalkeeper) => {
              await api.setGoalkeeper(playerId, isGoalkeeper);
              // Only the day's list moves. Standing in goal is still playing,
              // so no total changes and the archive is untouched.
              await refreshToday();
            }}
          />
        )}
      </main>

      {view !== 'notices' && <Tabs active={view} onNavigate={navigate} />}
    </div>
  );
}
