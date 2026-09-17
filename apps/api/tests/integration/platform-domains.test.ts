import {
  platformTenantDetailSchema,
  tenantDomainSchema,
  tenantDomainsListSchema,
} from '@tria/contracts';
import { sqlClient } from '@tria/core/db';
import { localAllowListEntries } from '@tria/core/server/domains/auth-allow-list';
import { fakeDomainProviderStats } from '@tria/core/server/domains/fake';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, signInAs } from './setup';

/**
 * TENANT-07 / D-34 / D-35 / D-36 — custom domains through `/v1/platform/tenants/{id}/domains*`
 * against the live local stack with the FAKE provider and the LOCAL allow-list (the same module
 * instances the in-process app uses, so their ledgers/counters are inspectable here).
 *
 * Part 1 is the tracer: attach -> pending (404 on by-host) -> "Verificar agora" -> verified ->
 * by-host 200 -> first-admin invite sent -> allow-list entry present. Every tenant created here
 * carries a unique `pd-…` slug, every host a unique `…-<run>.cliente.test` name, and everything is
 * removed in `afterAll` (tenants cascade to domains/invites; memberships and auth users explicitly;
 * pg-boss rows for the created domain ids).
 */

const RUN = Date.now();
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'ferramentas@triacompany.com.br';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

let superAdmin = '';
const createdDomainIds: string[] = [];

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
