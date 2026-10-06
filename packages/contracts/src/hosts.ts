import { z } from 'zod';
import { hostBrandingSchema } from './branding';

/** Header the web BFF forwards to the API with the browser-facing host, already normalised (D-23). */
export const TENANT_HOST_HEADER = 'x-tenant-host';

/**
 * 08.1 (D-308, D-06): the community the person picked on a host that is NOT a tenant host, as a slug.
 * A hint, never authority: the API honours it only on non-tenant hosts and only when it names one of
 * the caller's OWN memberships; on a tenant host, or naming any other community, it is ignored.
 */
export const TENANT_CHOICE_HEADER = 'x-tenant-choice';

/**
 * The ONE place hosts are canonicalised: trim, lower-case, strip a trailing `:port`.
 * Returns null for empty input so `REDE-DEMO.LOCALHOST:3000` and `rede-demo.localhost` share a key everywhere.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let host = raw.trim().toLowerCase();
  if (host.startsWith('[')) {
    // IPv6 literal: keep the bracketed address, drop `:port` after the closing bracket.
    const end = host.indexOf(']');
    host = end === -1 ? host : host.slice(0, end + 1);
  } else {
    const colon = host.indexOf(':');
    if (colon !== -1) host = host.slice(0, colon);
  }
  host = host.replace(/\.+$/, '');
  return host.length === 0 ? null : host;
}

/**
 * The shape a host must have to be looked up or cached at all — the SAME predicate as the database
 * check `tenant_domains_host_chk` (`^[a-z0-9.-]{1,253}$`, on the already-normalised value).
 * Anything else (IPv6 literals, underscores, control characters, > 253 chars) can never match a
 * registered domain, so it is answered "unknown" before it touches a cache key or a query
 * (phase-1 review WR-06: caches keyed by attacker-controlled input must only admit values that
 * could exist).
 */
export const HOST_SHAPE = /^[a-z0-9.-]{1,253}$/;
export const isRegistrableHost = (host: string): boolean => HOST_SHAPE.test(host);

export type BoundedTtlCache<V> = {
  /** The value if present and not expired; an expired entry is dropped on read. */
  get(key: string): V | undefined;
  /** Stores `value` for `ttlMs`; evicts the least recently used entry when the bound is reached. */
  set(key: string, value: V, ttlMs: number): void;
  delete(key: string): void;
  readonly size: number;
};

/**
 * A `Map`-backed LRU with per-entry expiry and a hard `max`. The host caches in the API
 * (`resolveTenantHost`) and the web BFF (`resolveHostTenant`) are keyed by a client-supplied host
 * and remember negative answers too, so without a bound a client iterating random hostnames grows
 * them for the life of the instance (WR-06). Insertion order is the LRU order: a hit re-inserts.
 */
export function createBoundedTtlCache<V>(max: number): BoundedTtlCache<V> {
  if (!Number.isInteger(max) || max < 1) throw new Error('bounded cache: max must be >= 1');
  const store = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      // Re-insert so the most recently used key is last in iteration order.
      store.delete(key);
      store.set(key, hit);
      return hit.value;
    },
    set(key, value, ttlMs) {
      store.delete(key);
      if (store.size >= max) {
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    delete(key) {
      store.delete(key);
    },
    get size() {
      return store.size;
    },
  };
}

/**
 * Body of `GET /v1/public/tenants/by-host` — brand and host facts only, nothing beyond (D-20, T-02-04):
 * no plan, timezone, ids or member counts ever enter this unauthenticated answer.
 *
 * - `status` (D-32): a suspended tenant's host STILL resolves so the "indisponível" screen is branded.
 * - `isPrimary` / `primaryHost` (D-35): a tenant may own several verified hosts but exactly one primary;
 *   `proxy.ts` 308s the aliases to `primaryHost`.
 * - `branding` (D-25): the resolved public brand — colors with derivations, logo, favicon, icon set.
 *
 * Only VERIFIED hosts answer 200 (D-36); everything else is 404 `TENANT_NOT_FOUND`.
 */
export const hostTenantSchema = z
  .object({
    slug: z.string(),
    displayName: z.string(),
    status: z.enum(['active', 'suspended']),
    isPrimary: z.boolean(),
    primaryHost: z.string(),
    branding: hostBrandingSchema,
  })
  .strict();
export type HostTenant = z.infer<typeof hostTenantSchema>;
export type TenantStatus = HostTenant['status'];
