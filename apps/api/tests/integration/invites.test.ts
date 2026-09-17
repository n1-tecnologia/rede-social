import { createClient } from '@supabase/supabase-js';
import {
  acceptInviteResponseSchema,
  platformTenantDetailSchema,
  TRIA_TERMS_VERSION,
} from '@tria/contracts';
import { sqlClient } from '@tria/core/db';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * ROLE-03 / D-29 / D-30 — the first-admin invite lifecycle against the live local stack.
 *
 * Part 1 (tracer, plan 02-10 Task 1): an invited admin's Bearer bootstraps with
 * `membership.status = 'invited'`, `POST /v1/me/accept-invite` flips the membership, records BOTH
 * consent rows (ip/user-agent from the trusted headers, `accepted_at` from the DB clock) and marks
 * the invite accepted; the platform detail then lists the admin. The invited identity is created
 * WITHOUT GoTrue mail (admin `createUser` + the same rows `sendPendingInvites` leaves behind), so the
 * accept path is testable without an OTP.
 *
 * Part 2 (Task 2): idempotent + concurrent accepts, stale consents, cross-tenant host, the invited
 * scope, list/resend routes (409s, 404s, 403), the superseded token.
 *
 * Every tenant carries a unique `inv-…` slug, every identity a `…@invite.test` address, and
 * `cleanup()` runs before AND after the suite (memberships have no cascade from tenants).
 */

const RUN = Date.now().toString(36);
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'ferramentas@triacompany.com.br';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const MAILPIT_URL = (process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324').replace(/\/$/, '');
const INVITED_PASSWORD = 'Convite-Segredo-123';

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

let superAdmin = '';
const createdDomainIds: string[] = [];

const platform = (
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  api.request(`/v1/platform${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${superAdmin}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

/** A tenant-lane request with the invited admin's Bearer and its own host. */
const lane = (
  token: string,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  api.request(path, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

const acceptBody = (rulesVersion = 1) => ({ rulesVersion, termsVersion: TRIA_TERMS_VERSION });

async function tenantDetail(id: string) {
  const res = await platform(`/tenants/${id}`);
  expect(res.status).toBe(200);
  return platformTenantDetailSchema.parse(await res.json());
}

async function createTenantViaApi(
  slug: string,
  adminEmail: string,
  displayName = `Convite ${slug}`,
  colors = { primary: '#0e7490', secondary: '#67e8f9' },
): Promise<{ id: string; inviteId: string }> {
  const res = await platform('/tenants', {
    method: 'POST',
    body: { displayName, slug, colors, modules: ['feed'], adminEmail },
  });
  if (res.status !== 201) throw new Error(`tenant create failed: ${res.status}`);
  const body = platformTenantDetailSchema.parse(await res.json());
  const inviteId = body.invites[0]?.id;
  if (!inviteId) throw new Error('no pending invite on the created tenant');
  return { id: body.tenant.id, inviteId };
}

/** The `public.users` mirror is written by a trigger; wait for it before inserting a membership. */
async function waitForMirror(id: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = await adminSql`select id from public.users where id = ${id}::uuid`;
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`public.users row missing for ${id}`);
}

type Invited = {
  tenantId: string;
  inviteId: string;
  host: string;
  email: string;
  userId: string;
  token: string;
};

/**
 * A tenant created through the API with a VERIFIED primary host inserted directly, plus the
 * invited identity in the exact state `sendPendingInvites` leaves behind (confirmed auth user,
 * `invited` admin_tenant membership, invite `sent` with `user_id`) — but WITHOUT the GoTrue mail,
 * so the accept flow can be driven with a password session instead of an OTP.
 */
async function throwawayInvited(tag: string): Promise<Invited> {
  const slug = `inv-${tag}-${RUN}`.slice(0, 40);
  const host = `${slug}.cliente.test`;
  const email = `admin+${tag}-${RUN}@invite.test`;
  const { id: tenantId, inviteId } = await createTenantViaApi(slug, email);

  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
    values (${tenantId}::uuid, ${host}, true, now(), 'verified')`;

  const { data, error } = await authAdmin().createUser({
    email,
    password: INVITED_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  const userId = data.user.id;
  await waitForMirror(userId);

  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantId}::uuid, ${userId}::uuid, 'admin_tenant', 'invited')`;
  await adminSql`
    update public.tenant_invites set status = 'sent', sent_at = now(), user_id = ${userId}::uuid
     where id = ${inviteId}::uuid`;

  const token = await signInAs(email, INVITED_PASSWORD);
  return { tenantId, inviteId, host, email, userId, token };
}

/** Removes every `inv-…` tenant, its memberships/consents and the throwaway auth users. */
async function cleanup(): Promise<void> {
  await adminSql`
    delete from public.consent_records where tenant_id in
      (select id from public.tenants where slug like 'inv-%')`;
  await adminSql`
    delete from public.memberships where tenant_id in
      (select id from public.tenants where slug like 'inv-%')`;
  await adminSql`delete from public.tenants where slug like 'inv-%'`;
  await adminSql`delete from auth.users where lower(email) like '%@invite.test'`;
  if (createdDomainIds.length > 0) {
    await adminSql`
      delete from pgboss.job_common
       where name = 'kernel.domain-verify' and singleton_key in ${adminSql(createdDomainIds)}`;
  }
}

beforeAll(async () => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await cleanup();
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
});

afterAll(async () => {
  await cleanup();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer — the first admin accepts the invite (ROLE-03, D-29, D-03)', () => {
  let invited: Invited;
  const startedAt = new Date();

  beforeAll(async () => {
    invited = await throwawayInvited('tracer');
  });

  it('1. the invited Bearer bootstraps: 200 with membership.status invited and role admin_tenant', async () => {
    const res = await lane(invited.token, '/v1/me/bootstrap', {
      headers: { 'x-tenant-host': invited.host },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { membership: { status: string; role: string } };
    expect(body.membership.status).toBe('invited');
    expect(body.membership.role).toBe('admin_tenant');
  });

  it('2. POST /v1/me/accept-invite flips the membership, records both consents (ip + user-agent, DB clock) and marks the invite accepted', async () => {
    const [tenant] = await adminSql<{ rules_version: number }[]>`
      select rules_version from public.tenants where id = ${invited.tenantId}::uuid`;
    const res = await lane(invited.token, '/v1/me/accept-invite', {
      method: 'POST',
      body: acceptBody(tenant?.rules_version ?? 1),
      headers: {
        'x-tenant-host': invited.host,
        'X-Client-IP': '203.0.113.9',
        'User-Agent': 'vitest',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = acceptInviteResponseSchema.parse(await res.json());
    expect(body.landing).toBe('/inicio');
    expect(body.tenantSlug).toMatch(/^inv-tracer-/);

    const [membership] = await adminSql<{ status: string; joined_at: string | null }[]>`
      select status, joined_at from public.memberships
       where tenant_id = ${invited.tenantId}::uuid and user_id = ${invited.userId}::uuid`;
    expect(membership?.status).toBe('active');
    expect(new Date(membership?.joined_at ?? 0).getTime()).toBeGreaterThanOrEqual(
      startedAt.getTime() - 1000,
    );

    const consents = await adminSql<
      { kind: string; text_version: number; ip: string | null; user_agent: string | null }[]
    >`
      select kind, text_version, host(ip) as ip, user_agent from public.consent_records
       where tenant_id = ${invited.tenantId}::uuid and user_id = ${invited.userId}::uuid
       order by kind`;
    expect(consents).toHaveLength(2);
    expect(consents.map((c) => c.kind)).toEqual(['tenant_rules', 'tria_terms']);
    expect(consents[0]?.text_version).toBe(tenant?.rules_version ?? 1);
    expect(consents[1]?.text_version).toBe(TRIA_TERMS_VERSION);
    for (const c of consents) {
      expect(c.ip).toBe('203.0.113.9');
      expect(c.user_agent).toBe('vitest');
    }

    const [invite] = await adminSql<
      { status: string; accepted_at: string | null; user_id: string | null }[]
    >`select status, accepted_at, user_id from public.tenant_invites where id = ${invited.inviteId}::uuid`;
    expect(invite?.status).toBe('accepted');
    expect(invite?.accepted_at).not.toBeNull();
    expect(invite?.user_id).toBe(invited.userId);
  });

  it('3. the bootstrap now says active and the platform detail lists the admin with the invite accepted', async () => {
    const res = await lane(invited.token, '/v1/me/bootstrap', {
      headers: { 'x-tenant-host': invited.host },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { membership: { status: string } }).membership.status).toBe(
      'active',
    );

    const detail = await tenantDetail(invited.tenantId);
    expect(detail.admins[0]?.email).toBe(invited.email);
    expect(detail.invites[0]?.status).toBe('accepted');
    expect(detail.invites[0]?.acceptedAt).not.toBeNull();
  });

  it('4. no Bearer -> 401 UNAUTHENTICATED', async () => {
    const res = await api.request('/v1/me/accept-invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(acceptBody()),
    });
    expect(res.status).toBe(401);
    expect((await envelope(res)).code).toBe('UNAUTHENTICATED');
  });
});

// Keep the imports the Task 2 describes need referenced so the tracer file lints standalone.
void createClient;
void HOSTS;
void MAILPIT_URL;
void createdDomainIds;
