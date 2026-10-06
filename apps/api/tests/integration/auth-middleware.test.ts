import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TENANT_CHOICE_HEADER, TENANT_HOST_HEADER } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { generateKeyPair, importJWK, type JWK, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  authAdmin,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
  signInAs,
} from './setup';

/**
 * AUTH-06 + TENANT-01 contract of `requireAuth`, proven against the live local stack:
 * verify -> host -> the membership the host selects (per request, never cached) -> suspended ->
 * blocked -> invited scope (08.1, D-307).
 *
 * The order matters and is asserted: on a tenant host the ONLY membership considered is the one in
 * the host's tenant, so a member blocked in rede-demo who opens rede-lab's host (where they hold no
 * membership) gets `TENANT_HOST_MISMATCH` with no details — never their rede-demo block (D-304), never
 * anything about either tenant. The shared-identity cases (m1-m5) pin role, block and suspension per
 * membership and the generic-host choice rule (D-308).
 */

type Envelope = { error: { code: string; message: string; details?: { tenantName?: string } } };

const PASSWORD = 'Segredo123';
const stamp = Date.now();
const MEMBER = `e2e-auth-${stamp}@rede-demo.local`;
const SUSPENDED_MEMBER = `e2e-auth-susp-${stamp}@suspended.local`;
const SUSPENDED_SLUG = `e2e-susp-${stamp}`.slice(0, 40);

/** 08.1: the shared-identity cases (m1-m5) build throwaway identities with this e-mail prefix. */
const SHARED_PREFIX = 'am';
const SHARED_SUSPENDED_SLUG = `am-susp-${stamp}`.slice(0, 40);
const SHARED_SUSPENDED_HOST = `${SHARED_SUSPENDED_SLUG}.localhost`;
const SHARED_SUSPENDED_NAME = 'Comunidade Suspensa AM';

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
  await removeIdentitiesByPrefix(SHARED_PREFIX);

  memberId = await createMember(MEMBER, 'rede-demo');
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
  await removeIdentitiesByPrefix(SHARED_PREFIX);
  await adminSql`delete from public.tenants where slug in (${SUSPENDED_SLUG}, ${SHARED_SUSPENDED_SLUG})`;
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
    expect(body.error.details?.tenantName).toBe('Rede Demo');
    // Only the member's own tenant may appear anywhere in the body (D-09 prohibition).
    expect(JSON.stringify(body)).not.toContain('Rede Lab');
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

  it('h. D-307 host first: while blocked in rede-demo, rede-lab’s host (no membership there) yields TENANT_HOST_MISMATCH with no details', async () => {
    const res = await bootstrap(memberToken, { [TENANT_HOST_HEADER]: HOSTS.lab });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('TENANT_HOST_MISMATCH');
    expect(body.error).not.toHaveProperty('details');
    // The rede-demo block never reaches rede-lab's host (D-304), and no tenant is named.
    for (const name of ['Rede Demo', 'Rede Lab']) expect(JSON.stringify(body)).not.toContain(name);
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
    expect(JSON.stringify(body)).not.toContain('Rede Social');
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
      expect(body.error.details?.tenantName).toBe('Rede Demo');
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

/**
 * 08.1 (V2-PLAT-07, D-304, D-307, D-308): ONE identity S holding several memberships. The host
 * selects which one a request runs as, and role, block and suspension are read from that membership
 * only. Throwaway identities (`createSharedIdentity`), never seed users.
 */
describe('requireAuth — one identity, several memberships (08.1)', () => {
  /** S: `member` in rede-demo, `admin_tenant` in rede-lab. */
  let shared = { userId: '', email: '', password: '' };
  let sharedToken = '';

  const as = (path: string, headers: Record<string, string> = {}) =>
    api.request(path, { headers: { authorization: `Bearer ${sharedToken}`, ...headers } });
  const demoRow = () => adminSql`
    select m.id from public.memberships m
      join public.tenant_domains d on d.tenant_id = m.tenant_id
     where d.host = ${HOSTS.demo} and m.user_id = ${shared.userId}::uuid`;

  beforeAll(async () => {
    shared = await createSharedIdentity({
      prefix: SHARED_PREFIX,
      memberships: [{ host: 'demo' }, { host: 'lab', role: 'admin_tenant' }],
    });
    sharedToken = await signInAs(shared.email, shared.password);
  });

  it('m1. role per host: an admin-only route answers 403 on rede-demo (member) and 200 on rede-lab (admin_tenant)', async () => {
    const onDemo = await as('/v1/admin/moderation-log', { [TENANT_HOST_HEADER]: HOSTS.demo });
    expect(onDemo.status).toBe(403);
    expect(((await onDemo.json()) as Envelope).error.code).toBe('FORBIDDEN');

    const onLab = await as('/v1/admin/moderation-log', { [TENANT_HOST_HEADER]: HOSTS.lab });
    expect(onLab.status).toBe(200);

    const demoBoot = await as('/v1/me/bootstrap', { [TENANT_HOST_HEADER]: HOSTS.demo });
    const labBoot = await as('/v1/me/bootstrap', { [TENANT_HOST_HEADER]: HOSTS.lab });
    expect(((await demoBoot.json()) as { membership: { role: string } }).membership.role).toBe(
      'member',
    );
    expect(((await labBoot.json()) as { membership: { role: string } }).membership.role).toBe(
      'admin_tenant',
    );
  });

  it('m2. D-304: blocked in rede-demo only -> MEMBERSHIP_BLOCKED { Rede Demo } on rede-demo, 200 on rede-lab', async () => {
    await adminSql`
      update public.memberships set blocked_at = now()
       where id in (${demoRow()}) and user_id = ${shared.userId}::uuid`;
    try {
      const onDemo = await as('/v1/me/bootstrap', { [TENANT_HOST_HEADER]: HOSTS.demo });
      expect(onDemo.status).toBe(403);
      const body = (await onDemo.json()) as Envelope;
      expect(body.error.code).toBe('MEMBERSHIP_BLOCKED');
      expect(body.error.details?.tenantName).toBe('Rede Demo');
      expect(JSON.stringify(body)).not.toContain('Rede Lab');

      const onLab = await as('/v1/me/bootstrap', { [TENANT_HOST_HEADER]: HOSTS.lab });
      expect(onLab.status).toBe(200);
      expect(await onLab.text()).not.toContain('Rede Demo');
    } finally {
      await adminSql`
        update public.memberships set blocked_at = null
         where id in (${demoRow()}) and user_id = ${shared.userId}::uuid`;
    }
    expect((await as('/v1/me/bootstrap', { [TENANT_HOST_HEADER]: HOSTS.demo })).status).toBe(200);
  });

  it('m3. D-304: a suspended third community answers TENANT_SUSPENDED on its own host only; rede-lab stays 200 and never names it', async () => {
    const [tenant] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${SHARED_SUSPENDED_SLUG}, ${SHARED_SUSPENDED_NAME}, 'Regras de teste.', 1)
      returning id`;
    const tenantId = tenant?.id ?? '';
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${tenantId}::uuid, ${SHARED_SUSPENDED_HOST}, true, now())`;
    await adminSql`
      insert into public.memberships (tenant_id, user_id, role, status)
      values (${tenantId}::uuid, ${shared.userId}::uuid, 'member', 'active')`;

    expect(
      (await as('/v1/me/bootstrap', { [TENANT_HOST_HEADER]: SHARED_SUSPENDED_HOST })).status,
    ).toBe(200);
    await adminSql`update public.tenants set status = 'suspended' where id = ${tenantId}::uuid`;

    const onSuspended = await as('/v1/me/bootstrap', {
      [TENANT_HOST_HEADER]: SHARED_SUSPENDED_HOST,
    });
    expect(onSuspended.status).toBe(403);
    const body = (await onSuspended.json()) as Envelope;
    expect(body.error.code).toBe('TENANT_SUSPENDED');
    expect(body.error.details?.tenantName).toBe(SHARED_SUSPENDED_NAME);

    for (const host of [HOSTS.lab, HOSTS.demo]) {
      const ok = await as('/v1/me/bootstrap', { [TENANT_HOST_HEADER]: host });
      expect(ok.status).toBe(200);
      const text = await ok.text();
      expect(text).not.toContain(SHARED_SUSPENDED_NAME);
      expect(text).not.toContain(SHARED_SUSPENDED_SLUG);
    }
    // Refusals on the other hosts name nothing of it either: a 404 on rede-lab, a 403 on rede-demo.
    const missing = await as(`/v1/events/${crypto.randomUUID()}`, {
      [TENANT_HOST_HEADER]: HOSTS.lab,
    });
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain(SHARED_SUSPENDED_NAME);
    const refused = await as('/v1/admin/moderation-log', { [TENANT_HOST_HEADER]: HOSTS.demo });
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain(SHARED_SUSPENDED_NAME);
  });

  it("m4. D-308 generic host: several memberships need a valid x-tenant-choice among the caller's own; tenant hosts ignore it", async () => {
    const expectChoiceRequired = async (res: Response) => {
      expect(res.status).toBe(403);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('TENANT_CHOICE_REQUIRED');
      expect(body.error).not.toHaveProperty('details');
    };

    await expectChoiceRequired(await as('/v1/me/bootstrap', { [TENANT_HOST_HEADER]: 'localhost' }));
    await expectChoiceRequired(await as('/v1/me/bootstrap'));

    const chosen = await as('/v1/me/bootstrap', {
      [TENANT_HOST_HEADER]: 'localhost',
      [TENANT_CHOICE_HEADER]: 'rede-lab',
    });
    expect(chosen.status).toBe(200);
    expect(((await chosen.json()) as { tenant: { slug: string } }).tenant.slug).toBe('rede-lab');

    // A real community S does not belong to is ignored, never an error that names it.
    await expectChoiceRequired(
      await as('/v1/me/bootstrap', {
        [TENANT_HOST_HEADER]: 'localhost',
        [TENANT_CHOICE_HEADER]: SUSPENDED_SLUG,
      }),
    );
    // Whitespace is absent.
    await expectChoiceRequired(
      await as('/v1/me/bootstrap', {
        [TENANT_HOST_HEADER]: 'localhost',
        [TENANT_CHOICE_HEADER]: '   ',
      }),
    );

    // On a TENANT host the header is ignored: rede-demo's host answers the rede-demo membership.
    const onDemo = await as('/v1/me/bootstrap', {
      [TENANT_HOST_HEADER]: HOSTS.demo,
      [TENANT_CHOICE_HEADER]: 'rede-lab',
    });
    expect(onDemo.status).toBe(200);
    const demoBody = (await onDemo.json()) as {
      tenant: { slug: string };
      membership: { role: string };
    };
    expect(demoBody.tenant.slug).toBe('rede-demo');
    expect(demoBody.membership.role).toBe('member');
  });

  it('m5. D-06 generic host without a choice: one membership enters, none is NO_MEMBERSHIP, one open among blocked enters, all blocked is MEMBERSHIP_BLOCKED without details', async () => {
    const boot = async (memberships: Parameters<typeof createSharedIdentity>[0]['memberships']) => {
      const identity = await createSharedIdentity({ prefix: SHARED_PREFIX, memberships });
      const token = await signInAs(identity.email, identity.password);
      return api.request('/v1/me/bootstrap', {
        headers: { authorization: `Bearer ${token}`, [TENANT_HOST_HEADER]: 'localhost' },
      });
    };

    const single = await boot([{ host: 'lab' }]);
    expect(single.status).toBe(200);
    expect(((await single.json()) as { tenant: { slug: string } }).tenant.slug).toBe('rede-lab');

    const none = await boot([]);
    expect(none.status).toBe(403);
    expect(((await none.json()) as Envelope).error.code).toBe('NO_MEMBERSHIP');

    const oneOpen = await boot([{ host: 'demo', status: 'blocked' }, { host: 'lab' }]);
    expect(oneOpen.status).toBe(200);
    expect(((await oneOpen.json()) as { tenant: { slug: string } }).tenant.slug).toBe('rede-lab');

    const allBlocked = await boot([
      { host: 'demo', status: 'blocked' },
      { host: 'lab', status: 'blocked' },
    ]);
    expect(allBlocked.status).toBe(403);
    const blockedBody = (await allBlocked.json()) as Envelope;
    expect(blockedBody.error.code).toBe('MEMBERSHIP_BLOCKED');
    expect(blockedBody.error).not.toHaveProperty('details');
  });
});
