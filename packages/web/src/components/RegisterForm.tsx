import { useId, useMemo, useState } from 'react';
import type { PlayerSummary } from '@sahlykanta/shared';
import { MAX_NAME_LENGTH } from '@sahlykanta/shared';
import { filterPlayers } from '../lib/search.js';
import { TurnstileFailure } from './Turnstile.js';

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
  onSubmit: (name: string, turnstileToken: string) => Promise<void>;
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
  const inputId = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

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
      await onSubmit(value.trim(), turnstileToken);
      setName('');
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
        Nimi
      </label>
      <input
        className="field__input"
        id={inputId}
        type="text"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="off"
        placeholder="Hae tai kirjoita nimi"
        onChange={(event) => setName(event.target.value)}
      />
      <p className="field__hint">Ehdotetaan aiemmin pelanneista · uusi nimi käy myös</p>

      {suggestions.length > 0 && (
        <ul className="suggestions" aria-label="Ehdotukset">
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
        {busy ? 'Ilmoittaudutaan…' : 'Ilmoittaudu'}
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
