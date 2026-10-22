import { useId, useMemo, useState } from 'react';
import type { PlayerSummary } from '@sahlykanta/shared';
import { MAX_NAME_LENGTH, TURNSTILE_ACTIONS } from '@sahlykanta/shared';
import { filterPlayers } from '../lib/search.js';
import { Turnstile } from './Turnstile.js';

const MAX_SUGGESTIONS = 6;

export function RegisterForm({
  directory,
  alreadyRegistered,
  onSubmit,
  error,
}: {
  directory: PlayerSummary[];
  alreadyRegistered: ReadonlySet<string>;
  onSubmit: (name: string, turnstileToken: string) => Promise<void>;
  error: string | undefined;
}): React.ReactElement {
  const inputId = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * The widget hands this over on its own, usually before anyone has finished
   * typing a name. `attempt` spends it: every submission bumps it, which
   * resets the widget and clears the token until a fresh one arrives.
   */
  const [token, setToken] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

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
    if (value.trim().length === 0 || busy || token === undefined) return;
    setBusy(true);
    try {
      await onSubmit(value.trim(), token);
      setName('');
    } finally {
      // Whether it worked or not, that token is spent.
      setAttempt((previous) => previous + 1);
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

      <Turnstile action={TURNSTILE_ACTIONS.register} resetKey={attempt} onToken={setToken} />

      {error !== undefined && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      <button
        className="button"
        type="submit"
        aria-busy={busy}
        disabled={busy || name.trim().length === 0 || token === undefined}
      >
        {busy ? 'Ilmoittaudutaan…' : 'Ilmoittaudu'}
      </button>

      {/* Only worth saying once there is a name to submit: before that the
          button is disabled for the obvious reason instead. */}
      {token === undefined && name.trim().length > 0 && (
        <p className="field__hint">Odotetaan varmistusta…</p>
      )}
    </form>
  );
}
