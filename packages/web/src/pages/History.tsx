import { useEffect, useId, useMemo, useState } from 'react';
import type { PlayerDetail } from '@sahlykanta/shared';
import { countForYear, historyYears, rankHistory, type SortKey } from '../lib/history.js';
import { SearchGlyph } from '../components/Graphics.js';
import { useLocale, useT } from '../lib/i18n/index.js';

/**
 * Peliaktiivisuus: twenty-five years of registrations, filtered by name and by
 * year, ranked by name or by games played.
 *
 * Year chips sit above the search box rather than inside a filter sheet, so
 * the two filters and the ordering are all visible at once and a year is one
 * tap away. Choosing a year changes what the list counts: the number beside a
 * name becomes that year's games, the ranking follows it, and anyone who did
 * not play that year drops out — a list of zeroes would say nothing.
 *
 * Everything here is computed in the browser from one response. See
 * lib/history.ts for why.
 */
export function History({ players }: { players: PlayerDetail[] }): React.ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('total');
  /** undefined is "Kaikki": the lifetime totals. */
  const [year, setYear] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);

  useEffect(() => {
    document.title = 'Peliaktiivisuus';
  }, []);

  const years = useMemo(() => historyYears(players), [players]);
  const shown = useMemo(
    () => rankHistory(players, { query, sort, year, locale }),
    // `locale` belongs here: it decides the collation, so A–Ö reorders when
    // the language does.
    [players, query, sort, year, locale],
  );

  if (players.length === 0) {
    return (
      <section className="card" aria-labelledby="history-title">
        <h1 id="history-title" className="history__title">
          Peliaktiivisuus
        </h1>
        <p className="state">Ei vielä pelikertoja.</p>
      </section>
    );
  }

  const first = years.at(-1);
  const last = years.at(0);

  return (
    <>
      <section className="card" aria-labelledby="history-title">
        <h1 id="history-title" className="history__title">
          Peliaktiivisuus
        </h1>
        <p className="history__span">
          {/*
            The subtitle follows the year chips: while the list is one year's
            ranking, saying "kaikki pelikerrat" over it would contradict what
            is underneath.
          */}
          {year === undefined
            ? `Kaikki pelikerrat ${first === last ? first : `${first}–${last}`}`
            : `Pelikerrat vuonna ${year}`}
        </p>

        {/*
          A horizontal scroller rather than a wrapped grid: twenty-five years
          would otherwise push the list off a phone screen entirely. The
          newest year is where the scroller starts, which is where attention
          goes.
        */}
        <div className="years" role="group" aria-label="Vuosi">
          <button
            className="years__chip"
            type="button"
            aria-pressed={year === undefined}
            onClick={() => setYear(undefined)}
          >
            Kaikki
          </button>
          {years.map((option) => (
            <button
              className="years__chip"
              key={option}
              type="button"
              aria-pressed={year === option}
              onClick={() => setYear(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="search">
          <SearchGlyph />
          <label className="visually-hidden" htmlFor={searchId}>
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
            {shown.length} / {players.length}
          </span>
        </div>
      </section>

      {shown.length === 0 ? (
        <p className="state">
          Ei osumia haulla “{query.trim()}”{year !== undefined && ` vuonna ${year}`}.
        </p>
      ) : (
        <ul className="players" aria-label="Pelaajat">
          {shown.map((player) => {
            const open = openId === player.playerId;
            const count = countForYear(player, year);
            // Bars are read against the player's own best year, so a rare
            // visitor's chart is as legible as a regular's.
            const peak = Math.max(1, ...player.years.map((entry) => entry.count));

            return (
              <li className="player" key={player.playerId}>
                <button
                  className="player__toggle"
                  type="button"
                  aria-expanded={open}
                  aria-label={`${player.displayName}, ${t.history.games(count)}`}
                  onClick={() => setOpenId(open ? undefined : player.playerId)}
                >
                  <span className="player__name">{player.displayName}</span>
                  <span className="player__total">{count}</span>
                  <span className="player__caret" aria-hidden="true">
                    {open ? '▲' : '▼'}
                  </span>
                </button>

                {open && (
                  <ul className="player__years" aria-label={`${player.displayName} vuosittain`}>
                    {player.years.map((entry) => (
                      <li
                        className={`year${entry.year === year ? ' year--chosen' : ''}`}
                        key={entry.year}
                        aria-label={`${entry.year}: ${t.history.games(entry.count)}`}
                      >
                        <span className="year__label" aria-hidden="true">
                          {entry.year}
                        </span>
                        <span className="year__bar" aria-hidden="true">
                          <span
                            className="year__bar-fill"
                            style={{ width: `${Math.round((entry.count / peak) * 100)}%` }}
                          />
                        </span>
                        <span className="year__count" aria-hidden="true">
                          {entry.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
