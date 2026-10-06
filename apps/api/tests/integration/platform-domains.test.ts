import {
  platformTenantDetailSchema,
  tenantDomainSchema,
  tenantDomainsListSchema,
} from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { localAllowListEntries } from '@rede-social/core/server/domains/auth-allow-list';
import { fakeDomainProviderStats } from '@rede-social/core/server/domains/fake';
import { DOMAIN_VERIFY_QUEUE } from '@rede-social/core/server/domains/types';
import { domainVerifyJob } from '@rede-social/core/server/domains/verify-job';
import { enqueueInTx, stopBoss } from '@rede-social/core/server/jobs/boss';
import { inviteSendJob } from '@rede-social/core/server/platform/invite-send-job';
import { invalidateTenantHost } from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, inviteSendJobsOf, runInviteSendJobs, signInAs } from './setup';

/**
 * TENANT-07 / D-34 / D-35 / D-36 — custom domains through `/v1/platform/tenants/{id}/domains*`
 * against the live local stack with the FAKE provider and the LOCAL allow-list (the same module
 * instances the in-process app uses, so their ledgers/counters are inspectable here).
 *
 * Part 1 is the tracer: attach -> pending (404 on by-host) -> "Verificar agora" -> verified ->
 * by-host 200 -> allow-list entry present -> first-admin invite send SCHEDULED (one
 * `kernel.invite-send` job, quick 260929-g0s; nothing is sent inline any more). Case 4b is the
 * 2026-09-29 regression: the `.cliente.test` hosts of this file are outside the local GoTrue
 * `additional_redirect_urls` — the local stand-in for an allow-list entry GoTrue has not applied
 * yet — so GoTrue drops the invite's `redirect_to` and falls back to `site_url`; the Send Email Hook
 * refuses that link (`redirect_host_not_tenant`) and the job fails for a retry: invite back to
 * pending, no mail, `last_error = 'invite'`. Part 2 drives the
 * `kernel.domain-verify` handler directly (cadence, deadline, expiry, restart), then primary
 * switching + removal (D-35), the TENANT-07 edge ledger (idempotency, adjacency with a second
 * tenant, concurrency) and the assumption-delta invariants. Every tenant created here carries a
 * unique `pd-…` slug, every host a unique `…-<run>.cliente.test` name, and everything is removed in
 * `afterAll` (tenants cascade to domains/invites; memberships and auth users explicitly; pg-boss
 * rows for the created domain ids).
 */

const RUN = Date.now();
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

const MAILPIT_URL = (process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324').replace(/\/$/, '');

/** How many Mailpit messages are addressed to `to` (search API; 0 when Mailpit is unreachable). */
async function mailpitCount(to: string): Promise<number> {
  const res = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=20`,
  );
  if (!res.ok) return 0;
  const { messages } = (await res.json()) as { messages?: unknown[] };
  return messages?.length ?? 0;
}

/** The `kernel.invite-send` rows of `tenantId` keyed on `inviteId`. */
const inviteJobsFor = async (tenantId: string, inviteId: string) =>
  (await inviteSendJobsOf(tenantId)).filter((job) => job.singleton_key === inviteId);

let superAdmin = '';
const createdDomainIds: string[] = [];
/** A seeded tenant-lane context, only to prove the duplicate-key drop through `enqueueInTx` (as jobs.test.ts does). */
let laneCtx: RequestContext;
/** Rows shared across the part-2 describes (populated by the tracer and the poller describes). */
const shared = { tenantA: '', hostA: '', domainA: '', adminA: '', tenantC: '', domainC: '' };

const platform = (
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  api.request(`/v1/platform${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${superAdmin}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const byHost = (host: string) =>
  api.request(`/v1/public/tenants/by-host?host=${encodeURIComponent(host)}`);

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

async function createThrowawayTenant(slug: string): Promise<{ id: string; adminEmail: string }> {
  const adminEmail = `admin-${slug}@rede-social-test.local`;
  const res = await platform('/tenants', {
    method: 'POST',
    body: {
      displayName: `Domínios ${slug}`,
      slug,
      colors: { primary: '#7c3aed', secondary: '#a78bfa' },
      modules: ['feed'],
      adminEmail,
    },
  });
  if (res.status !== 201) throw new Error(`tenant create failed: ${res.status}`);
  const body = platformTenantDetailSchema.parse(await res.json());
  return { id: body.tenant.id, adminEmail };
}

async function tenantDetail(id: string) {
  const res = await platform(`/tenants/${id}`);
  expect(res.status).toBe(200);
  return platformTenantDetailSchema.parse(await res.json());
}

/** Removes every `pd-…` tenant, its memberships and the auth users this file invited. */
async function cleanup(): Promise<void> {
  await adminSql`
    delete from pgboss.job_common
     where name = 'kernel.invite-send' and data->>'tenantId' in
       (select id::text from public.tenants where slug like 'pd-%')`;
  await adminSql`
    delete from public.memberships where tenant_id in
      (select id from public.tenants where slug like 'pd-%')`;
  await adminSql`delete from public.tenants where slug like 'pd-%'`;
  await adminSql`delete from auth.users where lower(email) like 'admin-pd-%@rede-social-test.local'`;
  if (createdDomainIds.length > 0) {
    await adminSql`
      delete from pgboss.job_common
       where name = 'kernel.domain-verify' and singleton_key in ${adminSql(createdDomainIds)}`;
  }
}

beforeAll(async () => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  await cleanup();
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

  const [row] = await adminSql<{ tenant_id: string; user_id: string }[]>`
    select m.tenant_id, m.user_id from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where t.slug = 'rede-demo' and m.role = 'admin_tenant' limit 1`;
  if (!row) throw new Error('seed tenant rede-demo has no admin (run pnpm db:seed)');
  laneCtx = {
    userId: row.user_id,
    tenantId: row.tenant_id,
    role: 'admin_tenant',
    requestId: 'platform-domains-test',
    events: [],
  };
});

afterAll(async () => {
  await cleanup();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer — attach, verify, resolve, invite scheduled (D-34/D-36)', () => {
  const SLUG = `pd-tracer-${RUN}`.slice(0, 40);
  const HOST = `pd-test-${RUN}.cliente.test`;
  let tenantId = '';
  let adminEmail = '';
  let domainId = '';
  let inviteId = '';

  it('1. a fresh tenant lists { domains: [], primaryHost: null } and its first-admin invite is pending', async () => {
    const created = await createThrowawayTenant(SLUG);
    tenantId = created.id;
    adminEmail = created.adminEmail;
    shared.tenantA = tenantId;
    shared.hostA = HOST;
    shared.adminA = adminEmail;

    const res = await platform(`/tenants/${tenantId}/domains`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(tenantDomainsListSchema.parse(await res.json())).toEqual({
      domains: [],
      primaryHost: null,
    });

    const detail = await tenantDetail(tenantId);
    expect(detail.invites[0]?.status).toBe('pending');
    inviteId = detail.invites[0]?.id ?? '';
  });

  it('2. POST attaches the host normalised, pending, primary, with routing records, a ~7-day deadline and ONE waiting kernel.domain-verify job keyed by the domain id', async () => {
    const statsBefore = fakeDomainProviderStats();
    const res = await platform(`/tenants/${tenantId}/domains`, {
      method: 'POST',
      body: { host: `PD-Test-${RUN}.Cliente.Test:443` },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const domain = tenantDomainSchema.strict().parse(await res.json());
    domainId = domain.id;
    createdDomainIds.push(domainId);
    shared.domainA = domainId;

    expect(domain.host).toBe(HOST);
    expect(domain.isPrimary).toBe(true);
    expect(domain.verificationStatus).toBe('pending');
    expect(domain.verifiedAt).toBeNull();
    expect(domain.lastCheckedAt).toBeNull();
    expect(domain.lastError).toBeNull();
    expect(domain.dnsRecords).toContainEqual({
      type: 'CNAME',
      name: HOST,
      value: 'fake.rede-social-dns.test',
      purpose: 'routing',
    });
    expect(domain.dnsRecords.some((r) => r.type === 'TXT')).toBe(false);

    const deadlineDays =
      (new Date(domain.verifyDeadlineAt ?? 0).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(deadlineDays).toBeGreaterThan(6.9);
    expect(deadlineDays).toBeLessThan(7.1);

    expect(fakeDomainProviderStats().addDomain).toBe(statsBefore.addDomain + 1);

    const jobs = await adminSql<{ state: string; start_after: string; singleton_key: string }[]>`
      select state, start_after, singleton_key from pgboss.job_common
       where name = 'kernel.domain-verify' and singleton_key = ${domainId}`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.state).toBe('created');
    // Deferred by DOMAIN_VERIFY_INTERVAL_S (600 s): the poller paces itself through startAfter.
    const startAfterMs = new Date(jobs[0]?.start_after ?? 0).getTime() - Date.now();
    expect(startAfterMs).toBeGreaterThan(590_000);
  });

  it('3. an attached-but-unverified host never resolves: by-host answers 404 TENANT_NOT_FOUND (D-36)', async () => {
    const res = await byHost(HOST);
    expect(res.status).toBe(404);
    expect((await envelope(res)).code).toBe('TENANT_NOT_FOUND');
  });

  it('4. "Verificar agora" verifies on the first check with the fake provider: by-host resolves with isPrimary + primaryHost, the allow-list has the per-domain confirm entry, and the invite stays pending with ONE kernel.invite-send job scheduled for it', async () => {
    const res = await platform(`/tenants/${tenantId}/domains/${domainId}/verify`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const domain = tenantDomainSchema.strict().parse(await res.json());
    expect(domain.id).toBe(domainId);
    expect(domain.verificationStatus).toBe('verified');
    expect(domain.verifiedAt).not.toBeNull();
    expect(domain.lastCheckedAt).not.toBeNull();
    expect(domain.lastError).toBeNull();
    expect(domain.isPrimary).toBe(true);

    const resolved = await byHost(HOST);
    expect(resolved.status).toBe(200);
    const body = (await resolved.json()) as {
      isPrimary: boolean;
      primaryHost: string;
      slug: string;
    };
    expect(body.slug).toBe(SLUG);
    expect(body.isPrimary).toBe(true);
    expect(body.primaryHost).toBe(HOST);

    const detail = await tenantDetail(tenantId);
    expect(detail.invites[0]?.status).toBe('pending');
    expect(detail.invites[0]?.sentAt).toBeNull();
    expect(detail.domains.map((d) => d.host)).toEqual([HOST]);

    const jobs = await inviteJobsFor(tenantId, inviteId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({ tenantId, inviteId });

    expect(localAllowListEntries.has(`https://${HOST}/auth/confirm**`)).toBe(true);
  });

  it('4b. the deferred send on a host GoTrue has not allowed reproduces the 2026-09-29 site_url fallback and is refused end-to-end: the job fails for a retry, the invite is pending again, no identity, no mail, last_error "invite"', async () => {
    await expect(inviteSendJob.handler({ tenantId, inviteId })).rejects.toThrow();

    const detail = await tenantDetail(tenantId);
    expect(detail.invites[0]?.status).toBe('pending');
    expect(detail.invites[0]?.sentAt).toBeNull();

    // GoTrue creates the identity and calls the hook in ONE transaction: the hook's 500 rolls the
    // invited user back, so nothing is left for the retry's identity pre-check to trip on.
    const users = await adminSql<{ id: string }[]>`
      select id from auth.users where lower(email) = ${adminEmail}`;
    expect(users).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await mailpitCount(adminEmail)).toBe(0);
    expect((await domainRow(domainId))?.last_error).toBe('invite');
  });
});

const jobRows = (domainId: string) =>
  adminSql<{ state: string; start_after: string }[]>`
    select state, start_after from pgboss.job_common
     where name = 'kernel.domain-verify' and singleton_key = ${domainId}`;

const domainRow = async (domainId: string) => {
  const [row] = await adminSql<
    {
      verification_status: string;
      verified_at: string | null;
      last_checked_at: string | null;
      verify_deadline_at: string | null;
      is_primary: boolean;
      last_error: string | null;
    }[]
  >`select verification_status, verified_at, last_checked_at, verify_deadline_at, is_primary,
           last_error
      from public.tenant_domains where id = ${domainId}::uuid`;
  return row;
};

describe('poller — kernel.domain-verify cadence, deadline, expiry and restart (D-34)', () => {
  const SLUG = `pd-job-${RUN}`.slice(0, 40);
  const HOST = `never-verifies-${RUN}.cliente.test`;
  let tenantId = '';
  let domainId = '';

  it('5. attach defers the job by >= 590 s and a second enqueue with the same key while it is created returns null', async () => {
    const created = await createThrowawayTenant(SLUG);
    tenantId = created.id;
    shared.tenantC = tenantId;

    const res = await platform(`/tenants/${tenantId}/domains`, {
      method: 'POST',
      body: { host: HOST },
    });
    expect(res.status).toBe(201);
    domainId = tenantDomainSchema.parse(await res.json()).id;
    createdDomainIds.push(domainId);
    shared.domainC = domainId;

    const jobs = await jobRows(domainId);
    expect(jobs).toHaveLength(1);
    expect(new Date(jobs[0]?.start_after ?? 0).getTime() - Date.now()).toBeGreaterThanOrEqual(
      590_000,
    );

    const duplicate = await withTenantTx(laneCtx, (tx) =>
      enqueueInTx(
        tx,
        DOMAIN_VERIFY_QUEUE,
        { domainId },
        { singletonKey: domainId, startAfter: 600 },
      ),
    );
    expect(duplicate).toBeNull();
    expect(await jobRows(domainId)).toHaveLength(1);
  });

  it('6. the handler on a never-verifies host keeps it pending, stamps last_checked_at and leaves exactly one created job (the re-arm is a dropped duplicate)', async () => {
    await domainVerifyJob.handler({ domainId });

    const row = await domainRow(domainId);
    expect(row?.verification_status).toBe('pending');
    expect(row?.verified_at).toBeNull();
    expect(row?.last_checked_at).not.toBeNull();

    const jobs = await jobRows(domainId);
    expect(jobs.filter((j) => j.state === 'created')).toHaveLength(1);
  });

  it('7. past verify_deadline_at the next run marks the host expired and enqueues nothing; a malformed payload is swallowed', async () => {
    await adminSql`update public.tenant_domains set verify_deadline_at = now() - interval '1 hour'
                   where id = ${domainId}::uuid`;
    const before = (await jobRows(domainId)).length;

    await domainVerifyJob.handler({ domainId });

    const row = await domainRow(domainId);
    expect(row?.verification_status).toBe('expired');
    expect(row?.verified_at).toBeNull();
    expect((await jobRows(domainId)).length).toBe(before);

    await expect(domainVerifyJob.handler({ domainId: 'not-a-uuid' })).resolves.toBeUndefined();
    await expect(domainVerifyJob.handler({} as never)).resolves.toBeUndefined();
    // An expired host is left alone by a later run too.
    await domainVerifyJob.handler({ domainId });
    expect((await domainRow(domainId))?.verification_status).toBe('expired');
  });

  it('8. "Verificar agora" on an expired host answers 409 DOMAIN_STATE_INVALID { reason: "expired" }', async () => {
    const res = await platform(`/tenants/${tenantId}/domains/${domainId}/verify`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    const err = await envelope(res);
    expect(err.code).toBe('DOMAIN_STATE_INVALID');
    expect(err.details).toEqual({ reason: 'expired' });
  });

  it('9. restart reopens the deadline, re-arms a fresh job and runs one check (still pending); restart on a non-expired host is 409 { reason: "not_expired" }', async () => {
    // The worker would have consumed the attach job by now; mimic that so the fresh job is observable.
    await adminSql`update pgboss.job_common set state = 'completed'
                   where name = 'kernel.domain-verify' and singleton_key = ${domainId}`;

    const res = await platform(`/tenants/${tenantId}/domains/${domainId}/restart`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const domain = tenantDomainSchema.strict().parse(await res.json());
    expect(domain.verificationStatus).toBe('pending');
    expect(domain.verifiedAt).toBeNull();
    expect(new Date(domain.verifyDeadlineAt ?? 0).getTime()).toBeGreaterThan(Date.now());
    expect(domain.lastCheckedAt).not.toBeNull();

    const jobs = await jobRows(domainId);
    expect(jobs.filter((j) => j.state === 'created')).toHaveLength(1);

    const notExpired = await platform(
      `/tenants/${shared.tenantA}/domains/${shared.domainA}/restart`,
      {
        method: 'POST',
      },
    );
    expect(notExpired.status).toBe(409);
    expect((await envelope(notExpired)).details).toEqual({ reason: 'not_expired' });
  });
});

describe('primary switching and removal (D-35)', () => {
  const ALIAS = `alias-${RUN}.cliente.test`;
  let aliasId = '';

  it('10. set-primary on an unverified host answers 409 { reason: "not_verified" }', async () => {
    const res = await platform(`/tenants/${shared.tenantA}/domains`, {
      method: 'POST',
      body: { host: ALIAS },
    });
    expect(res.status).toBe(201);
    const alias = tenantDomainSchema.parse(await res.json());
    aliasId = alias.id;
    createdDomainIds.push(aliasId);
    expect(alias.isPrimary).toBe(false);

    const refused = await platform(`/tenants/${shared.tenantA}/domains/${aliasId}/primary`, {
      method: 'POST',
    });
    expect(refused.status).toBe(409);
    const err = await envelope(refused);
    expect(err.code).toBe('DOMAIN_STATE_INVALID');
    expect(err.details).toEqual({ reason: 'not_verified' });
  });

  it('11. set-primary on a verified alias promotes it (alias first, former primary demoted) and by-host on the former primary names the alias; repeating it is a no-op', async () => {
    const verified = await platform(`/tenants/${shared.tenantA}/domains/${aliasId}/verify`, {
      method: 'POST',
    });
    expect(verified.status).toBe(200);
    expect(tenantDomainSchema.parse(await verified.json()).verificationStatus).toBe('verified');

    const res = await platform(`/tenants/${shared.tenantA}/domains/${aliasId}/primary`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const list = tenantDomainsListSchema.parse(await res.json());
    expect(list.primaryHost).toBe(ALIAS);
    expect(list.domains.map((d) => [d.host, d.isPrimary])).toEqual([
      [ALIAS, true],
      [shared.hostA, false],
    ]);

    const former = await byHost(shared.hostA);
    expect(former.status).toBe(200);
    const body = (await former.json()) as { isPrimary: boolean; primaryHost: string };
    expect(body.isPrimary).toBe(false);
    expect(body.primaryHost).toBe(ALIAS);

    const again = await platform(`/tenants/${shared.tenantA}/domains/${aliasId}/primary`, {
      method: 'POST',
    });
    expect(again.status).toBe(200);
    expect(tenantDomainsListSchema.parse(await again.json())).toEqual(list);
  });

  it('12. DELETE refuses the primary while an alias exists (409 primary_with_aliases), removes a non-primary host (204: by-host 404, allow-list entry gone, provider detach), then 404s; another tenant’s id is 404 through this tenant’s path', async () => {
    const refused = await platform(`/tenants/${shared.tenantA}/domains/${aliasId}`, {
      method: 'DELETE',
    });
    expect(refused.status).toBe(409);
    expect((await envelope(refused)).details).toEqual({ reason: 'primary_with_aliases' });

    const before = fakeDomainProviderStats().removeDomain;
    expect(localAllowListEntries.has(`https://${shared.hostA}/auth/confirm**`)).toBe(true);
    const removed = await platform(`/tenants/${shared.tenantA}/domains/${shared.domainA}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(204);
    expect(fakeDomainProviderStats().removeDomain).toBe(before + 1);
    expect(localAllowListEntries.has(`https://${shared.hostA}/auth/confirm**`)).toBe(false);
    expect((await byHost(shared.hostA)).status).toBe(404);

    const again = await platform(`/tenants/${shared.tenantA}/domains/${shared.domainA}`, {
      method: 'DELETE',
    });
    expect(again.status).toBe(404);
    expect((await envelope(again)).code).toBe('NOT_FOUND');

    const foreign = await platform(`/tenants/${shared.tenantA}/domains/${shared.domainC}`, {
      method: 'DELETE',
    });
    expect(foreign.status).toBe(404);
    expect((await domainRow(shared.domainC))?.verification_status).toBe('pending');
  });

  it('13. idempotency: re-attaching the alias with different casing answers 200 with the same id and no provider call; verifying a verified host twice never resets verified_at, calls no provider and schedules no second waiting send', async () => {
    const adds = fakeDomainProviderStats().addDomain;
    const res = await platform(`/tenants/${shared.tenantA}/domains`, {
      method: 'POST',
      body: { host: `Alias-${RUN}.Cliente.TEST` },
    });
    expect(res.status).toBe(200);
    expect(tenantDomainSchema.parse(await res.json()).id).toBe(aliasId);
    expect(fakeDomainProviderStats().addDomain).toBe(adds);

    const verifies = fakeDomainProviderStats().verify;
    const first = await platform(`/tenants/${shared.tenantA}/domains/${aliasId}/verify`, {
      method: 'POST',
    });
    const second = await platform(`/tenants/${shared.tenantA}/domains/${aliasId}/verify`, {
      method: 'POST',
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = tenantDomainSchema.parse(await first.json());
    const b = tenantDomainSchema.parse(await second.json());
    expect(a.verifiedAt).not.toBeNull();
    expect(b.verifiedAt).toBe(a.verifiedAt);
    expect(fakeDomainProviderStats().verify).toBe(verifies);

    const invites = await adminSql<{ id: string; status: string }[]>`
      select id, status from public.tenant_invites where tenant_id = ${shared.tenantA}::uuid`;
    expect(invites).toHaveLength(1);
    expect(invites[0]?.status).not.toBe('sent');
    const waiting = (await inviteJobsFor(shared.tenantA, invites[0]?.id ?? '')).filter(
      (job) => job.state === 'created',
    );
    expect(waiting.length).toBeLessThanOrEqual(1);
  });
});

describe('adjacency and concurrency — a second tenant (TENANT-07 edge ledger)', () => {
  const SLUG = `pd-b-${RUN}`.slice(0, 40);
  const RACE_HOST = `race-${RUN}.cliente.test`;
  let tenantB = '';
  let adminB = '';
  let raceId = '';

  it('14. attaching a host verified for tenant A (upper-cased) answers 409 DOMAIN_IN_USE naming neither A’s id nor slug; the platform host and a malformed host are 400', async () => {
    const created = await createThrowawayTenant(SLUG);
    tenantB = created.id;
    adminB = created.adminEmail;

    const taken = await platform(`/tenants/${tenantB}/domains`, {
      method: 'POST',
      body: { host: `ALIAS-${RUN}.CLIENTE.TEST` },
    });
    expect(taken.status).toBe(409);
    const body = JSON.stringify(await taken.json());
    expect(body).toContain('DOMAIN_IN_USE');
    expect(body).not.toContain(shared.tenantA);
    expect(body).not.toContain(`pd-tracer-${RUN}`);

    const platformHost = process.env.PLATFORM_HOST ?? 'rede-social.localhost';
    const reserved = await platform(`/tenants/${tenantB}/domains`, {
      method: 'POST',
      body: { host: platformHost },
    });
    expect(reserved.status).toBe(400);
    const err = await envelope(reserved);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.host).toBe('platform_host');

    const malformed = await platform(`/tenants/${tenantB}/domains`, {
      method: 'POST',
      body: { host: 'not a host' },
    });
    expect(malformed.status).toBe(400);
    expect((await envelope(malformed)).code).toBe('VALIDATION_FAILED');
  });

  it('15. concurrency: two "Verificar agora" and the job racing on B’s first host settle to ONE verified_at and ONE scheduled send for B’s invite (the short policy drops the racing duplicates); the invite is still pending', async () => {
    const res = await platform(`/tenants/${tenantB}/domains`, {
      method: 'POST',
      body: { host: RACE_HOST },
    });
    expect(res.status).toBe(201);
    raceId = tenantDomainSchema.parse(await res.json()).id;
    createdDomainIds.push(raceId);

    const results = await Promise.all([
      platform(`/tenants/${tenantB}/domains/${raceId}/verify`, { method: 'POST' }),
      platform(`/tenants/${tenantB}/domains/${raceId}/verify`, { method: 'POST' }),
      domainVerifyJob.handler({ domainId: raceId }),
    ]);
    expect((results[0] as Response).status).toBe(200);
    expect((results[1] as Response).status).toBe(200);

    const [row] = await adminSql<{ n: string; verified: boolean }[]>`
      select count(distinct verified_at)::text as n, bool_and(verified_at is not null) as verified
        from public.tenant_domains where id = ${raceId}::uuid`;
    expect(row).toEqual({ n: '1', verified: true });

    const invites = await adminSql<{ id: string; status: string }[]>`
      select id, status from public.tenant_invites where tenant_id = ${tenantB}::uuid`;
    expect(invites.map((invite) => invite.status)).toEqual(['pending']);
    const jobs = await inviteJobsFor(tenantB, invites[0]?.id ?? '');
    expect(jobs).toHaveLength(1);
    expect(jobs.filter((job) => job.state === 'created').length).toBeLessThanOrEqual(1);
    const [users] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from auth.users where lower(email) = ${adminB}`;
    expect(users?.n).toBe('0');
    expect((await byHost(RACE_HOST)).status).toBe(200);
  });

  it('16. invariants: at most one primary per tenant (23505), one tenant per host across case variants (23505), and an unverified row never resolves until verified_at is set — then for exactly the owning slug', async () => {
    const codeOf = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? null;
      }
    };

    expect(
      await codeOf(adminSql`
        insert into public.tenant_domains (tenant_id, host, is_primary)
        values (${shared.tenantA}::uuid, ${`second-primary-${RUN}.cliente.test`}, true)`),
    ).toBe('23505');

    // One tenant per host: the same spelling is the unique index (23505); an upper-cased spelling
    // cannot even be stored (tenant_domains_host_chk, 23514) — hosts are lower-cased at the boundary,
    // and citext makes the lookup case-insensitive (case 14 attached ALIAS-…CLIENTE.TEST -> 409).
    expect(
      await codeOf(adminSql`
        insert into public.tenant_domains (tenant_id, host, is_primary)
        values (${tenantB}::uuid, ${`alias-${RUN}.cliente.test`}, false)`),
    ).toBe('23505');
    expect(
      await codeOf(adminSql`
        insert into public.tenant_domains (tenant_id, host, is_primary)
        values (${tenantB}::uuid, ${`Alias-${RUN}.Cliente.Test`}, false)`),
    ).toBe('23514');
    const [byCase] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenant_domains where host = ${`ALIAS-${RUN}.CLIENTE.TEST`}`;
    expect(byCase?.n).toBe('1');

    const INV = `inv-${RUN}.cliente.test`;
    const [inserted] = await adminSql<{ id: string }[]>`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${tenantB}::uuid, ${INV}, false, null) returning id`;
    expect((await byHost(INV)).status).toBe(404);

    await adminSql`update public.tenant_domains
                      set verified_at = now(), verification_status = 'verified'
                    where id = ${inserted?.id ?? ''}::uuid`;
    invalidateTenantHost(INV);
    const resolved = await byHost(INV);
    expect(resolved.status).toBe(200);
    expect(((await resolved.json()) as { slug: string }).slug).toBe(SLUG);
  });
});

/** Mimics the worker consuming every job of the host, so a re-arm is observable as a NEW created row. */
const completeJobsOf = (domainId: string) =>
  adminSql`update pgboss.job_common set state = 'completed'
            where name = 'kernel.domain-verify' and singleton_key = ${domainId}`;

const createdJobsOf = async (domainId: string) =>
  (await jobRows(domainId)).filter((j) => j.state === 'created');

describe('poller — provider-error path re-arms and expires (CR-01, D-34)', () => {
  const SLUG = `pd-err-${RUN}`.slice(0, 40);
  const HOST = `provider-fails-once-${RUN}.cliente.test`;
  const EXP_HOST = `provider-fails-once-exp-${RUN}.cliente.test`;
  let tenantId = '';
  let domainId = '';
  let expDomainId = '';

  it('17. a throwing provider keeps the host pending, records last_error = "unavailable:503" and re-arms ONE new created job >= 590 s ahead in the same transaction', async () => {
    const created = await createThrowawayTenant(SLUG);
    tenantId = created.id;

    const res = await platform(`/tenants/${tenantId}/domains`, {
      method: 'POST',
      body: { host: HOST },
    });
    expect(res.status).toBe(201);
    domainId = tenantDomainSchema.parse(await res.json()).id;
    createdDomainIds.push(domainId);

    await completeJobsOf(domainId);
    expect(await createdJobsOf(domainId)).toHaveLength(0);
    const verifies = fakeDomainProviderStats().verify;

    await domainVerifyJob.handler({ domainId });

    const row = await domainRow(domainId);
    expect(row?.verification_status).toBe('pending');
    expect(row?.verified_at).toBeNull();
    expect(row?.last_checked_at).not.toBeNull();
    expect(row?.last_error).toBe('unavailable:503');
    expect(fakeDomainProviderStats().verify).toBe(verifies + 1);

    // The re-arm is a NEW job (the attach job was completed above), paced by DOMAIN_VERIFY_INTERVAL_S.
    const waiting = await createdJobsOf(domainId);
    expect(waiting).toHaveLength(1);
    expect(new Date(waiting[0]?.start_after ?? 0).getTime() - Date.now()).toBeGreaterThanOrEqual(
      590_000,
    );
  });

  it('18. the next run verifies the host (the fake answers OK now): verified_at set, last_error cleared, by-host 200, the invite send scheduled (invite still pending), and no further verify re-arm', async () => {
    const waitingBefore = (await createdJobsOf(domainId)).length;

    await domainVerifyJob.handler({ domainId });

    const row = await domainRow(domainId);
    expect(row?.verification_status).toBe('verified');
    expect(row?.verified_at).not.toBeNull();
    expect(row?.last_error).toBeNull();
    expect((await byHost(HOST)).status).toBe(200);
    const invite = (await tenantDetail(tenantId)).invites[0];
    expect(invite?.status).toBe('pending');
    expect(await inviteJobsFor(tenantId, invite?.id ?? '')).toHaveLength(1);
    expect((await createdJobsOf(domainId)).length).toBe(waitingBefore);
  });

  it('19. past verify_deadline_at a throwing provider marks the host expired on the error path and re-arms nothing; verify answers 409 { reason: "expired" }; restart -> 200 and verifies', async () => {
    const res = await platform(`/tenants/${tenantId}/domains`, {
      method: 'POST',
      body: { host: EXP_HOST },
    });
    expect(res.status).toBe(201);
    expDomainId = tenantDomainSchema.parse(await res.json()).id;
    createdDomainIds.push(expDomainId);

    await completeJobsOf(expDomainId);
    await adminSql`update public.tenant_domains set verify_deadline_at = now() - interval '1 hour'
                   where id = ${expDomainId}::uuid`;

    await domainVerifyJob.handler({ domainId: expDomainId });

    const row = await domainRow(expDomainId);
    expect(row?.verification_status).toBe('expired');
    expect(row?.verified_at).toBeNull();
    expect(row?.last_error).toBe('unavailable:503');
    expect(row?.last_checked_at).not.toBeNull();
    expect(await createdJobsOf(expDomainId)).toHaveLength(0);

    const refused = await platform(`/tenants/${tenantId}/domains/${expDomainId}/verify`, {
      method: 'POST',
    });
    expect(refused.status).toBe(409);
    const err = await envelope(refused);
    expect(err.code).toBe('DOMAIN_STATE_INVALID');
    expect(err.details).toEqual({ reason: 'expired' });

    // error -> expired -> restart -> verified: the fake answers OK on the restart's immediate check.
    const restarted = await platform(`/tenants/${tenantId}/domains/${expDomainId}/restart`, {
      method: 'POST',
    });
    expect(restarted.status).toBe(200);
    expect(restarted.headers.get('cache-control')).toBe('no-store');
    const domain = tenantDomainSchema.strict().parse(await restarted.json());
    expect(domain.verificationStatus).toBe('verified');
    expect(domain.verifiedAt).not.toBeNull();
    expect(domain.lastError).toBeNull();
  });

  it('20. WR-01: a verified host with a side-effect last_error answers lastError null after a successful re-run ("Verificar agora": no provider call, verified_at unchanged); without an error the clear is a no-op', async () => {
    await adminSql`update public.tenant_domains set last_error = 'allow_list'
                   where id = ${domainId}::uuid`;
    expect((await domainRow(domainId))?.last_error).toBe('allow_list');
    const verifies = fakeDomainProviderStats().verify;
    const verifiedAtBefore = (await domainRow(domainId))?.verified_at;

    const res = await platform(`/tenants/${tenantId}/domains/${domainId}/verify`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const domain = tenantDomainSchema.strict().parse(await res.json());
    expect(domain.verificationStatus).toBe('verified');
    expect(domain.lastError).toBeNull();
    expect(new Date(domain.verifiedAt ?? 0).getTime()).toBe(
      new Date(verifiedAtBefore ?? 0).getTime(),
    );
    expect((await domainRow(domainId))?.last_error).toBeNull();
    // already_verified makes NO provider call.
    expect(fakeDomainProviderStats().verify).toBe(verifies);

    // A verified host WITHOUT an error also answers lastError null (the conditional clear is a no-op).
    const again = await platform(`/tenants/${tenantId}/domains/${domainId}/verify`, {
      method: 'POST',
    });
    expect(again.status).toBe(200);
    const unchanged = tenantDomainSchema.parse(await again.json());
    expect(unchanged.lastError).toBeNull();
    expect(unchanged.verifiedAt).toBe(domain.verifiedAt);
    expect(fakeDomainProviderStats().verify).toBe(verifies);
  });

  it('21. WR-03 / D-D (02-19, D-316): a platform-account admin e-mail still verifies the host; the scheduled send is refused terminally (last_error "invite:email_in_use", invite refused, no retry); the second verify clears it; the alias promotion answers 200 and the re-pended invite is refused again by the job', async () => {
    const slug = `pd-inv-${RUN}`.slice(0, 40);
    const host = `pd-inv-${RUN}.cliente.test`;
    const created = await createThrowawayTenant(slug);
    // The identity appears AFTER creation (the create-time check accepted a fresh e-mail) and is a
    // PLATFORM account: since 08.1-06 only that is refused (D-316) — any other existing identity
    // gets the tokenless invite (D-314).
    const identity = await authAdmin().createUser({
      email: created.adminEmail,
      password: 'Throwaway-123456',
      email_confirm: true,
    });
    if (identity.error || !identity.data.user) {
      throw new Error(`createUser failed: ${identity.error?.message}`);
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const mirrored = await adminSql`
        select 1 from public.users where id = ${identity.data.user.id}::uuid`;
      if (mirrored.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await adminSql`
      insert into public.platform_admins (user_id) values (${identity.data.user.id}::uuid)`;

    const attached = await platform(`/tenants/${created.id}/domains`, {
      method: 'POST',
      body: { host },
    });
    expect(attached.status).toBe(201);
    const invDomainId = tenantDomainSchema.parse(await attached.json()).id;
    createdDomainIds.push(invDomainId);

    const verified = await platform(`/tenants/${created.id}/domains/${invDomainId}/verify`, {
      method: 'POST',
    });
    expect(verified.status).toBe(200);
    const domain = tenantDomainSchema.parse(await verified.json());
    expect(domain.verificationStatus).toBe('verified');
    expect(domain.verifiedAt).not.toBeNull();
    // Scheduling succeeded; the refusal is the job's outcome now.
    expect(domain.lastError).toBeNull();
    expect((await byHost(host)).status).toBe(200);

    // The refusal is terminal: the handler resolves (no pg-boss retry) and records the cause.
    await expect(runInviteSendJobs(created.id)).resolves.toBeGreaterThanOrEqual(1);
    expect((await domainRow(invDomainId))?.last_error).toBe('invite:email_in_use');

    const refused = (await tenantDetail(created.id)).invites[0];
    expect(refused?.status).toBe('expired');
    expect(refused?.sentAt).toBeNull();
    const membershipCount = async () => {
      const [row] = await adminSql<{ n: string }[]>`
        select count(*)::text as n from public.memberships where tenant_id = ${created.id}::uuid`;
      return row?.n;
    };
    expect(await membershipCount()).toBe('0');

    // No pending invite is left, so both side effects succeed and 02-17's clear removes the cause.
    const again = await platform(`/tenants/${created.id}/domains/${invDomainId}/verify`, {
      method: 'POST',
    });
    expect(again.status).toBe(200);
    expect(tenantDomainSchema.parse(await again.json()).lastError).toBeNull();

    // D-D: the primary switch never fails because of an invite refusal raised inside it.
    const aliasHost = `pd-inv-alias-${RUN}.cliente.test`;
    const alias = await platform(`/tenants/${created.id}/domains`, {
      method: 'POST',
      body: { host: aliasHost },
    });
    expect(alias.status).toBe(201);
    const aliasId = tenantDomainSchema.parse(await alias.json()).id;
    createdDomainIds.push(aliasId);
    const aliasVerified = await platform(`/tenants/${created.id}/domains/${aliasId}/verify`, {
      method: 'POST',
    });
    expect(aliasVerified.status).toBe(200);
    expect(tenantDomainSchema.parse(await aliasVerified.json()).verificationStatus).toBe(
      'verified',
    );
    // A refused row is terminal (D-A): put it back in front of the switch so the catch is exercised.
    await adminSql`update public.tenant_invites set status = 'pending', sent_at = null
                   where tenant_id = ${created.id}::uuid`;

    const promoted = await platform(`/tenants/${created.id}/domains/${aliasId}/primary`, {
      method: 'POST',
    });
    expect(promoted.status).toBe(200);
    expect(promoted.headers.get('cache-control')).toBe('no-store');
    const list = tenantDomainsListSchema.parse(await promoted.json());
    expect(list.primaryHost).toBe(aliasHost);
    expect(list.domains.map((d) => [d.host, d.isPrimary])).toEqual([
      [aliasHost, true],
      [host, false],
    ]);

    // The promotion only scheduled the re-pended invite; the job refuses it again.
    const repended = (await tenantDetail(created.id)).invites[0];
    expect(repended?.status).toBe('pending');
    await expect(
      inviteSendJob.handler({ tenantId: created.id, inviteId: repended?.id ?? '' }),
    ).resolves.toBeUndefined();

    const refusedAgain = (await tenantDetail(created.id)).invites[0];
    expect(refusedAgain?.status).toBe('expired');
    expect(refusedAgain?.sentAt).toBeNull();
    expect(await membershipCount()).toBe('0');
  });
});
