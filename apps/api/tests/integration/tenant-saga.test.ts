import { sqlClient } from '@rede-social/core/db';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { createTenant, getTenantDetail } from '@rede-social/core/server/platform/tenants';
import { seal } from '@rede-social/core/server/secrets/sealed';
import { ProjectUnavailableError } from '@rede-social/core/server/tenancy/project-errors';
import {
  closeAllPools,
  invalidateProject,
} from '@rede-social/core/server/tenancy/project-registry';
import { invalidateTenantHost } from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  adminSqlB,
  api,
  provisionTenantOnB,
  signInAs,
  TENANT_B_URL,
  type TenantOnB,
} from './setup';

/**
 * Phase 09.2-07, Task 2 (DBT-05, DBT-08, D-538): the tenant sagas. `createTenant` is two steps (the control
 * plane, then the tenant's project) and compensates the first when the second fails; `getTenantDetail` reads
 * the central facts and the tenant's own facts from two lanes and merges them; the module switch is written
 * centrally and copied to the tenant's own row without touching the tenant-owned settings blob.
 */

const RUN = Date.now().toString(36);
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const CLOSED_PORT_URL = 'postgres://api_user:postgres@127.0.0.1:1/none';
const FAIL_EMAIL = `zz-saga-fail-${RUN}@rede-social-test.local`;
const TRIGGER_FN = `zz_saga_fail_${RUN}`;

let superAdmin = '';
let actorId = '';
const createdSlugs: string[] = [];
const fixtures: TenantOnB[] = [];

const platform = (path: string, method = 'GET', body?: unknown) =>
  api.request(`/v1/platform${path}`, {
    method,
    headers: {
      authorization: `Bearer ${superAdmin}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const body = (slug: string, adminEmail: string) => ({
  displayName: 'Comunidade Saga',
  slug,
  colors: { primary: '#7c3aed', secondary: '#a78bfa' },
  modules: ['feed', 'chat'],
  adminEmail,
});

const countAll = async () => {
  const [row] = await adminSql<{ tenants: number; modules: number; bindings: number }[]>`
    select (select count(*) from public.tenants)::int as tenants,
           (select count(*) from public.tenant_modules)::int as modules,
           (select count(*) from platform.tenant_projects)::int as bindings`;
  return row;
};

async function removeCreated(): Promise<void> {
  if (createdSlugs.length === 0) return;
  await adminSql`
    delete from public.memberships where tenant_id in
      (select id from public.tenants where slug = any(${createdSlugs}::text[]))`;
  await adminSql`delete from public.tenants where slug = any(${createdSlugs}::text[])`;
}

beforeAll(async () => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  const [admin] = await adminSql<{ id: string }[]>`
    select id from auth.users where lower(email) = lower(${SUPER_ADMIN_EMAIL})`;
  actorId = admin?.id ?? '';
  // A real database failure for exactly one invite address: the second step of the saga then fails the way
  // a lost connection or a constraint would, with no production seam.
  await adminSql.unsafe(`
    create or replace function public.${TRIGGER_FN}() returns trigger language plpgsql as $$
    begin
      if new.email = '${FAIL_EMAIL}' then raise exception 'saga test failure' using errcode = 'P0001'; end if;
      return new;
    end $$`);
  await adminSql.unsafe(`
    create trigger ${TRIGGER_FN} before insert on public.tenant_invites
    for each row execute function public.${TRIGGER_FN}()`);
});

afterAll(async () => {
  await adminSql.unsafe(`drop trigger if exists ${TRIGGER_FN} on public.tenant_invites`);
  await adminSql.unsafe(`drop function if exists public.${TRIGGER_FN}()`);
  await removeCreated();
  for (const t of fixtures) await t.cleanup();
  await closeAllPools();
  await stopBoss();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

describe('createTenant: a two-step saga with compensation (T-09.2-31)', () => {
  it('1. a default-project tenant: central rows, the explicit binding, the pending invite in the tenant lane', async () => {
    const slug = `saga-ok-${RUN}`.slice(0, 40);
    createdSlugs.push(slug);
    const res = await platform(
      '/tenants',
      'POST',
      body(slug, `admin-${slug}@rede-social-test.local`),
    );
    expect(res.status).toBe(201);
    const detail = (await res.json()) as { tenant: { id: string }; invites: { status: string }[] };

    const [row] = await adminSql<
      { modules: number; enabled: number; project_is_default: boolean; invites: number }[]
    >`
      select (select count(*) from public.tenant_modules where tenant_id = t.id)::int as modules,
             (select count(*) from public.tenant_modules where tenant_id = t.id and enabled)::int as enabled,
             p.is_default as project_is_default,
             (select count(*) from public.tenant_invites where tenant_id = t.id and status = 'pending')::int as invites
        from public.tenants t
        join platform.tenant_projects tp on tp.tenant_id = t.id
        join platform.projects p on p.id = tp.project_id
       where t.id = ${detail.tenant.id}::uuid`;
    expect(row).toMatchObject({ enabled: 2, project_is_default: true, invites: 1 });
    expect(row?.modules).toBeGreaterThanOrEqual(2);
    expect(detail.invites).toHaveLength(1);
    // The invite is a tenant fact: it is not in database B.
    const [inB] = await adminSqlB<{ n: number }[]>`
      select count(*)::int as n from public.tenant_invites where tenant_id = ${detail.tenant.id}::uuid`;
    expect(inB?.n).toBe(0);
  });

  it('2. a failing second step leaves no tenant, module or binding behind, and the same slug succeeds on retry', async () => {
    const slug = `saga-undo-${RUN}`.slice(0, 40);
    createdSlugs.push(slug);
    const before = await countAll();

    let caught: unknown;
    try {
      await createTenant(body(slug, FAIL_EMAIL) as never, { userId: actorId });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(ApiError);

    expect(await countAll()).toEqual(before);
    const [leftover] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.tenants where slug = ${slug}`;
    expect(leftover?.n).toBe(0);

    const retry = await createTenant(body(slug, `admin-${slug}@rede-social-test.local`) as never, {
      userId: actorId,
    });
    const [created] = await adminSql<{ slug: string }[]>`
      select slug from public.tenants where id = ${retry.id}::uuid`;
    expect(created?.slug).toBe(slug);
  });

  it('5. the first admin e-mail of a platform account is refused as before, and nothing is created', async () => {
    const slug = `saga-plat-${RUN}`.slice(0, 40);
    createdSlugs.push(slug);
    const before = await countAll();
    const res = await platform('/tenants', 'POST', body(slug, SUPER_ADMIN_EMAIL));
    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      error: { code: string; details?: Record<string, string> };
    };
    expect(json.error.code).toBe('VALIDATION_FAILED');
    expect(json.error.details).toMatchObject({ adminEmail: 'in_use' });
    expect(await countAll()).toEqual(before);
  });
});

describe('getTenantDetail across both lanes (T-09.2-32)', () => {
  let t: TenantOnB;

  beforeAll(async () => {
    t = await provisionTenantOnB({ slug: `saga-det-${RUN}`.slice(0, 40), role: 'admin_tenant' });
    fixtures.push(t);
    // An invite that exists ONLY in database B (a tenant fact).
    await adminSqlB`
      insert into public.tenant_invites (tenant_id, email, status, created_by)
      values (${t.tenantId}::uuid, ${`b-invite-${RUN}@rede-social-test.local`}, 'pending', ${t.userId}::uuid)`;
  });

  it('3. the invites and admins come from B, the domains and modules from the central project', async () => {
    const detail = await getTenantDetail(t.tenantId);
    expect(detail?.tenant.id).toBe(t.tenantId);
    // The central mirror's display name, not B's.
    expect(detail?.tenant.displayName).toBe('Tenant B (central mirror)');
    expect(detail?.invites.map((i) => i.email)).toEqual([`b-invite-${RUN}@rede-social-test.local`]);
    expect(detail?.admins.map((a) => a.userId)).toEqual([t.userId]);
    expect(detail?.domains.map((d) => d.host)).toEqual([t.host]);
  });

  it('3. a tenant id that exists nowhere is null (404) and opens no tenant lane', async () => {
    expect(await getTenantDetail(crypto.randomUUID())).toBeNull();
    const res = await platform(`/tenants/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it('with B closed a plain read fails, a mutation answer degrades to empty tenant facts', async () => {
    await adminSql`
      update platform.projects set database_url_tx_sealed = ${seal(CLOSED_PORT_URL, `${t.projectId}:database_url_tx`)}
       where id = ${t.projectId}::uuid`;
    await closeAllPools();
    invalidateProject(t.tenantId);
    try {
      await expect(getTenantDetail(t.tenantId)).rejects.toBeInstanceOf(ProjectUnavailableError);
      const degraded = await getTenantDetail(t.tenantId, { tolerateTenantDown: true });
      expect(degraded?.invites).toEqual([]);
      expect(degraded?.admins).toEqual([]);
      expect(degraded?.domains.map((d) => d.host)).toEqual([t.host]);
      expect((await platform(`/tenants/${t.tenantId}`)).status).toBe(503);
    } finally {
      await adminSql`
        update platform.projects set database_url_tx_sealed = ${seal(TENANT_B_URL, `${t.projectId}:database_url_tx`)}
         where id = ${t.projectId}::uuid`;
      await closeAllPools();
      invalidateProject(t.tenantId);
      invalidateTenantHost(t.host);
    }
  });
});

describe('the module switch reaches the tenant copy (D-537)', () => {
  it('4. toggling a module of a tenant on B changes enabled centrally and in B, and B settings are untouched', async () => {
    const t = await provisionTenantOnB({ slug: `saga-mod-${RUN}`.slice(0, 40) });
    fixtures.push(t);
    await adminSqlB`
      update public.tenant_modules set settings = '{"keep":"me"}'::jsonb
       where tenant_id = ${t.tenantId}::uuid and module_key = 'feed'`;

    const off = await platform(`/tenants/${t.tenantId}/modules/feed`, 'PUT', { enabled: false });
    expect(off.status).toBe(200);
    const on = await platform(`/tenants/${t.tenantId}/modules/chat`, 'PUT', { enabled: true });
    expect(on.status).toBe(200);

    const read = async (db: typeof adminSql) =>
      db<{ module_key: string; enabled: boolean; settings: unknown }[]>`
        select module_key, enabled, settings from public.tenant_modules
         where tenant_id = ${t.tenantId}::uuid order by module_key`;
    const central = await read(adminSql);
    const own = await read(adminSqlB);
    expect(central.map((r) => [r.module_key, r.enabled])).toEqual([
      ['chat', true],
      ['feed', false],
    ]);
    expect(own.map((r) => [r.module_key, r.enabled])).toEqual([
      ['chat', true],
      ['feed', false],
    ]);
    // The tenant-owned settings blob is untouched by the push.
    expect(own.find((r) => r.module_key === 'feed')?.settings).toEqual({ keep: 'me' });
  });
});
