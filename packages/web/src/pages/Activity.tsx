import { useId, useMemo, useState } from 'react';
import type { PlayerDetail, PlayerSummary } from '@sahlykanta/shared';
import { filterPlayers, sortPlayers, type SortKey } from '../lib/search.js';
import { Rink, SearchGlyph } from '../components/Graphics.js';
import { pluralGames } from '../lib/finnish.js';

export function Activity({
  directory,
  loadPlayer,
}: {
  directory: PlayerSummary[];
  loadPlayer: (playerId: string) => Promise<PlayerDetail>;
}): React.ReactElement {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('total');
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [details, setDetails] = useState<Record<string, PlayerDetail>>({});
  const [failed, setFailed] = useState<string | undefined>(undefined);

  const shown = useMemo(
    () => sortPlayers(filterPlayers(directory, query), sort),
    [directory, query, sort],
  );

  const toggle = async (playerId: string): Promise<void> => {
    if (openId === playerId) {
      setOpenId(undefined);
      return;
    }
    setOpenId(playerId);
    setFailed(undefined);
    if (details[playerId] !== undefined) return;
    try {
      const detail = await loadPlayer(playerId);
      setDetails((previous) => ({ ...previous, [playerId]: detail }));
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : 'Tietojen haku ei onnistunut.');
    }
  };

  return (
    <>
      <section className="card" aria-labelledby="activity-title">
        <h1 id="activity-title" style={{ margin: 0, fontSize: '21px', fontWeight: 800 }}>
          Peliaktiivisuus
        </h1>
        <p className="today__date" style={{ fontSize: '13px' }}>
          Kaikki pelikerrat vuodesta 2001
        </p>
        <Rink />

        <div className="search">
          <SearchGlyph />
          <label
            htmlFor={searchId}
            style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}
          >
            Hae pelaajan nimellä
          </label>
          <input
            className="search__input"
            id={searchId}
            type="search"
            value={query}
            placeholder="Hae pelaajan nimellä"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="sorts">
          <button
            className="sorts__button"
            type="button"
            aria-pressed={sort === 'total'}
            onClick={() => setSort('total')}
          >
            Eniten pelejä
          </button>
          <button
            className="sorts__button"
            type="button"
            aria-pressed={sort === 'name'}
            onClick={() => setSort('name')}
          >
            Nimi A–Ö
          </button>
          <span className="sorts__count">
            {shown.length} / {directory.length}
          </span>
        </div>
      </section>

      {failed !== undefined && (
        <p className="field__error" role="alert">
          {failed}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="state">Ei osumia haulla “{query.trim()}”.</p>
      ) : (
        <ul className="players">
          {shown.map((player) => {
            const open = openId === player.playerId;
            const detail = details[player.playerId];
            const peak =
              detail === undefined
                ? 1
                : Math.max(1, ...detail.years.map((year) => year.count));

            return (
              <li className="player" key={player.playerId}>
                <button
                  className="player__toggle"
                  type="button"
                  aria-expanded={open}
                  onClick={() => void toggle(player.playerId)}
                >
                  <span className="player__name">{player.displayName}</span>
                  <span className="player__total" aria-label={pluralGames(player.total)}>
                    {player.total}
                  </span>
                  <span aria-hidden="true" style={{ color: '#8a9a92', fontSize: '12px' }}>
                    {open ? '▲' : '▼'}
                  </span>
                </button>

                {open && (
                  <div className="player__years">
                    {detail === undefined ? (
                      <p className="field__hint">Haetaan…</p>
                    ) : detail.years.length === 0 ? (
                      <p className="field__hint">Ei pelikertoja.</p>
                    ) : (
                      detail.years.map((year) => (
                        <div className="year" key={year.year}>
                          <span className="year__label">{year.year}</span>
                          <span className="year__bar">
                            <span
                              className="year__bar-fill"
                              style={{ width: `${Math.round((year.count / peak) * 100)}%` }}
                            />
                          </span>
                          <span className="year__count">{year.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
