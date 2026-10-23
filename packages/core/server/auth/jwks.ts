import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { env } from '../env';

/**
 * Per-project key sets (09.2-08, D-538, DBT-10). A bearer is verified against the keys and the issuer of the
 * project the REQUEST'S HOST selects, never the project a token names for itself: the keyset URL here is built
 * ONLY from the registry's `api_url` handed in by the caller, and nothing in this file reads token content.
 *
 * jose's `createRemoteJWKSet` keeps the in-flight fetch dedupe (twenty first requests fetch once), a 30 s
 * cooldown between refetches for an unknown `kid`, a 10 min cache and a 5 s fetch timeout; the memoised
 * function per project URL is what makes those guarantees per project.
 */

/** Upper bound on distinct project key sets held in one process. Oldest-inserted is dropped first. */
export const JWKS_MAP_MAX = 64;

export type JwksOptions = {
  /** Test seam: jose's `cooldownDuration` (ms). Production uses the library default (30 s). */
  cooldownDuration?: number;
  /** Test seam: jose's `timeoutDuration` (ms). Production uses the library default (5 s). */
  timeoutDuration?: number;
};

const baseOf = (apiUrl: string): string => apiUrl.replace(/\/+$/, '');

/** The key set map in one process: a bounded, insertion-ordered memo keyed by a registry `api_url`. */
export function createJwksMap(max: number = JWKS_MAP_MAX, options: JwksOptions = {}) {
  const map = new Map<string, JWTVerifyGetKey>();
  return {
    jwksFor(apiUrl: string): JWTVerifyGetKey {
      const base = baseOf(apiUrl);
      const hit = map.get(base);
      if (hit) return hit;
      const created = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), options);
      if (map.size >= max) {
        const oldest = map.keys().next();
        if (!oldest.done) map.delete(oldest.value);
      }
      map.set(base, created);
      return created;
    },
    get size() {
      return map.size;
    },
  };
}

const keysets = createJwksMap();

/** The memoised remote key set of one project, keyed by the registry's `api_url`. */
export const jwksFor = (apiUrl: string): JWTVerifyGetKey => keysets.jwksFor(apiUrl);

/** The `iss` claim the project's Auth stamps on its tokens. */
export const issuerFor = (apiUrl: string): string => `${baseOf(apiUrl)}/auth/v1`;

/** Number of project key sets held right now (never more than `JWKS_MAP_MAX`). */
export const jwksCount = (): number => keysets.size;

/** Project 0 (the central project): the identity lane, the platform lane and every legacy caller. */
export const JWKS = jwksFor(env.SUPABASE_URL);

export const JWT_ISSUER = issuerFor(env.SUPABASE_URL);
