import { PLATFORM_TERMS_VERSION, platformTenantDetailSchema } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  authAdmin,
  createSharedIdentity,
  removeIdentitiesByPrefix,
  runInviteSendJobs,
  signInAs,
  withPaymentsGate,
} from './setup';

/**
 * 09.1-04 (PAY-09, PAY-05; D-492, D-487, D-316): the first admin of a new tenant needs no hand-filled
 * list. The platform invite IS a manual access, written when the invite is CREATED (assumption A-P3:
 * `inviteUserByEmail` fires the creation hook at SEND time, long before the accept), re-asserted
 * idempotently at accept, and staff never depend on it.
 *
 *   09.1 tracer  ONE tenant for a first admin with no access row anywhere: creation (201), the manual
 *                row, the send through real GoTrue, the accept, a first request on a gated tenant with
 *                the row deleted, the platform account still refused, the belt-and-braces 403.
 *   09.1 edges   P18 (idempotency) and P19 (concurrency) of the grant.
 *
 * Every tenant carries a `fa91-…` slug and every identity a `fa91-…@first-admin.test` address; the
 * suite sweeps both before AND after (memberships have no cascade from tenants).
 */

const PREFIX = 'fa91';
const RUN = crypto.randomUUID().slice(0, 8);
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const CHOSEN_PASSWORD = 'Primeiro-Admin-123';
const slugOf = (name: string) => `${PREFIX}-${RUN}-${name}`.slice(0, 40);
const emailOf = (name: string) => `${PREFIX}-${RUN}-${name}@first-admin.test`;

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

let superAdmin = '';
const createdDomainIds: string[] = [];

const platform = (path: string, init: { method?: string; body?: unknown } = {}) =>
  api.request(`/v1/platform${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${superAdmin}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const lane = (
  token: string,
  host: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
) =>
  api.request(path, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': host,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const codeOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as Partial<Envelope>).error?.code;

const createTenant = (slug: string, adminEmail: string) =>
  platform('/tenants', {
    method: 'POST',
    body: {
      displayName: `Primeiro admin ${slug}`,
      slug,
      colors: { primary: '#0e7490', secondary: '#67e8f9' },
      modules: ['feed'],
      adminEmail,
    },
  });

async function createdTenant(
  slug: string,
  adminEmail: string,
): Promise<{ id: string; inviteId: string }> {
  const res = await createTenant(slug, adminEmail);
  if (res.status !== 201) throw new Error(`tenant create failed: ${res.status}`);
  const detail = platformTenantDetailSchema.parse(await res.json());
  const inviteId = detail.invites[0]?.id;
  if (!inviteId) throw new Error('no pending invite on the created tenant');
  return { id: detail.tenant.id, inviteId };
}

type GrantRow = { id: string; status: string; source: string; created_by_user_id: string | null };

const grantsIn = (tenantId: string, address: string) =>
  adminSql<GrantRow[]>`
    select id::text as id, status, source, created_by_user_id::text as created_by_user_id
      from public.access_grants
     where tenant_id = ${tenantId}::uuid and email = ${address}
     order by status`;

const grantsAnywhere = async (address: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.access_grants where email = ${address}`;
  return row?.n ?? 0;
};

const authUsersCount = async (address: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from auth.users where email = ${address}`;
  return row?.n ?? 0;
};

const membershipCount = async (tenantId: string, status?: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.memberships
     where tenant_id = ${tenantId}::uuid and (${status ?? null}::text is null or status = ${status ?? ''})`;
  return row?.n ?? 0;
};

const inviteStatus = async (inviteId: string): Promise<string | undefined> => {
  const [row] = await adminSql<{ status: string }[]>`
    select status from public.tenant_invites where id = ${inviteId}::uuid`;
  return row?.status;
};

/** Attaches `<slug>.localhost` to the tenant and verifies it through the platform API. */
async function attachVerifiedHost(tenantId: string, slug: string): Promise<string> {
  const host = `${slug}.localhost`;
  const attached = await platform(`/tenants/${tenantId}/domains`, {
    method: 'POST',
    body: { host },
  });
  expect(attached.status).toBe(201);
  const domain = (await attached.json()) as { id: string };
  createdDomainIds.push(domain.id);
  const verified = await platform(`/tenants/${tenantId}/domains/${domain.id}/verify`, {
    method: 'POST',
  });
  expect(verified.status).toBe(200);
  return host;
}

const acceptBody = async (tenantId: string) => {
  const [tenant] = await adminSql<{ rules_version: number }[]>`
    select rules_version from public.tenants where id = ${tenantId}::uuid`;
  return { rulesVersion: tenant?.rules_version ?? 1, termsVersion: PLATFORM_TERMS_VERSION };
};

const accept = async (token: string, host: string, tenantId: string) =>
  lane(token, host, '/v1/me/accept-invite', { method: 'POST', body: await acceptBody(tenantId) });

type Invited = {
  tenantId: string;
  inviteId: string;
  host: string;
  email: string;
  userId: string;
  token: string;
};

/**
 * A tenant created through the API plus the invited admin in the exact state `sendPendingInvites`
 * leaves behind (confirmed identity with a password, `invited` admin_tenant membership, invite `sent`),
 * WITHOUT the GoTrue mail, so the accept can be driven with a password session.
 */
async function throwawayInvited(name: string): Promise<Invited> {
  const slug = slugOf(name);
  const host = `${slug}.localhost`;
  const email = emailOf(name);
  const { id: tenantId, inviteId } = await createdTenant(slug, email);
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
    values (${tenantId}::uuid, ${host}, true, now(), 'verified')`;
  const { data, error } = await authAdmin().createUser({
    email,
    password: CHOSEN_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  const userId = data.user.id;
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = await adminSql`select id from public.users where id = ${userId}::uuid`;
    if (rows.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantId}::uuid, ${userId}::uuid, 'admin_tenant', 'invited')`;
  await adminSql`
    update public.tenant_invites set status = 'sent', sent_at = now(), user_id = ${userId}::uuid
     where id = ${inviteId}::uuid`;
  const token = await signInAs(email, CHOSEN_PASSWORD);
  return { tenantId, inviteId, host, email, userId, token };
}

async function sweep(): Promise<void> {
  await adminSql`
    delete from pgboss_platform.job_common
     where name = 'kernel.invite-send' and data->>'tenantId' in
       (select id::text from public.tenants where slug like ${`${PREFIX}-%`})`;
  if (createdDomainIds.length > 0) {
    await adminSql`
      delete from pgboss_platform.job_common
       where name = 'kernel.domain-verify' and singleton_key in ${adminSql(createdDomainIds)}`;
  }
  await adminSql`
    delete from public.consent_records where tenant_id in
      (select id from public.tenants where slug like ${`${PREFIX}-%`})`;
  await adminSql`
    delete from public.memberships where tenant_id in
      (select id from public.tenants where slug like ${`${PREFIX}-%`})`;
  await adminSql`delete from public.tenants where slug like ${`${PREFIX}-%`}`;
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  await sweep();
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
});

afterAll(async () => {
  await sweep();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('09.1 tracer', () => {
  it('a first admin with no access anywhere is onboarded in one step and works in a gated tenant (D-492, PR-4)', async () => {
    const slug = slugOf('tracer');
    const admin = emailOf('tracer');
    expect(await grantsAnywhere(admin)).toBe(0);

    // Creation: where the old pre-check answered 400 `adminEmail = not_allowed`.
    const created = await createTenant(slug, `  ${admin.toUpperCase()} `);
    expect(created.status).toBe(201);
    const detail = platformTenantDetailSchema.parse(await created.json());
    const tenantId = detail.tenant.id;
    const inviteId = detail.invites[0]?.id ?? '';

    // The invite IS a manual access: one `active` row, in the NEW tenant, lower-cased and trimmed.
    const rows = await grantsIn(tenantId, admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'manual', status: 'active' });
    expect(await grantsAnywhere(admin)).toBe(1);

    // Send: the creation hook passes BECAUSE that row exists; a real identity and an invited membership.
    const host = await attachVerifiedHost(tenantId, slug);
    expect(await runInviteSendJobs(tenantId)).toBeGreaterThanOrEqual(1);
    expect(await inviteStatus(inviteId)).toBe('sent');
    expect(await authUsersCount(admin)).toBe(1);
    const [identity] = await adminSql<{ id: string }[]>`
      select id::text as id from auth.users where email = ${admin}`;
    const userId = identity?.id ?? '';
    expect(userId).not.toBe('');

    // The admin opens the link (confirming the address) and chooses a password, as the web action does,
    // then signs in and accepts.
    const set = await authAdmin().updateUserById(userId, {
      password: CHOSEN_PASSWORD,
      email_confirm: true,
    });
    expect(set.error).toBeNull();
    const token = await signInAs(admin, CHOSEN_PASSWORD);
    const invitedBootstrap = await lane(token, host, '/v1/me/bootstrap');
    expect(invitedBootstrap.status).toBe(200);
    expect((await accept(token, host, tenantId)).status).toBe(200);
    expect(await inviteStatus(inviteId)).toBe('accepted');
    expect(await grantsIn(tenantId, admin)).toHaveLength(1);

    // Gate ON, no subscription, and the manual row DELETED: staff are never refused.
    await withPaymentsGate(tenantId, async () => {
      await adminSql`
        delete from public.access_grants where tenant_id = ${tenantId}::uuid and email = ${admin}`;
      expect(await grantsIn(tenantId, admin)).toHaveLength(0);

      expect((await lane(token, host, '/v1/me/bootstrap')).status).toBe(200);
      expect((await lane(token, host, '/v1/admin/members')).status).toBe(200);
      // A fresh sign-in passes the token hook too (live staff membership).
      const again = await signInAs(admin, CHOSEN_PASSWORD);
      expect((await lane(again, host, '/v1/me/bootstrap')).status).toBe(200);

      // The same tenant refuses a member with no access row: the gate is really on.
      const member = await createSharedIdentity({
        prefix: PREFIX,
        memberships: [{ tenantSlug: slug }],
      });
      const memberToken = await signInAs(member.email, member.password);
      const cut = await lane(memberToken, host, '/v1/me/bootstrap');
      expect(cut.status).toBe(403);
      expect(await codeOf(cut)).toBe('SUBSCRIPTION_PENDING');
    });
  }, 90_000);

  it('a platform account is still refused as a first admin (D-316, T-09.1-14): 400 adminEmail = in_use, nothing created', async () => {
    const slug = slugOf('platform');
    const before = await grantsAnywhere(SUPER_ADMIN_EMAIL);
    const res = await createTenant(slug, SUPER_ADMIN_EMAIL);
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as Envelope;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.adminEmail).toBe('in_use');
    const [none] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.tenants where slug = ${slug}`;
    expect(none?.n).toBe(0);
    expect(await grantsAnywhere(SUPER_ADMIN_EMAIL)).toBe(before);
  });

  it('belt and braces: with the manual row removed between creation and send the hook refuses (403 EMAIL_NOT_ALLOWED), the invite stays pending, and a resend after the row is restored passes', async () => {
    const slug = slugOf('belt');
    const admin = emailOf('belt');
    const { id: tenantId, inviteId } = await createdTenant(slug, admin);
    await attachVerifiedHost(tenantId, slug);
    expect(await grantsIn(tenantId, admin)).toHaveLength(1);

    await adminSql`
      delete from public.access_grants where tenant_id = ${tenantId}::uuid and email = ${admin}`;
    const resend = () =>
      platform(`/tenants/${tenantId}/invites/${inviteId}/resend`, { method: 'POST' });

    const refused = await resend();
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe('EMAIL_NOT_ALLOWED');
    expect(await inviteStatus(inviteId)).toBe('pending');
    expect(await authUsersCount(admin)).toBe(0);

    await adminSql`
      insert into public.access_grants (tenant_id, email, source, status)
      values (${tenantId}::uuid, ${admin}, 'manual', 'active')`;
    const ok = await resend();
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe('sent');
    expect(await authUsersCount(admin)).toBe(1);
  }, 60_000);
});

describe('09.1 edges', () => {
  it('P18: the same tenant created twice (a retried request) leaves one tenant, one invite and ONE manual row; the refused retry writes no grant', async () => {
    const slug = slugOf('retry');
    const admin = emailOf('retry');
    const first = await createTenant(slug, admin);
    expect(first.status).toBe(201);
    const { tenant } = platformTenantDetailSchema.parse(await first.json());

    const second = await createTenant(slug, admin);
    expect(second.status).toBe(400);
    expect(((await second.json()) as Envelope).error.details?.slug).toBe('taken');

    expect(await grantsIn(tenant.id, admin)).toHaveLength(1);
    expect(await grantsAnywhere(admin)).toBe(1);
    const [invites] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.tenant_invites where tenant_id = ${tenant.id}::uuid`;
    expect(invites?.n).toBe(1);
  });

  it('P18: accepting the same invite twice leaves ONE manual row, ONE active membership and two consents; the replay writes nothing', async () => {
    const invited = await throwawayInvited('twice');
    const [before] = await grantsIn(invited.tenantId, invited.email);
    expect(before).toMatchObject({ source: 'manual', status: 'active' });

    expect((await accept(invited.token, invited.host, invited.tenantId)).status).toBe(200);
    const [afterFirst] = await adminSql<{ id: string; updated_at: string }[]>`
      select id::text as id, updated_at::text as updated_at from public.access_grants
       where tenant_id = ${invited.tenantId}::uuid and email = ${invited.email}`;
    expect((await accept(invited.token, invited.host, invited.tenantId)).status).toBe(200);

    const rows = await adminSql<{ id: string; updated_at: string }[]>`
      select id::text as id, updated_at::text as updated_at from public.access_grants
       where tenant_id = ${invited.tenantId}::uuid and email = ${invited.email}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(afterFirst);
    expect(rows[0]?.id).toBe(before?.id);
    expect(await membershipCount(invited.tenantId, 'active')).toBe(1);
    const [consents] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.consent_records
       where tenant_id = ${invited.tenantId}::uuid and user_id = ${invited.userId}::uuid`;
    expect(consents?.n).toBe(2);
  });

  it('an invite created before this phase (no row) is granted at accept, exactly once, by the accepting user', async () => {
    const invited = await throwawayInvited('legacy');
    await adminSql`
      delete from public.access_grants
       where tenant_id = ${invited.tenantId}::uuid and email = ${invited.email}`;
    expect(await grantsIn(invited.tenantId, invited.email)).toHaveLength(0);

    expect((await accept(invited.token, invited.host, invited.tenantId)).status).toBe(200);
    const rows = await grantsIn(invited.tenantId, invited.email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'manual',
      status: 'active',
      created_by_user_id: invited.userId,
    });

    expect((await accept(invited.token, invited.host, invited.tenantId)).status).toBe(200);
    expect(await grantsIn(invited.tenantId, invited.email)).toEqual(rows);
  });

  it('the grant never touches a manual block: a blocked row beside it stays exactly as it was (D-489)', async () => {
    const invited = await throwawayInvited('block');
    await adminSql`
      insert into public.access_grants (tenant_id, email, source, status)
      values (${invited.tenantId}::uuid, ${invited.email}, 'manual', 'blocked')`;
    const [blockedBefore] = (await grantsIn(invited.tenantId, invited.email)).filter(
      (row) => row.status === 'blocked',
    );

    expect((await accept(invited.token, invited.host, invited.tenantId)).status).toBe(200);
    const rows = await grantsIn(invited.tenantId, invited.email);
    expect(rows.map((row) => row.status)).toEqual(['active', 'blocked']);
    expect(rows.find((row) => row.status === 'blocked')).toEqual(blockedBefore);
  });

  it('P19: two concurrent accepts of one invite settle 200/200 on ONE manual row and ONE active membership', async () => {
    const invited = await throwawayInvited('race');
    const [a, b] = await Promise.all([
      accept(invited.token, invited.host, invited.tenantId),
      accept(invited.token, invited.host, invited.tenantId),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await grantsIn(invited.tenantId, invited.email)).toHaveLength(1);
    expect(await membershipCount(invited.tenantId, 'active')).toBe(1);
    expect(await membershipCount(invited.tenantId)).toBe(1);
  });

  it('P19: two concurrent creations of the same tenant converge on one tenant and one manual row, with no 5xx', async () => {
    const slug = slugOf('dup');
    const admin = emailOf('dup');
    const [a, b] = await Promise.all([createTenant(slug, admin), createTenant(slug, admin)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses.every((status) => status < 500)).toBe(true);
    expect(statuses).toEqual([201, 400]);
    const [tenants] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.tenants where slug = ${slug}`;
    expect(tenants?.n).toBe(1);
    expect(await grantsAnywhere(admin)).toBe(1);
  });

  it('one e-mail administering two new tenants holds one manual row in EACH, never one shared row', async () => {
    const admin = emailOf('two');
    const one = await createdTenant(slugOf('two-a'), admin);
    const two = await createdTenant(slugOf('two-b'), admin);
    expect(await grantsIn(one.id, admin)).toHaveLength(1);
    expect(await grantsIn(two.id, admin)).toHaveLength(1);
    expect(await grantsAnywhere(admin)).toBe(2);
  });
});
