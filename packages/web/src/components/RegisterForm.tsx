import { useId, useMemo, useState } from 'react';
import type { PlayerSummary } from '@sahlykanta/shared';
import { MAX_NAME_LENGTH } from '@sahlykanta/shared';
import { filterPlayers } from '../lib/search.js';
import { TurnstileFailure } from './Turnstile.js';
import { useT } from '../lib/i18n/index.js';

const MAX_SUGGESTIONS = 6;

export function RegisterForm({
  directory,
  alreadyRegistered,
  onSubmit,
  error,
  turnstileToken,
  onTokenSpent,
  turnstileFailure,
  onRetryVerification,
}: {
  directory: PlayerSummary[];
  alreadyRegistered: ReadonlySet<string>;
  onSubmit: (name: string, turnstileToken: string, isGoalkeeper: boolean) => Promise<void>;
  error: string | undefined;
  /**
   * Arrives on its own, usually before anyone has finished typing a name. The
   * widget that produces it lives at the foot of the page rather than in this
   * form, so the page owns it and hands it down.
   */
  turnstileToken: string | undefined;
  /** Called once a submission has consumed the token, so a fresh one is minted. */
  onTokenSpent: () => void;
  /**
   * Set once the check has failed, carrying Cloudflare's code when it gave
   * one. Distinct from simply having no token yet: that one resolves itself
   * in a moment, this one never will until somebody retries.
   */
  turnstileFailure: { code: string | undefined } | undefined;
  /** Builds the widget again, for when the check has failed. */
  onRetryVerification: () => void;
}): React.ReactElement {
  const t = useT();
  const inputId = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * Whether this registration is for the goal. Never ticked to begin with:
   * most evenings nobody is marked, and a box that remembers the last answer
   * would quietly put the next person in goal.
   *
   * It is settled here, before the name is submitted, because picking a
   * suggestion registers that name on the spot — so the box has to be
   * answerable before the tap. Changing it afterwards still happens from the
   * list, where who is in goal is usually decided.
   */
  const [goalkeeper, setGoalkeeper] = useState(false);

  /**
   * Suggestions come from the cached directory, but typing a brand-new name
   * is equally valid — anyone can register anyone, including someone who has
   * never played before.
   */
  const suggestions = useMemo(() => {
    const query = name.trim();
    if (query.length < 2) return [];
    return filterPlayers(directory, query)
      .filter((player) => !alreadyRegistered.has(player.playerId))
      .slice(0, MAX_SUGGESTIONS);
  }, [directory, name, alreadyRegistered]);

  const submit = async (value: string): Promise<void> => {
    if (value.trim().length === 0 || busy || turnstileToken === undefined) return;
    setBusy(true);
    try {
      await onSubmit(value.trim(), turnstileToken, goalkeeper);
      // The box is emptied with the name, never left behind: the next name
      // typed into this form is somebody else, and an inherited tick would
      // put them in goal without anyone asking.
      setName('');
      setGoalkeeper(false);
    } finally {
      // Whether it worked or not, that token is spent.
      onTokenSpent();
      setBusy(false);
    }
  };

  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(name);
      }}
    >
      <label className="field__label" htmlFor={inputId}>
        {t.register.name}
      </label>
      <input
        className="field__input"
        id={inputId}
        type="text"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="off"
        placeholder={t.register.namePlaceholder}
        onChange={(event) => setName(event.target.value)}
      />
      <p className="field__hint">{t.register.hint}</p>

      {/* Above the suggestions, because tapping one of them registers that
          name immediately: below them, the box would sit past the point of
          no return. */}
      <label className="field__gk">
        <input
          type="checkbox"
          checked={goalkeeper}
          onChange={(event) => setGoalkeeper(event.target.checked)}
        />
        {t.register.asGoalkeeper}
      </label>

      {suggestions.length > 0 && (
        <ul className="suggestions" aria-label={t.register.suggestions}>
          {suggestions.map((player) => (
            <li key={player.playerId}>
              <button
                className="suggestions__item"
                type="button"
                onClick={() => void submit(player.displayName)}
              >
                {player.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error !== undefined && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      <button
        className="button"
        type="submit"
        aria-busy={busy}
        disabled={busy || name.trim().length === 0 || turnstileToken === undefined}
      >
        {busy ? t.register.submitting : t.register.submit}
      </button>

      {/* Stays beside the button rather than beside the widget at the foot of
          the page: it explains why this button is disabled, and that belongs
          next to the button.

          A failure is shown whether or not a name has been typed — it is the
          page that is broken, not the entry — while the patient "waiting" is
          only worth saying once there is a name to submit. Saying "waiting"
          when nothing is coming is what made this a dead end before. */}
      {turnstileFailure !== undefined ? (
        <TurnstileFailure code={turnstileFailure.code} onRetry={onRetryVerification} />
      ) : (
        turnstileToken === undefined &&
        name.trim().length > 0 && <p className="field__hint">Odotetaan varmistusta…</p>
      )}
    </form>
  );
}
