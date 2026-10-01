import type { Page } from '@playwright/test';

/**
 * The MOCKED push stack of `push.spec.ts` (07-07), lifted here in 07-11 so `phase7-smoke.spec.ts`
 * installs the same fake rather than a second copy that could drift. A spec file cannot be imported
 * by another (Playwright would register its tests twice), hence a plain helper module.
 *
 * `installFakePush` replaces `Notification`, `PushManager` and `navigator.serviceWorker` before any
 * page script runs; the fake subscription, the permission and the call log live in localStorage.
 */
export type FakePushConfig = {
  /** The initial `Notification.permission` (a later grant/deny persists in localStorage). */
  permission: 'default' | 'granted' | 'denied';
  /** What `requestPermission()` resolves to. */
  answer: 'default' | 'granted' | 'denied';
  /** `false` removes `PushManager` (an unsupported browser). */
  pushManager: boolean;
  /** `true`: `serviceWorker.ready` never settles (a worker that failed to register, C-WR-05). */
  neverReady?: boolean;
};

/**
 * Installs the fake push stack before any page script runs. Runs in the page: no closure over Node
 * values, only the serialisable `config`.
 */
export async function installFakePush(page: Page, config: FakePushConfig): Promise<void> {
  await page.addInitScript((cfg: FakePushConfig) => {
    const store = window.localStorage;
    const LOG = '__fakePushLog';
    const SUB = '__fakePushSub';
    const PERM = '__fakePushPermission';
    const log = (entry: string) => {
      const list = JSON.parse(store.getItem(LOG) ?? '[]') as string[];
      list.push(entry);
      store.setItem(LOG, JSON.stringify(list));
    };
    const toB64Url = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const fromB64Url = (value: string) => {
      const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
      const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from(raw, (c) => c.charCodeAt(0));
    };
    // A 65-byte uncompressed point (0x04 first) and a 16-byte auth secret, base64url.
    const p256dh = toB64Url(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i)));
    const auth = toB64Url(Uint8Array.from({ length: 16 }, (_, i) => i + 1));

    type Stored = { endpoint: string; key: string };
    const makeSubscription = (stored: Stored) => ({
      endpoint: stored.endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: fromB64Url(stored.key).buffer },
      toJSON: () => ({ endpoint: stored.endpoint, expirationTime: null, keys: { p256dh, auth } }),
      unsubscribe: () => {
        log('unsubscribe');
        store.removeItem(SUB);
        return Promise.resolve(true);
      },
    });
    const current = () => {
      const raw = store.getItem(SUB);
      return raw ? makeSubscription(JSON.parse(raw) as Stored) : null;
    };
    const registration = {
      scope: `${location.origin}/`,
      active: null,
      installing: null,
      waiting: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      update: () => Promise.resolve(),
      pushManager: {
        getSubscription: () => {
          log('getSubscription');
          return Promise.resolve(current());
        },
        subscribe: (options: { applicationServerKey: Uint8Array }) => {
          log('subscribe');
          const stored: Stored = {
            endpoint: `https://push.fake.test/sub/e2e-${crypto.randomUUID()}`,
            key: toB64Url(new Uint8Array(options.applicationServerKey)),
          };
          store.setItem(SUB, JSON.stringify(stored));
          return Promise.resolve(makeSubscription(stored));
        },
      },
    };
    const container = {
      ready: cfg.neverReady ? new Promise(() => {}) : Promise.resolve(registration),
      controller: null,
      // Serwist's registration never settles: the worker is not under test (the spec blocks it).
      register: () => new Promise(() => {}),
      getRegistration: () => Promise.resolve(registration),
      getRegistrations: () => Promise.resolve([registration]),
      addEventListener: () => {},
      removeEventListener: () => {},
      startMessages: () => {},
    };
    Object.defineProperty(Navigator.prototype, 'serviceWorker', {
      configurable: true,
      get: () => container,
    });

    const FakeNotification = Object.defineProperties(function Notification() {}, {
      permission: { get: () => store.getItem(PERM) ?? cfg.permission },
      requestPermission: {
        value: () => {
          log('requestPermission');
          if (cfg.answer !== 'default') store.setItem(PERM, cfg.answer);
          return Promise.resolve(cfg.answer);
        },
      },
    });
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: FakeNotification,
    });
    if (cfg.pushManager) {
      Object.defineProperty(window, 'PushManager', {
        configurable: true,
        writable: true,
        value: function PushManager() {},
      });
    } else {
      delete (window as { PushManager?: unknown }).PushManager;
    }
  }, config);
}

export async function pushLog(page: Page): Promise<string[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('__fakePushLog') ?? '[]') as string[]);
}

export async function fakeEndpoint(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('__fakePushSub');
    return raw ? (JSON.parse(raw) as { endpoint: string }).endpoint : null;
  });
}
