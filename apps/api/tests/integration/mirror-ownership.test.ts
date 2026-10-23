import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { seal } from '@rede-social/core/server/secrets/sealed';
import {
  mirrorInternals,
  pushToCentral,
  pushToTenant,
  reconcileTenantMirror,
} from '@rede-social/core/server/tenancy/mirror';
import {
  closeAllPools,
  invalidateProject,
} from '@rede-social/core/server/tenancy/project-registry';
import { invalidateTenantHost } from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
 * Phase 09.2-07, the tracer (DBT-04, DBT-05, DBT-08, D-537): suspending a tenant that lives in database B.
 * The status is decided in the CENTRAL project (the authority `requireAuth` and the by-host answer read),
 * copied to B's own `tenants` row afterwards, and the shell's "indisponível" answer survives B being closed.
 * A copy that cannot reach B is logged and does not fail the operator's request; the reconcile function heals it.
 */

const RUN = Date.now().toString(36);
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const CLOSED_PORT_URL = 'postgres://api_user:postgres@127.0.0.1:1/none';

type Envelope = { error: { code: string } };
type ByHostBody = { slug: string; status: string };

let superAdmin = '';
const fixtures: TenantOnB[] = [];
const createdTenantIds: string[] = [];

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

const statusIn = async (db: typeof adminSql, tenantId: string): Promise<string | undefined> => {
  const [row] = await db<{ status: string }[]>`
    select status from public.tenants where id = ${tenantId}::uuid`;
  return row?.status;
};

/** Re-points the project's sealed connection string and forgets every pool, binding and cached host. */
async function pointProjectAt(t: TenantOnB, url: string): Promise<void> {
  await adminSql`
    update platform.projects
       set database_url_tx_sealed = ${seal(url, `${t.projectId}:database_url_tx`)}
     where id = ${t.projectId}::uuid`;
  await closeAllPools();
  invalidateProject(t.tenantId);
  invalidateTenantHost(t.host);
}

async function fixture(slug: string): Promise<TenantOnB> {
  const t = await provisionTenantOnB({ slug: slug.slice(0, 40) });
  fixtures.push(t);
  return t;
}

beforeAll(async () => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
});

afterAll(async () => {
  for (const t of fixtures) await t.cleanup();
  if (createdTenantIds.length > 0) {
    await adminSql`delete from public.tenants where id in ${adminSql(createdTenantIds)}`;
  }
  await closeAllPools();
  await stopBoss();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer: suspending a tenant that lives in database B (D-537)', () => {
  let t: TenantOnB;

  beforeAll(async () => {
    t = await fixture(`mo-trace-${RUN}`);
  });

  it('suspend: the status changes centrally and in B, and the request answers 200', async () => {
    expect(await statusIn(adminSql, t.tenantId)).toBe('active');
    expect(await statusIn(adminSqlB, t.tenantId)).toBe('active');

    const res = await platform(`/tenants/${t.tenantId}/status`, 'POST', { status: 'suspended' });
    expect(res.status).toBe(200);

    expect(await statusIn(adminSql, t.tenantId)).toBe('suspended');
    expect(await statusIn(adminSqlB, t.tenantId)).toBe('suspended');
  });

  it('with B closed the shell still answers "suspended" from the mirror, and a member is refused TENANT_SUSPENDED', async () => {
    await pointProjectAt(t, CLOSED_PORT_URL);

    const res = await byHost(t.host);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ByHostBody).status).toBe('suspended');

    const refused = await bootstrap(t.token, t.host);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as Envelope).error.code).toBe('TENANT_SUSPENDED');
  });

  it('reactivate: both databases are active again and the member is served', async () => {
    await pointProjectAt(t, TENANT_B_URL);

    const res = await platform(`/tenants/${t.tenantId}/status`, 'POST', { status: 'active' });
    expect(res.status).toBe(200);
    expect(await statusIn(adminSql, t.tenantId)).toBe('active');
    expect(await statusIn(adminSqlB, t.tenantId)).toBe('active');

    invalidateTenantHost(t.host);
    const shell = (await (await byHost(t.host)).json()) as ByHostBody;
    expect(shell.status).toBe('active');
    expect((await bootstrap(t.token, t.host)).status).toBe(200);
  });
});

describe('push failure is not a request failure (T-09.2-33)', () => {
  it('B unreachable at push time: 200, the central status changed, the event was logged, the reconcile aligns B', async () => {
    const t = await fixture(`mo-fail-${RUN}`);
    await pointProjectAt(t, CLOSED_PORT_URL);
    const warn = vi.spyOn(mirrorInternals.log, 'warn');

    try {
      const res = await platform(`/tenants/${t.tenantId}/status`, 'POST', { status: 'suspended' });
      expect(res.status).toBe(200);
      expect(await statusIn(adminSql, t.tenantId)).toBe('suspended');

      const failed = warn.mock.calls.find(
        ([fields]) =>
          typeof fields === 'object' &&
          fields !== null &&
          (fields as { event?: string }).event === 'platform.mirror.push_failed',
      );
      expect(failed).toBeDefined();
      const fields = failed?.[0] as Record<string, unknown>;
      expect(fields.tenantId).toBe(t.tenantId);
      expect(fields.fields).toEqual(['status']);
      expect(fields.code).toBe('project_unavailable');
      // Codes and identifiers only: no connection string, no driver message.
      expect(JSON.stringify(fields)).not.toContain('postgres://');
    } finally {
      warn.mockRestore();
    }

    // B still holds the old copy, until the reconcile runs once B is reachable again.
    await pointProjectAt(t, TENANT_B_URL);
    expect(await statusIn(adminSqlB, t.tenantId)).toBe('active');
    const healed = await reconcileTenantMirror(t.tenantId);
    expect(healed.healed).toContain('tenants.status');
    expect(await statusIn(adminSqlB, t.tenantId)).toBe('suspended');
  });
});

describe('a tenant on project 0 skips the push (one row)', () => {
  it('pushToTenant and pushToCentral report central_project and write nothing', async () => {
    const [lab] = await adminSql<{ id: string; status: string; display_name: string }[]>`
      select id, status, display_name from public.tenants where slug = 'rede-lab'`;
    if (!lab) throw new Error('seed tenant rede-lab is missing (run pnpm db:seed)');

    expect(await pushToTenant(lab.id, ['status', 'displayName'])).toEqual({
      pushed: false,
      reason: 'central_project',
    });
    expect(await pushToCentral(lab.id, ['branding'])).toEqual({
      pushed: false,
      reason: 'central_project',
    });
    const [after] = await adminSql<{ status: string; display_name: string }[]>`
      select status, display_name from public.tenants where id = ${lab.id}::uuid`;
    expect(after).toEqual({ status: lab.status, display_name: lab.display_name });
    // Nothing was created in database B for it.
    const [inB] = await adminSqlB<{ n: number }[]>`
      select count(*)::int as n from public.tenants where id = ${lab.id}::uuid`;
    expect(inB?.n).toBe(0);
  });
});

describe('list from the mirror (P11, DBT-04)', () => {
  it('three tenants created in one instant keep a total order: a page walk neither repeats nor skips one, with the tenant pool closed', async () => {
    const prefix = `mo-list-${RUN}`.slice(0, 30);
    // One statement = one transaction timestamp: the three rows share created_at to the microsecond.
    const created = await adminSql<{ id: string; slug: string }[]>`
      insert into public.tenants (slug, display_name)
      select ${prefix} || '-' || n, 'Lista ' || n from generate_series(1, 3) as n
      returning id, slug`;
    createdTenantIds.push(...created.map((r) => r.id));
    const stamps = await adminSql<{ n: number }[]>`
      select count(distinct created_at)::int as n from public.tenants
       where id in ${adminSql(created.map((r) => r.id))}`;
    expect(stamps[0]?.n).toBe(1);

    // A fourth tenant that lives in B, whose pool points at a closed port: the list never opens it.
    const closed = await provisionTenantOnB({
      slug: `${prefix}-b`,
      databaseUrl: CLOSED_PORT_URL,
    });
    fixtures.push(closed);
    await closeAllPools();

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const query: string = `limit=1&q=${prefix}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await platform(`/tenants?${query}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        tenants: { id: string; slug: string }[];
        nextCursor: string | null;
      };
      expect(body.tenants.length).toBeLessThanOrEqual(1);
      for (const row of body.tenants) seen.push(row.id);
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    const expected = [...created.map((r) => r.id), closed.tenantId];
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([...expected].sort());
  });
});
