import { useCallback, useEffect, useState } from 'react';
import type { PlayerDetail, PlayerSummary, TodayResponse } from '@sahlykanta/shared';
import { api as defaultApi, type Api } from './lib/api.js';
import { BallMark } from './components/Graphics.js';
import { Tabs, type Tab } from './components/Tabs.js';
import { LanguageChooser } from './components/LanguageChooser.js';
import { Today } from './pages/Today.js';
import { History } from './pages/History.js';
import { Notices } from './pages/Notices.js';
import { Settings } from './pages/Settings.js';
import { Retro } from './pages/Retro.js';
import { HISTORY_PATH, NOTICES_PATH, SETTINGS_PATH } from './lib/routes.js';
import { LocaleProvider, useT } from './lib/i18n/index.js';
import './retro.css';

/**
 * Taps on the masthead mark that bring back the application this one
 * replaced. Seven, in one go: few enough to find by fidgeting, many enough
 * that nobody arrives there by mis-tapping the logo.
 */
const TAPS_TO_2002 = 7;

/**
 * Four pages: the day's list, the history, and two unlisted ones —
 * announcements and the schedule settings. The first two are the tab bar;
 * the unlisted pair is reached only by typing its address and shows no tab
 * bar at all. Any other address falls back to the day's list.
 */
type View = Tab | 'notices' | 'settings';

/**
 * Both unlisted pages want the day's fetch skipped, the home link instead
 * of the easter-egg tap target, and no tab bar — the same treatment, for
 * the same reason. A type predicate, so that `!isBare(view)` narrows `view`
 * back to `Tab` for the tab bar below.
 */
function isBare(view: View): view is 'notices' | 'settings' {
  return view === 'notices' || view === 'settings';
}

function viewFromPath(pathname: string): View {
  if (pathname.startsWith(NOTICES_PATH)) return 'notices';
  if (pathname.startsWith(SETTINGS_PATH)) return 'settings';
  if (pathname.startsWith(HISTORY_PATH)) return 'history';
  return 'today';
}

const currentPath = (): string => (typeof window === 'undefined' ? '/' : window.location.pathname);

/**
 * The provider sits inside `App`, not around it in `main.tsx`, so that
 * anything rendering `App` — every test in this package does — gets the
 * language machinery without having to remember to wrap it.
 */
export function App({ api = defaultApi }: { api?: Api }): React.ReactElement {
  return (
    <LocaleProvider>
      <AppBody api={api} />
    </LocaleProvider>
  );
}

function AppBody({ api }: { api: Api }): React.ReactElement {
  const t = useT();
  const [view, setView] = useState<View>(() => viewFromPath(currentPath()));
  const [today, setToday] = useState<TodayResponse | undefined>(undefined);
  const [directory, setDirectory] = useState<PlayerSummary[]>([]);
  const [fatal, setFatal] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<PlayerDetail[] | undefined>(undefined);
  const [historyError, setHistoryError] = useState<string | undefined>(undefined);
  /**
   * The easter egg. Deliberately held in memory and nowhere else: no route,
   * no stored flag, no link to it — a reload is always the way back to the
   * present, and Esc or the banner is the quick one.
   */
  const [retro, setRetro] = useState(false);
  const [taps, setTaps] = useState(0);

  const refreshToday = useCallback(async () => {
    setToday(await api.today());
  }, [api]);

  /**
   * The day's data is fetched once, on mount, and survives a trip to the
   * history and back — switching tabs is not a reason to ask again. It is
   * skipped entirely when one of the unlisted pages is the one that opened,
   * since neither needs any of it.
   */
  useEffect(() => {
    if (isBare(viewFromPath(currentPath()))) return;
    void (async () => {
      try {
        const [todayResult, directoryResult] = await Promise.all([api.today(), api.players()]);
        setToday(todayResult);
        setDirectory(directoryResult.players);
      } catch (cause) {
        setFatal(cause instanceof Error ? cause.message : t.shell.noService);
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
          setHistoryError(cause instanceof Error ? cause.message : t.shell.noHistory);
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

  // Esc is the way out of 2002, as it is out of anything that took over the
  // screen without being asked.
  useEffect(() => {
    if (!retro) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setRetro(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [retro]);

  const navigate = (tab: Tab): void => {
    window.history.pushState({}, '', tab === 'history' ? HISTORY_PATH : '/');
    setView(tab);
    // Going somewhere counts as having meant to: the run of taps is over.
    setTaps(0);
  };

  const tapMark = (): void => {
    const next = taps + 1;
    if (next >= TAPS_TO_2002) {
      setTaps(0);
      setRetro(true);
      return;
    }
    setTaps(next);
  };

  const register = async (
    name: string,
    turnstileToken: string,
    isGoalkeeper: boolean,
  ): Promise<void> => {
    // Neither page offers the form before the day has arrived, so this is
    // unreachable rather than a case worth reporting.
    if (today === undefined) return;
    await api.register(name, today.date, turnstileToken, isGoalkeeper);
    await refreshToday();
    // A brand-new player belongs in the directory immediately, so the next
    // person can pick the name from the suggestions.
    setDirectory((await api.players()).players);
    // And the archive it is now part of is stale; it will be fetched again
    // next time the history is opened.
    setHistory(undefined);
  };

  if (retro && today !== undefined) {
    return (
      <Retro
        today={today}
        directory={directory}
        onRegister={(name, turnstileToken) => register(name, turnstileToken, false)}
        loadHistory={async () => (await api.history()).players}
        loadDates={async (playerId) => (await api.playerDates(playerId)).dates}
        onLeave={() => setRetro(false)}
      />
    );
  }

  return (
    <div className="app">
      <header className="masthead">
        {isBare(view) ? (
          // Both unlisted pages are reached by typing their address, so they
          // need a way back that does not depend on the browser's history.
          // A plain href, since neither shares state worth keeping with it.
          <a className="masthead__home" href="/" aria-label={t.shell.backToRegistration}>
            <span className="masthead__mark">
              <BallMark />
            </span>
          </a>
        ) : (
          // A button, not a span: it is tappable, and a tappable span is one
          // the keyboard cannot reach. What it does is nobody's business.
          <button
            className="masthead__mark masthead__mark--tap"
            type="button"
            aria-label={t.shell.mark}
            onClick={tapMark}
          >
            <BallMark />
          </button>
        )}
        <span className="masthead__name">PELEILLE</span>
        {/* Every page the app renders carries it, the two unlisted ones
            included — they are not exempt from having to be readable. The
            2002 page returns before this markup and so never shows it. */}
        <LanguageChooser />
      </header>

      <main className="app__main">
        {view === 'notices' ? (
          <Notices
            load={api.allAnnouncements}
            add={api.addAnnouncement}
            remove={api.removeAnnouncement}
          />
        ) : view === 'settings' ? (
          <Settings load={api.schedule} add={api.addSlot} remove={api.removeSlot} />
        ) : view === 'history' ? (
          historyError !== undefined ? (
            <p className="state" role="alert">
              {historyError}
            </p>
          ) : history === undefined ? (
            <p className="state">{t.shell.loading}</p>
          ) : (
            <History players={history} />
          )
        ) : fatal !== undefined ? (
          <p className="state" role="alert">
            {fatal}
          </p>
        ) : today === undefined ? (
          <p className="state">{t.shell.loading}</p>
        ) : (
          <Today
            today={today}
            directory={directory}
            onRegister={register}
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

      {!isBare(view) && <Tabs active={view} onNavigate={navigate} />}
    </div>
  );
}
