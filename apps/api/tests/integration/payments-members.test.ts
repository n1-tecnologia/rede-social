import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import type { AdminMember, AdminMemberPage } from '@rede-social/contracts/moderation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  signInAs,
  withPaymentsGate,
} from './setup';

/**
 * 09.1-11 (PAY-16, PAY-18; D-498, D-500, D-489): the admin-side surface of a cut, against the live
 * local stack. The Membros list marks a member whose subscription is not active, can filter them, and
 * the single read behind the sheet carries the same flag; a block outranks and shows alone; a cut and a
 * return write no moderation row, no notification and no counter. Task 2 adds the dashboard population.
 *
 * EVERY identity here is a THROWAWAY (`createSharedIdentity`, never a seed user), named so the cases can
 * find them in a list that also holds the seed members. With the gate on, the seed members of rede-lab
 * may be cut too, so set-wide expectations are computed from `app.access_cut_user_ids` itself and the
 * targeted ones name the throwaway identities. Fixtures and access rows are removed by prefix.
 */

const PREFIX = 'paymbr';
const NAME = 'Pmb';
const TWIN = `${NAME} Homonimo`;

const ids = { lab: '', demo: '' };
type Person = { userId: string; email: string; membershipId: string; token: string };
const who: Record<
  'admin' | 'support' | 'granted' | 'cut' | 'blockedCut' | 'twinCut' | 'twinGranted' | 'dual',
  Person
> = {} as never;
let demoAdmin: Person;
let demoDual: { membershipId: string };

async function build(
  host: keyof typeof HOSTS,
  role: 'member' | 'admin_tenant' | 'support_tenant',
  displayName: string,
  status: 'active' | 'blocked' = 'active',
): Promise<Person> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host, role, status, displayName }],
  });
  return finish(identity, host);
}

async function finish(
  identity: { userId: string; email: string; password: string },
  host: keyof typeof HOSTS,
): Promise<Person> {
  const tenantId = host === 'lab' ? ids.lab : ids.demo;
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from public.memberships
     where tenant_id = ${tenantId}::uuid and user_id = ${identity.userId}::uuid`;
  return {
    userId: identity.userId,
    email: identity.email,
    membershipId: row?.id ?? '',
    token: await signInAs(identity.email, identity.password),
  };
}

const labCall = (path: string, token = who.admin.token, host: string = HOSTS.lab) =>
  api.request(path, { headers: { [TENANT_HOST_HEADER]: host, authorization: `Bearer ${token}` } });

async function readPage(query = '', token = who.admin.token, host: string = HOSTS.lab) {
  const res = await labCall(`/v1/admin/members${query}`, token, host);
  expect(res.status, `GET /v1/admin/members${query}`).toBe(200);
  return (await res.json()) as AdminMemberPage;
}

/** Walks every page of a query, asserting that no membership is listed twice. */
async function walk(query: string, limit: number, token = who.admin.token, host?: string) {
  const items: AdminMember[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let guard = 0; guard < 200; guard += 1) {
    const qs: string = `?${query}${query ? '&' : ''}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page: AdminMemberPage = await readPage(qs, token, host);
    for (const item of page.items) {
      expect(seen.has(item.membershipId), `repeated ${item.membershipId}`).toBe(false);
      seen.add(item.membershipId);
      items.push(item);
    }
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error('the walk did not end');
}

const idsOf = (items: AdminMember[]) => items.map((item) => item.membershipId);

async function grant(email: string): Promise<void> {
  await adminSql`
    insert into public.access_grants (tenant_id, email, source, status)
    values (${ids.lab}::uuid, ${email}, 'manual', 'active')`;
}

async function ungrant(email: string): Promise<void> {
  await adminSql`
    delete from public.access_grants where tenant_id = ${ids.lab}::uuid and email = ${email}`;
}

/** The active, not-blocked member-role memberships of rede-lab whose user is in the cut set, from SQL. */
async function cutMembershipIds(): Promise<string[]> {
  const rows = await adminSql<{ id: string }[]>`
    select m.id::text as id
      from public.memberships m
     where m.tenant_id = ${ids.lab}::uuid
       and m.deleted_at is null
       and m.role = 'member'
       and m.status = 'active' and m.blocked_at is null
       and m.user_id = any (app.access_cut_user_ids(${ids.lab}::uuid))`;
  return rows.map((row) => row.id);
}

async function fingerprint(person: Person) {
  const [row] = await adminSql<Record<string, unknown>[]>`
    select (select count(*)::int from public.feed_posts where author_user_id = ${person.userId}::uuid) as posts,
           (select count(*)::int from public.feed_comments where author_user_id = ${person.userId}::uuid) as comments,
           (select count(*)::int from public.feed_likes where user_id = ${person.userId}::uuid) as likes,
           (select count(*)::int from public.course_lesson_progress where user_id = ${person.userId}::uuid) as progress,
           (select md5(mp::text) from public.member_profiles mp where mp.membership_id = ${person.membershipId}::uuid) as profile,
           (select md5(m::text) from public.memberships m where m.id = ${person.membershipId}::uuid) as membership`;
  return row;
}

async function moderationCount(): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.moderation_log where tenant_id = ${ids.lab}::uuid`;
  return row?.n ?? 0;
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.access_grants where email like ${`${PREFIX}-%`}`;
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  ids.lab = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';
  ids.demo = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  if (!ids.lab || !ids.demo) throw new Error('seed tenants missing — run pnpm db:seed first');
  await sweep();

  who.admin = await build('lab', 'admin_tenant', `${NAME} Admin`);
  who.support = await build('lab', 'support_tenant', `${NAME} Suporte`);
  who.granted = await build('lab', 'member', `${NAME} Granted`);
  who.cut = await build('lab', 'member', `${NAME} Cut`);
  who.blockedCut = await build('lab', 'member', `${NAME} Blocked`, 'blocked');
  who.twinCut = await build('lab', 'member', TWIN);
  who.twinGranted = await build('lab', 'member', TWIN);
  demoAdmin = await build('demo', 'admin_tenant', `${NAME} Demo Admin`);

  // One identity in two tenants (P30): cut in rede-lab, plain member of rede-demo.
  const dual = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [
      { host: 'lab', role: 'member', displayName: `${NAME} Dual` },
      { host: 'demo', role: 'member', displayName: `${NAME} Dual` },
    ],
  });
  who.dual = await finish(dual, 'lab');
  const [demoRow] = await adminSql<{ id: string }[]>`
    select id::text as id from public.memberships
     where tenant_id = ${ids.demo}::uuid and user_id = ${dual.userId}::uuid`;
  demoDual = { membershipId: demoRow?.id ?? '' };

  await grant(who.granted.email);
  await grant(who.twinGranted.email);
  // `blockedCut` has no access row at all: it is cut AND blocked.
});

afterAll(async () => {
  await sweep();
  await adminSql`
    delete from public.tenant_modules
     where tenant_id = ${ids.lab}::uuid and module_key = 'payments'`;
});

describe('09.1 tracer', () => {
  it('lists the cut member flagged with status active, and only the cut member', async () => {
    await withPaymentsGate(ids.lab, async () => {
      const list = await walk('', 50);
      const byId = new Map(list.map((item) => [item.membershipId, item]));

      const cut = byId.get(who.cut.membershipId);
      expect(cut).toMatchObject({ status: 'active', role: 'member', subscriptionPending: true });

      for (const person of [who.granted, who.twinGranted, who.admin, who.support]) {
        const row = byId.get(person.membershipId);
        expect(row, person.email).toBeDefined();
        expect(row && 'subscriptionPending' in row, person.email).toBe(false);
      }
      expect(byId.get(who.twinCut.membershipId)?.subscriptionPending).toBe(true);

      // The flag is a projection of the set the gate uses: exactly the SQL set, nobody else.
      const flagged = list.filter((item) => item.subscriptionPending === true);
      expect(idsOf(flagged).sort()).toEqual((await cutMembershipIds()).sort());
      for (const item of list) {
        if ('subscriptionPending' in item) expect(item.subscriptionPending).toBe(true);
      }
    });
  });

  it('?status=subscription_pending returns exactly the cut members in the same total order', async () => {
    await withPaymentsGate(ids.lab, async () => {
      const all = await walk('', 50);
      const filtered = await walk('status=subscription_pending', 50);
      const expected = new Set(await cutMembershipIds());

      expect(new Set(idsOf(filtered))).toEqual(expected);
      expect(filtered.every((item) => item.status === 'active')).toBe(true);
      expect(idsOf(filtered)).toContain(who.cut.membershipId);
      expect(idsOf(filtered)).not.toContain(who.granted.membershipId);
      expect(idsOf(filtered)).not.toContain(who.blockedCut.membershipId);
      expect(idsOf(filtered)).not.toContain(who.admin.membershipId);
      expect(idsOf(filtered)).not.toContain(who.support.membershipId);

      // Same total order as every other filter: the filtered list is a subsequence of `all`.
      expect(idsOf(all).filter((id) => expected.has(id))).toEqual(idsOf(filtered));
    });
  });

  it('the sheet read carries the same flag, and the status of the cut member is untouched', async () => {
    const statusOf = async () => {
      const [row] = await adminSql<{ status: string; blocked_at: Date | null }[]>`
        select status, blocked_at from public.memberships where id = ${who.cut.membershipId}::uuid`;
      return row;
    };
    const before = await statusOf();
    await withPaymentsGate(ids.lab, async () => {
      const sheet = await labCall(`/v1/admin/members/${who.cut.membershipId}`);
      expect(sheet.status).toBe(200);
      expect(await sheet.json()).toMatchObject({
        membershipId: who.cut.membershipId,
        status: 'active',
        subscriptionPending: true,
      });
      const granted = (await (
        await labCall(`/v1/admin/members/${who.granted.membershipId}`)
      ).json()) as AdminMember;
      expect('subscriptionPending' in granted).toBe(false);
    });
    const after = await statusOf();
    expect(before).toMatchObject({ status: 'active', blocked_at: null });
    expect(after).toEqual(before);
  });

  it('a member both blocked and cut shows only blocked, and is absent from the filter (D-489)', async () => {
    await withPaymentsGate(ids.lab, async () => {
      const list = await walk('', 50);
      const row = list.find((item) => item.membershipId === who.blockedCut.membershipId);
      expect(row).toMatchObject({ status: 'blocked' });
      expect(row && 'subscriptionPending' in row).toBe(false);

      const filtered = await walk('status=subscription_pending', 50);
      expect(idsOf(filtered)).not.toContain(who.blockedCut.membershipId);

      const sheet = (await (
        await labCall(`/v1/admin/members/${who.blockedCut.membershipId}`)
      ).json()) as AdminMember;
      expect(sheet.status).toBe('blocked');
      expect('subscriptionPending' in sheet).toBe(false);
    });
  });

  it('a cut changes no post, comment, like, profile, progress or membership row (PAY-16)', async () => {
    await adminSql`
      with p as (
        insert into public.feed_posts (tenant_id, author_user_id, caption)
        values (${ids.lab}::uuid, ${who.cut.userId}::uuid, 'pmb post')
        returning id)
      insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
      select ${ids.lab}::uuid, p.id, ${who.cut.userId}::uuid, 'pmb comment' from p`;
    const [post] = await adminSql<{ id: string }[]>`
      select id::text as id from public.feed_posts where author_user_id = ${who.cut.userId}::uuid limit 1`;
    await adminSql`
      insert into public.feed_likes (tenant_id, user_id, post_id)
      values (${ids.lab}::uuid, ${who.cut.userId}::uuid, ${post?.id ?? ''}::uuid)`;

    const before = await fingerprint(who.cut);
    expect(before).toMatchObject({ posts: 1, comments: 1, likes: 1 });
    await withPaymentsGate(ids.lab, async () => {
      const flagged = await walk('status=subscription_pending', 50);
      expect(idsOf(flagged)).toContain(who.cut.membershipId);
      expect(await fingerprint(who.cut)).toEqual(before);

      // a return and a second cut
      await grant(who.cut.email);
      expect(idsOf(await walk('status=subscription_pending', 50))).not.toContain(
        who.cut.membershipId,
      );
      await ungrant(who.cut.email);
      expect(idsOf(await walk('status=subscription_pending', 50))).toContain(who.cut.membershipId);
      expect(await fingerprint(who.cut)).toEqual(before);
    });
  });

  it('with the gate off or the module disabled no row carries the key and the filter is empty', async () => {
    for (const options of [{ gate: false }, { enabled: false }, { settings: {} }]) {
      await withPaymentsGate(
        ids.lab,
        async () => {
          const list = await walk('', 50);
          expect(list.length).toBeGreaterThan(0);
          expect(list.some((item) => 'subscriptionPending' in item)).toBe(false);
          const filtered = await readPage('?status=subscription_pending');
          expect(filtered).toEqual({ items: [], nextCursor: null });
        },
        options,
      );
    }
    // No payments row at all behaves the same.
    const list = await walk('', 50);
    expect(list.some((item) => 'subscriptionPending' in item)).toBe(false);
  });
});

describe('09.1 members edges', () => {
  it('P30: an identity cut in tenant A and active in tenant B is flagged only in A', async () => {
    await withPaymentsGate(ids.lab, async () => {
      const lab = await walk('', 50);
      expect(lab.find((i) => i.membershipId === who.dual.membershipId)).toMatchObject({
        subscriptionPending: true,
      });
      const demo = await walk('', 50, demoAdmin.token, HOSTS.demo);
      const row = demo.find((i) => i.membershipId === demoDual.membershipId);
      expect(row).toMatchObject({ status: 'active' });
      expect(row && 'subscriptionPending' in row).toBe(false);
      expect(demo.some((item) => 'subscriptionPending' in item)).toBe(false);
      const demoFiltered = await readPage(
        '?status=subscription_pending',
        demoAdmin.token,
        HOSTS.demo,
      );
      expect(demoFiltered).toEqual({ items: [], nextCursor: null });
      // The foreign membership never appears in the other tenant's list.
      expect(idsOf(lab)).not.toContain(demoDual.membershipId);
    });
  });

  it('P30: two members sharing a display name keep stable adjacent slots, the flag on one of them', async () => {
    await withPaymentsGate(ids.lab, async () => {
      const first = await walk(`q=${encodeURIComponent(TWIN)}`, 50);
      expect(first).toHaveLength(2);
      expect(first.filter((i) => i.subscriptionPending === true)).toHaveLength(1);
      expect(first.find((i) => i.subscriptionPending)?.membershipId).toBe(who.twinCut.membershipId);
      const oneByOne = await walk(`q=${encodeURIComponent(TWIN)}`, 1);
      expect(idsOf(oneByOne)).toEqual(idsOf(first));
    });
  });

  it('P31: nobody cut answers an empty page with a null cursor, and a fully granted gated tenant shows no flag', async () => {
    const inserted = await adminSql<{ id: string }[]>`
      insert into public.access_grants (tenant_id, email, source, status)
      select m.tenant_id, lower(u.email), 'manual', 'active'
        from public.memberships m
        join public.users u on u.id = m.user_id
       where m.tenant_id = ${ids.lab}::uuid and m.role = 'member' and m.deleted_at is null
         and not exists (select 1 from public.access_grants g
                          where g.tenant_id = m.tenant_id and g.email = lower(u.email))
      returning id::text as id`;
    try {
      await withPaymentsGate(ids.lab, async () => {
        const filtered = await readPage('?status=subscription_pending');
        expect(filtered).toEqual({ items: [], nextCursor: null });
        const list = await walk('', 50);
        expect(list.some((item) => 'subscriptionPending' in item)).toBe(false);
      });
    } finally {
      if (inserted.length > 0) {
        await adminSql`
          delete from public.access_grants where id = any(${inserted.map((r) => r.id)}::uuid[])`;
      }
    }
  });

  it('P32/P33: the filtered keyset walks a page boundary that falls on a flagged row, no repeat or skip', async () => {
    await withPaymentsGate(ids.lab, async () => {
      const full = await readPage('?status=subscription_pending&limit=50');
      expect(full.items.length).toBeGreaterThanOrEqual(3);
      const total = full.items.length;
      expect(full.nextCursor).toBeNull();
      for (const limit of [1, 2, 3]) {
        const walked = await walk('status=subscription_pending', limit);
        expect(idsOf(walked)).toEqual(idsOf(full.items));
        expect(walked).toHaveLength(total);
      }
      // `all` with a page size that cuts through flagged rows visits every membership once.
      const allBig = await walk('', 50);
      expect(idsOf(await walk('', 3))).toEqual(idsOf(allBig));
      // Exact integers from SQL: the filtered count is the SQL count.
      expect(total).toBe((await cutMembershipIds()).length);
      // limit clamps as before.
      expect((await readPage('?status=subscription_pending&limit=0')).items).toHaveLength(1);
    });
  });

  it('P34: reading the list, the filter or the sheet twice answers the same rows', async () => {
    await withPaymentsGate(ids.lab, async () => {
      for (const query of ['', '?status=subscription_pending', '?status=active&limit=7']) {
        expect(await readPage(query)).toEqual(await readPage(query));
      }
      const url = `/v1/admin/members/${who.cut.membershipId}`;
      expect(await (await labCall(url)).json()).toEqual(await (await labCall(url)).json());
    });
  });

  it('P35: a cut and a return between two page requests never error or list a membership twice', async () => {
    await withPaymentsGate(ids.lab, async () => {
      const first = await readPage('?limit=2');
      expect(first.nextCursor).not.toBeNull();
      await grant(who.cut.email); // a return while the admin is mid-walk
      await ungrant(who.granted.email); // and a cut
      try {
        const seen = new Set(idsOf(first.items));
        let cursor = first.nextCursor;
        for (let guard = 0; cursor !== null && guard < 200; guard += 1) {
          const next: AdminMemberPage = await readPage(
            `?limit=2&cursor=${encodeURIComponent(cursor)}`,
          );
          for (const item of next.items) {
            expect(seen.has(item.membershipId)).toBe(false);
            seen.add(item.membershipId);
          }
          cursor = next.nextCursor;
        }
      } finally {
        await ungrant(who.cut.email);
        await grant(who.granted.email);
      }
    });
  });
});

describe('09.1 admin surface (PAY-18, D-500)', () => {
  const adminSurface = async () => {
    const counters = await (await labCall('/v1/me/counters')).text();
    const notifications = await (await labCall('/v1/notifications')).text();
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${ids.lab}::uuid and user_id = ${who.admin.userId}::uuid`;
    return { counters, notifications, stored: row?.n ?? 0 };
  };

  it('P37/P38: a cut and a return write no log row, no notification and change no counter', async () => {
    const logBefore = await moderationCount();
    const surfaceBefore = await adminSurface();
    await withPaymentsGate(ids.lab, async () => {
      expect(idsOf(await walk('status=subscription_pending', 50))).toContain(who.cut.membershipId);
      await grant(who.cut.email); // return
      await ungrant(who.cut.email); // cut again
      expect(idsOf(await walk('status=subscription_pending', 50))).toContain(who.cut.membershipId);
    });
    expect(await moderationCount()).toBe(logBefore);
    expect(await adminSurface()).toEqual(surfaceBefore);
    const kinds = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${ids.lab}::uuid and (kind like '%access%' or kind like '%subscription%')`;
    expect(kinds[0]?.n).toBe(0);
  });

  it('P37: a block of another member writes its row and none for the cut; blocked, cut, unblocked logs only block and unblock', async () => {
    const victim = who.granted;
    const call = (action: 'block' | 'unblock', membershipId: string) =>
      api.request(`/v1/admin/members/${membershipId}/${action}`, {
        method: 'POST',
        headers: {
          [TENANT_HOST_HEADER]: HOSTS.lab,
          authorization: `Bearer ${who.admin.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
    const rowsFor = async (membershipId: string) =>
      adminSql<{ action: string }[]>`
        select action from public.moderation_log
         where target_membership_id = ${membershipId}::uuid order by created_at, id`;

    await withPaymentsGate(ids.lab, async () => {
      const cutLogBefore = (await rowsFor(who.cut.membershipId)).length;
      expect((await call('block', victim.membershipId)).status).toBe(200);
      expect((await rowsFor(victim.membershipId)).map((r) => r.action)).toEqual(['member_blocked']);
      expect(await rowsFor(who.cut.membershipId)).toHaveLength(cutLogBefore);

      // the blocked member now also loses the access row: blocked, then cut, then unblocked
      await ungrant(victim.email);
      const during = await walk('', 50);
      expect(during.find((i) => i.membershipId === victim.membershipId)).toMatchObject({
        status: 'blocked',
      });
      expect((await call('unblock', victim.membershipId)).status).toBe(200);
      expect((await rowsFor(victim.membershipId)).map((r) => r.action)).toEqual([
        'member_blocked',
        'member_unblocked',
      ]);
      const after = await walk('', 50);
      expect(after.find((i) => i.membershipId === victim.membershipId)).toMatchObject({
        status: 'active',
        subscriptionPending: true,
      });
      await grant(victim.email);
    });
  });

  it('P39: a cut changes neither the order of the Membros list nor of the moderation log', async () => {
    const logOf = async () => await (await labCall('/v1/admin/moderation-log?limit=50')).text();
    const orderOff = idsOf(await walk('', 50));
    const logOff = await logOf();
    await withPaymentsGate(ids.lab, async () => {
      expect(idsOf(await walk('', 50))).toEqual(orderOff);
      expect(await logOf()).toEqual(logOff);
    });
  });
});
