import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sealSecretWith } from '../server/payments/secret';
import {
  keyIdOf,
  openWith,
  parseKeyring,
  resealWith,
  resolveKeyring,
  sealWith,
} from '../server/secrets/sealed';

/**
 * D-539 / DBT-02 / DBT-03 (09.2-03): the registry's sealing scheme over a keyring. Pure: no database, no
 * network. P5 (adjacent key ids) and P6 (empty and malformed inputs) are explicit cases below.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111';
const TX = `${PROJECT}:database_url_tx`;
const SERVICE = `${PROJECT}:service_key`;
const URL = 'postgres://api_user:s3cret-password@db.example.test:6543/postgres';

const key = () => randomBytes(32);
const ringOf = (...ids: number[]) => new Map(ids.map((id) => [id, key()] as const));
const sameKey = (ids: number[], k: Buffer) => new Map(ids.map((id) => [id, k] as const));

describe('sealWith / openWith', () => {
  it('round-trips to a v1 string that carries its key id and never shows the plaintext', () => {
    const ring = ringOf(1);
    const sealed = sealWith(ring, 1, URL, TX);
    expect(sealed.startsWith('v1:1:')).toBe(true);
    expect(sealed.split(':')).toHaveLength(5);
    expect(sealed).not.toContain('s3cret');
    expect(openWith(ring, sealed, TX)).toBe(URL);
    expect(keyIdOf(sealed)).toBe(1);
  });

  it('two seals of one plaintext differ (a fresh IV each time) and both open', () => {
    const ring = ringOf(1);
    const a = sealWith(ring, 1, URL, TX);
    const b = sealWith(ring, 1, URL, TX);
    expect(a).not.toBe(b);
    expect(openWith(ring, a, TX)).toBe(URL);
    expect(openWith(ring, b, TX)).toBe(URL);
  });

  it('the AAD binds a value to its row and column: database_url_tx cannot be swapped with service_key', () => {
    const ring = ringOf(1);
    const sealed = sealWith(ring, 1, URL, TX);
    expect(() => openWith(ring, sealed, SERVICE)).toThrow('sealed value unreadable');
    expect(() => openWith(ring, sealed, `${'2'.repeat(8)}-0000:database_url_tx`)).toThrow(
      'sealed value unreadable',
    );
  });

  it('P5: a value sealed under key id 1 opens when the ring holds 1 and 2, and not when it holds only 2', () => {
    const k1 = key();
    const k2 = key();
    const sealedUnder1 = sealWith(new Map([[1, k1]]), 1, URL, TX);
    expect(
      openWith(
        new Map([
          [1, k1],
          [2, k2],
        ]),
        sealedUnder1,
        TX,
      ),
    ).toBe(URL);
    expect(() => openWith(new Map([[2, k2]]), sealedUnder1, TX)).toThrow('sealed value unreadable');
    // Adjacent ids do not cross-open even if a ring maps the neighbour to the very same key bytes:
    // the id inside the string selects the key, it is never "try the next one".
    expect(() => openWith(sameKey([2], k1), sealedUnder1, TX)).toThrow('sealed value unreadable');
  });

  it('P5: a ring holding both ids seals under the current one and opens what either sealed', () => {
    const ring = ringOf(1, 2);
    const old = sealWith(ring, 1, URL, TX);
    const next = sealWith(ring, 2, URL, TX);
    expect(keyIdOf(old)).toBe(1);
    expect(keyIdOf(next)).toBe(2);
    expect(openWith(ring, old, TX)).toBe(URL);
    expect(openWith(ring, next, TX)).toBe(URL);
  });

  it('P6: sealing the empty string is refused', () => {
    expect(() => sealWith(ringOf(1), 1, '', TX)).toThrow('sealed value unreadable');
  });

  it('P6: an empty, null, truncated, non-v1, garbled or tampered string throws exactly the content-free error', () => {
    const ring = ringOf(1);
    const sealed = sealWith(ring, 1, URL, TX);
    const parts = sealed.split(':');
    const flip = (index: number) => {
      const bytes = Buffer.from(parts[index] ?? '', 'base64url');
      bytes[0] = (bytes[0] ?? 0) ^ 0x01;
      const copy = [...parts];
      copy[index] = bytes.toString('base64url');
      return copy.join(':');
    };
    const bad: unknown[] = [
      '',
      null,
      undefined,
      42,
      sealed.slice(0, 20),
      sealed.replace(/^v1:/, 'v2:'),
      sealed.replace(/^v1:1:/, 'v1:0:'),
      sealed.replace(/^v1:1:/, 'v1:32768:'),
      sealed.replace(/^v1:1:/, 'v1:01:'),
      'not a sealed secret',
      `${sealed}:extra`,
      flip(2),
      flip(3),
      flip(4),
    ];
    for (const value of bad) {
      expect(() => openWith(ring, value as string, TX), String(value)).toThrow(
        new Error('sealed value unreadable'),
      );
    }
  });

  it('T-09.2-11: no error message holds the plaintext, the sealed string or a key', () => {
    const k = key();
    const ring = new Map([[1, k]]);
    const sealed = sealWith(ring, 1, URL, TX);
    const attempts: (() => unknown)[] = [
      () => openWith(ring, sealed, SERVICE),
      () => openWith(new Map([[2, k]]), sealed, TX),
      () => openWith(ring, `${sealed}x`, TX),
      () => sealWith(ring, 9, URL, TX),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
        expect.unreachable();
      } catch (error) {
        const message = String((error as Error).message);
        expect(message).toBe('sealed value unreadable');
        expect(message).not.toContain('s3cret');
        expect(message).not.toContain(k.toString('base64'));
      }
    }
  });

  it('wire compatibility: a value sealed by the payments helper opens through openWith with the matching one-key ring', () => {
    const material = { key: key(), keyId: 3 };
    const sealed = sealSecretWith(material, 'gateway-token', PROJECT);
    expect(openWith(new Map([[3, material.key]]), sealed, PROJECT)).toBe('gateway-token');
  });
});

describe('resealWith', () => {
  it('yields a string under the current id that opens to the same plaintext', () => {
    const ring = ringOf(1, 2);
    const old = sealWith(ring, 1, URL, TX);
    const next = resealWith(ring, 2, old, TX);
    expect(next).not.toBe(old);
    expect(keyIdOf(next)).toBe(2);
    expect(openWith(ring, next, TX)).toBe(URL);
    // Once re-sealed, the old key is no longer needed to read it.
    expect(openWith(new Map([[2, ring.get(2) as Buffer]]), next, TX)).toBe(URL);
  });

  it('refuses a value it cannot open, leaving nothing to write', () => {
    const ring = ringOf(1, 2);
    const old = sealWith(ring, 1, URL, TX);
    expect(() => resealWith(ring, 2, old, SERVICE)).toThrow('sealed value unreadable');
    expect(() => resealWith(new Map([[2, ring.get(2) as Buffer]]), 2, old, TX)).toThrow(
      'sealed value unreadable',
    );
  });
});

describe('parseKeyring / resolveKeyring', () => {
  const b64 = (n = 32) => randomBytes(n).toString('base64');

  it('P6: refuses an empty object, a non-object, malformed JSON and an empty string', () => {
    for (const json of ['{}', '[]', '"abc"', 'null', '42', 'not json', '']) {
      expect(() => parseKeyring(json), json).toThrow('platform master keys invalid');
    }
  });

  it('refuses a key of 31 bytes, a non-string key, an id of 0, an id of 32768 and an id that is not a plain integer', () => {
    const cases: Record<string, unknown>[] = [
      { '1': b64(31) },
      { '1': b64(33) },
      { '1': 5 },
      { '0': b64() },
      { '32768': b64() },
      { '01': b64() },
      { '-1': b64() },
      { '1.5': b64() },
      { one: b64() },
    ];
    for (const value of cases) {
      expect(() => parseKeyring(JSON.stringify(value)), JSON.stringify(value)).toThrow(
        'platform master keys invalid',
      );
    }
  });

  it('accepts the bounds 1 and 32767', () => {
    const ring = parseKeyring(JSON.stringify({ '1': b64(), '32767': b64() }));
    expect([...ring.keys()]).toEqual([1, 32767]);
  });

  it('P5: a ring that does not hold the current id is refused at load', () => {
    const keys = JSON.stringify({ '1': b64() });
    expect(() => resolveKeyring({ keys, currentId: 2 })).toThrow('platform master keys invalid');
    expect(resolveKeyring({ keys, currentId: 1 }).currentId).toBe(1);
  });

  it('outside production a missing ring is the fixed development key (id 1), in production it is refused', () => {
    const a = resolveKeyring({ keys: undefined, currentId: 1 });
    const b = resolveKeyring({ keys: undefined, currentId: 1, production: false });
    expect(a.ring.get(1)?.equals(b.ring.get(1) as Buffer)).toBe(true);
    expect(a.ring.get(1)).toHaveLength(32);
    expect(() => resolveKeyring({ keys: undefined, currentId: 1, production: true })).toThrow(
      'platform master keys invalid',
    );
    // ...and the development ring holds only id 1.
    expect(() => resolveKeyring({ keys: undefined, currentId: 2 })).toThrow(
      'platform master keys invalid',
    );
  });

  it('a configured ring wins over the development key', () => {
    const keys = JSON.stringify({ '1': b64() });
    const configured = resolveKeyring({ keys, currentId: 1 });
    const dev = resolveKeyring({ keys: undefined, currentId: 1 });
    expect(configured.ring.get(1)?.equals(dev.ring.get(1) as Buffer)).toBe(false);
  });
});
