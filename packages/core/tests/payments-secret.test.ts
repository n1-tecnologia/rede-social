import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertProductionEnv } from '../server/env';
import {
  openSecret,
  openSecretWith,
  resolvePaymentsKey,
  sealSecret,
  sealSecretWith,
} from '../server/payments/secret';

/**
 * PAY-04 / D-486 secret custody (09.1-05): the tenant's webhook token is stored ONLY as an
 * AES-256-GCM string bound to its integration row. Pure: no database, no network.
 */

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const material = (keyId = 1) => ({ key: randomBytes(32), keyId });

describe('sealSecret / openSecret (dev key)', () => {
  it('seals to a v1 string and opens back to the plaintext', () => {
    const sealed = sealSecret('tok-abc', ID);
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('tok-abc');
    expect(openSecret(sealed, ID)).toBe('tok-abc');
  });

  it('two seals of one plaintext differ (fresh IV each time) and both open', () => {
    const a = sealSecret('same', ID);
    const b = sealSecret('same', ID);
    expect(a).not.toBe(b);
    expect(openSecret(a, ID)).toBe('same');
    expect(openSecret(b, ID)).toBe('same');
  });

  it('a sealed value copied to another row fails to open (the AAD binds it to its row)', () => {
    const sealed = sealSecret('tok', ID);
    expect(() => openSecret(sealed, OTHER_ID)).toThrow('payment secret unreadable');
  });
});

describe('openSecretWith refuses anything it cannot authenticate', () => {
  const m = material();
  const sealed = sealSecretWith(m, 'tok', ID);

  it('round-trips with an explicit key', () => {
    expect(openSecretWith(m, sealed, ID)).toBe('tok');
  });

  it('refuses a flipped byte in the ciphertext, the tag and the IV', () => {
    const parts = sealed.split(':');
    for (const index of [2, 3, 4]) {
      const bytes = Buffer.from(parts[index] ?? '', 'base64url');
      bytes[0] = (bytes[0] ?? 0) ^ 0x01;
      const tampered = [...parts];
      tampered[index] = bytes.toString('base64url');
      expect(() => openSecretWith(m, tampered.join(':'), ID)).toThrow('payment secret unreadable');
    }
  });

  it('refuses a truncated string, an unknown version and garbage', () => {
    expect(() => openSecretWith(m, sealed.slice(0, 20), ID)).toThrow('payment secret unreadable');
    expect(() => openSecretWith(m, sealed.replace(/^v1:/, 'v2:'), ID)).toThrow(
      'payment secret unreadable',
    );
    expect(() => openSecretWith(m, '', ID)).toThrow('payment secret unreadable');
    expect(() => openSecretWith(m, 'not a sealed secret', ID)).toThrow('payment secret unreadable');
  });

  it('refuses an unknown key id and a different key', () => {
    expect(() => openSecretWith({ ...m, keyId: 2 }, sealed, ID)).toThrow(
      'payment secret unreadable',
    );
    expect(() => openSecretWith(material(), sealed, ID)).toThrow('payment secret unreadable');
  });

  it('never puts an input in the error message', () => {
    try {
      openSecretWith(m, 'v1:1:AAAA:BBBB:SECRET-LOOKING-VALUE', ID);
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).toBe('payment secret unreadable');
    }
  });
});

describe('resolvePaymentsKey', () => {
  const key32 = randomBytes(32).toString('base64');

  it('decodes a configured base64 key of exactly 32 bytes and carries the key id', () => {
    const resolved = resolvePaymentsKey({ key: key32, keyId: 7, providers: 'acme' });
    expect(resolved.key).toHaveLength(32);
    expect(resolved.keyId).toBe(7);
  });

  it('refuses a configured key that is not 32 bytes', () => {
    expect(() =>
      resolvePaymentsKey({
        key: randomBytes(31).toString('base64'),
        keyId: 1,
        providers: undefined,
      }),
    ).toThrow('payments secret key invalid');
  });

  it('derives the same fixed development key only while fake is enabled and no key is set', () => {
    const a = resolvePaymentsKey({ key: undefined, keyId: 1, providers: undefined });
    const b = resolvePaymentsKey({ key: undefined, keyId: 1, providers: 'fake' });
    const c = resolvePaymentsKey({ key: undefined, keyId: 1, providers: 'acme, fake' });
    expect(a.key.equals(b.key)).toBe(true);
    expect(a.key.equals(c.key)).toBe(true);
    expect(a.key).toHaveLength(32);
  });

  it('has no development key when fake is not enabled', () => {
    expect(() => resolvePaymentsKey({ key: undefined, keyId: 1, providers: 'acme' })).toThrow(
      'payments secret key invalid',
    );
  });
});

describe('assertProductionEnv: PAYMENTS_SECRET_KEY (A-P22)', () => {
  const base = { DOMAIN_PROVIDER: 'fake', AUTH_ALLOW_LIST: 'local', MAIL_TRANSPORT: 'local' };
  const good = randomBytes(32).toString('base64');

  it('requires a key when providers are listed and fake is not one of them', () => {
    expect(() => assertProductionEnv({ ...base, PAYMENTS_PROVIDERS: 'acme' } as never)).toThrow(
      /PAYMENTS_SECRET_KEY/,
    );
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() =>
      assertProductionEnv({
        ...base,
        PAYMENTS_PROVIDERS: 'acme',
        PAYMENTS_SECRET_KEY: randomBytes(16).toString('base64'),
      } as never),
    ).toThrow(/PAYMENTS_SECRET_KEY/);
  });

  it('accepts a 32-byte key', () => {
    expect(() =>
      assertProductionEnv({
        ...base,
        PAYMENTS_PROVIDERS: 'acme',
        PAYMENTS_SECRET_KEY: good,
      } as never),
    ).not.toThrow();
  });

  it('needs no key when fake is enabled or no list is set (the local default)', () => {
    expect(() => assertProductionEnv({ ...base } as never)).not.toThrow();
    expect(() =>
      assertProductionEnv({ ...base, PAYMENTS_PROVIDERS: 'fake' } as never),
    ).not.toThrow();
    expect(() =>
      assertProductionEnv({ ...base, PAYMENTS_PROVIDERS: 'acme,fake' } as never),
    ).not.toThrow();
  });
});

describe('assertProductionEnv: the production payments guard fails closed (WR-01)', () => {
  const base = {
    NODE_ENV: 'production',
    DOMAIN_PROVIDER: 'fake',
    AUTH_ALLOW_LIST: 'local',
    MAIL_TRANSPORT: 'local',
  };
  const good = randomBytes(32).toString('base64');
  const check = (extra: Record<string, string>) => () =>
    assertProductionEnv({ ...base, ...extra } as never);

  it('refuses an unset PAYMENTS_PROVIDERS: every adapter, the test one included, would be live', () => {
    expect(check({})).toThrow(/PAYMENTS_PROVIDERS/);
    expect(check({ PAYMENTS_SECRET_KEY: good })).toThrow(/PAYMENTS_PROVIDERS/);
  });

  it('refuses the test gateway in any list, even with a real key', () => {
    for (const providers of ['fake', 'kiwify,fake', ' fake , kiwify']) {
      expect(
        check({ PAYMENTS_PROVIDERS: providers, PAYMENTS_SECRET_KEY: good }),
        providers,
      ).toThrow(/test gateway|fake/);
    }
  });

  it('refuses a list of the test gateway alone with no key without falling back to the development key', () => {
    expect(check({ PAYMENTS_PROVIDERS: 'fake' })).toThrow(/PAYMENTS_SECRET_KEY/);
    expect(check({ PAYMENTS_PROVIDERS: 'kiwify,fake' })).toThrow(/PAYMENTS_SECRET_KEY/);
  });

  it('requires a 32-byte key for a real gateway', () => {
    expect(check({ PAYMENTS_PROVIDERS: 'kiwify' })).toThrow(/PAYMENTS_SECRET_KEY/);
    expect(
      check({
        PAYMENTS_PROVIDERS: 'kiwify',
        PAYMENTS_SECRET_KEY: randomBytes(16).toString('base64'),
      }),
    ).toThrow(/PAYMENTS_SECRET_KEY/);
  });

  it('boots with exactly the real gateway and a 32-byte key', () => {
    expect(check({ PAYMENTS_PROVIDERS: 'kiwify', PAYMENTS_SECRET_KEY: good })).not.toThrow();
  });

  it('keeps development and test environments open: no list, the test gateway, no key', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const e = { ...base, NODE_ENV };
      expect(() => assertProductionEnv({ ...e } as never), NODE_ENV).not.toThrow();
      expect(() =>
        assertProductionEnv({ ...e, PAYMENTS_PROVIDERS: 'fake' } as never),
      ).not.toThrow();
      expect(() =>
        assertProductionEnv({ ...e, PAYMENTS_PROVIDERS: 'kiwify,fake' } as never),
      ).not.toThrow();
    }
  });
});

describe('resolvePaymentsKey: no development key in production (WR-01)', () => {
  it('refuses the development key when production is set, whatever the list says', () => {
    for (const providers of [undefined, 'fake', 'kiwify,fake']) {
      expect(() =>
        resolvePaymentsKey({ key: undefined, keyId: 1, providers, production: true }),
      ).toThrow('payments secret key invalid');
    }
  });

  it('still returns a configured 32-byte key in production', () => {
    const key = randomBytes(32).toString('base64');
    expect(
      resolvePaymentsKey({ key, keyId: 1, providers: 'kiwify', production: true }).key,
    ).toHaveLength(32);
  });
});
