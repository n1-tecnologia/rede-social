import { PLATFORM_TERMS_VERSION, TENANT_HOST_HEADER } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import {
  ANONYMISE_DUE_BOOT_SINGLETON,
  ANONYMISE_DUE_QUEUE,
  ANONYMISE_DUE_SINGLETON,
  anonymiseDueOnce,
  armAnonymiseDue,
  rearmAnonymiseDue,
} from '@rede-social/core/server/accounts/anonymise-job';
import { centralProjectId } from '@rede-social/core/server/tenancy/project-registry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, signInAs } from './setup';

/**
 * "Excluir minha conta", the server flow against the local stack (13-13, D-609, D-610, NATIVE-19, NATIVE-20,
 * T-13-29, T-13-30): a member POSTs their password, the API verifies it against the tenant's own Auth, runs the
 * SQL request, signs the person out everywhere and answers the deadline; the very next request with the OLD token
 * is refused (the live predicate); a FRESH sign-in (a token issued after the request) cancels through
 * `requireAuth` and the first bootstrap carries `pendingDeletion` ONCE; after the deadline the same sign-in is
 * refused.
 *
 * A throwaway tenant with its own verified host keeps every role case (one administrator, two, a support member)
 * away from the seeded tenants. Every identity is a throwaway of this run and is removed at the end.
 */

type Envelope = { error: { code: string; details?: unknown } };

const PASSWORD = 'Segredo123';
const STAMP = Date.now();
const SLUG = `ad13-${STAMP}`.slice(0, 40);
const HOST = `${SLUG}.localhost`;
const SLUG_B = `ad13b-${STAMP}`.slice(0, 40);
const HOST_B = `${SLUG_B}.localhost`;

let tenantId = '';
let tenantBId = '';
const userIds: string[] = [];
/** Identities a re-sign-up created after the job freed the address. */
const reborn: string[] = [];

type Member = { userId: string; email: string; token: string };

const call = (
  method: string,
  path: string,
  token: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  api.request(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      [TENANT_HOST_HEADER]: HOST,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

const errorCode = async (res: Response) => ((await res.json()) as Envelope).error.code;

/** A confirmed identity plus an active membership of `role` in the throwaway tenant, signed in. */
async function member(
  role: 'member' | 'support_tenant' | 'admin_tenant',
  tag: string,
  inTenant: string = tenantId,
): Promise<Member> {
  const email = `ad13-${tag}-${crypto.randomUUID().slice(0, 8)}@rede-demo.local`;
  const { data, error } = await authAdmin().createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: 'Exclusão' },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userIds.push(data.user.id);
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${inTenant}::uuid, ${data.user.id}::uuid, ${role}, 'active')`;
  return { userId: data.user.id, email, token: await signInAs(email, PASSWORD) };
}

type MembershipState = {
  deleted: boolean;
  requested: boolean;
  due: Date | null;
  cancelledUntil: Date | null;
};
async function stateOf(userId: string): Promise<MembershipState> {
  const [row] = await adminSql<
    { deleted: boolean; requested: boolean; due: Date | null; cancelled_until: Date | null }[]
  >`
    select deleted_at is not null as deleted,
           deletion_requested_at is not null as requested,
           deletion_due_at as due,
           deletion_cancelled_until as cancelled_until
      from public.memberships
     where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid`;
  if (!row) throw new Error('membership row is gone');
  return {
    deleted: row.deleted,
    requested: row.requested,
    due: row.due,
    cancelledUntil: row.cancelled_until,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  const [tenant] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${SLUG}, 'Comunidade Exclusão', 'Regras de teste.', 1)
    returning id`;
  tenantId = tenant?.id ?? '';
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${tenantId}::uuid, ${HOST}, true, now())`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantId}::uuid, 'feed', true)`;
  const [tenantB] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${SLUG_B}, 'Comunidade Vizinha', 'Regras de teste.', 1)
    returning id`;
  tenantBId = tenantB?.id ?? '';
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${tenantBId}::uuid, ${HOST_B}, true, now())`;
});

afterAll(async () => {
  await adminSql`delete from pgboss.job where name = ${ANONYMISE_DUE_QUEUE}`;
  for (const id of userIds) {
    await adminSql`delete from public.feed_comments where author_user_id = ${id}::uuid`;
    await adminSql`delete from public.feed_posts where author_user_id = ${id}::uuid`;
  }
  for (const id of [...userIds, ...reborn]) {
    // Hard delete, also for an account the job soft-deleted (GoTrue keeps that row).
    await authAdmin().deleteUser(id);
  }
  for (const id of [tenantId, tenantBId]) {
    if (id) await adminSql`delete from public.tenants where id = ${id}::uuid`;
  }
  await adminSql.end();
  await sqlClient.end();
});

describe('POST /v1/me/account-deletion: the tracer (NATIVE-19, NATIVE-20)', () => {
  it('a wrong password is 403 WRONG_PASSWORD and changes nothing; the right one deactivates at once and answers the deadline', async () => {
    const m = await member('member', 'trace');

    const wrong = await call('POST', '/v1/me/account-deletion', m.token, {
      password: 'errada-123',
    });
    expect(wrong.status).toBe(403);
    expect(await errorCode(wrong)).toBe('WRONG_PASSWORD');
    expect(await stateOf(m.userId)).toMatchObject({ deleted: false, requested: false });
    // Positive control: the member is still live.
    expect((await call('GET', '/v1/me/bootstrap', m.token)).status).toBe(200);

    const before = Date.now();
    const done = await call('POST', '/v1/me/account-deletion', m.token, { password: PASSWORD });
    expect(done.status).toBe(200);
    expect(done.headers.get('cache-control')).toBe('no-store');
    const { dueAt } = (await done.json()) as { dueAt: string };
    const days = (new Date(dueAt).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThan(14.01);
    expect(await stateOf(m.userId)).toMatchObject({ deleted: true, requested: true });

    // The very next request with the OLD token is refused: no live membership, and the token is not fresher
    // than the request, so the cancel path refuses it too (T-13-30).
    const old = await call('GET', '/v1/me/bootstrap', m.token);
    expect(old.status).toBe(403);
    expect(await errorCode(old)).toBe('TENANT_HOST_MISMATCH');
    expect(await stateOf(m.userId)).toMatchObject({ deleted: true, requested: true });
  });

  it('a fresh sign-in cancels, the bootstrap carries pendingDeletion once, and a second request does not', async () => {
    const m = await member('member', 'cancel');
    const done = await call('POST', '/v1/me/account-deletion', m.token, { password: PASSWORD });
    const { dueAt } = (await done.json()) as { dueAt: string };

    // Auth stamps `iat` in whole seconds, so wait for the next second: a person cannot sign in again faster.
    await sleep(1_300);
    const fresh = await signInAs(m.email, PASSWORD);

    const first = await call('GET', '/v1/me/bootstrap', fresh);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { pendingDeletion: { until: string } | null };
    expect(firstBody.pendingDeletion).toEqual({ until: new Date(dueAt).toISOString() });
    expect(await stateOf(m.userId)).toMatchObject({ deleted: false, requested: false, due: null });

    const second = await call('GET', '/v1/me/bootstrap', fresh);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { pendingDeletion: unknown }).pendingDeletion).toBeNull();
  });

  it('a token issued BEFORE the request can never cancel it, however often it is presented', async () => {
    const m = await member('member', 'oldtoken');
    const second = await signInAs(m.email, PASSWORD);
    await sleep(1_100);
    await call('POST', '/v1/me/account-deletion', m.token, { password: PASSWORD });

    for (const token of [m.token, second, m.token]) {
      const res = await call('GET', '/v1/me/bootstrap', token);
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe('TENANT_HOST_MISMATCH');
    }
    expect(await stateOf(m.userId)).toMatchObject({ deleted: true, requested: true });
  });

  it('after the deadline the same fresh sign-in is refused and the member stays deactivated', async () => {
    const m = await member('member', 'late');
    await call('POST', '/v1/me/account-deletion', m.token, { password: PASSWORD });
    await adminSql`
      update public.memberships
         set deletion_requested_at = now() - interval '15 days',
             deletion_due_at = now() - interval '1 minute'
       where tenant_id = ${tenantId}::uuid and user_id = ${m.userId}::uuid`;

    await sleep(1_300);
    const fresh = await signInAs(m.email, PASSWORD);
    const res = await call('GET', '/v1/me/bootstrap', fresh);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('TENANT_HOST_MISMATCH');
    expect(await stateOf(m.userId)).toMatchObject({ deleted: true, requested: true });
  });

  it('calling it again does not extend the 14 days', async () => {
    const m = await member('member', 'twice');
    const first = await call('POST', '/v1/me/account-deletion', m.token, { password: PASSWORD });
    const { dueAt } = (await first.json()) as { dueAt: string };
    // The old token is refused now, so a second call is made with a NEW session of the same person, which
    // is itself refused by requireAuth: the deadline in the row is untouched whatever is attempted.
    const row = await stateOf(m.userId);
    expect(row.due?.toISOString()).toBe(new Date(dueAt).toISOString());
    const again = await call('POST', '/v1/me/account-deletion', m.token, { password: PASSWORD });
    expect(again.status).toBe(403);
    expect((await stateOf(m.userId)).due?.toISOString()).toBe(new Date(dueAt).toISOString());
  });
});

describe('POST /v1/me/account-deletion: the body (NATIVE-19 edge empty)', () => {
  it('a missing, empty, whitespace-only, 257-character or extra-key body is 400 and nothing changes', async () => {
    const m = await member('member', 'body');
    const bodies: unknown[] = [
      {},
      { password: '' },
      { password: '   ' },
      { password: 'x'.repeat(257) },
      { password: PASSWORD, extra: true },
      { password: 123 },
    ];
    for (const body of bodies) {
      const res = await call('POST', '/v1/me/account-deletion', m.token, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(await errorCode(res)).toBe('VALIDATION_FAILED');
    }
    const garbage = await call('POST', '/v1/me/account-deletion', m.token, 'not json');
    expect(garbage.status).toBe(400);
    expect(await stateOf(m.userId)).toMatchObject({ deleted: false, requested: false });
    // A 256-character password is within bounds: it reaches the check and is simply wrong.
    const longest = await call('POST', '/v1/me/account-deletion', m.token, {
      password: 'x'.repeat(256),
    });
    expect(longest.status).toBe(403);
    expect(await stateOf(m.userId)).toMatchObject({ deleted: false, requested: false });
  });
});

/* ── The anonymisation job against the real stack (NATIVE-21, D-609) ────────────────────────────────── */

const MAILPIT_URL = (process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324').replace(/\/$/, '');
type MailpitMessage = { ID: string; Subject: string; HTML: string; Text: string };

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

async function waitForMail(to: string, timeoutMs = 15_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [found] = await mailpitMessages(to);
    if (found) return found;
    await sleep(300);
  }
  throw new Error('no mail arrived in time');
}

/** A request for deletion by `m`, then the deadline moved into the past by the migration role. */
async function requestAndExpire(m: Member, dueAt?: string): Promise<void> {
  const res = await call('POST', '/v1/me/account-deletion', m.token, { password: PASSWORD });
  expect(res.status).toBe(200);
  await adminSql`
    update public.memberships
       set deletion_requested_at = now() - interval '15 days',
           deletion_due_at = coalesce(${dueAt ?? null}::timestamptz, now() - interval '1 minute')
     where tenant_id = ${tenantId}::uuid and user_id = ${m.userId}::uuid`;
}

/** One digest of every row a tenant owns that the anonymisation could touch, plus its members' identity rows. */
async function tenantDigest(id: string): Promise<string> {
  const [row] = await adminSql<{ digest: string }[]>`
    select md5(concat_ws('|',
      (select coalesce(string_agg(to_jsonb(m)::text, ',' order by m.id), '') from public.memberships m where m.tenant_id = ${id}::uuid),
      (select coalesce(string_agg(to_jsonb(p)::text, ',' order by p.membership_id), '') from public.member_profiles p where p.tenant_id = ${id}::uuid),
      (select coalesce(string_agg(to_jsonb(d)::text, ',' order by d.id), '') from public.push_subscriptions d where d.tenant_id = ${id}::uuid),
      (select coalesce(string_agg(to_jsonb(u)::text, ',' order by u.id), '') from public.users u
         where u.id in (select user_id from public.memberships where tenant_id = ${id}::uuid)),
      (select coalesce(string_agg(to_jsonb(c)::text, ',' order by c.id), '') from public.feed_comments c where c.tenant_id = ${id}::uuid),
      (select coalesce(string_agg(to_jsonb(f)::text, ',' order by f.id), '') from public.feed_posts f where f.tenant_id = ${id}::uuid)
    )) as digest`;
  return row?.digest ?? '';
}

async function addDevice(m: Member, inTenant: string): Promise<void> {
  await adminSql`
    insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, platform, app_environment)
    values (${inTenant}::uuid, ${m.userId}::uuid, ${`fcm-${crypto.randomUUID()}`}, 'fcm', 'android', 'production')`;
}

describe('accounts.anonymise-due: the job against the local stack (NATIVE-21)', () => {
  it('anonymises a due member end to end, confirms by e-mail first, frees the address, keeps the content and touches nothing of tenant B, idempotently', async () => {
    const projectId = await centralProjectId();
    const target = await member('admin_tenant', 'jobt');
    const peer = await member('admin_tenant', 'jobp');
    const viewer = await member('member', 'jobv');
    const neighbour = await member('member', 'jobn', tenantBId);
    const neighbourDue = await member('member', 'jobd', tenantBId);
    await addDevice(target, tenantId);
    await addDevice(neighbour, tenantBId);

    const caption = `Aviso do administrador que sai ${STAMP}`;
    const [ownPost] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption)
      values (${tenantId}::uuid, ${target.userId}::uuid, ${caption}) returning id::text as id`;
    const [peerPost] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption)
      values (${tenantId}::uuid, ${peer.userId}::uuid, 'Post do outro administrador') returning id::text as id`;
    await adminSql`
      insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
      values (${tenantId}::uuid, ${peerPost?.id}::uuid, ${target.userId}::uuid, 'Comentário que fica')`;

    await requestAndExpire(target);
    // B: one member with a device and one that asks later (the positive control at the end).
    const digestB = await tenantDigest(tenantBId);

    const result = await anonymiseDueOnce(projectId);
    expect(result).toMatchObject({ failed: 0 });
    expect(result.anonymised).toBeGreaterThanOrEqual(1);

    // 1. The completion e-mail was sent (before the Auth account went), with the tenant name and nothing personal.
    const mail = await waitForMail(target.email);
    expect(mail.Subject).toBe('Sua conta em Comunidade Exclusão foi excluída');
    expect(mail.Text).toContain('Comunidade Exclusão');
    expect(mail.Text).toMatch(/Em \d{1,2} de \w+ de \d{4}, os seus dados pessoais foram apagados/);
    expect(mail.HTML).not.toContain(target.email);
    expect(mail.Text).not.toContain(target.email);

    // 2. The Auth account is soft-deleted (kept, with its address freed) and the old password no longer works.
    const [auth] = await adminSql<{ deleted_at: Date | null; email: string | null }[]>`
      select deleted_at, email from auth.users where id = ${target.userId}::uuid`;
    expect(auth?.deleted_at).not.toBeNull();
    expect(auth?.email).not.toBe(target.email);
    await expect(signInAs(target.email, PASSWORD)).rejects.toThrow(/Invalid login credentials/);

    // 3. The database rows: anonymised in place, the identity mirror scrubbed, devices gone, content kept.
    const [row] = await adminSql<{ anonymised: boolean; name: string }[]>`
      select m.anonymised_at is not null as anonymised, p.display_name as name
        from public.memberships m join public.member_profiles p on p.membership_id = m.id
       where m.tenant_id = ${tenantId}::uuid and m.user_id = ${target.userId}::uuid`;
    expect(row).toEqual({ anonymised: true, name: 'Membro removido' });
    const [mirror] = await adminSql<{ email: string; name: string }[]>`
      select email, name from public.users where id = ${target.userId}::uuid`;
    expect(mirror).toEqual({
      email: `removed-${target.userId}@removed.invalid`,
      name: 'Membro removido',
    });
    const [devices] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.push_subscriptions where user_id = ${target.userId}::uuid`;
    expect(devices?.n).toBe(0);

    // 4. The content is still returned, attributed to "Membro removido": the post by its author card, the
    //    comment by `authorRemoved` (the web renders the same label from it).
    const feed = await call('GET', '/v1/feed', viewer.token);
    expect(feed.status).toBe(200);
    const page = (await feed.json()) as {
      items: { id: string; caption: string; author: { displayName: string } }[];
    };
    const kept = page.items.find((item) => item.id === ownPost?.id);
    expect(kept?.caption).toBe(caption);
    expect(kept?.author.displayName).toBe('Membro removido');
    const comments = await call('GET', `/v1/feed/posts/${peerPost?.id}/comments`, viewer.token);
    expect(comments.status).toBe(200);
    const thread = (await comments.json()) as {
      items: { body: string; authorRemoved: boolean; author: { displayName: string | null } }[];
    };
    const keptComment = thread.items.find((item) => item.body === 'Comentário que fica');
    expect(keptComment?.authorRemoved).toBe(true);
    expect(keptComment?.author.displayName).toBeNull();

    // 5. The address can sign up again and that creates a NEW member.
    const signup = await api.request(`/v1/public/signup/${SLUG}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Nova Pessoa',
        email: target.email,
        password: PASSWORD,
        consents: { tenantRulesVersion: 1, platformTermsVersion: PLATFORM_TERMS_VERSION },
      }),
    });
    expect(signup.status).toBe(201);
    const [fresh] = await adminSql<{ user_id: string; anonymised: boolean }[]>`
      select m.user_id::text as user_id, m.anonymised_at is not null as anonymised
        from public.memberships m join public.users u on u.id = m.user_id
       where m.tenant_id = ${tenantId}::uuid and u.email = ${target.email}`;
    expect(fresh?.anonymised).toBe(false);
    expect(fresh?.user_id).not.toBe(target.userId);
    if (fresh) reborn.push(fresh.user_id);

    // 6. Tenant B and its devices did not move by a byte; a second run changes nothing.
    expect(await tenantDigest(tenantBId)).toBe(digestB);
    const [bDevices] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.push_subscriptions where tenant_id = ${tenantBId}::uuid`;
    expect(bDevices?.n).toBe(1);
    const digestA = await tenantDigest(tenantId);
    const again = await anonymiseDueOnce(projectId);
    expect(again).toMatchObject({ due: 0, anonymised: 0, mailed: 0, failed: 0 });
    expect(await tenantDigest(tenantId)).toBe(digestA);
    expect(await tenantDigest(tenantBId)).toBe(digestB);
    expect(await mailpitMessages(target.email)).toHaveLength(1);

    // Positive control: the digest of B DOES move when B's own due member is anonymised by the same job.
    await adminSql`
      update public.memberships
         set deleted_at = now(), deletion_requested_at = now() - interval '15 days',
             deletion_due_at = now() - interval '1 minute'
       where tenant_id = ${tenantBId}::uuid and user_id = ${neighbourDue.userId}::uuid`;
    await anonymiseDueOnce(projectId);
    expect(await tenantDigest(tenantBId)).not.toBe(digestB);
    const [stillThere] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.push_subscriptions where user_id = ${neighbour.userId}::uuid`;
    expect(stillThere?.n).toBe(1);
  });

  it('arms once under each singleton key and re-arms an hour later', async () => {
    const projectId = await centralProjectId();
    await adminSql`delete from pgboss.job where name = ${ANONYMISE_DUE_QUEUE}`;

    expect(await armAnonymiseDue({ projectId })).toBe(true);
    expect(await armAnonymiseDue({ projectId })).toBe(false);
    const boot = await adminSql<{ state: string; soon: boolean }[]>`
      select state, start_after <= now() + interval '5 seconds' as soon
        from pgboss.job where name = ${ANONYMISE_DUE_QUEUE} and singleton_key = ${ANONYMISE_DUE_BOOT_SINGLETON}`;
    expect(boot).toEqual([{ state: 'created', soon: true }]);

    expect(await rearmAnonymiseDue({ projectId })).toBe(true);
    expect(await rearmAnonymiseDue({ projectId })).toBe(false);
    const hourly = await adminSql<{ state: string; later: boolean }[]>`
      select state, start_after > now() + interval '59 minutes' as later
        from pgboss.job where name = ${ANONYMISE_DUE_QUEUE} and singleton_key = ${ANONYMISE_DUE_SINGLETON}`;
    expect(hourly).toEqual([{ state: 'created', later: true }]);
    // The boot job and the hourly job are two different jobs: neither swallowed the other.
    const [total] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pgboss.job where name = ${ANONYMISE_DUE_QUEUE}`;
    expect(total?.n).toBe(2);
    await adminSql`delete from pgboss.job where name = ${ANONYMISE_DUE_QUEUE}`;
  });
});
