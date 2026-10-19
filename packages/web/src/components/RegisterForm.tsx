import { useId, useMemo, useState } from 'react';
import type { PlayerSummary } from '@sahlykanta/shared';
import { MAX_NAME_LENGTH } from '@sahlykanta/shared';
import { filterPlayers } from '../lib/search.js';

const MAX_SUGGESTIONS = 6;

export function RegisterForm({
  directory,
  alreadyRegistered,
  onSubmit,
  error,
}: {
  directory: PlayerSummary[];
  alreadyRegistered: ReadonlySet<string>;
  onSubmit: (name: string) => Promise<void>;
  error: string | undefined;
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
    if (value.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      setName('');
    } finally {
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
        disabled={busy || name.trim().length === 0}
      >
        {busy ? 'Ilmoittaudutaan…' : 'Ilmoittaudu'}
      </button>
    </form>
  );
}
