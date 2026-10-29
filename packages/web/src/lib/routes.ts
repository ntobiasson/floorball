/**
 * The history page. Linked from the tab bar, so unlike the announcements
 * address this one is meant to be found.
 */
export const HISTORY_PATH = '/peliaktiivisuus';

/**
 * Where the announcements page lives.
 *
 * A fixed, readable address, chosen so it can be told to someone over the
 * phone. Nothing in the application links here, but the address is an obvious
 * one, so treat the page as reachable by anyone who visits the site rather
 * than only by people who were given it. That matches the API, which accepts
 * announcement writes from any caller, and the day's list, where anyone can
 * already add or remove any name.
 */
export const NOTICES_PATH = '/tiedotteet';

/**
 * Where the schedule settings page lives.
 *
 * An unlisted, speakable address, protecting the page from being stumbled
 * into and nothing more — the same arrangement as the announcements address
 * above, and for the same reason: the API accepts schedule writes from any
 * caller who passes the bot check, exactly as it already accepts
 * announcement writes and as the day's list already accepts any name.
 */
export const SETTINGS_PATH = '/asetukset';
