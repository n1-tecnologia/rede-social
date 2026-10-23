import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, type JWK, jwtVerify, SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { createJwksMap, issuerFor, JWKS_MAP_MAX, jwksCount, jwksFor } from '../server/auth/jwks';

/**
 * 09.2-08 (DBT-10, D-538): the per-project key sets. No database; the cooldown case uses a tiny in-process
 * JWKS endpoint of its own.
 */

describe('jwksFor / issuerFor', () => {
  it('returns the same key-set function for the same project URL, and another for another URL', () => {
    const a = jwksFor('http://127.0.0.1:59001');
    expect(jwksFor('http://127.0.0.1:59001')).toBe(a);
    expect(jwksFor('http://127.0.0.1:59001/')).toBe(a);
    expect(jwksFor('http://127.0.0.1:59002')).not.toBe(a);
  });

  it('the key-set map is bounded at 64: the oldest is dropped, the count never exceeds the bound', () => {
    expect(JWKS_MAP_MAX).toBe(64);
    const map = createJwksMap();
    const first = map.jwksFor('http://127.0.0.1:59100');
    for (let i = 1; i < 200; i += 1) map.jwksFor(`http://127.0.0.1:${59100 + i}`);
    expect(map.size).toBe(64);
    // The first was evicted, so asking again builds a new function.
    expect(map.jwksFor('http://127.0.0.1:59100')).not.toBe(first);
    expect(jwksCount()).toBeLessThanOrEqual(64);
  });

  it('issuerFor has no trailing slash and ignores one on the project URL', () => {
    expect(issuerFor('https://abc.supabase.co')).toBe('https://abc.supabase.co/auth/v1');
    expect(issuerFor('https://abc.supabase.co/')).toBe('https://abc.supabase.co/auth/v1');
    expect(issuerFor('https://abc.supabase.co//')).toBe('https://abc.supabase.co/auth/v1');
  });

  it('source: nothing in jwks.ts reads token content or interpolates anything but the project URL', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../server/auth/jwks.ts', import.meta.url)),
      'utf8',
    );
    const code = src
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/decodeJwt|jwtDecode|\.iss\b|payload|protectedHeader/);
    const interpolated = [...code.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]?.trim());
    for (const expr of interpolated) {
      expect(['base', 'baseOf(apiUrl)']).toContain(expr);
    }
  });
});

describe('the cooldown of an unknown kid (P22)', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  async function key(kid: string) {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
    return { jwk, privateKey };
  }

  it('a token whose kid appears later is refused inside the cooldown and accepted after it', async () => {
    const k1 = await key('k1');
    const k2 = await key('k2');
    const served: JWK[] = [k1.jwk];
    let fetches = 0;
    server = createServer((req, res) => {
      if (req.url === '/auth/v1/.well-known/jwks.json') {
        fetches += 1;
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ keys: served }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const map = createJwksMap(8, { cooldownDuration: 150 });
    const keyset = map.jwksFor(url);

    const sign = (k: { privateKey: CryptoKey }, kid: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid })
        .setSubject('u')
        .setIssuer(issuerFor(url))
        .setAudience('authenticated')
        .setExpirationTime('1h')
        .sign(k.privateKey);
    const opts = { issuer: issuerFor(url), audience: 'authenticated', algorithms: ['ES256'] };

    await expect(jwtVerify(await sign(k1, 'k1'), keyset, opts)).resolves.toBeTruthy();
    expect(fetches).toBe(1);

    // The new key is published, but the token is checked INSIDE the cooldown: no refetch, refused.
    served.push(k2.jwk);
    const t2 = await sign(k2, 'k2');
    await expect(jwtVerify(t2, keyset, opts)).rejects.toBeTruthy();
    expect(fetches).toBe(1);

    // After the cooldown the same token reloads the set once and is accepted.
    await new Promise((r) => setTimeout(r, 200));
    await expect(jwtVerify(t2, keyset, opts)).resolves.toBeTruthy();
    expect(fetches).toBe(2);
  });
});
