import { createECDH, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PUSH_ENDPOINT_MAX_LENGTH,
  pushDeviceInputSchema,
  pushSubscriptionDeleteSchema,
  pushSubscriptionInputSchema,
  pushSubscriptionSaveBodySchema,
} from '../contracts/index';

/**
 * 13-11 (NATIVE-09, D-603, D-606): the save body of `POST /v1/notifications/push-subscriptions` is a union.
 * A body WITHOUT `kind` is the web shape exactly as before; a body with `kind: 'apns' | 'fcm'` is a native
 * device token. These are the eight probed edges of that body, as a table, with no server and no database.
 * Token shapes come from `@rede-social/contracts/native`; the HTTP half is `push-devices.test.ts` in the
 * API's integration suite.
 */

const apns = (over: Record<string, unknown> = {}) => ({
  kind: 'apns',
  token: 'ab'.repeat(32),
  platform: 'ios',
  environment: 'production',
  appVersion: '1.2.3',
  ...over,
});
const fcm = (over: Record<string, unknown> = {}) => ({
  kind: 'fcm',
  token: 'A'.repeat(100),
  platform: 'android',
  environment: 'production',
  appVersion: '1.2.3',
  ...over,
});
const parse = (body: unknown) => pushSubscriptionSaveBodySchema.safeParse(body);
const ok = (body: unknown) => parse(body).success;

/** A real browser-shaped web body, so the old arm is exercised with valid key lengths. */
function webBody(): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string;
} {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
    userAgent: 'vitest',
  };
}

describe('NATIVE-09 boundary: token and appVersion lengths', () => {
  const rows: [string, unknown, boolean][] = [
    ['apns 31 hex characters', apns({ token: 'a'.repeat(31) }), false],
    ['apns 32 hex characters', apns({ token: 'a'.repeat(32) }), true],
    ['apns 200 hex characters', apns({ token: 'a'.repeat(200) }), true],
    ['apns 201 hex characters', apns({ token: 'a'.repeat(201) }), false],
    ['fcm 99 characters', fcm({ token: 'A'.repeat(99) }), false],
    ['fcm 100 characters', fcm({ token: 'A'.repeat(100) }), true],
    ['fcm 4096 characters', fcm({ token: 'A'.repeat(4096) }), true],
    ['fcm 4097 characters', fcm({ token: 'A'.repeat(4097) }), false],
    ['appVersion of 0 characters', apns({ appVersion: '' }), false],
    ['appVersion of 32 characters', apns({ appVersion: `1.2.${'3'.repeat(28)}` }), true],
    ['appVersion of 33 characters', apns({ appVersion: `1.2.${'3'.repeat(29)}` }), false],
    ['appVersion that is not a semver', apns({ appVersion: 'latest' }), false],
    ['fcm with environment sandbox', fcm({ environment: 'sandbox' }), false],
    ['apns with environment sandbox', apns({ environment: 'sandbox' }), true],
    ['an environment outside the enum', apns({ environment: 'staging' }), false],
  ];
  for (const [name, body, expected] of rows) {
    it(`${expected ? 'accepts' : 'refuses'} ${name}`, () => {
      expect(ok(body)).toBe(expected);
    });
  }
});

describe('NATIVE-09 adjacency: a token of one kind is not a token of another', () => {
  it('refuses a web endpoint URL sent as an apns token', () => {
    expect(ok(apns({ token: `https://web.push.apple.com/${'a'.repeat(40)}` }))).toBe(false);
  });
  it('refuses a URL-shaped token sent as fcm (the slash and the dot are outside the alphabet)', () => {
    expect(ok(fcm({ token: `https://fcm.googleapis.com/fcm/send/${'A'.repeat(80)}` }))).toBe(false);
  });
  it('refuses an FCM-style token (non-hex characters) sent as apns', () => {
    expect(ok(apns({ token: `${'g'.repeat(40)}:${'Z'.repeat(40)}` }))).toBe(false);
  });
  it('refuses kind apns with platform android and kind fcm with platform ios', () => {
    expect(ok(apns({ platform: 'android' }))).toBe(false);
    expect(ok(fcm({ platform: 'ios' }))).toBe(false);
  });
  it('refuses a platform outside the pair', () => {
    expect(ok(apns({ platform: 'web' }))).toBe(false);
  });
  it('treats two tokens that differ by one character as two distinct, valid tokens', () => {
    const a = `${'ab'.repeat(31)}ab`;
    const b = `${'ab'.repeat(31)}ac`;
    const first = parse(apns({ token: a }));
    const second = parse(apns({ token: b }));
    expect(first.success && second.success).toBe(true);
    if (first.success && second.success) {
      const x = first.data as { token: string };
      const y = second.data as { token: string };
      expect(x.token).not.toBe(y.token);
    }
  });
});

describe('NATIVE-09 empty: nothing useful in the body', () => {
  it('refuses {}', () => {
    expect(ok({})).toBe(false);
  });
  it('refuses a non-object body', () => {
    expect(ok(null)).toBe(false);
    expect(ok('apns')).toBe(false);
    expect(ok([])).toBe(false);
  });
  it('refuses an empty token', () => {
    expect(ok(apns({ token: '' }))).toBe(false);
    expect(ok(fcm({ token: '' }))).toBe(false);
  });
  it('refuses a whitespace-only token', () => {
    expect(ok(apns({ token: ' '.repeat(64) }))).toBe(false);
    expect(ok(fcm({ token: ' '.repeat(120) }))).toBe(false);
  });
  it('refuses a missing token, platform, environment or appVersion', () => {
    for (const key of ['token', 'platform', 'environment', 'appVersion']) {
      const a: Record<string, unknown> = apns();
      delete a[key];
      expect(ok(a), `apns without ${key}`).toBe(false);
      const f: Record<string, unknown> = fcm();
      delete f[key];
      expect(ok(f), `fcm without ${key}`).toBe(false);
    }
  });
});

describe('NATIVE-09 encoding: the patterns are anchored and carry no multiline flag', () => {
  const bad: [string, (token: string) => string][] = [
    ['a non-ASCII character', (t) => `${t.slice(0, -1)}é`],
    ['a NUL', (t) => `${t.slice(0, -1)}\u0000`],
    ['a percent-encoded sequence', (t) => `${t.slice(0, -3)}%41%`],
    ['a leading space', (t) => ` ${t}`],
    ['a trailing space', (t) => `${t} `],
    ['a trailing newline', (t) => `${t}\n`],
    ['an embedded newline before a valid line', (t) => `${t}\n${t}`],
  ];
  for (const [name, mutate] of bad) {
    it(`refuses a token with ${name}`, () => {
      expect(ok(apns({ token: mutate('ab'.repeat(32)) })), 'apns').toBe(false);
      expect(ok(fcm({ token: mutate('A'.repeat(100)) })), 'fcm').toBe(false);
    });
  }
});

describe('NATIVE-09 precision: the token is an opaque string and is never coerced', () => {
  const digits = '1234567890'.repeat(6).slice(0, 64);
  it('refuses a 64-digit token sent as a JSON number', () => {
    const body = JSON.parse(
      `{"kind":"apns","token":${digits},"platform":"ios","environment":"production","appVersion":"1.0.0"}`,
    );
    expect(typeof body.token).toBe('number');
    expect(ok(body)).toBe(false);
  });
  it('stores the same digits, sent as a string, byte-exact', () => {
    const result = parse(apns({ token: digits }));
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as { token: string }).token).toBe(digits);
  });
  it('keeps leading zeros', () => {
    const token = `0000${digits}`.slice(0, 64);
    const result = parse(apns({ token }));
    expect(result.success && (result.data as { token: string }).token).toBe(token);
  });
});

describe('NATIVE-09 union: the web arm is unchanged and the native arm is closed', () => {
  it('selects the web arm for a body without kind and tags it webpush', () => {
    const body = webBody();
    const result = parse(body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ kind: 'webpush', ...body });
    }
  });
  it('still parses the old shape with pushSubscriptionInputSchema, unchanged', () => {
    expect(pushSubscriptionInputSchema.safeParse(webBody()).success).toBe(true);
    expect(pushSubscriptionInputSchema.safeParse({ ...webBody(), kind: 'webpush' }).success).toBe(
      false,
    );
  });
  it('selects the native arm for a kind body and returns it unchanged', () => {
    const body = apns();
    const result = parse(body);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(body);
    expect(pushDeviceInputSchema.safeParse(fcm()).success).toBe(true);
  });
  it('refuses a body that carries both endpoint and kind apns', () => {
    expect(ok({ ...apns(), endpoint: webBody().endpoint })).toBe(false);
    expect(ok({ ...webBody(), kind: 'apns' })).toBe(false);
  });
  it('refuses an explicit kind webpush, an unknown kind and an unknown key', () => {
    expect(ok({ ...webBody(), kind: 'webpush' })).toBe(false);
    expect(ok(apns({ kind: 'gcm' }))).toBe(false);
    expect(ok(apns({ extra: 1 }))).toBe(false);
    expect(ok({ ...webBody(), extra: 1 })).toBe(false);
  });
  it('keeps the web refusals of the keys exactly where the route reads them', () => {
    const result = parse({ ...webBody(), keys: { p256dh: 'x', auth: 'y' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues.every((issue) => issue.path[0] === 'keys')).toBe(true);
    }
  });
  it('does not depend on the JSON key order', () => {
    const forward = apns();
    const reversed = Object.fromEntries(Object.entries(forward).reverse());
    const a = parse(forward);
    const b = parse(reversed);
    expect(a.success && b.success).toBe(true);
    if (a.success && b.success) expect(a.data).toEqual(b.data);
    const web = webBody();
    const webReversed = Object.fromEntries(Object.entries(web).reverse());
    expect(parse(webReversed).success).toBe(true);
  });
});

describe('NATIVE-09 delete door and T-13-20: nothing echoes a token', () => {
  it('accepts a native token through the existing delete schema, up to the shared bound', () => {
    expect(pushSubscriptionDeleteSchema.safeParse({ endpoint: 'ab'.repeat(32) }).success).toBe(
      true,
    );
    expect(pushSubscriptionDeleteSchema.safeParse({ endpoint: 'A'.repeat(4096) }).success).toBe(
      true,
    );
  });
  it('refuses an empty or 4097-character delete, and keeps the web save bound at 2048', () => {
    expect(pushSubscriptionDeleteSchema.safeParse({ endpoint: '' }).success).toBe(false);
    expect(pushSubscriptionDeleteSchema.safeParse({ endpoint: 'A'.repeat(4097) }).success).toBe(
      false,
    );
    expect(PUSH_ENDPOINT_MAX_LENGTH).toBe(2048);
    const web = webBody();
    const long = `https://fcm.googleapis.com/${'a'.repeat(PUSH_ENDPOINT_MAX_LENGTH)}`;
    expect(parse({ ...web, endpoint: long }).success).toBe(false);
  });
  it('never puts a refused token in an issue message', () => {
    const secret = 'SECRET-TOKEN-VALUE-0123456789';
    const bodies = [
      apns({ token: secret }),
      fcm({ token: secret, platform: 'ios' }),
      apns({ token: secret, platform: 'android' }),
      { ...apns(), token: secret, extra: secret },
    ];
    for (const body of bodies) {
      const result = parse(body);
      expect(result.success).toBe(false);
      if (!result.success) {
        const text = JSON.stringify(result.error.issues);
        expect(text.includes(secret), JSON.stringify(body)).toBe(false);
      }
    }
  });
});
