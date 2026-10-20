import { describe, expect, it } from 'vitest';
import { judgeDuration } from '../server/media/video/duration-verdict';

/**
 * 09-16 (WR-06, SOCIAL-05; D-474): the verdict `applyReady` reaches on a ready event, as a pure
 * function so no database is needed. A MEMBER upload carries the cap snapshotted at start
 * (`memberCapSeconds`); an admin upload has none and falls back to the static per-purpose cap.
 */
describe('judgeDuration', () => {
  it('a member upload exactly at its snapshotted cap is ok, one second more is too_long', () => {
    expect(
      judgeDuration({ memberCapSeconds: 60, staticCapSeconds: undefined, durationSeconds: 60 }),
    ).toBe('ok');
    expect(
      judgeDuration({ memberCapSeconds: 60, staticCapSeconds: undefined, durationSeconds: 61 }),
    ).toBe('too_long');
  });

  it('a member upload with no measured duration is unmeasurable (fail closed, WR-06)', () => {
    expect(
      judgeDuration({ memberCapSeconds: 60, staticCapSeconds: undefined, durationSeconds: null }),
    ).toBe('unmeasurable');
    expect(
      judgeDuration({ memberCapSeconds: 60, staticCapSeconds: 300, durationSeconds: null }),
    ).toBe('unmeasurable');
  });

  it('an admin upload (no snapshot) keeps today: null is ok, over the static cap is too_long, the cap itself is ok', () => {
    expect(
      judgeDuration({ memberCapSeconds: null, staticCapSeconds: 300, durationSeconds: null }),
    ).toBe('ok');
    expect(
      judgeDuration({ memberCapSeconds: null, staticCapSeconds: 300, durationSeconds: 300 }),
    ).toBe('ok');
    expect(
      judgeDuration({ memberCapSeconds: null, staticCapSeconds: 300, durationSeconds: 301 }),
    ).toBe('too_long');
  });

  it('the member snapshot wins over a larger static cap', () => {
    expect(
      judgeDuration({ memberCapSeconds: 60, staticCapSeconds: 300, durationSeconds: 100 }),
    ).toBe('too_long');
  });

  it('no snapshot and no static cap accepts anything, null included', () => {
    expect(
      judgeDuration({ memberCapSeconds: null, staticCapSeconds: undefined, durationSeconds: null }),
    ).toBe('ok');
    expect(
      judgeDuration({
        memberCapSeconds: null,
        staticCapSeconds: undefined,
        durationSeconds: 99999,
      }),
    ).toBe('ok');
  });

  it('zero seconds is a measured duration and is ok', () => {
    expect(
      judgeDuration({ memberCapSeconds: 60, staticCapSeconds: undefined, durationSeconds: 0 }),
    ).toBe('ok');
    expect(
      judgeDuration({ memberCapSeconds: null, staticCapSeconds: 300, durationSeconds: 0 }),
    ).toBe('ok');
  });
});
