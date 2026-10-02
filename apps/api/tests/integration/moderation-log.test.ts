import { randomUUID } from 'node:crypto';
import type { ModerationLogEntry, ModerationLogPage } from '@rede-social/contracts/moderation';
import { sqlClient } from '@rede-social/core/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * 08-03 — `GET /v1/admin/moderation-log` (MODER-03, D-337, D-338, T-08-15, T-08-16) against the live
 * local stack: the keyset walk, the action filter, the empty tenant, the cursor guard, the
 * permission and tenant guards, and the live names.
 *
 * Rows are seeded through the ADMIN SQL lane (the table is append-only for every lane, but INSERT is
 * not refused to the owner), several of them in ONE statement so they share one `created_at` — the
 * case where only the `id desc` tie-breaker keeps a page boundary from duplicating or skipping a row.
 *
 * The log can never be cleaned (append-only, by design), so every assertion is written against a
 * SNAPSHOT read from the table right before the request, and `pnpm db:reset` is the clean slate.
 * Integration files run one at a time (`fileParallelism: false`), so no other suite writes between
 * the snapshot and the walk.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };

const RUN = randomUUID().slice(0, 8);
const EMPTY_SLUG = `moderacao-vazia-${RUN}`;
const EMPTY_HOST = `${EMPTY_SLUG}.localhost`;
const THROWAWAY_PASSWORD = `Moderacao-${RUN}-senha!`;

const tokens = { admin: '', member: '', support: '', labAdmin: '', emptyAdmin: '' };
const ids = { demo: '', lab: '', empty: '' };
const people = {
  admin: { user: '', membership: '' },
  member: { user: '', membership: '' },
  support: { user: '', membership: '' },
  labAdmin: { user: '', membership: '' },
  labMember: { user: '', membership: '' },
  departed: { user: '', membership: '' },
};
const throwawayUsers: string[] = [];
const seeded = { sameInstant: [] as string[], blank: '', departed: '', lab: '', bySupport: '' };

const request = (path: string, token: string, host: string = HOSTS.demo) =>
  api.request(path, {
    headers: { authorization: `Bearer ${token}`, 'x-tenant-host': host },
  });

async function page(token: string, query = '', host?: string): Promise<ModerationLogPage> {
  const res = await request(`/v1/admin/moderation-log${query}`, token, host);
  expect(res.status, `GET moderation-log${query}`).toBe(200);
  return (await res.json()) as ModerationLogPage;
}

/** Walks every page at `limit`, with an optional action filter, guarding against a runaway loop. */
async function walk(
  token: string,
  limit: number,
  action?: string,
  host?: string,
): Promise<ModerationLogEntry[]> {
  const seen: ModerationLogEntry[] = [];
  let cursor: string | null = null;
  for (let hops = 0; hops < 500; hops += 1) {
    const search = new URLSearchParams({ limit: String(limit) });
    if (action) search.set('action', action);
    if (cursor) search.set('cursor', cursor);
    const next = await page(token, `?${search.toString()}`, host);
    expect(next.items.length).toBeLessThanOrEqual(limit);
    seen.push(...next.items);
    cursor = next.nextCursor;
    if (cursor === null) return seen;
  }
  throw new Error('the walk did not terminate');
}

const walkOn = (token: string, host: string) => walk(token, 50, undefined, host);

/** The table's own order for one tenant (and action): the ground truth a walk must reproduce. */
async function snapshot(tenantId: string, action?: string): Promise<string[]> {
  const rows = await adminSql<{ id: string }[]>`
    select id::text from public.moderation_log
     where tenant_id = ${tenantId}::uuid
       and (${action ?? null}::text is null or action = ${action ?? null}::text)
     order by created_at desc, id desc`;
  return rows.map((row) => row.id);
}

async function person(tenantId: string, email: string) {
  const [row] = await adminSql<{ user_id: string; membership_id: string }[]>`
    select u.id::text as user_id, m.id::text as membership_id
      from public.users u join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantId}::uuid and u.email = ${email}`;
  if (!row) throw new Error(`no membership for ${email}`);
  return { user: row.user_id, membership: row.membership_id };
}

async function throwawayUser(
  tenantId: string,
  email: string,
  role: 'member' | 'admin_tenant',
): Promise<{ user: string; membership: string }> {
  const { data, error } = await authAdmin().createUser({
    email,
    password: THROWAWAY_PASSWORD,
    email_confirm: true,
    user_metadata: { name: 'Moderacao' },
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  throwawayUsers.push(data.user.id);
  const [membership] = await adminSql<{ id: string }[]>`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantId}::uuid, ${data.user.id}::uuid, ${role}, 'active')
    returning id::text`;
  return { user: data.user.id, membership: membership?.id ?? '' };
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  ids.demo = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  ids.lab = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';

  people.admin = await person(ids.demo, 'admin@rede-demo.local');
  people.member = await person(ids.demo, 'member@rede-demo.local');
  people.support = await person(ids.demo, 'support@rede-demo.local');
  people.labAdmin = await person(ids.lab, 'admin@rede-lab.local');
  people.labMember = await person(ids.lab, 'member@rede-lab.local');

  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.support = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);

  // FIVE comment removals in ONE statement: one `created_at` (the transaction's `now()`) for all.
  const same = await adminSql<{ id: string }[]>`
    insert into public.moderation_log
      (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
       subject_type, subject_id, excerpt)
    select ${ids.demo}::uuid, 'comment_removed', ${people.admin.user}::uuid,
           ${people.admin.membership}::uuid, ${people.member.user}::uuid,
           ${people.member.membership}::uuid, 'post_comment', gen_random_uuid(),
           ${`Trecho ${RUN} `} || g
      from generate_series(1, 5) g
    returning id::text`;
  seeded.sameInstant = same.map((row) => row.id);

  // A block whose stored reason is only whitespace (the writer would store null; a legacy or
  // hand-written row must still read as "no reason"), and an unblock and a role change, by the admin.
  const [blank] = await adminSql<{ id: string }[]>`
    insert into public.moderation_log
      (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
       reason)
    values (${ids.demo}::uuid, 'member_blocked', ${people.admin.user}::uuid,
            ${people.admin.membership}::uuid, ${people.member.user}::uuid,
            ${people.member.membership}::uuid, '   ')
    returning id::text`;
  seeded.blank = blank?.id ?? '';
  await adminSql`
    insert into public.moderation_log
      (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
       reason)
    values (${ids.demo}::uuid, 'member_unblocked', ${people.admin.user}::uuid,
            ${people.admin.membership}::uuid, ${people.member.user}::uuid,
            ${people.member.membership}::uuid, ${`Desbloqueio ${RUN}`})`;
  await adminSql`
    insert into public.moderation_log
      (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
       details)
    values (${ids.demo}::uuid, 'role_changed', ${people.admin.user}::uuid,
            ${people.admin.membership}::uuid, ${people.member.user}::uuid,
            ${people.member.membership}::uuid, '{"from":"member","to":"support_tenant"}'::jsonb)`;

  // A row whose ACTOR is someone else (support), so `isViewer` must be false for the admin.
  const [bySupport] = await adminSql<{ id: string }[]>`
    insert into public.moderation_log
      (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
       subject_type, subject_id, excerpt)
    values (${ids.demo}::uuid, 'comment_removed', ${people.support.user}::uuid,
            ${people.support.membership}::uuid, ${people.member.user}::uuid,
            ${people.member.membership}::uuid, 'story_comment', gen_random_uuid(),
            ${`Por outra pessoa ${RUN}`})
    returning id::text`;
  seeded.bySupport = bySupport?.id ?? '';

  // A DEPARTED target: a throwaway member whose membership is then soft-deleted.
  people.departed = await throwawayUser(ids.demo, `saiu-${RUN}@rede-demo.local`, 'member');
  const [departed] = await adminSql<{ id: string }[]>`
    insert into public.moderation_log
      (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
       reason)
    values (${ids.demo}::uuid, 'member_blocked', ${people.admin.user}::uuid,
            ${people.admin.membership}::uuid, ${people.departed.user}::uuid,
            ${people.departed.membership}::uuid, ${`Saiu ${RUN}`})
    returning id::text`;
  seeded.departed = departed?.id ?? '';
  await adminSql`
    update public.memberships set deleted_at = now()
     where id = ${people.departed.membership}::uuid`;

  // ONE rede-lab row, written so a rede-demo admin can be shown never to see it.
  const [lab] = await adminSql<{ id: string }[]>`
    insert into public.moderation_log
      (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
       subject_type, subject_id, excerpt)
    values (${ids.lab}::uuid, 'comment_removed', ${people.labAdmin.user}::uuid,
            ${people.labAdmin.membership}::uuid, ${people.labMember.user}::uuid,
            ${people.labMember.membership}::uuid, 'post_comment', gen_random_uuid(),
            ${`Do lab ${RUN}`})
    returning id::text`;
  seeded.lab = lab?.id ?? '';

  // An EMPTY tenant: verified host, one active admin, and no log row ever written for it.
  const [empty] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${EMPTY_SLUG}, 'Moderacao Vazia', 'Regras de teste.', 1)
    returning id::text`;
  ids.empty = empty?.id ?? '';
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${ids.empty}::uuid, ${EMPTY_HOST}, true, now())`;
  const emptyEmail = `admin-${RUN}@${EMPTY_SLUG}.local`;
  await throwawayUser(ids.empty, emptyEmail, 'admin_tenant');
  tokens.emptyAdmin = await signInAs(emptyEmail, THROWAWAY_PASSWORD);
});

afterAll(async () => {
  for (const userId of throwawayUsers) await authAdmin().deleteUser(userId);
  // The empty tenant never received a log row, so it can be removed; the demo and lab rows stay
  // (append-only) until the next `pnpm db:reset`.
  await adminSql`delete from public.tenants where slug = ${EMPTY_SLUG}`;
  await adminSql.end();
  await sqlClient.end();
});

describe('moderation log read', () => {
  it('ordering: a limit=1 walk visits every row exactly once in created_at desc, id desc', async () => {
    const truth = await snapshot(ids.demo);
    expect(truth.length).toBeGreaterThanOrEqual(10);
    const walked = (await walk(tokens.admin, 1)).map((entry) => entry.id);
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).toEqual(truth);

    // The five rows that share ONE created_at come out by `id desc`, adjacent, across 5 pages.
    const tied = walked.filter((id) => seeded.sameInstant.includes(id));
    expect(tied).toEqual([...seeded.sameInstant].sort().reverse());
    const first = walked.indexOf(tied[0] ?? '');
    expect(walked.slice(first, first + 5)).toEqual(tied);
  });

  it('a page size of 3 walks the same order, with no duplicate or skipped row at a boundary', async () => {
    const walked = (await walk(tokens.admin, 3)).map((entry) => entry.id);
    expect(walked).toEqual(await snapshot(ids.demo));
  });

  it('the action filter returns only that action, in the same order, also walked at limit=1', async () => {
    for (const action of [
      'comment_removed',
      'member_blocked',
      'member_unblocked',
      'role_changed',
    ]) {
      const walked = await walk(tokens.admin, 1, action);
      expect(walked.every((entry) => entry.action === action)).toBe(true);
      expect(walked.map((entry) => entry.id)).toEqual(await snapshot(ids.demo, action));
      expect(walked.length).toBeGreaterThan(0);
    }
  });

  it('an empty tenant gets { items: [], nextCursor: null }, filtered or not', async () => {
    expect(await page(tokens.emptyAdmin, '', EMPTY_HOST)).toEqual({ items: [], nextCursor: null });
    expect(await page(tokens.emptyAdmin, '?action=member_blocked', EMPTY_HOST)).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('a tampered, a well-formed-but-bogus and an overlong cursor all answer page 1', async () => {
    const first = (await page(tokens.admin, '?limit=4')).items.map((entry) => entry.id);
    const bogus = Buffer.from(
      JSON.stringify({ v: 1, n: "2026-01-01'; drop table x; --", id: randomUUID() }),
    ).toString('base64url');
    for (const cursor of ['nao-e-um-cursor', bogus, 'a'.repeat(600)]) {
      const again = await page(tokens.admin, `?limit=4&cursor=${encodeURIComponent(cursor)}`);
      expect(again.items.map((entry) => entry.id)).toEqual(first);
    }
  });

  it('an unknown action is a 400, never a widened read', async () => {
    const res = await request('/v1/admin/moderation-log?action=tudo', tokens.admin);
    expect(res.status).toBe(400);
  });

  it('support and member get 403 FORBIDDEN', async () => {
    for (const token of [tokens.support, tokens.member]) {
      const res = await request('/v1/admin/moderation-log', token);
      expect(res.status).toBe(403);
      expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
    }
  });

  it('a rede-demo admin never sees a rede-lab row; the rede-lab admin does', async () => {
    const demo = await walk(tokens.admin, 50);
    expect(demo.some((entry) => entry.id === seeded.lab)).toBe(false);
    const labIds = (await walkOn(tokens.labAdmin, HOSTS.lab)).map((entry) => entry.id);
    expect(labIds).toContain(seeded.lab);
  });

  it('a rede-demo session on the rede-lab host gets 403 TENANT_HOST_MISMATCH', async () => {
    const res = await request('/v1/admin/moderation-log', tokens.admin, HOSTS.lab);
    expect(res.status).toBe(403);
    expect(((await res.json()) as Envelope).error.code).toBe('TENANT_HOST_MISMATCH');
  });

  it('isViewer marks the caller’s own rows only; a departed target reads displayName null', async () => {
    const all = await walk(tokens.admin, 50);
    const byId = new Map(all.map((entry) => [entry.id, entry]));

    const mine = byId.get(seeded.sameInstant[0] ?? '');
    expect(mine?.actor).toMatchObject({ membershipId: people.admin.membership, isViewer: true });
    expect(mine?.target.displayName).not.toBeNull();

    const theirs = byId.get(seeded.bySupport);
    expect(theirs?.actor).toMatchObject({
      membershipId: people.support.membership,
      isViewer: false,
    });
    expect(theirs?.actor.displayName).not.toBeNull();
    expect(theirs?.subjectType).toBe('story_comment');

    const departed = byId.get(seeded.departed);
    expect(departed?.target).toEqual({
      membershipId: people.departed.membership,
      displayName: null,
    });
  });

  it('a stored reason that is only whitespace reads as null (no "Motivo" line)', async () => {
    const all = await walk(tokens.admin, 50, 'member_blocked');
    expect(all.find((entry) => entry.id === seeded.blank)?.reason).toBeNull();
    expect(all.find((entry) => entry.id === seeded.departed)?.reason).toBe(`Saiu ${RUN}`);
  });

  it('a role change carries its from/to; a removal carries its excerpt; reading never writes', async () => {
    const before = await snapshot(ids.demo);
    const roles = await walk(tokens.admin, 50, 'role_changed');
    expect(roles[0]?.details).toEqual({ from: 'member', to: 'support_tenant' });
    expect(roles[0]?.excerpt).toBeNull();
    const removals = await walk(tokens.admin, 50, 'comment_removed');
    expect(removals.find((entry) => entry.id === seeded.sameInstant[0])?.excerpt).toMatch(
      new RegExp(`^Trecho ${RUN} \\d$`),
    );
    expect(await snapshot(ids.demo)).toEqual(before);
  });
});
