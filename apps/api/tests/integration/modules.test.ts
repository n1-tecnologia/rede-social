import { platformTenantsSchema, TENANT_HOST_HEADER } from '@tria/contracts';
import { sqlClient } from '@tria/core/db';
import type { AppEnv } from '@tria/core/server/auth/context';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { errorEnvelope } from '@tria/core/server/http/api-error';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
import { requireModule } from '@tria/core/server/modules/require-module';
import { requireRole } from '@tria/core/server/rbac/require-role';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * ROLE-06 + ROLE-01 + D-23 against the live local stack and the real seed (D-17/D-19).
 *
 * The six toggleable modules do not exist yet, so the guards are exercised through a test-only route
 * group that mounts the SAME middleware in the SAME order the real modules will
 * (`requireAuth` -> `requireModule` -> `requireRole`). What is under test is the guard chain and the
 * flags they read, not a module's handler.
 */

type Envelope = { error: { code: string; message: string; details?: unknown } };
type BootstrapBody = {
  tenant: { id: string; slug: string };
  modules: { key: string; nav?: unknown; settings: Record<string, unknown> }[];
  permissions: string[];
};

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'ferramentas@triacompany.com.br';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const PLATFORM_HOST = process.env.PLATFORM_HOST ?? 'tria.localhost';

/** Same middleware stack as `apps/api/src/app.ts`, with two throwaway routes behind the guards. */
const guarded = new Hono<AppEnv>();
guarded.onError((err, c) => {
  const { body, status } = errorEnvelope(err, 'test-request');
  return c.json(body, status);
});
guarded.use('/v1/__test/*', async (c, next) => {
  c.set('requestId', 'test-request');
  await next();
});
guarded.use('/v1/__test/chat', requireAuth, requireModule('chat'));
guarded.get('/v1/__test/chat', (c) => c.json({ ok: true }));
guarded.use(
  '/v1/__test/chat-admin',
  requireAuth,
  requireModule('chat'),
  requireRole('admin_tenant'),
);
guarded.get('/v1/__test/chat-admin', (c) => c.json({ ok: 'admin' }));

/** Concrete keys (not a Record): `noUncheckedIndexedAccess` would otherwise widen every read. */
const tokens = {
  demoMember: '',
  demoAdmin: '',
  labMember: '',
  labAdmin: '',
  superAdmin: '',
  emptyMember: '',
};
const tenantIds = { demo: '', lab: '' };
let emptyTenantId = '';
let emptyUserId = '';
const EMPTY_SLUG = `e2e-empty-${Date.now()}`.slice(0, 40);
const EMPTY_MEMBER = `member-${EMPTY_SLUG}@tria-test.local`;
const EMPTY_PASSWORD = 'Segredo123';

const bootstrap = (token: string, headers: Record<string, string> = {}) =>
  api.request('/v1/me/bootstrap', { headers: { authorization: `Bearer ${token}`, ...headers } });

const testRoute = (path: string, token?: string, headers: Record<string, string> = {}) =>
  guarded.request(`/v1/__test/${path}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });

const platformTenants = (token?: string, headers: Record<string, string> = {}) =>
  api.request('/v1/platform/tenants', {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });

const code = async (res: Response) => ((await res.json()) as Envelope).error.code;

/** Drops every cached flag entry so a DB change made by a test is read on the next call. */
function invalidateAll(): void {
  for (const id of [tenantIds.demo, tenantIds.lab, emptyTenantId]) {
    if (id) moduleFlags.invalidate(id);
  }
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }

  tokens.demoMember = await signInAs('member@tria-demo.local', SEED_PASSWORD);
  tokens.demoAdmin = await signInAs('admin@tria-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@tria-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@tria-lab.local', SEED_PASSWORD);
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  for (const row of rows) {
    if (row.slug === 'tria-demo') tenantIds.demo = row.id;
    if (row.slug === 'tria-lab') tenantIds.lab = row.id;
  }

  // A tenant with NO tenant_modules rows at all (the ROLE-06 "empty" case).
  const created = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${EMPTY_SLUG}, 'Comunidade Sem Modulos', 'Regras de teste.', 1)
    returning id`;
  emptyTenantId = created[0]?.id ?? '';
  const { data, error } = await authAdmin().createUser({
    email: EMPTY_MEMBER,
    password: EMPTY_PASSWORD,
    email_confirm: true,
    user_metadata: { name: 'Sem Modulos' },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  emptyUserId = data.user.id;
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${emptyTenantId}::uuid, ${emptyUserId}::uuid, 'member', 'active')`;
  tokens.emptyMember = await signInAs(EMPTY_MEMBER, EMPTY_PASSWORD);

  invalidateAll();
});

afterAll(async () => {
  if (emptyUserId) await authAdmin().deleteUser(emptyUserId);
  await adminSql`delete from public.tenants where slug = ${EMPTY_SLUG}`;
  await adminSql.end();
  await sqlClient.end();
});

describe('GET /v1/me/bootstrap — enabled modules and permissions (D-17, D-19)', () => {
  it('1. tria-demo lists the seven seeded keys; tria-lab only feed + events', async () => {
    const demo = await bootstrap(tokens.demoMember);
    expect(demo.status).toBe(200);
    const demoBody = (await demo.json()) as BootstrapBody;
    // ROLE-06 ordering: `nav.order` ascending first, then key ascending among the manifest-less keys
    // (MODULE_KEY_ORDER_FALLBACK = 1000). `example` is the only module with a manifest so far
    // (01-07, nav.order 90), so it leads and the remaining six stay alphabetical. When Phase 4
    // deletes @tria/module-example this list loses `example`, not its ordering rule.
    expect(demoBody.modules.map((m) => m.key)).toEqual([
      'example',
      'chat',
      'communities',
      'events',
      'feed',
      'notifications',
      'stories',
    ]);
    for (const m of demoBody.modules) {
      // A key enabled for the tenant but not yet implemented appears WITHOUT nav — that is what
      // makes /me/bootstrap honest about what the tenant bought.
      if (m.key === 'example')
        expect(m.nav).toEqual({
          label: 'Exemplo',
          icon: 'sparkles',
          href: '/inicio#exemplo',
          order: 90,
        });
      else expect(m.nav).toBeUndefined();
      expect(m.settings).toEqual({});
    }

    // D-17 pins tria-lab to exactly ['events','feed'] — the disabled-module 404 below depends on it.
    const lab = await bootstrap(tokens.labMember);
    expect(lab.status).toBe(200);
    expect(((await lab.json()) as BootstrapBody).modules.map((m) => m.key)).toEqual([
      'events',
      'feed',
    ]);
  });

  it('2. permissions come from the role: the admin manages, the member consumes (V1)', async () => {
    const admin = (await (await bootstrap(tokens.demoAdmin)).json()) as BootstrapBody;
    expect(admin.permissions).toContain('tenant.manage');
    expect(admin.permissions).toContain('content.publish');

    const member = (await (await bootstrap(tokens.demoMember)).json()) as BootstrapBody;
    expect(member.permissions).toEqual([]);
  });

  it('3. empty: a tenant with zero tenant_modules rows gets modules: []', async () => {
    const res = await bootstrap(tokens.emptyMember);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BootstrapBody;
    expect(body.modules).toEqual([]);
    expect(body.permissions).toEqual([]);
  });
});

describe('requireModule — 404 MODULE_DISABLED, and the fixed middleware order', () => {
  it('4. enabled on tria-demo -> 200; disabled on tria-lab -> 404 MODULE_DISABLED', async () => {
    const enabled = await testRoute('chat', tokens.demoMember);
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual({ ok: true });

    const disabled = await testRoute('chat', tokens.labMember);
    expect(disabled.status).toBe(404);
    expect(await code(disabled)).toBe('MODULE_DISABLED');
  });

  it('5. adjacency: a MISSING row and enabled = false are the same 404', async () => {
    const labId = tenantIds.lab;

    // The row is deleted entirely — "no such flag" must not read as "enabled".
    await adminSql`delete from public.tenant_modules
                   where tenant_id = ${labId}::uuid and module_key = 'chat'`;
    moduleFlags.invalidate(labId);
    const missing = await testRoute('chat', tokens.labMember);
    expect(missing.status).toBe(404);
    expect(await code(missing)).toBe('MODULE_DISABLED');

    // Put it back explicitly disabled: same answer.
    await adminSql`insert into public.tenant_modules (tenant_id, module_key, enabled)
                   values (${labId}::uuid, 'chat', false)`;
    moduleFlags.invalidate(labId);
    const disabled = await testRoute('chat', tokens.labMember);
    expect(disabled.status).toBe(404);
    expect(await code(disabled)).toBe('MODULE_DISABLED');
  });

  it('6. empty tenant: every module route 404s', async () => {
    const res = await testRoute('chat', tokens.emptyMember);
    expect(res.status).toBe(404);
    expect(await code(res)).toBe('MODULE_DISABLED');
  });

  it('7. ordering: unauthenticated -> 401 (never 404), member on an admin route -> 403', async () => {
    // A disabled module must not even be probeable without a session.
    const anonymous = await testRoute('chat');
    expect(anonymous.status).toBe(401);
    expect(await code(anonymous)).toBe('UNAUTHENTICATED');

    // Enabled module, wrong role -> 403 FORBIDDEN (the module's existence is not a secret here).
    const member = await testRoute('chat-admin', tokens.demoMember);
    expect(member.status).toBe(403);
    expect(await code(member)).toBe('FORBIDDEN');

    const admin = await testRoute('chat-admin', tokens.demoAdmin);
    expect(admin.status).toBe(200);
    expect(await admin.json()).toEqual({ ok: 'admin' });

    // …and on a DISABLED module the role never gets a say: still 404.
    const labAdmin = await testRoute('chat-admin', tokens.labAdmin);
    expect(labAdmin.status).toBe(404);
    expect(await code(labAdmin)).toBe('MODULE_DISABLED');
  });

  it('8. concurrency: a flag flipped in the DB is stale until the TTL or invalidate(tenantId)', async () => {
    const labId = tenantIds.lab;

    // Warm the entry, then flip the row behind the cache's back.
    expect((await testRoute('chat', tokens.labMember)).status).toBe(404);
    await adminSql`update public.tenant_modules set enabled = true
                   where tenant_id = ${labId}::uuid and module_key = 'chat'`;
    expect((await testRoute('chat', tokens.labMember)).status).toBe(404);

    moduleFlags.invalidate(labId);
    expect((await testRoute('chat', tokens.labMember)).status).toBe(200);

    // Restore the seeded state (D-17: tria-lab has feed + events only).
    await adminSql`update public.tenant_modules set enabled = false
                   where tenant_id = ${labId}::uuid and module_key = 'chat'`;
    moduleFlags.invalidate(labId);
    expect((await testRoute('chat', tokens.labMember)).status).toBe(404);

    // Tenant isolation of the cache: tria-demo was never touched by any of this.
    expect((await testRoute('chat', tokens.demoMember)).status).toBe(200);
  });
});

describe('GET /v1/platform/tenants — the platform lane (ROLE-01)', () => {
  it('9. the seeded super_admin gets every tenant with its enabled modules, without a membership', async () => {
    const res = await platformTenants(tokens.superAdmin);
    expect(res.status).toBe(200);
    const body = platformTenantsSchema.parse(await res.json());
    const bySlug = new Map(body.tenants.map((t) => [t.slug, t]));

    expect([...bySlug.keys()]).toContain('tria-demo');
    expect([...bySlug.keys()]).toContain('tria-lab');
    expect(bySlug.get('tria-demo')?.enabledModules).toContain('example');
    expect([...(bySlug.get('tria-lab')?.enabledModules ?? [])].sort()).toEqual(['events', 'feed']);
    expect(bySlug.get('tria-demo')?.status).toBe('active');
  });

  it('10. a tenant admin is refused with 403 FORBIDDEN; no token is 401', async () => {
    const admin = await platformTenants(tokens.demoAdmin);
    expect(admin.status).toBe(403);
    expect(await code(admin)).toBe('FORBIDDEN');

    const member = await platformTenants(tokens.demoMember);
    expect(member.status).toBe(403);
    expect(await code(member)).toBe('FORBIDDEN');

    const anonymous = await platformTenants();
    expect(anonymous.status).toBe(401);
    expect(await code(anonymous)).toBe('UNAUTHENTICATED');
  });

  it('11. D-23: the platform lane is refused on a registered tenant host, allowed off it', async () => {
    const onTenantHost = await platformTenants(tokens.superAdmin, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(onTenantHost.status).toBe(403);
    const text = await onTenantHost.text();
    expect((JSON.parse(text) as Envelope).error.code).toBe('TENANT_HOST_MISMATCH');
    // The body must not say which community this address serves.
    expect((JSON.parse(text) as Envelope).error.details).toBeUndefined();
    for (const needle of ['tria-demo', 'TRIA Demo']) expect(text).not.toContain(needle);

    // The platform host itself is not registered in tenant_domains: a generic host, hence allowed.
    const onPlatformHost = await platformTenants(tokens.superAdmin, {
      [TENANT_HOST_HEADER]: PLATFORM_HOST,
    });
    expect(onPlatformHost.status).toBe(200);
    expect((await platformTenants(tokens.superAdmin)).status).toBe(200);
  });

  it('12. D-23: the super_admin on /me/bootstrap — host mismatch on a tenant host, else NO_MEMBERSHIP', async () => {
    const onTenantHost = await bootstrap(tokens.superAdmin, { [TENANT_HOST_HEADER]: HOSTS.demo });
    expect(onTenantHost.status).toBe(403);
    expect(await code(onTenantHost)).toBe('TENANT_HOST_MISMATCH');

    // Without the header there is no host to mismatch: the identity simply has no membership.
    const noHost = await bootstrap(tokens.superAdmin);
    expect(noHost.status).toBe(403);
    expect(await code(noHost)).toBe('NO_MEMBERSHIP');
  });
});
