import { useEffect, useId, useState } from 'react';
import {
  DEFAULT_SCHEDULE,
  TURNSTILE_ACTIONS,
  type GameSlot,
  type GameSlotInput,
} from '@sahlykanta/shared';
import { slotTime, weekdayName } from '../lib/finnish.js';
import { Turnstile, TurnstileFailure } from '../components/Turnstile.js';

/**
 * Managing the playing schedule: which weekdays this group plays, and at
 * what time.
 *
 * Unlisted, exactly as the announcements page is: nothing links here, and
 * knowing the address is the only thing standing between a visitor and this
 * page. That is a deliberate choice, and a limited one — it keeps the page
 * out of the way of people who have no business on it, but it is not a
 * lock. Anyone who learns the address can add and remove playing slots,
 * exactly as anyone can already add and remove names on the day's list, or
 * announcements on the other unlisted page.
 *
 * One Turnstile widget serves the whole page: adding and removing both spend
 * its token and then reset it. It is drawn last, under both cards, so that
 * it reads as a footnote to the page rather than as another control to deal
 * with on the way to the button. It keeps scripts off these endpoints and
 * identifies nobody; calling the API directly now needs a solved challenge,
 * and that is the only thing that changed here.
 */

const WEEKDAY_LABEL = (weekday: number): string => {
  const name = weekdayName(weekday);
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** Monday first; weekday numbers themselves are Sunday-first. */
const WEEK_NUMBERS = [1, 2, 3, 4, 5, 6, 0];

/** `maanantai, keskiviikko, lauantai` — the fallback rule, named in order. */
const FALLBACK_DAYS = DEFAULT_SCHEDULE.map((slot) => weekdayName(slot.weekday)).join(', ');

export function Settings({
  load,
  add,
  remove,
}: {
  load: () => Promise<{ slots: GameSlot[]; initialised: boolean }>;
  add: (input: GameSlotInput, turnstileToken: string) => Promise<GameSlot>;
  remove: (id: string, turnstileToken: string) => Promise<void>;
}): React.ReactElement {
  const weekdayId = useId();
  const startId = useId();
  const endId = useId();

  const [schedule, setSchedule] = useState<{ slots: GameSlot[]; initialised: boolean } | undefined>(
    undefined,
  );
  const [weekday, setWeekday] = useState('1');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  /**
   * A check that has failed, as against one that simply has not answered yet.
   * Both leave `token` undefined, but only one of them is worth waiting for.
   */
  const [failure, setFailure] = useState<{ code: string | undefined } | undefined>(undefined);
  /** Bumped to build the widget again, which is what a retry needs. */
  const [reload, setReload] = useState(0);

  const retryVerification = (): void => {
    setFailure(undefined);
    setToken(undefined);
    setReload((previous) => previous + 1);
  };

  useEffect(() => {
    // An administrative page has no business in search results. The rest of
    // the app is a single index.html, so this has to be set while the page
    // is open and taken off again when it is not.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const previousTitle = document.title;
    document.title = 'Asetukset';
    return () => {
      meta.remove();
      document.title = previousTitle;
    };
  }, []);

  const refresh = async (): Promise<void> => {
    setSchedule(await load());
  };

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Pelivuorojen haku ei onnistunut.');
        // `schedule` is deliberately left undefined here, not set to some
        // stand-in value: a network blip is not a fact about the schedule,
        // and the only claims the list card can make from `{ slots: [] }` —
        // either the fallback or "we do not play" — would both be false.
        // The role="alert" paragraph below already says what happened.
      }
    })();
    // Deliberately once, on mount: `load` is stable for the lifetime of the
    // page, and re-running on every render would poll the API.
  }, []);

  const submit = async (): Promise<void> => {
    if (startTime === '' || busy || token === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await add(
        {
          weekday: Number(weekday),
          startTime,
          ...(endTime.length > 0 ? { endTime } : {}),
        },
        token,
      );
      setStartTime('');
      setEndTime('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pelivuoron lisäys ei onnistunut.');
    } finally {
      setAttempt((previous) => previous + 1);
      setBusy(false);
    }
  };

  const drop = async (id: string): Promise<void> => {
    if (token === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await remove(id, token);
      setConfirming(undefined);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pelivuoron poisto ei onnistunut.');
    } finally {
      // Spent either way, and the next removal needs its own.
      setAttempt((previous) => previous + 1);
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card" aria-labelledby="settings-title">
        <h1 id="settings-title" style={{ margin: 0, fontSize: '21px', fontWeight: 800 }}>
          Pelivuoro
        </h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={weekdayId}>
            Viikonpäivä
            <select
              className="field__select"
              id={weekdayId}
              value={weekday}
              onChange={(event) => setWeekday(event.target.value)}
            >
              {WEEK_NUMBERS.map((number) => (
                <option key={number} value={number}>
                  {WEEKDAY_LABEL(number)}
                </option>
              ))}
            </select>
          </label>

          <div className="field__row">
            <label htmlFor={startId}>
              Alkaa
              <input
                className="field__time"
                id={startId}
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <label htmlFor={endId}>
              Päättyy
              <input
                className="field__time"
                id={endId}
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>
          </div>

          <button
            className="button"
            type="submit"
            aria-busy={busy}
            disabled={busy || startTime === '' || token === undefined}
          >
            Lisää pelivuoro
          </button>
          {/* The page's one promise, and the reason it carries no dates: a
              saved slot takes effect immediately, with no window to wait for. */}
          <p className="field__hint">Muutos on voimassa heti, ja näkyy heti etusivulla.</p>
        </form>

        {failure !== undefined ? (
          <TurnstileFailure code={failure.code} onRetry={retryVerification} />
        ) : (
          token === undefined && <p className="field__hint">Odotetaan varmistusta…</p>
        )}

        {error !== undefined && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="settings-list-title">
        <h2 className="section__label" id="settings-list-title">
          Pelivuorot
        </h2>

        {schedule === undefined ? (
          <p className="field__hint">Haetaan…</p>
        ) : schedule.slots.length === 0 ? (
          <p className="field__hint">
            {schedule.initialised
              ? 'Yhtään pelivuoroa ei ole — tällä hetkellä ei pelata.'
              : `Pelivuoroja ei ole vielä asetettu. Käytössä oletuksena: ${FALLBACK_DAYS} — ensimmäinen tallennettu pelivuoro korvaa ne.`}
          </p>
        ) : (
          schedule.slots.map((slot) => {
            const label = `${WEEKDAY_LABEL(slot.weekday)} ${slotTime(slot) ?? ''}`.trim();
            return (
              <div
                className={
                  confirming === slot.id ? 'notice-row notice-row--confirming' : 'notice-row'
                }
                key={slot.id}
              >
                <span className="notice-row__text">{label}</span>

                {confirming === slot.id ? (
                  // Its own line, so the slot stays readable while the
                  // question is being asked.
                  <div className="notice-row__actions">
                    <span className="notice-row__question">Poistetaanko?</span>
                    <button
                      className="notice-row__confirm"
                      type="button"
                      aria-label={`Vahvista: poista pelivuoro ${label}`}
                      disabled={busy || token === undefined}
                      onClick={() => void drop(slot.id)}
                    >
                      Kyllä
                    </button>
                    <button
                      className="notice-row__cancel"
                      type="button"
                      aria-label={`Peruuta: pelivuoro ${label} jää`}
                      onClick={() => setConfirming(undefined)}
                    >
                      Peru
                    </button>
                  </div>
                ) : (
                  <button
                    className="notice-row__drop"
                    type="button"
                    aria-label={`Poista pelivuoro ${label}`}
                    onClick={() => {
                      setError(undefined);
                      setConfirming(slot.id);
                    }}
                  >
                    Poista
                  </button>
                )}
              </div>
            );
          })
        )}
      </section>

      {/*
        Last on the page, under both cards. It is outside the form on purpose:
        the hidden cf-turnstile-response input it renders is never read by a
        native form submission here — the token reaches the API through the
        callback below and fetch — so nothing is lost by moving it out.
      */}
      <Turnstile
        action={TURNSTILE_ACTIONS.settings}
        resetKey={attempt}
        reloadKey={reload}
        onToken={setToken}
        onFailure={(code) => setFailure({ code })}
      />
    </>
  );
}
