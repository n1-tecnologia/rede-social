import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, SEED_PASSWORD, signInAs } from './setup';

/**
 * CR-01 of the 08.2 review (quick 261009-8fz): the Supabase Data API exposes only `data_api_closed`.
 *
 * The API is the only data client. The browser talks to Supabase only for Auth (through the Next.js
 * BFF) and for read-only Realtime Broadcast, and neither goes through PostgREST. Yet a member holds
 * both halves of a Data API call: `GET /api/realtime/token` hands page JavaScript the raw GoTrue
 * access token, and the publishable key ships in the bundle. `authenticated` keeps its DML grants on
 * every `public` table, because the API runs its queries as `api_user` + `set local role
 * authenticated`, and PostgREST sets `request.jwt.claims` from the bearer token. So while `public`
 * is exposed, every RLS policy is one claim away from being a write path that skips the API's
 * rules (`requirePermission`, the admin-only services, validation). Revoking the grants would break
 * the API; closing the surface is the fix.
 *
 * The design (user decision 2026-10-09): `[api] schemas` lists only `data_api_closed`, an
 * intentionally empty, grant-less schema created by `*_data_api_closed_schema.sql`. PostgREST keeps
 * running and refuses every request fast. Neither config-only variant works: an empty `schemas`
 * list is treated by PostgREST as unset, so it serves `public` (probed); `enabled = false` leaves
 * Kong's /rest/v1 and /graphql/v1 routes pointing at a missing upstream, which answers a 5xx or
 * hangs depending on the host's DNS. `extra_search_path` drops `public` too, so nothing in `public`
 * is reachable by unqualified name through the closed schema.
 *
 * Like the GoTrue sign-up pin, the live probes only see `supabase/config.toml` after the stack is
 * restarted (`supabase stop` + `start`; `db reset` does not recreate PostgREST). That is why a
 * static pin of the `[api]` block and a database pin of the schema sit next to them: reverting
 * either fails this suite at once.
 */

const CLOSED_SCHEMA = 'data_api_closed';
const MEMBER_EMAIL = 'member@rede-demo.local';
const ADMIN_EMAIL = 'admin@rede-demo.local';
/** Roles PostgREST can run a request as (plus the login role it connects with). */
const API_ROLES = ['anon', 'authenticated', 'service_role', 'authenticator'] as const;
/** Tables whose rows a member could reach (or write) through an exposed `public`. */
const TABLES = [
  'communities',
  'feed_posts',
  'events',
  'memberships',
  'tenant_modules',
  'users',
] as const;
/** Unique per run; every throwaway row (and anything a probe might have written) carries it. */
const MARKER = `data-api-probe-${Date.now()}`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see scripts/local-env.sh)`);
  return value;
}

let token = '';
let memberId = '';
let tenantId = '';
let communityId = '';
let postId = '';
let countsBefore: Counts | undefined;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: required('SUPABASE_PUBLISHABLE_KEY'),
    authorization: `Bearer ${token}`,
    ...extra,
  };
}

/** A member-token request asking for the written rows back, the shape a client write would use. */
function memberInit(
  method: string,
  body?: unknown,
  extra: Record<string, string> = {},
): RequestInit {
  const h = headers({ prefer: 'return=representation', ...extra });
  if (body === undefined) return { method, headers: h };
  return {
    method,
    headers: { ...h, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

interface ProbeResult {
  status: number;
  text: string;
  json: unknown;
  ms: number;
}

/** One gateway call with a hard 5 s abort, so a hang fails fast and visibly. */
async function probe(path: string, init: RequestInit = {}): Promise<ProbeResult> {
  const started = performance.now();
  const res = await fetch(`${required('SUPABASE_URL')}${path}`, {
    ...init,
    signal: AbortSignal.timeout(5_000),
  });
  const text = await res.text();
  const ms = performance.now() - started;
  let json: unknown = null;
  if ((res.headers.get('content-type') ?? '').includes('json') && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, text, json, ms };
}

/**
 * A closed Data API answer: the pinned status and PostgREST code, never a 2xx, never a row array,
 * never a 42501 (that would mean SQL ran against a real table), and fast (never a hang).
 */
function expectRefused(res: ProbeResult, pinned: { status: number; code: string }): void {
  expect(res.status < 200 || res.status >= 300).toBe(true);
  expect(Array.isArray(res.json)).toBe(false);
  expect(res.text).not.toContain('42501');
  expect(res.ms).toBeLessThan(5_000);
  expect({ status: res.status, code: (res.json as { code?: string } | null)?.code }).toEqual(
    pinned,
  );
}

/** Default profile, unknown relation: PostgREST looks it up in `data_api_closed` only. */
const NO_TABLE = { status: 404, code: 'PGRST205' };
/** Default profile, unknown function. */
const NO_FUNCTION = { status: 404, code: 'PGRST202' };
/** A `public` / `graphql_public` profile (Kong sends `graphql_public` for /graphql/v1). */
const NOT_EXPOSED = { status: 406, code: 'PGRST106' };

/** PGRST106 must name only the closed schema as exposed, never `public`. */
function expectProfileRefused(res: ProbeResult): void {
  expectRefused(res, NOT_EXPOSED);
  expect((res.json as { hint?: string } | null)?.hint).toBe(
    `Only the following schemas are exposed: ${CLOSED_SCHEMA}`,
  );
}

const CONFIG_LINES = readFileSync(
  new URL('../../../../supabase/config.toml', import.meta.url),
  'utf8',
).split('\n');

/**
 * The non-comment, non-empty lines strictly between the exact `header` line and the next line that
 * starts a table (`[`). Never matches comment text.
 */
function tomlBlock(header: string): string[] {
  const start = CONFIG_LINES.findIndex((line) => line.trim() === header);
  if (start === -1) throw new Error(`supabase/config.toml has no ${header} block`);
  const out: string[] = [];
  for (const line of CONFIG_LINES.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) break;
    if (!trimmed || trimmed.startsWith('#')) continue;
    out.push(trimmed);
  }
  return out;
}

/** Every `[remotes.<name>.api]` header in config.toml (none today). */
function remoteApiHeaders(): string[] {
  return CONFIG_LINES.map((line) => line.trim()).filter((line) =>
    /^\[remotes\.[^.\]]+\.api\]$/.test(line),
  );
}

interface Counts {
  communities: number;
  feed_posts: number;
  events: number;
  memberships: number;
  tenant_modules: number;
}

async function tenantCounts(): Promise<Counts> {
  const [row] = await adminSql<Counts[]>`
    select
      (select count(*)::int from public.communities where tenant_id = ${tenantId}::uuid) as communities,
      (select count(*)::int from public.feed_posts where tenant_id = ${tenantId}::uuid) as feed_posts,
      (select count(*)::int from public.events where tenant_id = ${tenantId}::uuid) as events,
      (select count(*)::int from public.memberships where tenant_id = ${tenantId}::uuid) as memberships,
      (select count(*)::int from public.tenant_modules where tenant_id = ${tenantId}::uuid)
        as tenant_modules
  `;
  if (!row) throw new Error('could not count rede-demo rows');
  return row;
}

beforeAll(async () => {
  token = await signInAs(MEMBER_EMAIL, SEED_PASSWORD);
  const [ids] = await adminSql<{ member_id: string; admin_id: string; tenant_id: string }[]>`
    select
      (select id from auth.users where email = ${MEMBER_EMAIL}) as member_id,
      (select id from auth.users where email = ${ADMIN_EMAIL}) as admin_id,
      (select id from public.tenants where slug = 'rede-demo') as tenant_id
  `;
  if (!ids?.member_id || !ids.admin_id || !ids.tenant_id)
    throw new Error('the rede-demo seed (tenant, member, admin) is missing');
  memberId = ids.member_id;
  tenantId = ids.tenant_id;

  const [community] = await adminSql<{ id: string }[]>`
    insert into public.communities (tenant_id, created_by_user_id, name, slug)
    values (${tenantId}::uuid, ${ids.admin_id}::uuid, ${MARKER}, ${MARKER})
    returning id
  `;
  const [post] = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, author_user_id, caption)
    values (${tenantId}::uuid, ${ids.admin_id}::uuid, ${MARKER})
    returning id
  `;
  if (!community || !post) throw new Error('could not insert the throwaway rows');
  communityId = community.id;
  postId = post.id;
  countsBefore = await tenantCounts();
});

afterAll(async () => {
  try {
    if (postId) await adminSql`delete from public.feed_posts where id = ${postId}::uuid`;
    await adminSql`
      delete from public.feed_posts
       where tenant_id = ${tenantId}::uuid and caption like ${`${MARKER}%`}
    `;
    await adminSql`
      delete from public.communities
       where slug like ${`${MARKER}%`} or name like ${`${MARKER}%`}
    `;
    if (memberId && tenantId)
      await adminSql`
        update public.memberships set role = 'member'
         where user_id = ${memberId}::uuid and tenant_id = ${tenantId}::uuid and role <> 'member'
      `;
  } finally {
    await adminSql.end();
  }
});

describe('Supabase Data API exposes only the empty data_api_closed schema (CR-01 of the 08.2 review)', () => {
  it('positive control: GoTrue accepts the member token', async () => {
    const res = await probe('/auth/v1/user', { headers: headers() });
    expect(res.status).toBe(200);
    expect((res.json as { id?: string } | null)?.id).toBe(memberId);
  });

  it('GET /rest/v1/users with the member token is refused', async () => {
    // `users_self_select` answered 200 with the member's own row while `public` was exposed.
    const res = await probe('/rest/v1/users?select=id', { headers: headers() });
    expectRefused(res, NO_TABLE);
  });

  it.each(TABLES)('GET /rest/v1/%s with the member token is refused', async (table) => {
    expectRefused(await probe(`/rest/v1/${table}?select=*&limit=1`, memberInit('GET')), NO_TABLE);
  });

  it('GET with Accept-Profile: public is refused as an unexposed schema', async () => {
    const res = await probe(
      '/rest/v1/communities?select=id&limit=1',
      memberInit('GET', undefined, { 'accept-profile': 'public' }),
    );
    expectProfileRefused(res);
  });

  it('GET with the publishable key alone (no authorization header) is refused', async () => {
    const res = await probe('/rest/v1/communities?select=id&limit=1', {
      headers: { apikey: required('SUPABASE_PUBLISHABLE_KEY') },
    });
    expectRefused(res, NO_TABLE);
  });

  it('POST /rest/v1/communities (an insert into the member tenant) is refused', async () => {
    const body = { tenant_id: tenantId, name: `${MARKER}-post`, slug: `${MARKER}-post` };
    expectRefused(await probe('/rest/v1/communities', memberInit('POST', body)), NO_TABLE);
    expectProfileRefused(
      await probe(
        '/rest/v1/communities',
        memberInit('POST', body, { 'content-profile': 'public' }),
      ),
    );
  });

  it('PATCH /rest/v1/communities (renaming the throwaway community) is refused', async () => {
    const res = await probe(
      `/rest/v1/communities?id=eq.${communityId}`,
      memberInit('PATCH', { name: `${MARKER}-renamed` }),
    );
    expectRefused(res, NO_TABLE);
  });

  it('PATCH /rest/v1/memberships (self-promotion to admin_tenant) is refused', async () => {
    const res = await probe(
      `/rest/v1/memberships?user_id=eq.${memberId}&tenant_id=eq.${tenantId}`,
      memberInit('PATCH', { role: 'admin_tenant' }),
    );
    expectRefused(res, NO_TABLE);
  });

  it('DELETE /rest/v1/feed_posts (the throwaway post) is refused', async () => {
    expectRefused(
      await probe(`/rest/v1/feed_posts?id=eq.${postId}`, memberInit('DELETE')),
      NO_TABLE,
    );
  });

  it('POST /rest/v1/rpc/handle_new_user is refused', async () => {
    expectRefused(await probe('/rest/v1/rpc/handle_new_user', memberInit('POST', {})), NO_FUNCTION);
  });

  it('POST /graphql/v1 (a query and a delete mutation) is refused', async () => {
    expectProfileRefused(
      await probe('/graphql/v1', memberInit('POST', { query: '{ __typename }' })),
    );
    const mutation = `mutation { deleteFromFeedPostsCollection(filter: { id: { eq: "${postId}" } }) { affectedCount } }`;
    expectProfileRefused(await probe('/graphql/v1', memberInit('POST', { query: mutation })));
  });

  it('GET /rest/v1/ (the OpenAPI root) names no public table', async () => {
    const res = await probe('/rest/v1/', memberInit('GET'));
    // The root of an empty schema is a valid OpenAPI document with no table paths.
    expect(res.status).toBe(200);
    expect(res.ms).toBeLessThan(5_000);
    for (const table of TABLES) expect(res.text).not.toContain(table);
    expect(Object.keys((res.json as { paths?: object } | null)?.paths ?? {})).toEqual(['/']);
  });

  it('the [api] block exposes only data_api_closed and keeps public off the search path', () => {
    const api = tomlBlock('[api]');
    expect(api).toContain('enabled = true');
    expect(api).toContain(`schemas = ["${CLOSED_SCHEMA}"]`);
    expect(api).toContain('extra_search_path = ["extensions"]');
    expect(api.filter((line) => line.includes('public'))).toEqual([]);
    for (const header of remoteApiHeaders()) {
      expect(tomlBlock(header).filter((line) => line.includes('public'))).toEqual([]);
    }
  });

  it('data_api_closed exists, holds no object and grants nothing to the API roles', async () => {
    const [ns] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pg_namespace where nspname = ${CLOSED_SCHEMA}
    `;
    expect(ns?.n).toBe(1);
    const [objects] = await adminSql<{ relations: number; functions: number; types: number }[]>`
      select
        (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = ${CLOSED_SCHEMA}) as relations,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = ${CLOSED_SCHEMA}) as functions,
        (select count(*)::int from pg_type t join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = ${CLOSED_SCHEMA}) as types
    `;
    expect(objects).toEqual({ relations: 0, functions: 0, types: 0 });
    for (const role of API_ROLES) {
      const [priv] = await adminSql<{ usage: boolean; create: boolean }[]>`
        select
          has_schema_privilege(${role}, ${CLOSED_SCHEMA}, 'USAGE') as usage,
          has_schema_privilege(${role}, ${CLOSED_SCHEMA}, 'CREATE') as create
      `;
      expect({ role, ...priv }).toEqual({ role, usage: false, create: false });
    }
  });

  it('no probe changed the database', async () => {
    const [community] = await adminSql<{ name: string }[]>`
      select name from public.communities where id = ${communityId}::uuid
    `;
    expect(community?.name).toBe(MARKER);
    const [post] = await adminSql<{ deleted_at: Date | null }[]>`
      select deleted_at from public.feed_posts where id = ${postId}::uuid
    `;
    expect(post).toBeDefined();
    expect(post?.deleted_at).toBeNull();
    const [membership] = await adminSql<{ role: string }[]>`
      select role from public.memberships
       where user_id = ${memberId}::uuid and tenant_id = ${tenantId}::uuid
    `;
    expect(membership?.role).toBe('member');
    const strays = await adminSql<{ id: string }[]>`
      select id from public.communities
       where id <> ${communityId}::uuid and (name like ${`${MARKER}%`} or slug like ${`${MARKER}%`})
    `;
    expect(strays).toEqual([]);
    expect(await tenantCounts()).toEqual(countsBefore);
  });
});
