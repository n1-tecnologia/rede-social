import { sqlClient } from '@rede-social/core/db';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import {
  closeAllPools,
  invalidateProject,
} from '@rede-social/core/server/tenancy/project-registry';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
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

type Envelope = { error: { code: string; message: string; details?: unknown } };

const ADMIN_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

describe('every tenant is bound exactly once (DBT-46, P92)', () => {
  it('every tenant row of the central project has exactly one platform.tenant_projects row', async () => {
    const rows = await adminSql<{ tenant_id: string; n: number }[]>`
      select t.id as tenant_id, count(tp.tenant_id)::int as n
        from public.tenants t
        left join platform.tenant_projects tp on tp.tenant_id = t.id
       group by t.id
      having count(tp.tenant_id) <> 1`;
    expect(rows).toEqual([]);
  });

  it('P91: a tenant inserted while no project is flagged default fails at COMMIT, and the flag is restored', async () => {
    const slug = `unbound-${RUN}`.slice(0, 40);
    let failure: { code?: string } | undefined;
    try {
      await adminSql.begin(async (tx) => {
        await tx`update platform.projects set is_default = false where is_default`;
        await tx`
          insert into public.tenants (slug, display_name, rules_text, rules_version)
          values (${slug}, 'Sem vinculo', 'Regras.', 1)`;
      });
    } catch (error) {
      failure = error as { code?: string };
    } finally {
      await adminSql`
        update platform.projects set is_default = true
         where ref = 'project-0' and not exists (select 1 from platform.projects where is_default)`;
      await adminSql`delete from public.tenants where slug = ${slug}`;
    }
    expect(failure?.code).toBe('P0001');
    const [flag] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.projects where is_default`;
    expect(flag?.n).toBe(1);
  });

  it('P92: two tenants inserted in parallel both end bound to the flagged default', async () => {
    const par = postgres(ADMIN_URL, { prepare: false, max: 4 });
    const slugs = [`par-a-${RUN}`.slice(0, 40), `par-b-${RUN}`.slice(0, 40)];
    try {
      await Promise.all(
        slugs.map((slug) =>
          par.begin(async (tx) => {
            await tx`
              insert into public.tenants (slug, display_name, rules_text, rules_version)
              values (${slug}, ${slug}, 'Regras.', 1)`;
            await tx`select pg_sleep(0.2)`;
          }),
        ),
      );
      const rows = await adminSql<{ slug: string; is_default: boolean }[]>`
        select t.slug, p.is_default
          from public.tenants t
          join platform.tenant_projects tp on tp.tenant_id = t.id
          join platform.projects p on p.id = tp.project_id
         where t.slug = any(${slugs})`;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.is_default)).toBe(true);
    } finally {
      await par`delete from public.tenants where slug = any(${slugs})`;
      await par.end();
    }
  });

  it('P92: a tenant inserted while another transaction clears is_default ends bound or fails at commit, never half-bound', async () => {
    const par = postgres(ADMIN_URL, { prepare: false, max: 4 });
    const slugs = [`race-a-${RUN}`.slice(0, 40), `race-b-${RUN}`.slice(0, 40)];
    const insert = (conn: postgres.Sql, slug: string) =>
      conn.unsafe(
        `insert into public.tenants (slug, display_name, rules_text, rules_version)
         values ('${slug}', '${slug}', 'Regras.', 1)`,
      );
    try {
      // Order 1: the clearing transaction is still open when the tenant commits: the tenant binds.
      const clearer = await par.reserve();
      const inserter = await par.reserve();
      await clearer.unsafe('begin');
      await clearer.unsafe('update platform.projects set is_default = false where is_default');
      await inserter.unsafe('begin');
      await insert(inserter, slugs[0] as string);
      await inserter.unsafe('commit');
      await clearer.unsafe('rollback');
      clearer.release();
      inserter.release();

      // Order 2: the tenant is pending when the flag is cleared and committed: its commit must fail.
      const pending = await par.reserve();
      await pending.unsafe('begin');
      await insert(pending, slugs[1] as string);
      await par`update platform.projects set is_default = false where is_default`;
      let failure: { code?: string } | undefined;
      try {
        await pending.unsafe('commit');
      } catch (error) {
        failure = error as { code?: string };
        await pending.unsafe('rollback').catch(() => undefined);
      }
      pending.release();
      expect(failure?.code).toBe('P0001');

      const bound = await par<{ slug: string }[]>`
        select t.slug
          from public.tenants t join platform.tenant_projects tp on tp.tenant_id = t.id
         where t.slug = any(${slugs})`;
      expect(bound.map((row) => row.slug)).toEqual([slugs[0]]);
      const unbound = await par<{ n: number }[]>`
        select count(*)::int as n from public.tenants t
         where t.slug = any(${slugs}) and not exists
               (select 1 from platform.tenant_projects tp where tp.tenant_id = t.id)`;
      expect(unbound[0]?.n).toBe(0);
    } finally {
      await par`
        update platform.projects set is_default = true
         where ref = 'project-0' and not exists (select 1 from platform.projects where is_default)`;
      await par`delete from public.tenants where slug = any(${slugs})`;
      await par.end();
    }
  });
});

describe('the lane opens on the registered project and no other (DBT-06, P14 / DBT-38, P75)', () => {
  const lane = async (tenantId: string) =>
    withTenantTx({ userId: crypto.randomUUID(), tenantId, role: 'member' }, async (tx) => {
      const db = await tx.execute<{ name: string }>(sql`select current_database() as name`);
      const names = await tx.execute<{ display_name: string }>(
        sql`select display_name from public.tenants`,
      );
      return { database: db[0]?.name, tenants: names.map((row) => row.display_name) };
    });

  it('a lane for tenant B runs on rede_tenant_b and sees only B; a lane for rede-lab runs on project 0 and never sees B', async () => {
    const [lab] = await adminSql<{ id: string; display_name: string }[]>`
      select id, display_name from public.tenants where slug = 'rede-lab'`;
    const inB = await lane(b.tenantId);
    expect(inB.database).toBe('rede_tenant_b');
    expect(inB.tenants).toEqual(['Tenant B (database B)']);

    const inLab = await lane(lab?.id ?? '');
    expect(inLab.database).toBe('postgres');
    expect(inLab.tenants).toEqual([lab?.display_name]);
    expect(inLab.tenants).not.toContain('Tenant B (database B)');
    expect(inLab.tenants).not.toContain('Tenant B (central mirror)');
  });
});

describe('fail closed: an unbound or unreachable tenant is never served from another project (T-09.2-14, PR-3)', () => {
  const connections = async () => {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
       where datname = 'rede_tenant_b' and usename = 'api_user'`;
    return row?.n ?? 0;
  };

  it('a tenant that lost its binding answers 503 TENANT_PROJECT_UNBOUND and opens no tenant connection', async () => {
    const before = await connections();
    await adminSql`delete from platform.tenant_projects where tenant_id = ${b.tenantId}::uuid`;
    invalidateProject(b.tenantId);
    try {
      const res = await bootstrap(b.token, b.host);
      expect(res.status).toBe(503);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('TENANT_PROJECT_UNBOUND');
      expect(body.error.details).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/central mirror|database B|rede_tenant_b/);
      expect(await connections()).toBeLessThanOrEqual(before);
    } finally {
      await adminSql`
        insert into platform.tenant_projects (tenant_id, project_id)
        values (${b.tenantId}::uuid, ${b.projectId}::uuid)
        on conflict (tenant_id) do nothing`;
      invalidateProject(b.tenantId);
    }
    // ...and the restored binding serves again.
    expect((await bootstrap(b.token, b.host)).status).toBe(200);
  });

  it('a tenant whose project cannot be reached answers 503 TENANT_UNAVAILABLE, not a read of the central mirror', async () => {
    const down = await provisionTenantOnB({
      slug: `down-b-${RUN}`.slice(0, 40),
      databaseUrl: 'postgres://api_user:postgres@127.0.0.1:1/rede_tenant_b',
    });
    try {
      const res = await bootstrap(down.token, down.host);
      expect(res.status).toBe(503);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('TENANT_UNAVAILABLE');
      expect(JSON.stringify(body)).not.toMatch(/central mirror|127\.0\.0\.1|postgres:\/\//);
    } finally {
      await down.cleanup();
    }
  });
});
