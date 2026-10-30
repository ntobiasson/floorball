import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  detectLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  storeLocale,
} from '../src/lib/i18n/locale.js';

describe('detectLocale', () => {
  test('takes the first language the app actually has', () => {
    expect(detectLocale(['en-GB', 'fi'])).toBe('en');
  });

  test('matches on the primary subtag, so every English is English', () => {
    expect(detectLocale(['en-US'])).toBe('en');
  });

  test('finds Ukrainian', () => {
    expect(detectLocale(['uk-UA'])).toBe('uk');
  });

  test('walks past languages the app does not have', () => {
    expect(detectLocale(['sv-SE', 'de', 'uk'])).toBe('uk');
  });

  test('falls back to Finnish when nothing matches', () => {
    expect(detectLocale(['sv-SE', 'de'])).toBe('fi');
  });

  test('falls back to Finnish when the browser offers nothing', () => {
    expect(detectLocale([])).toBe('fi');
  });

  test('does not care how the tag is cased', () => {
    expect(detectLocale(['UK'])).toBe('uk');
  });
});

describe('the stored choice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('round-trips', () => {
    storeLocale('uk');
    expect(readStoredLocale()).toBe('uk');
  });

  test('is nothing at all until somebody chooses', () => {
    expect(readStoredLocale()).toBeUndefined();
  });

  test('ignores a stored value that is not a language we have', () => {
    // Left by an older version, or edited by hand.
    localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    expect(readStoredLocale()).toBeUndefined();
  });

  test('survives a read that throws', () => {
    // A private window, or a browser with site data blocked. This is the
    // first thing the app has ever stored per visitor, so it has to work
    // where storing is refused.
    const denied = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(readStoredLocale()).toBeUndefined();
    denied.mockRestore();
  });

  test('survives a write that throws', () => {
    const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => storeLocale('en')).not.toThrow();
    denied.mockRestore();
  });
});
