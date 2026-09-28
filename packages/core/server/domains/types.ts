import type { DnsRecord } from '@rede-social/contracts';

/**
 * Custom-domain adapter contracts (TENANT-07, D-34/D-36). This file knows no database and no env:
 * it is the seam between the platform lane (`server/platform/domains.ts`), the kernel poller
 * (`domains/verify-job.ts`) and the two implementations of each contract — `fake` / `local` for
 * every non-production environment and `vercel` / `supabase` for the hosted ones (`domains/index.ts`
 * selects by the kernel env).
 */

/**
 * What the provider knows about a host right now. Two INDEPENDENT conditions, both required before
 * `verified_at` is written (RESEARCH Pitfall 5): `ownershipVerified` (the customer proved the domain
 * is theirs — Vercel `verified`, TXT challenge otherwise) and `configured` (DNS points at the
 * platform and a certificate can be issued — Vercel `misconfigured === false`). `records` are the
 * instructions the customer must create, in the provider's order.
 */
export type DomainCheck = {
  ownershipVerified: boolean;
  configured: boolean;
  records: DnsRecord[];
};

/**
 * Hosting-provider side of a tenant host: project-level attach / status / verify / detach and
 * nothing else (COVERAGE.md OPT-OUT rows: never list, never buy, never write the customer's DNS,
 * never delete at the account level).
 *
 * - `addDomain` is idempotent when the host is already on this project.
 * - `removeDomain` treats not-found as success (Pitfall 9: a row without a registration must never
 *   block re-attaching).
 */
export interface DomainProvider {
  readonly name: 'fake' | 'vercel';
  addDomain(host: string): Promise<DomainCheck>;
  getDnsRecords(host: string): Promise<DnsRecord[]>;
  verify(host: string): Promise<DomainCheck>;
  removeDomain(host: string): Promise<void>;
}

export type DomainProviderErrorKind =
  | 'in_use'
  | 'invalid_domain'
  | 'forbidden'
  | 'rate_limited'
  | 'unavailable';

/**
 * The ONLY error shape an adapter raises. The message carries the kind and the HTTP status and
 * nothing else — never a response body, a header or the host (T-02-51: a provider answer may echo
 * the bearer token or another customer's data, and this message ends up in logs and `last_error`).
 */
export class DomainProviderError extends Error {
  readonly kind: DomainProviderErrorKind;
  readonly status: number | undefined;

  constructor(kind: DomainProviderErrorKind, status?: number) {
    super(
      status === undefined ? `domain provider: ${kind}` : `domain provider: ${kind} (${status})`,
    );
    this.name = 'DomainProviderError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Supabase Auth redirect allow-list writer. `add` / `remove` are idempotent and operate on exactly
 * one entry per host — `allowListEntry(host)` — so a verified host can receive invite / recovery
 * links on its own origin (D-22/D-29) and a detached one stops being a valid `redirect_to`.
 */
export interface AuthAllowList {
  readonly name: 'local' | 'supabase';
  add(host: string): Promise<void>;
  remove(host: string): Promise<void>;
}

/**
 * The ONE allow-list entry shape: exact host, the confirm path, `**` for the query — never a
 * wildcard host (docs/DEPLOY.md WR-09; T-02-53). `https` always: the hosted web app is TLS-only and
 * the local stack does not go through the allow-list adapter at all (`config.toml` allows
 * `http://*.localhost:3000/**`).
 */
export const allowListEntry = (host: string): string => `https://${host}/auth/confirm**`;

/** The kernel-owned pg-boss queue of the domain poller (D-34). Registered in `domains/index.ts`. */
export const DOMAIN_VERIFY_QUEUE = 'kernel.domain-verify';

export type DomainVerifyPayload = { domainId: string };

/** Poll cadence while a host is pending (seconds) — far below any provider rate limit. */
export const DOMAIN_VERIFY_INTERVAL_S = 600;

/** How long a host may stay pending before the poller marks it `expired` (7 days). */
export const DOMAIN_VERIFY_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;
