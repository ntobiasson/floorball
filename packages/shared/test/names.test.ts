import { describe, expect, test } from 'vitest';
import { cleanDisplayName, foldForSearch, normalizeName } from '../src/names.js';

describe('normalizeName', () => {
  test('lowercases', () => {
    expect(normalizeName('Matti Virtanen')).toBe('matti virtanen');
  });

  test('trims and collapses internal whitespace', () => {
    expect(normalizeName('  Matti   VIRTANEN ')).toBe('matti virtanen');
  });

  test('collapses tabs and newlines too', () => {
    expect(normalizeName('Matti\tVirtanen\n')).toBe('matti virtanen');
  });

  test('folds Finnish diacritics so one person typed two ways is one player', () => {
    expect(normalizeName('Riikka Mäkelä')).toBe('riikka makela');
    expect(normalizeName('Olli Väänänen')).toBe('olli vaananen');
    expect(normalizeName('Jussi Leskinen')).toBe('jussi leskinen');
  });

  test('folds a precomposed and a decomposed spelling to the same key', () => {
    expect(normalizeName('M\u00e4kel\u00e4')).toBe(normalizeName('Ma\u0308kela\u0308'));
  });

  test('keeps genuinely different names apart', () => {
    expect(normalizeName('Pekka N')).not.toBe(normalizeName('Pekka Nurmi'));
    expect(normalizeName('Olli Salo')).not.toBe(normalizeName('Pekka Nurmi'));
  });

  test('does NOT strip a parenthesised suffix', () => {
    // The import must stay faithful to Domino. Treating "(EHKÄ)" as the same
    // player would silently change the per-player totals the checksum verifies.
    expect(normalizeName('Matti Virtanen (EHKÄ)')).toBe('matti virtanen (ehka)');
    expect(normalizeName('Matti Virtanen (EHKÄ)')).not.toBe(normalizeName('Matti Virtanen'));
  });

  test('does NOT strip a goalkeeper marker', () => {
    expect(normalizeName('Liisa Mäkinen MV')).toBe('liisa makinen mv');
    expect(normalizeName('Pekka Hämäläinen (mv)')).toBe('pekka hamalainen (mv)');
    expect(normalizeName('Pekka Hämäläinen (mv)')).not.toBe(normalizeName('Pekka Hämäläinen'));
  });

  test('is idempotent', () => {
    const once = normalizeName('  Riikka   Mäkelä ');
    expect(normalizeName(once)).toBe(once);
  });

  test('rejects a name that normalises to nothing', () => {
    expect(() => normalizeName('   ')).toThrow();
    expect(() => normalizeName('')).toThrow();
  });
});

describe('cleanDisplayName', () => {
  test('trims and collapses whitespace but preserves case and diacritics', () => {
    expect(cleanDisplayName('  Riikka   Mäkelä ')).toBe('Riikka Mäkelä');
  });

  test('leaves a lowercase name as the person typed it', () => {
    // "antti aalto" is real data; we do not title-case people's names for them.
    expect(cleanDisplayName('antti aalto')).toBe('antti aalto');
  });

  test('rejects an empty name', () => {
    expect(() => cleanDisplayName('  ')).toThrow();
  });
});

describe('foldForSearch', () => {
  test('folds the same way normalizeName does', () => {
    expect(foldForSearch('  Riikka  Mäkelä ')).toBe(normalizeName('Riikka Mäkelä'));
  });

  test('returns an empty string instead of throwing, because a search box is often empty', () => {
    expect(foldForSearch('')).toBe('');
    expect(foldForSearch('   ')).toBe('');
  });
});
