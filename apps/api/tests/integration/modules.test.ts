import { platformTenantsSchema, TENANT_HOST_HEADER } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { errorEnvelope } from '@rede-social/core/server/http/api-error';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requireRole } from '@rede-social/core/server/rbac/require-role';
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
  modules: { key: string; nav?: unknown; home?: unknown; settings: Record<string, unknown> }[];
  permissions: string[];
};

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const PLATFORM_HOST = process.env.PLATFORM_HOST ?? 'rede-social.localhost';

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
const EMPTY_MEMBER = `member-${EMPTY_SLUG}@rede-social-test.local`;
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

  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
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

describe('GET /v1/me/bootstrap — enabled modules and permissions (D-17)', () => {
  it('1. rede-demo lists the seven seeded keys; rede-lab only reels + events + feed', async () => {
    const demo = await bootstrap(tokens.demoMember);
    expect(demo.status).toBe(200);
    const demoBody = (await demo.json()) as BootstrapBody;
    // ROLE-06 ordering: `nav.order` ascending first, then key ascending among the manifest-less keys
    // (MODULE_KEY_ORDER_FALLBACK = 1000). 04-10 deleted the reference module and left every seeded
    // key in the fallback bucket, so this list was purely alphabetical until 05-01 — which is when
    // `communities` declared `nav.order: 20` (D-40: the tab the feed deliberately left unspent) and
    // moved to the HEAD of the list. That move is the ordering rule working, not a regression: a key
    // with a nav entry sorts ahead of every key without one, whatever its letter. 05.3-01 added
    // `reels` with `nav.order: 30` (D-123), so it sorts right after `communities` for the same reason,
    // and 06-01 added `events` with `nav.order: 40` (D-55, UI-D-215): after reels, ahead of every
    // manifest-less key.
    // 07-01 added `notifications` with `nav.order: 10` (D-40, UI-D-268: the TopBar bell), the lowest
    // order of any manifest, so it now heads the list; `chat` (no manifest yet) stays in the fallback
    // bucket.
    expect(demoBody.modules.map((m) => m.key)).toEqual([
      'notifications',
      'communities',
      'reels',
      'events',
      'chat',
      'feed',
      'stories',
    ]);
    for (const m of demoBody.modules) {
      if (m.key === 'notifications') {
        // 07-01 (D-40, UI-D-268): the bell, a TOPBAR slot badged by the unread count, verbatim.
        expect(m.nav).toEqual({
          placement: 'topbar',
          label: 'Notificações',
          icon: 'bell',
          badge: 'unreadNotifications',
          href: '/notificacoes',
          order: 10,
        });
        expect(m.home).toBeUndefined();
        continue;
      }
      if (m.key === 'communities') {
        // The ONE navigable module in V1 (05-01). Its entry is the manifest's, verbatim — the shell
        // renders a `Comunidades` tab because of THIS payload, never because the shell changed.
        expect(m.nav).toMatchObject({ placement: 'tab', href: '/comunidades', order: 20 });
        continue;
      }
      if (m.key === 'reels') {
        // 05.3-01 (D-121, D-123, UI-D-81): the manifest's tab entry verbatim, `chrome` included —
        // the bootstrap contract would strip an unknown key, so this proves the field survives.
        expect(m.nav).toEqual({
          placement: 'tab',
          label: 'Reels',
          icon: 'film',
          href: '/reels',
          order: 30,
          chrome: 'media',
        });
        expect(m.home).toBeUndefined();
        continue;
      }
      if (m.key === 'events') {
        // 06-01 (D-55, UI-D-215): the Eventos tab, the manifest's entry verbatim; 06-08 (D-202,
        // UI-D-214): the Início "Próximo evento" slot at order 7, verbatim.
        expect(m.nav).toEqual({
          placement: 'tab',
          label: 'Eventos',
          icon: 'calendar-days',
          href: '/eventos',
          order: 40,
        });
        expect(m.home).toEqual([{ order: 7 }]);
        continue;
      }
      // A key enabled for the tenant but not yet implemented appears WITHOUT nav — that is what
      // makes /me/bootstrap honest about what the tenant bought. `feed` has a manifest but declares
      // a HOME SLOT and no tab (D-55), so it too arrives without nav.
      expect(m.nav).toBeUndefined();
      if (m.key === 'feed') expect(m.home).toEqual([{ order: 10 }]);
      expect(m.settings).toEqual({});
    }

    // D-17 pins rede-lab to exactly feed + events plus `reels`, which is on by default (D-122) —
    // the disabled-module 404 below depends on chat, communities and notifications staying off.
    const lab = await bootstrap(tokens.labMember);
    expect(lab.status).toBe(200);
    expect(((await lab.json()) as BootstrapBody).modules.map((m) => m.key)).toEqual([
      'reels',
      'events',
      'feed',
    ]);
  });

  it('2. permissions come from the role: the admin manages, the member consumes (V1)', async () => {
    const admin = (await (await bootstrap(tokens.demoAdmin)).json()) as BootstrapBody;
    expect(admin.permissions).toContain('tenant.manage');
    expect(admin.permissions).toContain('content.publish');

    // 06-01: `events` grants the manage and attendance-read permissions to the admin only.
    expect(admin.permissions).toContain('events.event.manage');
    expect(admin.permissions).toContain('events.attendance.read');

    // …and a member only answers and checks in: the one module permission a V1 member holds.
    const member = (await (await bootstrap(tokens.demoMember)).json()) as BootstrapBody;
    expect(member.permissions).toEqual(['events.attendance.respond']);
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
  it('4. enabled on rede-demo -> 200; disabled on rede-lab -> 404 MODULE_DISABLED', async () => {
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

    // Restore the seeded state (D-17: rede-lab has feed + events, plus reels by default — no chat).
    await adminSql`update public.tenant_modules set enabled = false
                   where tenant_id = ${labId}::uuid and module_key = 'chat'`;
    moduleFlags.invalidate(labId);
    expect((await testRoute('chat', tokens.labMember)).status).toBe(404);

    // Tenant isolation of the cache: rede-demo was never touched by any of this.
    expect((await testRoute('chat', tokens.demoMember)).status).toBe(200);
  });
});

describe('GET /v1/platform/tenants — the platform lane (ROLE-01)', () => {
  it('9. the seeded super_admin gets every tenant with its enabled modules, without a membership', async () => {
    const res = await platformTenants(tokens.superAdmin);
    expect(res.status).toBe(200);
    const body = platformTenantsSchema.parse(await res.json());
    const bySlug = new Map(body.tenants.map((t) => [t.slug, t]));

    expect([...bySlug.keys()]).toContain('rede-demo');
    expect([...bySlug.keys()]).toContain('rede-lab');
    expect([...(bySlug.get('rede-demo')?.enabledModules ?? [])].sort()).toEqual([
      'chat',
      'communities',
      'events',
      'feed',
      'notifications',
      'reels',
      'stories',
    ]);
    expect([...(bySlug.get('rede-lab')?.enabledModules ?? [])].sort()).toEqual([
      'events',
      'feed',
      'reels',
    ]);
    expect(bySlug.get('rede-demo')?.status).toBe('active');
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
    for (const needle of ['rede-demo', 'Rede Demo']) expect(text).not.toContain(needle);

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

describe('PUT /v1/platform/tenants/{id}/modules/{key} — a toggle is live on the next request (ROLE-04, MOD-04)', () => {
  const putModule = (tenantId: string, key: string, enabled: boolean) =>
    api.request(`/v1/platform/tenants/${tenantId}/modules/${key}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${tokens.superAdmin}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled }),
    });

  it('13. no restart, no manual invalidate: the API toggle flips requireModule on this instance immediately', async () => {
    const labId = tenantIds.lab;

    // Warm the flags entry with the seeded state (D-17: chat is off on rede-lab)…
    expect((await testRoute('chat', tokens.labMember)).status).toBe(404);

    // …then toggle it through the platform API. Unlike case 8 the test never calls
    // `moduleFlags.invalidate` — the service does, synchronously, before answering.
    const on = await putModule(labId, 'chat', true);
    expect(on.status).toBe(200);
    expect(on.headers.get('cache-control')).toBe('no-store');
    const onBody = (await on.json()) as { modules: { key: string; enabled: boolean }[] };
    expect(onBody.modules.find((m) => m.key === 'chat')?.enabled).toBe(true);

    const enabled = await testRoute('chat', tokens.labMember);
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual({ ok: true });
    const lab = (await (await bootstrap(tokens.labMember)).json()) as BootstrapBody;
    // `events` (nav order 40) now sorts ahead of the manifest-less `chat` (06-01).
    expect(lab.modules.map((m) => m.key)).toEqual(['reels', 'events', 'chat', 'feed']);

    // Back off: the very next request is refused again.
    const off = await putModule(labId, 'chat', false);
    expect(off.status).toBe(200);
    const disabled = await testRoute('chat', tokens.labMember);
    expect(disabled.status).toBe(404);
    expect(await code(disabled)).toBe('MODULE_DISABLED');
    expect(
      ((await (await bootstrap(tokens.labMember)).json()) as BootstrapBody).modules.map(
        (m) => m.key,
      ),
    ).toEqual(['reels', 'events', 'feed']);

    // Writes are row upserts, never read-modify-write on a set: still exactly one row.
    const [row] = await adminSql<{ n: string }[]>`
      select count(*)::text as n from public.tenant_modules
       where tenant_id = ${labId}::uuid and module_key = 'chat'`;
    expect(row?.n).toBe('1');

    // Cache isolation: rede-demo's entry was never touched.
    expect((await testRoute('chat', tokens.demoMember)).status).toBe(200);

    // A member has no say in the platform lane; the tenant's flags are unchanged by the attempt.
    const member = await api.request(`/v1/platform/tenants/${labId}/modules/chat`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${tokens.labAdmin}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    });
    expect(member.status).toBe(403);
    expect(await code(member)).toBe('FORBIDDEN');
    expect((await testRoute('chat', tokens.labMember)).status).toBe(404);
  });

  it('14. D-121: feed OFF removes reels from the bootstrap although the reels flag stays on', async () => {
    const labId = tenantIds.lab;
    const keys = async () =>
      ((await (await bootstrap(tokens.labMember)).json()) as BootstrapBody).modules.map(
        (m) => m.key,
      );

    // Positive control first: with the seeded flags the lab member DOES get the reels entry.
    expect(await keys()).toEqual(['reels', 'events', 'feed']);

    try {
      const off = await putModule(labId, 'feed', false);
      expect(off.status).toBe(200);
      const offBody = (await off.json()) as { modules: { key: string; enabled: boolean }[] };
      // The RAW flag is untouched: the platform panel still shows reels switched on (planning
      // decision 2) — it simply contributes nothing while its required module is off.
      expect(offBody.modules.find((m) => m.key === 'reels')?.enabled).toBe(true);
      expect(offBody.modules.find((m) => m.key === 'feed')?.enabled).toBe(false);

      // `effectiveKeys` drops reels because feed is off: no reels AND no feed entry.
      const withoutFeed = await keys();
      expect(withoutFeed).not.toContain('reels');
      expect(withoutFeed).not.toContain('feed');
      expect(withoutFeed).toEqual(['events']);
    } finally {
      // Restore the seeded flag whatever happened above, so later suites see D-17's lab.
      const on = await putModule(labId, 'feed', true);
      expect(on.status).toBe(200);
    }

    // Turning feed back on restores reels on the very next request.
    expect(await keys()).toEqual(['reels', 'events', 'feed']);
  });
});
