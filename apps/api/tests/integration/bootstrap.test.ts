import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bootstrapSchema, hostTenantSchema } from '@tria/contracts';
import { db, sqlClient } from '@tria/core/db';
import { withTenantTx } from '@tria/core/db/tenant-tx';
import { sql } from 'drizzle-orm';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

type Envelope = { error: { code: string; message: string; details?: unknown; requestId: string } };
type Loose = { user: { id: string }; tenant: { id: string; slug: string } };

const MEMBER = 'member@tria-demo.local';
let token = '';
let memberCtx = { userId: '', tenantId: '', role: 'member' as const };

const bootstrap = (headers: Record<string, string> = {}) =>
  api.request('/v1/me/bootstrap', { headers: { authorization: `Bearer ${token}`, ...headers } });

beforeAll(async () => {
  token = await signInAs(MEMBER, SEED_PASSWORD);
  const res = await bootstrap();
  const body = (await res.json()) as Loose;
  memberCtx = { userId: body.user.id, tenantId: body.tenant.id, role: 'member' };
});

afterAll(async () => {
  await adminSql`delete from public.tenants where slug = 'tria-demo-twin'`;
  await adminSql.end();
  await sqlClient.end();
});

describe('GET /v1/me/bootstrap — tracer: real GoTrue token -> JWKS -> membership -> RLS lane', () => {
  it('1. seeded member gets their tenant and role through the tenant lane', async () => {
    const res = await bootstrap();
    expect(res.status).toBe(200);
    const body = bootstrapSchema.parse(await res.json());
    expect(body.tenant.slug).toBe('tria-demo');
    expect(body.membership.role).toBe('member');
    expect(body.membership.status).toBe('active');
    expect(body.user.email).toBe(MEMBER);
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
    await adminSql`insert into public.tenants (slug, display_name) values ('tria-demo-twin', 'TRIA Demo')
                   on conflict (slug) do nothing`;
    const res = await bootstrap();
    expect(res.status).toBe(200);
    expect(((await res.json()) as Loose).tenant.slug).toBe('tria-demo');
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
    for (const needle of ['tria-lab', 'TRIA Lab', 'tria-demo', 'TRIA Demo']) {
      expect(text).not.toContain(needle);
    }
  });

  it('8. D-23 match: own host (any case, with port) -> 200', async () => {
    const plain = await bootstrap({ 'x-tenant-host': HOSTS.demo });
    expect(plain.status).toBe(200);
    expect(((await plain.json()) as Loose).tenant.slug).toBe('tria-demo');
    const shouty = await bootstrap({ 'X-TENANT-HOST': `${HOSTS.demo.toUpperCase()}:3000` });
    expect(shouty.status).toBe(200);
    expect(((await shouty.json()) as Loose).tenant.slug).toBe('tria-demo');
  });

  it('9. D-21 generic host: an unregistered host can deny, never select data -> 200 with the membership tenant', async () => {
    const res = await bootstrap({ 'x-tenant-host': 'preview.example' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Loose).tenant.slug).toBe('tria-demo');
  });
});

describe('TENANT-01 — the membership is the tenant of record; cookie and Host never select data', () => {
  const NO_MEMBERSHIP_EMAIL = 'no-membership@tria-test.local';
  let orphanId: string | null = null;

  afterAll(async () => {
    if (orphanId) {
      await authAdmin().deleteUser(orphanId);
      await adminSql`delete from public.users where id = ${orphanId}::uuid`;
    }
  });

  it('12. adjacency: tenant_slug cookie, Host and X-Forwarded-Host of another tenant are ignored (D-23)', async () => {
    const spoofed = {
      cookie: 'tenant_slug=tria-lab',
      host: 'tria-lab.example',
      'x-forwarded-host': 'tria-lab.example',
    };
    const res = await bootstrap(spoofed);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Loose).tenant.slug).toBe('tria-demo');

    // An UNREGISTERED x-tenant-host is a generic host: the membership wins (D-21). The registered-host
    // denial (x-tenant-host = tria-lab's real host -> 403 TENANT_HOST_MISMATCH) is case 7 above.
    const generic = await bootstrap({ ...spoofed, 'x-tenant-host': 'tria-lab.example' });
    expect(generic.status).toBe(200);
    expect(((await generic.json()) as Loose).tenant.slug).toBe('tria-demo');
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

  it('14. ordering: app.membership_for_user resolves deterministically (order by joined_at limit 1)', async () => {
    const rows = await adminSql<{ def: string }[]>`
      select pg_get_functiondef('app.membership_for_user(uuid)'::regprocedure) as def`;
    const def = rows[0]?.def.toLowerCase() ?? '';
    expect(def).toContain('order by m.joined_at');
    expect(def).toContain('limit 1');
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
    expect(body).toMatchObject({ slug: 'tria-demo', displayName: 'TRIA Demo' });

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
      where t.slug in ('tria-demo', 'tria-lab') group by t.slug order by t.slug`;
    expect(primaries.map((r) => [r.slug, r.primaries])).toEqual([
      ['tria-demo', 1],
      ['tria-lab', 1],
    ]);
  });
});
