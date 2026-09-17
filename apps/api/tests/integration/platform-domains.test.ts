import {
  platformTenantDetailSchema,
  tenantDomainSchema,
  tenantDomainsListSchema,
} from '@tria/contracts';
import { sqlClient } from '@tria/core/db';
import { withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { localAllowListEntries } from '@tria/core/server/domains/auth-allow-list';
import { fakeDomainProviderStats } from '@tria/core/server/domains/fake';
import { DOMAIN_VERIFY_QUEUE } from '@tria/core/server/domains/types';
import { domainVerifyJob } from '@tria/core/server/domains/verify-job';
import { enqueueInTx, stopBoss } from '@tria/core/server/jobs/boss';
import { invalidateTenantHost } from '@tria/core/server/tenancy/tenant-host';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, signInAs } from './setup';

/**
 * TENANT-07 / D-34 / D-35 / D-36 — custom domains through `/v1/platform/tenants/{id}/domains*`
 * against the live local stack with the FAKE provider and the LOCAL allow-list (the same module
 * instances the in-process app uses, so their ledgers/counters are inspectable here).
 *
 * Part 1 is the tracer: attach -> pending (404 on by-host) -> "Verificar agora" -> verified ->
 * by-host 200 -> first-admin invite sent -> allow-list entry present. Part 2 drives the
 * `kernel.domain-verify` handler directly (cadence, deadline, expiry, restart), then primary
 * switching + removal (D-35), the TENANT-07 edge ledger (idempotency, adjacency with a second
 * tenant, concurrency) and the assumption-delta invariants. Every tenant created here carries a
 * unique `pd-…` slug, every host a unique `…-<run>.cliente.test` name, and everything is removed in
 * `afterAll` (tenants cascade to domains/invites; memberships and auth users explicitly; pg-boss
 * rows for the created domain ids).
 */

const RUN = Date.now();
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'ferramentas@triacompany.com.br';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

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
  const adminEmail = `admin-${slug}@tria-test.local`;
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
    delete from public.memberships where tenant_id in
      (select id from public.tenants where slug like 'pd-%')`;
  await adminSql`delete from public.tenants where slug like 'pd-%'`;
  await adminSql`delete from auth.users where lower(email) like 'admin-pd-%@tria-test.local'`;
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
     where t.slug = 'tria-demo' and m.role = 'admin_tenant' limit 1`;
  if (!row) throw new Error('seed tenant tria-demo has no admin (run pnpm db:seed)');
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

describe('tracer — attach, verify, resolve, invite (D-34/D-36)', () => {
  const SLUG = `pd-tracer-${RUN}`.slice(0, 40);
  const HOST = `pd-test-${RUN}.cliente.test`;
  let tenantId = '';
  let adminEmail = '';
  let domainId = '';

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
      value: 'fake.tria-dns.test',
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

  it('4. "Verificar agora" verifies on the first check with the fake provider: by-host resolves with isPrimary + primaryHost, the invite flips to sent (one auth user) and the allow-list has the per-domain confirm entry', async () => {
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
    expect(detail.invites[0]?.status).toBe('sent');
    expect(detail.invites[0]?.sentAt).not.toBeNull();
    expect(detail.domains.map((d) => d.host)).toEqual([HOST]);

    const { data } = await authAdmin().listUsers({ page: 1, perPage: 1000 });
    const invited = data.users.filter((u) => u.email?.toLowerCase() === adminEmail);
    expect(invited).toHaveLength(1);
    expect(invited[0]?.invited_at).toBeTruthy();

    expect(localAllowListEntries.has(`https://${HOST}/auth/confirm**`)).toBe(true);
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

  it('13. idempotency: re-attaching the alias with different casing answers 200 with the same id and no provider call; verifying a verified host twice never resets verified_at, calls no provider and sends nothing new', async () => {
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

    const [sent] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenant_invites
       where tenant_id = ${shared.tenantA}::uuid and status = 'sent'`;
    expect(sent?.n).toBe('1');
    const [users] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from auth.users where lower(email) = ${shared.adminA}`;
    expect(users?.n).toBe('1');
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

    const platformHost = process.env.PLATFORM_HOST ?? 'tria.localhost';
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

  it('15. concurrency: two "Verificar agora" and the job racing on B’s first host settle to ONE verified_at, one sent invite and one auth user', async () => {
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

    const invites = await adminSql<{ status: string }[]>`
      select status from public.tenant_invites where tenant_id = ${tenantB}::uuid`;
    expect(invites).toEqual([{ status: 'sent' }]);
    const [users] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from auth.users where lower(email) = ${adminB}`;
    expect(users?.n).toBe('1');
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

  it('18. the next run verifies the host (the fake answers OK now): verified_at set, last_error cleared, by-host 200, invite sent, and no further re-arm', async () => {
    const waitingBefore = (await createdJobsOf(domainId)).length;

    await domainVerifyJob.handler({ domainId });

    const row = await domainRow(domainId);
    expect(row?.verification_status).toBe('verified');
    expect(row?.verified_at).not.toBeNull();
    expect(row?.last_error).toBeNull();
    expect((await byHost(HOST)).status).toBe(200);
    expect((await tenantDetail(tenantId)).invites[0]?.status).toBe('sent');
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
});
