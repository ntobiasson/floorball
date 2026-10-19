import { useEffect, useId, useState } from 'react';
import type { Announcement, AnnouncementInput } from '@sahlykanta/shared';
import { finnishDate } from '../lib/finnish.js';

/**
 * Managing the announcements shown on the landing page.
 *
 * Unlisted: nothing links here, and knowing the address is the only thing
 * standing between a visitor and this page. That is a deliberate choice, and
 * a limited one — it keeps the page out of the way of people who have no
 * business on it, but it is not a lock. Anyone who learns the address, or who
 * calls the API directly, can add and remove announcements, exactly as anyone
 * can already add and remove names on the day's list.
 */

export function Notices({
  load,
  add,
  remove,
}: {
  load: () => Promise<{ announcements: Announcement[] }>;
  add: (input: AnnouncementInput) => Promise<Announcement>;
  remove: (id: string) => Promise<void>;
}): React.ReactElement {
  const bodyId = useId();
  const fromId = useId();
  const toId = useId();

  const [announcements, setAnnouncements] = useState<Announcement[] | undefined>(undefined);
  const [body, setBody] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    // An administrative page has no business in search results. The rest of
    // the app is a single index.html, so this has to be set while the page is
    // open and taken off again when it is not.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const previousTitle = document.title;
    document.title = 'Tiedotteet';
    return () => {
      meta.remove();
      document.title = previousTitle;
    };
  }, []);

  const refresh = async (): Promise<void> => {
    setAnnouncements((await load()).announcements);
  };

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Tiedotteiden haku ei onnistunut.');
        setAnnouncements([]);
      }
    })();
    // Deliberately once, on mount: `load` is stable for the lifetime of the
    // page, and re-running on every render would poll the API.
  }, []);

  const submit = async (): Promise<void> => {
    if (body.trim().length === 0 || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await add({
        body: body.trim(),
        ...(validFrom.length > 0 ? { validFrom } : {}),
        ...(validTo.length > 0 ? { validTo } : {}),
      });
      setBody('');
      setValidFrom('');
      setValidTo('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tiedotteen lisäys ei onnistunut.');
    } finally {
      setBusy(false);
    }
  };

  const drop = async (id: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await remove(id);
      setConfirming(undefined);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tiedotteen poisto ei onnistunut.');
    } finally {
      setBusy(false);
    }
  };

  const window_ = (announcement: Announcement): string | undefined => {
    const { validFrom: from, validTo: to } = announcement;
    if (from === undefined && to === undefined) return undefined;
    if (from !== undefined && to !== undefined) {
      return `Näytetään ${finnishDate(from)} – ${finnishDate(to)}`;
    }
    if (from !== undefined) return `Näytetään alkaen ${finnishDate(from)}`;
    return `Näytetään ${finnishDate(to as string)} asti`;
  };

  return (
    <>
      <section className="card" aria-labelledby="notices-title">
        <h1 id="notices-title" style={{ margin: 0, fontSize: '21px', fontWeight: 800 }}>
          Tiedotteet
        </h1>
        <p className="unlisted-note">
          Tälle sivulle ei ole linkkiä, mutta kuka tahansa voi lisätä ja poistaa tiedotteita.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="field__label" htmlFor={bodyId}>
            Tiedote
          </label>
          <textarea
            className="field__textarea"
            id={bodyId}
            value={body}
            maxLength={500}
            placeholder="Esim. Kenttä varattu 21.10. klo 18–19."
            onChange={(event) => setBody(event.target.value)}
          />

          <div className="field__row">
            <label htmlFor={fromId}>
              Näytetään alkaen
              <input
                className="field__date"
                id={fromId}
                type="date"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
              />
            </label>
            <label htmlFor={toId}>
              Näytetään asti
              <input
                className="field__date"
                id={toId}
                type="date"
                value={validTo}
                onChange={(event) => setValidTo(event.target.value)}
              />
            </label>
          </div>

          <button
            className="button"
            type="submit"
            aria-busy={busy}
            disabled={busy || body.trim().length === 0}
          >
            Lisää tiedote
          </button>
        </form>

        {error !== undefined && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="notices-list-title">
        <h2 className="section__label" id="notices-list-title">
          Kaikki tiedotteet
        </h2>

        {announcements === undefined ? (
          <p className="field__hint">Haetaan…</p>
        ) : announcements.length === 0 ? (
          <p className="field__hint">Ei tiedotteita.</p>
        ) : (
          announcements.map((announcement) => {
            const shown = window_(announcement);
            return (
              <div className="notice-row" key={announcement.id}>
                <span className="notice-row__text">
                  {announcement.body}
                  {shown !== undefined && <span className="notice-row__dates">{shown}</span>}
                </span>

                {confirming === announcement.id ? (
                  <>
                    <button
                      className="notice-row__confirm"
                      type="button"
                      aria-label={`Vahvista: poista tiedote ${announcement.body}`}
                      disabled={busy}
                      onClick={() => void drop(announcement.id)}
                    >
                      Poista
                    </button>
                    <button
                      className="notice-row__cancel"
                      type="button"
                      aria-label={`Peruuta: tiedote ${announcement.body} jää`}
                      onClick={() => setConfirming(undefined)}
                    >
                      Peru
                    </button>
                  </>
                ) : (
                  <button
                    className="notice-row__drop"
                    type="button"
                    aria-label={`Poista tiedote ${announcement.body}`}
                    onClick={() => {
                      setError(undefined);
                      setConfirming(announcement.id);
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
    </>
  );
}
