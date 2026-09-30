// @vitest-environment happy-dom
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import {
  INSTALL_HINT_DISMISS_MS,
  INSTALL_HINT_DISMISSED_KEY,
  InstallHint,
  isIosSafari,
  isStandalone,
  shouldShowInstallHint,
} from './InstallHint';

/**
 * `motion/react`, replaced by plain elements for the rendered push-variant cases (happy-dom's
 * `Animation.cancel()` rejects a promise motion never catches; the ReelsHost.test.tsx precedent).
 * ONE component per tag, cached, so the sheet's panel never remounts between renders.
 */
vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'layout',
    'drag',
    'dragConstraints',
    'dragElastic',
    'onDragEnd',
  ]);
  const cache = new Map<string, unknown>();
  const proxy = new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        const cached = cache.get(tag);
        if (cached) return cached;
        const component = forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const plain: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(props)) {
            if (!MOTION_ONLY.has(key)) plain[key] = value;
          }
          return createElement(tag, { ...plain, ref });
        });
        cache.set(tag, component);
        return component;
      },
    },
  );
  return {
    motion: proxy,
    AnimatePresence: ({ children }: { children?: unknown }) => children,
    useReducedMotion: () => true,
  };
});

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
    expect(INSTALL_HINT_DISMISSED_KEY).toBe('rede_install_hint_dismissed');
    expect(INSTALL_HINT_DISMISS_MS).toBe(14 * DAY);
  });
});

describe('InstallHint push variant (07-07, UI-D-257)', () => {
  // happy-dom replaces `URL`, so the catalog is resolved from the package root (vitest's cwd).
  const messages = loadMessages(path.resolve(process.cwd(), 'messages/pt-BR'));
  const pwa = (messages as { pwa: { install: Record<string, unknown> } }).pwa.install;
  const push = pwa.push as { title: string; body: string; confirm: string };

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  // createElement's overloads infer neither `InstallHint`'s defaulted props parameter nor the
  // provider's required `children` passed as the third argument; these typed views fix both.
  const Hint = InstallHint as (props: NonNullable<Parameters<typeof InstallHint>[0]>) => ReactNode;
  const Provider = NextIntlClientProvider as unknown as (props: {
    locale: string;
    messages: unknown;
    timeZone: string;
    children?: ReactNode;
  }) => ReactNode;

  function renderHint(onClose: () => void) {
    return render(
      createElement(
        Provider,
        { locale: 'pt-BR', messages, timeZone: 'America/Sao_Paulo' },
        createElement(Hint, { open: true, variant: 'push', onClose }),
      ),
    );
  }

  it('11. shows the push copy and ONE "Entendi", never "Agora não"', async () => {
    renderHint(vi.fn());
    await act(async () => {});
    expect(screen.getByText(push.title)).toBeTruthy();
    expect(screen.getByText(push.body)).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([push.confirm]);
    expect(screen.queryByText(String(pwa.dismiss))).toBeNull();
  });

  it('12. "Entendi" and Escape call onClose and write NO dismissal', async () => {
    const onClose = vi.fn();
    renderHint(onClose);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: push.confirm }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const onEscape = vi.fn();
    renderHint(onEscape);
    await act(async () => {});
    fireEvent.keyDown(screen.getByRole('button', { name: push.confirm }), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY)).toBeNull();
  });
});
