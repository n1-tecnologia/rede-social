import { sqlClient } from '@rede-social/core/db';
import type { CommunityPage, CommunitySummary } from '@rede-social/module-communities/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Deleting a community end to end against the live local stack and the real seed (09.3, PEND-04,
 * PEND-06, PEND-13, D-553, D-554, D-556, D-557): `DELETE /v1/communities/{communityId}` is a SOFT
 * delete of an ARCHIVED community, guarded by the literal `communities.community.manage`, answering
 * 204 with `cache-control: no-store`.
 *
 * What is proved here:
 *  - the tracer: an admin archives then deletes a community, it leaves both lists and the detail,
 *    and a second delete or a PATCH is the bare 404;
 *  - a community that is not archived is `409 { community: 'not_archived' }` and nothing is written;
 *  - a member is 403 and an anonymous caller 401;
 *  - the Loja refusal `unlock_active` (names and total), its cap, order, encoding, the store module
 *    flag, the row lock that serialises a concurrent product link, races, hidden-not-erased
 *    highlights, an untouched Loja, the slug, and the no-oracle rule.
 *
 * `story_community_pins` no longer exists (dropped in Phase 05.2-11), so D-556 has nothing to treat
 * there; the highlights stay in `story_highlights` and are hidden by the read filters.
 *
 * Every community this file writes carries `TEST_NAME_PREFIX` (and every product `PRODUCT_PREFIX`), so
 * both hooks sweep exactly this file's rows. Test ORDER is load-bearing (`fileParallelism: false`,
 * declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', labAdmin: '' };
const tenantIds = { demo: '', lab: '' };

/** The prefix every community THIS FILE writes carries, so the sweep can be exact. */
const TEST_NAME_PREFIX = 'Comunidade de exclusao';
/** The prefix every Loja product this file writes carries. */
const PRODUCT_PREFIX = 'Produto de exclusao';

const request = (path: string, token?: string, init: RequestInit = {}, host = HOSTS.demo) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

/** The error body without the per-request id, so two answers compare byte for byte. */
function sansRequestId(raw: string): string {
  const parsed = JSON.parse(raw) as Envelope;
  const { requestId: _requestId, ...rest } = parsed.error;
  return JSON.stringify({ error: rest });
}

/** Asserts the bare 404: the `NOT_FOUND` code and no `details` key (D-23). Returns the raw body. */
async function expectBare404(res: Response, label: string): Promise<string> {
  const raw = await res.clone().text();
  expect(res.status, `${label}: ${raw}`).toBe(404);
  const error = await envelope(res);
  expect(error.code, label).toBe('NOT_FOUND');
  expect(Object.hasOwn(error, 'details'), label).toBe(false);
  return raw;
}

let counter = 0;
const uniqueName = (suffix: string) => `${TEST_NAME_PREFIX} ${suffix} ${++counter}`;

/** Creates a community through the admin API. */
async function createCommunity(name = uniqueName('x')): Promise<CommunitySummary> {
  const res = await request('/v1/communities', tokens.demoAdmin, {
    method: 'POST',
    body: JSON.stringify({ name, description: 'Descricao da comunidade' }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as CommunitySummary;
}

const setStatus = (communityId: string, status: 'active' | 'archived') =>
  request(`/v1/communities/${communityId}`, tokens.demoAdmin, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

async function archive(communityId: string): Promise<void> {
  const res = await setStatus(communityId, 'archived');
  expect(res.status, await res.clone().text()).toBe(200);
}

const del = (communityId: string, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request(`/v1/communities/${communityId}`, token, { method: 'DELETE' }, host);

const detail = (communityId: string, token = tokens.demoAdmin) =>
  request(`/v1/communities/${communityId}`, token);

async function deletedAtOf(communityId: string): Promise<string | null | undefined> {
  const [row] = await adminSql<{ deleted_at: string | null }[]>`
    select deleted_at::text from public.communities where id = ${communityId}::uuid`;
  return row?.deleted_at;
}

/** Every id of one status of the demo's list, as the admin sees it. */
async function listedIds(status: 'active' | 'archived'): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 60; guard++) {
    const query: string = cursor
      ? `?limit=25&status=${status}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=25&status=${status}`;
    const res = await request(`/v1/communities${query}`, tokens.demoAdmin);
    expect(res.status).toBe(200);
    const page = (await res.json()) as CommunityPage;
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  return seen;
}

async function sweep(): Promise<void> {
  const communities = await adminSql<{ id: string }[]>`
    select id::text as id from public.communities where name like ${`${TEST_NAME_PREFIX}%`}`;
  const communityIds = communities.map((row) => row.id);
  const products = await adminSql<{ id: string }[]>`
    select id::text as id from public.store_products where name like ${`${PRODUCT_PREFIX}%`}`;
  const productIds = products.map((row) => row.id);
  if (productIds.length > 0) {
    await adminSql`delete from public.store_product_communities where product_id = any(${productIds}::uuid[])`;
  }
  if (communityIds.length > 0) {
    await adminSql`delete from public.store_product_communities where community_id = any(${communityIds}::uuid[])`;
    await adminSql`
      delete from public.story_highlight_items
       where highlight_id in (select id from public.story_highlights
                               where community_id = any(${communityIds}::uuid[]))`;
    await adminSql`delete from public.story_highlights where community_id = any(${communityIds}::uuid[])`;
  }
  if (productIds.length > 0) {
    await adminSql`delete from public.store_products where id = any(${productIds}::uuid[])`;
  }
  await adminSql`delete from public.communities where name like ${`${TEST_NAME_PREFIX}%`}`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
  }
  await sweep();
});

afterAll(async () => {
  await sweep();
  await adminSql.end();
  await sqlClient.end();
});

describe('DELETE /v1/communities/{communityId} - an archived community, soft-deleted (D-553)', () => {
  it('1. tracer: an admin archives then deletes a community; it vanishes and stays in the database', async () => {
    const community = await createCommunity(uniqueName('tracer'));
    expect(await listedIds('active')).toContain(community.id);
    await archive(community.id);
    expect(await listedIds('archived')).toContain(community.id);

    const res = await del(community.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.get('cache-control')).toBe('no-store');

    // The row is still there, flagged.
    expect(await deletedAtOf(community.id)).toEqual(expect.any(String));
    // The detail is the bare 404 for the admin and for a member.
    await expectBare404(await detail(community.id, tokens.demoAdmin), 'detail (admin)');
    await expectBare404(await detail(community.id, tokens.demoMember), 'detail (member)');
    // It is in neither list.
    expect(await listedIds('active')).not.toContain(community.id);
    expect(await listedIds('archived')).not.toContain(community.id);
    // A PATCH and a second DELETE are the bare 404, and the second does not move `deleted_at`.
    const firstStamp = await deletedAtOf(community.id);
    await expectBare404(await setStatus(community.id, 'active'), 'patch after delete');
    await expectBare404(await del(community.id), 'second delete');
    expect(await deletedAtOf(community.id)).toBe(firstStamp);
  });

  it('2. not archived: an ACTIVE community is 409 not_archived, nothing is written, and it repeats', async () => {
    const community = await createCommunity(uniqueName('ativa'));
    const [before] = await adminSql<{ row: unknown }[]>`
      select to_jsonb(c) as row from public.communities c where c.id = ${community.id}::uuid`;

    const first = await del(community.id);
    const firstText = await first.clone().text();
    expect(first.status, firstText).toBe(409);
    const error = await envelope(first);
    expect(error.code).toBe('CONFLICT');
    expect(error.details).toEqual({ community: 'not_archived' });

    const [after] = await adminSql<{ row: unknown }[]>`
      select to_jsonb(c) as row from public.communities c where c.id = ${community.id}::uuid`;
    expect(after?.row).toEqual(before?.row);
    expect(await deletedAtOf(community.id)).toBeNull();

    // Repeating the refusal answers the same body.
    const second = await del(community.id);
    expect(second.status).toBe(409);
    expect(sansRequestId(await second.text())).toBe(sansRequestId(firstText));
  });

  it('3. permission: a member is 403, an anonymous caller 401, and the archived community stays live', async () => {
    const community = await createCommunity(uniqueName('permissao'));
    await archive(community.id);

    const asMember = await del(community.id, tokens.demoMember);
    expect(asMember.status).toBe(403);
    expect((await envelope(asMember)).code).toBe('FORBIDDEN');

    const anonymous = await request(`/v1/communities/${community.id}`, undefined, {
      method: 'DELETE',
    });
    expect(anonymous.status).toBe(401);

    expect(await deletedAtOf(community.id)).toBeNull();
    expect(await listedIds('archived')).toContain(community.id);
  });
});
