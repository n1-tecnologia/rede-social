import { TENANT_HOST_HEADER } from '@tria/contracts';
import { sqlClient } from '@tria/core/db';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
import type { ExampleItem } from '@tria/module-example/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * TENANT-05 — the phase's exit gate at the API level, and every later phase's regression gate.
 *
 * The rule this file exists to enforce (ROADMAP cross-cutting): **every new endpoint adds a
 * cross-tenant case here.** The question it answers is always the same one — "can a session of
 * tenant A ever see, name or touch a row of tenant B?" — asked once per shape of answer (list,
 * detail, empty, disabled, blocked, wrong host, platform identity, public host lookup).
 *
 * TENANT-05 adjacency: both seeded tenants get items with the SAME title and their members share
 * the `member@…` local part, so a leak that matched on a value rather than on `tenant_id` cannot
 * pass by looking plausible. Every assertion below compares IDS, never contents.
 *
 * Deeper single-concern cases already live elsewhere and are deliberately NOT duplicated here:
 *   - `auth-middleware.test.ts` — token verification, blocked/suspended semantics, host matching
 *   - `bootstrap.test.ts`       — the bootstrap payload itself
 *   - `example.test.ts`         — the module's guard chain, transactional enqueue and job RLS
 *   - `modules.test.ts`         — requireModule/requireRole ordering and the flags cache
 *   - `supabase/tests/020-tenant-isolation.sql` — the same isolation proved inside Postgres
 */

type Envelope = { error: { code: string; message: string; details?: unknown } };
type BootstrapBody = { tenant: { id: string; slug: string }; modules: { key: string }[] };

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'ferramentas@triacompany.com.br';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

/** Adjacency: the SAME title in both tenants, so only the id can tell the rows apart. */
const SHARED_TITLE = 'Reunião';
const RUN = Date.now();
const EMPTY_SLUG = `tria-empty-${RUN}`.slice(0, 40);
const SUSPENDED_SLUG = `tria-susp-${RUN}`.slice(0, 40);
const EMPTY_HOST = `tria-empty-${RUN}.localhost`;
const SUSPENDED_HOST = `tria-susp-${RUN}.localhost`;
const THROWAWAY_PASSWORD = 'Segredo123';

const tokens = {
  demoMember: '',
  labMember: '',
  emptyMember: '',
  blockedMember: '',
  superAdmin: '',
};
const tenantIds = { demo: '', lab: '', empty: '', suspended: '' };
const itemIds = { demo: [] as string[], lab: [] as string[] };
const throwawayUsers: string[] = [];
let blockedUserId = '';

const request = (path: string, token?: string, headers: Record<string, string> = {}) =>
  api.request(path, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });

const code = async (res: Response) => ((await res.json()) as Envelope).error.code;

async function tenantIdBySlug(slug: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = ${slug}`;
  if (!row) throw new Error(`tenant ${slug} is not seeded — run pnpm db:seed first`);
  return row.id;
}

/** Inserts straight through the admin connection: rows the other tenant's lane must never return. */
async function seedItem(tenantId: string, title: string): Promise<string> {
  const [user] = await adminSql<{ id: string }[]>`
    select u.id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantId}::uuid limit 1`;
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.example_items (tenant_id, title, created_by_user_id)
    values (${tenantId}::uuid, ${title}, ${user?.id ?? null}::uuid)
    returning id`;
  if (!row) throw new Error('failed to seed an example item');
  return row.id;
}

async function throwawayMember(tenantId: string, email: string): Promise<string> {
  const { data, error } = await authAdmin().createUser({
    email,
    password: THROWAWAY_PASSWORD,
    email_confirm: true,
    user_metadata: { name: 'Isolamento' },
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  throwawayUsers.push(data.user.id);
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantId}::uuid, ${data.user.id}::uuid, 'member', 'active')`;
  return signInAs(email, THROWAWAY_PASSWORD);
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }

  tenantIds.demo = await tenantIdBySlug('tria-demo');
  tenantIds.lab = await tenantIdBySlug('tria-lab');

  // Identical-looking content on both sides (TENANT-05 adjacency).
  itemIds.demo = [
    await seedItem(tenantIds.demo, SHARED_TITLE),
    await seedItem(tenantIds.demo, SHARED_TITLE),
  ];
  itemIds.lab = [
    await seedItem(tenantIds.lab, SHARED_TITLE),
    await seedItem(tenantIds.lab, SHARED_TITLE),
  ];

  // A third tenant with the module ENABLED and zero rows: "empty" must be 200 [], never 404/500.
  const [empty] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${EMPTY_SLUG}, 'Comunidade Vazia', 'Regras de teste.', 1)
    returning id`;
  tenantIds.empty = empty?.id ?? '';
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantIds.empty}::uuid, 'example', true)`;
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${tenantIds.empty}::uuid, ${EMPTY_HOST}, true, now())`;

  // A SUSPENDED tenant with a registered host: the public host lookup must not resolve it (D-20).
  const [suspended] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version, status)
    values (${SUSPENDED_SLUG}, 'Comunidade Suspensa', 'Regras de teste.', 1, 'suspended')
    returning id`;
  tenantIds.suspended = suspended?.id ?? '';
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${tenantIds.suspended}::uuid, ${SUSPENDED_HOST}, true, now())`;

  tokens.demoMember = await signInAs('member@tria-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@tria-lab.local', SEED_PASSWORD);
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  tokens.emptyMember = await throwawayMember(tenantIds.empty, `member@${EMPTY_SLUG}.local`);
  tokens.blockedMember = await throwawayMember(tenantIds.demo, `blocked-${RUN}@tria-demo.local`);
  blockedUserId = throwawayUsers[throwawayUsers.length - 1] ?? '';

  for (const id of [tenantIds.demo, tenantIds.lab, tenantIds.empty]) moduleFlags.invalidate(id);
});

afterAll(async () => {
  const items = [...itemIds.demo, ...itemIds.lab];
  if (items.length > 0) {
    await adminSql`delete from public.example_items where id = any(${items}::uuid[])`;
  }
  for (const userId of throwawayUsers) await authAdmin().deleteUser(userId);
  await adminSql`delete from public.tenants where slug in (${EMPTY_SLUG}, ${SUSPENDED_SLUG})`;
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('TENANT-05 — the two-tenant isolation gate', () => {
  it('a. list: a tria-demo member gets tria-demo ids only, never a tria-lab id', async () => {
    const res = await request('/v1/example/items', tokens.demoMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(res.status).toBe(200);

    const { items } = (await res.json()) as { items: ExampleItem[] };
    const ids = new Set(items.map((i) => i.id));
    for (const id of itemIds.demo) expect(ids.has(id)).toBe(true);
    for (const id of itemIds.lab) expect(ids.has(id)).toBe(false);
    // Adjacency: both tenants have rows with this exact title, so the title proves nothing — the
    // tenant_id of every returned row is what must hold.
    expect(items.filter((i) => i.title === SHARED_TITLE)).toHaveLength(itemIds.demo.length);
    expect(items.every((i) => i.tenantId === tenantIds.demo)).toBe(true);
  });

  it("b. detail: the other tenant's id is 404 NOT_FOUND, never 403", async () => {
    for (const labId of itemIds.lab) {
      const res = await request(`/v1/example/items/${labId}`, tokens.demoMember, {
        [TENANT_HOST_HEADER]: HOSTS.demo,
      });
      // 404, not 403: a 403 would confirm the row exists somewhere.
      expect(res.status).toBe(404);
      expect(await code(res)).toBe('NOT_FOUND');
    }
  });

  it('c. disabled: tria-lab has no example module — read and write are both 404 MODULE_DISABLED', async () => {
    const list = await request('/v1/example/items', tokens.labMember, {
      [TENANT_HOST_HEADER]: HOSTS.lab,
    });
    expect(list.status).toBe(404);
    expect(await code(list)).toBe('MODULE_DISABLED');

    const write = await api.request('/v1/example/items', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.labMember}`,
        'content-type': 'application/json',
        [TENANT_HOST_HEADER]: HOSTS.lab,
      },
      body: JSON.stringify({ title: SHARED_TITLE }),
    });
    // MODULE_DISABLED wins over the role check: "not here" never degrades into "not allowed".
    expect(write.status).toBe(404);
    expect(await code(write)).toBe('MODULE_DISABLED');
  });

  it('d. empty: a tenant with the module enabled and zero rows gets 200 { items: [] }', async () => {
    const res = await request('/v1/example/items', tokens.emptyMember, {
      [TENANT_HOST_HEADER]: EMPTY_HOST,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    // …while the other tenants demonstrably do have rows, so the empty answer is not a global outage.
    const demo = await request('/v1/example/items', tokens.demoMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(((await demo.json()) as { items: ExampleItem[] }).items.length).toBeGreaterThan(0);
  });

  it('e. blocked: a member blocked between two requests is refused on the very next one', async () => {
    const before = await request('/v1/example/items', tokens.blockedMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(before.status).toBe(200);

    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where user_id = ${blockedUserId}::uuid`;

    // Same still-valid token: the membership is re-read per request, so there is no window (AUTH-06).
    const after = await request('/v1/example/items', tokens.blockedMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(after.status).toBe(403);
    expect(await code(after)).toBe('MEMBERSHIP_BLOCKED');
  });

  it('f. the tenant comes from the membership: a cookie and an unknown host cannot change it (D-23)', async () => {
    const res = await request('/v1/me/bootstrap', tokens.demoMember, {
      cookie: 'tenant_slug=tria-lab',
      [TENANT_HOST_HEADER]: 'tria-lab.example',
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as BootstrapBody;
    // The request says tria-lab three ways; the membership says tria-demo. The membership wins.
    expect(body.tenant.slug).toBe('tria-demo');
    expect(body.tenant.id).toBe(tenantIds.demo);
  });

  it("f2. a session of tenant A presented on tenant B's REGISTERED host is 403, on every route (D-23)", async () => {
    for (const path of ['/v1/me/bootstrap', '/v1/example/items']) {
      const res = await request(path, tokens.demoMember, { [TENANT_HOST_HEADER]: HOSTS.lab });
      expect(res.status).toBe(403);

      const text = await res.text();
      const envelope = JSON.parse(text) as Envelope;
      expect(envelope.error.code).toBe('TENANT_HOST_MISMATCH');
      // The refusal must not say which community lives at that address, nor leak a row.
      expect(envelope.error.details).toBeUndefined();
      for (const needle of ['tria-lab', 'TRIA Lab', 'tria-demo', SHARED_TITLE]) {
        expect(text).not.toContain(needle);
      }
      for (const id of itemIds.lab) expect(text).not.toContain(id);
    }

    // Symmetric: the lab member on the demo host is refused the same way.
    const reverse = await request('/v1/me/bootstrap', tokens.labMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(reverse.status).toBe(403);
    expect(await code(reverse)).toBe('TENANT_HOST_MISMATCH');
  });

  it('g. the platform identity is not a member of anything: 403 NO_MEMBERSHIP off a tenant host', async () => {
    const res = await request('/v1/example/items', tokens.superAdmin);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('NO_MEMBERSHIP');
  });

  it('g2. …and on a tenant host it is a host mismatch, not a membership answer (D-23)', async () => {
    const res = await request('/v1/example/items', tokens.superAdmin, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('TENANT_HOST_MISMATCH');
  });

  it('h. bootstrap is scoped to the tenant: tria-lab sees exactly [events, feed]', async () => {
    const res = await request('/v1/me/bootstrap', tokens.labMember, {
      [TENANT_HOST_HEADER]: HOSTS.lab,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BootstrapBody;
    // D-17 pins tria-lab to exactly ['events','feed'] — case (c)'s MODULE_DISABLED depends on it.
    expect(body.modules.map((m) => m.key)).toEqual(['events', 'feed']);
    expect(body.tenant.id).toBe(tenantIds.lab);
  });

  it('i. the public host lookup answers about one tenant only, and never about a suspended one (D-20)', async () => {
    const lab = await api.request(
      `/v1/public/tenants/by-host?host=${encodeURIComponent(HOSTS.lab)}`,
    );
    expect(lab.status).toBe(200);
    const labText = await lab.text();
    expect((JSON.parse(labText) as { slug: string }).slug).toBe('tria-lab');
    // Unauthenticated and pre-login: it may name the tenant on THIS host and nothing else.
    expect(labText).not.toContain('tria-demo');

    const suspended = await api.request(
      `/v1/public/tenants/by-host?host=${encodeURIComponent(SUSPENDED_HOST)}`,
    );
    expect(suspended.status).toBe(404);
    expect(await code(suspended)).toBe('TENANT_NOT_FOUND');
  });
});
