import { useState } from 'react';
import type { PlayerSummary, TodayResponse } from '@sahlykanta/shared';
import { finnishDate, finnishDateWithWeekday, weekdayName } from '../lib/finnish.js';
import { ClosedGlyph } from '../components/Graphics.js';
import { Notices } from '../components/Notices.js';
import { RegisterForm } from '../components/RegisterForm.js';

const GAME_WEEKDAYS = [1, 3, 6];
const WEEK_LABELS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
/** WEEK_LABELS is Monday-first; weekday numbers are Sunday-first. */
const WEEK_NUMBERS = [1, 2, 3, 4, 5, 6, 0];

export function Today({
  today,
  directory,
  onRegister,
  onUnregister,
}: {
  today: TodayResponse;
  directory: PlayerSummary[];
  onRegister: (name: string) => Promise<void>;
  onUnregister: (playerId: string) => Promise<void>;
}): React.ReactElement {
  const [error, setError] = useState<string | undefined>(undefined);
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  /**
   * Which name is being asked about. Removal is two taps: anyone can remove
   * anyone here, the chips sit close together on a phone, and a mis-tap would
   * quietly drop a teammate off the list with nothing to undo it.
   */
  const [confirming, setConfirming] = useState<string | undefined>(undefined);

  if (!today.isGameDay) {
    return (
      <>
        <section className="card closed">
          <span className="closed__mark">
            <ClosedGlyph />
          </span>
          <h1 className="closed__title">Tänään ei pelata</h1>
          <p className="closed__today">{finnishDateWithWeekday(today.date, today.weekday)}</p>
          <hr className="closed__rule" />
          <h2 className="section__label" style={{ marginTop: '18px' }}>
            Seuraava pelipäivä
          </h2>
          {today.nextGameDate !== undefined && (
            <p className="closed__next">
              {finnishDate(today.nextGameDate)}
            </p>
          )}
          <p className="field__hint" style={{ textAlign: 'center' }}>
            Ilmoittautuminen avautuu pelipäivän aamuna
          </p>
        </section>

        <section className="card" aria-labelledby="gamedays-title">
          <h2 className="section__label" id="gamedays-title">
            Pelipäivät
          </h2>
          <div className="weekstrip">
            {WEEK_LABELS.map((label, index) => {
              const weekday = WEEK_NUMBERS[index] as number;
              const isGame = GAME_WEEKDAYS.includes(weekday);
              return (
                <span
                  className={isGame ? 'weekstrip__day weekstrip__day--game' : 'weekstrip__day'}
                  key={label}
                >
                  {label}
                </span>
              );
            })}
          </div>
        </section>

        <Notices announcements={today.announcements} />
      </>
    );
  }

  const registeredIds = new Set(today.registrations.map((r) => r.playerId));

  const remove = async (playerId: string, displayName: string): Promise<void> => {
    setError(undefined);
    setRemoving(playerId);
    try {
      await onUnregister(playerId);
      setConfirming(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : `${displayName} poistaminen ei onnistunut.`,
      );
    } finally {
      setRemoving(undefined);
    }
  };

  return (
    <>
      <section className="card" aria-labelledby="today-title">
        <span className="pill">Pelipäivä</span>
        <h1 className="today__weekday" id="today-title">
          {weekdayName(today.weekday)}
        </h1>
        <p className="today__date">{finnishDate(today.date)}</p>

        <p className="today__count">
          <span className="today__count-number">{today.registrations.length}</span>
          <span className="today__count-label">
            {today.registrations.length === 1 ? 'ilmoittautunut' : 'ilmoittautunutta'}
          </span>
        </p>

        {today.registrations.length === 0 ? (
          <p className="field__hint">Kukaan ei ole vielä ilmoittautunut.</p>
        ) : (
          <ul className="chips" aria-label="Ilmoittautuneet">
            {today.registrations.map((registration) =>
              confirming === registration.playerId ? (
                <li className="chip chip--confirming" key={registration.playerId}>
                  {registration.displayName}
                  <button
                    className="chip__confirm"
                    type="button"
                    aria-label={`Vahvista: poista ${registration.displayName}`}
                    disabled={removing === registration.playerId}
                    onClick={() => void remove(registration.playerId, registration.displayName)}
                  >
                    {removing === registration.playerId ? 'Poistetaan…' : 'Poista'}
                  </button>
                  <button
                    className="chip__cancel"
                    type="button"
                    aria-label={`Peruuta: ${registration.displayName} jää listalle`}
                    onClick={() => setConfirming(undefined)}
                  >
                    Peru
                  </button>
                </li>
              ) : (
                <li className="chip" key={registration.playerId}>
                  {registration.displayName}
                  <button
                    className="chip__remove"
                    type="button"
                    aria-label={`Poista ${registration.displayName}`}
                    onClick={() => {
                      setError(undefined);
                      setConfirming(registration.playerId);
                    }}
                  >
                    ×
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <RegisterForm
        directory={directory}
        alreadyRegistered={registeredIds}
        error={error}
        onSubmit={async (name) => {
          setError(undefined);
          try {
            await onRegister(name);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Ilmoittautuminen ei onnistunut.');
          }
        }}
      />

      <Notices announcements={today.announcements} />
    </>
  );
}
