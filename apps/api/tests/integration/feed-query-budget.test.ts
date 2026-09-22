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
 * Every table the feed module reads on a list. `feed_post_media`, `feed_comments`, `feed_likes` and
 * `feed_link_previews` do not exist yet (04-03/04-04 add them) and are named on purpose: the day
 * `viewerLiked` stops being hard-`false`, the join must land in the SAME statement or this test
 * goes red.
 */
const FEED_TABLES_PATTERN = 'feed_(posts|post_media|comments|likes|link_previews)';

let token = '';
let tenantId = '';
const created: string[] = [];

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
});

afterAll(async () => {
  if (created.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${created}::uuid[])`;
  }
  await adminSql`delete from public.feed_posts where caption like 'Orcamento de consultas %'`;
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

    expect(measured?.calls ?? 0).toBeLessThanOrEqual(FEED_LIST_STATEMENT_BUDGET);
  });
});
