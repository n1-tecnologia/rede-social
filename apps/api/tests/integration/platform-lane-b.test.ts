import { tenantDomainSchema, tenantDomainsListSchema } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { seal } from '@rede-social/core/server/secrets/sealed';
import {
  closeAllPools,
  invalidateProject,
} from '@rede-social/core/server/tenancy/project-registry';
import { invalidateTenantHost } from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, adminSqlB, api, provisionTenantOnB, signInAs, type TenantOnB } from './setup';

/**
 * Phase 09.2-06, the tracer (DBT-06, DBT-08, D-537, D-538): a `super_admin` attaches a custom domain to a
 * tenant that lives ONLY in database B, checks it and sets it primary. A domain is a CENTRAL fact (D-20): the
 * rows exist in the central project and in no tenant database, and the shell resolves the new host from the
 * mirror while the tenant's own pool points at a port nothing answers on. The same flow for a project-0
 * tenant (`rede-lab`) is unchanged.
 */

const RUN = Date.now().toString(36);
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const CLOSED_PORT_URL = 'postgres://api_user:postgres@127.0.0.1:1/none';

type Envelope = { error: { code: string } };
type ByHostBody = { slug: string; isPrimary: boolean; primaryHost: string; status: string };

let superAdmin = '';
let b: TenantOnB;
const domainIds: string[] = [];

const platform = (path: string, method = 'GET', body?: unknown) =>
  api.request(`/v1/platform${path}`, {
    method,
    headers: {
      authorization: `Bearer ${superAdmin}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const byHost = (host: string) =>
  api.request(`/v1/public/tenants/by-host?host=${encodeURIComponent(host)}`);

const bootstrap = (token: string, host: string) =>
  api.request('/v1/me/bootstrap', {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-host': host },
  });

const countIn = async (db: typeof adminSql, tenantId: string): Promise<number> => {
  const [row] = await db<{ n: number }[]>`
    select count(*)::int as n from public.tenant_domains where tenant_id = ${tenantId}::uuid`;
  return row?.n ?? 0;
};

beforeAll(async () => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  b = await provisionTenantOnB({ slug: `plb-${RUN}`.slice(0, 40) });
});

afterAll(async () => {
  if (domainIds.length > 0) {
    await adminSql`
      delete from pgboss.job_common
       where name = 'kernel.domain-verify' and singleton_key in ${adminSql(domainIds)}`;
  }
  // The throwaway lab host, if a failed run left it behind.
  await adminSql`delete from public.tenant_domains where host like ${`plb-lab-${RUN}%`}`;
  await b?.cleanup();
  await closeAllPools();
  await stopBoss();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer: a tenant that lives in database B gets its domain from the central project (D-537)', () => {
  const HOST = `plb-${RUN}.cliente.test`;
  let domainId = '';

  it('attach: POST …/domains registers the host as a pending, non-primary row (the tenant already has a verified primary)', async () => {
    const res = await platform(`/tenants/${b.tenantId}/domains`, 'POST', { host: HOST });
    expect(res.status).toBe(201);
    const domain = tenantDomainSchema.strict().parse(await res.json());
    domainId = domain.id;
    domainIds.push(domainId);
    expect(domain.host).toBe(HOST);
    expect(domain.isPrimary).toBe(false);
    expect(domain.verificationStatus).toBe('pending');
    // An attached-but-unverified host never resolves.
    expect((await byHost(HOST)).status).toBe(404);
  });

  it('check: "Verificar agora" verifies it with the fake provider', async () => {
    const res = await platform(`/tenants/${b.tenantId}/domains/${domainId}/verify`, 'POST');
    expect(res.status).toBe(200);
    const domain = tenantDomainSchema.strict().parse(await res.json());
    expect(domain.verificationStatus).toBe('verified');
    expect(domain.verifiedAt).not.toBeNull();
  });

  it('primary: the verified host is promoted and the list names it', async () => {
    const res = await platform(`/tenants/${b.tenantId}/domains/${domainId}/primary`, 'POST');
    expect(res.status).toBe(200);
    const list = tenantDomainsListSchema.parse(await res.json());
    expect(list.primaryHost).toBe(HOST);
    expect(list.domains.map((d) => d.host).sort()).toEqual([HOST, b.host].sort());
  });

  it('the rows exist in the central project and in no tenant database', async () => {
    expect(await countIn(adminSql, b.tenantId)).toBe(2);
    expect(await countIn(adminSqlB, b.tenantId)).toBe(0);
    const [central] = await adminSql<{ is_primary: boolean; verified: boolean }[]>`
      select is_primary, verified_at is not null as verified
        from public.tenant_domains where id = ${domainId}::uuid`;
    expect(central).toEqual({ is_primary: true, verified: true });
  });

  it('by-host answers for the new host from the mirror while the tenant pool points at a closed port', async () => {
    // Re-point the project at a port nothing answers on, and drop every cached pool and binding.
    await adminSql`
      update platform.projects
         set database_url_tx_sealed = ${seal(CLOSED_PORT_URL, `${b.projectId}:database_url_tx`)}
       where id = ${b.projectId}::uuid`;
    await closeAllPools();
    invalidateProject(b.tenantId);
    invalidateTenantHost(HOST);
    invalidateTenantHost(b.host);

    // The tenant itself is unreachable now: proof that the next answer is not a read of its database.
    const down = await bootstrap(b.token, b.host);
    expect(down.status).toBe(503);
    expect(((await down.json()) as Envelope).error.code).toBe('TENANT_UNAVAILABLE');

    const res = await byHost(HOST);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ByHostBody;
    expect(body.isPrimary).toBe(true);
    expect(body.primaryHost).toBe(HOST);
    expect(body.slug).toBe(b.host.replace('.localhost', ''));

    // The old primary is now an alias that names the new one.
    const alias = (await (await byHost(b.host)).json()) as ByHostBody;
    expect(alias.isPrimary).toBe(false);
    expect(alias.primaryHost).toBe(HOST);
  });

  it('the control plane keeps working while the tenant is down: the list and the detach are central', async () => {
    const list = await platform(`/tenants/${b.tenantId}/domains`);
    expect(list.status).toBe(200);
    expect(tenantDomainsListSchema.parse(await list.json()).primaryHost).toBe(HOST);
    expect(await countIn(adminSqlB, b.tenantId)).toBe(0);
  });
});

describe('the same flow for a project-0 tenant (rede-lab) is unchanged', () => {
  const HOST = `plb-lab-${RUN}.cliente.test`;
  let tenantId = '';
  let domainId = '';

  beforeAll(async () => {
    const [lab] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-lab'`;
    tenantId = lab?.id ?? '';
    if (!tenantId) throw new Error('seed tenant rede-lab is missing (run pnpm db:seed)');
  });

  it('attach, check and detach a host of rede-lab: central rows only, resolved by-host, removed again', async () => {
    const attach = await platform(`/tenants/${tenantId}/domains`, 'POST', { host: HOST });
    expect(attach.status).toBe(201);
    domainId = tenantDomainSchema.strict().parse(await attach.json()).id;
    domainIds.push(domainId);

    const verify = await platform(`/tenants/${tenantId}/domains/${domainId}/verify`, 'POST');
    expect(verify.status).toBe(200);
    expect(tenantDomainSchema.parse(await verify.json()).verificationStatus).toBe('verified');
    expect((await byHost(HOST)).status).toBe(200);
    expect(await countIn(adminSqlB, tenantId)).toBe(0);

    const removed = await platform(`/tenants/${tenantId}/domains/${domainId}`, 'DELETE');
    expect(removed.status).toBe(204);
    invalidateTenantHost(HOST);
    expect((await byHost(HOST)).status).toBe(404);
  });
});
