import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TENANT_HOST_HEADER } from '@tria/contracts';
import { sqlClient } from '@tria/core/db';
import { generateKeyPair, importJWK, type JWK, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * AUTH-06 + TENANT-01 contract of `requireAuth`, proven against the live local stack:
 * verify -> membership (per request, never cached) -> blocked -> host.
 *
 * The order matters and is asserted: a blocked member on the wrong host gets `MEMBERSHIP_BLOCKED`
 * (their own tenant's name is theirs to see), never `TENANT_HOST_MISMATCH` (which would tell them
 * something about the host's tenant).
 */

type Envelope = { error: { code: string; message: string; details?: { tenantName?: string } } };

const PASSWORD = 'Segredo123';
const stamp = Date.now();
const MEMBER = `e2e-auth-${stamp}@tria-demo.local`;
const SUSPENDED_MEMBER = `e2e-auth-susp-${stamp}@suspended.local`;
const SUSPENDED_SLUG = `e2e-susp-${stamp}`.slice(0, 40);

let memberToken = '';
let memberId = '';
let suspendedToken = '';
let suspendedUserId = '';

const bootstrap = (token: string, headers: Record<string, string> = {}) =>
  api.request('/v1/me/bootstrap', { headers: { authorization: `Bearer ${token}`, ...headers } });

const setStatus = (email: string, status: string) => adminSql`
  update public.memberships m set status = ${status}
    from public.users u where u.id = m.user_id and u.email = ${email}`;

/** Lifecycle columns (WR-08): set/clear `blocked_at` or `deleted_at` WITHOUT touching `status`. */
const setLifecycle = (email: string, column: 'blocked_at' | 'deleted_at', on: boolean) => adminSql`
  update public.memberships m set ${adminSql(column)} = ${on ? new Date() : null}
    from public.users u where u.id = m.user_id and u.email = ${email}`;

/** Creates a confirmed identity plus an active membership in `slug`; returns the user id. */
async function createMember(email: string, slug: string): Promise<string> {
  const { data, error } = await authAdmin().createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    select t.id, ${data.user.id}::uuid, 'member', 'active'
      from public.tenants t where t.slug = ${slug}`;
  return data.user.id;
}

/**
 * The local ES256 private key GoTrue signs with (`supabase/signing_keys.json`, git-ignored; CI
 * generates it with `supabase gen signing-key` before `supabase start`). Needed to mint a token that
 * is correctly SIGNED but expired — the only way to prove `exp` is what rejects it, rather than the
 * signature.
 */
async function localSigningKey(): Promise<{
  key: Awaited<ReturnType<typeof importJWK>>;
  kid: string;
}> {
  const path = fileURLToPath(new URL('../../../../supabase/signing_keys.json', import.meta.url));
  if (!existsSync(path)) {
    throw new Error(
      `supabase/signing_keys.json not found at ${path}. Run \`supabase gen signing-key --algorithm ES256 -o json > supabase/signing_keys.json\` before the local stack.`,
    );
  }
  const keys = JSON.parse(readFileSync(path, 'utf8')) as JWK[];
  const jwk = keys[0];
  if (!jwk?.kid) throw new Error('supabase/signing_keys.json has no key with a kid');
  // Supabase writes `key_ops: ["sign","verify"]`, which WebCrypto rejects for an ECDSA PRIVATE key
  // ("Unsupported key usage for a ECDSA key"): a private EC key may only sign.
  return { key: await importJWK({ ...jwk, key_ops: ['sign'] }, 'ES256'), kid: jwk.kid };
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  memberId = await createMember(MEMBER, 'tria-demo');
  memberToken = await signInAs(MEMBER, PASSWORD);

  // A tenant of its own, so flipping `tenants.status` cannot disturb the seeded tenants.
  await adminSql`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${SUSPENDED_SLUG}, 'Comunidade Suspensa', 'Regras de teste.', 1)
    on conflict (slug) do nothing`;
  suspendedUserId = await createMember(SUSPENDED_MEMBER, SUSPENDED_SLUG);
  suspendedToken = await signInAs(SUSPENDED_MEMBER, PASSWORD);
});

afterAll(async () => {
  for (const id of [memberId, suspendedUserId]) {
    if (id) await authAdmin().deleteUser(id);
  }
  await adminSql`delete from public.tenants where slug = ${SUSPENDED_SLUG}`;
  await adminSql.end();
  await sqlClient.end();
});

describe('requireAuth — AUTH-06 blocking, TENANT-01 host, token rejection', () => {
  it('a. the same still-valid token is refused on the request right after the block', async () => {
    expect((await bootstrap(memberToken)).status).toBe(200);

    await setStatus(MEMBER, 'blocked');

    const res = await bootstrap(memberToken);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('MEMBERSHIP_BLOCKED');
    expect(body.error.details?.tenantName).toBe('TRIA Demo');
    // Only the member's own tenant may appear anywhere in the body (D-09 prohibition).
    expect(JSON.stringify(body)).not.toContain('TRIA Lab');
    expect(JSON.stringify(body)).not.toContain('Comunidade Suspensa');

    await setStatus(MEMBER, 'active');
  });

  it('b. a request already in flight may finish either way; the NEXT one is always refused', async () => {
    const inFlight = bootstrap(memberToken);
    await setStatus(MEMBER, 'blocked');
    const raced = await inFlight;
    // Both outcomes are correct — the block either landed before or after that read.
    expect([200, 403]).toContain(raced.status);

    const after = await bootstrap(memberToken);
    expect(after.status).toBe(403);
    expect(((await after.json()) as Envelope).error.code).toBe('MEMBERSHIP_BLOCKED');
  });

  it('h. while blocked, another tenant’s host still yields MEMBERSHIP_BLOCKED (order: blocked before host)', async () => {
    const res = await bootstrap(memberToken, { [TENANT_HOST_HEADER]: HOSTS.lab });
    expect(res.status).toBe(403);
    expect(((await res.json()) as Envelope).error.code).toBe('MEMBERSHIP_BLOCKED');
  });

  it('g. unblocking is equally immediate: the next request is 200 again', async () => {
    await setStatus(MEMBER, 'active');
    expect((await bootstrap(memberToken)).status).toBe(200);
  });

  it('h2. once unblocked, the same host header yields TENANT_HOST_MISMATCH with no details (D-23)', async () => {
    const res = await bootstrap(memberToken, { [TENANT_HOST_HEADER]: HOSTS.lab });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('TENANT_HOST_MISMATCH');
    expect(body.error).not.toHaveProperty('details');
    expect(JSON.stringify(body)).not.toContain('TRIA');
  });

  it('c. a member of a SUSPENDED tenant gets TENANT_SUSPENDED (D-32), distinct from a blocked member', async () => {
    expect((await bootstrap(suspendedToken)).status).toBe(200);

    await adminSql`update public.tenants set status = 'suspended' where slug = ${SUSPENDED_SLUG}`;
    const res = await bootstrap(suspendedToken);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('TENANT_SUSPENDED');
    expect(body.error.message).toBe('Esta comunidade está temporariamente indisponível.');
    expect(body.error.details?.tenantName).toBe('Comunidade Suspensa');

    await adminSql`update public.tenants set status = 'active' where slug = ${SUSPENDED_SLUG}`;
    expect((await bootstrap(suspendedToken)).status).toBe(200);
  });

  it('c1. a BLOCKED member of a SUSPENDED tenant gets TENANT_SUSPENDED (order: tenant before member)', async () => {
    await adminSql`update public.tenants set status = 'suspended' where slug = ${SUSPENDED_SLUG}`;
    await setStatus(SUSPENDED_MEMBER, 'blocked');
    const res = await bootstrap(suspendedToken);
    expect(res.status).toBe(403);
    expect(((await res.json()) as Envelope).error.code).toBe('TENANT_SUSPENDED');

    await setStatus(SUSPENDED_MEMBER, 'active');
    await adminSql`update public.tenants set status = 'active' where slug = ${SUSPENDED_SLUG}`;
    expect((await bootstrap(suspendedToken)).status).toBe(200);
  });

  it('c3. an INVITED membership on an active tenant still passes requireAuth (D-29 accept-invite runs in the lane)', async () => {
    await setStatus(MEMBER, 'invited');
    const res = await bootstrap(memberToken);
    expect(res.status).toBe(200);
    await setStatus(MEMBER, 'active');
  });

  it('c4. invited scope (02-10, T-02-122): the same INVITED Bearer on any other tenant-lane route -> 403 MEMBERSHIP_INVITED naming the tenant', async () => {
    await setStatus(MEMBER, 'invited');
    try {
      const res = await api.request('/v1/feed', {
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('MEMBERSHIP_INVITED');
      expect(body.error.details?.tenantName).toBe('TRIA Demo');
      // The two onboarding routes stay reachable: bootstrap (above) and accept-invite (its own
      // handler answers — here a 400 for the empty body, never the 403 of the scope rule).
      const accept = await api.request('/v1/me/accept-invite', {
        method: 'POST',
        headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(accept.status).toBe(400);
    } finally {
      await setStatus(MEMBER, 'active');
    }
  });

  it('c5. invited scope: the host check wins — an INVITED Bearer on another tenant’s host -> TENANT_HOST_MISMATCH (order: host before invited scope)', async () => {
    await setStatus(MEMBER, 'invited');
    try {
      const res = await api.request('/v1/feed', {
        headers: { authorization: `Bearer ${memberToken}`, [TENANT_HOST_HEADER]: HOSTS.lab },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('TENANT_HOST_MISMATCH');
      expect(body.error.details).toBeUndefined();
    } finally {
      await setStatus(MEMBER, 'active');
    }
    // An ACTIVE member on the same route is untouched by the scope rule — the positive control
    // (T-03-56) without which the 403 above could be a globally broken route.
    const active = await api.request('/v1/feed', {
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(active.status).toBe(200);
  });

  it('c2. WR-08: blocked_at set with status still active -> MEMBERSHIP_BLOCKED on the next request', async () => {
    expect((await bootstrap(memberToken)).status).toBe(200);
    await setLifecycle(MEMBER, 'blocked_at', true);

    const res = await bootstrap(memberToken);
    expect(res.status).toBe(403);
    expect(((await res.json()) as Envelope).error.code).toBe('MEMBERSHIP_BLOCKED');

    await setLifecycle(MEMBER, 'blocked_at', false);
    expect((await bootstrap(memberToken)).status).toBe(200);
  });

  it('c3. WR-08: deleted_at set (soft delete) -> NO_MEMBERSHIP, as if the row were gone', async () => {
    await setLifecycle(MEMBER, 'deleted_at', true);

    const res = await bootstrap(memberToken);
    expect(res.status).toBe(403);
    expect(((await res.json()) as Envelope).error.code).toBe('NO_MEMBERSHIP');

    await setLifecycle(MEMBER, 'deleted_at', false);
    expect((await bootstrap(memberToken)).status).toBe(200);
  });

  it('d. an EXPIRED token signed by the real local key -> 401 INVALID_TOKEN', async () => {
    const { key, kid } = await localSigningKey();
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setSubject(memberId)
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt(now - 3600)
      .setExpirationTime(now - 60)
      .sign(key);

    const res = await bootstrap(expired);
    expect(res.status).toBe(401);
    expect(((await res.json()) as Envelope).error.code).toBe('INVALID_TOKEN');
  });

  it('d2. the SAME claims with a future `exp` are accepted — so (d) really tested expiry', async () => {
    const { key, kid } = await localSigningKey();
    const now = Math.floor(Date.now() / 1000);
    const fresh = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setSubject(memberId)
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(key);

    expect((await bootstrap(fresh)).status).toBe(200);
  });

  it('e. a token signed by a FORGED ES256 key -> 401 INVALID_TOKEN', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const forged = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'forged' })
      .setSubject(memberId)
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    const res = await bootstrap(forged);
    expect(res.status).toBe(401);
    expect(((await res.json()) as Envelope).error.code).toBe('INVALID_TOKEN');
  });

  it('f. an HS256 token is refused against the EC JWKS -> 401 INVALID_TOKEN', async () => {
    const secret = new TextEncoder().encode('a'.repeat(48));
    const { kid } = await localSigningKey();
    const hs256 = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256', kid })
      .setSubject(memberId)
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(secret);

    const res = await bootstrap(hs256);
    expect(res.status).toBe(401);
    expect(((await res.json()) as Envelope).error.code).toBe('INVALID_TOKEN');
  });
});
