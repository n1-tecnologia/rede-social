import { platformTenantDetailSchema } from '@tria/contracts';
import { sqlClient } from '@tria/core/db';
import { ApiError } from '@tria/core/server/http/api-error';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
import { sendPendingInvites } from '@tria/core/server/platform/invites';
import { setModuleEnabled } from '@tria/core/server/platform/modules';
import {
  createTenant,
  getTenantDetail,
  listPlatformTenants,
  setTenantStatus,
  updateTenant,
} from '@tria/core/server/platform/tenants';
import { invalidateTenantHost, resolveTenantHost } from '@tria/core/server/tenancy/tenant-host';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, authAdmin } from './setup';

/**
 * ROLE-03 / ROLE-04 / ROLE-05 — tenant provisioning through the kernel's platform lane
 * (`packages/core/server/platform/*`), against the live local stack and the real seed.
 *
 * Part 1 (this block) drives the SERVICES directly: what a route may rely on. Part 2 (below, added
 * with the routes) drives `/v1/platform/*` through the app. Every tenant created here carries a
 * unique `pt-svc-…` slug and is deleted in `afterAll`; the seeded tenants are only ever read, except
 * for one module flip on tria-demo that is restored in the same case.
 */

const RUN = Date.now();
const SVC_SLUG = `pt-svc-${RUN}`.slice(0, 40);
const SVC_EMAIL = `Admin.${RUN}@Tria-Test.local`;
const SVC_HOST = `pt-svc-${RUN}.localhost`;

const ids = { demo: '', lab: '', svc: '' };
const actor = { userId: '' };
let demoMemberId = '';
const createdAuthUsers: string[] = [];

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

beforeAll(async () => {
  ids.demo = await tenantIdBySlug('tria-demo');
  ids.lab = await tenantIdBySlug('tria-lab');

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
  await adminSql`delete from public.tenants where slug like ${'pt-svc-%'}`;
  await adminSql`delete from public.tenants where slug like ${'pt-test-%'}`;
  // tria-demo's events flag is flipped and restored inside one case; make sure it is on either way.
  await adminSql`update public.tenant_modules set enabled = true
                 where tenant_id = ${ids.demo}::uuid and module_key = 'events'`;
  moduleFlags.invalidate(ids.demo);
  await adminSql.end();
  await sqlClient.end();
});

describe('platform services — createTenant, list, detail, modules, update, status, invites', () => {
  it('1. createTenant writes the tenant, one tenant_modules row per key (example false) and one pending invite in one transaction', async () => {
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
    expect(modules).toHaveLength(7);
    const enabled = modules.filter((m) => m.enabled).map((m) => m.module_key);
    expect(enabled.sort()).toEqual(['events', 'feed']);
    expect(modules.find((m) => m.module_key === 'example')?.enabled).toBe(false);

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
          adminEmail: `other-${RUN}@tria-test.local`,
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
       where email = ${`other-${RUN}@tria-test.local`}`;
    expect(invites?.n).toBe('0');
  });

  it('3. listPlatformTenants filters by q (name or slug, case-insensitive) and status, pages by slug cursor, and carries primaryHost', async () => {
    const byName = await listPlatformTenants({ q: 'LAB', limit: 25 });
    expect(byName.rows.map((r) => r.slug)).toEqual(['tria-lab']);
    expect(byName.nextCursor).toBeNull();
    expect(byName.rows[0]?.primaryHost).toBe(process.env.TENANT_LAB_HOST ?? 'tria-lab.localhost');

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

  it('4. getTenantDetail answers the strict detail (6 real modules, verified domains, invites, admins) and null for an unknown id', async () => {
    expect(await getTenantDetail('00000000-0000-4000-8000-000000000000')).toBeNull();

    const demo = await getTenantDetail(ids.demo);
    expect(demo).not.toBeNull();
    const parsed = platformTenantDetailSchema.parse(demo);
    expect(parsed.tenant.slug).toBe('tria-demo');
    expect(parsed.modules.map((m) => m.key).sort()).toEqual(
      ['chat', 'communities', 'events', 'feed', 'notifications', 'stories'].sort(),
    );
    expect(parsed.modules.every((m) => m.enabled)).toBe(true);
    expect(parsed.domains.length).toBeGreaterThanOrEqual(1);
    expect(parsed.domains[0]?.verificationStatus).toBe('verified');
    expect(parsed.domains[0]?.isPrimary).toBe(true);
    expect(parsed.invites).toEqual([]);
    expect(parsed.admins.length).toBeGreaterThanOrEqual(1);
    expect(parsed.admins[0]?.email).toBe('admin@tria-demo.local');
    expect(parsed.tenant.contrast.onPrimary.ok).toBe(true);

    const svc = platformTenantDetailSchema.parse(await getTenantDetail(ids.svc));
    expect(svc.modules.filter((m) => m.enabled).map((m) => m.key).sort()).toEqual([
      'events',
      'feed',
    ]);
    expect(svc.invites).toHaveLength(1);
    expect(svc.invites[0]?.status).toBe('pending');
    expect(svc.admins).toEqual([]);
    expect(svc.domains).toEqual([]);
  });

  it('5. setModuleEnabled upserts the row and invalidates the flags cache on this instance; example is not toggleable', async () => {
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

    const err = await expectApiError(
      setModuleEnabled(ids.demo, 'example', true, actor),
      400,
      'VALIDATION_FAILED',
    );
    expect(err.details).toEqual({ module: 'not_toggleable' });

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
