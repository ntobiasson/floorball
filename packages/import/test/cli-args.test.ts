import { describe, expect, test } from 'vitest';
import { parseArgs, resumePosition } from '../src/cli-args.js';

describe('parseArgs', () => {
  test('defaults to a full run with the standard spacing', () => {
    const args = parseArgs([]);
    expect(args.limit).toBeUndefined();
    expect(args.delayMs).toBe(400);
    expect(args.resume).toBe(false);
  });

  test('accepts a positive limit', () => {
    expect(parseArgs(['--limit', '5']).limit).toBe(5);
  });

  test('rejects a limit with no value, rather than running the full walk', () => {
    // `--limit` as the last argument used to yield NaN, and `players.length
    // >= NaN` is false forever: the operator asks for a 5-player dry run and
    // gets a 2.5-hour hammering of someone else's production server.
    expect(() => parseArgs(['--limit'])).toThrow(/--limit/);
  });

  test('rejects a limit followed by another flag', () => {
    expect(() => parseArgs(['--limit', '--out', './x'])).toThrow(/--limit/);
  });

  test('rejects a non-numeric limit', () => {
    expect(() => parseArgs(['--limit', 'kaikki'])).toThrow(/--limit/);
  });

  test('rejects zero and negative limits', () => {
    expect(() => parseArgs(['--limit', '0'])).toThrow(/--limit/);
    expect(() => parseArgs(['--limit', '-3'])).toThrow(/--limit/);
  });

  test('rejects a fractional limit', () => {
    expect(() => parseArgs(['--limit', '2.5'])).toThrow(/--limit/);
  });

  test('rejects a delay below the polite floor', () => {
    // This walks a live third-party server for hours; there is a floor.
    expect(() => parseArgs(['--delay', '10'])).toThrow(/--delay/);
  });

  test('accepts a longer delay', () => {
    expect(parseArgs(['--delay', '1000']).delayMs).toBe(1000);
  });

  test('refuses a url that is not the activity page', () => {
    expect(() => parseArgs(['--url', 'http://example.test/db.nsf/pelit.xsp'])).toThrow(
      /peliaktiivisuus/i,
    );
  });

  test('takes an explicit output directory', () => {
    expect(parseArgs(['--out', '/tmp/harvest']).outDir).toBe('/tmp/harvest');
  });

  test('rejects --out with no value', () => {
    expect(() => parseArgs(['--out'])).toThrow(/--out/);
  });
});

describe('resumePosition', () => {
  test('reads the last completed player position', () => {
    expect(resumePosition({ lastPosition: '300' })).toBe(300);
  });

  test('refuses an empty position instead of silently restarting from zero', () => {
    // A player row without an expand node checkpoints as '', and Number('')
    // is 0 — the resume would walk the whole view again and append duplicates.
    expect(() => resumePosition({ lastPosition: '' })).toThrow(/checkpoint/i);
  });

  test('refuses a missing position', () => {
    expect(() => resumePosition({})).toThrow(/checkpoint/i);
  });

  test('refuses a non-numeric position', () => {
    expect(() => resumePosition({ lastPosition: '3.1' })).toThrow(/checkpoint/i);
    expect(() => resumePosition({ lastPosition: 'kolme' })).toThrow(/checkpoint/i);
  });
});
