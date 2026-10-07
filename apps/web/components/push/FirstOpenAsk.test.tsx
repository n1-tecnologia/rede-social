// @vitest-environment happy-dom
import path from 'node:path';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { PUSH_FIRSTOPEN_ASKED_KEY } from '@/lib/push';
import { FIRST_OPEN_ASK_DELAY_MS, FIRST_OPEN_ASK_RETRY_MS, FirstOpenAsk } from './FirstOpenAsk';

/**
 * The one-time notification ask of the installed app (quick 261007-kyp): real catalog, a fake push
 * stack (Notification, PushManager, a service worker registration, the BFF POST) and fake timers.
 * `motion/react` is replaced by plain elements, as in InstallHint.test.ts (happy-dom's
 * `Animation.cancel()` rejects a promise motion never catches).
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

const KEY =
  'BJHs89NeHI8M9hJQWfvb1_irumrdO-cNFTwQZUHrWx3Lp3smi-NAifeRu5Pm4rWfwmQCL5GvEdK8_PVtNafxV1k';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

// happy-dom replaces `URL`, so the catalog is resolved from the package root (vitest's cwd).
const messages = loadMessages(path.resolve(process.cwd(), 'messages/pt-BR'));
const softAsk = (
  messages as {
    notifications: {
      softAsk: { title: string; bodyMember: string; bodyStaff: string; cta: string };
    };
    pwa: { install: { dismiss: string } };
  }
).notifications.softAsk;
const LATER = (messages as { pwa: { install: { dismiss: string } } }).pwa.install.dismiss;

const Provider = NextIntlClientProvider as unknown as (props: {
  locale: string;
  messages: unknown;
  timeZone: string;
  children?: ReactNode;
}) => ReactNode;

type Env = {
  standalone?: boolean;
  permission?: 'default' | 'granted' | 'denied';
  answer?: 'granted' | 'denied' | 'default';
};

let requestPermission: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function setEnv({ standalone = true, permission = 'default', answer = 'granted' }: Env = {}) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ANDROID_UA, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true });
  Object.defineProperty(window.navigator, 'standalone', { value: undefined, configurable: true });
  window.matchMedia = ((query: string) => ({
    matches: standalone && query.includes('standalone'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;

  requestPermission = vi.fn(async () => answer);
  vi.stubGlobal('Notification', { permission, requestPermission });
  vi.stubGlobal('PushManager', function PushManager() {});

  let current: unknown = null;
  const subscription = {
    endpoint: 'https://push.fake.test/sub/1',
    options: null,
    toJSON: () => ({ endpoint: 'https://push.fake.test/sub/1', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => current),
      subscribe: vi.fn(async () => {
        current = subscription;
        return subscription;
      }),
    },
  };
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
  });
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
}

function ask(over: { vapidKey?: string; staff?: boolean } = {}) {
  return (
    <Provider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <ToastProvider>
        <FirstOpenAsk
          vapidKey={over.vapidKey ?? KEY}
          tenantName="Rede Demo"
          staff={over.staff ?? false}
        />
      </ToastProvider>
    </Provider>
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(over: { vapidKey?: string; staff?: boolean } = {}) {
  const view = render(ask(over));
  await advance(0);
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.querySelectorAll('[data-test-modal]').forEach((el) => {
    el.remove();
  });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('FirstOpenAsk', () => {
  it('1. standalone, permission default, nothing stored: the sheet opens after the delay and nothing prompts', async () => {
    setEnv();
    await mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(FIRST_OPEN_ASK_DELAY_MS);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(softAsk.title)).toBeTruthy();
    expect(screen.getByText(softAsk.bodyMember.replace('{tenant}', 'Rede Demo'))).toBeTruthy();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('2. tapping Ativar notificações prompts once, saves the subscription, stores the answer and closes', async () => {
    setEnv();
    await mount();
    await advance(FIRST_OPEN_ASK_DELAY_MS);
    fireEvent.click(screen.getByRole('button', { name: softAsk.cta }));
    await advance(10);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/push/subscriptions');
    expect(window.localStorage.getItem(PUSH_FIRSTOPEN_ASKED_KEY)).toBe('enabled');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('3. Agora não stores the answer and closes; a fresh mount shows nothing', async () => {
    setEnv();
    await mount();
    await advance(FIRST_OPEN_ASK_DELAY_MS);
    fireEvent.click(screen.getByRole('button', { name: LATER }));
    await advance(10);
    expect(window.localStorage.getItem(PUSH_FIRSTOPEN_ASKED_KEY)).toBe('later');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
    cleanup();

    await mount();
    await advance(FIRST_OPEN_ASK_DELAY_MS + FIRST_OPEN_ASK_RETRY_MS * 3);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('4. a denied answer stores it, closes, and a fresh mount shows nothing', async () => {
    setEnv({ answer: 'denied' });
    await mount();
    await advance(FIRST_OPEN_ASK_DELAY_MS);
    fireEvent.click(screen.getByRole('button', { name: softAsk.cta }));
    await advance(10);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(PUSH_FIRSTOPEN_ASKED_KEY)).toBe('denied');
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();

    await mount();
    await advance(FIRST_OPEN_ASK_DELAY_MS + FIRST_OPEN_ASK_RETRY_MS * 3);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('5. already denied, not standalone, or no VAPID key: the sheet never opens', async () => {
    const wait = FIRST_OPEN_ASK_DELAY_MS + FIRST_OPEN_ASK_RETRY_MS * 3;

    setEnv({ permission: 'denied' });
    await mount();
    await advance(wait);
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();

    setEnv({ standalone: false });
    await mount();
    await advance(wait);
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();

    setEnv();
    await mount({ vapidKey: '' });
    await advance(wait);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('6. with another aria-modal dialog open the sheet waits, and opens once it is gone', async () => {
    setEnv();
    const other = document.createElement('div');
    other.setAttribute('aria-modal', 'true');
    other.setAttribute('data-test-modal', '');
    document.body.appendChild(other);

    await mount();
    await advance(FIRST_OPEN_ASK_DELAY_MS + FIRST_OPEN_ASK_RETRY_MS * 2);
    expect(screen.queryByText(softAsk.title)).toBeNull();

    other.remove();
    await advance(FIRST_OPEN_ASK_RETRY_MS);
    expect(screen.getByText(softAsk.title)).toBeTruthy();
    expect(window.localStorage.getItem(PUSH_FIRSTOPEN_ASKED_KEY)).toBeNull();
  });

  it('7. staff get the staff body', async () => {
    setEnv();
    await mount({ staff: true });
    await advance(FIRST_OPEN_ASK_DELAY_MS);
    expect(screen.getByText(softAsk.bodyStaff)).toBeTruthy();
  });
});
