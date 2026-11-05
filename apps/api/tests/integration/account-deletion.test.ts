import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
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

let tenantId = '';
const userIds: string[] = [];

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
    values (${tenantId}::uuid, ${data.user.id}::uuid, ${role}, 'active')`;
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
});

afterAll(async () => {
  for (const id of userIds) {
    await adminSql`delete from public.feed_comments where author_user_id = ${id}::uuid`;
    await adminSql`delete from public.feed_posts where author_user_id = ${id}::uuid`;
    await authAdmin().deleteUser(id);
  }
  if (tenantId) await adminSql`delete from public.tenants where id = ${tenantId}::uuid`;
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
