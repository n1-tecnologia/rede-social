import { sqlClient } from '@tria/core/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Criterion 4's query budget: **one `GET /v1/feed` page costs at most ONE statement against the feed
 * tables.** The author's display name and avatar asset id come back in the same hydrated statement,
 * never one query per row (Pitfall 3 / PITFALLS §10 — six queries per post is 121 round trips for a
 * 20-post page).
 *
 * Two things make this measurable rather than decorative:
 *
 *  - **The budget is a FILTERED SUM, not a total.** `pg_stat_statements.track_utility` is `on` in
 *    the local stack, so `BEGIN`, `COMMIT`, `SET LOCAL ROLE authenticated` and the `set_config`
 *    call are all counted — and `withTenantTx` issues four of them on EVERY request. A total would
 *    be a number nobody can reason about. The regex names the feed tables and nothing else.
 *  - **It sums `calls`, and never counts ROWS.** Statement text is normalised, so two executions of
 *    the same statement collapse into ONE row with `calls = 2`. Counting matching rows instead would
 *    score a ten-post N+1 as a 1 and pass.
 *
 * The number has a name so a future regression is a diff rather than a mystery.
 */
// The budget is DELIBERATELY colocated with the assertion that enforces it: a shared constants
// module would let the number drift away from the only place that can prove it, and 04-03/04-04
// must raise it HERE when they widen the statement.
// biome-ignore lint/suspicious/noExportsInTest: colocated with the only assertion that proves it
export const FEED_LIST_STATEMENT_BUDGET = 1;

/**
 * The POST PAGE's budget (04-03, RESEARCH Open Question 4): one `GET /v1/feed/posts/{id}` plus one
 * `GET /v1/feed/posts/{id}/comments` together. Three, and here is what each one is:
 *   1. the hydrated post — author, counters and `viewerLiked` in ONE statement;
 *   2. the comment route's visibility check on the post, which is what makes a foreign-tenant post
 *      answer the same bare 404 the detail read gives instead of an empty list;
 *   3. the hydrated ROOT page — author, `viewerLiked` and `replyCount` in ONE statement, never one
 *      query per root.
 * Replies are not in this number: they load on "Ver N respostas" (D-60) and cost one statement of
 * their own, which the second test pins.
 */
// biome-ignore lint/suspicious/noExportsInTest: colocated with the only assertion that proves it
export const FEED_DETAIL_STATEMENT_BUDGET = 3;

/** A "ver respostas" tap is ONE statement, however many replies come back. */
// biome-ignore lint/suspicious/noExportsInTest: colocated with the only assertion that proves it
export const FEED_REPLIES_STATEMENT_BUDGET = 1;

/**
 * Every table the feed module reads. `feed_comments` and `feed_likes` are now real (04-03) and the
 * list budget still holds at ONE: `viewerLiked`'s `feed_likes` join landed in the SAME statement,
 * which is exactly what this regex was written in 04-01 to force. `feed_post_media` and
 * `feed_link_previews` do not exist yet (04-04 adds them) and are named for the same reason.
 */
const FEED_TABLES_PATTERN = 'feed_(posts|post_media|comments|likes|link_previews)';

let token = '';
let tenantId = '';
const created: string[] = [];
/** The post the detail/comments budget is measured against, plus its root comment. */
let detailPostId = '';
let detailRootId = '';

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  token = await signInAs('member@tria-demo.local', SEED_PASSWORD);

  const [tenant] = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = 'tria-demo'`;
  tenantId = tenant?.id ?? '';

  const [author] = await adminSql<{ id: string }[]>`
    select u.id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant' limit 1`;

  // At least 12 posts, so a `?limit=10` page is genuinely full and an N+1 would have 10 chances to
  // show up rather than one or two.
  const base = Date.now();
  for (let i = 0; i < 12; i++) {
    const rows = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, caption, author_user_id, created_at)
      values (
        ${tenantId}::uuid,
        ${`Orcamento de consultas ${i}`},
        ${author?.id ?? null}::uuid,
        ${new Date(base - (12 - i) * 60_000).toISOString()}::timestamptz
      )
      returning id`;
    const id = rows[0]?.id;
    if (id) created.push(id);
  }

  // A post with a real thread on it: 12 root comments and 5 replies under one of them, so an N+1 in
  // either list has plenty of chances to show up rather than one or two.
  //
  // The roots carry EXPLICIT timestamps and the one that has replies is the NEWEST, so it lands on
  // the first `?limit=10` page. Without that the vacuity guard below ("some root on this page has
  // replies") would be measuring insertion order rather than the thing it is guarding against.
  detailPostId = created[0] ?? '';
  for (let i = 0; i < 11; i++) {
    await adminSql`
      insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, created_at)
      values (${tenantId}::uuid, ${detailPostId}::uuid, ${author?.id ?? null}::uuid,
              ${`Orcamento raiz ${i}`}, 0, null, null,
              ${new Date(base - (12 - i) * 60_000).toISOString()}::timestamptz)`;
  }
  const [root] = await adminSql<{ id: string }[]>`
    insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, created_at)
    values (${tenantId}::uuid, ${detailPostId}::uuid, ${author?.id ?? null}::uuid,
            'Orcamento raiz com respostas', 0, null, null, now())
    returning id`;
  detailRootId = root?.id ?? '';
  for (let i = 0; i < 5; i++) {
    await adminSql`
      insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth)
      values (${tenantId}::uuid, ${detailPostId}::uuid, ${author?.id ?? null}::uuid,
              ${`Orcamento resposta ${i}`}, 1, ${detailRootId}::uuid, 0)`;
  }
});

afterAll(async () => {
  if (created.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${created}::uuid[])`;
  }
  await adminSql`delete from public.feed_posts where caption like 'Orcamento de consultas %'`;
  await adminSql`delete from public.feed_comments where body like 'Orcamento %'`;
  await adminSql.end();
  await sqlClient.end();
});

describe('GET /v1/feed — the CI query budget (criterion 4)', () => {
  it(`costs at most ${FEED_LIST_STATEMENT_BUDGET} statement against the feed tables`, async () => {
    // `pg_stat_statements_reset()` needs the superuser connection; the API's own `api_user` may not
    // (and must not) reset it.
    await adminSql`select pg_stat_statements_reset()`;

    const res = await api.request('/v1/feed?limit=10', {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    // Guard against the budget passing vacuously on an empty feed.
    expect(body.items.length).toBe(10);

    const [measured] = await adminSql<{ calls: number }[]>`
      select coalesce(sum(calls), 0)::int as calls
        from pg_stat_statements
       where query ~ ${FEED_TABLES_PATTERN}`;

    // BIDIRECTIONAL. The ceiling alone is one-directional: if FEED_TABLES_PATTERN ever stops
    // matching any statement (a table renamed, the regex edited, pg_stat_statements not loaded) the
    // sum is 0 and the budget passes while measuring NOTHING. The floor makes a vacuous measurement
    // red, so this assertion fails both when the cost rises and when it stops being measured.
    expect(measured?.calls ?? 0).toBeGreaterThan(0);
    expect(measured?.calls ?? 0).toBeLessThanOrEqual(FEED_LIST_STATEMENT_BUDGET);
  });
});

/** Sum of `calls` over the feed tables since the last reset — the filtered measure, never a total. */
async function feedCalls(): Promise<number> {
  const [measured] = await adminSql<{ calls: number }[]>`
    select coalesce(sum(calls), 0)::int as calls
      from pg_stat_statements
     where query ~ ${FEED_TABLES_PATTERN}`;
  return measured?.calls ?? 0;
}

describe('the post page — the detail query budget (04-03, criterion 4)', () => {
  it(`costs at most ${FEED_DETAIL_STATEMENT_BUDGET} statements for the post plus its comments`, async () => {
    await adminSql`select pg_stat_statements_reset()`;

    const headers = { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo };
    const post = await api.request(`/v1/feed/posts/${detailPostId}`, { headers });
    expect(post.status).toBe(200);
    const list = await api.request(`/v1/feed/posts/${detailPostId}/comments?limit=10`, { headers });
    expect(list.status).toBe(200);

    // Guard against the budget passing vacuously on a post with no thread on it.
    const body = (await list.json()) as { items: { replyCount: number }[] };
    expect(body.items.length).toBe(10);
    expect(body.items.some((c) => c.replyCount > 0)).toBe(true);

    // Bidirectional, same reason as the list budget: a zero here would mean the regex matched
    // nothing, not that the post page got cheaper.
    const calls = await feedCalls();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(FEED_DETAIL_STATEMENT_BUDGET);
  });

  it(`a "ver respostas" tap costs at most ${FEED_REPLIES_STATEMENT_BUDGET} statement`, async () => {
    await adminSql`select pg_stat_statements_reset()`;

    const res = await api.request(`/v1/feed/comments/${detailRootId}/replies`, {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items.length).toBe(5);

    // Bidirectional: a vacuous measurement is a failure, not a free pass.
    const calls = await feedCalls();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(FEED_REPLIES_STATEMENT_BUDGET);
  });
});
