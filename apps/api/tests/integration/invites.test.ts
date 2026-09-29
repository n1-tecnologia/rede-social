import * as contracts from '@rede-social/contracts';
import {
  acceptInviteResponseSchema,
  apiErrorEnvelopeSchema,
  ERROR_CODES,
  PLATFORM_TERMS_VERSION,
  platformTenantDetailSchema,
  tenantInviteSchema,
} from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { isOneTenantPerUserViolation } from '@rede-social/core/server/platform/invites';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
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
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
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

const acceptBody = (rulesVersion = 1) => ({ rulesVersion, termsVersion: PLATFORM_TERMS_VERSION });

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
    // `order by kind`: alphabetical, so platform_terms sorts first. Assert by kind, never by index.
    expect(consents.map((c) => c.kind)).toEqual(['platform_terms', 'tenant_rules']);
    expect(consents.find((c) => c.kind === 'tenant_rules')?.text_version).toBe(
      tenant?.rules_version ?? 1,
    );
    expect(consents.find((c) => c.kind === 'platform_terms')?.text_version).toBe(
      PLATFORM_TERMS_VERSION,
    );
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

// ---------------------------------------------------------------------------------------------
// Part 2 (Task 2): the lifecycle — idempotency, concurrency, stale consents, cross-tenant host, the
// invited scope, list/resend, 409s/404s/403, the superseded token.
// ---------------------------------------------------------------------------------------------

type MailpitMessage = {
  ID: string;
  Subject: string;
  From: { Name: string; Address: string };
  HTML: string;
  Text: string;
};

/** Every Mailpit message for `to`, newest first (search + per-message fetch). */
async function mailpitMessages(to: string): Promise<MailpitMessage[]> {
  const list = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=20`,
  );
  if (!list.ok) return [];
  const { messages } = (await list.json()) as { messages?: Array<{ ID: string }> };
  const out: MailpitMessage[] = [];
  for (const m of messages ?? []) {
    const full = await fetch(`${MAILPIT_URL}/api/v1/message/${m.ID}`);
    if (full.ok) out.push((await full.json()) as MailpitMessage);
  }
  return out;
}

async function waitForMailCount(to: string, count: number, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last: MailpitMessage[] = [];
  while (Date.now() < deadline) {
    last = await mailpitMessages(to);
    if (last.length >= count) return last;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`expected ${count} mail(s) for ${to}, found ${last.length}`);
}

/** The `token_hash` of the first `/auth/confirm` href in an HTML body (`&amp;` unescaped). */
function extractTokenHash(html: string): string {
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = (match[1] ?? '').replace(/&amp;/g, '&');
    if (!href.includes('/auth/confirm')) continue;
    const value = new URL(href).searchParams.get('token_hash');
    if (value) return value;
  }
  throw new Error('no token_hash in the mail');
}

async function waitForInviteStatus(tenantId: string, status: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const detail = await tenantDetail(tenantId);
    last = detail.invites[0]?.status ?? '';
    if (last === status) return detail;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`invite of ${tenantId} never reached ${status} (last: ${last})`);
}

const consentCount = async (tenantId: string, userId: string) => {
  const [row] = await adminSql<{ count: number }[]>`
    select count(*)::int as count from public.consent_records
     where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid`;
  return row?.count ?? 0;
};

const membershipStatus = async (tenantId: string, userId: string) => {
  const [row] = await adminSql<{ status: string }[]>`
    select status from public.memberships
     where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid and deleted_at is null`;
  return row?.status ?? null;
};

const accept = (invited: Invited, body: unknown = acceptBody(), host = invited.host) =>
  lane(invited.token, '/v1/me/accept-invite', {
    method: 'POST',
    body,
    headers: { 'x-tenant-host': host, 'X-Client-IP': '203.0.113.9', 'User-Agent': 'vitest' },
  });

describe('contracts (02-10 Task 2)', () => {
  it('ERROR_CODES carries MEMBERSHIP_INVITED + INVITE_STATE_INVALID; the envelope accepts both; the platform schemas exist', () => {
    expect(ERROR_CODES).toContain('MEMBERSHIP_INVITED');
    expect(ERROR_CODES).toContain('INVITE_STATE_INVALID');
    for (const code of ['MEMBERSHIP_INVITED', 'INVITE_STATE_INVALID']) {
      expect(
        apiErrorEnvelopeSchema.safeParse({ error: { code, message: 'x', requestId: 'r' } }).success,
      ).toBe(true);
    }
    const c = contracts as unknown as Record<string, z.ZodTypeAny | readonly string[] | undefined>;
    expect(c.INVITE_STATE_REASONS).toEqual([
      'already_accepted',
      'no_verified_primary',
      'not_invited',
      'email_in_use',
      'user_in_other_tenant',
    ]);
    const params = c.inviteParamsSchema as z.ZodTypeAny | undefined;
    const list = c.tenantInvitesListSchema as z.ZodTypeAny | undefined;
    expect(params).toBeDefined();
    expect(list).toBeDefined();
    const id = '11111111-1111-4111-8111-111111111111';
    expect(params?.safeParse({ id, inviteId: id }).success).toBe(true);
    expect(params?.safeParse({ id, inviteId: 'nope' }).success).toBe(false);
    expect(list?.safeParse({ invites: [] }).success).toBe(true);
  });
});

describe('accept-invite edges — idempotent, concurrent, stale, cross-tenant (ROLE-03 ledger)', () => {
  it('5. accepting twice answers 200 both times; ONE active membership and exactly TWO consent rows remain', async () => {
    const invited = await throwawayInvited('idem');
    expect((await accept(invited)).status).toBe(200);
    expect((await accept(invited)).status).toBe(200);
    expect(await consentCount(invited.tenantId, invited.userId)).toBe(2);
    const rows = await adminSql<{ status: string }[]>`
      select status from public.memberships
       where tenant_id = ${invited.tenantId}::uuid and user_id = ${invited.userId}::uuid`;
    expect(rows).toEqual([{ status: 'active' }]);
  });

  it('6. two concurrent accepts both settle 200; the row lock serialises them: two consent rows, one accepted_at', async () => {
    const invited = await throwawayInvited('race');
    const [a, b] = await Promise.all([accept(invited), accept(invited)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await consentCount(invited.tenantId, invited.userId)).toBe(2);
    const [row] = await adminSql<{ n: number }[]>`
      select count(distinct accepted_at)::int as n from public.tenant_invites
       where id = ${invited.inviteId}::uuid`;
    expect(row?.n).toBe(1);
    expect(await membershipStatus(invited.tenantId, invited.userId)).toBe('active');
  });

  it('7. a stale rulesVersion -> 400 VALIDATION_FAILED { consents: "stale" }; nothing written', async () => {
    const invited = await throwawayInvited('stale');
    const res = await accept(invited, { rulesVersion: 2, termsVersion: PLATFORM_TERMS_VERSION });
    expect(res.status).toBe(400);
    const err = await envelope(res);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.consents).toBe('stale');
    expect(await membershipStatus(invited.tenantId, invited.userId)).toBe('invited');
    expect(await consentCount(invited.tenantId, invited.userId)).toBe(0);
    const [invite] = await adminSql<{ status: string }[]>`
      select status from public.tenant_invites where id = ${invited.inviteId}::uuid`;
    expect(invite?.status).toBe('sent');
  });

  it('8. cross-tenant host -> 403 TENANT_HOST_MISMATCH and nothing changes; an ACTIVE seed member replays as a no-op 200', async () => {
    const invited = await throwawayInvited('xhost');
    const res = await accept(invited, acceptBody(), HOSTS.lab);
    expect(res.status).toBe(403);
    expect((await envelope(res)).code).toBe('TENANT_HOST_MISMATCH');
    expect(await membershipStatus(invited.tenantId, invited.userId)).toBe('invited');
    expect(await consentCount(invited.tenantId, invited.userId)).toBe(0);

    const memberToken = await signInAs('member@rede-demo.local', SEED_PASSWORD);
    const [member] = await adminSql<{ tenant_id: string; user_id: string }[]>`
      select m.tenant_id, m.user_id from public.memberships m
        join public.users u on u.id = m.user_id where u.email = 'member@rede-demo.local' limit 1`;
    if (!member) throw new Error('seed member missing');
    const before = await consentCount(member.tenant_id, member.user_id);
    const replay = await lane(memberToken, '/v1/me/accept-invite', {
      method: 'POST',
      body: acceptBody(),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(replay.status).toBe(200);
    expect(await consentCount(member.tenant_id, member.user_id)).toBe(before);
  });
});

describe('resend lifecycle — list, resend, supersession, 409/404/403 (D-30)', () => {
  const tag = 'resend';
  const slug = `inv-${tag}-${RUN}`.slice(0, 40);
  // `*.localhost:3000` is in GoTrue's local `additional_redirect_urls`; a `.cliente.test` host
  // would make GoTrue drop `redirectTo` and mail a neutral link without `/auth/confirm`.
  const host = `${slug}.localhost`;
  const adminEmail = `admin+${tag}-${RUN}@invite.test`;
  const displayName = 'Associação São José';
  const primary = '#b45309';
  let tenantId = '';
  let inviteId = '';
  let firstTokenHash = '';
  let secondTokenHash = '';

  beforeAll(async () => {
    const created = await createTenantViaApi(slug, adminEmail, displayName, {
      primary,
      secondary: '#f59e0b',
    });
    tenantId = created.id;
    inviteId = created.inviteId;
    const attached = await platform(`/tenants/${tenantId}/domains`, {
      method: 'POST',
      body: { host },
    });
    if (attached.status !== 201) throw new Error(`attach failed: ${attached.status}`);
    const domain = (await attached.json()) as { id: string };
    createdDomainIds.push(domain.id);
    const verified = await platform(`/tenants/${tenantId}/domains/${domain.id}/verify`, {
      method: 'POST',
    });
    if (verified.status !== 200) throw new Error(`verify failed: ${verified.status}`);
    await waitForInviteStatus(tenantId, 'sent');
  });

  it('9. the first (GoTrue) mail is in Mailpit; POST …/resend answers the fresh sent row and a SECOND branded mail arrives; GET …/invites lists one row', async () => {
    const [first] = await waitForMailCount(adminEmail, 1);
    expect(first?.HTML).toContain('type=invite');
    firstTokenHash = extractTokenHash(first?.HTML ?? '');
    const before = (await tenantDetail(tenantId)).invites[0];
    expect(before?.status).toBe('sent');
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await platform(`/tenants/${tenantId}/invites/${inviteId}/resend`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const row = tenantInviteSchema.parse(await res.json());
    expect(row.id).toBe(inviteId);
    expect(row.status).toBe('sent');
    expect(new Date(row.sentAt ?? 0).getTime()).toBeGreaterThan(
      new Date(before?.sentAt ?? 0).getTime(),
    );

    const mails = await waitForMailCount(adminEmail, 2);
    const newest = mails[0];
    expect(newest?.Subject).toBe(`Convite para administrar ${displayName}`);
    expect(newest?.From.Name).toBe(displayName);
    expect(newest?.HTML).toContain('/auth/confirm?next=/aceitar-convite');
    expect(newest?.HTML).toContain('type=invite');
    expect(newest?.HTML).toContain('token_hash=');
    expect(newest?.HTML).toContain(primary);
    secondTokenHash = extractTokenHash(newest?.HTML ?? '');
    expect(secondTokenHash).not.toBe(firstTokenHash);

    const list = await platform(`/tenants/${tenantId}/invites`);
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('no-store');
    const body = z.object({ invites: z.array(tenantInviteSchema) }).parse(await list.json());
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]?.id).toBe(inviteId);

    const unknown = await platform(
      `/tenants/${tenantId}/invites/11111111-1111-4111-8111-111111111111/resend`,
      { method: 'POST' },
    );
    expect(unknown.status).toBe(404);
    expect((await envelope(unknown)).code).toBe('NOT_FOUND');

    const other = await throwawayInvited('other');
    const foreign = await platform(`/tenants/${other.tenantId}/invites/${inviteId}/resend`, {
      method: 'POST',
    });
    expect(foreign.status).toBe(404);
    expect((await envelope(foreign)).code).toBe('NOT_FOUND');

    const memberToken = await signInAs('member@rede-demo.local', SEED_PASSWORD);
    for (const [method, path] of [
      ['GET', `/v1/platform/tenants/${tenantId}/invites`],
      ['POST', `/v1/platform/tenants/${tenantId}/invites/${inviteId}/resend`],
    ] as const) {
      const refused = await lane(memberToken, path, { method });
      expect(refused.status).toBe(403);
      expect((await envelope(refused)).code).toBe('FORBIDDEN');
    }
  });

  it('10. the resend superseded the first link: the old token_hash no longer verifies, the new one opens a session', async () => {
    const client = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const stale = await client.auth.verifyOtp({ type: 'invite', token_hash: firstTokenHash });
    expect(stale.error).not.toBeNull();
    expect(stale.data.session).toBeNull();

    const fresh = await client.auth.verifyOtp({ type: 'invite', token_hash: secondTokenHash });
    expect(fresh.error).toBeNull();
    expect(fresh.data.session?.user.email).toBe(adminEmail);
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  });

  it('11. once the admin accepted, resend -> 409 INVITE_STATE_INVALID { reason: "already_accepted" }', async () => {
    const [user] = await adminSql<{ id: string }[]>`
      select id from auth.users where lower(email) = ${adminEmail}`;
    if (!user) throw new Error('invited auth user missing');
    const updated = await authAdmin().updateUserById(user.id, {
      password: INVITED_PASSWORD,
      email_confirm: true,
    });
    expect(updated.error).toBeNull();
    const token = await signInAs(adminEmail, INVITED_PASSWORD);
    const accepted = await lane(token, '/v1/me/accept-invite', {
      method: 'POST',
      body: acceptBody(),
      headers: { 'x-tenant-host': host },
    });
    expect(accepted.status).toBe(200);

    const res = await platform(`/tenants/${tenantId}/invites/${inviteId}/resend`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    const err = await envelope(res);
    expect(err.code).toBe('INVITE_STATE_INVALID');
    expect(err.details?.reason).toBe('already_accepted');
  });

  it('12. a pending invite on a tenant with NO verified host -> 409 { reason: "no_verified_primary" }, still pending, no mail', async () => {
    const nohostSlug = `inv-nohost-${RUN}`.slice(0, 40);
    const nohostEmail = `admin+nohost-${RUN}@invite.test`;
    const created = await createTenantViaApi(nohostSlug, nohostEmail);
    const res = await platform(`/tenants/${created.id}/invites/${created.inviteId}/resend`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    const err = await envelope(res);
    expect(err.code).toBe('INVITE_STATE_INVALID');
    expect(err.details?.reason).toBe('no_verified_primary');
    expect((await tenantDetail(created.id)).invites[0]?.status).toBe('pending');
    expect(await mailpitMessages(nohostEmail)).toHaveLength(0);
  });

  it('13. a pending invite whose verified primary host appeared without a verify call: resend delegates to the first send -> 200 sent, one mail', async () => {
    const lateSlug = `inv-late-${RUN}`.slice(0, 40);
    const lateHost = `${lateSlug}.localhost`;
    const lateEmail = `admin+late-${RUN}@invite.test`;
    const created = await createTenantViaApi(lateSlug, lateEmail);
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
      values (${created.id}::uuid, ${lateHost}, true, now(), 'verified')`;
    expect((await tenantDetail(created.id)).invites[0]?.status).toBe('pending');

    const res = await platform(`/tenants/${created.id}/invites/${created.inviteId}/resend`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const row = tenantInviteSchema.parse(await res.json());
    expect(row.status).toBe('sent');
    expect(row.sentAt).not.toBeNull();
    const mails = await waitForMailCount(lateEmail, 1);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.HTML).toContain('type=invite');
  });
});

// ---------------------------------------------------------------------------------------------
// 02-19: refusals — an e-mail that already has an identity on the platform (WR-02 / WR-03 /
// WR-04). The identity pre-check runs BEFORE any GoTrue call, so a refused invite never mails or
// re-tokens a foreign identity; the refused row is `expired` + `sent_at null` (D-A).
// ---------------------------------------------------------------------------------------------

/** A verified primary host inserted directly (the `throwawayInvited` shape) so a resend has an origin. */
async function insertVerifiedPrimary(tenantId: string, host: string): Promise<void> {
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
    values (${tenantId}::uuid, ${host}, true, now(), 'verified')`;
}

/** An ACTIVE `member` row for `userId` in the seeded rede-lab tenant — the "other tenant". */
async function membershipInLab(userId: string): Promise<void> {
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    select id, ${userId}::uuid, 'member', 'active' from public.tenants where slug = 'rede-lab'`;
}

/** A confirmed auth identity for `email` with NO membership anywhere (createUser, no mail). */
async function confirmedIdentity(email: string): Promise<string> {
  const { data, error } = await authAdmin().createUser({
    email,
    password: INVITED_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  await waitForMirror(data.user.id);
  return data.user.id;
}

const membershipCount = async (tenantId: string) => {
  const [row] = await adminSql<{ count: number }[]>`
    select count(*)::int as count from public.memberships where tenant_id = ${tenantId}::uuid`;
  return row?.count ?? 0;
};

const inviteRow = async (inviteId: string) => {
  const [row] = await adminSql<
    { status: string; sent_at: string | null; user_id: string | null }[]
  >`select status, sent_at, user_id from public.tenant_invites where id = ${inviteId}::uuid`;
  return row;
};

const resend = (tenantId: string, inviteId: string) =>
  platform(`/tenants/${tenantId}/invites/${inviteId}/resend`, { method: 'POST' });

/** Both resends answer the same 409 reason; the row, the memberships and Mailpit stay untouched. */
async function expectRefusedTwice(
  tenantId: string,
  inviteId: string,
  email: string,
  reason: 'email_in_use' | 'user_in_other_tenant',
) {
  for (const attempt of [1, 2]) {
    const res = await resend(tenantId, inviteId);
    expect(res.status, `attempt ${attempt}`).toBe(409);
    const err = await envelope(res);
    expect(err.code).toBe('INVITE_STATE_INVALID');
    // The body carries the reason and nothing else — never the other tenant (T-02-152).
    expect(err.details).toEqual({ reason });
    const row = await inviteRow(inviteId);
    expect(row?.status).toBe('expired');
    expect(row?.sent_at).toBeNull();
    expect(row?.user_id).toBeNull();
    expect(await membershipCount(tenantId)).toBe(0);
    expect(await mailpitMessages(email)).toHaveLength(0);
  }
  const detail = await tenantDetail(tenantId);
  expect(detail.invites[0]?.status).toBe('expired');
  expect(detail.invites[0]?.sentAt).toBeNull();
}

describe('refusals — e-mail already on the platform (WR-02 / WR-03 / WR-04)', () => {
  it('R1. an identity holding a membership in ANOTHER tenant -> 409 { reason: "user_in_other_tenant" }: row expired + sent_at null, no membership here, no mail, the other membership intact; the second resend repeats it', async () => {
    const slug = `inv-r1-${RUN}`.slice(0, 40);
    const email = `admin+r1-${RUN}@invite.test`;
    // The tenant is created FIRST (the create-time check must keep accepting a fresh e-mail).
    const { id: tenantId, inviteId } = await createTenantViaApi(slug, email);
    const userId = await confirmedIdentity(email);
    await membershipInLab(userId);
    await insertVerifiedPrimary(tenantId, `${slug}.localhost`);

    await expectRefusedTwice(tenantId, inviteId, email, 'user_in_other_tenant');

    const [lab] = await adminSql<{ status: string }[]>`
      select m.status from public.memberships m
        join public.tenants t on t.id = m.tenant_id
       where t.slug = 'rede-lab' and m.user_id = ${userId}::uuid and m.deleted_at is null`;
    expect(lab?.status).toBe('active');
  });

  it('R2. a confirmed identity with NO membership (super_admin, orphan) -> 409 { reason: "email_in_use" }: same refused state, no mail; the second resend repeats it', async () => {
    const slug = `inv-r2-${RUN}`.slice(0, 40);
    const email = `admin+r2-${RUN}@invite.test`;
    const { id: tenantId, inviteId } = await createTenantViaApi(slug, email);
    await confirmedIdentity(email);
    await insertVerifiedPrimary(tenantId, `${slug}.localhost`);

    await expectRefusedTwice(tenantId, inviteId, email, 'email_in_use');
  });

  it('R3. isOneTenantPerUserViolation maps ONLY a 23505 on memberships_one_tenant_per_user_v1 (cause chain walked)', () => {
    expect(
      isOneTenantPerUserViolation({
        cause: { code: '23505', constraint_name: 'memberships_one_tenant_per_user_v1' },
      }),
    ).toBe(true);
    expect(
      isOneTenantPerUserViolation({ code: '23505', constraint_name: 'memberships_tenant_user_uq' }),
    ).toBe(false);
    expect(isOneTenantPerUserViolation({ code: '23505' })).toBe(false);
    expect(isOneTenantPerUserViolation({ code: '23503' })).toBe(false);
    expect(isOneTenantPerUserViolation(null)).toBe(false);
  });

  describe('WR-04 — resend decides from OUR state when GoTrue says the identity is confirmed', () => {
    let invited: Invited;
    let mailsAfterR4 = 0;

    beforeAll(async () => {
      // Identity confirmed (the admin exchanged the link on /auth/confirm) but never accepted:
      // membership `invited`, row `sent` with `user_id`.
      invited = await throwawayInvited('wr04');
    });

    it('R4. an invited membership -> 200 sent with a RECOVERY link that opens a session for the admin; the row stays sent, the membership invited', async () => {
      const res = await resend(invited.tenantId, invited.inviteId);
      expect(res.status).toBe(200);
      const row = tenantInviteSchema.parse(await res.json());
      expect(row.status).toBe('sent');
      expect(row.sentAt).not.toBeNull();

      const [newest] = await waitForMailCount(invited.email, 1);
      expect(newest?.HTML).toContain('/auth/confirm?next=/aceitar-convite');
      expect(newest?.HTML).toContain('type=recovery');
      expect(newest?.HTML).not.toContain('type=invite');
      mailsAfterR4 = (await mailpitMessages(invited.email)).length;

      const client = createClient(
        process.env.SUPABASE_URL ?? '',
        process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const opened = await client.auth.verifyOtp({
        type: 'recovery',
        token_hash: extractTokenHash(newest?.HTML ?? ''),
      });
      expect(opened.error).toBeNull();
      expect(opened.data.session?.user.email).toBe(invited.email);
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined);

      expect((await tenantDetail(invited.tenantId)).invites[0]?.status).toBe('sent');
      expect(await membershipStatus(invited.tenantId, invited.userId)).toBe('invited');
      expect((await inviteRow(invited.inviteId))?.user_id).toBe(invited.userId);
    });

    it('R5. an ACTIVE membership (stale row shape) -> 409 { reason: "already_accepted" } and no new mail', async () => {
      await adminSql`
        update public.memberships set status = 'active'
         where tenant_id = ${invited.tenantId}::uuid and user_id = ${invited.userId}::uuid`;
      const res = await resend(invited.tenantId, invited.inviteId);
      expect(res.status).toBe(409);
      const err = await envelope(res);
      expect(err.code).toBe('INVITE_STATE_INVALID');
      expect(err.details?.reason).toBe('already_accepted');
      expect(await mailpitMessages(invited.email)).toHaveLength(mailsAfterR4);
    });
  });
});
