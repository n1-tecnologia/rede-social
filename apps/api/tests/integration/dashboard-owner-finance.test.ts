import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import {
  type OwnerFinanceReady,
  ownerFinanceAnswerSchema,
} from '@rede-social/module-dashboard/contracts';
import { runSnapshotBuild } from '@rede-social/module-dashboard/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dashboardDay,
  insertEventAt,
  insertFixturePost,
  insertLikeAt,
  insertMembershipAt,
  insertPaidOrderAt,
  insertProductAt,
  insertPurchaseEntitlement,
  removeDashboardFixtures,
  removeFixtureProducts,
  tenantIdOf,
} from './dashboard-fixture';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  SEED_PASSWORD,
  signInAs,
  withStoreEnabled,
} from './setup';

/**
 * Phase 08.7 — the owner's Financeiro on real data (08.7-09, D-455, D-460, D-462, D-465, UI-D-470,
 * UI-D-490, INSIGHT-12, INSIGHT-14, EP-37..EP-41). rede-lab ships with `store` OFF (STORE-01) and
 * no product, so every case turns the store on for the call and builds rede-lab with crafted rows
 * only: four products created long before every window, seven members joined 200 days ago, their
 * paid and revoked orders at explicit tenant-local instants.
 *
 * The cast (D = the tenant-local yesterday; every order at noon unless said):
 * - b1: PA at D-5 (primary), PB at D-2 (secondary) → bought twice, 3 days apart (PA → PB).
 * - b2: PA at D-10 (primary); PB at D-3 revoked at D-1 → never revenue, counted in `revoked` only.
 * - b3: PB at 23:59 of D (counts, EP-37) after a check-in at an event of D-1; PA at local 00:00
 *   today (after `untilAt`: does not count, EP-37).
 * - b4: PA and PB at the SAME instant of D-20: the lower id is primary (EP-37 tie).
 * - b5: PT at D-70 only (before both windows): its one order makes it never-again and PT stalled.
 * - b6: three likes on three posts (D-25, D-20, D-12) and PA at D-15, 5 days after the D-20 like
 *   → four active days (engaged), and a sale associated with that post.
 * - PS is never sold (created D-90): stalled. PB opens the exclusive community; b1, b3 and b4 hold
 *   it through their purchases.
 */

const PREFIX = `dash87f-${Date.now()}`;
const FINANCE = '/v1/dashboard/owner/finance';

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labAdmin: '' };
const tenants = { demo: '', lab: '' };
const users = { staff: '', b1: '', b2: '', b3: '', b4: '', b5: '', b6: '' };
const products = { pa: '', pb: '', ps: '', pt: '' };
const ids = {
  community: '',
  post1: '',
  post2: '',
  post3: '',
  event: '',
  b1pa: '',
  b4pa: '',
  b4pb: '',
};
/** D for rede-lab, as an ISO date. */
let labDay = '';

const request = (path: string, token: string | undefined, host: string) =>
  api.request(path, {
    headers: {
      [TENANT_HOST_HEADER]: host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

async function codeOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: { code?: string } }).error?.code;
}

/** `day` (an ISO date) minus `k` days. */
function dayMinus(day: string, k: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - k);
  return at.toISOString().slice(0, 10);
}

/** Rebuilds rede-lab for the explicit day `day` (its newest snapshot afterwards). */
async function buildLabFor(day: string): Promise<void> {
  await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.lab}::uuid`;
  expect(await runSnapshotBuild({ tenantId: tenants.lab, day })).toBe('built');
}

/** The stored `payload.finance` of rede-lab's newest snapshot, as text and as JSON. */
async function storedFinance(): Promise<{ text: string; json: Record<string, unknown> }> {
  const [row] = await adminSql<{ text: string }[]>`
    select (payload -> 'finance')::text as text from public.dashboard_snapshots
     where tenant_id = ${tenants.lab}::uuid order by snapshot_day desc limit 1`;
  if (!row) throw new Error('no rede-lab snapshot');
  return { text: row.text, json: JSON.parse(row.text) as Record<string, unknown> };
}

/** Turns a module on (or off) for rede-lab; the returned function restores the previous state. */
async function setLabModule(key: string, enabled: boolean) {
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenants.lab}::uuid and module_key = ${key}`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenants.lab}::uuid, ${key}, ${enabled})
    on conflict (tenant_id, module_key) do update set enabled = ${enabled}, updated_at = now()`;
  moduleFlags.invalidate(tenants.lab);
  return async () => {
    if (previous) {
      await adminSql`
        update public.tenant_modules set enabled = ${previous.enabled}, updated_at = now()
         where tenant_id = ${tenants.lab}::uuid and module_key = ${key}`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenants.lab}::uuid and module_key = ${key}`;
    }
    moduleFlags.invalidate(tenants.lab);
  };
}

/** The lab admin's Financeiro with the store on for the call (communities too when asked). */
async function labFinance(options: { communities?: boolean } = {}): Promise<OwnerFinanceReady> {
  const restores = [await setLabModule('store', true)];
  if (options.communities) restores.push(await setLabModule('communities', true));
  try {
    const res = await request(FINANCE, tokens.labAdmin, HOSTS.lab);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = ownerFinanceAnswerSchema.parse(await res.json());
    if (body.state !== 'ready') throw new Error('expected a ready finance answer');
    return body;
  } finally {
    for (const restore of restores.reverse()) await restore();
  }
}

beforeAll(async () => {
  await removeDashboardFixtures(PREFIX.replace(/-\d+$/, ''));
  tenants.demo = await tenantIdOf('rede-demo');
  tenants.lab = await tenantIdOf('rede-lab');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  labDay = await dashboardDay(tenants.lab);

  users.staff = (
    await createSharedIdentity({
      prefix: `${PREFIX}-staff`,
      memberships: [{ host: 'lab', role: 'support_tenant' }],
    })
  ).userId;
  for (const name of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] as const) {
    users[name] = (
      await insertMembershipAt({
        prefix: `${PREFIX}-${name}`,
        host: 'lab',
        daysAgo: 200,
        localTime: '10:00',
      })
    ).userId;
  }

  const tenantId = tenants.lab;
  products.pa = await insertProductAt({
    tenantId,
    name: 'Produto A 0897',
    priceCents: 1990,
    k: 100,
  });
  products.pb = await insertProductAt({
    tenantId,
    name: 'Produto B 0897',
    priceCents: 4990,
    k: 100,
  });
  products.ps = await insertProductAt({ tenantId, name: 'Produto S 0897', priceCents: 990, k: 90 });
  products.pt = await insertProductAt({
    tenantId,
    name: 'Produto T 0897',
    priceCents: 990,
    k: 100,
  });

  const order = (user: keyof typeof users, product: string, k: number, extra = {}) =>
    insertPaidOrderAt({
      tenantId,
      userId: users[user],
      productId: product,
      k,
      cents: product === products.pb ? 4990 : product === products.pa ? 1990 : 990,
      ...extra,
    });

  ids.b1pa = await order('b1', products.pa, 5);
  const b1pb = await order('b1', products.pb, 2);
  await order('b2', products.pa, 10);
  await order('b2', products.pb, 3, { revokedK: 1 });
  const b3pb = await order('b3', products.pb, 0, { localTime: '23:59' });
  await order('b3', products.pa, -1, { localTime: '00:00' });
  ids.b4pa = await order('b4', products.pa, 20);
  ids.b4pb = await order('b4', products.pb, 20);
  await order('b5', products.pt, 70);
  await order('b6', products.pa, 15);
  for (const orderId of [b1pb, b3pb, ids.b4pb]) {
    await insertPurchaseEntitlement({ tenantId, orderId });
  }

  // b6's likes: three posts, three days (with the D-15 order, four active days: engaged).
  ids.post1 = await insertFixturePost({ tenantId, authorUserId: users.staff });
  ids.post2 = await insertFixturePost({ tenantId, authorUserId: users.staff });
  ids.post3 = await insertFixturePost({ tenantId, authorUserId: users.staff });
  await insertLikeAt({ tenantId, userId: users.b6, postId: ids.post1, k: 25 });
  await insertLikeAt({ tenantId, userId: users.b6, postId: ids.post2, k: 20 });
  await insertLikeAt({ tenantId, userId: users.b6, postId: ids.post3, k: 12 });

  // b3 checks in at an event of D-1 (10 minutes after its noon start), then buys at 23:59 of D.
  ids.event = await insertEventAt({
    tenantId,
    authorUserId: users.staff,
    title: 'Encontro do caixa 0897',
    format: 'in_person',
    capacity: null,
    k: 1,
    localTime: '12:00',
    minutes: 60,
    attendances: [{ userId: users.b3, status: 'checked_in' }],
  });

  // The exclusive community, opened by PB.
  const [community] = await adminSql<{ id: string }[]>`
    insert into public.communities (tenant_id, created_by_user_id, name, slug, position)
    values (${tenantId}::uuid, ${users.staff}::uuid, 'Clube 0897', ${`clube-${PREFIX}`}, 99)
    returning id::text as id`;
  ids.community = community?.id ?? '';
  await adminSql`
    insert into public.store_product_communities (tenant_id, product_id, community_id)
    values (${tenantId}::uuid, ${products.pb}::uuid, ${ids.community}::uuid)`;
});

afterAll(async () => {
  await removeFixtureProducts(Object.values(products).filter(Boolean));
  if (ids.community) {
    await adminSql`delete from public.communities where id = ${ids.community}::uuid`;
  }
  await removeDashboardFixtures(PREFIX);
});

describe('08.7 finance', () => {
  it('INSIGHT-12: primary and secondary, revoked never revenue, by product with entries and add-ons (EP-37)', async () => {
    await buildLabFor(labDay);
    const body = await labFinance();
    const [b4Primary] = [ids.b4pa, ids.b4pb].sort();
    const b4FirstIsPa = b4Primary === ids.b4pa;

    // Seven paid orders of the window: b1 ×2, b2, b3, b4 ×2, b6. b2's PB was revoked (never
    // revenue) and b3's PA came at 00:00 today (after untilAt); b5's PT is before both windows.
    expect(body.totals.current).toEqual({ orders: 7, cents: 4 * 1990 + 3 * 4990, buyers: 5 });
    expect(body.totals.previous).toEqual({ orders: 0, cents: 0, buyers: 0 });
    // Primary: b1 PA, b2 PA, b3 PB, b6 PA and b4's lower id; secondary: b1 PB and b4's other.
    expect(body.primary.current).toEqual({
      orders: 5,
      cents: 3 * 1990 + 4990 + (b4FirstIsPa ? 1990 : 4990),
    });
    expect(body.secondary.current).toEqual({
      orders: 2,
      cents: 4990 + (b4FirstIsPa ? 4990 : 1990),
    });
    // The revocation counts in `revoked` only, and a group of 1 is floored.
    expect(body.revoked.current).toEqual({ belowFloor: true });
    expect(body.revoked.previous).toEqual({ belowFloor: false, orders: 0, cents: 0, buyers: 0 });

    const mine = body.byProduct.filter((row) => Object.values(products).includes(row.productId));
    // EP-39: cents desc, then the live name (S before T), then the id.
    expect(mine.map((row) => row.productId)).toEqual([
      products.pb,
      products.pa,
      products.ps,
      products.pt,
    ]);
    const pa = mine.find((row) => row.productId === products.pa);
    const pb = mine.find((row) => row.productId === products.pb);
    expect(pa).toMatchObject({
      name: 'Produto A 0897',
      priceCents: 1990,
      status: 'active',
      current: {
        orders: 4,
        cents: 4 * 1990,
        buyers: 4,
        entry: b4FirstIsPa ? 4 : 3,
        addon: b4FirstIsPa ? 0 : 1,
      },
    });
    expect(pb).toMatchObject({
      current: {
        orders: 3,
        cents: 3 * 4990,
        buyers: 3,
        entry: b4FirstIsPa ? 1 : 2,
        addon: b4FirstIsPa ? 2 : 1,
      },
    });
    // EP-37: 23:59 of D is the last minute before untilAt, and it is PB's last sale.
    expect(Date.parse(body.snapshot.windows.untilAt) - Date.parse(pb?.lastSaleAt ?? '')).toBe(
      60_000,
    );
    expect(body.offers).toEqual({ measured: false, reason: 'needs_offers' });
    expect(body.paidEvents).toEqual({ measured: false, reason: 'needs_event_tickets' });
    expect(body.attention.expiring).toEqual({ measured: false, reason: 'needs_access_expiry' });
    expect(body.attention.fullEvents).toEqual({ measured: false, reason: 'needs_waitlist' });
  });

  it('INSIGHT-12: the summary at D and at D-30, the ladder by product and never-again, floored (D-462)', async () => {
    await buildLabFor(labDay);
    const body = await labFinance();
    const [base] = await adminSql<{ now: number; then: number }[]>`
      select count(*) filter (where m.joined_at < ${body.snapshot.windows.untilAt}::timestamptz)::int as now,
             count(*) filter (where m.joined_at < ${body.snapshot.windows.from30At}::timestamptz)::int as then
        from public.memberships m
       where m.tenant_id = ${tenants.lab}::uuid and m.role = 'member' and m.status = 'active'
         and m.blocked_at is null and m.deleted_at is null`;
    // b1 bought again 3 days later, b4 the same day: median 1.5.
    expect(body.summary.current).toEqual({
      base: base?.now,
      rebought: 2,
      timeToSecondDays: 1.5,
      lifetimeCents: 4 * 1990 + 3 * 4990 + 990,
    });
    expect(body.summary.previous).toEqual({
      base: base?.then,
      rebought: 0,
      timeToSecondDays: null,
      lifetimeCents: 990,
    });

    // The raw ladder keeps every path; the answer sums the small ones and floors them.
    const stored = (await storedFinance()).json as {
      ladder: { entryProductId: string; nextProductId: string; people: number }[];
    };
    const [b4First, b4Second] = [ids.b4pa, ids.b4pb].sort();
    const b4Path = b4First === ids.b4pa ? [products.pa, products.pb] : [products.pb, products.pa];
    const paths = stored.ladder.map((p) => `${p.entryProductId}>${p.nextProductId}:${p.people}`);
    if (b4Path[0] === products.pa) {
      expect(paths).toEqual([`${products.pa}>${products.pb}:2`]);
      expect(body.ladder).toEqual({ paths: [], others: { belowFloor: true, paths: 1 } });
    } else {
      expect(paths.sort()).toEqual(
        [`${products.pa}>${products.pb}:1`, `${products.pb}>${products.pa}:1`].sort(),
      );
      expect(body.ladder).toEqual({ paths: [], others: { belowFloor: true, paths: 2 } });
    }
    expect(b4Second).toBeTruthy();

    // Never again: b2 and b3 (occasional), b5 (inactive), b6 (engaged) — every band under 5.
    expect((stored as unknown as { neverAgain: Record<string, number> }).neverAgain).toMatchObject({
      occasional: 2,
      inactive: 1,
      engaged: 1,
    });
    expect(body.neverAgain.occasional).toEqual({ belowFloor: true });
    expect(body.neverAgain.superfan).toEqual({ belowFloor: false, value: 0 });
  });

  it('D-462 / INSIGHT-14: a floored band carries no count and no cents in the JSON; a band of 0 is 0', async () => {
    await buildLabFor(labDay);
    const restore = await setLabModule('store', true);
    try {
      const res = await request(FINANCE, tokens.labAdmin, HOSTS.lab);
      const raw = await res.text();
      const body = JSON.parse(raw) as { byBand: Record<string, Record<string, unknown>> };
      // The four occasional buyers' 6 orders (20940 cents) and b6's engaged order are floored.
      expect(body.byBand.occasional).toEqual({ belowFloor: true });
      expect(body.byBand.engaged).toEqual({ belowFloor: true });
      expect(JSON.stringify(body.byBand)).not.toContain('20940');
      expect(body.byBand.superfan).toEqual({ belowFloor: false, orders: 0, cents: 0, buyers: 0 });
      const stored = await storedFinance();
      expect(stored.text).toContain('20940');
    } finally {
      await restore();
    }
  });

  it('INSIGHT-12: stalled products (active, unsold for more than 60 days), longest first', async () => {
    await buildLabFor(labDay);
    const body = await labFinance();
    const mine = body.attention.stalled.filter((row) =>
      Object.values(products).includes(row.productId),
    );
    expect(mine.map((row) => [row.productId, row.days])).toEqual([
      [products.ps, 90],
      [products.pt, 70],
    ]);
    expect(mine[0]).toMatchObject({ name: 'Produto S 0897', lastSaleAt: null });
  });

  it('planning decision 4: sales associated with a post (7 days after a like) and an event check-in, floored', async () => {
    await buildLabFor(labDay);
    const stored = (await storedFinance()).json as {
      contentSales: { posts: { postId: string; orders: number }[] };
      eventSales: { events: { eventId: string; orders: number }[] };
    };
    // b6's PA at D-15 came 5 days after the D-20 like on post2 (the D-25 one is 10 days before,
    // the D-12 one after); b3's PB at 23:59 of D came the day after the check-in.
    expect(stored.contentSales.posts.map((post) => [post.postId, post.orders])).toEqual([
      [ids.post2, 1],
    ]);
    expect(stored.eventSales.events.map((event) => [event.eventId, event.orders])).toEqual([
      [ids.event, 1],
    ]);
    const body = await labFinance();
    expect(body.contentSales).toEqual({
      posts: [
        {
          postId: ids.post2,
          sales: { belowFloor: true },
          products: [{ productId: products.pa, sales: { belowFloor: true } }],
        },
      ],
      total: { belowFloor: true },
    });
    expect(body.eventSales).toEqual({
      events: [
        { eventId: ids.event, title: 'Encontro do caixa 0897', sales: { belowFloor: true } },
      ],
      total: { belowFloor: true },
    });
  });

  it('UI-D-490: the VIP block names the exclusive community with the most holders; null with communities off', async () => {
    await buildLabFor(labDay);
    const off = await labFinance();
    expect(off.vip).toBeNull();
    expect(off.attention.vipFading).toBeNull();

    const on = await labFinance({ communities: true });
    // b1, b3 and b4 hold PB; b6 (engaged, entered through PA) does not.
    expect(on.vip).toEqual({
      communityId: ids.community,
      communityName: 'Clube 0897',
      entryProductId: products.pa,
      entryProductName: 'Produto A 0897',
      holders: 3,
      fading: { atRisk: 0, inactive: 0, withPush: 0 },
      prospects: 1,
      revenueCents: 3 * 4990,
    });
    expect(on.attention.vipFading).toEqual({ atRisk: 0, inactive: 0, withPush: 0 });
  });

  it('EP-38: no product as of the day → byProduct [], zero totals as values and no ladder; products and no order in the window → listed with 0, the unsold for 60+ days stalled', async () => {
    // L = D-150: every fixture product was created at D-100 or later.
    await buildLabFor(dayMinus(labDay, 150));
    const empty = await labFinance();
    expect(
      empty.byProduct.filter((row) => Object.values(products).includes(row.productId)),
    ).toEqual([]);
    expect(empty.totals.current).toEqual({ orders: 0, cents: 0, buyers: 0 });
    expect(empty.revoked.current).toEqual({ belowFloor: false, orders: 0, cents: 0, buyers: 0 });
    expect(empty.ladder).toEqual({ paths: [], others: null });

    // L = D-35: its window D-64..D-35 holds no fixture order; PA and PB were created 65 days
    // before L and never sold by then (stalled, tie by id); PS 55 days (not yet); PT sold at D-70.
    await buildLabFor(dayMinus(labDay, 35));
    const quiet = await labFinance();
    const mine = quiet.byProduct.filter((row) => Object.values(products).includes(row.productId));
    expect(mine).toHaveLength(4);
    for (const row of mine) expect(row.current.orders).toBe(0);
    expect(mine.find((row) => row.productId === products.pt)?.previous).toEqual({
      orders: 1,
      cents: 990,
      buyers: 1,
    });
    const stalled = quiet.attention.stalled
      .filter((row) => Object.values(products).includes(row.productId))
      .map((row) => [row.productId, row.days]);
    expect(stalled).toEqual([products.pa, products.pb].sort().map((productId) => [productId, 65]));
  });

  it('EP-40 / EP-41: a forced rebuild over unchanged rows is byte-identical, and a revoke after untilAt changes nothing', async () => {
    await buildLabFor(labDay);
    const first = (await storedFinance()).text;
    await buildLabFor(labDay);
    expect((await storedFinance()).text).toBe(first);

    // b1's PA is revoked NOW (after untilAt): the snapshot of D still counts it as paid.
    await adminSql`
      update public.store_orders set status = 'revoked', revoked_at = now()
       where id = ${ids.b1pa}::uuid`;
    try {
      await buildLabFor(labDay);
      expect((await storedFinance()).text).toBe(first);
    } finally {
      await adminSql`
        update public.store_orders set status = 'paid', revoked_at = null
         where id = ${ids.b1pa}::uuid`;
    }
  });

  it('D-460: with the store off the route answers 404 MODULE_DISABLED before the role check', async () => {
    const restore = await setLabModule('store', false);
    try {
      const res = await request(FINANCE, tokens.labAdmin, HOSTS.lab);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe('MODULE_DISABLED');
    } finally {
      await restore();
    }
  });

  it('with the store on the role gate answers — 403 FORBIDDEN for the support team and a member, 401 with no session', async () => {
    const restore = await withStoreEnabled('demo');
    try {
      for (const token of [tokens.demoSupport, tokens.demoMember]) {
        const res = await request(FINANCE, token, HOSTS.demo);
        expect(res.status).toBe(403);
        expect(await codeOf(res)).toBe('FORBIDDEN');
      }
      expect((await request(FINANCE, undefined, HOSTS.demo)).status).toBe(401);
    } finally {
      await restore();
    }
  });

  it('preparing before the first build of the tenant', async () => {
    await adminSql`delete from public.dashboard_snapshots where tenant_id = ${tenants.lab}::uuid`;
    const restore = await setLabModule('store', true);
    try {
      const res = await request(FINANCE, tokens.labAdmin, HOSTS.lab);
      expect(res.status).toBe(200);
      expect(ownerFinanceAnswerSchema.parse(await res.json())).toEqual({ state: 'preparing' });
    } finally {
      await restore();
    }
  });
});
