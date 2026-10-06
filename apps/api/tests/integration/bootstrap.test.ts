import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bootstrapSchema, countersSchema, hostTenantSchema } from '@rede-social/contracts';
import { db, sqlClient } from '@rede-social/core/db';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import { sql } from 'drizzle-orm';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODULE_REGISTRY } from '../../src/modules/registry';
import {
  adminSql,
  api,
  authAdmin,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  runNotificationJobs,
  SEED_PASSWORD,
  signInAs,
} from './setup';

type Envelope = { error: { code: string; message: string; details?: unknown; requestId: string } };
type Loose = { user: { id: string }; tenant: { id: string; slug: string } };

const MEMBER = 'member@rede-demo.local';
/** 08.1: throwaway shared identities of tests 14/14b/18 (`createSharedIdentity`), never seed users. */
const SHARED_PREFIX = 'bs';
let token = '';
let memberCtx = { userId: '', tenantId: '', role: 'member' as const };

const bootstrap = (headers: Record<string, string> = {}) =>
  api.request('/v1/me/bootstrap', { headers: { authorization: `Bearer ${token}`, ...headers } });

beforeAll(async () => {
  await removeIdentitiesByPrefix(SHARED_PREFIX);
  token = await signInAs(MEMBER, SEED_PASSWORD);
  const res = await bootstrap();
  const body = (await res.json()) as Loose;
  memberCtx = { userId: body.user.id, tenantId: body.tenant.id, role: 'member' };
});

afterAll(async () => {
  await removeIdentitiesByPrefix(SHARED_PREFIX);
  await adminSql`delete from public.tenants where slug = 'rede-demo-twin'`;
  await adminSql.end();
  await sqlClient.end();
});

describe('GET /v1/me/bootstrap — tracer: real GoTrue token -> JWKS -> membership -> RLS lane', () => {
  it('1. seeded member gets their tenant and role through the tenant lane', async () => {
    const res = await bootstrap();
    expect(res.status).toBe(200);
    const body = bootstrapSchema.parse(await res.json());
    expect(body.tenant.slug).toBe('rede-demo');
    expect(body.membership.role).toBe('member');
    expect(body.membership.status).toBe('active');
    expect(body.user.email).toBe(MEMBER);
  });

  it('1a. Phase 6: the bootstrap carries tenants.timezone, and follows it when it changes (06-01)', async () => {
    // Every events string on the web is formatted in THIS zone (UI-D-203), so the value must be the
    // column itself, read through the same tenant lane — not a constant the API assumes.
    const first = bootstrapSchema.parse(await (await bootstrap()).json());
    expect(first.tenant.timezone).toBe('America/Sao_Paulo');

    try {
      await adminSql`update public.tenants set timezone = 'America/Manaus' where slug = 'rede-demo'`;
      const second = bootstrapSchema.parse(await (await bootstrap()).json());
      expect(second.tenant.timezone).toBe('America/Manaus');
    } finally {
      await adminSql`update public.tenants set timezone = 'America/Sao_Paulo' where slug = 'rede-demo'`;
    }
  });

  it('1b. PROF-01 filled `membership.profile` WITHOUT growing it (Pitfall 9)', async () => {
    const res = await bootstrap();
    const body = bootstrapSchema.parse(await res.json());
    // The sub-shape is frozen: the profile became real in 03-02, and the nudge state and
    // `avatarAssetId` deliberately live on `GET /v1/me/profile` rather than here, so a cached
    // bootstrap payload never has to be invalidated by a new profile fact.
    expect(Object.keys(body.membership.profile).sort()).toEqual([
      'avatarUrl',
      'bio',
      'displayName',
    ]);
    // Fed from `member_profiles`, not from `users.name`: the row the membership trigger created.
    const [row] = await adminSql<{ display_name: string }[]>`
      select p.display_name from public.member_profiles p
       where p.user_id = ${memberCtx.userId}::uuid and p.tenant_id = ${memberCtx.tenantId}::uuid`;
    expect(body.membership.profile.displayName).toBe(row?.display_name);
  });

  it('2. no token -> 401 UNAUTHENTICATED with the envelope', async () => {
    const res = await api.request('/v1/me/bootstrap');
    expect(res.status).toBe(401);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(typeof body.error.requestId).toBe('string');
  });

  it('3. token signed by another ES256 key -> 401 INVALID_TOKEN', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const jwk = await exportJWK(publicKey);
    const forged = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: jwk.kid ?? 'forged' })
      .setSubject(memberCtx.userId)
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const res = await api.request('/v1/me/bootstrap', {
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Envelope).error.code).toBe('INVALID_TOKEN');
  });

  it('4. TENANT-03 adjacency: an identical display_name in another tenant never merges rows', async () => {
    await adminSql`insert into public.tenants (slug, display_name) values ('rede-demo-twin', 'Rede Demo')
                   on conflict (slug) do nothing`;
    const res = await bootstrap();
    expect(res.status).toBe(200);
    expect(((await res.json()) as Loose).tenant.slug).toBe('rede-demo');
    const count = await withTenantTx(memberCtx, async (tx) => {
      const rows = await tx.execute<{ n: string }>(sql`select count(*)::text as n from tenants`);
      return Number(rows[0]?.n);
    });
    expect(count).toBe(1);
  });

  it('5. TENANT-03 empty: claims without tenant_id see zero rows, never an error', async () => {
    for (const claims of ['{}', JSON.stringify({ sub: memberCtx.userId, role: 'authenticated' })]) {
      const counts = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
        await tx.execute(sql`set local role authenticated`);
        const t = await tx.execute<{ n: string }>(sql`select count(*)::text as n from tenants`);
        const m = await tx.execute<{ n: string }>(sql`select count(*)::text as n from memberships`);
        return [Number(t[0]?.n), Number(m[0]?.n)];
      });
      expect(counts).toEqual([0, 0]);
    }
  });

  it('6. NOINHERIT: api_user outside any lane cannot read tenant tables (42501)', async () => {
    // drizzle-orm 0.45 wraps the driver error in DrizzleQueryError; the SQLSTATE lives on `cause`.
    await expect(db.execute(sql`select count(*) from memberships`)).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });

  it('7. D-23 mismatch: x-tenant-host of another tenant -> 403 TENANT_HOST_MISMATCH naming no tenant', async () => {
    const res = await bootstrap({ 'x-tenant-host': HOSTS.lab });
    expect(res.status).toBe(403);
    const text = await res.text();
    const body = JSON.parse(text) as Envelope;
    expect(body.error.code).toBe('TENANT_HOST_MISMATCH');
    expect(body.error.details).toBeUndefined();
    for (const needle of ['rede-lab', 'Rede Lab', 'rede-demo', 'Rede Demo']) {
      expect(text).not.toContain(needle);
    }
  });

  it('8. D-23 match: own host (any case, with port) -> 200', async () => {
    const plain = await bootstrap({ 'x-tenant-host': HOSTS.demo });
    expect(plain.status).toBe(200);
    expect(((await plain.json()) as Loose).tenant.slug).toBe('rede-demo');
    const shouty = await bootstrap({ 'X-TENANT-HOST': `${HOSTS.demo.toUpperCase()}:3000` });
    expect(shouty.status).toBe(200);
    expect(((await shouty.json()) as Loose).tenant.slug).toBe('rede-demo');
  });

  it('9. D-21 generic host: an unregistered host can deny, never select data -> 200 with the membership tenant', async () => {
    const res = await bootstrap({ 'x-tenant-host': 'preview.example' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Loose).tenant.slug).toBe('rede-demo');
  });
});

describe('TENANT-01 — the membership is the tenant of record; cookie and Host never select data', () => {
  const NO_MEMBERSHIP_EMAIL = 'no-membership@rede-social-test.local';
  let orphanId: string | null = null;

  afterAll(async () => {
    if (orphanId) {
      await authAdmin().deleteUser(orphanId);
      await adminSql`delete from public.users where id = ${orphanId}::uuid`;
    }
  });

  it('12. adjacency: tenant_slug cookie, Host and X-Forwarded-Host of another tenant are ignored (D-23)', async () => {
    const spoofed = {
      cookie: 'tenant_slug=rede-lab',
      host: 'rede-lab.example',
      'x-forwarded-host': 'rede-lab.example',
    };
    const res = await bootstrap(spoofed);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Loose).tenant.slug).toBe('rede-demo');

    // An UNREGISTERED x-tenant-host is a generic host: the membership wins (D-21). The registered-host
    // denial (x-tenant-host = rede-lab's real host -> 403 TENANT_HOST_MISMATCH) is case 7 above.
    const generic = await bootstrap({ ...spoofed, 'x-tenant-host': 'rede-lab.example' });
    expect(generic.status).toBe(200);
    expect(((await generic.json()) as Loose).tenant.slug).toBe('rede-demo');
  });

  it('13. empty: a valid token without a membership row gets 403 NO_MEMBERSHIP, never an empty tenant', async () => {
    const password = `Orphan-${SEED_PASSWORD}`;
    const { data, error } = await authAdmin().createUser({
      email: NO_MEMBERSHIP_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { name: 'Sem Comunidade' },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    orphanId = data.user.id;

    const orphanToken = await signInAs(NO_MEMBERSHIP_EMAIL, password);
    const res = await api.request('/v1/me/bootstrap', {
      headers: { authorization: `Bearer ${orphanToken}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('NO_MEMBERSHIP');
    expect(body).not.toHaveProperty('tenant');
  });

  it('14. D-307: the host selects the membership, joined_at is irrelevant', async () => {
    // The lab membership is the OLDER one: "the oldest membership" would answer rede-lab everywhere.
    const shared = await createSharedIdentity({
      prefix: SHARED_PREFIX,
      memberships: [{ host: 'demo' }, { host: 'lab' }],
    });
    await adminSql`
      update public.memberships m set joined_at = now() - interval '30 days'
        from public.tenant_domains d
       where d.tenant_id = m.tenant_id and d.host = ${HOSTS.lab}
         and m.user_id = ${shared.userId}::uuid`;
    const sharedToken = await signInAs(shared.email, shared.password);
    const on = async (host: string) =>
      bootstrapSchema.parse(
        await (
          await api.request('/v1/me/bootstrap', {
            headers: { authorization: `Bearer ${sharedToken}`, 'x-tenant-host': host },
          })
        ).json(),
      );
    expect((await on(HOSTS.demo)).tenant.slug).toBe('rede-demo');
    expect((await on(HOSTS.lab)).tenant.slug).toBe('rede-lab');
  });

  it("14b. D-309: the bootstrap carries only the host's membership", async () => {
    const shared = await createSharedIdentity({
      prefix: SHARED_PREFIX,
      memberships: [{ host: 'demo' }, { host: 'lab', role: 'admin_tenant' }],
    });
    const sharedToken = await signInAs(shared.email, shared.password);
    const [lab] = await adminSql<{ id: string; slug: string; display_name: string }[]>`
      select id::text as id, slug, display_name from public.tenants where slug = 'rede-lab'`;
    const [demo] = await adminSql<{ id: string; slug: string; display_name: string }[]>`
      select id::text as id, slug, display_name from public.tenants where slug = 'rede-demo'`;
    const read = async (host: string) => {
      const res = await api.request('/v1/me/bootstrap', {
        headers: { authorization: `Bearer ${sharedToken}`, 'x-tenant-host': host },
      });
      expect(res.status).toBe(200);
      const raw = await res.text();
      // The identity's own e-mail is the fixture's (`…@rede-demo.local`): cut it before the byte check.
      return {
        body: bootstrapSchema.parse(JSON.parse(raw)),
        bytes: raw.replaceAll(shared.email, ''),
      };
    };

    const onDemo = await read(HOSTS.demo);
    expect(onDemo.body.membership.role).toBe('member');
    for (const secret of [lab?.id, lab?.slug, lab?.display_name]) {
      expect(secret).toBeTruthy();
      expect(onDemo.bytes).not.toContain(secret as string);
    }
    const onLab = await read(HOSTS.lab);
    expect(onLab.body.membership.role).toBe('admin_tenant');
    for (const secret of [demo?.id, demo?.slug, demo?.display_name]) {
      expect(secret).toBeTruthy();
      expect(onLab.bytes).not.toContain(secret as string);
    }
  });

  // Numbered 18: 15-17 already belong to the counters describe below.
  it("18. D-310: `user.name` is the host membership's profile name, never the global one", async () => {
    const shared = await createSharedIdentity({
      prefix: SHARED_PREFIX,
      memberships: [
        { host: 'demo', displayName: 'Bia na Demo' },
        { host: 'lab', displayName: 'Bia no Lab' },
      ],
    });
    // A global name that differs from both profiles: if the bootstrap still read `users`, it shows.
    await adminSql`update public.users set name = 'Nome Global' where id = ${shared.userId}::uuid`;
    const sharedToken = await signInAs(shared.email, shared.password);
    const on = async (host: string) => {
      const res = await api.request('/v1/me/bootstrap', {
        headers: { authorization: `Bearer ${sharedToken}`, 'x-tenant-host': host },
      });
      expect(res.status).toBe(200);
      return bootstrapSchema.parse(await res.json());
    };

    const onDemo = await on(HOSTS.demo);
    expect(onDemo.user.name).toBe('Bia na Demo');
    expect(onDemo.membership.profile.displayName).toBe('Bia na Demo');
    const onLab = await on(HOSTS.lab);
    expect(onLab.user.name).toBe('Bia no Lab');
    expect(onLab.membership.profile.displayName).toBe('Bia no Lab');
  });
});

describe('GET /v1/public/tenants/by-host — D-20 public lookup', () => {
  it('10. resolves the seeded host (normalised), 404 for unknown, 400 without host', async () => {
    const ok = await api.request(
      `/v1/public/tenants/by-host?host=${encodeURIComponent(HOSTS.demo)}`,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const body = hostTenantSchema.strict().parse(await ok.json());
    // Brand/host facts since 02-01 (exact key set pinned in hosts.test.ts).
    expect(body).toMatchObject({ slug: 'rede-demo', displayName: 'Rede Demo' });

    const shouty = await api.request(
      `/v1/public/tenants/by-host?host=${encodeURIComponent(`${HOSTS.demo.toUpperCase()}:3000`)}`,
    );
    expect(shouty.status).toBe(200);
    expect(await shouty.json()).toEqual(body);

    const unknown = await api.request('/v1/public/tenants/by-host?host=nope.example');
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as Envelope).error.code).toBe('TENANT_NOT_FOUND');

    const missing = await api.request('/v1/public/tenants/by-host');
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('scripts/seed.ts — D-24 idempotency', () => {
  it('11. a second run exits 0 and leaves tenant_domains unchanged with one primary per tenant', async () => {
    const before = await adminSql`select count(*)::int as n from public.tenant_domains`;
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const tsx = fileURLToPath(new URL('../../../../node_modules/.bin/tsx', import.meta.url));
    execFileSync(tsx, ['scripts/seed.ts'], {
      cwd: repoRoot,
      env: { ...process.env, SEED_PASSWORD },
      stdio: 'pipe',
    });
    const after = await adminSql`select count(*)::int as n from public.tenant_domains`;
    expect(after[0]?.n).toBe(before[0]?.n);
    expect(after[0]?.n).toBe(2);
    const primaries = await adminSql`
      select t.slug, count(*) filter (where d.is_primary)::int as primaries
      from public.tenants t join public.tenant_domains d on d.tenant_id = t.id
      where t.slug in ('rede-demo', 'rede-lab') group by t.slug order by t.slug`;
    expect(primaries.map((r) => [r.slug, r.primaries])).toEqual([
      ['rede-demo', 1],
      ['rede-lab', 1],
    ]);
  });
});

describe('GET /v1/me/counters — the live refetch answers exactly the bootstrap counters (07-03)', () => {
  const CAPTION = 'Contadores de teste 07-03';

  const sweep = async () => {
    await adminSql`delete from public.notifications
                    where tenant_id = ${memberCtx.tenantId}::uuid`;
    await adminSql`delete from public.feed_posts where caption like ${`${CAPTION}%`}`;
    await adminSql`update pgboss.job_common set state = 'completed', completed_on = now()
                    where name = 'notifications.fanout' and state = 'created'`;
  };

  it('15. after one fan-out, /v1/me/counters equals the bootstrap counters for the same member', async () => {
    await sweep();
    try {
      const adminToken = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
      const created = await api.request('/v1/feed/posts', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
          'x-tenant-host': HOSTS.demo,
        },
        body: JSON.stringify({ caption: `${CAPTION} um` }),
      });
      expect(created.status).toBe(201);
      expect(await runNotificationJobs(memberCtx.tenantId)).toBe(1);

      const boot = bootstrapSchema.parse(await (await bootstrap()).json());
      const res = await api.request('/v1/me/counters', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body: unknown = await res.json();
      // Exactly the contract's keys: the refetch can never carry more than the bootstrap does.
      expect(Object.keys(body as object).sort()).toEqual([
        'conversationsBadge',
        'unreadConversations',
        'unreadNotifications',
      ]);
      const counters = countersSchema.parse(body);
      expect(counters).toEqual(boot.counters);
      expect(counters.unreadNotifications).toBe(1);

      // No token, no counters.
      expect((await api.request('/v1/me/counters')).status).toBe(401);
    } finally {
      await sweep();
    }
  });

  it("16. 07-08 (D-237, D-238): conversationsBadge is the member's dot and the staff count", async () => {
    const badgeOf = async (email: string) => {
      const res = await api.request('/v1/me/bootstrap', {
        headers: { authorization: `Bearer ${await signInAs(email, SEED_PASSWORD)}` },
      });
      expect(res.status).toBe(200);
      return bootstrapSchema.parse(await res.json()).counters.conversationsBadge;
    };
    expect(await badgeOf(MEMBER)).toBe('dot');
    expect(await badgeOf('support@rede-demo.local')).toBe('count');
    expect(await badgeOf('admin@rede-demo.local')).toBe('count');
    // rede-lab has chat OFF: no chat contribution, the kernel default stands.
    expect(await badgeOf('member@rede-lab.local')).toBe('count');
  });

  it('17. 07 review A-WR-02: one failing counter contributor reads zero, the bootstrap still answers', async () => {
    const chat = MODULE_REGISTRY.chat as { counters?: unknown } | undefined;
    const original = chat?.counters;
    expect(original).toBeTypeOf('function');
    // A statement error ABORTS a Postgres transaction: without a savepoint per contributor, every
    // later statement of the bootstrap transaction would fail too.
    (chat as { counters: unknown }).counters = async (tx: Tx) => {
      await tx.execute(sql`select 1 / 0`);
      return {};
    };
    try {
      const res = await bootstrap();
      expect(res.status).toBe(200);
      const body = bootstrapSchema.parse(await res.json());
      expect(body.counters.unreadConversations).toBe(0);
      expect(body.counters.conversationsBadge).toBe('count');
      const live = await api.request('/v1/me/counters', {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(live.status).toBe(200);
    } finally {
      (chat as { counters: unknown }).counters = original;
    }
    // Positive control: restored, the chat contributor answers the member's dot again.
    const restored = bootstrapSchema.parse(await (await bootstrap()).json());
    expect(restored.counters.conversationsBadge).toBe('dot');
  });
});
