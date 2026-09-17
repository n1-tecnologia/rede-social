import { describe, expect, it } from 'vitest';
import {
  INSTALL_HINT_DISMISS_MS,
  INSTALL_HINT_DISMISSED_KEY,
  isIosSafari,
  isStandalone,
  shouldShowInstallHint,
} from './InstallHint';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1';
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const DAY = 24 * 3600 * 1000;
const now = Date.UTC(2026, 8, 16, 12, 0, 0);

describe('InstallHint helpers — isIosSafari', () => {
  it('1. iPhone and iPad Safari are iOS Safari', () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
    expect(isIosSafari(IPAD_SAFARI)).toBe(true);
  });

  it('2. Chrome/Firefox on iOS, Android Chrome and desktop Safari are not', () => {
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
    expect(isIosSafari(IPHONE_FIREFOX)).toBe(false);
    expect(isIosSafari(ANDROID_CHROME)).toBe(false);
    expect(isIosSafari(MAC_SAFARI)).toBe(false);
    expect(isIosSafari('')).toBe(false);
  });
});

describe('InstallHint helpers — isStandalone', () => {
  it('3. the display-mode media query wins', () => {
    expect(isStandalone({ matchMedia: () => ({ matches: true }), navigator: {} })).toBe(true);
  });

  it('4. legacy navigator.standalone counts; neither → false', () => {
    expect(
      isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }),
    ).toBe(true);
    expect(
      isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: false } }),
    ).toBe(false);
    expect(isStandalone({})).toBe(false);
  });
});

describe('InstallHint helpers — shouldShowInstallHint (14-day dismissal, T-02-78)', () => {
  it('5. iOS Safari, not standalone, never dismissed → show', () => {
    expect(
      shouldShowInstallHint({
        userAgent: IPHONE_SAFARI,
        standalone: false,
        dismissedAt: null,
        now,
      }),
    ).toBe(true);
  });

  it('6. standalone (already installed) → never', () => {
    expect(
      shouldShowInstallHint({ userAgent: IPHONE_SAFARI, standalone: true, dismissedAt: null, now }),
    ).toBe(false);
  });

  it('7. a non-iOS-Safari UA → never', () => {
    expect(
      shouldShowInstallHint({
        userAgent: ANDROID_CHROME,
        standalone: false,
        dismissedAt: null,
        now,
      }),
    ).toBe(false);
    expect(
      shouldShowInstallHint({
        userAgent: IPHONE_CHROME,
        standalone: false,
        dismissedAt: null,
        now,
      }),
    ).toBe(false);
  });

  it('8. dismissed 13 days ago → hidden; 15 days ago → shown again', () => {
    expect(
      shouldShowInstallHint({
        userAgent: IPHONE_SAFARI,
        standalone: false,
        dismissedAt: now - 13 * DAY,
        now,
      }),
    ).toBe(false);
    expect(
      shouldShowInstallHint({
        userAgent: IPHONE_SAFARI,
        standalone: false,
        dismissedAt: now - 15 * DAY,
        now,
      }),
    ).toBe(true);
  });

  it('9. a corrupt dismissal (NaN) reads as not dismissed', () => {
    expect(
      shouldShowInstallHint({
        userAgent: IPHONE_SAFARI,
        standalone: false,
        dismissedAt: Number('garbage'),
        now,
      }),
    ).toBe(true);
  });

  it('10. constants: the storage key and the 14-day window', () => {
    expect(INSTALL_HINT_DISMISSED_KEY).toBe('tria_install_hint_dismissed');
    expect(INSTALL_HINT_DISMISS_MS).toBe(14 * DAY);
  });
});
