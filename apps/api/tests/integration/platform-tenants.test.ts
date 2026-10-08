import {
  type ModuleKey,
  platformTenantDetailSchema,
  platformTenantsSchema,
  REAL_TENANT_DEFAULT_MODULES,
  TENANT_HOST_HEADER,
  TOGGLEABLE_MODULES,
} from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { ApiError } from '@rede-social/core/server/http/api-error';
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
import {
  invalidateTenantHost,
  resolveTenantHost,
} from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const platform = (
  path: string,
  init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  api.request(`/v1/platform${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

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
    expect(
      parsed.modules
        .filter((m) => m.enabled)
        .map((m) => m.key)
        .sort(),
    ).toEqual([...REAL_TENANT_DEFAULT_MODULES, 'store'].sort());
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
    // `reels` (on by default, D-122) sorts ahead of feed by its nav order 30.
    expect(after.modules.map((m) => m.key)).toEqual(['reels', 'feed']);

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

    // Restore D-17 (rede-lab = feed + events, plus reels by default).
    const on = await platform(`/tenants/${ids.lab}/modules/events`, {
      method: 'PUT',
      token: tokens.superAdmin,
      body: { enabled: true },
    });
    expect(on.status).toBe(200);
    const restored = (await (await bootstrap(tokens.labMember)).json()) as {
      modules: { key: string }[];
    };
    expect(restored.modules.map((m) => m.key)).toEqual(['reels', 'events', 'feed']);

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

  it('17b. 08.2-05 STORE-01 / P04 / P05: super_admin turns `store` on and off for a tenant; twice is one row; off then on loses no product, link or entitlement', async () => {
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
    const snapshot = async () => ({
      products: await adminSql`
        select id, name, price_cents, status, updated_at from public.store_products
         where tenant_id = ${tenantId}::uuid order by id`,
      links: await adminSql`
        select product_id, community_id from public.store_product_communities
         where tenant_id = ${tenantId}::uuid order by product_id, community_id`,
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
    expect(before.entitlements).toHaveLength(1);

    // Off: the row flips, the flag follows, and turning it off DELETES nothing.
    const off = await toggle(false);
    expect(off.modules.find((m) => m.key === 'store')?.enabled).toBe(false);
    expect(await storeRows()).toEqual([{ enabled: false }]);
    expect(await moduleFlags.enabledKeys(flagsCtx)).not.toContain('store');
    expect(await snapshot()).toEqual(before);

    // On again: every product, link and entitlement is back exactly as it was.
    await toggle(true);
    expect(await storeRows()).toEqual([{ enabled: true }]);
    expect(await moduleFlags.enabledKeys(flagsCtx)).toContain('store');
    expect(await snapshot()).toEqual(before);

    // Leave the tenant as a new tenant is: off. The cleanup removes the tenant and its rows.
    await toggle(false);
    await adminSql`delete from public.store_entitlements where tenant_id = ${tenantId}::uuid`;
    await adminSql`delete from public.store_products where tenant_id = ${tenantId}::uuid`;
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
