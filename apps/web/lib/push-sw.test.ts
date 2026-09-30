import { pushPayloadSchema } from '@rede-social/module-notifications/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  type ClientsLike,
  decidePushDisplay,
  focusOrOpen,
  isPushPayloadV1,
  mustAlwaysShow,
  PUSH_FALLBACK,
  parsePushPayload,
  resolveClickUrl,
  subscriptionBody,
} from './push-sw';

const UA = {
  chromeDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
};

const VALID = {
  v: 1,
  title: 'Rede Demo',
  body: 'Novo post: olá',
  icon: 'https://cdn.test/i192.png',
  url: '/post/abc',
  tag: 'feed-post',
  renotify: false,
  badge: 3,
};

const data = (value: unknown) => ({ json: () => value });

describe('parsePushPayload', () => {
  it('1. a valid v1 payload passes through with its badge', () => {
    expect(parsePushPayload(data(VALID))).toEqual({
      title: 'Rede Demo',
      body: 'Novo post: olá',
      icon: 'https://cdn.test/i192.png',
      url: '/post/abc',
      tag: 'feed-post',
      renotify: false,
      badge: 3,
    });
  });

  it('2. malformed JSON, the wrong version, a missing field and null fall back exactly', () => {
    const fallback = {
      title: 'Nova notificação',
      body: 'Abra o app para ver.',
      url: '/inicio',
      tag: 'fallback',
      renotify: false,
      icon: '/icons/rede-social-192.png',
      badge: null,
    };
    const throwing = {
      json: () => {
        throw new SyntaxError('Unexpected token');
      },
    };
    expect(parsePushPayload(throwing)).toEqual(fallback);
    expect(parsePushPayload(data({ ...VALID, v: 2 }))).toEqual(fallback);
    expect(parsePushPayload(data({ ...VALID, title: undefined }))).toEqual(fallback);
    expect(parsePushPayload(data({ ...VALID, extra: 1 }))).toEqual(fallback);
    expect(parsePushPayload(data('text'))).toEqual(fallback);
    expect(parsePushPayload(null)).toEqual(fallback);
    expect(parsePushPayload(undefined)).toEqual(fallback);
    expect(PUSH_FALLBACK).toEqual(fallback);
  });

  it('3. an off-origin url makes the whole payload the fallback (the schema refuses it)', () => {
    expect(parsePushPayload(data({ ...VALID, url: '//evil.test/x' })).url).toBe('/inicio');
    expect(parsePushPayload(data({ ...VALID, url: 'https://evil.test' })).title).toBe(
      'Nova notificação',
    );
  });
});

describe('resolveClickUrl (T-07-42)', () => {
  it('4. a same-origin path passes, everything else becomes /inicio', () => {
    expect(resolveClickUrl('/post/x')).toBe('/post/x');
    expect(resolveClickUrl('/suporte/abc?x=1#m')).toBe('/suporte/abc?x=1#m');
    expect(resolveClickUrl('//evil.test')).toBe('/inicio');
    expect(resolveClickUrl('/\\evil.test')).toBe('/inicio');
    expect(resolveClickUrl('https://evil.test')).toBe('/inicio');
    expect(resolveClickUrl('javascript:x')).toBe('/inicio');
    expect(resolveClickUrl('/a b')).toBe('/inicio');
    expect(resolveClickUrl(undefined)).toBe('/inicio');
    expect(resolveClickUrl(42)).toBe('/inicio');
  });
});

describe('mustAlwaysShow (RESEARCH A5, Pitfall 5)', () => {
  it('5. Chromium and Firefox may skip; WebKit and every iOS browser must show', () => {
    expect(mustAlwaysShow(UA.chromeDesktop)).toBe(false);
    expect(mustAlwaysShow(UA.chromeAndroid)).toBe(false);
    expect(mustAlwaysShow(UA.edge)).toBe(false);
    expect(mustAlwaysShow(UA.firefox)).toBe(false);
    expect(mustAlwaysShow(UA.samsung)).toBe(false);
    expect(mustAlwaysShow(UA.safariMac)).toBe(true);
    expect(mustAlwaysShow(UA.iosSafari)).toBe(true);
    expect(mustAlwaysShow(UA.iosChrome)).toBe(true);
    expect(mustAlwaysShow('')).toBe(true);
  });
});

describe('decidePushDisplay (D-236, D-239)', () => {
  const payload = parsePushPayload(data(VALID));
  const focused = { focused: true, visibilityState: 'visible' };

  it('6. Chromium with a focused, visible window stays quiet', () => {
    expect(decidePushDisplay({ payload, windows: [focused], ua: UA.chromeAndroid })).toEqual({
      show: false,
      badge: 3,
    });
  });

  it('7. an unfocused or hidden window shows', () => {
    expect(
      decidePushDisplay({
        payload,
        windows: [{ focused: false, visibilityState: 'visible' }],
        ua: UA.chromeAndroid,
      }).show,
    ).toBe(true);
    expect(
      decidePushDisplay({
        payload,
        windows: [{ focused: true, visibilityState: 'hidden' }],
        ua: UA.chromeAndroid,
      }).show,
    ).toBe(true);
  });

  it('8. WebKit with a focused window still shows', () => {
    expect(decidePushDisplay({ payload, windows: [focused], ua: UA.iosSafari }).show).toBe(true);
    expect(decidePushDisplay({ payload, windows: [focused], ua: UA.safariMac }).show).toBe(true);
  });

  it('9. no windows shows; the fallback has no badge', () => {
    expect(decidePushDisplay({ payload, windows: [], ua: UA.chromeDesktop }).show).toBe(true);
    expect(
      decidePushDisplay({ payload: parsePushPayload(null), windows: [], ua: UA.chromeDesktop }),
    ).toEqual({ show: true, badge: null });
  });
});

function fakeClients(windows: { url: string; navigateRejects?: boolean }[]) {
  const log: string[] = [];
  const clients = windows.map((w) => ({
    url: w.url,
    focus: vi.fn(async () => {
      log.push(`focus ${w.url}`);
    }),
    navigate: vi.fn(async (url: string) => {
      if (w.navigateRejects) throw new TypeError('not controlled');
      log.push(`navigate ${url}`);
    }),
  }));
  const api: ClientsLike = {
    matchAll: vi.fn(async () => clients),
    openWindow: vi.fn(async (url: string) => {
      log.push(`open ${url}`);
      return null;
    }),
  };
  return { api, clients, log };
}

describe('focusOrOpen', () => {
  const origin = 'https://rede-demo.test';
  const target = `${origin}/post/abc`;

  it('10. focuses and navigates an existing same-origin window', async () => {
    const { api, log } = fakeClients([{ url: `${origin}/inicio` }]);
    await focusOrOpen(api, target, origin);
    expect(log).toEqual([`focus ${origin}/inicio`, `navigate ${target}`]);
    expect(api.openWindow).not.toHaveBeenCalled();
  });

  it('11. ignores a cross-origin window and opens one', async () => {
    const { api, clients, log } = fakeClients([{ url: 'https://other.test/inicio' }]);
    await focusOrOpen(api, target, origin);
    expect(clients[0]?.focus).not.toHaveBeenCalled();
    expect(log).toEqual([`open ${target}`]);
  });

  it('12. opens a window when none exists or navigate rejects', async () => {
    const none = fakeClients([]);
    await focusOrOpen(none.api, target, origin);
    expect(none.log).toEqual([`open ${target}`]);

    const rejecting = fakeClients([{ url: `${origin}/inicio`, navigateRejects: true }]);
    await focusOrOpen(rejecting.api, target, origin);
    expect(rejecting.log).toEqual([`focus ${origin}/inicio`, `open ${target}`]);
  });
});

describe('subscriptionBody', () => {
  it('13. drops expirationTime and cuts the user agent to 512', () => {
    const body = subscriptionBody(
      { endpoint: 'https://push.test/x', keys: { p256dh: 'p', auth: 'a' } },
      'x'.repeat(600),
    );
    expect(Object.keys(body).sort()).toEqual(['endpoint', 'keys', 'userAgent']);
    expect(body.keys).toEqual({ p256dh: 'p', auth: 'a' });
    expect(body.userAgent).toHaveLength(512);
  });
});

describe('isPushPayloadV1 mirrors pushPayloadSchema (the worker imports no zod)', () => {
  const cases: unknown[] = [
    VALID,
    { ...VALID, body: '' },
    { ...VALID, badge: 0 },
    { ...VALID, renotify: true, tag: 'events-reminder-0123456789abcdef0123456789abcdef' },
    { ...VALID, url: '/suporte/abc?x=1#m' },
    { ...VALID, v: 2 },
    { ...VALID, v: '1' },
    { ...VALID, title: '' },
    { ...VALID, icon: '' },
    { ...VALID, url: '//evil.test' },
    { ...VALID, url: '/\\evil.test' },
    { ...VALID, url: 'https://evil.test' },
    { ...VALID, url: '/a b' },
    { ...VALID, tag: 'bad tag' },
    { ...VALID, tag: 'x'.repeat(65) },
    { ...VALID, renotify: 'false' },
    { ...VALID, badge: -1 },
    { ...VALID, badge: 1.5 },
    { ...VALID, badge: Number.NaN },
    { ...VALID, badge: '3' },
    { ...VALID, extra: 1 },
    (({ badge: _badge, ...rest }) => rest)(VALID),
    null,
    [],
    'text',
    42,
  ];

  it('14. agrees with the strict zod schema on every case', () => {
    for (const value of cases) {
      expect(isPushPayloadV1(value), JSON.stringify(value)).toBe(
        pushPayloadSchema.safeParse(value).success,
      );
    }
  });
});
