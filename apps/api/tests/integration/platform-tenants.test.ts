import {
  type ModuleKey,
  platformTenantDetailSchema,
  platformTenantsSchema,
  REAL_TENANT_DEFAULT_MODULES,
  TENANT_HOST_HEADER,
  TOGGLEABLE_MODULES,
  tokenState,
} from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { setRequiredTenantSchemaForTests } from '@rede-social/core/server/migrations/required';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { sendPendingInvites } from '@rede-social/core/server/platform/invites';
import { setModuleEnabled } from '@rede-social/core/server/platform/modules';
import {
  createTenant,
  getTenantDetail,
  listPlatformTenants,
  setTenantStatus,
  updateTenant,
} from '@rede-social/core/server/platform/tenants';
import { runBootstrap } from '@rede-social/core/server/projects/bootstrap';
import { PROJECT_BOOTSTRAP_QUEUE } from '@rede-social/core/server/projects/bootstrap-job';
import { createFakeProjectProvider } from '@rede-social/core/server/projects/fake';
import { setProjectProviderForTests } from '@rede-social/core/server/projects/provider-access';
import * as tokenKernel from '@rede-social/core/server/projects/token';
import { registerCustomerProject } from '@rede-social/core/server/projects/token';
import { open } from '@rede-social/core/server/secrets/sealed';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import {
  invalidateTenantHost,
  resolveTenantHost,
} from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as customerSetup from './projects-setup';
import { bootstrapDeps, fakeTarget, resetB, restoreB } from './projects-setup';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * ROLE-03 / ROLE-04 / ROLE-05 — tenant provisioning through the kernel's platform lane
 * (`packages/core/server/platform/*`), against the live local stack and the real seed.
 *
 * Part 1 drives the SERVICES directly: what a route may rely on. Part 2 drives `/v1/platform/*`
 * through the app: the envelope codes, the strict detail, the concurrency/idempotency edges, the
 * module toggle reflected in a member's bootstrap without a restart, suspend -> TENANT_SUSPENDED and
 * the invite pending/sent states. Every tenant created here carries a unique `pt-svc-…`/`pt-test-…`
 * slug and is deleted in `afterAll`; the seeded tenants are only ever read, except for one module
 * flip on rede-demo (part 1) and one on rede-lab (part 2), both restored in the same case.
 *
 * Platform identity / host-mismatch coverage lives in `isolation.test.ts` and `modules.test.ts`;
 * only one case of each is repeated here, on a mutation route.
 */

const RUN = Date.now();
const SVC_SLUG = `pt-svc-${RUN}`.slice(0, 40);
const SVC_EMAIL = `Admin.${RUN}@Rede-Social-Test.local`;
const SVC_HOST = `pt-svc-${RUN}.localhost`;

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

const ids = { demo: '', lab: '', svc: '' };
const actor = { userId: '' };
const tokens = { superAdmin: '', demoMember: '', labMember: '' };
let demoMemberId = '';
const createdAuthUsers: string[] = [];

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

const platform = async (
  path: string,
  init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
) => {
  return api.request(`/v1/platform${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
};

const bootstrap = (token: string, headers: Record<string, string> = {}) =>
  api.request('/v1/me/bootstrap', { headers: { authorization: `Bearer ${token}`, ...headers } });

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

const newTenantBody = (slug: string, overrides: Record<string, unknown> = {}) => ({
  displayName: 'Comunidade Teste',
  slug,
  colors: { primary: '#7c3aed', secondary: '#a78bfa' },
  // Every real module, 05.3-01's `reels` included (D-122), so "created with all" stays all-enabled.
  modules: ['feed', 'communities', 'stories', 'events', 'chat', 'notifications', 'reels'],
  adminEmail: `admin-${slug}@rede-social-test.local`,
  ...overrides,
});

async function tenantIdBySlug(slug: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = ${slug}`;
  if (!row) throw new Error(`tenant ${slug} is not seeded — run pnpm db:seed first`);
  return row.id;
}

async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ApiError);
  const err = caught as ApiError;
  expect(err.status).toBe(status);
  expect(err.code).toBe(code);
  return err;
}

/**
 * Removes every tenant this file provisions (`pt-svc-…`, `pt-test-…`) and the throwaway auth users
 * it invites/creates. Runs BEFORE the suite too: an interrupted run leaves its rows behind, and
 * `memberships.tenant_id` has no cascade on purpose, so a stale membership would block the tenant
 * delete (and a stale `pt-svc-…` tenant would break the `q` assertion in case 3).
 */
async function cleanupTestTenants(): Promise<void> {
  await adminSql`
    delete from public.memberships where tenant_id in
      (select id from public.tenants where slug like 'pt-svc-%' or slug like 'pt-test-%')`;
  await adminSql`delete from public.tenants where slug like 'pt-svc-%' or slug like 'pt-test-%'`;
  // Users invited (admin-pt-…, admin.<run>) or created (member-pt-…) by this file; GoTrue cascades
  // identities/sessions from auth.users and public.users follows (users_id_users_id_fk).
  await adminSql`
    delete from auth.users
     where lower(email) like '%@rede-social-test.local'
       and (lower(email) like 'admin-pt-%' or lower(email) like 'member-pt-%'
            or lower(email) like 'admin.%')`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  await cleanupTestTenants();
  ids.demo = await tenantIdBySlug('rede-demo');
  ids.lab = await tenantIdBySlug('rede-lab');
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);

  const [admin] = await adminSql<{ user_id: string }[]>`
    select user_id from public.platform_admins limit 1`;
  if (!admin) throw new Error('no platform_admins row — run pnpm db:seed first');
  actor.userId = admin.user_id;

  const [member] = await adminSql<{ user_id: string }[]>`
    select user_id from public.memberships
     where tenant_id = ${ids.demo}::uuid and role = 'member' and status = 'active' limit 1`;
  demoMemberId = member?.user_id ?? '';
});

afterAll(async () => {
  for (const userId of createdAuthUsers) await authAdmin().deleteUser(userId);
  await cleanupTestTenants();
  // events is flipped on rede-demo (part 1) and rede-lab (part 2) and restored in the same case;
  // make sure both are on either way (D-17: rede-lab = feed + events).
  await adminSql`update public.tenant_modules set enabled = true
                 where tenant_id in (${ids.demo}::uuid, ${ids.lab}::uuid) and module_key = 'events'`;
  moduleFlags.invalidate(ids.demo);
  moduleFlags.invalidate(ids.lab);
  await adminSql.end();
  await sqlClient.end();
});

describe('platform services — createTenant, list, detail, modules, update, status, invites', () => {
  it('1. createTenant writes the tenant, one tenant_modules row per key and one pending invite in one transaction', async () => {
    const { id } = await createTenant(
      {
        displayName: 'Comunidade Serviço',
        slug: SVC_SLUG,
        colors: { primary: '#7C3AED', secondary: '#A78BFA' },
        modules: ['feed', 'events'],
        adminEmail: SVC_EMAIL.toLowerCase(),
      },
      actor,
    );
    ids.svc = id;

    const [tenant] = await adminSql<{ slug: string; status: string; branding: unknown }[]>`
      select slug, status, branding from public.tenants where id = ${id}::uuid`;
    expect(tenant?.slug).toBe(SVC_SLUG);
    expect(tenant?.status).toBe('active');
    const branding = tenant?.branding as { colors: Record<string, string>; logoUrl: unknown };
    expect(Object.keys(branding.colors).sort()).toEqual(
      ['onPrimary', 'onPrimaryDark', 'primary', 'primaryDark', 'secondary'].sort(),
    );
    expect(branding.colors.primary).toBe('#7c3aed');
    expect(branding.logoUrl).toBeNull();

    const modules = await adminSql<{ module_key: string; enabled: boolean }[]>`
      select module_key, enabled from public.tenant_modules where tenant_id = ${id}::uuid
      order by module_key`;
    // One row per key in the vocabulary, enabled or not, so a later toggle is an UPDATE and never a
    // "does this tenant have a row yet?" branch. Eight keys since 08.2 appended `store`, which a new
    // tenant gets DISABLED (STORE-01: it is not in REAL_TENANT_DEFAULT_MODULES).
    expect(modules).toHaveLength(TOGGLEABLE_MODULES.length);
    expect(modules.map((m) => m.module_key)).toEqual([...TOGGLEABLE_MODULES].sort());
    expect(modules.find((m) => m.module_key === 'store')?.enabled).toBe(false);
    // 08.3 (COURSE-01, P03): nine keys now; `courses` exists for the new tenant and is OFF.
    expect(modules.find((m) => m.module_key === 'courses')?.enabled).toBe(false);
    const enabled = modules.filter((m) => m.enabled).map((m) => m.module_key);
    expect(enabled.sort()).toEqual(['events', 'feed']);

    const invites = await adminSql<
      { email: string; status: string; role: string; created_by: string }[]
    >`select email, status, role, created_by from public.tenant_invites where tenant_id = ${id}::uuid`;
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({
      email: SVC_EMAIL.toLowerCase(),
      status: 'pending',
      role: 'admin_tenant',
      created_by: actor.userId,
    });

    // 09.1-04 (D-492): the first admin needed no list; the invite wrote ONE manual active access for
    // the lower-cased address, in this tenant only.
    const grants = await adminSql<{ source: string; status: string; email: string }[]>`
      select source, status, email from public.access_grants where tenant_id = ${id}::uuid`;
    expect(grants).toEqual([
      { source: 'manual', status: 'active', email: SVC_EMAIL.toLowerCase() },
    ]);
  });

  it('2. idempotency: the same slug again is 400 VALIDATION_FAILED { slug: "taken" } and leaves no partial rows', async () => {
    const err = await expectApiError(
      createTenant(
        {
          displayName: 'Outra',
          slug: SVC_SLUG,
          colors: { primary: '#111111', secondary: '#222222' },
          modules: [],
          adminEmail: `other-${RUN}@rede-social-test.local`,
        },
        actor,
      ),
      400,
      'VALIDATION_FAILED',
    );
    expect(err.details).toEqual({ slug: 'taken' });

    const [count] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenants where slug = ${SVC_SLUG}`;
    expect(count?.n).toBe('1');
    const [invites] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenant_invites
       where email = ${`other-${RUN}@rede-social-test.local`}`;
    expect(invites?.n).toBe('0');
    // The refused retry left no access behind either: tenant, invite and grant commit together.
    const [grants] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.access_grants
       where email = ${`other-${RUN}@rede-social-test.local`}`;
    expect(grants?.n).toBe('0');
  });

  it('3. listPlatformTenants filters by q (name or slug, case-insensitive) and status, pages by slug cursor, and carries primaryHost', async () => {
    const byName = await listPlatformTenants({ q: 'LAB', limit: 25 });
    expect(byName.rows.map((r) => r.slug)).toEqual(['rede-lab']);
    expect(byName.nextCursor).toBeNull();
    expect(byName.rows[0]?.primaryHost).toBe(process.env.TENANT_LAB_HOST ?? 'rede-lab.localhost');

    const bySlug = await listPlatformTenants({ q: 'pt-svc', limit: 25 });
    expect(bySlug.rows.map((r) => r.slug)).toEqual([SVC_SLUG]);
    // No verified primary host yet: the panel shows "Sem domínio".
    expect(bySlug.rows[0]?.primaryHost).toBeNull();

    const suspended = await listPlatformTenants({ status: 'suspended', limit: 100 });
    expect(suspended.rows.map((r) => r.slug)).not.toContain(SVC_SLUG);
    expect(suspended.rows.every((r) => r.status === 'suspended')).toBe(true);

    const page1 = await listPlatformTenants({ limit: 1 });
    expect(page1.rows).toHaveLength(1);
    expect(page1.nextCursor).toBe(page1.rows[0]?.slug);
    const page2 = await listPlatformTenants({ limit: 1, cursor: page1.nextCursor ?? undefined });
    expect(page2.rows).toHaveLength(1);
    expect((page2.rows[0]?.slug ?? '') > (page1.rows[0]?.slug ?? '')).toBe(true);

    for (const row of [...page1.rows, ...page2.rows]) expect(row).toHaveProperty('primaryHost');
  });

  it('4. getTenantDetail answers the strict detail (every toggleable module, verified domains, invites, admins) and null for an unknown id', async () => {
    expect(await getTenantDetail('00000000-0000-4000-8000-000000000000')).toBeNull();

    const demo = await getTenantDetail(ids.demo);
    expect(demo).not.toBeNull();
    const parsed = platformTenantDetailSchema.parse(demo);
    expect(parsed.tenant.slug).toBe('rede-demo');
    // 08.2-05: the panel's module list is the TOGGLEABLE_MODULES vocabulary, `store` included,
    // derived here, never a literal. Every default module is on; since 08.2-07 the seed also turns
    // `store` on for rede-demo (Pitfall 13: no product, nothing locks), so the panel reads it on.
    expect(parsed.modules.map((m) => m.key).sort()).toEqual([...TOGGLEABLE_MODULES].sort());
    // 08.3-06: and `courses` on for rede-demo (no course seeded; the panel reads it on).
    expect(
      parsed.modules
        .filter((m) => m.enabled)
        .map((m) => m.key)
        .sort(),
    ).toEqual([...REAL_TENANT_DEFAULT_MODULES, 'store', 'courses'].sort());
    expect(parsed.modules.find((m) => m.key === 'store')?.enabled).toBe(true);
    expect(parsed.domains.length).toBeGreaterThanOrEqual(1);
    expect(parsed.domains[0]?.verificationStatus).toBe('verified');
    expect(parsed.domains[0]?.isPrimary).toBe(true);
    expect(parsed.invites).toEqual([]);
    expect(parsed.admins.length).toBeGreaterThanOrEqual(1);
    expect(parsed.admins[0]?.email).toBe('admin@rede-demo.local');
    expect(parsed.tenant.contrast.onPrimary.ok).toBe(true);

    const svc = platformTenantDetailSchema.parse(await getTenantDetail(ids.svc));
    expect(
      svc.modules
        .filter((m) => m.enabled)
        .map((m) => m.key)
        .sort(),
    ).toEqual(['events', 'feed']);
    expect(svc.invites).toHaveLength(1);
    expect(svc.invites[0]?.status).toBe('pending');
    expect(svc.admins).toEqual([]);
    expect(svc.domains).toEqual([]);
  });

  it('5. setModuleEnabled upserts the row and invalidates the flags cache on this instance; the key vocabulary is enforced by the database', async () => {
    const ctx = { userId: demoMemberId, tenantId: ids.demo, role: 'member' as const };
    expect(await moduleFlags.enabledKeys(ctx)).toContain('events');

    await setModuleEnabled(ids.demo, 'events', false, actor);
    expect(await moduleFlags.enabledKeys(ctx)).not.toContain('events');

    // Idempotent: the same value twice is the same row.
    await setModuleEnabled(ids.demo, 'events', false, actor);
    const [rows] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenant_modules
       where tenant_id = ${ids.demo}::uuid and module_key = 'events'`;
    expect(rows?.n).toBe('1');

    await setModuleEnabled(ids.demo, 'events', true, actor);
    expect(await moduleFlags.enabledKeys(ctx)).toContain('events');

    // 04-10 retired the per-key refusal branch this used to assert (D-19). What still refuses a key
    // outside the vocabulary at THIS layer is `tenant_modules_key_chk`, generated from
    // `TOGGLEABLE_MODULES` — so a key the route's enum somehow let through still cannot be stored.
    // Asserted by SQLSTATE and constraint name rather than by message text, which drizzle wraps.
    let checkViolation: { code?: string; constraint_name?: string } | null = null;
    try {
      await setModuleEnabled(ids.demo, 'nao-existe' as ModuleKey, true, actor);
    } catch (error) {
      checkViolation =
        (error as { cause?: { code?: string; constraint_name?: string } }).cause ?? null;
    }
    expect(checkViolation?.code).toBe('23514');
    expect(checkViolation?.constraint_name).toBe('tenant_modules_key_chk');

    await expectApiError(
      setModuleEnabled('00000000-0000-4000-8000-000000000000', 'feed', true, actor),
      404,
      'NOT_FOUND',
    );
  });

  it('6. updateTenant re-derives the colors and keeps the slug; an unknown id is 404', async () => {
    await updateTenant(ids.svc, { colors: { primary: '#111111', secondary: '#222222' } }, actor);
    const detail = platformTenantDetailSchema.parse(await getTenantDetail(ids.svc));
    expect(detail.tenant.slug).toBe(SVC_SLUG);
    expect(detail.tenant.displayName).toBe('Comunidade Serviço');
    expect(detail.tenant.branding.colors.primary).toBe('#111111');
    expect(detail.tenant.branding.colors.onPrimary).toBe('#ffffff');

    await updateTenant(ids.svc, { displayName: 'Renomeada' }, actor);
    const renamed = platformTenantDetailSchema.parse(await getTenantDetail(ids.svc));
    expect(renamed.tenant.displayName).toBe('Renomeada');
    expect(renamed.tenant.branding.colors.primary).toBe('#111111');

    await expectApiError(
      updateTenant('00000000-0000-4000-8000-000000000000', { displayName: 'x' }, actor),
      404,
      'NOT_FOUND',
    );
  });

  it('7. sendPendingInvites is a no-op while the tenant has no verified primary host', async () => {
    const result = await sendPendingInvites(ids.svc, actor);
    expect(result).toEqual({ sent: 0, reason: 'no_verified_primary' });
    const [invite] = await adminSql<{ status: string; sent_at: string | null }[]>`
      select status, sent_at from public.tenant_invites where tenant_id = ${ids.svc}::uuid`;
    expect(invite?.status).toBe('pending');
    expect(invite?.sent_at).toBeNull();
  });

  it('8. setTenantStatus flips the row and invalidates the host cache for every host of the tenant', async () => {
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
      values (${ids.svc}::uuid, ${SVC_HOST}, true, now(), 'verified')`;
    invalidateTenantHost(SVC_HOST);

    // Warm the cache with the active answer.
    const before = await resolveTenantHost(SVC_HOST);
    expect(before.kind).toBe('tenant');
    if (before.kind === 'tenant') expect(before.status).toBe('active');

    await setTenantStatus(ids.svc, 'suspended', actor);
    const [row] = await adminSql<{ status: string }[]>`
      select status from public.tenants where id = ${ids.svc}::uuid`;
    expect(row?.status).toBe('suspended');

    // The very next resolution sees the new status: the entry was dropped, not left to the TTL.
    const after = await resolveTenantHost(SVC_HOST);
    expect(after.kind === 'tenant' && after.status).toBe('suspended');

    await setTenantStatus(ids.svc, 'active', actor);
    const restored = await resolveTenantHost(SVC_HOST);
    expect(restored.kind === 'tenant' && restored.status).toBe('active');

    // The verified primary host is now what the list answers.
    const listed = await listPlatformTenants({ q: SVC_SLUG, limit: 1 });
    expect(listed.rows[0]?.primaryHost).toBe(SVC_HOST);

    await expectApiError(
      setTenantStatus('00000000-0000-4000-8000-000000000000', 'active', actor),
      404,
      'NOT_FOUND',
    );
  });

  it('9. with a verified primary host sendPendingInvites invites the admin through GoTrue, adds an invited admin_tenant membership and marks the invite sent', async () => {
    const result = await sendPendingInvites(ids.svc, actor);
    expect(result).toEqual({ sent: 1 });

    const [invite] = await adminSql<
      { status: string; sent_at: string | null; user_id: string | null }[]
    >`select status, sent_at, user_id from public.tenant_invites where tenant_id = ${ids.svc}::uuid`;
    expect(invite?.status).toBe('sent');
    expect(invite?.sent_at).not.toBeNull();
    expect(invite?.user_id).not.toBeNull();
    if (invite?.user_id) createdAuthUsers.push(invite.user_id);

    const [authUser] = await adminSql<{ id: string; invited_at: string | null }[]>`
      select id, invited_at from auth.users where lower(email) = ${SVC_EMAIL.toLowerCase()}`;
    expect(authUser?.id).toBe(invite?.user_id);
    expect(authUser?.invited_at).not.toBeNull();

    const [membership] = await adminSql<{ role: string; status: string }[]>`
      select role, status from public.memberships
       where tenant_id = ${ids.svc}::uuid and user_id = ${invite?.user_id ?? ''}::uuid`;
    expect(membership).toEqual({ role: 'admin_tenant', status: 'invited' });

    // Nothing pending is left: a second call sends nothing (claim-before-send, T-02-20).
    expect(await sendPendingInvites(ids.svc, actor)).toEqual({ sent: 0 });

    const detail = platformTenantDetailSchema.parse(await getTenantDetail(ids.svc));
    expect(detail.invites[0]?.status).toBe('sent');
    // An invited (not yet accepted) admin is not listed under admins.
    expect(detail.admins).toEqual([]);
  });
});

describe('/v1/platform/tenants — provisioning lifecycle through the API (ROLE-03/04/05)', () => {
  const SLUG = `pt-test-${RUN}`.slice(0, 40);
  const HOST = `pt-test-${RUN}.localhost`;
  let tenantId = '';
  let inviteEmail = '';

  it('10. POST creates the tenant: 201 with the strict detail, one module row per toggleable key, one pending invite', async () => {
    const res = await platform('/tenants', {
      method: 'POST',
      token: tokens.superAdmin,
      body: newTenantBody(SLUG, { adminEmail: `  Admin-${SLUG}@Rede-Social-Test.local ` }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = platformTenantDetailSchema.strict().parse(await res.json());
    tenantId = body.tenant.id;
    inviteEmail = `admin-${SLUG}@rede-social-test.local`;

    expect(body.tenant.slug).toBe(SLUG);
    expect(body.tenant.status).toBe('active');
    expect(Object.keys(body.tenant.branding.colors).sort()).toEqual(
      ['onPrimary', 'onPrimaryDark', 'primary', 'primaryDark', 'secondary'].sort(),
    );
    // Every toggleable key is listed (08.2-05); a new tenant starts with the defaults on and
    // `store` off (STORE-01, Open Question 1).
    expect(body.modules).toHaveLength(TOGGLEABLE_MODULES.length);
    expect(
      body.modules
        .filter((m) => m.enabled)
        .map((m) => m.key)
        .sort(),
    ).toEqual([...REAL_TENANT_DEFAULT_MODULES].sort());
    expect(body.modules.find((m) => m.key === 'store')?.enabled).toBe(false);
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({ email: inviteEmail, status: 'pending', sentAt: null });
    expect(body.domains).toEqual([]);
    expect(body.admins).toEqual([]);

    const rows = await adminSql<{ module_key: string; enabled: boolean }[]>`
      select module_key, enabled from public.tenant_modules where tenant_id = ${tenantId}::uuid`;
    // One row per TOGGLEABLE key; every default module ON, `store` OFF (08.2, STORE-01).
    expect(rows).toHaveLength(TOGGLEABLE_MODULES.length);
    expect(
      rows
        .filter((r) => r.enabled)
        .map((r) => r.module_key)
        .sort(),
    ).toEqual([...REAL_TENANT_DEFAULT_MODULES].sort());
    expect(rows.find((r) => r.module_key === 'store')?.enabled).toBe(false);
  });

  it('11. idempotency: the same slug again is 400 VALIDATION_FAILED { slug: "taken" }', async () => {
    const res = await platform('/tenants', {
      method: 'POST',
      token: tokens.superAdmin,
      body: newTenantBody(SLUG),
    });
    expect(res.status).toBe(400);
    const err = await envelope(res);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.slug).toBe('taken');
  });

  it('12. concurrency: two POSTs with a fresh identical slug leave exactly one tenant', async () => {
    const slug = `pt-test-race-${RUN}`.slice(0, 40);
    const [a, b] = await Promise.all([
      platform('/tenants', { method: 'POST', token: tokens.superAdmin, body: newTenantBody(slug) }),
      platform('/tenants', { method: 'POST', token: tokens.superAdmin, body: newTenantBody(slug) }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const loser = a.status === 400 ? a : b;
    const err = await envelope(loser);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.slug).toBe('taken');

    const [count] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenants where slug = ${slug}`;
    expect(count?.n).toBe('1');
    const [modules] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenant_modules tm
        join public.tenants t on t.id = tm.tenant_id where t.slug = ${slug}`;
    // One row per key in the vocabulary, written once — the loser rolled back entirely.
    expect(modules?.n).toBe(String(TOGGLEABLE_MODULES.length));
  });

  it('13. empty: modules [] creates an empty community; an empty displayName is 400 with the field path', async () => {
    const slug = `pt-test-empty-${RUN}`.slice(0, 40);
    const empty = await platform('/tenants', {
      method: 'POST',
      token: tokens.superAdmin,
      body: newTenantBody(slug, { modules: [] }),
    });
    expect(empty.status).toBe(201);
    const body = platformTenantDetailSchema.parse(await empty.json());
    expect(body.modules).toHaveLength(TOGGLEABLE_MODULES.length);
    expect(body.modules.every((m) => m.enabled === false)).toBe(true);
    const rows = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules where tenant_id = ${body.tenant.id}::uuid`;
    expect(rows).toHaveLength(TOGGLEABLE_MODULES.length);
    expect(rows.every((r) => r.enabled === false)).toBe(true);

    const invalid = await platform('/tenants', {
      method: 'POST',
      token: tokens.superAdmin,
      body: newTenantBody(`pt-test-inv-${RUN}`.slice(0, 40), { displayName: '' }),
    });
    expect(invalid.status).toBe(400);
    const err = await envelope(invalid);
    expect(err.code).toBe('VALIDATION_FAILED');
    const issues = err.details?.issues as { path: string }[];
    expect(issues.map((i) => i.path)).toContain('displayName');

    // A key outside the vocabulary is not a valid checklist value either — 04-10 retired the branch
    // that named the reference module, and the ENUM is what refuses now.
    const unknownKey = await platform('/tenants', {
      method: 'POST',
      token: tokens.superAdmin,
      body: newTenantBody(`pt-test-ex-${RUN}`.slice(0, 40), { modules: ['nao-existe'] }),
    });
    expect(unknownKey.status).toBe(400);
    expect((await envelope(unknownKey)).code).toBe('VALIDATION_FAILED');
  });

  it('14. GET list: ?q= finds the new tenant, ?status=suspended excludes it, ?limit=1 pages by slug cursor', async () => {
    const byQ = await platform(`/tenants?q=${SLUG}`, { token: tokens.superAdmin });
    expect(byQ.status).toBe(200);
    const found = platformTenantsSchema.parse(await byQ.json());
    expect(found.tenants.map((t) => t.slug)).toEqual([SLUG]);
    expect(found.tenants[0]?.primaryHost).toBeNull();
    expect(found.nextCursor).toBeNull();

    const suspended = await platform('/tenants?status=suspended&limit=100', {
      token: tokens.superAdmin,
    });
    const suspendedBody = platformTenantsSchema.parse(await suspended.json());
    expect(suspendedBody.tenants.map((t) => t.slug)).not.toContain(SLUG);

    const page1 = await platform('/tenants?limit=1', { token: tokens.superAdmin });
    const first = platformTenantsSchema.parse(await page1.json());
    expect(first.tenants).toHaveLength(1);
    expect(first.nextCursor).toBe(first.tenants[0]?.slug);

    const page2 = await platform(`/tenants?limit=1&cursor=${first.nextCursor}`, {
      token: tokens.superAdmin,
    });
    const second = platformTenantsSchema.parse(await page2.json());
    expect(second.tenants).toHaveLength(1);
    expect((second.tenants[0]?.slug ?? '') > (first.tenants[0]?.slug ?? '')).toBe(true);

    // limit outside 1..100 is a validation failure, not a silent clamp.
    expect((await platform('/tenants?limit=0', { token: tokens.superAdmin })).status).toBe(400);
  });

  it('15. GET detail answers the strict schema; an unknown id is 404 NOT_FOUND', async () => {
    const res = await platform(`/tenants/${tenantId}`, { token: tokens.superAdmin });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const raw = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(
      ['admins', 'domains', 'invites', 'modules', 'tenant'].sort(),
    );
    const body = platformTenantDetailSchema.strict().parse(raw);
    expect(body.tenant.id).toBe(tenantId);
    expect(body.tenant.contrast.onPrimary.ok).toBe(true);

    const missing = await platform('/tenants/00000000-0000-4000-8000-000000000000', {
      token: tokens.superAdmin,
    });
    expect(missing.status).toBe(404);
    expect((await envelope(missing)).code).toBe('NOT_FOUND');

    expect((await platform('/tenants/not-a-uuid', { token: tokens.superAdmin })).status).toBe(400);
  });

  it('16. PATCH re-derives the colors; a slug change is refused (D-31)', async () => {
    const res = await platform(`/tenants/${tenantId}`, {
      method: 'PATCH',
      token: tokens.superAdmin,
      body: { colors: { primary: '#111111', secondary: '#222222' } },
    });
    expect(res.status).toBe(200);
    const body = platformTenantDetailSchema.parse(await res.json());
    expect(body.tenant.branding.colors.primary).toBe('#111111');
    expect(body.tenant.branding.colors.onPrimary).toBe('#ffffff');
    expect(body.tenant.slug).toBe(SLUG);

    const slugChange = await platform(`/tenants/${tenantId}`, {
      method: 'PATCH',
      token: tokens.superAdmin,
      body: { slug: 'x' },
    });
    expect(slugChange.status).toBe(400);
    expect((await envelope(slugChange)).code).toBe('VALIDATION_FAILED');
    const after = platformTenantDetailSchema.parse(
      await (await platform(`/tenants/${tenantId}`, { token: tokens.superAdmin })).json(),
    );
    expect(after.tenant.slug).toBe(SLUG);
  });

  it('17. ROLE-04: PUT …/modules/events on rede-lab is reflected in the lab member’s bootstrap on the very next request; a key outside the vocabulary is refused', async () => {
    const before = (await (await bootstrap(tokens.labMember)).json()) as {
      modules: { key: string }[];
    };
    expect(before.modules.map((m) => m.key)).toContain('events');

    const off = await platform(`/tenants/${ids.lab}/modules/events`, {
      method: 'PUT',
      token: tokens.superAdmin,
      body: { enabled: false },
    });
    expect(off.status).toBe(200);
    const offBody = platformTenantDetailSchema.parse(await off.json());
    expect(offBody.modules.find((m) => m.key === 'events')?.enabled).toBe(false);

    const after = (await (await bootstrap(tokens.labMember)).json()) as {
      modules: { key: string }[];
    };
    // `reels` (on by default, D-122) sorts ahead of feed by its nav order 30; 09-01 adds the lab's
    // `social` (no nav, so after `feed` by key).
    expect(after.modules.map((m) => m.key)).toEqual(['reels', 'feed', 'social']);

    // Idempotent: the same value again is 200 and still one row.
    const again = await platform(`/tenants/${ids.lab}/modules/events`, {
      method: 'PUT',
      token: tokens.superAdmin,
      body: { enabled: false },
    });
    expect(again.status).toBe(200);
    const [rows] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenant_modules
       where tenant_id = ${ids.lab}::uuid and module_key = 'events'`;
    expect(rows?.n).toBe('1');

    // Restore D-17 (rede-lab = feed + events, plus reels by default and, since 09-01, social).
    const on = await platform(`/tenants/${ids.lab}/modules/events`, {
      method: 'PUT',
      token: tokens.superAdmin,
      body: { enabled: true },
    });
    expect(on.status).toBe(200);
    const restored = (await (await bootstrap(tokens.labMember)).json()) as {
      modules: { key: string }[];
    };
    expect(restored.modules.map((m) => m.key)).toEqual(['reels', 'events', 'feed', 'social']);

    // A key outside the vocabulary is refused at validation on any tenant. This is the rule that
    // SURVIVED 04-10: the route's `z.enum(TOGGLEABLE_MODULES)` refuses it, and no per-key
    // branch in `setModuleEnabled` is needed (or present) to make that true.
    const unknownKey = await platform(`/tenants/${ids.demo}/modules/nao-existe`, {
      method: 'PUT',
      token: tokens.superAdmin,
      body: { enabled: false },
    });
    expect(unknownKey.status).toBe(400);
    expect((await envelope(unknownKey)).code).toBe('VALIDATION_FAILED');
    // …and rede-demo's own flags were not touched by the refusal: the feed still answers.
    const feed = await api.request('/v1/feed', {
      headers: { authorization: `Bearer ${tokens.demoMember}` },
    });
    expect(feed.status).toBe(200);

    const missing = await platform('/tenants/00000000-0000-4000-8000-000000000000/modules/feed', {
      method: 'PUT',
      token: tokens.superAdmin,
      body: { enabled: true },
    });
    expect(missing.status).toBe(404);
  });

  it('17b. 08.2-05 STORE-01 / P04 / P05 / 08.4 SC 5: super_admin turns `store` on and off for a tenant; twice is one row; off then on loses no product, community / course / live link or entitlement', async () => {
    // The panel-created tenant of case 10 starts with `store` off (no special case: the default).
    const toggle = async (enabled: boolean) => {
      const res = await platform(`/tenants/${tenantId}/modules/store`, {
        method: 'PUT',
        token: tokens.superAdmin,
        body: { enabled },
      });
      expect(res.status).toBe(200);
      // P05: the SQL gate follows the row on the next statement; `requireModule` on OTHER API
      // instances may lag up to MODULE_FLAGS_TTL_MS, so the suite drops this instance's cache
      // explicitly after every toggle rather than relying on timing.
      moduleFlags.invalidate(tenantId);
      return platformTenantDetailSchema.parse(await res.json());
    };
    const storeRows = () => adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${tenantId}::uuid and module_key = 'store'`;
    const flagsCtx = { userId: actor.userId, tenantId, role: 'admin_tenant' as const };

    expect(await storeRows()).toEqual([{ enabled: false }]);

    // P04: on twice is a no-op — one row, enabled.
    const on = await toggle(true);
    expect(on.modules.find((m) => m.key === 'store')?.enabled).toBe(true);
    await toggle(true);
    expect(await storeRows()).toEqual([{ enabled: true }]);
    expect(await moduleFlags.enabledKeys(flagsCtx)).toContain('store');

    // A product, a link and an entitlement written while the store is on.
    const [community] = await adminSql<{ id: string }[]>`
      insert into public.communities (tenant_id, created_by_user_id, name, slug)
      values (${tenantId}::uuid, ${actor.userId}::uuid, ${`pt-store-${RUN}`}, ${`pt-store-${RUN}`})
      returning id::text as id`;
    const [product] = await adminSql<{ id: string }[]>`
      insert into public.store_products (tenant_id, created_by_user_id, name, price_cents)
      values (${tenantId}::uuid, ${actor.userId}::uuid, ${`pt-store-${RUN}`}, 1990)
      returning id::text as id`;
    await adminSql`
      insert into public.store_product_communities (tenant_id, product_id, community_id)
      values (${tenantId}::uuid, ${product?.id ?? ''}::uuid, ${community?.id ?? ''}::uuid)`;
    await adminSql`
      insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id)
      values (${tenantId}::uuid, ${actor.userId}::uuid, ${product?.id ?? ''}::uuid, 'grant',
              ${actor.userId}::uuid)`;
    // 08.4 (D-418): one course and one live, linked to the product in the store's own tables.
    const [course] = await adminSql<{ id: string }[]>`
      insert into public.courses (tenant_id, created_by_user_id, title, instructor_name)
      values (${tenantId}::uuid, ${actor.userId}::uuid, ${`pt-store-${RUN}`}, 'Instrutora')
      returning id::text as id`;
    const [live] = await adminSql<{ id: string }[]>`
      insert into public.course_lives
        (tenant_id, created_by_user_id, title, starts_at, duration_min, external_url)
      values (${tenantId}::uuid, ${actor.userId}::uuid, ${`pt-store-${RUN}`},
              now() + interval '1 day', 60, 'https://youtu.be/pt-store')
      returning id::text as id`;
    await adminSql`
      insert into public.store_product_courses (tenant_id, product_id, course_id)
      values (${tenantId}::uuid, ${product?.id ?? ''}::uuid, ${course?.id ?? ''}::uuid)`;
    await adminSql`
      insert into public.store_product_lives (tenant_id, product_id, live_id)
      values (${tenantId}::uuid, ${product?.id ?? ''}::uuid, ${live?.id ?? ''}::uuid)`;
    const snapshot = async () => ({
      products: await adminSql`
        select id, name, price_cents, status, updated_at from public.store_products
         where tenant_id = ${tenantId}::uuid order by id`,
      links: await adminSql`
        select product_id, community_id from public.store_product_communities
         where tenant_id = ${tenantId}::uuid order by product_id, community_id`,
      courseLinks: await adminSql`
        select product_id, course_id, created_at from public.store_product_courses
         where tenant_id = ${tenantId}::uuid order by product_id, course_id`,
      liveLinks: await adminSql`
        select product_id, live_id, created_at from public.store_product_lives
         where tenant_id = ${tenantId}::uuid order by product_id, live_id`,
      entitlements: await adminSql`
        select id, user_id, product_id, status, revoked_at from public.store_entitlements
         where tenant_id = ${tenantId}::uuid order by id`,
      orders: await adminSql`
        select id, status, amount_cents from public.store_orders
         where tenant_id = ${tenantId}::uuid order by id`,
    });
    const before = await snapshot();
    expect(before.products).toHaveLength(1);
    expect(before.links).toHaveLength(1);
    expect(before.courseLinks).toHaveLength(1);
    expect(before.liveLinks).toHaveLength(1);
    expect(before.entitlements).toHaveLength(1);

    // Off: the row flips, the flag follows, and turning it off DELETES nothing.
    const off = await toggle(false);
    expect(off.modules.find((m) => m.key === 'store')?.enabled).toBe(false);
    expect(await storeRows()).toEqual([{ enabled: false }]);
    expect(await moduleFlags.enabledKeys(flagsCtx)).not.toContain('store');
    expect(await snapshot()).toEqual(before);

    // On again: every product, link (community, course, live) and entitlement is back exactly as it was.
    await toggle(true);
    expect(await storeRows()).toEqual([{ enabled: true }]);
    expect(await moduleFlags.enabledKeys(flagsCtx)).toContain('store');
    expect(await snapshot()).toEqual(before);

    // Leave the tenant as a new tenant is: off. The cleanup removes the tenant and its rows.
    await toggle(false);
    await adminSql`delete from public.store_entitlements where tenant_id = ${tenantId}::uuid`;
    await adminSql`delete from public.store_products where tenant_id = ${tenantId}::uuid`;
    await adminSql`delete from public.course_lives where tenant_id = ${tenantId}::uuid`;
    await adminSql`delete from public.courses where tenant_id = ${tenantId}::uuid`;
    await adminSql`delete from public.communities where tenant_id = ${tenantId}::uuid`;
  });

  it('18. D-32: POST /status suspended -> by-host answers status suspended and a member gets 403 TENANT_SUSPENDED; active restores', async () => {
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
      values (${tenantId}::uuid, ${HOST}, true, now(), 'verified')`;
    invalidateTenantHost(HOST);
    const warm = await api.request(`/v1/public/tenants/by-host?host=${HOST}`);
    expect(warm.status).toBe(200);
    expect(((await warm.json()) as { status: string }).status).toBe('active');

    // A throwaway member of the new tenant.
    const memberEmail = `member-${SLUG}@rede-social-test.local`;
    const created = await authAdmin().createUser({
      email: memberEmail,
      password: 'Segredo123',
      email_confirm: true,
      user_metadata: { name: 'Membro Teste' },
    });
    if (created.error || !created.data.user) throw new Error(created.error?.message);
    createdAuthUsers.push(created.data.user.id);
    await adminSql`
      insert into public.memberships (tenant_id, user_id, role, status)
      values (${tenantId}::uuid, ${created.data.user.id}::uuid, 'member', 'active')`;
    const memberToken = await signInAs(memberEmail, 'Segredo123');
    expect((await bootstrap(memberToken)).status).toBe(200);

    const suspend = await platform(`/tenants/${tenantId}/status`, {
      method: 'POST',
      token: tokens.superAdmin,
      body: { status: 'suspended' },
    });
    expect(suspend.status).toBe(200);
    expect(platformTenantDetailSchema.parse(await suspend.json()).tenant.status).toBe('suspended');

    const byHost = await api.request(`/v1/public/tenants/by-host?host=${HOST}`);
    expect(byHost.status).toBe(200);
    expect(((await byHost.json()) as { status: string }).status).toBe('suspended');

    const refused = await bootstrap(memberToken);
    expect(refused.status).toBe(403);
    expect((await envelope(refused)).code).toBe('TENANT_SUSPENDED');

    const reactivate = await platform(`/tenants/${tenantId}/status`, {
      method: 'POST',
      token: tokens.superAdmin,
      body: { status: 'active' },
    });
    expect(reactivate.status).toBe(200);
    expect((await bootstrap(memberToken)).status).toBe(200);

    const bad = await platform(`/tenants/${tenantId}/status`, {
      method: 'POST',
      token: tokens.superAdmin,
      body: { status: 'deleted' },
    });
    expect(bad.status).toBe(400);
  });

  it('19. D-30: the invite stays pending without a verified primary host and is sent once one exists', async () => {
    // The host inserted in (18) is verified + primary; the invite created in (10) is still pending,
    // because nothing has called the sender since — the API never sends by itself on a host insert
    // (02-09's verify job does). Prove the pending state first from the detail.
    const before = platformTenantDetailSchema.parse(
      await (await platform(`/tenants/${tenantId}`, { token: tokens.superAdmin })).json(),
    );
    expect(before.invites[0]?.status).toBe('pending');
    expect(before.domains[0]).toMatchObject({ host: HOST, isPrimary: true });

    const result = await sendPendingInvites(tenantId, actor);
    expect(result).toEqual({ sent: 1 });

    const after = platformTenantDetailSchema.parse(
      await (await platform(`/tenants/${tenantId}`, { token: tokens.superAdmin })).json(),
    );
    expect(after.invites[0]?.status).toBe('sent');
    expect(after.invites[0]?.sentAt).not.toBeNull();
    // Invited, not yet accepted: not an admin yet (T-02-19: the section lists active admins only).
    expect(after.admins).toEqual([]);

    const { data } = await authAdmin().listUsers({ page: 1, perPage: 1000 });
    const invited = data.users.find((u) => u.email?.toLowerCase() === inviteEmail);
    expect(invited).toBeDefined();
    expect(invited?.invited_at).toBeTruthy();
    if (invited) createdAuthUsers.push(invited.id);

    const [membership] = await adminSql<{ role: string; status: string }[]>`
      select role, status from public.memberships
       where tenant_id = ${tenantId}::uuid and user_id = ${invited?.id ?? ''}::uuid`;
    expect(membership).toEqual({ role: 'admin_tenant', status: 'invited' });
  });

  it('20. guard: a member on a platform mutation is 403 FORBIDDEN; a super_admin on a tenant host is 403 TENANT_HOST_MISMATCH', async () => {
    const member = await platform(`/tenants/${tenantId}/status`, {
      method: 'POST',
      token: tokens.demoMember,
      body: { status: 'suspended' },
    });
    expect(member.status).toBe(403);
    expect((await envelope(member)).code).toBe('FORBIDDEN');

    const onTenantHost = await platform(`/tenants/${tenantId}`, {
      token: tokens.superAdmin,
      headers: { [TENANT_HOST_HEADER]: HOSTS.demo },
    });
    expect(onTenantHost.status).toBe(403);
    const err = await envelope(onTenantHost);
    expect(err.code).toBe('TENANT_HOST_MISMATCH');
    expect(err.details).toBeUndefined();

    const anonymous = await platform('/tenants', { method: 'POST', body: newTenantBody('anon') });
    expect(anonymous.status).toBe(401);

    // The refused mutation changed nothing.
    const detail = platformTenantDetailSchema.parse(
      await (await platform(`/tenants/${tenantId}`, { token: tokens.superAdmin })).json(),
    );
    expect(detail.tenant.status).toBe('active');
  });

  it('21. D-314 / D-316 (08.1-06): an adminEmail of an existing tenant member is accepted (201, a pending invite); a platform account is 400 VALIDATION_FAILED { adminEmail: "in_use" } — case-insensitive, no tenant row, same from the service', async () => {
    // A member of another tenant may be the first admin: the invite adds a membership later.
    const memberSlug = `pt-test-member-${RUN}`.slice(0, 40);
    const accepted = await platform('/tenants', {
      method: 'POST',
      token: tokens.superAdmin,
      body: newTenantBody(memberSlug, { adminEmail: 'Member@Rede-Demo.LOCAL' }),
    });
    expect(accepted.status).toBe(201);
    const [invite] = await adminSql<{ email: string; status: string }[]>`
      select i.email, i.status from public.tenant_invites i
        join public.tenants t on t.id = i.tenant_id
       where t.slug = ${memberSlug}`;
    expect(invite).toEqual({ email: 'member@rede-demo.local', status: 'pending' });

    // Only a platform account is refused (D-316).
    const slug = `pt-test-inuse-${RUN}`.slice(0, 40);
    for (const adminEmail of [SUPER_ADMIN_EMAIL, SUPER_ADMIN_EMAIL.toUpperCase()]) {
      const res = await platform('/tenants', {
        method: 'POST',
        token: tokens.superAdmin,
        body: newTenantBody(slug, { adminEmail }),
      });
      expect(res.status, adminEmail).toBe(400);
      const err = await envelope(res);
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.details).toEqual({ adminEmail: 'in_use' });
    }
    // One transaction or nothing: the refusal ran before the insert.
    const [count] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenants where slug = ${slug}`;
    expect(count?.n).toBe('0');

    const err = await expectApiError(
      createTenant(
        {
          displayName: 'Em uso',
          slug,
          colors: { primary: '#111111', secondary: '#222222' },
          modules: [],
          adminEmail: `  ${SUPER_ADMIN_EMAIL.toUpperCase()} `,
        },
        actor,
      ),
      400,
      'VALIDATION_FAILED',
    );
    expect(err.details).toEqual({ adminEmail: 'in_use' });
    const [after] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenants where slug = ${slug}`;
    expect(after?.n).toBe('0');
  });

  it("22. D-310 (08.1-04): an identity that administers two tenants shows each tenant's own profile name in that tenant's admins list", async () => {
    const slugA = `pt-test-an-a-${RUN}`.slice(0, 40);
    const slugB = `pt-test-an-b-${RUN}`.slice(0, 40);
    const [a] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${slugA}, 'Admins A', 'Regras de teste.', 1) returning id::text as id`;
    const [b] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${slugB}, 'Admins B', 'Regras de teste.', 1) returning id::text as id`;
    if (!a || !b) throw new Error('could not create the two throwaway tenants');

    const email = `member-pt-an-${RUN}@rede-social-test.local`;
    const { data, error } = await authAdmin().createUser({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const userId = data.user.id;
    createdAuthUsers.push(userId);
    // A global name that matches neither profile: if the list still read `users`, it would show.
    await adminSql`update public.users set name = 'Nome Global' where id = ${userId}::uuid`;
    for (const [tenantId, name] of [
      [a.id, 'Ana em A'],
      [b.id, 'Ana em B'],
    ] as const) {
      const [m] = await adminSql<{ id: string }[]>`
        insert into public.memberships (tenant_id, user_id, role, status)
        values (${tenantId}::uuid, ${userId}::uuid, 'admin_tenant', 'active')
        returning id::text as id`;
      await adminSql`
        update public.member_profiles set display_name = ${name}
         where membership_id = ${m?.id ?? ''}::uuid`;
    }

    const adminsOf = async (tenantId: string) => {
      const res = await platform(`/tenants/${tenantId}`, { token: tokens.superAdmin });
      expect(res.status).toBe(200);
      return platformTenantDetailSchema.parse(await res.json()).admins;
    };
    const inA = await adminsOf(a.id);
    expect(inA).toHaveLength(1);
    expect(inA[0]).toMatchObject({ userId, email, name: 'Ana em A' });
    const inB = await adminsOf(b.id);
    expect(inB).toHaveLength(1);
    expect(inB[0]).toMatchObject({ userId, email, name: 'Ana em B' });
    for (const admin of [...inA, ...inB]) expect(admin.name).not.toBe('Nome Global');
  });
});

/**
 * 09.2-14 (D-543, D-545, UI-D-540): the list carries each tenant's derived database state and the
 * applied-of-required schema counts, and `?banco=problema` isolates the four states that need a person. Fixtures
 * are central rows only (the list reads the mirror and the registry, never a tenant's project), one tenant per
 * state, each in a throwaway project.
 */
describe('GET /v1/platform/tenants — the database column and the Banco filter (UI-D-540)', () => {
  const TAG = Date.now().toString(36);
  const prefix = `pt-db-${TAG}-`;
  const REQUIRED = 147;

  type Scenario = {
    key: string;
    state: string;
    projectState: 'ready' | 'preparing';
    health?: 'healthy' | 'paused' | 'unreachable';
    applied?: number;
    step?: 'running' | 'failed';
    problem: boolean;
  };
  const scenarios: Scenario[] = [
    {
      key: 'a-ready',
      state: 'ready',
      projectState: 'ready',
      health: 'healthy',
      applied: 147,
      problem: false,
    },
    {
      key: 'b-preparing',
      state: 'preparing',
      projectState: 'preparing',
      step: 'running',
      problem: false,
    },
    {
      key: 'c-failed',
      state: 'preparation_failed',
      projectState: 'preparing',
      step: 'failed',
      problem: true,
    },
    {
      key: 'd-behind',
      state: 'behind',
      projectState: 'ready',
      health: 'healthy',
      applied: 144,
      problem: true,
    },
    {
      key: 'e-paused',
      state: 'paused',
      projectState: 'ready',
      health: 'paused',
      applied: 147,
      problem: true,
    },
    {
      key: 'f-unreachable',
      state: 'unreachable',
      projectState: 'ready',
      health: 'unreachable',
      problem: true,
    },
    { key: 'g-unchecked', state: 'unchecked', projectState: 'ready', problem: false },
  ];
  const slugOf = (key: string) => `${prefix}${key}`;
  let token = '';

  const list = async (query: string) => {
    const res = await platform(`/tenants?${query}`, { token });
    return { res, body: res.status === 200 ? platformTenantsSchema.parse(await res.json()) : null };
  };

  async function cleanup() {
    await adminSql`delete from public.tenants where slug like ${`${prefix}%`}`;
    await adminSql`delete from platform.projects where ref like ${`pt-db-${TAG}-%`}`;
  }

  beforeAll(async () => {
    token = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await cleanup();
    for (const sc of scenarios) {
      const projectId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      await adminSql.begin(async (tx) => {
        await tx`
          insert into platform.projects (id, ref, provider, credential_source, state, api_url)
          values (${projectId}::uuid, ${`pt-db-${TAG}-${sc.key}`}, 'fake', 'sealed', ${sc.projectState}, '')`;
        await tx`
          insert into public.tenants (id, slug, display_name, rules_text, rules_version)
          values (${tenantId}::uuid, ${slugOf(sc.key)}, ${`Banco ${sc.key}`}, 'Regras.', 1)`;
        await tx`
          insert into platform.tenant_projects (tenant_id, project_id)
          values (${tenantId}::uuid, ${projectId}::uuid)`;
        if (sc.health) {
          await tx`
            insert into platform.project_health (project_id, status, checked_at)
            values (${projectId}::uuid, ${sc.health}, now())`;
        }
        if (sc.applied !== undefined) {
          await tx`
            insert into platform.project_schema_state (project_id, applied_count, status)
            values (${projectId}::uuid, ${sc.applied}, 'current')`;
        }
        if (sc.step) {
          await tx`
            insert into platform.project_bootstrap_steps (project_id, step, status, attempt)
            values (${projectId}::uuid, 'verify', ${sc.step}, 1)`;
        }
      });
    }
    setRequiredTenantSchemaForTests({ count: REQUIRED, head: '20261022000000' });
  });

  afterAll(async () => {
    setRequiredTenantSchemaForTests(undefined);
    await cleanup();
  });

  it('every row carries its derived state and the applied-of-required counts', async () => {
    const { res, body } = await list(`q=${prefix}&limit=100`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const rows = new Map(body?.tenants.map((t) => [t.slug, t.database]));
    for (const sc of scenarios) {
      expect(rows.get(slugOf(sc.key)), sc.key).toMatchObject({ state: sc.state });
    }
    expect(rows.get(slugOf('d-behind'))?.schema).toEqual({ applied: 144, required: REQUIRED });
    expect(rows.get(slugOf('a-ready'))?.schema).toEqual({ applied: 147, required: REQUIRED });
    // A project that was never probed has no applied count.
    expect(rows.get(slugOf('g-unchecked'))?.schema).toEqual({ applied: null, required: REQUIRED });
  });

  it('with the required schema unknown (the gate off) nothing is behind', async () => {
    setRequiredTenantSchemaForTests(null);
    try {
      const { body } = await list(`q=${prefix}&limit=100`);
      const behind = body?.tenants.find((t) => t.slug === slugOf('d-behind'));
      expect(behind?.database).toEqual({
        state: 'ready',
        schema: { applied: 144, required: null },
      });
    } finally {
      setRequiredTenantSchemaForTests({ count: REQUIRED, head: '20261022000000' });
    }
  });

  it('banco=problema keeps exactly the four states that need a person, and the pill agrees with the filter', async () => {
    const { res, body } = await list(`q=${prefix}&banco=problema&limit=100`);
    expect(res.status).toBe(200);
    const slugs = body?.tenants.map((t) => t.slug);
    expect(slugs).toEqual(scenarios.filter((sc) => sc.problem).map((sc) => slugOf(sc.key)));
    for (const row of body?.tenants ?? []) {
      expect(['preparation_failed', 'behind', 'paused', 'unreachable']).toContain(
        row.database.state,
      );
    }
    // Every state the filter dropped is one the pill says is not a problem.
    const all = (await list(`q=${prefix}&limit=100`)).body;
    for (const row of all?.tenants ?? []) {
      const inFilter = slugs?.includes(row.slug) ?? false;
      expect(inFilter, row.slug).toBe(
        ['preparation_failed', 'behind', 'paused', 'unreachable'].includes(row.database.state),
      );
    }
  });

  it('banco=problema and status together are a 400 VALIDATION_FAILED; an unknown banco value is too', async () => {
    for (const query of [
      'banco=problema&status=active',
      'banco=problema&status=suspended',
      'banco=tudo',
    ]) {
      const { res } = await list(query);
      expect(res.status, query).toBe(400);
      expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    }
    expect((await list('status=active&q=zzz')).res.status).toBe(200);
  });

  it('the order stays the slug order and the cursor walks the filtered list with no repeat and no skip', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const query: string = `q=${prefix}&banco=problema&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const { body } = await list(query);
      expect(body?.tenants.length).toBeLessThanOrEqual(2);
      seen.push(...(body?.tenants.map((t) => t.slug) ?? []));
      cursor = body?.nextCursor ?? null;
      if (!cursor) break;
    }
    expect(seen).toEqual(scenarios.filter((sc) => sc.problem).map((sc) => slugOf(sc.key)));
    expect(new Set(seen).size).toBe(seen.length);
    // The unfiltered list keeps its order too.
    const { body } = await list(`q=${prefix}&limit=100`);
    const slugs = body?.tenants.map((t) => t.slug) ?? [];
    expect(slugs).toEqual([...slugs].sort());
  });

  it('the seeded tenants of project 0 are listed with a database state of their own', async () => {
    const { body } = await list('q=rede-&limit=100');
    const demo = body?.tenants.find((t) => t.slug === 'rede-demo');
    expect(demo?.database.state).toMatch(/^(ready|unchecked)$/);
    expect(
      demo?.database.schema.applied === null || typeof demo?.database.schema.applied === 'number',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 09.4-09 Task 2: creation on a project of the customer's own account (CTK-01, D-566, D-567, D-571)
// ---------------------------------------------------------------------------------------------------------

describe('createTenant on a customer project (09.4-09, CTK-01)', () => {
  const ORG = `acme-create-${RUN}`.slice(0, 40);
  const ref = (tag: string): string => `pt-cu-${tag}-${RUN}`.slice(0, 40);
  const REFS = {
    a: ref('a'),
    b: ref('b'),
    c: ref('c'),
    d: ref('d'),
    e: ref('e'),
    f: ref('f'),
    unknown: ref('nope'),
  };
  const tokenOf = (tag: string): string => `sbp_fc_fake_create_${tag}_${RUN}_qqqqqqqqqqqq`;
  const T = {
    a: tokenOf('a'),
    b: tokenOf('b'),
    c: tokenOf('c'),
    c2: tokenOf('c2'),
    d: tokenOf('d'),
    e: tokenOf('e'),
    f: tokenOf('f'),
    unknown: tokenOf('unknown'),
    everything: tokenOf('everything'),
    never: tokenOf('never-issued'),
  };
  const EXPIRY = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

  const world = createFakeProjectProvider({
    orgSlug: ORG,
    targets: Object.fromEntries(
      [REFS.a, REFS.b, REFS.c, REFS.d, REFS.e, REFS.f].map((r) => [r, fakeTarget()]),
    ),
    tokens: {
      [T.a]: { refs: [REFS.a] },
      [T.b]: { refs: [REFS.b] },
      [T.c]: { refs: [REFS.c] },
      [T.c2]: { refs: [REFS.c] },
      [T.d]: { refs: [REFS.d] },
      [T.e]: { refs: [REFS.e] },
      [T.f]: { refs: [REFS.f] },
      [T.unknown]: { refs: [REFS.unknown] },
      [T.everything]: { refs: 'all' },
    },
  });

  /** Every line the kernel logger writes for these calls (the actor carries the logger, like a request does). */
  const lines: string[] = [];
  const recorder: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'trace', 'fatal']) {
    recorder[level] = (...args: unknown[]) => lines.push(JSON.stringify(args));
  }
  recorder.child = () => recorder;
  const operator = () => ({ userId: actor.userId, logger: recorder as never });

  let counter = 0;
  const slugOf = (): string => {
    counter += 1;
    return `pt-test-cu-${RUN}-${counter}`.slice(0, 40);
  };
  const bodyFor = (projectRef: string, token: string, extra: Record<string, unknown> = {}) =>
    ({
      displayName: 'Comunidade do Cliente',
      slug: slugOf(),
      colors: { primary: '#7c3aed', secondary: '#a78bfa' },
      modules: ['feed'],
      adminEmail: `admin-cu-${RUN}-${counter}@rede-social-test.local`,
      projectRef,
      owner: 'customer',
      token,
      ...extra,
    }) as never;

  const allRefs = Object.values(REFS);
  type ProjectRow = {
    id: string;
    owner: string;
    org_slug: string | null;
    mgmt_token_sealed: string | null;
    mgmt_token_expires_at: string | null;
    state: string;
  };
  const projectsOf = (r: string) =>
    adminSql<ProjectRow[]>`
      select id::text as id, owner, org_slug, mgmt_token_sealed,
             mgmt_token_expires_at::text as mgmt_token_expires_at, state
        from platform.projects where ref = ${r}`;
  const eventsOf = (r: string) =>
    adminSql<{ kind: string; actor: string; outcome: string; project_id: string | null }[]>`
      select kind, actor, outcome, project_id::text as project_id
        from platform.project_token_events where project_ref = ${r} order by at, id`;

  async function cleanup(): Promise<void> {
    await cleanupTestTenants();
    await adminSql`
      delete from pgboss_platform.job
       where name = ${PROJECT_BOOTSTRAP_QUEUE}
         and data->>'projectId' in (select id::text from platform.projects where ref = any(${allRefs}::text[]))`;
    await adminSql`delete from platform.projects where ref = any(${allRefs}::text[])`;
    await adminSql`delete from platform.project_token_events where project_ref = any(${allRefs}::text[])`;
    await adminSql`delete from auth.users where lower(email) like ${`admin-cu-${RUN}-%`}`;
  }

  beforeAll(async () => {
    await cleanup();
    // The pre-check wants an EMPTY project, like a new hosted one; every ref of this suite maps to B.
    resetB();
    setProjectProviderForTests(world);
  }, 180_000);
  afterAll(async () => {
    setProjectProviderForTests(undefined);
    await cleanup();
    await stopBoss();
    await closeAllPools();
    restoreB();
  }, 180_000);

  it('CTK-01 creation: a customer tenant inserts the project with the sealed token, the learned pin, the expiry and one registered event', async () => {
    lines.length = 0;
    const made = await createTenant(bodyFor(REFS.a, T.a, { tokenExpiresAt: EXPIRY }), operator(), {
      production: false,
    });
    expect(Object.keys(made).sort()).toEqual(['id', 'projectId']);

    const rows = await projectsOf(REFS.a);
    expect(rows).toHaveLength(1);
    const row = rows[0] as ProjectRow;
    expect(row.id).toBe(made.projectId);
    expect(row.owner).toBe('customer');
    expect(row.org_slug).toBe(ORG);
    expect(row.state).toBe('preparing');
    expect(row.mgmt_token_expires_at).toBe(EXPIRY);
    expect(open(row.mgmt_token_sealed as string, `${row.id}:mgmt_token`)).toBe(T.a);

    expect(await eventsOf(REFS.a)).toEqual([
      {
        kind: 'registered',
        actor: `platform:${actor.userId}`,
        outcome: 'ok',
        project_id: row.id,
      },
    ]);
    const [binding] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from platform.tenant_projects
       where tenant_id = ${made.id}::uuid and project_id = ${row.id}::uuid`;
    expect(binding?.n).toBe(1);

    // The token is nowhere but the sealed column: not in the answer, the logger or any audit row.
    const events = JSON.stringify(await eventsOf(REFS.a));
    const tenantRow = JSON.stringify(
      await adminSql`select * from public.tenants where id = ${made.id}::uuid`,
    );
    for (const text of [JSON.stringify(made), lines.join('\n'), events, tenantRow]) {
      expect(text).not.toContain(T.a);
      expect(text).not.toContain(T.a.slice(0, 8));
    }
  });

  it('CTK-01 creation: every refusal maps to its field and writes no tenant, project or event (UI-D-550)', async () => {
    const cases: Array<[string, string, string, Record<string, unknown>, Record<string, string>]> =
      [
        ['an unknown token', REFS.b, T.never, {}, { token: 'token_invalid' }],
        ['a token of another project', REFS.b, T.a, {}, { token: 'token_forbidden' }],
        ['an account-wide token', REFS.b, T.everything, {}, { token: 'token_account_wide' }],
        [
          'a past expiry',
          REFS.b,
          T.b,
          { tokenExpiresAt: '2020-01-01' },
          { tokenExpiresAt: 'token_expiry_invalid' },
        ],
        ['an unknown project', REFS.unknown, T.unknown, {}, { projectRef: 'not_found' }],
      ];
    for (const [label, projectRef, token, extra, details] of cases) {
      const body = bodyFor(projectRef, token, extra) as unknown as { slug: string };
      const err = await expectApiError(
        createTenant(body as never, operator(), { production: false }),
        400,
        'VALIDATION_FAILED',
      );
      expect(err.details, label).toEqual(details);
      expect(await projectsOf(projectRef), label).toHaveLength(0);
      expect(await eventsOf(projectRef), label).toHaveLength(0);
      const [tenant] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.tenants where slug = ${body.slug}`;
      expect(tenant?.n, label).toBe(0);
    }
  });

  it('CTK-01 creation: a customer owner needs a projectRef in the kernel and a token in the contract', async () => {
    const { projectRef: _omitted, ...withoutRef } = bodyFor(REFS.b, T.b) as unknown as Record<
      string,
      unknown
    >;
    const err = await expectApiError(
      createTenant(withoutRef as never, operator(), { production: false }),
      400,
      'VALIDATION_FAILED',
    );
    expect(err.details).toEqual({ projectRef: 'required' });

    const { token: _token, ...withoutToken } = bodyFor(REFS.b, T.b) as unknown as Record<
      string,
      unknown
    >;
    const res = await platform('/tenants', {
      method: 'POST',
      token: tokens.superAdmin,
      body: withoutToken,
    });
    expect(res.status).toBe(400);
    expect((await envelope(res)).code).toBe('VALIDATION_FAILED');
    expect(await projectsOf(REFS.b)).toHaveLength(0);
  });

  it('CTK-01 creation: a KNOWN customer project is bound without re-sealing, and a supplied token is ignored', async () => {
    await registerCustomerProject({
      ref: REFS.c,
      token: T.c,
      expiresAt: null,
      actor: `platform:${actor.userId}`,
    });
    const [before] = await projectsOf(REFS.c);
    const eventsBefore = await eventsOf(REFS.c);

    const made = await createTenant(bodyFor(REFS.c, T.c2), operator(), { production: false });
    expect(made.projectId).toBe(before?.id);

    const [after] = await projectsOf(REFS.c);
    expect(after?.mgmt_token_sealed).toBe(before?.mgmt_token_sealed);
    expect(open(after?.mgmt_token_sealed as string, `${after?.id}:mgmt_token`)).toBe(T.c);
    expect(await eventsOf(REFS.c)).toEqual(eventsBefore);
  });

  it('CTK-01 creation: the owner must match the registered owner of a known project', async () => {
    await adminSql`
      insert into platform.projects (ref, provider, api_url, state, credential_source)
      values (${REFS.d}, 'fake', 'http://127.0.0.1:54321', 'preparing', 'sealed')`;
    const platformOwned = await expectApiError(
      createTenant(bodyFor(REFS.d, T.d), operator(), { production: false }),
      400,
      'VALIDATION_FAILED',
    );
    expect(platformOwned.details).toEqual({ owner: 'mismatch' });

    const customerOwned = await expectApiError(
      createTenant(
        {
          displayName: 'Comunidade Plataforma',
          slug: slugOf(),
          colors: { primary: '#7c3aed', secondary: '#a78bfa' },
          modules: ['feed'],
          adminEmail: `admin-cu-${RUN}-x${counter}@rede-social-test.local`,
          projectRef: REFS.c,
        } as never,
        operator(),
        { provider: world, production: false },
      ),
      400,
      'VALIDATION_FAILED',
    );
    expect(customerOwned.details).toEqual({ owner: 'mismatch' });
    const [still] = await projectsOf(REFS.d);
    expect(still?.owner).toBe('platform');
    expect(still?.mgmt_token_sealed).toBeNull();
  });

  it('CTK-01 creation: two creations racing for one ref leave one project row and one event', async () => {
    const results = await Promise.allSettled([
      createTenant(bodyFor(REFS.e, T.e), operator(), { production: false }),
      createTenant(bodyFor(REFS.e, T.e), operator(), { production: false }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((loser.reason as ApiError).details).toEqual({ projectRef: 'in_use' });
    expect(await projectsOf(REFS.e)).toHaveLength(1);
    expect(await eventsOf(REFS.e)).toHaveLength(1);
  });

  it('CTK-01 creation: the bootstrap that follows runs on the customer token, never the platform one', async () => {
    resetB();
    const made = await createTenant(bodyFor(REFS.f, T.f), operator(), { production: false });
    const { provider: _given, ...deps } = bootstrapDeps(world);
    expect(await runBootstrap(made.projectId, deps)).toEqual({ status: 'ready' });

    const uses = world.calls.tokenUses.filter((use) => use.ref === REFS.f);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((use) => use.kind === 'platform')).toEqual([]);
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------------------
// 09.4-13 Task 2: the token state on the list row and in "Banco com problema" (CTK-41, UI-D-560, D-573)
// ---------------------------------------------------------------------------------------------------------

describe('GET /v1/platform/tenants: the token state of each row and the Banco filter (09.4-13, CTK-41)', () => {
  const TAG = Date.now().toString(36);
  const gridPrefix = `pt-tkg-${TAG}-`;
  const dbPrefix = `pt-tkd-${TAG}-`;
  const ORG = `acme-list-${TAG}`;
  const PROBLEMS = ['expiring', 'expired', 'invalid', 'no_permission', 'org_mismatch'];

  const addDays = (day: string, n: number): string => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  type Check = 'ok' | 'invalid' | 'forbidden' | 'org_mismatch' | null;
  const CHECKS: Check[] = [null, 'ok', 'invalid', 'forbidden', 'org_mismatch'];
  // The day offsets are generated from the same calendar day the function and the SQL use.
  const today = tokenKernel.todayInSaoPaulo();
  const OFFSETS: Array<number | null> = [null, -1, 0, 12, 30, 31, 200];
  const expiryOf = (offset: number | null): string | null =>
    offset === null ? null : addDays(today, offset);

  let token = '';
  const list = async (query: string) => {
    const res = await platform(`/tenants?${query}`, { token });
    const text = await res.text();
    return {
      res,
      text,
      body: res.status === 200 ? platformTenantsSchema.parse(JSON.parse(text)) : null,
    };
  };

  async function seed(opts: {
    slug: string;
    owner: 'platform' | 'customer';
    projectState?: 'ready' | 'preparing';
    health?: 'healthy' | 'paused' | 'unreachable';
    check?: Check;
    expiresAt?: string | null;
    failedStep?: boolean;
  }) {
    const projectId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    await adminSql.begin(async (tx) => {
      await tx`
        insert into platform.projects (id, ref, provider, credential_source, state, api_url)
        values (${projectId}::uuid, ${opts.slug}, 'fake', 'sealed', ${opts.projectState ?? 'ready'}, '')`;
      await tx`
        insert into public.tenants (id, slug, display_name, rules_text, rules_version)
        values (${tenantId}::uuid, ${opts.slug}, ${`Lista ${opts.slug}`}, 'Regras.', 1)`;
      await tx`
        insert into platform.tenant_projects (tenant_id, project_id)
        values (${tenantId}::uuid, ${projectId}::uuid)
        on conflict (tenant_id) do update set project_id = excluded.project_id`;
      await tx`
        insert into platform.project_health (project_id, status, checked_at, token_check, token_checked_at)
        values (${projectId}::uuid, ${opts.health ?? 'healthy'}, now(), ${opts.check ?? null},
                ${opts.check ? new Date() : null})`;
      if (opts.failedStep) {
        await tx`
          insert into platform.project_bootstrap_steps (project_id, step, status, attempt)
          values (${projectId}::uuid, 'verify', 'failed', 1)`;
      }
    });
    if (opts.owner === 'customer') {
      await customerSetup.makeCustomerProject(projectId, `sbp_fc_fake_list_${TAG}`, ORG);
      if (opts.expiresAt) {
        await adminSql`
          update platform.projects set mgmt_token_expires_at = ${opts.expiresAt}::date
           where id = ${projectId}::uuid`;
      }
    }
  }

  const grid = CHECKS.flatMap((check) =>
    OFFSETS.map((offset) => ({ check, offset, expiresAt: expiryOf(offset) })),
  ).map((cell, i) => ({ ...cell, slug: `${gridPrefix}${String(i).padStart(2, '0')}` }));

  async function cleanup() {
    for (const prefix of [gridPrefix, dbPrefix]) {
      await adminSql`delete from public.tenants where slug like ${`${prefix}%`}`;
      await adminSql`delete from platform.projects where ref like ${`${prefix}%`}`;
    }
  }

  beforeAll(async () => {
    token = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await cleanup();
    setRequiredTenantSchemaForTests({ count: 147, head: '20261022000000' });
    for (const cell of grid) {
      await seed({
        slug: cell.slug,
        owner: 'customer',
        check: cell.check,
        expiresAt: cell.expiresAt,
      });
    }
    await seed({ slug: `${gridPrefix}plat`, owner: 'platform', check: null });
    // The database problems, for platform and customer rows, and one row that matches both facts.
    await seed({ slug: `${dbPrefix}a-plat-unreach`, owner: 'platform', health: 'unreachable' });
    await seed({
      slug: `${dbPrefix}b-cust-unreach`,
      owner: 'customer',
      health: 'unreachable',
      check: 'ok',
    });
    await seed({ slug: `${dbPrefix}c-plat-paused`, owner: 'platform', health: 'paused' });
    await seed({
      slug: `${dbPrefix}d-cust-failed`,
      owner: 'customer',
      projectState: 'preparing',
      failedStep: true,
    });
    await seed({
      slug: `${dbPrefix}e-cust-both`,
      owner: 'customer',
      health: 'paused',
      check: 'invalid',
      expiresAt: addDays(today, 5),
    });
    await seed({
      slug: `${dbPrefix}f-cust-fine`,
      owner: 'customer',
      check: 'ok',
      expiresAt: addDays(today, 200),
    });
    await seed({ slug: `${dbPrefix}g-plat-fine`, owner: 'platform', check: null });
  }, 180_000);

  afterAll(async () => {
    setRequiredTenantSchemaForTests(undefined);
    await cleanup();
  });

  it('parity: banco=problema matches a customer row for its token exactly when tokenState is a state that needs attention', async () => {
    const { body } = await list(`q=${gridPrefix}&banco=problema&limit=100`);
    const listed = new Set(body?.tenants.map((t) => t.slug));
    expect(grid.length).toBe(CHECKS.length * OFFSETS.length);
    for (const cell of grid) {
      const state = tokenState({ check: cell.check, expiresAt: cell.expiresAt, today });
      expect(listed.has(cell.slug), `${cell.check} ${cell.expiresAt} -> ${state}`).toBe(
        PROBLEMS.includes(state),
      );
    }
    // `unchecked` and `valid` never match; the platform row never does.
    expect(listed.has(`${gridPrefix}plat`)).toBe(false);
    const states = new Set(
      grid.map((c) => tokenState({ check: c.check, expiresAt: c.expiresAt, today })),
    );
    expect([...states].sort()).toEqual(
      [
        'expired',
        'expiring',
        'invalid',
        'no_permission',
        'org_mismatch',
        'unchecked',
        'valid',
      ].sort(),
    );
  });

  it('the four database problems match as before for platform and customer rows, and a row matching both is listed once', async () => {
    const { body } = await list(`q=${dbPrefix}&banco=problema&limit=100`);
    const slugs = body?.tenants.map((t) => t.slug);
    expect(slugs).toEqual(
      ['a-plat-unreach', 'b-cust-unreach', 'c-plat-paused', 'd-cust-failed', 'e-cust-both'].map(
        (k) => `${dbPrefix}${k}`,
      ),
    );
    expect(new Set(slugs).size).toBe(slugs?.length);
  });

  it('each row carries database.token { state } for a customer project and none for a platform one, and database.state ignores it', async () => {
    const { body } = await list(`q=${gridPrefix}&limit=100`);
    const rows = new Map(body?.tenants.map((t) => [t.slug, t.database]));
    const plat = rows.get(`${gridPrefix}plat`);
    // Absent on the wire for a platform project (it renders as before); read as no token state.
    expect(plat?.token ?? null).toBeNull();
    const dbStates = new Set<string>();
    for (const cell of grid) {
      const database = rows.get(cell.slug);
      expect(database?.token, cell.slug).toEqual({
        state: tokenState({ check: cell.check, expiresAt: cell.expiresAt, today }),
      });
      dbStates.add(database?.state ?? 'missing');
    }
    // Every grid row has the same database facts, so the same database state: no token state moved it.
    expect([...dbStates]).toEqual([plat?.state]);
  });

  it('the order stays the slug order and the cursor walks the filtered list with no repeat and no skip', async () => {
    const expected = grid
      .filter((c) =>
        PROBLEMS.includes(tokenState({ check: c.check, expiresAt: c.expiresAt, today })),
      )
      .map((c) => c.slug)
      .sort();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 40; page += 1) {
      const query: string = `q=${gridPrefix}&banco=problema&limit=7${cursor ? `&cursor=${cursor}` : ''}`;
      const { body } = await list(query);
      seen.push(...(body?.tenants.map((t) => t.slug) ?? []));
      cursor = body?.nextCursor ?? null;
      if (!cursor) break;
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('the list holds only { state } of the token: no expiry date, no organisation slug, no check time, no token', async () => {
    const { text, body } = await list(`q=${gridPrefix}&limit=100`);
    expect(text).not.toContain(ORG);
    expect(text).not.toContain('organization');
    expect(text).not.toContain('expiresAt');
    expect(text).not.toContain('checkedAt');
    expect(text).not.toContain('sbp_');
    for (const row of body?.tenants ?? []) {
      expect(Object.keys(row.database).sort()).toEqual(
        row.slug.endsWith('-plat') ? ['schema', 'state'] : ['schema', 'state', 'token'],
      );
      if (row.database.token) expect(Object.keys(row.database.token)).toEqual(['state']);
    }
    for (const cell of grid) {
      // Quoted, so a row's createdAt timestamp of the same day is not mistaken for an expiry value.
      if (cell.expiresAt) expect(text).not.toContain(`"${cell.expiresAt}"`);
    }
  });
});
