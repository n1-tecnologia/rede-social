// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  anotherModalOpen,
  disablePush,
  enablePush,
  firstOpenAskDue,
  isIosLike,
  PUSH_FIRSTOPEN_ASKED_KEY,
  PUSH_SOFTASK_DISMISSED_KEY,
  type PushRegistrationLike,
  type PushSubscriptionLike,
  type PushWindowLike,
  pushSupport,
  readFirstOpenAsked,
  readPushState,
  readSoftAskDismissed,
  syncPushOnOpen,
  urlBase64ToUint8Array,
  writeFirstOpenAsked,
  writeSoftAskDismissed,
} from './push';

/**
 * 07-07: the client subscribe flow shared by the soft-ask card and the Configurações switch
 * (D-233, D-234, PWA-02). Pinned here: the iOS/iPadOS gate, every support and state branch, the
 * gesture rule (the permission prompt is the first await), the denied/dismissed/rollback paths, the
 * VAPID-rotation resync with no prompt, and the 2-second logout bound.
 */

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
  ipados:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
};

const KEY =
  'BJHs89NeHI8M9hJQWfvb1_irumrdO-cNFTwQZUHrWx3Lp3smi-NAifeRu5Pm4rWfwmQCL5GvEdK8_PVtNafxV1k';
const OTHER_KEY = `BA${'A'.repeat(85)}`;

function win(
  over: Partial<PushWindowLike> & { ua?: string; touch?: number; standalone?: boolean },
) {
  const { ua = UA.android, touch = 0, standalone = false, ...rest } = over;
  return {
    matchMedia: () => ({ matches: standalone }),
    navigator: { userAgent: ua, maxTouchPoints: touch, serviceWorker: {} },
    PushManager: function PushManager() {},
    Notification: { permission: 'default' },
    ...rest,
  } as PushWindowLike;
}

type Log = string[];

function fakeSubscription(log: Log, key = KEY): PushSubscriptionLike {
  const bytes = urlBase64ToUint8Array(key);
  return {
    endpoint: 'https://push.fake.test/sub/1',
    options: { applicationServerKey: bytes.buffer as ArrayBuffer },
    toJSON: () => ({
      endpoint: 'https://push.fake.test/sub/1',
      expirationTime: null,
      keys: { p256dh: 'p', auth: 'a' },
    }),
    unsubscribe: vi.fn(async () => {
      log.push('unsubscribe');
      return true;
    }),
  } as PushSubscriptionLike;
}

function fakeRegistration(log: Log, existing: PushSubscriptionLike | null = null) {
  let current = existing;
  const registration: PushRegistrationLike = {
    pushManager: {
      getSubscription: vi.fn(async () => {
        log.push('getSubscription');
        return current;
      }),
      subscribe: vi.fn(async ({ applicationServerKey }) => {
        log.push(`subscribe:${applicationServerKey.length}`);
        current = fakeSubscription(log);
        return current;
      }),
    },
  };
  return registration;
}

function stubNotification(log: Log, answer: NotificationPermission, permission = 'default') {
  vi.stubGlobal('Notification', {
    permission,
    requestPermission: vi.fn(async () => {
      log.push('requestPermission');
      return answer;
    }),
  });
}

function stubFetch(log: Log, status = 204) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    log.push(`fetch:${init?.method}:${url}`);
    return new Response(null, { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('isIosLike (D-234, RESEARCH Pitfall 13)', () => {
  it('1. iPhone and iPad for any browser, iPadOS as a Mac with touch, never a desktop Mac or Android', () => {
    expect(isIosLike(UA.iphone, 5)).toBe(true);
    expect(isIosLike(UA.iphoneChrome, 5)).toBe(true);
    expect(isIosLike(UA.ipados, 5)).toBe(true);
    expect(isIosLike(UA.ipados, 0)).toBe(false);
    expect(isIosLike(UA.ipados, 1)).toBe(false);
    expect(isIosLike(UA.android, 5)).toBe(false);
  });
});

describe('pushSupport', () => {
  it('2. no VAPID key or a missing API is unsupported', () => {
    expect(pushSupport(win({}), null)).toBe('unsupported');
    expect(pushSupport(win({}), '')).toBe('unsupported');
    expect(pushSupport(win({ PushManager: undefined }), KEY)).toBe('unsupported');
    expect(pushSupport(win({ Notification: undefined }), KEY)).toBe('unsupported');
    expect(pushSupport(win({ navigator: { userAgent: UA.android, maxTouchPoints: 0 } }), KEY)).toBe(
      'unsupported',
    );
  });

  it('3. iOS/iPadOS outside standalone is ios-install, even with no PushManager', () => {
    expect(pushSupport(win({ ua: UA.iphone, touch: 5, PushManager: undefined }), KEY)).toBe(
      'ios-install',
    );
    expect(pushSupport(win({ ua: UA.ipados, touch: 5 }), KEY)).toBe('ios-install');
  });

  it('4. standalone iOS 16.4+ is available; standalone below 16.4 (no PushManager) is unsupported', () => {
    expect(pushSupport(win({ ua: UA.iphone, touch: 5, standalone: true }), KEY)).toBe('available');
    expect(
      pushSupport(win({ ua: UA.iphone, touch: 5, standalone: true, PushManager: undefined }), KEY),
    ).toBe('unsupported');
    expect(pushSupport(win({}), KEY)).toBe('available');
  });
});

describe('readPushState', () => {
  it('5. every branch: unsupported, ios-install, denied, off, on, no registration', async () => {
    const log: Log = [];
    const none = fakeRegistration(log);
    const some = fakeRegistration(log, fakeSubscription(log));
    const env = (w: PushWindowLike) => ({ win: w, vapidKey: KEY });
    expect(await readPushState(none, { win: win({}), vapidKey: null })).toBe('unsupported');
    expect(await readPushState(none, env(win({ ua: UA.iphone, touch: 5 })))).toBe('ios-install');
    expect(await readPushState(some, env(win({ Notification: { permission: 'denied' } })))).toBe(
      'denied',
    );
    expect(await readPushState(some, env(win({ Notification: { permission: 'default' } })))).toBe(
      'off',
    );
    expect(await readPushState(none, env(win({ Notification: { permission: 'granted' } })))).toBe(
      'off',
    );
    expect(await readPushState(some, env(win({ Notification: { permission: 'granted' } })))).toBe(
      'on',
    );
    expect(await readPushState(null, env(win({ Notification: { permission: 'granted' } })))).toBe(
      'unsupported',
    );
  });
});

describe('enablePush (the gesture rule, UI-D-255)', () => {
  it('6. requestPermission is the FIRST call, then subscribe, then the POST last', async () => {
    const log: Log = [];
    stubNotification(log, 'granted');
    const fetchMock = stubFetch(log);
    const registration = fakeRegistration(log);
    expect(await enablePush({ registration, vapidKey: KEY })).toBe('on');
    expect(log[0]).toBe('requestPermission');
    expect(log).toEqual([
      'requestPermission',
      'getSubscription',
      'subscribe:65',
      'fetch:POST:/api/push/subscriptions',
    ]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(Object.keys(body).sort()).toEqual(['endpoint', 'keys', 'userAgent']);
    expect(body.endpoint).toBe('https://push.fake.test/sub/1');
  });

  it('7. denied and dismissed return without subscribing or posting', async () => {
    for (const [answer, expected] of [
      ['denied', 'denied'],
      ['default', 'dismissed'],
    ] as const) {
      const log: Log = [];
      stubNotification(log, answer);
      stubFetch(log);
      const registration = fakeRegistration(log);
      expect(await enablePush({ registration, vapidKey: KEY })).toBe(expected);
      expect(log).toEqual(['requestPermission']);
    }
  });

  it('8. a failed save unsubscribes again and throws (no orphan subscription)', async () => {
    const log: Log = [];
    stubNotification(log, 'granted');
    stubFetch(log, 500);
    const registration = fakeRegistration(log);
    await expect(enablePush({ registration, vapidKey: KEY })).rejects.toThrow('push.save_failed');
    expect(log.slice(-2)).toEqual(['fetch:POST:/api/push/subscriptions', 'unsubscribe']);
  });

  it('9. a subscription made with another key is replaced (subscribe would otherwise throw)', async () => {
    const log: Log = [];
    stubNotification(log, 'granted', 'granted');
    stubFetch(log);
    const registration = fakeRegistration(log, fakeSubscription(log, OTHER_KEY));
    expect(await enablePush({ registration, vapidKey: KEY })).toBe('on');
    expect(log).toEqual([
      'requestPermission',
      'getSubscription',
      'unsubscribe',
      'subscribe:65',
      'fetch:POST:/api/push/subscriptions',
    ]);
  });
});

describe('syncPushOnOpen (the VAPID-rotation resync, truth 8)', () => {
  it('10. same key re-POSTs; another key unsubscribes then subscribes, with NO prompt', async () => {
    const same: Log = [];
    stubNotification(same, 'granted', 'granted');
    stubFetch(same);
    expect(await syncPushOnOpen(fakeRegistration(same, fakeSubscription(same)), KEY)).toBe(
      'synced',
    );
    expect(same).toEqual(['getSubscription', 'fetch:POST:/api/push/subscriptions']);

    const rotated: Log = [];
    stubNotification(rotated, 'granted', 'granted');
    stubFetch(rotated);
    expect(
      await syncPushOnOpen(fakeRegistration(rotated, fakeSubscription(rotated, OTHER_KEY)), KEY),
    ).toBe('resubscribed');
    expect(rotated).toEqual([
      'getSubscription',
      'unsubscribe',
      'subscribe:65',
      'fetch:POST:/api/push/subscriptions',
    ]);
    expect(rotated).not.toContain('requestPermission');
  });

  it('11. not granted is skipped; granted with no subscription stays off', async () => {
    const log: Log = [];
    stubNotification(log, 'granted', 'default');
    stubFetch(log);
    expect(await syncPushOnOpen(fakeRegistration(log), KEY)).toBe('skipped');
    stubNotification(log, 'granted', 'granted');
    expect(await syncPushOnOpen(fakeRegistration(log), KEY)).toBe('none');
    expect(log).toEqual(['getSubscription']);
  });
});

describe('disablePush (logout on a shared device, T-07-45 / T-07-48)', () => {
  it('12. unsubscribes and DELETEs this device by endpoint', async () => {
    const log: Log = [];
    const fetchMock = stubFetch(log);
    const result = await disablePush(fakeRegistration(log, fakeSubscription(log)));
    expect(result).toEqual({ unsubscribed: true, deleted: true });
    expect(log).toContain('unsubscribe');
    expect(log).toContain('fetch:DELETE:/api/push/subscriptions');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      endpoint: 'https://push.fake.test/sub/1',
    });
  });

  it('13. a hanging network never holds logout past 2 s, and nothing throws', async () => {
    vi.useFakeTimers();
    const log: Log = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const subscription = fakeSubscription(log);
    subscription.unsubscribe = vi.fn(() => new Promise<boolean>(() => {}));
    const pending = disablePush(fakeRegistration(log, subscription));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ unsubscribed: false, deleted: false });
  });

  it('14. no registration or no subscription is a no-op', async () => {
    const log: Log = [];
    stubFetch(log);
    expect(await disablePush(null)).toEqual({ unsubscribed: true, deleted: false });
    expect(await disablePush(fakeRegistration(log))).toEqual({
      unsubscribed: true,
      deleted: false,
    });
    expect(log).toEqual(['getSubscription']);
  });
});

describe('the soft-ask dismissal (UX only, T-02-78)', () => {
  it('15. the key, and a round trip through localStorage', () => {
    expect(PUSH_SOFTASK_DISMISSED_KEY).toBe('rede_push_softask_dismissed');
    expect(readSoftAskDismissed()).toBe(false);
    writeSoftAskDismissed();
    expect(readSoftAskDismissed()).toBe(true);
  });
});

describe('the first-open ask helpers (quick 261007-kyp)', () => {
  function throwingStorage() {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem() {
          throw new Error('blocked');
        },
        setItem() {
          throw new Error('blocked');
        },
      },
    });
    return () => {
      if (real) Object.defineProperty(window, 'localStorage', real);
    };
  }

  it('1. the key, and "asked" reads false with nothing stored', () => {
    expect(PUSH_FIRSTOPEN_ASKED_KEY).toBe('rede_push_firstopen_asked');
    expect(readFirstOpenAsked()).toBe(false);
  });

  it('2. every written choice reads as asked', () => {
    for (const choice of ['later', 'denied', 'enabled'] as const) {
      window.localStorage.clear();
      writeFirstOpenAsked(choice);
      expect(readFirstOpenAsked()).toBe(true);
      expect(window.localStorage.getItem(PUSH_FIRSTOPEN_ASKED_KEY)).toBe(choice);
    }
  });

  it('3. an unreadable store reads as already asked (do not nag); a failing write does not throw', () => {
    const restore = throwingStorage();
    try {
      expect(readFirstOpenAsked()).toBe(true);
      expect(() => writeFirstOpenAsked('later')).not.toThrow();
    } finally {
      restore();
    }
  });

  it('4. firstOpenAskDue is true only for standalone, state off and not yet asked', () => {
    expect(firstOpenAskDue({ standalone: true, state: 'off', asked: false })).toBe(true);
    for (const state of ['checking', 'unsupported', 'ios-install', 'on', 'denied'] as const) {
      expect(firstOpenAskDue({ standalone: true, state, asked: false })).toBe(false);
    }
    expect(firstOpenAskDue({ standalone: false, state: 'off', asked: false })).toBe(false);
    expect(firstOpenAskDue({ standalone: true, state: 'off', asked: true })).toBe(false);
  });

  it('5. anotherModalOpen follows the aria-modal selector on the given root', () => {
    const seen: string[] = [];
    const root = (found: boolean) => ({
      querySelector: (selector: string) => {
        seen.push(selector);
        return found ? ({} as Element) : null;
      },
    });
    expect(anotherModalOpen(root(true))).toBe(true);
    expect(anotherModalOpen(root(false))).toBe(false);
    expect(seen[0]).toBe('[aria-modal="true"]');
  });
});
