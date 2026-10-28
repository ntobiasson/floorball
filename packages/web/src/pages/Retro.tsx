import { useMemo, useState } from 'react';
import {
  TURNSTILE_ACTIONS,
  type PlayerDetail,
  type PlayerSummary,
  type TodayResponse,
} from '@sahlykanta/shared';
import { finnishDate } from '../lib/finnish.js';
import { filterPlayers } from '../lib/search.js';
import { Turnstile } from '../components/Turnstile.js';
import { RetroHistory } from './RetroHistory.js';

/** Enough to fill the panel, few enough that it does not run past it. */
const MAX_MATCHES = 8;

/**
 * The application this one replaced, as it stood: a Lotus Domino 9 XPages
 * page on a server nobody maintained, with a 2002 banner across the top and a
 * left-hand navigator that is a JPEG.
 *
 * It is an easter egg, reached by tapping the masthead mark seven times and
 * by nothing else — no route, no link, no tab — and a reload leaves it. The
 * markup follows what `pelit.xsp` actually printed: the green "on pelipäivä"
 * panel, the count in kpl, the names run together with commas, the bordered
 * Tiedotteita box and the black footer still crediting the Dynamic Drive
 * layout the original was built on.
 *
 * What is not faithful, and deliberately: Domino knew who you were, so its
 * button needed no name — this one asks for one, because the application it
 * now talks to has no accounts. Registering really does go through the
 * current API, so the old interface drives the new archive.
 *
 * Two of the three navigator items lead where they always led:
 * Ilmoittautumiset back here, and Peliaktiivisuus to the view panel the whole
 * archive was scraped out of. Käyttöaste does not — it reported how much of
 * the hall's booked time was used, and no such number survived the move.
 *
 * The two period images are the originals, with the company name blurred out
 * of each: the banner's wordmark and the copyright line along the bottom of
 * the navigator.
 */
export function Retro({
  today,
  directory,
  onRegister,
  loadHistory,
  loadDates,
  onLeave,
}: {
  today: TodayResponse;
  /** Every name the archive knows, for the suggestions under the box. */
  directory: PlayerSummary[];
  /** The same registration the modern form performs, minus the goal. */
  onRegister: (name: string, turnstileToken: string) => Promise<void>;
  /** Fetched when Peliaktiivisuus is opened, as the old view was. */
  loadHistory: () => Promise<PlayerDetail[]>;
  /** One player's dates, for the Pvm column under a year. */
  loadDates: (playerId: string) => Promise<string[]>;
  onLeave: () => void;
}): React.ReactElement {
  /**
   * Which page of the database is open. Two of the three navigator items
   * lead somewhere; Käyttöaste never will, there being no such number in
   * this archive.
   */
  const [page, setPage] = useState<'pelit' | 'peliaktiivisuus'>('pelit');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  /**
   * Domino printed the names as one comma-separated run with no spaces after
   * the commas, which is how a long evening wrapped mid-name. The goalkeeper
   * is suffixed rather than coloured: the old page had no notion of one, and
   * a parenthesised suffix is exactly how that archive already carries the
   * `(EHKÄ)` duplicates.
   */
  const names = today.registrations
    .map((r) => (r.isGoalkeeper === true ? `${r.displayName} (MV)` : r.displayName))
    .join(',');

  /**
   * Nobody who is already on tonight's list: the API would refuse them, and
   * the old page's own list is printed two lines above.
   */
  const available = useMemo(() => {
    const registered = new Set(today.registrations.map((r) => r.playerId));
    return directory.filter((player) => !registered.has(player.playerId));
  }, [directory, today.registrations]);

  /**
   * One box, and this under it: the names the archive knows that match what
   * has been typed, filtered exactly as the modern form filters them. A name
   * that matches nothing is not a mistake — it is somebody's first game, and
   * the box takes it as typed.
   */
  const matches = useMemo(() => {
    const query = name.trim();
    if (query.length < 2) return [];
    return filterPlayers(available, query).slice(0, MAX_MATCHES);
  }, [available, name]);

  const submit = async (): Promise<void> => {
    if (name.trim().length === 0 || busy || turnstileToken === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await onRegister(name.trim(), turnstileToken);
      setName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ilmoittautuminen ei onnistunut.');
    } finally {
      setAttempt((previous) => previous + 1);
      setBusy(false);
    }
  };

  return (
    <div className="retro">
      <div id="maincontainer">
        <div id="topsection">
          {/* The way back. The original banner was not a control at all, but
              something has to lead out of 2002, and the nav items are inert
              by request. */}
          <button
            className="retro__back"
            type="button"
            aria-label="Takaisin nykyaikaan"
            title="Takaisin nykyaikaan"
            onClick={onLeave}
          >
            <img src="/retro/banner.gif" alt="" width={265} height={31} />
          </button>
        </div>

        <div id="contentwrapper">
          <div id="contentcolumn">
            <div className="innertube">
              {page === 'peliaktiivisuus' ? (
                <RetroHistory loadHistory={loadHistory} loadDates={loadDates} />
              ) : (
                <>
                  <br />
                  <div className={today.isGameDay ? 'gameToday' : 'gameNotToday'}>
                    Tänään&nbsp;
                    <span className="xspTextComputedField">{finnishDate(today.date)}</span>
                    &nbsp;{today.isGameDay ? 'on pelipäivä' : 'ei ole pelipäivää'}
                    <br />
                    {today.isGameDay && (
                      <>
                        <br />
                        Ilmoittautuneita&nbsp;
                        <span className="xspTextComputedField">{today.registrations.length}</span>
                        &nbsp;kpl
                        <br />
                        <span className="retro__names">{names}</span>
                        <br />
                        <br />
                        <table style={{ width: '90%' }}>
                          <tbody>
                            <tr>
                              <td style={{ width: '50%', verticalAlign: 'top' }}>
                                <label className="retro__nameLabel" htmlFor="retro-name">
                                  Nimesi
                                </label>
                                &nbsp;
                                <input
                                  className="retro__nameInput"
                                  id="retro-name"
                                  type="text"
                                  value={name}
                                  autoComplete="off"
                                  onChange={(event) => setName(event.target.value)}
                                />
                                &nbsp;
                                {/* Held until Cloudflare has answered: the old
                                button went straight to the server, and one
                                that looks ready but does nothing when
                                pressed is worse than one plainly not
                                ready. */}
                                <button
                                  className="xspButtonSubmit"
                                  type="button"
                                  disabled={busy || turnstileToken === undefined}
                                  onClick={() => void submit()}
                                >
                                  Ilmoittaudu tästä
                                </button>
                                {matches.length > 0 && (
                                  <ul className="retro__matches" aria-label="Ehdotukset">
                                    {matches.map((player) => (
                                      <li key={player.playerId}>
                                        <button
                                          className="retro__match"
                                          type="button"
                                          onClick={() => setName(player.displayName)}
                                        >
                                          {player.displayName}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {turnstileToken === undefined && (
                                  <div className="retro__waiting">Odotetaan varmistusta...</div>
                                )}
                                {error !== undefined && (
                                  <div className="retro__error" role="alert">
                                    {error}
                                  </div>
                                )}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>

                  <br />
                  <table style={{ width: '90%' }}>
                    <tbody>
                      <tr>
                        <td style={{ verticalAlign: 'top' }}>
                          <span className="retro__noticesTitle">Tiedotteita / uutisia:</span>
                          <br />
                          <div className="retro__noticesBox">
                            {today.announcements.length === 0 ? (
                              <br />
                            ) : (
                              today.announcements.map((announcement) => (
                                <div key={announcement.id}>
                                  {announcement.body}
                                  <br />
                                </div>
                              ))
                            )}
                          </div>
                          <br />
                          <div className="xspPagerContainer">
                            <div className="xspPagerRight">
                              <span className="xspPagerNav">Previous</span>
                              <span className="xspPagerNav xspSeparator">|</span>
                              <span className="xspPagerNav">Next</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <br />
                  <br />
                  <div className="retro__turnstile">
                    <Turnstile
                      action={TURNSTILE_ACTIONS.register}
                      resetKey={attempt}
                      onToken={setTurnstileToken}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Ilmoittautumiset and Peliaktiivisuus lead where they always led.
            Käyttöaste does not: it reported how much of the hall's booked
            time was used, and no such number survived the move. */}
        <div className="navigatorBackground">
          <br />
          <br />
          <br />
          <div className="retro__navItem">
            <img src="/retro/icon.png" alt="" width={16} height={16} />{' '}
            <button
              className="myLink retro__navLink"
              type="button"
              onClick={() => setPage('pelit')}
            >
              Ilmoittautumiset
            </button>
          </div>
          <div className="retro__navItem">
            <img src="/retro/icon.png" alt="" width={16} height={16} />{' '}
            <span className="myLink">Käyttöaste</span>
          </div>
          <div className="retro__navItem">
            <img src="/retro/icon.png" alt="" width={16} height={16} />{' '}
            <button
              className="myLink retro__navLink"
              type="button"
              onClick={() => setPage('peliaktiivisuus')}
            >
              Peliaktiivisuus
            </button>
          </div>
        </div>

        <div id="footer">
          application layout:&nbsp;&nbsp;
          <a
            href="http://www.dynamicdrive.com/style/layouts/item/css-fixed-layout-21-fixed-fixed/"
            className="xspLink"
            rel="noreferrer"
            target="_blank"
          >
            http://www.dynamicdrive.com/style/layouts/item/css-fixed-layout-21-fixed-fixed/
          </a>
        </div>
      </div>
    </div>
  );
}
