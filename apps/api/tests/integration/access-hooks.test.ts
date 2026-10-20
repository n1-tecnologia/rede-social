import { Writable } from 'node:stream';
import {
  ALLOWLIST_REJECTION_MESSAGE,
  isAllowlistRejection,
  PLATFORM_TERMS_VERSION,
} from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { signupMember } from '@rede-social/core/server/tenancy/signup';
import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  allowEmail,
  api,
  authAdmin,
  createSharedIdentity,
  disallowEmail,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
  signInAs,
  withPaymentsGate,
} from './setup';

/**
 * Quick 261018-owq, retargeted by 09.1-03: the coarse Auth hooks and the per-tenant sign-up gate against
 * REAL GoTrue. Both hooks are enabled on the local stack (`supabase/config.toml`), so what runs here is
 * the production call path:
 *
 *   1-8   the two Postgres hooks, called by GoTrue itself (password, refresh, verifyOtp, invite,
 *         generateLink) through a publishable-key client built like `signInAs`. The refusal cases use
 *         identities with NO membership, so only the access rows decide (the token hook also admits a
 *         live staff membership and a membership in an ungated tenant, proved in `09.1 token hook`).
 *   9-10  the API pre-checks GoTrue's `admin.createUser` makes necessary (it never fires
 *         `before_user_created`): the platform wizard's first admin and the invite send/resend mapping.
 *   09.1  the tracer (a gated tenant refuses sign-up and admits it with an access; an ungated tenant is
 *         untouched) and the token-hook matrix.
 *
 * pgTAP 175 pins the SQL literal and the function facts; this suite compares the contracts constant
 * with GoTrue's real error, so the three stay in lockstep.
 */

const PREFIX = 'owq';
const RUN = crypto.randomUUID().slice(0, 8);
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const THROWAWAY_TENANT_SLUG = `owq-${RUN}`;
const email = (name: string) => `${PREFIX}-${RUN}-${name}@rede-demo.local`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests`);
  return value;
}

const publicClient = () =>
  createClient(required('SUPABASE_URL'), required('SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const decodePayload = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;

const authUsersCount = async (address: string) => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from auth.users where email = ${address}`;
  return row?.n ?? 0;
};

/**
 * A throwaway identity with NO membership, granted a manual access by `createUser`: only the access
 * rows decide what the token hook says about it.
 */
const identity = (name: string) =>
  createSharedIdentity({ prefix: `${PREFIX}-${RUN}-${name}`, memberships: [] });

/** The same, with one membership in the (ungated) seed tenant behind the demo host. */
const memberIdentity = (name: string) =>
  createSharedIdentity({ prefix: `${PREFIX}-${RUN}-${name}`, memberships: [{ host: 'demo' }] });

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

async function dropThrowawayTenants(): Promise<void> {
  await adminSql`
    delete from public.memberships where tenant_id in
      (select id from public.tenants where slug like 'owq-%')`;
  await adminSql`delete from public.tenants where slug like 'owq-%'`;
}

beforeAll(async () => {
  await dropThrowawayTenants();
  await removeIdentitiesByPrefix(PREFIX);
});

afterAll(async () => {
  await dropThrowawayTenants();
  await removeIdentitiesByPrefix(PREFIX);
  await adminSql.end();
  await sqlClient.end();
});

describe('token issuance through real GoTrue (custom_access_token hook)', () => {
  it('1. an identity with access signs in, its token keeps the required claims and the API accepts it', async () => {
    const who = await memberIdentity('listed');
    const { data, error } = await publicClient().auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(error).toBeNull();
    const token = data.session?.access_token ?? '';
    const payload = decodePayload(token);
    for (const claim of ['sub', 'email', 'role', 'aal', 'session_id', 'is_anonymous']) {
      expect(payload, `claim ${claim}`).toHaveProperty(claim);
    }
    const res = await api.request('/v1/me/bootstrap', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('2. after disallowEmail the sign-in is refused with 403 and the sentinel', async () => {
    const who = await identity('gone');
    await disallowEmail(who.email);
    const { data, error } = await publicClient().auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(data.session).toBeNull();
    expect(error?.status).toBe(403);
    expect(error?.message).toBe(ALLOWLIST_REJECTION_MESSAGE);
    expect(isAllowlistRejection(error)).toBe(true);
  });

  it('3. a bloqueado e-mail is refused the same way', async () => {
    const who = await identity('blocked');
    await allowEmail(who.email, 'bloqueado');
    const { error } = await publicClient().auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(error?.status).toBe(403);
    expect(isAllowlistRejection(error)).toBe(true);
  });

  it('4. a padded, mixed-case list row matches the identity created in lowercase', async () => {
    const who = await identity('case');
    await disallowEmail(who.email);
    await allowEmail(`  ${who.email.toUpperCase()} `);
    const { data, error } = await publicClient().auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
  });

  it('5. a refresh is refused once the e-mail turns bloqueado', async () => {
    const who = await identity('refresh');
    const client = publicClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(error).toBeNull();
    await allowEmail(who.email, 'bloqueado');
    const refreshed = await client.auth.refreshSession({
      refresh_token: data.session?.refresh_token ?? '',
    });
    expect(refreshed.data.session).toBeNull();
    expect(refreshed.error?.status).toBe(403);
    expect(isAllowlistRejection(refreshed.error)).toBe(true);
  });

  it('6. a platform_admins identity with no list row still signs in (super_admin exempt)', async () => {
    const who = await identity('super');
    await adminSql`insert into public.platform_admins (user_id) values (${who.userId}::uuid)`;
    await disallowEmail(who.email);
    const { data, error } = await publicClient().auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
  });

  it('7. a refused verifyOtp is rolled back: the SAME recovery hash works once the e-mail is listed', async () => {
    const who = await identity('otp');
    await disallowEmail(who.email);
    const link = await authAdmin().generateLink({ type: 'recovery', email: who.email });
    expect(link.error).toBeNull();
    const hash = link.data.properties?.hashed_token ?? '';
    expect(hash).not.toBe('');

    const refused = await publicClient().auth.verifyOtp({ type: 'recovery', token_hash: hash });
    expect(refused.data.session).toBeNull();
    expect(refused.error?.status).toBe(403);
    expect(isAllowlistRejection(refused.error)).toBe(true);

    await allowEmail(who.email);
    const accepted = await publicClient().auth.verifyOtp({ type: 'recovery', token_hash: hash });
    expect(accepted.error).toBeNull();
    expect(accepted.data.session).not.toBeNull();
  });
});

describe('account creation through GoTrue (before_user_created hook)', () => {
  it('8. inviteUserByEmail and generateLink(signup) for an unlisted address are refused and create nothing', async () => {
    const unlisted = email('invite');
    const invited = await authAdmin().inviteUserByEmail(unlisted);
    expect(invited.error?.status).toBe(403);
    expect(isAllowlistRejection(invited.error)).toBe(true);

    const signup = await authAdmin().generateLink({
      type: 'signup',
      email: unlisted,
      password: SEED_PASSWORD,
    });
    expect(signup.error?.status).toBe(403);
    expect(isAllowlistRejection(signup.error)).toBe(true);
    expect(await authUsersCount(unlisted)).toBe(0);

    await allowEmail(unlisted);
    const accepted = await authAdmin().inviteUserByEmail(unlisted);
    expect(accepted.error).toBeNull();
    expect(accepted.data.user?.email).toBe(unlisted);
    if (accepted.data.user) await authAdmin().deleteUser(accepted.data.user.id);
  });
});

describe('account creation through the API (admin.createUser skips the creation hook)', () => {
  // The sign-up pre-check is proved per tenant in `09.1 tracer`; what stays here is the platform
  // wizard's first admin and the invite mapping, which still ask the compatibility question "does this
  // e-mail have an active access anywhere" until plan 04 retires it.
  it('9. tenant creation: an unlisted first admin is 400 adminEmail=not_allowed and creates no tenant; a listed one (odd case, spaces) is 201', async () => {
    const superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    const create = (slug: string, adminEmail: string) =>
      api.request('/v1/platform/tenants', {
        method: 'POST',
        headers: { authorization: `Bearer ${superAdmin}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Comunidade OWQ',
          slug,
          colors: { primary: '#7c3aed', secondary: '#a78bfa' },
          modules: ['feed'],
          adminEmail,
        }),
      });
    const slug = `${THROWAWAY_TENANT_SLUG}-w`;
    const admin = email('wizard');

    const refused = await create(slug, admin);
    expect(refused.status).toBe(400);
    const { error } = (await refused.json()) as Envelope;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.adminEmail).toBe('not_allowed');
    const [none] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.tenants where slug = ${slug}`;
    expect(none?.n).toBe(0);

    await allowEmail(admin);
    const created = await create(slug, `  ${admin.toUpperCase()} `);
    expect(created.status).toBe(201);
  });

  it('10. invites: an address un-listed after tenant creation is refused on send/resend (403), the invite stays pending, nothing is created; listing it lets the same resend through', async () => {
    const superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    const platform = (path: string, init: { method?: string; body?: unknown } = {}) =>
      api.request(`/v1/platform${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${superAdmin}`,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    const slug = `${THROWAWAY_TENANT_SLUG}-i`;
    const host = `${slug}.localhost`;
    const admin = email('invited');

    await allowEmail(admin);
    const created = await platform('/tenants', {
      method: 'POST',
      body: {
        displayName: 'Convite OWQ',
        slug,
        colors: { primary: '#0e7490', secondary: '#67e8f9' },
        modules: ['feed'],
        adminEmail: admin,
      },
    });
    expect(created.status).toBe(201);
    const detail = (await created.json()) as {
      tenant: { id: string };
      invites: { id: string }[];
    };
    const tenantId = detail.tenant.id;
    const inviteId = detail.invites[0]?.id ?? '';
    await disallowEmail(admin);

    const attached = await platform(`/tenants/${tenantId}/domains`, {
      method: 'POST',
      body: { host },
    });
    expect(attached.status).toBe(201);
    const domain = (await attached.json()) as { id: string };
    const verified = await platform(`/tenants/${tenantId}/domains/${domain.id}/verify`, {
      method: 'POST',
    });
    expect(verified.status).toBe(200);

    const inviteStatus = async () => {
      const [row] = await adminSql<{ status: string }[]>`
        select status from public.tenant_invites where id = ${inviteId}::uuid`;
      return row?.status;
    };
    const resend = () =>
      platform(`/tenants/${tenantId}/invites/${inviteId}/resend`, { method: 'POST' });

    // pending -> sendPendingInvites -> GoTrue inviteUserByEmail refused by before_user_created.
    const refusedPending = await resend();
    expect(refusedPending.status).toBe(403);
    expect(((await refusedPending.json()) as Envelope).error.code).toBe('EMAIL_NOT_ALLOWED');
    expect(await inviteStatus()).toBe('pending');
    expect(await authUsersCount(admin)).toBe(0);

    // sent, no identity -> generateLink(invite) refused by the same hook; the row is left as it was.
    await adminSql`update public.tenant_invites set status = 'sent', sent_at = now() where id = ${inviteId}::uuid`;
    const refusedSent = await resend();
    expect(refusedSent.status).toBe(403);
    expect(((await refusedSent.json()) as Envelope).error.code).toBe('EMAIL_NOT_ALLOWED');
    expect(await inviteStatus()).toBe('sent');
    expect(await authUsersCount(admin)).toBe(0);

    // Listing the address lets the same resend through.
    await allowEmail(admin);
    const ok = await resend();
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe('sent');
    expect(await authUsersCount(admin)).toBe(1);
    const [made] = await adminSql<
      { id: string }[]
    >`select id from auth.users where email = ${admin}`;
    if (made) await authAdmin().deleteUser(made.id);
  });
});

/**
 * 09.1 tracer (PAY-08, PAY-10, D-491, D-493, D-495): the per-tenant sign-up gate through the whole
 * stack. rede-lab is gated with `withPaymentsGate`; rede-demo is the ungated witness. The decision
 * lives in `app.access_effective`; these cases prove the API turns it into ONE sentence.
 */
const TRACER = 'tr91';
const tracerRun = crypto.randomUUID().slice(0, 8);
const tracerEmail = (name: string) => `${TRACER}-${tracerRun}-${name}@rede-demo.local`;
const THROWAWAY_GATED_SLUG = `tr91-${tracerRun}`;

type TenantRow = { id: string; rules_version: number; display_name: string };
const tenantRow = async (slug: string): Promise<TenantRow> => {
  const [row] = await adminSql<TenantRow[]>`
    select id, rules_version, display_name from public.tenants where slug = ${slug}`;
  if (!row) throw new Error(`no tenant ${slug}`);
  return row;
};

/** Writes one access row straight into the table (the harness `allowEmail` only knows rede-demo). */
const grant = async (
  tenantId: string,
  address: string,
  source: 'manual' | 'gateway',
  status: 'active' | 'blocked' | 'inactive',
) => {
  if (source === 'manual') {
    await adminSql`
      insert into public.access_grants (tenant_id, email, source, status)
      values (${tenantId}::uuid, lower(btrim(${address})), 'manual', ${status})
      on conflict (tenant_id, email, status) where source = 'manual' do nothing`;
  } else {
    await adminSql`
      insert into public.access_grants (tenant_id, email, source, status, provider, external_ref)
      values (${tenantId}::uuid, lower(btrim(${address})), 'gateway', ${status}, 'tracer',
              ${`ref-${crypto.randomUUID()}`})`;
  }
};

const effective = async (tenantId: string, address: string): Promise<string> => {
  const [row] = await adminSql<{ state: string }[]>`
    select app.access_effective(${tenantId}::uuid, ${address}) as state`;
  return row?.state ?? '';
};

const signupTo = (slug: string, payload: unknown) =>
  api.request(`/v1/public/signup/${slug}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

describe('09.1 tracer', () => {
  let labTenantId = '';
  let demoTenantId = '';
  let labRulesVersion = 1;
  let labDisplayName = '';

  const labBody = (address: string, overrides: Record<string, unknown> = {}) => ({
    name: 'Maria Teste',
    email: address,
    password: 'Segredo123',
    consents: { tenantRulesVersion: labRulesVersion, platformTermsVersion: PLATFORM_TERMS_VERSION },
    ...overrides,
  });

  beforeAll(async () => {
    const lab = await tenantRow('rede-lab');
    labTenantId = lab.id;
    labRulesVersion = lab.rules_version;
    labDisplayName = lab.display_name;
    demoTenantId = (await tenantRow('rede-demo')).id;
    await removeIdentitiesByPrefix(TRACER);
    await adminSql`delete from public.tenants where slug = ${THROWAWAY_GATED_SLUG}`;
  });

  afterAll(async () => {
    await removeIdentitiesByPrefix(TRACER);
    await adminSql`delete from public.tenants where slug = ${THROWAWAY_GATED_SLUG}`;
  });

  it('a gated tenant refuses an e-mail with no usable access, creates nothing, and admits it once a manual access exists', async () => {
    const address = tracerEmail('gated');
    await withPaymentsGate(labTenantId, async () => {
      const refused = await signupTo('rede-lab', labBody(address));
      expect(refused.status).toBe(403);
      const envelope = (await refused.json()) as Envelope;
      expect(envelope.error.code).toBe('EMAIL_NOT_ALLOWED');
      expect(envelope.error.details).toBeUndefined();
      expect(await authUsersCount(address)).toBe(0);

      await grant(labTenantId, address, 'manual', 'active');
      const created = await signupTo('rede-lab', labBody(address));
      expect(created.status).toBe(201);
      expect(await authUsersCount(address)).toBe(1);
    });
  });

  it('a tenant with the gate off, or no payments row, signs an unlisted e-mail up exactly as before (WR-01)', async () => {
    const noRow = tracerEmail('norow');
    const created = await signupTo('rede-lab', labBody(noRow));
    expect(created.status).toBe(201);

    const gateOff = tracerEmail('gateoff');
    await withPaymentsGate(
      labTenantId,
      async () => {
        const res = await signupTo('rede-lab', labBody(gateOff));
        expect(res.status).toBe(201);
      },
      { gate: false },
    );
  });

  it('P20: no row, a manual block, a gateway inactive row and access only in ANOTHER tenant are the same refusal, naming no community', async () => {
    const none = tracerEmail('p20-none');
    const blocked = tracerEmail('p20-blocked');
    const inactive = tracerEmail('p20-inactive');
    const elsewhere = tracerEmail('p20-elsewhere');
    await grant(labTenantId, blocked, 'manual', 'blocked');
    await grant(labTenantId, inactive, 'gateway', 'inactive');
    await grant(demoTenantId, elsewhere, 'manual', 'active');

    await withPaymentsGate(labTenantId, async () => {
      const bodies: string[] = [];
      for (const address of [none, blocked, inactive, elsewhere]) {
        const res = await signupTo('rede-lab', labBody(address));
        expect(res.status, address).toBe(403);
        // `error.requestId` is per request; the code, the sentence and everything else must be identical.
        const { error } = (await res.json()) as { error: Record<string, unknown> };
        const { requestId: _requestId, ...rest } = error;
        bodies.push(JSON.stringify(rest));
        expect(await authUsersCount(address)).toBe(0);
      }
      expect([...new Set(bodies)]).toHaveLength(1);
      const text = bodies[0] ?? '';
      expect(text).not.toContain('rede-lab');
      expect(text).not.toContain('rede-demo');
      expect(text).not.toContain(labDisplayName);
      expect(JSON.parse(text)).toEqual({
        code: 'EMAIL_NOT_ALLOWED',
        message: 'Seu acesso ainda não foi liberado.',
      });
    });
  });

  it('P20: the signup.not_allowed log line names no e-mail and no community beyond the attempted tenant id', async () => {
    const address = tracerEmail('p20-log');
    const lines: Record<string, unknown>[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        for (const line of String(chunk).split('\n')) if (line) lines.push(JSON.parse(line));
        done();
      },
    });
    const logger = pino({ level: 'info' }, sink);
    await withPaymentsGate(labTenantId, async () => {
      await expect(
        signupMember({
          slug: 'rede-lab',
          body: labBody(address),
          ip: null,
          userAgent: null,
          logger,
        }),
      ).rejects.toMatchObject({ status: 403, code: 'EMAIL_NOT_ALLOWED' });
    });
    const line = lines.find((entry) => entry.event === 'signup.not_allowed');
    expect(line).toBeDefined();
    expect(line?.attemptedTenantId).toBe(labTenantId);
    const raw = JSON.stringify(lines);
    expect(raw).not.toContain(address);
    expect(raw).not.toContain(labDisplayName);
    expect(raw).not.toContain('rede-demo');
  });

  it('P21: a gated tenant with ZERO access rows refuses the same sentence; an empty e-mail never reaches the gate (400)', async () => {
    await adminSql`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${THROWAWAY_GATED_SLUG}, 'Vazia 91', 'Regras de teste.', 1)`;
    const empty = await tenantRow(THROWAWAY_GATED_SLUG);
    await withPaymentsGate(empty.id, async () => {
      const [count] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.access_grants where tenant_id = ${empty.id}::uuid`;
      expect(count?.n).toBe(0);
      const refused = await signupTo(
        THROWAWAY_GATED_SLUG,
        labBody(tracerEmail('p21'), {
          consents: { tenantRulesVersion: 1, platformTermsVersion: PLATFORM_TERMS_VERSION },
        }),
      );
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as Envelope).error.code).toBe('EMAIL_NOT_ALLOWED');

      for (const blank of ['', '   ']) {
        const res = await signupTo(
          THROWAWAY_GATED_SLUG,
          labBody(blank, {
            consents: { tenantRulesVersion: 1, platformTermsVersion: PLATFORM_TERMS_VERSION },
          }),
        );
        expect(res.status, JSON.stringify(blank)).toBe(400);
      }
    });
  });

  it('P22: matching is lower(btrim()) in SQL on both sides; plus-addressing and a non-ASCII lookalike do not match', async () => {
    const stored = tracerEmail('p22');
    await grant(labTenantId, stored, 'manual', 'active');

    expect(await effective(labTenantId, `  ${stored.toUpperCase()} `)).toBe('active');
    expect(await effective(labTenantId, stored.replace('@', '+x@'))).toBe('none');
    // Cyrillic "е" (U+0435) in place of the Latin "e" of "rede".
    expect(await effective(labTenantId, stored.replace('rede', 'r\u0435de'))).toBe('none');

    await withPaymentsGate(labTenantId, async () => {
      const res = await signupTo('rede-lab', labBody(stored.toUpperCase()));
      expect(res.status).toBe(201);
      const plus = await signupTo('rede-lab', labBody(stored.replace('@', '+x@')));
      expect(plus.status).toBe(403);
    });
  });

  it('P23: an existing identity with no access here gets 403 rather than 409, a duplicate WITH access keeps 409', async () => {
    const who = await createSharedIdentity({
      prefix: `${TRACER}-${tracerRun}-dup`,
      memberships: [],
    });
    // createUser granted a manual access in rede-demo only: no access in the gated rede-lab.
    await withPaymentsGate(labTenantId, async () => {
      const refused = await signupTo('rede-lab', labBody(who.email));
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as Envelope).error.code).toBe('EMAIL_NOT_ALLOWED');

      await grant(labTenantId, who.email, 'manual', 'active');
      const duplicate = await signupTo('rede-lab', labBody(who.email));
      expect(duplicate.status).toBe(409);
      expect(((await duplicate.json()) as Envelope).error.code).toBe('EMAIL_ALREADY_REGISTERED');
    });
  });

  it('P23: stale consents (400) and an unknown slug (404) are answered BEFORE the access gate', async () => {
    const address = tracerEmail('order');
    await withPaymentsGate(labTenantId, async () => {
      const stale = await signupTo(
        'rede-lab',
        labBody(address, {
          consents: { tenantRulesVersion: 999_999, platformTermsVersion: PLATFORM_TERMS_VERSION },
        }),
      );
      expect(stale.status).toBe(400);
      const unknown = await signupTo('tr91-no-such-tenant', labBody(address));
      expect(unknown.status).toBe(404);
    });
    expect(await authUsersCount(address)).toBe(0);
  });
});

/**
 * 09.1-03 (D-495, assumptions A-P1 and A-P26): the coarse token hook against real GoTrue. The refusal
 * and the admission are decided by access rows, staff roles and the gate of the tenants the user belongs
 * to. `createSharedIdentity` grants the e-mail a manual access in rede-demo (the harness choke point), so
 * every case that must NOT be admitted by that row calls `disallowEmail` first.
 */
describe('09.1 token hook', () => {
  const HOOK = 'th91';
  const hookRun = crypto.randomUUID().slice(0, 8);
  let labTenantId = '';

  const signIn = (who: { email: string; password: string }) =>
    publicClient().auth.signInWithPassword({ email: who.email, password: who.password });

  const hookIdentity = async (
    name: string,
    memberships: Parameters<typeof createSharedIdentity>[0]['memberships'],
  ) => {
    const who = await createSharedIdentity({ prefix: `${HOOK}-${hookRun}-${name}`, memberships });
    await disallowEmail(who.email);
    return who;
  };

  beforeAll(async () => {
    labTenantId = (await tenantRow('rede-lab')).id;
    await removeIdentitiesByPrefix(HOOK);
  });

  afterAll(async () => {
    await removeIdentitiesByPrefix(HOOK);
  });

  it('A-P1: a member of an UNGATED tenant signs in with no access row at all', async () => {
    const who = await hookIdentity('ungated', [{ host: 'demo' }]);
    const { data, error } = await signIn(who);
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
  });

  it('A-P26: a member of a GATED tenant with no access row and no staff role is refused at token issuance, and admitted again when the gate is off', async () => {
    const who = await hookIdentity('gated', [{ host: 'lab' }]);
    await withPaymentsGate(labTenantId, async () => {
      const { data, error } = await signIn(who);
      expect(data.session).toBeNull();
      expect(error?.status).toBe(403);
      expect(isAllowlistRejection(error)).toBe(true);
    });
    const { error } = await signIn(who);
    expect(error).toBeNull();
  });

  it('a staff member of a gated tenant signs in with no access row', async () => {
    const who = await hookIdentity('staff', [{ host: 'lab', role: 'admin_tenant' }]);
    await withPaymentsGate(labTenantId, async () => {
      const { error } = await signIn(who);
      expect(error).toBeNull();
    });
  });

  it('a mixed-membership identity signs in when ANY tenant qualifies (a gated member plus an ungated member)', async () => {
    const who = await hookIdentity('mixed', [{ host: 'lab' }, { host: 'demo' }]);
    await withPaymentsGate(labTenantId, async () => {
      const { error } = await signIn(who);
      expect(error).toBeNull();
    });
  });

  it('a gated member cut in their only tenant but with ACTIVE access in another tenant keeps the session', async () => {
    const who = await hookIdentity('elsewhere', [{ host: 'lab' }]);
    await allowEmail(who.email);
    await withPaymentsGate(labTenantId, async () => {
      const { error } = await signIn(who);
      expect(error).toBeNull();
    });
  });
});
