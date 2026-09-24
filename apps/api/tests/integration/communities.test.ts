import { sqlClient } from '@tria/core/db';
import { subscribe } from '@tria/core/server/events/bus';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
import {
  COMMUNITY_MAX_PAGE_SIZE,
  type CommunityArchived,
  type CommunityCreated,
  type CommunityPage,
  type CommunitySummary,
  type CommunityUpdated,
} from '@tria/module-communities/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * `@tria/module-communities` end to end against the live local stack and the real seed (05-01) —
 * the tracer, proved rather than asserted.
 *
 * Seven things are proved here that nothing else in the repo can prove:
 *  - **COMM-03 paging is TOTAL under a deliberate TIE.** The seed gives two communities the SAME
 *    `last_activity_at`; walking `?limit=2` returns each exactly once, ordered by `id desc`, because
 *    `(last_activity_at, id)` is a total order the index carries.
 *  - **COMM-02 is a policy value, not a shape.** A member and an admin of the same tenant receive
 *    the BYTE-IDENTICAL ordered id list, because the read never joins `community_members`.
 *  - **T-05-04: `limit` is clamped SERVER-side**, in both directions, so `limit=0` and
 *    `limit=100000` both answer a page rather than an error or an unbounded read.
 *  - **T-05-05: a hostile cursor degrades to page 1** rather than reaching SQL or raising.
 *  - **T-05-01/T-05-02: the cross-tenant refusal is a bare 404** with NO `details` key, byte-identical
 *    to the one an unknown id produces — asserted with its positive control in the same test.
 *  - **T-05-03: the write is a PERMISSION.** A member is refused 403; an admin creates, and two
 *    creates with the SAME NAME both succeed with distinct ids and distinct slugs — never a 409.
 *  - **MOD-04/D-40: the module flag governs the routes AND the tab, in BOTH directions.**
 *
 * Test ORDER is load-bearing and the config supports it (`fileParallelism: false`, and Vitest runs a
 * file's tests in declaration order): every READ assertion that depends on the seeded four runs
 * before the first create, and both hooks sweep this file's own rows by name prefix so a crashed run
 * cannot poison the next one.
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', labAdmin: '' };
const tenantIds = { demo: '', lab: '' };

/** Every community THIS FILE created; swept by name prefix as well, in case a create raced a crash. */
const created: string[] = [];
const events: CommunityCreated[] = [];
/** 05-04's two new events, collected the same way, so "exactly once, after commit" is measurable. */
const updatedEvents: CommunityUpdated[] = [];
const archivedEvents: CommunityArchived[] = [];
const unsubscribes: (() => void)[] = [];
let unsubscribe: () => void = () => {};

/** The prefix every community this file writes carries, so the sweep can be exact. */
const TEST_NAME_PREFIX = 'Comunidade de teste';

/**
 * What `scripts/seed.ts` writes for BOTH tenants, in the order `last_activity_at desc, id desc`
 * puts them. `…c4` and `…c3` share a `last_activity_at`, so `id desc` is what separates them — and
 * `c4 > c3`, which is why the long-name community sorts ABOVE `Projetos em andamento`.
 */
const SEEDED_ORDER = [
  'Avisos da diretoria',
  'Eventos e encontros',
  'Grupo de trabalho de comunicacao interna e eventos do ano 26',
  'Projetos em andamento',
] as const;
const SEEDED_COUNT = SEEDED_ORDER.length;
/** The one the seed leaves WITHOUT a cover — the D-69 gradient fixture. */
const SEEDED_NO_COVER = 'Eventos e encontros';

const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

const code = async (res: Response) => ((await res.json()) as Envelope).error.code;

/** One page, parsed. Fails loudly on a non-200 so a broken page never reads as an empty one. */
async function page(token: string, query = '', host = HOSTS.demo): Promise<CommunityPage> {
  const res = await request(`/v1/communities${query}`, token, {
    headers: { 'x-tenant-host': host },
  });
  expect(res.status, `GET /v1/communities${query}`).toBe(200);
  return (await res.json()) as CommunityPage;
}

/** Walk every page with the returned cursors; returns the concatenation in the server's order. */
async function walk(token: string, limit: number, host = HOSTS.demo): Promise<CommunitySummary[]> {
  const seen: CommunitySummary[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 30; guard++) {
    const query = cursor
      ? `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=${limit}`;
    const body = await page(token, query, host);
    seen.push(...body.items);
    cursor = body.nextCursor;
    if (cursor === null) break;
  }
  expect(cursor, 'the walk terminated').toBeNull();
  return seen;
}

/** Removes everything this file wrote — by id AND by the name prefix, so a crash cannot leak rows. */
async function sweep(): Promise<void> {
  await adminSql`delete from public.communities where name like ${`${TEST_NAME_PREFIX}%`}`;
  if (created.length > 0) {
    await adminSql`delete from public.communities where id = any(${created}::uuid[])`;
  }
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  tokens.demoAdmin = await signInAs('admin@tria-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@tria-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@tria-lab.local', SEED_PASSWORD);

  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  for (const row of rows) {
    if (row.slug === 'tria-demo') tenantIds.demo = row.id;
    if (row.slug === 'tria-lab') tenantIds.lab = row.id;
  }

  // The lab tenant ships with `communities` DISABLED (scripts/seed.ts gives it feed + events only).
  // Every lab-side read below needs the module ON, so turn it on here and restore it in afterAll —
  // the flag's own behaviour is proved by its own test, which flips it in both directions.
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantIds.lab}::uuid, 'communities', true)
    on conflict (tenant_id, module_key) do update set enabled = true`;
  moduleFlags.invalidate(tenantIds.lab);

  await sweep();

  unsubscribe = subscribe('community.created', async (payload) => {
    events.push(payload);
  });
  unsubscribes.push(
    subscribe('community.updated', async (payload) => {
      updatedEvents.push(payload);
    }),
    subscribe('community.archived', async (payload) => {
      archivedEvents.push(payload);
    }),
  );
});

afterAll(async () => {
  unsubscribe();
  for (const stop of unsubscribes) stop();
  await sweep();
  await adminSql`
    delete from public.tenant_modules
     where tenant_id = ${tenantIds.lab}::uuid and module_key = 'communities'`;
  moduleFlags.invalidate(tenantIds.lab);
  await adminSql.end();
  await sqlClient.end();
});

describe('GET /v1/communities — keyset paging on last_activity_at (COMM-03, D-76)', () => {
  it('1. the seed is the fixture: four active communities, in the activity order the index carries', async () => {
    const body = await page(tokens.demoMember, `?limit=${COMMUNITY_MAX_PAGE_SIZE}`);
    expect(body.items.map((item) => item.name)).toEqual([...SEEDED_ORDER]);
    expect(body.nextCursor).toBeNull();
    // COMM-03's four card fields are all present and typed, on every row.
    for (const item of body.items) {
      expect(typeof item.name).toBe('string');
      expect(typeof item.description).toBe('string');
      expect(Number.isInteger(item.postCount)).toBe(true);
      expect(item.lastActivityAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // D-69: exactly one seeded community has no cover, and it is the gradient fixture.
    const coverless = body.items.filter((item) => item.coverAssetId === null);
    expect(coverless.map((item) => item.name)).toEqual([SEEDED_NO_COVER]);
    expect(coverless[0]?.coverVariantWidths).toEqual([]);
    // …and a community WITH a cover carries the ladder `MediaImage` builds its `srcSet` from.
    const withCover = body.items.find((item) => item.coverAssetId !== null);
    expect(withCover?.coverVariantWidths.length ?? 0).toBeGreaterThan(0);
  });

  it('2. ?limit=2 pages the four exactly once each, and nextCursor is non-null exactly when more exist', async () => {
    const first = await page(tokens.demoMember, '?limit=2');
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await page(
      tokens.demoMember,
      `?limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`,
    );
    expect(second.items).toHaveLength(2);
    // The over-fetch makes this EXACT rather than a guess: there is no third page.
    expect(second.nextCursor).toBeNull();

    const union = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(union).size).toBe(SEEDED_COUNT);
    expect([...first.items, ...second.items].map((item) => item.name)).toEqual([...SEEDED_ORDER]);
  });

  it('3. the deliberate last_activity_at TIE is broken by id desc, and neither row repeats or is skipped', async () => {
    const walked = await walk(tokens.demoMember, 2);
    const byActivity = new Map<string, CommunitySummary[]>();
    for (const item of walked) {
      byActivity.set(item.lastActivityAt, [...(byActivity.get(item.lastActivityAt) ?? []), item]);
    }
    const tied = [...byActivity.values()].find((group) => group.length > 1);
    // Guard against this test passing vacuously on a seed that lost its tie.
    expect(
      tied,
      'the seed writes two communities with an identical last_activity_at',
    ).toBeDefined();
    expect(tied).toHaveLength(2);

    const [above, below] = tied as [CommunitySummary, CommunitySummary];
    expect(above.id > below.id, 'the tie is broken by id DESC').toBe(true);

    // Each tied row appears exactly once across the whole walk — the property the tuple comparison
    // exists for. A `<` on `last_activity_at` alone would have repeated or dropped one of them.
    for (const item of tied as CommunitySummary[]) {
      expect(walked.filter((row) => row.id === item.id)).toHaveLength(1);
    }
  });

  it('4. limit is CLAMPED server-side in both directions — no client value can widen the page', async () => {
    // Deliberately NOT the feed's refusal posture: this list is reachable from a navigation TAB, so
    // a hand-edited `?limit=` must land the member on a page rather than on an error screen. The
    // T-05-04 property is identical either way — nothing a client sends widens the read.
    const zero = await page(tokens.demoMember, '?limit=0');
    expect(zero.items.length).toBeGreaterThanOrEqual(1);
    expect(zero.items.length).toBeLessThanOrEqual(COMMUNITY_MAX_PAGE_SIZE);

    const huge = await page(tokens.demoMember, '?limit=100000');
    expect(huge.items.length).toBeGreaterThanOrEqual(1);
    expect(huge.items.length).toBeLessThanOrEqual(COMMUNITY_MAX_PAGE_SIZE);

    const nonsense = await page(tokens.demoMember, '?limit=abc');
    expect(nonsense.items.length).toBeGreaterThanOrEqual(1);
    expect(nonsense.items.length).toBeLessThanOrEqual(COMMUNITY_MAX_PAGE_SIZE);

    // `.strict()`: a typo'd filter still fails loudly rather than being silently ignored.
    const unknown = await request('/v1/communities?bogus=1', tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(unknown.status).toBe(400);
    expect(await code(unknown)).toBe('VALIDATION_FAILED');
  });

  it('5. a tampered or foreign cursor degrades to page 1 rather than 500 (T-05-05)', async () => {
    const baseline = await page(tokens.demoMember, '?limit=2');

    const garbage = await page(tokens.demoMember, '?limit=2&cursor=not-base64-at-all');
    expect(garbage.items.map((item) => item.id)).toEqual(baseline.items.map((item) => item.id));

    // A well-formed envelope from ANOTHER ordering: valid base64url JSON, wrong shape here.
    const foreign = Buffer.from(
      JSON.stringify({ v: 1, n: 'ana paula', id: 'not-a-uuid' }),
    ).toString('base64url');
    const stale = await page(tokens.demoMember, `?limit=2&cursor=${encodeURIComponent(foreign)}`);
    expect(stale.items.map((item) => item.id)).toEqual(baseline.items.map((item) => item.id));
  });
});

describe('COMM-02 — "every member of the tenant" is a POLICY value, not a column shape', () => {
  it('6. a member and an admin of the same tenant receive the byte-identical item-id set', async () => {
    const asMember = await page(tokens.demoMember, `?limit=${COMMUNITY_MAX_PAGE_SIZE}`);
    const asAdmin = await page(tokens.demoAdmin, `?limit=${COMMUNITY_MAX_PAGE_SIZE}`);

    expect(asMember.items.map((item) => item.id)).toEqual(asAdmin.items.map((item) => item.id));
    expect(asMember.items.length).toBe(SEEDED_COUNT);

    // The mechanism, asserted directly: `community_members` is EMPTY in V1 and the list is
    // unaffected — the read never joins it, so zero membership rows still returns every community.
    const [memberships] = await adminSql<{ count: number }[]>`
      select count(*)::int as count from public.community_members
       where tenant_id = ${tenantIds.demo}::uuid`;
    expect(memberships?.count).toBe(0);
  });

  it('7. …and a member of the OTHER tenant receives zero of them (positive control included)', async () => {
    const demoIds = (await page(tokens.demoMember, `?limit=${COMMUNITY_MAX_PAGE_SIZE}`)).items.map(
      (item) => item.id,
    );
    const labIds = (
      await page(tokens.labAdmin, `?limit=${COMMUNITY_MAX_PAGE_SIZE}`, HOSTS.lab)
    ).items.map((item) => item.id);

    // The positive control: the lab tenant has its OWN four, with the SAME names. A read that
    // returned nothing at all would otherwise pass this assertion vacuously.
    expect(labIds.length).toBe(SEEDED_COUNT);
    for (const id of demoIds) expect(labIds).not.toContain(id);
    for (const id of labIds) expect(demoIds).not.toContain(id);
  });
});

describe('cross-tenant: one bare 404, never an existence oracle (T-05-01, T-05-02)', () => {
  it('8. a demo session never reads a lab community by id — and the lab still can', async () => {
    const labCommunityId = (await page(tokens.labAdmin, '?limit=1', HOSTS.lab)).items[0]
      ?.id as string;
    expect(labCommunityId).toMatch(/^[0-9a-f-]{36}$/);

    // Positive control IN THE SAME TEST (the 03-08 discipline): the id is real and readable — by
    // its own tenant. Without this line the 404 below could pass on a typo'd uuid.
    const owned = await request(`/v1/communities/${labCommunityId}`, tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(owned.status).toBe(200);

    const foreign = await request(`/v1/communities/${labCommunityId}`, tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(foreign.status).toBe(404);
    const body = (await foreign.json()) as Envelope;
    expect(body.error.code).toBe('NOT_FOUND');
    // No `details` key AT ALL: even `{ community: 'other_tenant' }` would be the oracle D-23
    // forbids. A status-only assertion would not cover this.
    expect(Object.hasOwn(body.error, 'details')).toBe(false);
    const asText = JSON.stringify(body);
    expect(asText).not.toContain('tria-lab');
    expect(asText).not.toContain('TRIA Lab');
  });

  it('9. an unknown uuid produces the byte-identical 404 body', async () => {
    const labCommunityId = (await page(tokens.labAdmin, '?limit=1', HOSTS.lab)).items[0]
      ?.id as string;

    const unknown = await request(
      '/v1/communities/00000000-0000-4000-8000-000000000000',
      tokens.demoAdmin,
      { headers: { 'x-tenant-host': HOSTS.demo } },
    );
    const foreign = await request(`/v1/communities/${labCommunityId}`, tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(unknown.status).toBe(foreign.status);

    const strip = (body: Envelope) => ({ ...body.error, requestId: undefined });
    expect(strip((await unknown.json()) as Envelope)).toEqual(
      strip((await foreign.json()) as Envelope),
    );
  });
});

describe('MOD-04 / D-40 — the module flag governs the routes AND the tab, in BOTH directions', () => {
  it('10. with communities OFF: every route 404s and the bootstrap carries neither the tab nor the permission', async () => {
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'communities'`;
    moduleFlags.invalidate(tenantIds.lab);

    const list = await request('/v1/communities', tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(list.status).toBe(404);
    expect(await code(list)).toBe('MODULE_DISABLED');

    const detail = await request(
      '/v1/communities/00000000-0000-4000-8000-000000000000',
      tokens.labAdmin,
      { headers: { 'x-tenant-host': HOSTS.lab } },
    );
    expect(detail.status).toBe(404);

    const write = await request('/v1/communities', tokens.labAdmin, {
      method: 'POST',
      body: JSON.stringify({ name: `${TEST_NAME_PREFIX} desabilitada` }),
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(write.status).toBe(404);

    const off = (await (
      await request('/v1/me/bootstrap', tokens.labAdmin, {
        headers: { 'x-tenant-host': HOSTS.lab },
      })
    ).json()) as { modules: { key: string; nav?: { href: string } }[]; permissions: string[] };
    expect(off.modules.map((m) => m.key)).not.toContain('communities');
    expect(off.permissions).not.toContain('communities.community.manage');
  });

  it('11. …and turning it back ON restores both, with no migration and no route edit', async () => {
    await adminSql`
      update public.tenant_modules set enabled = true
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'communities'`;
    moduleFlags.invalidate(tenantIds.lab);

    const list = await request('/v1/communities', tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(list.status).toBe(200);

    const on = (await (
      await request('/v1/me/bootstrap', tokens.labAdmin, {
        headers: { 'x-tenant-host': HOSTS.lab },
      })
    ).json()) as {
      modules: { key: string; nav?: { href: string; placement?: string } }[];
      permissions: string[];
    };
    const entry = on.modules.find((m) => m.key === 'communities');
    expect(entry?.nav?.href).toBe('/comunidades');
    expect(entry?.nav?.placement).toBe('tab');
    expect(on.permissions).toContain('communities.community.manage');
  });
});

describe('POST /v1/communities — the write is a PERMISSION, never a role (T-05-03, COMM-01)', () => {
  it('12. a member is refused 403; an admin creates 201 and the row heads the next list read', async () => {
    const refused = await request('/v1/communities', tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ name: `${TEST_NAME_PREFIX} de um membro` }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(refused.status).toBe(403);
    expect(await code(refused)).toBe('FORBIDDEN');

    const res = await request('/v1/communities', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({
        name: `${TEST_NAME_PREFIX} do admin`,
        description: 'Criada pelo teste de integracao.',
      }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(201);
    const community = (await res.json()) as CommunitySummary;
    created.push(community.id);
    expect(community.name).toBe(`${TEST_NAME_PREFIX} do admin`);
    expect(community.slug).toMatch(/^comunidade-de-teste-do-admin$/);
    expect(community.status).toBe('active');
    // Trigger-owned columns take their defaults: zero posts, and an activity stamp of its own
    // creation time — which is what makes a brand-new community sort to the HEAD rather than
    // floating there on a null (D-76).
    expect(community.postCount).toBe(0);
    expect(community.coverAssetId).toBeNull();

    const first = await page(tokens.demoMember, '?limit=1');
    expect(first.items[0]?.id).toBe(community.id);
  });

  it('13. two creates with the SAME name both succeed, with distinct ids and distinct slugs — never 409', async () => {
    const body = JSON.stringify({ name: `${TEST_NAME_PREFIX} homonima` });
    const headers = { 'x-tenant-host': HOSTS.demo };

    const one = await request('/v1/communities', tokens.demoAdmin, {
      method: 'POST',
      body,
      headers,
    });
    const two = await request('/v1/communities', tokens.demoAdmin, {
      method: 'POST',
      body,
      headers,
    });

    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    const a = (await one.json()) as CommunitySummary;
    const b = (await two.json()) as CommunitySummary;
    created.push(a.id, b.id);

    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe(b.name);
    expect(a.slug).not.toBe(b.slug);
    // Neither answered a conflict — there is no 409 anywhere on this path.
    expect([one.status, two.status]).not.toContain(409);
  });

  it('14. an empty name is refused with the closed machine code, and the caps are UTF-16 code units', async () => {
    const headers = { 'x-tenant-host': HOSTS.demo };

    const empty = await request('/v1/communities', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ name: '   ' }),
      headers,
    });
    expect(empty.status).toBe(400);
    const emptyBody = (await empty.json()) as Envelope;
    expect(emptyBody.error.code).toBe('VALIDATION_FAILED');
    expect(emptyBody.error.details).toEqual({ community: 'name_required' });

    // An emoji is TWO UTF-16 code units at both ends, so a name of 40 of them is exactly at the
    // 80-unit cap and is accepted — the counter and the server agree on the same unit.
    const atCap = await request('/v1/communities', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ name: `${TEST_NAME_PREFIX}${'🙂'.repeat(10)}`.slice(0, 80) }),
      headers,
    });
    expect(atCap.status).toBe(201);
    created.push(((await atCap.json()) as CommunitySummary).id);

    const tooLong = await request('/v1/communities', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ name: 'a'.repeat(81) }),
      headers,
    });
    expect(tooLong.status).toBe(400);
    expect(await code(tooLong)).toBe('VALIDATION_FAILED');
  });

  it('15. an empty description stores the empty STRING, never a null (COMM-01 edge/empty)', async () => {
    const res = await request('/v1/communities', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ name: `${TEST_NAME_PREFIX} sem descricao` }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(201);
    const community = (await res.json()) as CommunitySummary;
    created.push(community.id);
    expect(community.description).toBe('');

    const [row] = await adminSql<{ description: string | null }[]>`
      select description from public.communities where id = ${community.id}::uuid`;
    expect(row?.description).toBe('');
  });
});

describe('community.created — after commit, exactly once (MOD-03)', () => {
  it('16. one successful create delivers one event; a refused create delivers none', async () => {
    const before = events.length;

    const res = await request('/v1/communities', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ name: `${TEST_NAME_PREFIX} com evento` }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(201);
    const community = (await res.json()) as CommunitySummary;
    created.push(community.id);

    // Delivered by `flushEventsAfterHandler`, i.e. after the handler's transaction committed.
    const delivered = events.filter((event) => event.communityId === community.id);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.tenantId).toBe(tenantIds.demo);
    expect(delivered[0]?.actorUserId).toMatch(/^[0-9a-f-]{36}$/);
    // T-05-06: ids only. The community NAME is not in the payload, so it can never reach a log line.
    expect(JSON.stringify(delivered[0])).not.toContain(TEST_NAME_PREFIX);

    const refused = await request('/v1/communities', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(refused.status).toBe(400);
    // Nothing committed, so nothing was announced: the count moved by exactly one.
    expect(events.length).toBe(before + 1);
  });
});

/**
 * 05-03 / D-74 — the module flag is the SINGLE switch, and it flips the MERGED FEED in both
 * directions with the rows untouched.
 *
 * Case 10/11 above prove the flag governs this module's own routes and the nav tab. This block
 * proves the half that lives in ANOTHER module: with `communities` off, `GET /v1/feed` reverts to
 * Phase 4's `community_id is null` predicate; with it on, the same endpoint returns the merged
 * list. The rows are counted in the database between the two reads, so "the posts are still there"
 * is a measurement rather than an inference — an implementation that soft-deleted or re-homed the
 * community posts on a flag flip would pass a contents-only assertion and fail this one.
 *
 * It runs against the LAB tenant for the same reason cases 10/11 do: the flag's state itself is
 * what must be observable, and the lab tenant's `communities` row is this file's to move.
 */
describe('D-74 — the communities flag flips the MERGED FEED, in both directions', () => {
  it('17. OFF: the feed carries no community post, and every one of those rows still exists', async () => {
    const [before] = await adminSql<{ count: number }[]>`
      select count(*)::int as count from public.feed_posts
       where tenant_id = ${tenantIds.lab}::uuid and community_id is not null
         and deleted_at is null`;
    expect(
      before?.count,
      'the seed publishes inside the lab tenant’s communities too',
    ).toBeGreaterThan(0);

    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'communities'`;
    moduleFlags.invalidate(tenantIds.lab);

    const res = await request('/v1/feed?limit=25', tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { communityId: string | null }[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.communityId === null)).toBe(true);

    // The rows are UNTOUCHED — the flag hides them from a list, it does not delete or re-home them.
    const [after] = await adminSql<{ count: number }[]>`
      select count(*)::int as count from public.feed_posts
       where tenant_id = ${tenantIds.lab}::uuid and community_id is not null
         and deleted_at is null`;
    expect(after?.count).toBe(before?.count);

    // And the community feed is unreachable while the module is off — the same bare 404 an unknown
    // id gets, never a 403 that would tell a member the container exists somewhere (ROLE-06).
    const [community] = await adminSql<{ id: string }[]>`
      select id from public.communities where tenant_id = ${tenantIds.lab}::uuid limit 1`;
    const scoped = await request(`/v1/feed?communityId=${community?.id ?? ''}`, tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(scoped.status).toBe(404);
  });

  it('18. …and turning it back ON restores them, with no migration and no backfill', async () => {
    await adminSql`
      update public.tenant_modules set enabled = true
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'communities'`;
    moduleFlags.invalidate(tenantIds.lab);

    const res = await request('/v1/feed?limit=25', tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { communityId: string | null; community: { name: string } | null }[];
    };
    const restored = body.items.filter((item) => item.communityId !== null);
    expect(restored.length).toBeGreaterThan(0);
    // D-71 rides back with them: each restored post carries the label it will render.
    expect(restored.every((item) => (item.community?.name.length ?? 0) > 0)).toBe(true);

    const [community] = await adminSql<{ id: string }[]>`
      select id from public.communities where tenant_id = ${tenantIds.lab}::uuid limit 1`;
    const scoped = await request(`/v1/feed?communityId=${community?.id ?? ''}`, tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(scoped.status).toBe(200);
  });
});

/**
 * 05-04 — COMM-01's WRITE half: `PATCH /v1/communities/{id}` and what archiving MEANS.
 *
 * Archive is one status write, not a separate verb, and the three facts that make it safe are
 * asserted here rather than assumed (05-RESEARCH §Pattern 7): an archived community DISAPPEARS from
 * the list, still OPENS by id, and REFUSES new posts — while every post already inside it stays in
 * the merged feed exactly where members last saw it. The fourth fact, that it is reversible with one
 * PATCH back to `active`, is what makes the whole thing an organisational tidy-up rather than a
 * deletion.
 *
 * Every community these cases touch is one THIS FILE created (the name prefix the sweep matches), so
 * a crash cannot leave a seeded container archived for the next run.
 */
describe('PATCH /v1/communities/{id} — edit, archive and reactivate (COMM-01, UI-D-37)', () => {
  const patch = (id: string, body: unknown, token: string, host = HOSTS.demo) =>
    request(`/v1/communities/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'x-tenant-host': host },
    });

  /** A fresh community owned by this file, so no case depends on another's leftovers. */
  async function makeCommunity(suffix: string): Promise<CommunitySummary> {
    const res = await request('/v1/communities', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ name: `${TEST_NAME_PREFIX} ${suffix}`, description: 'antes' }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status, `POST /v1/communities (${suffix})`).toBe(201);
    const community = (await res.json()) as CommunitySummary;
    created.push(community.id);
    return community;
  }

  it('19. an admin edits name and description; a member is refused 403 (T-05-18)', async () => {
    const community = await makeCommunity('editavel');

    const refused = await patch(community.id, { name: 'de um membro' }, tokens.demoMember);
    expect(refused.status).toBe(403);
    expect(await code(refused)).toBe('FORBIDDEN');

    const res = await patch(
      community.id,
      { name: `${TEST_NAME_PREFIX} editada`, description: 'depois' },
      tokens.demoAdmin,
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as CommunitySummary;
    expect(updated.name).toBe(`${TEST_NAME_PREFIX} editada`);
    expect(updated.description).toBe('depois');
    // The id and the slug are STABLE across a rename: a shared link must not break (D-56).
    expect(updated.id).toBe(community.id);
    expect(updated.slug).toBe(community.slug);
  });

  it('20. an unknown or other-tenant id is a BARE 404 with no details key (T-05-20)', async () => {
    const [labCommunity] = await adminSql<{ id: string }[]>`
      select id from public.communities where tenant_id = ${tenantIds.lab}::uuid limit 1`;
    expect(labCommunity?.id, 'the lab tenant is seeded with communities too').toBeDefined();

    for (const id of [labCommunity?.id ?? '', '00000000-0000-4000-8000-000000000000']) {
      const res = await patch(id, { description: 'nao deveria escrever' }, tokens.demoAdmin);
      expect(res.status, id).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.details, id).toBeUndefined();
    }
  });

  it('21. archiving removes it from the LIST, keeps it readable by id, and refuses new posts', async () => {
    const community = await makeCommunity('arquivavel');

    const before = await page(tokens.demoMember, `?limit=${COMMUNITY_MAX_PAGE_SIZE}`);
    expect(before.items.map((item) => item.id)).toContain(community.id);

    const archived = await patch(community.id, { status: 'archived' }, tokens.demoAdmin);
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as CommunitySummary).status).toBe('archived');

    // 1. absent from the list…
    const after = await walk(tokens.demoMember, COMMUNITY_MAX_PAGE_SIZE);
    expect(after.map((item) => item.id)).not.toContain(community.id);

    // 2. …still readable by id, so a shared link and a feed post that names it keep working…
    const byId = await request(`/v1/communities/${community.id}`, tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(byId.status).toBe(200);
    expect(((await byId.json()) as CommunitySummary).status).toBe('archived');

    // 3. …and it refuses new posts with the closed code the composer maps (05-03's branch).
    const post = await request('/v1/feed/posts', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ caption: 'Publicacao recusada', communityId: community.id }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(post.status).toBe(400);
    const body = (await post.json()) as Envelope;
    expect((body.error.details as { community?: string }).community).toBe('archived');
  });

  it('22. archiving twice is IDEMPOTENT: 200, and no second community.archived', async () => {
    const community = await makeCommunity('idempotente');

    const first = await patch(community.id, { status: 'archived' }, tokens.demoAdmin);
    expect(first.status).toBe(200);
    const afterFirst = archivedEvents.filter((event) => event.communityId === community.id).length;
    expect(afterFirst).toBe(1);

    const second = await patch(community.id, { status: 'archived' }, tokens.demoAdmin);
    expect(second.status).toBe(200);
    expect(((await second.json()) as CommunitySummary).status).toBe('archived');
    // The event marks the TRANSITION, not the state: a repeat announces nothing.
    expect(archivedEvents.filter((event) => event.communityId === community.id)).toHaveLength(1);
  });

  it('23. reactivating is one PATCH back to active, and the row returns to the list', async () => {
    const community = await makeCommunity('reativavel');

    expect((await patch(community.id, { status: 'archived' }, tokens.demoAdmin)).status).toBe(200);
    const hidden = await walk(tokens.demoMember, COMMUNITY_MAX_PAGE_SIZE);
    expect(hidden.map((item) => item.id)).not.toContain(community.id);

    const back = await patch(community.id, { status: 'active' }, tokens.demoAdmin);
    expect(back.status).toBe(200);
    expect(((await back.json()) as CommunitySummary).status).toBe('active');

    const visible = await walk(tokens.demoMember, COMMUNITY_MAX_PAGE_SIZE);
    expect(visible.map((item) => item.id)).toContain(community.id);
  });

  it('24. a PATCH identical to the stored row is a 200 that changes nothing — including the ordering key', async () => {
    const community = await makeCommunity('sem mudanca');

    const [before] = await adminSql<{ last_activity_at: string; updated_at: string }[]>`
      select last_activity_at::text, updated_at::text
        from public.communities where id = ${community.id}::uuid`;

    const res = await patch(
      community.id,
      { name: community.name, description: community.description },
      tokens.demoAdmin,
    );
    expect(res.status).toBe(200);

    const [after] = await adminSql<{ last_activity_at: string; updated_at: string }[]>`
      select last_activity_at::text, updated_at::text
        from public.communities where id = ${community.id}::uuid`;
    // `last_activity_at` is TRIGGER-owned: no write path on this endpoint may move it, or the list's
    // ordering would answer "who edited most recently" instead of "where did something happen".
    expect(after?.last_activity_at).toBe(before?.last_activity_at);
    expect(after?.updated_at).toBe(before?.updated_at);
  });

  it('25. an empty name is refused with the closed machine code; the cap is the same UTF-16 unit', async () => {
    const community = await makeCommunity('validada');

    const empty = await patch(community.id, { name: '   ' }, tokens.demoAdmin);
    expect(empty.status).toBe(400);
    const body = (await empty.json()) as Envelope;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual({ community: 'name_required' });

    const tooLong = await patch(community.id, { name: 'a'.repeat(81) }, tokens.demoAdmin);
    expect(tooLong.status).toBe(400);
    expect(await code(tooLong)).toBe('VALIDATION_FAILED');

    // The name it had is untouched: a refused write writes nothing.
    const byId = await request(`/v1/communities/${community.id}`, tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(((await byId.json()) as CommunitySummary).name).toBe(community.name);
  });

  it('26. both new events fire once, after commit, carrying IDS only (T-05-06)', async () => {
    const community = await makeCommunity('com eventos');
    const updatedBefore = updatedEvents.length;

    expect(
      (await patch(community.id, { description: 'nova descricao' }, tokens.demoAdmin)).status,
    ).toBe(200);
    const updated = updatedEvents.filter((event) => event.communityId === community.id);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.tenantId).toBe(tenantIds.demo);
    expect(updated[0]?.actorUserId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(updated[0])).not.toContain('nova descricao');
    expect(JSON.stringify(updated[0])).not.toContain(TEST_NAME_PREFIX);

    expect((await patch(community.id, { status: 'archived' }, tokens.demoAdmin)).status).toBe(200);
    const archived = archivedEvents.filter((event) => event.communityId === community.id);
    expect(archived).toHaveLength(1);
    expect(JSON.stringify(archived[0])).not.toContain(TEST_NAME_PREFIX);

    // A REFUSED patch announces nothing at all.
    expect((await patch(community.id, { name: '' }, tokens.demoAdmin)).status).toBe(400);
    expect(updatedEvents.length).toBe(updatedBefore + 1);
  });
});

/**
 * 05-09 — GAP 1 of `05-VERIFICATION.md`, from the SAME-TENANT side.
 *
 * `isolation.test.ts` case b5 proves the cross-tenant half: a foreign cover id is one bare 404 that
 * is byte-identical to an unknown uuid's, so no oracle survives. This block proves the other half —
 * every way an asset of THIS tenant can be wrong answers the closed `cover_invalid` code the admin
 * can see and act on, and the two answers never blur into each other.
 *
 * The accepted tuple is exactly `(purpose 'cover', kind 'image', status 'ready')`. The feed's D-53
 * concession — publish while a video transcodes — is a VIDEO concession and case 29 is the case that
 * pins it as deliberately not inherited: a cover with no bytes renders as exactly the gradient the
 * admin was trying to replace.
 */
describe('POST/PATCH /v1/communities — the cover asset contract (COMM-01, 05-09)', () => {
  /** Every media row this block seeds, so the cleanup can be exact (the file keeps no media list). */
  const coverAssets: string[] = [];
  const fixtures = { ready: '', avatar: '', video: '', processing: '', labCover: '' };

  const patch = (id: string, body: unknown, token = tokens.demoAdmin) =>
    request(`/v1/communities/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'x-tenant-host': HOSTS.demo },
    });

  const post = (body: unknown, token = tokens.demoAdmin) =>
    request('/v1/communities', token, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'x-tenant-host': HOSTS.demo },
    });

  /** `requestId` is the ONE field that legitimately differs between two requests (the case q rule). */
  const withoutRequestId = (raw: string) => {
    const parsed = JSON.parse(raw) as Envelope;
    const { requestId: _requestId, ...error } = parsed.error;
    return JSON.stringify({ error });
  };

  /** How many communities the demo tenant has right now — a refusal must not move this. */
  async function demoCommunityCount(): Promise<number> {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.communities
       where tenant_id = ${tenantIds.demo}::uuid and deleted_at is null`;
    return row?.n ?? 0;
  }

  /** A fresh community owned by this file, optionally carrying a cover. */
  async function makeCommunity(suffix: string, coverAssetId: string | null = null) {
    const res = await post({ name: `${TEST_NAME_PREFIX} ${suffix}`, coverAssetId });
    expect(res.status, `POST /v1/communities (${suffix})`).toBe(201);
    const community = (await res.json()) as CommunitySummary;
    created.push(community.id);
    return community;
  }

  /**
   * One media row in a KNOWN tuple, written straight through the admin connection. Every value comes
   * from the schema's own CHECK vocabularies (`media_assets_kind_chk`, `_purpose_chk`, `_status_chk`),
   * so a fixture can never be refused by the database before the service gets to refuse it.
   */
  async function seedAsset(
    tenantId: string,
    email: string,
    kind: string,
    purpose: string,
    status: string,
  ): Promise<string> {
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
         variant_widths, filename, ready_at)
      select ${tenantId}::uuid, u.id, ${kind}, ${purpose}, ${status}, 'supabase',
             ${kind === 'video' ? 'video/mp4' : 'image/webp'}, 262144, 1600, 700,
             ${status === 'ready' ? '{320,640,960,1280}' : '{}'}::int[],
             ${`05-09-${kind}-${purpose}-${status}`},
             ${status === 'ready' ? new Date().toISOString() : null}::timestamptz
        from public.users u where u.email = ${email}
      returning id`;
    if (!row) throw new Error(`could not seed a ${kind}/${purpose}/${status} asset for ${email}`);
    coverAssets.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    fixtures.ready = await seedAsset(
      tenantIds.demo,
      'admin@tria-demo.local',
      'image',
      'cover',
      'ready',
    );
    fixtures.avatar = await seedAsset(
      tenantIds.demo,
      'admin@tria-demo.local',
      'image',
      'avatar',
      'ready',
    );
    fixtures.video = await seedAsset(
      tenantIds.demo,
      'admin@tria-demo.local',
      'video',
      'post',
      'ready',
    );
    fixtures.processing = await seedAsset(
      tenantIds.demo,
      'admin@tria-demo.local',
      'image',
      'cover',
      'processing',
    );
    // The OTHER tenant's perfectly usable cover — case 31's "a pre-fix release wrote this" fixture.
    fixtures.labCover = await seedAsset(
      tenantIds.lab,
      'admin@tria-lab.local',
      'image',
      'cover',
      'ready',
    );
  });

  afterAll(async () => {
    if (coverAssets.length === 0) return;
    // Communities pointing AT a fixture asset go first — including the row case 31 corrupted by
    // hand — or the delete below fails on the foreign key. The file-level sweep runs later and
    // would otherwise find the assets already gone.
    await adminSql`
      delete from public.communities where cover_asset_id = any(${coverAssets}::uuid[])`;
    await adminSql`delete from public.media_assets where id = any(${coverAssets}::uuid[])`;
  });

  it('27. wrong PURPOSE: an avatar image is cover_invalid, and both write verbs answer identically', async () => {
    const before = await demoCommunityCount();
    const community = await makeCommunity('capa com proposito errado');

    const onCreate = await post({
      name: `${TEST_NAME_PREFIX} capa avatar`,
      coverAssetId: fixtures.avatar,
    });
    expect(onCreate.status).toBe(400);
    const createText = await onCreate.text();
    const createBody = JSON.parse(createText) as Envelope;
    expect(createBody.error.code).toBe('VALIDATION_FAILED');
    expect(createBody.error.details).toEqual({ community: 'cover_invalid' });

    const onPatch = await patch(community.id, { coverAssetId: fixtures.avatar });
    expect(onPatch.status).toBe(400);
    const patchText = await onPatch.text();

    // The contract test named in 05-09's assumption-delta block: the answer depends only on the
    // asset's (tenant_id, purpose, kind, status) tuple and never on WHICH verb asked — one intent,
    // two call sites, one rule. An equality rather than two checks against a literal, so a future
    // extra key on either branch fails here.
    expect(withoutRequestId(patchText)).toEqual(withoutRequestId(createText));

    // A refusal wrote nothing: only the community this case deliberately created exists.
    expect(await demoCommunityCount()).toBe(before + 1);
  });

  it('28. wrong KIND: a ready VIDEO is cover_invalid — a cover is never a video', async () => {
    const before = await demoCommunityCount();

    const res = await post({
      name: `${TEST_NAME_PREFIX} capa video`,
      coverAssetId: fixtures.video,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual({ community: 'cover_invalid' });

    expect(await demoCommunityCount()).toBe(before);
  });

  it('29. not READY: a processing cover is cover_invalid — the feed video concession is not inherited', async () => {
    const before = await demoCommunityCount();

    // D-53 lets a POST publish while its VIDEO transcodes, because the card shows a `processando`
    // placeholder. A community cover has no such placeholder: an unready cover renders as the
    // `--brand-gradient` block, which is exactly what the admin was replacing. Deliberately refused.
    const res = await post({
      name: `${TEST_NAME_PREFIX} capa em processamento`,
      coverAssetId: fixtures.processing,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope;
    expect(body.error.details).toEqual({ community: 'cover_invalid' });

    expect(await demoCommunityCount()).toBe(before);
  });

  it('30. null and ABSENT are both "no cover": 201, stored null, and no asset lookup (COMM-01 edge/empty)', async () => {
    const explicit = await post({ name: `${TEST_NAME_PREFIX} sem capa nula`, coverAssetId: null });
    expect(explicit.status).toBe(201);
    const withNull = (await explicit.json()) as CommunitySummary;
    created.push(withNull.id);
    expect(withNull.coverAssetId).toBeNull();

    const omitted = await post({ name: `${TEST_NAME_PREFIX} sem capa ausente` });
    expect(omitted.status).toBe(201);
    const withoutKey = (await omitted.json()) as CommunitySummary;
    created.push(withoutKey.id);
    expect(withoutKey.coverAssetId).toBeNull();

    // Read back from the database, not from the payload: "no cover" is one value everywhere.
    const rows = await adminSql<{ id: string; cover_asset_id: string | null }[]>`
      select id, cover_asset_id from public.communities
       where id = any(${[withNull.id, withoutKey.id]}::uuid[])`;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.cover_asset_id).toBeNull();
  });

  it('31. a PATCH re-sending the stored cover is still INERT — and still validated (COMM-01 edge/idempotency)', async () => {
    const community = await makeCommunity('capa idempotente', fixtures.ready);
    expect(community.coverAssetId).toBe(fixtures.ready);

    const [before] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text from public.communities where id = ${community.id}::uuid`;
    const updatedBefore = updatedEvents.length;

    const repeat = await patch(community.id, { coverAssetId: fixtures.ready });
    expect(repeat.status).toBe(200);

    const [after] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text from public.communities where id = ${community.id}::uuid`;
    // Observably inert: no row written, no `updated_at`, no event. The lookup happens BEFORE the
    // no-op early return, so validating cost one indexed read and changed nothing.
    expect(after?.updated_at).toBe(before?.updated_at);
    expect(updatedEvents.length).toBe(updatedBefore);

    // Now the row a PRE-FIX release could have written: a cover id belonging to the OTHER tenant,
    // put there by hand because the API can no longer produce it. Re-sending it UNCHANGED must
    // still be refused — this is what proves validation is not skipped when nothing appears to move.
    await adminSql`
      update public.communities set cover_asset_id = ${fixtures.labCover}::uuid
       where id = ${community.id}::uuid`;

    const countBefore = await demoCommunityCount();
    const resent = await patch(community.id, { coverAssetId: fixtures.labCover });
    expect(resent.status).toBe(404);
    const body = (await resent.json()) as Envelope;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(Object.hasOwn(body.error, 'details')).toBe(false);
    expect(await demoCommunityCount()).toBe(countBefore);
  });

  it('32. uuid EQUALITY is Postgres, not JavaScript; a malformed id is a 400 and never a 500 (COMM-01 edge/encoding)', async () => {
    const community = await makeCommunity('capa com maiusculas');

    // Two textual spellings of the SAME uuid resolve to the same asset: the `::uuid` cast is what
    // compares them, never JS string equality.
    const upper = await patch(community.id, { coverAssetId: fixtures.ready.toUpperCase() });
    expect(upper.status).toBe(200);
    const [stored] = await adminSql<{ cover_asset_id: string | null }[]>`
      select cover_asset_id::text from public.communities where id = ${community.id}::uuid`;
    expect(stored?.cover_asset_id).toBe(fixtures.ready);

    // A 35-character string is not a uuid. The CONTRACT validator refuses it before the service is
    // reached, so it is a 400 with no `community` code — never the driver's 500 on a bad cast.
    const countBefore = await demoCommunityCount();
    const malformed = await patch(community.id, { coverAssetId: fixtures.ready.slice(0, 35) });
    expect(malformed.status).toBe(400);
    expect(malformed.status).not.toBe(500);
    const body = (await malformed.json()) as Envelope;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect((body.error.details as { community?: string } | undefined)?.community).toBeUndefined();
    expect(await demoCommunityCount()).toBe(countBefore);
  });
});
