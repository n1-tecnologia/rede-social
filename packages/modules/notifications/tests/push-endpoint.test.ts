import { describe, expect, it } from 'vitest';
import { PUSH_SERVICE_HOST_SUFFIXES, pushSubscriptionInputSchema } from '../contracts/index';
import { isAllowedPushEndpoint } from '../server/push/endpoint';

/**
 * T-07-33 (SSRF): the worker POSTs to whatever endpoint a member saved, so only a real push service
 * passes. The accepted set is the named `PUSH_SERVICE_HOST_SUFFIXES` constant.
 */

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
    'https://web.push.apple.com/QGz1-xyz_ABC',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
    'https://fcm.googleapis.com:443/fcm/send/explicit-default-port',
  ])('accepts a real push service: %s', (url) => {
    expect(isAllowedPushEndpoint(url, 'webpush')).toBe(true);
    expect(isAllowedPushEndpoint(url, 'fake')).toBe(true);
  });

  it.each([
    ['http:', 'http://fcm.googleapis.com/fcm/send/x'],
    ['an IPv4 literal', 'https://127.0.0.1/push'],
    ['a disguised IPv4 literal', 'https://2130706433/push'],
    ['an IPv6 literal', 'https://[::1]/push'],
    ['localhost', 'https://localhost/push'],
    ['userinfo', 'https://user:pass@fcm.googleapis.com/fcm/send/x'],
    ['a username alone', 'https://user@fcm.googleapis.com/fcm/send/x'],
    ['port 8443', 'https://fcm.googleapis.com:8443/fcm/send/x'],
    ['an unlisted host', 'https://push.example.com/sub/x'],
    ['a suffix without its dot', 'https://evilgoogleapis.com/x'],
    ['a trailing-dot host', 'https://fcm.googleapis.com./fcm/send/x'],
    ['the metadata host', 'https://metadata.google.internal/computeMetadata/v1'],
    ['not a URL', 'not a url'],
  ])('refuses %s', (_label, url) => {
    expect(isAllowedPushEndpoint(url, 'webpush')).toBe(false);
    expect(isAllowedPushEndpoint(url, 'fake')).toBe(false);
  });

  it('push.fake.test is accepted ONLY while the transport is fake', () => {
    expect(isAllowedPushEndpoint('https://push.fake.test/sub/1', 'fake')).toBe(true);
    expect(isAllowedPushEndpoint('https://push.fake.test/sub/1', 'webpush')).toBe(false);
    expect(isAllowedPushEndpoint('http://push.fake.test/sub/1', 'fake')).toBe(false);
  });

  it('the allow-list is the four push services, each a dotted suffix', () => {
    expect(PUSH_SERVICE_HOST_SUFFIXES).toEqual([
      '.googleapis.com',
      '.mozilla.com',
      '.push.apple.com',
      '.notify.windows.com',
    ]);
  });
});

describe('pushSubscriptionInputSchema keys', () => {
  const ok = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/x',
    // 65 bytes starting 0x04 (an uncompressed P-256 point) and 16 bytes.
    keys: {
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'),
      auth: Buffer.alloc(16, 9).toString('base64url'),
    },
  };

  it('accepts 65 + 16 bytes of base64url', () => {
    expect(pushSubscriptionInputSchema.safeParse(ok).success).toBe(true);
  });

  it.each([
    ['p256dh of 64 bytes', { ...ok.keys, p256dh: Buffer.alloc(64, 4).toString('base64url') }],
    ['p256dh not starting 0x04', { ...ok.keys, p256dh: Buffer.alloc(65, 2).toString('base64url') }],
    [
      'p256dh in standard base64 with + and /',
      { ...ok.keys, p256dh: `${ok.keys.p256dh.slice(0, -2)}+/` },
    ],
    ['auth of 15 bytes', { ...ok.keys, auth: Buffer.alloc(15, 9).toString('base64url') }],
    ['auth of 17 bytes', { ...ok.keys, auth: Buffer.alloc(17, 9).toString('base64url') }],
  ])('refuses %s', (_label, keys) => {
    const result = pushSubscriptionInputSchema.safeParse({ ...ok, keys });
    expect(result.success).toBe(false);
    expect(result.error?.issues.every((issue) => issue.path[0] === 'keys')).toBe(true);
  });

  it('refuses an unknown key (strict)', () => {
    expect(pushSubscriptionInputSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});
