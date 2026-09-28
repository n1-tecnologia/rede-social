import {
  type AttachDomainBody,
  type DnsRecord,
  type DomainStatus,
  normalizeHost,
  type TenantDomain,
  type TenantDomainsList,
} from '@rede-social/contracts';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantDomains, tenants } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import {
  authAllowList,
  DOMAIN_VERIFY_DEADLINE_MS,
  DOMAIN_VERIFY_INTERVAL_S,
  DOMAIN_VERIFY_QUEUE,
  DomainProviderError,
  domainProvider,
} from '../domains/index';
import { env } from '../env';
import { ApiError } from '../http/api-error';
import { enqueueInTx } from '../jobs/boss';
import { invalidateTenantHost } from '../tenancy/tenant-host';
import { logFor, type PlatformActor, sendPendingInvites } from './invites';

/**
 * Custom domains of a tenant (TENANT-07, D-34/D-35/D-36) — the admin-lane service behind
 * `/v1/platform/tenants/{id}/domains*` AND the `kernel.domain-verify` poller. Everything that
 * touches `tenant_domains` at runtime lives here, so the route and the job share ONE
 * `checkDomain` and the verified transition has exactly one writer.
 *
 * Invariants this file keeps (pinned by `platform-domains.test.ts` and pgTAP 050):
 *  - `verified_at` is written ONLY by the single `update … where verified_at is null returning`
 *    inside `checkDomain` — the row that comes back is the one and only winner, the loser runs no
 *    side effects (T-02-54);
 *  - a host is registered at the provider BEFORE its row exists (PATTERNS Analog B), and an insert
 *    failure compensates with `removeDomain`;
 *  - every read/mutation a route asks for is scoped by `tenant_id AND id`, so another tenant's
 *    domain id is a plain 404 (T-02-57);
 *  - the 409 for a host owned by another tenant never names that tenant (T-02-58).
 */

type DomainRow = typeof tenantDomains.$inferSelect;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

const toTenantDomain = (d: DomainRow): TenantDomain => ({
  id: d.id,
  host: d.host,
  isPrimary: d.isPrimary,
  verificationStatus: d.verificationStatus as DomainStatus,
  verifiedAt: iso(d.verifiedAt),
  dnsRecords: d.dnsRecords,
  lastCheckedAt: iso(d.lastCheckedAt),
  verifyDeadlineAt: iso(d.verifyDeadlineAt),
  lastError: d.lastError,
  createdAt: d.createdAt.toISOString(),
});

/**
 * Keeps the provider's order but drops later duplicates of the same `type + name` (case-insensitive
 * name), so a re-check never depends on array order and the panel never shows one instruction twice
 * (edge TENANT-07/ordering).
 */
export function dedupeDnsRecords(records: readonly DnsRecord[]): DnsRecord[] {
  const seen = new Set<string>();
  const out: DnsRecord[] = [];
  for (const record of records) {
    const key = `${record.type}|${record.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

/** Postgres `23505` (unique_violation), possibly wrapped by drizzle's `DrizzleQueryError`: the constraint name, or null. */
function uniqueViolationConstraint(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23505') {
      return typeof e.constraint_name === 'string' ? e.constraint_name : '';
    }
    current = e.cause;
  }
  return null;
}

/**
 * The shape the attach body already guarantees (`normalizeHost` + `isRegistrableHost`) plus what a
 * provider would refuse anyway: at least one dot, no empty label, no label starting/ending with `-`.
 */
function isAttachableHost(host: string): boolean {
  const labels = host.split('.');
  if (labels.length < 2) return false;
  return labels.every(
    (label) => label.length > 0 && !label.startsWith('-') && !label.endsWith('-'),
  );
}

/** Serialises every allow-list read-modify-write across API instances and the worker (RESEARCH Pattern 5). */
async function withAllowListLock(fn: () => Promise<void>): Promise<void> {
  await withAdminTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tenant_domains.allow_list'))`);
    await fn();
  });
}

/** Re-arms the poller for a host: one deferred job per `domainId` (duplicates are dropped by the `short` policy). */
async function enqueueVerify(tx: Tx, domainId: string): Promise<void> {
  await enqueueInTx(
    tx,
    DOMAIN_VERIFY_QUEUE,
    { domainId },
    { singletonKey: domainId, startAfter: DOMAIN_VERIFY_INTERVAL_S },
  );
}

async function loadRow(
  tx: Tx,
  domainId: string,
  tenantId?: string,
): Promise<DomainRow | undefined> {
  const rows = await tx
    .select()
    .from(tenantDomains)
    .where(
      tenantId
        ? and(eq(tenantDomains.id, domainId), eq(tenantDomains.tenantId, tenantId))
        : eq(tenantDomains.id, domainId),
    )
    .limit(1);
  return rows[0];
}

async function tenantExists(tx: Tx, tenantId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return rows.length > 0;
}

async function listRows(tx: Tx, tenantId: string): Promise<DomainRow[]> {
  return tx
    .select()
    .from(tenantDomains)
    .where(eq(tenantDomains.tenantId, tenantId))
    .orderBy(desc(tenantDomains.isPrimary), asc(tenantDomains.createdAt));
}

const toList = (rows: DomainRow[]): TenantDomainsList => ({
  domains: rows.map(toTenantDomain),
  primaryHost: rows.find((r) => r.isPrimary && r.verifiedAt !== null)?.host ?? null,
});

/** `GET …/domains` — every host of the tenant, primary first; `primaryHost` is the VERIFIED primary or null. */
export async function listTenantDomains(tenantId: string): Promise<TenantDomainsList> {
  return withAdminTx(async (tx) => {
    if (!(await tenantExists(tx, tenantId))) throw new ApiError(404, 'NOT_FOUND');
    return toList(await listRows(tx, tenantId));
  });
}

export type AttachDomainResult = { domain: TenantDomain; created: boolean };

/** Maps a provider refusal on attach to the envelope; anything else stays a 500. */
function attachProviderError(error: unknown, log: ReturnType<typeof logFor>): never {
  if (error instanceof DomainProviderError) {
    switch (error.kind) {
      case 'in_use':
        throw new ApiError(409, 'DOMAIN_IN_USE', { reason: 'provider' });
      case 'invalid_domain':
        throw new ApiError(400, 'VALIDATION_FAILED', { host: 'invalid_domain' });
      case 'rate_limited':
        log.warn(
          { event: 'platform.domains.provider_rate_limited', status: error.status ?? null },
          'provider rate limited the attach',
        );
        throw new ApiError(503, 'INTERNAL');
      default:
        log.error(
          { event: 'platform.domains.provider_failed', kind: error.kind, status: error.status },
          'provider refused the attach',
        );
        throw new ApiError(500, 'INTERNAL');
    }
  }
  log.error(
    {
      event: 'platform.domains.provider_failed',
      err: error instanceof Error ? error.message : String(error),
    },
    'provider call failed',
  );
  throw new ApiError(500, 'INTERNAL');
}

/**
 * `POST …/domains` (D-34). Order matters:
 *  1. guards on the (already normalised) host: never the platform host (D-21), never an
 *     unregistrable shape;
 *  2. the existing row for the host — citext makes every case variant ONE lookup: same tenant ->
 *     idempotent 200 with NO provider call; another tenant -> 409 without details;
 *  3. the provider registration (`addDomain`), BEFORE the row (PATTERNS Analog B);
 *  4. the row + the deferred poller in one admin transaction. `is_primary` is true for the tenant's
 *     first host; a concurrent second "first host" loses on `tenant_domains_one_primary_per_tenant`
 *     and is retried as non-primary. A concurrent identical attach loses on
 *     `tenant_domains_host_key` and re-reads the winner's row (same tenant) or answers 409 (other
 *     tenant — the registration now legitimately belongs to the winner, so no `removeDomain`).
 *     Any other insert failure compensates with `removeDomain` and answers 500.
 */
export async function attachDomain(
  tenantId: string,
  body: AttachDomainBody,
  actor: PlatformActor,
): Promise<AttachDomainResult> {
  const log = logFor(actor, 'platform-domains');
  const host = body.host;

  const platformHost = normalizeHost(env.PLATFORM_HOST);
  if (platformHost && host === platformHost) {
    throw new ApiError(400, 'VALIDATION_FAILED', { host: 'platform_host' });
  }
  if (!isAttachableHost(host)) {
    throw new ApiError(400, 'VALIDATION_FAILED', { host: 'not_registrable' });
  }

  const existing = await withAdminTx(async (tx) => {
    if (!(await tenantExists(tx, tenantId))) throw new ApiError(404, 'NOT_FOUND');
    const rows = await tx.select().from(tenantDomains).where(eq(tenantDomains.host, host)).limit(1);
    return rows[0];
  });
  if (existing) {
    if (existing.tenantId === tenantId) return { domain: toTenantDomain(existing), created: false };
    // No details: the body must never name the tenant that owns this host (T-02-58).
    throw new ApiError(409, 'DOMAIN_IN_USE');
  }

  let records: DnsRecord[];
  try {
    const check = await domainProvider.addDomain(host);
    records = dedupeDnsRecords(check.records);
  } catch (error) {
    attachProviderError(error, log);
  }

  const insert = async (forceNonPrimary: boolean): Promise<DomainRow> =>
    withAdminTx(async (tx) => {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(tenantDomains)
        .where(eq(tenantDomains.tenantId, tenantId));
      const [row] = await tx
        .insert(tenantDomains)
        .values({
          tenantId,
          host,
          isPrimary: !forceNonPrimary && n === 0,
          verifiedAt: null,
          verificationStatus: 'pending',
          dnsRecords: records,
          verifyDeadlineAt: new Date(Date.now() + DOMAIN_VERIFY_DEADLINE_MS),
          lastCheckedAt: null,
          lastError: null,
        })
        .returning();
      if (!row) throw new Error('tenant_domains insert returned no row');
      await enqueueVerify(tx, row.id);
      return row;
    });

  let row: DomainRow;
  try {
    try {
      row = await insert(false);
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);
      if (constraint?.includes('one_primary')) {
        row = await insert(true);
      } else {
        throw error;
      }
    }
  } catch (error) {
    const constraint = uniqueViolationConstraint(error);
    if (constraint !== null && (constraint === '' || constraint.includes('host'))) {
      const winner = await withAdminTx(async (tx) => {
        const rows = await tx
          .select()
          .from(tenantDomains)
          .where(eq(tenantDomains.host, host))
          .limit(1);
        return rows[0];
      });
      if (winner && winner.tenantId === tenantId) {
        return { domain: toTenantDomain(winner), created: false };
      }
      throw new ApiError(409, 'DOMAIN_IN_USE');
    }
    // Compensation (Analog B): the registration must not outlive the row that never got written.
    let removeError: string | null = null;
    try {
      await domainProvider.removeDomain(host);
    } catch (e) {
      removeError = e instanceof Error ? e.message : String(e);
    }
    log.error(
      {
        event: 'platform.domains.attach_compensated',
        userId: actor.userId,
        tenantId,
        host,
        removeError,
        err: error instanceof Error ? error.message : String(error),
      },
      'tenant_domains insert failed; provider registration removed',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  log.info(
    {
      event: 'platform.domains.attach',
      userId: actor.userId,
      tenantId,
      domainId: row.id,
      host,
      provider: domainProvider.name,
      isPrimary: row.isPrimary,
    },
    'domain attached',
  );
  return { domain: toTenantDomain(row), created: true };
}

export type CheckDomainOutcome = 'verified' | 'already_verified' | 'pending' | 'expired' | 'gone';
export type CheckDomainResult = { outcome: CheckDomainOutcome; domain: TenantDomain | null };

async function recordError(domainId: string, lastError: string): Promise<void> {
  await withAdminTx(async (tx) => {
    await tx.update(tenantDomains).set({ lastError }).where(eq(tenantDomains.id, domainId));
  });
}

/**
 * Clears `last_error` only when something is set (a no-op otherwise, so it is safe on every path).
 * Called by `checkDomain` after a fully successful `ensureVerifiedSideEffects` run, so the panel's
 * "Verificar agora" offer on a verified host disappears once the retry succeeded (WR-01).
 */
async function clearLastErrorIfSettled(domainId: string): Promise<void> {
  await withAdminTx(async (tx) => {
    await tx
      .update(tenantDomains)
      .set({ lastError: null })
      .where(and(eq(tenantDomains.id, domainId), isNotNull(tenantDomains.lastError)));
  });
}

/**
 * What must follow the verified transition, in this order, OUTSIDE the transaction and idempotent
 * (re-run on every "Verificar agora" of an already verified host — that is how a failed allow-list
 * call is recoverable from the panel):
 *  1. `invalidateTenantHost` so the host resolves on this instance's next request (D-36);
 *  2. the allow-list entry, under the cross-process advisory lock (T-02-53);
 *  3. `sendPendingInvites` — claim-before-send, so re-runs never send twice (D-30, T-02-54).
 * Failures of 2/3 are recorded in `last_error` and logged, never thrown, and never touch
 * `verified_at`. Returns whether both steps succeeded; the callers clear `last_error` only then
 * (WR-01).
 */
async function ensureVerifiedSideEffects(row: DomainRow, actor: PlatformActor): Promise<boolean> {
  const log = logFor(actor, 'platform-domains');
  invalidateTenantHost(row.host);
  let ok = true;

  try {
    await withAllowListLock(() => authAllowList.add(row.host));
  } catch (error) {
    ok = false;
    log.error(
      {
        event: 'platform.domains.allow_list_failed',
        tenantId: row.tenantId,
        domainId: row.id,
        host: row.host,
        err: error instanceof Error ? error.message : String(error),
      },
      'allow-list add failed; retry with "Verificar agora"',
    );
    await recordError(row.id, 'allow_list');
  }

  try {
    await sendPendingInvites(row.tenantId, actor);
  } catch (error) {
    ok = false;
    // A refusal (02-19: the admin e-mail already has an identity on the platform) is recorded with
    // its cause — `invite:email_in_use` / `invite:user_in_other_tenant` — so the Domínios card can
    // name it; every other failure stays the plain `invite`. The row is no longer `pending` after a
    // refusal, so the next re-run finds nothing to send and the clear (WR-01) removes the cause.
    const reason = inviteRefusalReason(error);
    log.error(
      {
        event: 'platform.domains.invite_failed',
        tenantId: row.tenantId,
        domainId: row.id,
        host: row.host,
        reason,
        err: error instanceof Error ? error.message : String(error),
      },
      'pending invites could not be sent; retry with "Verificar agora"',
    );
    await recordError(row.id, reason ? `invite:${reason}` : 'invite');
  }

  return ok;
}

/** The `details.reason` of a 409 `INVITE_STATE_INVALID` thrown by `sendPendingInvites`, else null. */
function inviteRefusalReason(error: unknown): string | null {
  return error instanceof ApiError &&
    error.code === 'INVITE_STATE_INVALID' &&
    typeof error.details?.reason === 'string'
    ? error.details.reason
    : null;
}

/**
 * The ONE check the route ("Verificar agora"), the restart and the poller share (D-34/D-36).
 *
 * - `gone`: no such row (or, when `tenantId` is given, not this tenant's row) — the route maps it
 *   to 404.
 * - `already_verified`: NO provider call; the side effects re-run idempotently and the row is
 *   answered unchanged (`verified_at` is never reset).
 * - `expired`: the deadline passed (either already marked, marked by this call after a failed
 *   check, or marked by this call after a provider ERROR past the deadline) — nothing is re-armed;
 *   `restartDomainVerification` reopens it.
 * - `verified`: BOTH conditions held and THIS call won the single
 *   `update … set verified_at = now() … where id = $1 and verified_at is null returning` — a
 *   zero-row answer means another caller (the job racing the button) won and this one returns
 *   `already_verified` without running side effects.
 * - `pending`: records/last_checked_at refreshed and the poller re-armed in the same transaction
 *   — including a failed provider call: last_error = '<kind>[:<status>]', last_checked_at
 *   refreshed, poller re-armed in the same transaction (CR-01).
 */
export async function checkDomain(
  domainId: string,
  actor: PlatformActor,
  opts: { source: 'manual' | 'job'; tenantId?: string },
): Promise<CheckDomainResult> {
  const log = logFor(actor, 'platform-domains');

  const row = await withAdminTx((tx) => loadRow(tx, domainId, opts.tenantId));
  if (!row) return { outcome: 'gone', domain: null };

  if (row.verifiedAt !== null) {
    const ok = await ensureVerifiedSideEffects(row, actor);
    if (ok) await clearLastErrorIfSettled(domainId);
    const fresh = await withAdminTx((tx) => loadRow(tx, domainId));
    return { outcome: 'already_verified', domain: toTenantDomain(fresh ?? row) };
  }
  if (row.verificationStatus === 'expired') {
    return { outcome: 'expired', domain: toTenantDomain(row) };
  }

  let check: Awaited<ReturnType<typeof domainProvider.verify>>;
  try {
    check = await domainProvider.verify(row.host);
  } catch (error) {
    // A provider failure (Vercel 429/5xx/timeout, schema mismatch) is a normal poller outcome
    // (CR-01): the deadline still applies and the cadence must survive it. `last_error` carries
    // only the kind and the HTTP status, never anything from the provider's answer (T-02-51).
    const kind = error instanceof DomainProviderError ? error.kind : 'unavailable';
    const status = error instanceof DomainProviderError ? error.status : undefined;
    const now = new Date();
    const expired = row.verifyDeadlineAt !== null && row.verifyDeadlineAt.getTime() < now.getTime();
    const [updated] = await withAdminTx(async (tx) => {
      const rows = await tx
        .update(tenantDomains)
        .set({
          lastCheckedAt: now,
          lastError: status ? `${kind}:${status}` : kind,
          ...(expired ? { verificationStatus: 'expired' as const } : {}),
        })
        // A job that lost the race to a concurrent winner must not stamp the verified row (T-02-54).
        .where(and(eq(tenantDomains.id, domainId), isNull(tenantDomains.verifiedAt)))
        .returning();
      // Re-arm in the SAME transaction unless the deadline passed (a duplicate while the previous
      // job is still `created` is dropped by the `short` policy).
      if (rows[0] && !expired) await enqueueVerify(tx, domainId);
      return rows;
    });
    log.warn(
      {
        event: 'platform.domains.check_failed',
        tenantId: row.tenantId,
        domainId,
        host: row.host,
        source: opts.source,
        kind,
        status: status ?? null,
        expired,
      },
      expired
        ? 'provider check failed; deadline passed; poller stopped'
        : 'provider check failed; poller re-armed',
    );
    return { outcome: expired ? 'expired' : 'pending', domain: toTenantDomain(updated ?? row) };
  }

  const records = dedupeDnsRecords(check.records);
  const now = new Date();

  if (check.ownershipVerified && check.configured) {
    const [winner] = await withAdminTx((tx) =>
      tx
        .update(tenantDomains)
        .set({
          verifiedAt: now,
          verificationStatus: 'verified',
          dnsRecords: records,
          lastCheckedAt: now,
          lastError: null,
        })
        // The single writer of verified_at: `… where id = $1 and verified_at is null returning *`.
        .where(and(eq(tenantDomains.id, domainId), isNull(tenantDomains.verifiedAt)))
        .returning(),
    );
    if (!winner) {
      const fresh = await withAdminTx((tx) => loadRow(tx, domainId));
      return { outcome: 'already_verified', domain: toTenantDomain(fresh ?? row) };
    }
    // The `lastError: null` written by the winning update precedes the side effects, and a
    // `recordError` may land after it — clearing on success keeps the answered row honest.
    const ok = await ensureVerifiedSideEffects(winner, actor);
    if (ok) await clearLastErrorIfSettled(domainId);
    log.info(
      {
        event: 'platform.domains.verified',
        userId: actor.userId,
        tenantId: winner.tenantId,
        domainId,
        host: winner.host,
        source: opts.source,
      },
      'domain verified',
    );
    const fresh = await withAdminTx((tx) => loadRow(tx, domainId));
    return { outcome: 'verified', domain: toTenantDomain(fresh ?? winner) };
  }

  if (row.verifyDeadlineAt && row.verifyDeadlineAt.getTime() < now.getTime()) {
    const [expired] = await withAdminTx((tx) =>
      tx
        .update(tenantDomains)
        .set({ verificationStatus: 'expired', dnsRecords: records, lastCheckedAt: now })
        .where(and(eq(tenantDomains.id, domainId), isNull(tenantDomains.verifiedAt)))
        .returning(),
    );
    log.info(
      {
        event: 'platform.domains.expired',
        tenantId: row.tenantId,
        domainId,
        host: row.host,
        source: opts.source,
      },
      'verification deadline passed; poller stopped',
    );
    return { outcome: 'expired', domain: toTenantDomain(expired ?? row) };
  }

  const [pending] = await withAdminTx(async (tx) => {
    const updated = await tx
      .update(tenantDomains)
      .set({ dnsRecords: records, lastCheckedAt: now, lastError: null })
      .where(and(eq(tenantDomains.id, domainId), isNull(tenantDomains.verifiedAt)))
      .returning();
    if (updated[0]) await enqueueVerify(tx, domainId);
    return updated;
  });
  log.info(
    {
      event: 'platform.domains.verify',
      tenantId: row.tenantId,
      domainId,
      host: row.host,
      source: opts.source,
      ownershipVerified: check.ownershipVerified,
      configured: check.configured,
    },
    'domain still pending; poller re-armed',
  );
  return { outcome: 'pending', domain: toTenantDomain(pending ?? row) };
}

/**
 * Crash path of the poller (`domains/verify-job.ts`): when the handler failed unexpectedly and the
 * row is still pending, one more deferred job keeps the host from going silent. Lives here because
 * the admin lane is confined to `server/{tenancy,platform}` — adapters and the job touch no
 * database directly. A duplicate is dropped by the `short` policy; a missing/non-pending row is a
 * no-op.
 */
export async function rearmDomainVerification(domainId: string): Promise<boolean> {
  return withAdminTx(async (tx) => {
    const row = await loadRow(tx, domainId);
    if (!row || row.verifiedAt !== null || row.verificationStatus !== 'pending') return false;
    await enqueueVerify(tx, domainId);
    return true;
  });
}

/** Every host of the tenant leaves the in-process host cache (their `isPrimary`/`primaryHost` facts changed). */
async function invalidateTenantHosts(tenantId: string): Promise<void> {
  const rows = await withAdminTx((tx) => listRows(tx, tenantId));
  for (const row of rows) invalidateTenantHost(row.host);
}

/**
 * `POST …/domains/{domainId}/primary` (D-35): switches the primary among VERIFIED hosts only.
 * Demote-then-promote in ONE admin transaction (PATTERNS Analog D) — the partial unique index
 * `tenant_domains_one_primary_per_tenant` is the last line of defence. After commit every host of
 * the tenant leaves the cache and `sendPendingInvites` runs (a newly verified primary may unblock
 * the first-admin invite). An invite failure — including a 02-19 refusal — is logged and never
 * fails the switch: the primary already committed, and the invite outcome is visible on the Admins
 * tab (D-D). Already primary -> the unchanged list (idempotent).
 */
export async function setPrimaryDomain(
  tenantId: string,
  domainId: string,
  actor: PlatformActor,
): Promise<TenantDomainsList> {
  const log = logFor(actor, 'platform-domains');
  const row = await withAdminTx((tx) => loadRow(tx, domainId, tenantId));
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  if (row.verifiedAt === null) {
    throw new ApiError(409, 'DOMAIN_STATE_INVALID', { reason: 'not_verified' });
  }
  if (row.isPrimary) return listTenantDomains(tenantId);

  await withAdminTx(async (tx) => {
    await tx
      .update(tenantDomains)
      .set({ isPrimary: false })
      .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.isPrimary, true)));
    await tx
      .update(tenantDomains)
      .set({ isPrimary: true })
      .where(and(eq(tenantDomains.id, domainId), eq(tenantDomains.tenantId, tenantId)));
  });

  await invalidateTenantHosts(tenantId);
  try {
    await sendPendingInvites(tenantId, actor);
  } catch (error) {
    log.error(
      {
        event: 'platform.domains.invite_failed',
        userId: actor.userId,
        tenantId,
        domainId,
        host: row.host,
        reason: inviteRefusalReason(error),
        err: error instanceof Error ? error.message : String(error),
      },
      'pending invites could not be sent after the primary switch; see the Admins tab',
    );
  }
  log.info(
    {
      event: 'platform.domains.set_primary',
      userId: actor.userId,
      tenantId,
      domainId,
      host: row.host,
    },
    'primary host switched',
  );
  return listTenantDomains(tenantId);
}

/**
 * `DELETE …/domains/{domainId}` (D-35, Pitfall 9). The primary cannot be removed while other hosts
 * exist (promote another first). Order: provider detach (not-found is success) -> allow-list entry
 * removed under the lock (a failure is logged, never blocks the delete) -> row deleted -> host cache
 * invalidated. A provider failure leaves the row in place and answers 500.
 */
export async function removeDomain(
  tenantId: string,
  domainId: string,
  actor: PlatformActor,
): Promise<void> {
  const log = logFor(actor, 'platform-domains');
  const { row, others } = await withAdminTx(async (tx) => {
    const row = await loadRow(tx, domainId, tenantId);
    const others = row ? (await listRows(tx, tenantId)).filter((r) => r.id !== domainId) : [];
    return { row, others };
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  if (row.isPrimary && others.length > 0) {
    throw new ApiError(409, 'DOMAIN_STATE_INVALID', { reason: 'primary_with_aliases' });
  }

  try {
    await domainProvider.removeDomain(row.host);
  } catch (error) {
    const kind = error instanceof DomainProviderError ? error.kind : 'unavailable';
    log.error(
      {
        event: 'platform.domains.remove_failed',
        userId: actor.userId,
        tenantId,
        domainId,
        host: row.host,
        kind,
        status: error instanceof DomainProviderError ? (error.status ?? null) : null,
      },
      'provider detach failed; row kept',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  try {
    await withAllowListLock(() => authAllowList.remove(row.host));
  } catch (error) {
    log.error(
      {
        event: 'platform.domains.allow_list_failed',
        tenantId,
        domainId,
        host: row.host,
        err: error instanceof Error ? error.message : String(error),
      },
      'allow-list remove failed; continuing with the delete',
    );
  }

  await withAdminTx((tx) =>
    tx
      .delete(tenantDomains)
      .where(and(eq(tenantDomains.id, domainId), eq(tenantDomains.tenantId, tenantId))),
  );
  invalidateTenantHost(row.host);

  log.info(
    { event: 'platform.domains.remove', userId: actor.userId, tenantId, domainId, host: row.host },
    'domain removed',
  );
}

/**
 * `POST …/domains/{domainId}/restart` (D-34): only an `expired` host may be restarted. In one
 * transaction the row goes back to `pending` with a fresh 7-day deadline and the poller is re-armed;
 * then one check runs immediately (the customer usually restarts right after fixing DNS) and its
 * row is answered.
 */
export async function restartDomainVerification(
  tenantId: string,
  domainId: string,
  actor: PlatformActor,
): Promise<TenantDomain> {
  const log = logFor(actor, 'platform-domains');
  const row = await withAdminTx((tx) => loadRow(tx, domainId, tenantId));
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  if (row.verificationStatus !== 'expired') {
    throw new ApiError(409, 'DOMAIN_STATE_INVALID', { reason: 'not_expired' });
  }

  await withAdminTx(async (tx) => {
    await tx
      .update(tenantDomains)
      .set({
        verificationStatus: 'pending',
        verifyDeadlineAt: new Date(Date.now() + DOMAIN_VERIFY_DEADLINE_MS),
        lastError: null,
      })
      .where(and(eq(tenantDomains.id, domainId), eq(tenantDomains.tenantId, tenantId)));
    await enqueueVerify(tx, domainId);
  });
  log.info(
    { event: 'platform.domains.restart', userId: actor.userId, tenantId, domainId, host: row.host },
    'verification restarted',
  );

  const result = await checkDomain(domainId, actor, { source: 'manual', tenantId });
  if (!result.domain) throw new ApiError(404, 'NOT_FOUND');
  return result.domain;
}
