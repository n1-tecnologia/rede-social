import { sqlClient } from '@rede-social/core/db';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  adminSqlB,
  api,
  authAdmin,
  HOSTS,
  provisionTenantOnB,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
  signInAs,
  type TenantOnB,
} from './setup';

/**
 * Phase 09.2-03, the tracer (DBT-06, DBT-38, D-538): a tenant that lives ONLY in a second database
 * (`rede_tenant_b`) is served by an ordinary request. Its connection string comes out of the registry as a
 * SEALED value, its pool is held in the bounded cache, and `withTenantTx` / `membershipInTenant` route by the
 * tenant id. The central project holds a DIFFERENT display name for the same tenant id, so a read that wrongly
 * lands centrally shows in the assertion.
 */

const RUN = Date.now().toString(36);
const SLUG = `routing-b-${RUN}`.slice(0, 40);

type Bootstrap = { tenant: { id: string; displayName: string }; membership: { tenantId: string } };

let b: TenantOnB;

beforeAll(async () => {
  b = await provisionTenantOnB({ slug: SLUG });
});

afterAll(async () => {
  await b?.cleanup();
  await closeAllPools();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

const bootstrap = (token: string, host: string) =>
  api.request('/v1/me/bootstrap', {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-host': host },
  });

describe('the tracer: a tenant bound to database B is served from database B', () => {
  it('tracer: GET /v1/me/bootstrap reads the tenant row of B while the central row differs', async () => {
    const res = await bootstrap(b.token, b.host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Bootstrap;
    expect(body.tenant.id).toBe(b.tenantId);
    expect(body.tenant.displayName).toBe('Tenant B (database B)');

    // The central project holds the same tenant id under another name: the answer did not come from there.
    const [central] = await adminSql<{ display_name: string }[]>`
      select display_name from public.tenants where id = ${b.tenantId}::uuid`;
    expect(central?.display_name).toBe('Tenant B (central mirror)');
  });

  it('the membership of that user exists in B and in no central table', async () => {
    const [inB] = await adminSqlB<{ n: number }[]>`
      select count(*)::int as n from public.memberships where user_id = ${b.userId}::uuid`;
    const [central] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.memberships where user_id = ${b.userId}::uuid`;
    expect(inB?.n).toBe(1);
    expect(central?.n).toBe(0);
  });

  it('a request for a project-0 tenant (rede-lab) is unchanged and still reads project 0', async () => {
    const prefix = `routing-lab-${RUN}`;
    await removeIdentitiesByPrefix(prefix);
    const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@rede-demo.local`;
    const created = await authAdmin().createUser({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    try {
      await adminSql`
        insert into public.memberships (tenant_id, user_id, role, status)
        select d.tenant_id, ${created.data.user?.id ?? ''}::uuid, 'member', 'active'
          from public.tenant_domains d
         where d.host = ${HOSTS.lab} and d.verified_at is not null
         limit 1`;
      const token = await signInAs(email, SEED_PASSWORD);
      const res = await bootstrap(token, HOSTS.lab);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Bootstrap;
      const [lab] = await adminSql<{ id: string; display_name: string }[]>`
        select id, display_name from public.tenants where slug = 'rede-lab'`;
      expect(body.tenant.id).toBe(lab?.id);
      expect(body.tenant.displayName).toBe(lab?.display_name);
      // ...and that tenant is bound to project 0, the central project.
      const [bound] = await adminSql<{ is_central: boolean; credential_source: string }[]>`
        select p.is_central, p.credential_source
          from platform.tenant_projects tp
          join platform.projects p on p.id = tp.project_id
         where tp.tenant_id = ${lab?.id ?? ''}::uuid`;
      expect(bound).toEqual({ is_central: true, credential_source: 'env' });
    } finally {
      await removeIdentitiesByPrefix(prefix);
    }
  });
});
