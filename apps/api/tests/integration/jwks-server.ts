import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';

/**
 * 09.2-08: an in-process stand-in for a project's Auth. It serves `GET /auth/v1/.well-known/jwks.json` for
 * generated ES256 keys, counts the fetches (the P22 cases read the counter), can delay or break its answer,
 * and signs bearers the way GoTrue does (`aud: 'authenticated'`, `iss: <url>/auth/v1`, one-hour `exp`).
 * A registry row whose `api_url` is `url` is, for the API's verification, a second project.
 */

export type BearerClaims = {
  sub: string;
  email?: string;
  /** Override the issuer claim (the confused-project negative). Default `<url>/auth/v1`. */
  iss?: string;
  aud?: string;
  /** Seconds from now. Default 3600; negative signs an expired token. */
  expiresInSeconds?: number;
};

export type TestKey = {
  kid: string;
  /** The public JWK as the server would publish it. */
  jwk: JWK;
  signBearer: (claims: BearerClaims) => Promise<string>;
  /** Adds the key to the served JWKS from now on. */
  publish: () => void;
};

export type JwksServer = {
  /** `http://127.0.0.1:<port>`, no trailing slash: the registry's `api_url`. */
  url: string;
  issuer: string;
  /** The key published at start. */
  kid: string;
  signBearer: (claims: BearerClaims) => Promise<string>;
  /** How many times `/auth/v1/.well-known/jwks.json` was requested. */
  readonly fetches: number;
  resetFetches: () => void;
  /** Delay every JWKS answer by `ms` (0 turns it off). */
  setDelay: (ms: number) => void;
  /** A fresh key that is NOT published until `publish()` is called. */
  newKey: () => Promise<TestKey>;
  stop: () => Promise<void>;
};

export async function startJwksServer(): Promise<JwksServer> {
  let fetches = 0;
  let delayMs = 0;
  const published: JWK[] = [];
  const timers = new Set<NodeJS.Timeout>();
  let origin = '';

  const makeKey = async (): Promise<TestKey> => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const kid = `k-${crypto.randomUUID()}`;
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
    return {
      kid,
      jwk,
      publish: () => {
        if (!published.some((k) => k.kid === kid)) published.push(jwk);
      },
      signBearer: (claims) => sign(privateKey, kid, claims),
    };
  };

  const sign = async (
    privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'],
    kid: string,
    claims: BearerClaims,
  ): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      ...(claims.email ? { email: claims.email } : {}),
      role: 'authenticated',
    })
      .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
      .setSubject(claims.sub)
      .setAudience(claims.aud ?? 'authenticated')
      .setIssuer(claims.iss ?? `${origin}/auth/v1`)
      .setIssuedAt(now)
      .setExpirationTime(now + (claims.expiresInSeconds ?? 3600))
      .sign(privateKey);
  };

  const first = await makeKey();
  first.publish();

  const server: Server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/auth/v1/.well-known/jwks.json') {
      fetches += 1;
      const answer = () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys: published }));
      };
      if (delayMs > 0) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (!res.destroyed) answer();
        }, delayMs);
        timers.add(timer);
        req.on('close', () => {
          clearTimeout(timer);
          timers.delete(timer);
        });
      } else {
        answer();
      }
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: origin,
    issuer: `${origin}/auth/v1`,
    kid: first.kid,
    signBearer: first.signBearer,
    get fetches() {
      return fetches;
    },
    resetFetches: () => {
      fetches = 0;
    },
    setDelay: (ms) => {
      delayMs = ms;
    },
    newKey: makeKey,
    stop: async () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
