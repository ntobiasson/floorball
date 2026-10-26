import { useEffect, useId, useState } from 'react';
import { TURNSTILE_ACTIONS, type Announcement, type AnnouncementInput } from '@sahlykanta/shared';
import { finnishDate } from '../lib/finnish.js';
import { Turnstile, TurnstileFailure } from '../components/Turnstile.js';

/**
 * Managing the announcements shown on the landing page.
 *
 * Unlisted: nothing links here, and knowing the address is the only thing
 * standing between a visitor and this page. That is a deliberate choice, and
 * a limited one — it keeps the page out of the way of people who have no
 * business on it, but it is not a lock. Anyone who learns the address can
 * add and remove announcements, exactly as anyone can already add and remove
 * names on the day's list.
 *
 * One Turnstile widget serves the whole page: adding and removing both spend
 * its token and then reset it. It is drawn last, under both cards, so that it
 * reads as a footnote to the page rather than as another control to deal with
 * on the way to the button — which is what it was doing inside the form. The
 * Poista buttons below wait on the same token. It keeps scripts off these
 * endpoints and identifies nobody; calling the API directly now needs a
 * solved challenge, and that is the only thing that changed here.
 */

export function Notices({
  load,
  add,
  remove,
}: {
  load: () => Promise<{ announcements: Announcement[] }>;
  add: (input: AnnouncementInput, turnstileToken: string) => Promise<Announcement>;
  remove: (id: string, turnstileToken: string) => Promise<void>;
}): React.ReactElement {
  const fromId = useId();
  const toId = useId();

  const [announcements, setAnnouncements] = useState<Announcement[] | undefined>(undefined);
  const [body, setBody] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
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
    if (body.trim().length === 0 || busy || token === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await add(
        {
          body: body.trim(),
          ...(validFrom.length > 0 ? { validFrom } : {}),
          ...(validTo.length > 0 ? { validTo } : {}),
        },
        token,
      );
      setBody('');
      setValidFrom('');
      setValidTo('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tiedotteen lisäys ei onnistunut.');
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
      setError(cause instanceof Error ? cause.message : 'Tiedotteen poisto ei onnistunut.');
    } finally {
      // Spent either way, and the next removal needs its own.
      setAttempt((previous) => previous + 1);
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
          Tiedote
        </h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* The heading above names this field; a second "Tiedote" label
              under it would just say the same thing twice. */}
          <textarea
            className="field__textarea"
            aria-labelledby="notices-title"
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
            disabled={busy || body.trim().length === 0 || token === undefined}
          >
            Lisää tiedote
          </button>
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
              <div
                className={
                  confirming === announcement.id
                    ? 'notice-row notice-row--confirming'
                    : 'notice-row'
                }
                key={announcement.id}
              >
                <span className="notice-row__text">
                  {announcement.body}
                  {shown !== undefined && <span className="notice-row__dates">{shown}</span>}
                </span>

                {confirming === announcement.id ? (
                  // Its own line, so the announcement stays readable while
                  // the question is being asked.
                  <div className="notice-row__actions">
                    {/* The button that opened this also said "Poista", so
                        confirming looked like nothing had happened. */}
                    <span className="notice-row__question">Poistetaanko?</span>
                    <button
                      className="notice-row__confirm"
                      type="button"
                      aria-label={`Vahvista: poista tiedote ${announcement.body}`}
                      disabled={busy || token === undefined}
                      onClick={() => void drop(announcement.id)}
                    >
                      Kyllä
                    </button>
                    <button
                      className="notice-row__cancel"
                      type="button"
                      aria-label={`Peruuta: tiedote ${announcement.body} jää`}
                      onClick={() => setConfirming(undefined)}
                    >
                      Peru
                    </button>
                  </div>
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

      {/*
        Last on the page, under both cards. It is outside the form on purpose:
        the hidden cf-turnstile-response input it renders is never read by a
        native form submission here — the token reaches the API through the
        callback below and fetch — so nothing is lost by moving it out.
      */}
      <Turnstile
        action={TURNSTILE_ACTIONS.announce}
        resetKey={attempt}
        reloadKey={reload}
        onToken={setToken}
        onFailure={(code) => setFailure({ code })}
      />
    </>
  );
}
