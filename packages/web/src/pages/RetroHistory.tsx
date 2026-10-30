import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { PlayerDetail } from '@sahlykanta/shared';
import { formatDate } from '../lib/format.js';

/**
 * Peliaktiivisuus, the XPages view panel the whole archive was scraped out
 * of before the Domino server was switched off.
 *
 * It is a four-column view — Nimi | Vuosi | Pvm | Kpl — in name order, thirty
 * rows to a page, every name collapsed until its `[+]` is pressed. The level
 * of a row is implied by which cell carries text, exactly as Domino emitted
 * it: a name in the first, a year in the second, a date in the third. That is
 * the shape `packages/import` still parses.
 *
 * Three levels, as the original had: a name opens into its years, and a year
 * into the dates that made it up. The dates are fetched for one player at a
 * time, the first time any of their years is opened — a quarter of a century
 * of them for five hundred players is not something to carry up front.
 */

/** What the old pager fitted on a page, and so how many pages it advertised. */
const PAGE_SIZE = 30;
const byFinnishName = new Intl.Collator('fi');

export function RetroHistory({
  loadHistory,
  loadDates,
}: {
  loadHistory: () => Promise<PlayerDetail[]>;
  /** One player's dates, newest first. Asked for when a year is opened. */
  loadDates: (playerId: string) => Promise<string[]>;
}): React.ReactElement {
  const [players, setPlayers] = useState<PlayerDetail[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  /** Which `<playerId>#<year>` rows are open. */
  const [openYears, setOpenYears] = useState<ReadonlySet<string>>(new Set());
  /** Dates per player, kept once fetched: the archive does not change. */
  const [dates, setDates] = useState<ReadonlyMap<string, string[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await loadHistory();
        if (!cancelled) setPlayers(result);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHistory]);

  // A Domino view is sorted by its first column, not by the interesting one.
  const sorted = useMemo(
    () => [...(players ?? [])].sort((a, b) => byFinnishName.compare(a.displayName, b.displayName)),
    [players],
  );

  /**
   * The Nimi column, capped at twice the longest name the archive holds.
   * Measured over the whole archive rather than the page in view, so the
   * column does not jump as the pager walks through it, and in `ch` — the
   * width of a digit in this font — which is what "twice the name" means on
   * a page whose every row is text.
   */
  const nameColumn = useMemo(() => {
    const longest = sorted.reduce(
      (widest, player) => Math.max(widest, player.displayName.length),
      0,
    );
    return `${longest * 2}ch`;
  }, [sorted]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const shown = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const toggle = (playerId: string): void => {
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(playerId)) next.add(playerId);
      return next;
    });
  };

  const toggleYear = useCallback(
    (playerId: string, year: string): void => {
      setOpenYears((previous) => {
        const next = new Set(previous);
        if (!next.delete(`${playerId}#${year}`)) next.add(`${playerId}#${year}`);
        return next;
      });
      // Once per player, however many of their years get opened.
      setDates((previous) => {
        if (previous.has(playerId)) return previous;
        void (async () => {
          try {
            const loaded = await loadDates(playerId);
            setDates((current) => new Map(current).set(playerId, loaded));
          } catch {
            // A view that cannot reach the dates still shows the years.
            setDates((current) => new Map(current).set(playerId, []));
          }
        })();
        return previous;
      });
    },
    [loadDates],
  );

  if (failed) return <div className="retro__viewState">Tietoja ei saatu haettua.</div>;
  if (players === undefined) return <div className="retro__viewState">Haetaan...</div>;

  return (
    <table className="xspDataTable">
      <colgroup>
        <col style={{ width: nameColumn }} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">
            <span className="xspPanelViewColumnHeader">Nimi</span>
          </th>
          <th scope="col">
            <span className="xspPanelViewColumnHeader">Vuosi</span>
          </th>
          <th scope="col">
            <span className="xspPanelViewColumnHeader">Pvm</span>
          </th>
          <th scope="col">
            <span className="xspPanelViewColumnHeader">Kpl</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {shown.map((player) => {
          const expanded = open.has(player.playerId);
          return (
            <Rows
              key={player.playerId}
              player={player}
              expanded={expanded}
              dates={dates.get(player.playerId)}
              openYears={openYears}
              onToggle={() => toggle(player.playerId)}
              onToggleYear={(year) => toggleYear(player.playerId, year)}
            />
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4}>
            <div className="xspPagerContainer">
              <div className="xspPagerRight">
                <Pager page={page} pages={pages} onGo={setPage} />
              </div>
            </div>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/** One player: the name row, and a year row apiece once it is open. */
function Rows({
  player,
  expanded,
  dates,
  openYears,
  onToggle,
  onToggleYear,
}: {
  player: PlayerDetail;
  expanded: boolean;
  /** Every date this player played, once fetched. */
  dates: string[] | undefined;
  openYears: ReadonlySet<string>;
  onToggle: () => void;
  onToggleYear: (year: string) => void;
}): React.ReactElement {
  return (
    <>
      <tr>
        <td className="xspColumnViewStart">
          <div className="xspColumnViewStart">
            <button
              className="retro__twisty"
              type="button"
              aria-label={`${expanded ? 'Sulje' : 'Avaa'} ${player.displayName}`}
              aria-expanded={expanded}
              onClick={onToggle}
            >
              <img src={expanded ? '/retro/collapse.gif' : '/retro/expand.gif'} alt="" />
            </button>
            {/* An <a> with no href in the original — clickable, but nothing
                a keyboard could reach. A button dressed as that link does
                the same job and can be tabbed to. */}
            <button className="retro__viewName" type="button" onClick={onToggle}>
              {player.displayName}
            </button>
          </div>
        </td>
        <td className="xspColumnViewMiddle"></td>
        <td className="xspColumnViewMiddle"></td>
        <td className="xspColumnViewEnd">
          <span className="xspTextViewColumn">{player.total}</span>
        </td>
      </tr>
      {expanded &&
        player.years.map((year) => {
          const yearOpen = openYears.has(`${player.playerId}#${year.year}`);
          const played = (dates ?? []).filter((date) => date.startsWith(year.year));
          return (
            <Fragment key={year.year}>
              <tr>
                <td className="xspColumnViewStart"></td>
                <td className="xspColumnViewMiddle">
                  <button
                    className="retro__twisty"
                    type="button"
                    aria-label={`${yearOpen ? 'Sulje' : 'Avaa'} ${year.year}`}
                    aria-expanded={yearOpen}
                    onClick={() => onToggleYear(year.year)}
                  >
                    <img src={yearOpen ? '/retro/collapse.gif' : '/retro/expand.gif'} alt="" />
                  </button>
                  <span className="xspTextViewColumn">{year.year}</span>
                </td>
                <td className="xspColumnViewMiddle"></td>
                <td className="xspColumnViewEnd">
                  <span className="xspTextViewColumn">{year.count}</span>
                </td>
              </tr>
              {yearOpen &&
                played.map((date) => (
                  <tr key={date}>
                    <td className="xspColumnViewStart"></td>
                    <td className="xspColumnViewMiddle"></td>
                    <td className="xspColumnViewMiddle">
                      <span className="xspTextViewColumn">{formatDate('fi', date)}</span>
                    </td>
                    <td className="xspColumnViewEnd">
                      {/* One game: the leaf of the view, and what every count
                          above it is a sum of. */}
                      <span className="xspTextViewColumn">1</span>
                    </td>
                  </tr>
                ))}
            </Fragment>
          );
        })}
    </>
  );
}

/**
 * Previous | 1 2 3 ... | Next. The current page is plain text rather than a
 * link, which is the only way the old pager said where you were.
 */
function Pager({
  page,
  pages,
  onGo,
}: {
  page: number;
  pages: number;
  onGo: (page: number) => void;
}): React.ReactElement {
  return (
    <>
      <span className="xspPagerNav xspPrevious">
        {page === 0 ? (
          'Previous'
        ) : (
          <button className="retro__pagerLink" type="button" onClick={() => onGo(page - 1)}>
            Previous
          </button>
        )}
      </span>
      <span className="xspPagerNav xspGroup">
        {Array.from({ length: pages }, (_, index) => (
          <span key={index}>
            {index === page ? (
              <span className="xspCurrentItem">{index + 1}</span>
            ) : (
              <button
                className="retro__pagerLink"
                type="button"
                title={`Go to page ${index + 1}`}
                onClick={() => onGo(index)}
              >
                {index + 1}
              </button>
            )}
          </span>
        ))}
      </span>
      <span className="xspPagerNav xspNext">
        {page >= pages - 1 ? (
          'Next'
        ) : (
          <button className="retro__pagerLink" type="button" onClick={() => onGo(page + 1)}>
            Next
          </button>
        )}
      </span>
    </>
  );
}
