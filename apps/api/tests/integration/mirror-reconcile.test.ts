import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { seal } from '@rede-social/core/server/secrets/sealed';
import {
  reconcileAllMirrors,
  reconcileTenantMirror,
} from '@rede-social/core/server/tenancy/mirror';
import {
  closeAllPools,
  invalidateProject,
} from '@rede-social/core/server/tenancy/project-registry';
import { afterAll, describe, expect, it } from 'vitest';
import { adminSql, adminSqlB, provisionTenantOnB, TENANT_B_URL, type TenantOnB } from './setup';

/**
 * Phase 09.2-07, Task 3 (DBT-05, D-537, P12, P13, T-09.2-30): the reconcile function heals the drift between
 * the central mirror and a tenant's own copy of `tenants` / `tenant_modules`, in both directions, and never
 * crosses an ownership line: central-owned columns flow central -> tenant, `branding` flows tenant -> central,
 * and only a MISSING tenant row is seeded from the central copy (brand included).
 */

const RUN = Date.now().toString(36);
const CLOSED_PORT_URL = 'postgres://api_user:postgres@127.0.0.1:1/none';
const fixtures: TenantOnB[] = [];

async function fixture(label: string): Promise<TenantOnB> {
  const t = await provisionTenantOnB({ slug: `mr-${label}-${RUN}`.slice(0, 40) });
  fixtures.push(t);
  return t;
}

type TenantRow = {
  slug: string;
  display_name: string;
  status: string;
  timezone: string;
  plan: string;
  branding: unknown;
  rules_text: string;
  updated_at: Date;
};

const rowIn = async (db: typeof adminSql, tenantId: string): Promise<TenantRow | undefined> => {
  const [row] = await db<TenantRow[]>`
    select slug, display_name, status, timezone, plan, branding, rules_text, updated_at
      from public.tenants where id = ${tenantId}::uuid`;
  return row;
};

async function pointProjectAt(t: TenantOnB, url: string): Promise<void> {
  await adminSql`
    update platform.projects
       set database_url_tx_sealed = ${seal(url, `${t.projectId}:database_url_tx`)}
     where id = ${t.projectId}::uuid`;
  await closeAllPools();
  invalidateProject(t.tenantId);
}

/** The first reconcile of a fixture aligns the two display names the fixture seeds differently. */
async function align(t: TenantOnB): Promise<void> {
  const first = await reconcileTenantMirror(t.tenantId);
  expect(first.healed).toEqual(['tenants.display_name']);
}

afterAll(async () => {
  for (const t of fixtures) await t.cleanup();
  await closeAllPools();
  await stopBoss();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

describe('drift in each direction is healed, and only that column is written', () => {
  it('a central-owned column flows central -> tenant, the brand flows tenant -> central, never the reverse', async () => {
    const t = await fixture('dir');
    await align(t);
    expect((await reconcileTenantMirror(t.tenantId)).healed).toEqual([]);

    // Central edits a central-owned column; the tenant edits its brand and its rules (tenant-owned).
    await adminSql`update public.tenants set display_name = 'Nome central novo' where id = ${t.tenantId}::uuid`;
    await adminSqlB`
      update public.tenants
         set branding = '{"colors":{"primary":"#112233"}}'::jsonb, rules_text = 'Regras do tenant'
       where id = ${t.tenantId}::uuid`;
    const beforeB = await rowIn(adminSqlB, t.tenantId);

    const healed = await reconcileTenantMirror(t.tenantId);
    expect([...healed.healed].sort()).toEqual(['tenants.branding', 'tenants.display_name']);

    const central = await rowIn(adminSql, t.tenantId);
    const own = await rowIn(adminSqlB, t.tenantId);
    expect(own?.display_name).toBe('Nome central novo');
    expect(central?.branding).toEqual({ colors: { primary: '#112233' } });
    // Nothing else moved: the tenant-owned rules never reach the mirror, the other columns are as they were.
    expect(own?.rules_text).toBe('Regras do tenant');
    expect(central?.rules_text).toBe('Regras.');
    expect(own?.status).toBe(beforeB?.status);
    expect(own?.slug).toBe(beforeB?.slug);
  });

  it('a stale central brand never overwrites the tenant brand, and a tenant edit of a central-owned column is undone', async () => {
    const t = await fixture('stale');
    await align(t);
    await adminSqlB`update public.tenants set branding = '{"own":true}'::jsonb, status = 'suspended' where id = ${t.tenantId}::uuid`;
    await adminSql`update public.tenants set branding = '{"stale":true}'::jsonb where id = ${t.tenantId}::uuid`;

    const result = await reconcileTenantMirror(t.tenantId);
    expect([...result.healed].sort()).toEqual(['tenants.branding', 'tenants.status']);
    expect((await rowIn(adminSqlB, t.tenantId))?.branding).toEqual({ own: true });
    expect((await rowIn(adminSql, t.tenantId))?.branding).toEqual({ own: true });
    // `status` is central-owned: the tenant's own edit is overwritten by the central value.
    expect((await rowIn(adminSqlB, t.tenantId))?.status).toBe('active');
  });

  it('a module flag missing in the tenant project is created, other flags and the settings blob are untouched', async () => {
    const t = await fixture('mod');
    await align(t);
    await adminSqlB`update public.tenant_modules set settings = '{"keep":1}'::jsonb where tenant_id = ${t.tenantId}::uuid and module_key = 'feed'`;
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled) values
        (${t.tenantId}::uuid, 'chat', true), (${t.tenantId}::uuid, 'feed', false)`;

    const result = await reconcileTenantMirror(t.tenantId);
    expect([...result.healed].sort()).toEqual([
      'tenant_modules.enabled:chat',
      'tenant_modules.enabled:feed',
    ]);
    const own = await adminSqlB<{ module_key: string; enabled: boolean; settings: unknown }[]>`
      select module_key, enabled, settings from public.tenant_modules
       where tenant_id = ${t.tenantId}::uuid order by module_key`;
    expect(own.map((r) => [r.module_key, r.enabled])).toEqual([
      ['chat', true],
      ['feed', false],
    ]);
    expect(own.find((r) => r.module_key === 'feed')?.settings).toEqual({ keep: 1 });
  });
});

describe('a missing tenant row is re-created from the central values', () => {
  it('the row, its module rows and the brand come from the central copy (the only one that exists)', async () => {
    const t = await fixture('gone');
    await adminSql`
      update public.tenants set branding = '{"colors":{"primary":"#abcdef"}}'::jsonb, display_name = 'Central é a fonte'
       where id = ${t.tenantId}::uuid`;
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${t.tenantId}::uuid, 'feed', true), (${t.tenantId}::uuid, 'chat', false)`;
    // The tenant row vanishes from its own project.
    await adminSqlB`delete from public.memberships where tenant_id = ${t.tenantId}::uuid`;
    await adminSqlB`delete from public.tenants where id = ${t.tenantId}::uuid`;
    expect(await rowIn(adminSqlB, t.tenantId)).toBeUndefined();

    const result = await reconcileTenantMirror(t.tenantId);
    expect(result.healed).toEqual(['tenants.row', 'tenant_modules.rows']);
    const own = await rowIn(adminSqlB, t.tenantId);
    expect(own?.display_name).toBe('Central é a fonte');
    expect(own?.branding).toEqual({ colors: { primary: '#abcdef' } });
    const modules = await adminSqlB<{ module_key: string; enabled: boolean }[]>`
      select module_key, enabled from public.tenant_modules where tenant_id = ${t.tenantId}::uuid order by module_key`;
    expect(modules.map((m) => [m.module_key, m.enabled])).toEqual([
      ['chat', false],
      ['feed', true],
    ]);
    // And a second run finds nothing to do.
    expect((await reconcileTenantMirror(t.tenantId)).healed).toEqual([]);
  });
});

describe('P12: empty cases', () => {
  it('reconcile over zero tenants returns zeros, and a tenant of the central project is not counted', async () => {
    expect(await reconcileAllMirrors({ tenantIds: [] })).toMatchObject({
      tenants: 0,
      healed: 0,
      failed: 0,
    });
    const [lab] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-lab'`;
    const central = await reconcileAllMirrors({ tenantIds: [lab?.id ?? ''] });
    expect(central).toMatchObject({ tenants: 0, healed: 0, failed: 0 });
    expect(central.results[0]?.skipped).toBe('central_project');
  });

  it('an empty brand {} mirrors as {} and never as null', async () => {
    const t = await fixture('empty');
    await align(t);
    await adminSql`update public.tenants set branding = '{"stale":1}'::jsonb where id = ${t.tenantId}::uuid`;
    await adminSqlB`update public.tenants set branding = '{}'::jsonb where id = ${t.tenantId}::uuid`;

    expect((await reconcileTenantMirror(t.tenantId)).healed).toEqual(['tenants.branding']);
    const [row] = await adminSql<{ text: string | null }[]>`
      select branding::text as text from public.tenants where id = ${t.tenantId}::uuid`;
    expect(row?.text).toBe('{}');
  });
});

describe('P13: encoding and idempotency', () => {
  it('accents, emoji, a 4-byte character and unicode font names survive both directions byte for byte; a second run writes nothing', async () => {
    const t = await fixture('enc');
    await align(t);
    const name = 'Ação — São João 🎉 𝒳 日本語 Ünïcode';
    const brand = { look: { titleFont: 'Fraunces 𝒳 Ünïcode 🎉', note: 'ção' } };
    await adminSql`update public.tenants set display_name = ${name} where id = ${t.tenantId}::uuid`;
    await adminSqlB`update public.tenants set branding = ${adminSqlB.json(brand)} where id = ${t.tenantId}::uuid`;

    expect([...(await reconcileTenantMirror(t.tenantId)).healed].sort()).toEqual([
      'tenants.branding',
      'tenants.display_name',
    ]);
    const central = await rowIn(adminSql, t.tenantId);
    const own = await rowIn(adminSqlB, t.tenantId);
    expect(Buffer.from(own?.display_name ?? '', 'utf8').equals(Buffer.from(name, 'utf8'))).toBe(
      true,
    );
    expect(central?.branding).toEqual(brand);

    // Idempotent: nothing differs now, so nothing is written (updated_at is the witness).
    const stamps = [central?.updated_at.getTime(), own?.updated_at.getTime()];
    expect((await reconcileTenantMirror(t.tenantId)).healed).toEqual([]);
    expect([
      (await rowIn(adminSql, t.tenantId))?.updated_at.getTime(),
      (await rowIn(adminSqlB, t.tenantId))?.updated_at.getTime(),
    ]).toEqual(stamps);
  });
});

describe('an unreachable project is failed while the others heal', () => {
  it('the loop goes on past a project that cannot be reached', async () => {
    const up = await fixture('up');
    const down = await fixture('down');
    await align(up);
    await align(down);
    await adminSql`update public.tenants set display_name = 'Mudou' where id in (${up.tenantId}::uuid, ${down.tenantId}::uuid)`;
    await pointProjectAt(down, CLOSED_PORT_URL);

    try {
      const all = await reconcileAllMirrors({
        tenantIds: [down.tenantId, up.tenantId],
        concurrency: 2,
      });
      expect(all.tenants).toBe(2);
      expect(all.failed).toBe(1);
      expect(all.healed).toBe(1);
      const byId = new Map(all.results.map((r) => [r.tenantId, r]));
      expect(byId.get(down.tenantId)?.failed).toBe('project_unavailable');
      expect(byId.get(up.tenantId)?.healed).toEqual(['tenants.display_name']);
      expect((await rowIn(adminSqlB, up.tenantId))?.display_name).toBe('Mudou');
    } finally {
      await pointProjectAt(down, TENANT_B_URL);
    }
    // The tenant whose project was down heals once it is back.
    expect((await reconcileTenantMirror(down.tenantId)).healed).toEqual(['tenants.display_name']);
  });
});
