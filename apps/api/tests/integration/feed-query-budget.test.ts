import { sqlClient } from '@rede-social/core/db';
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
 * `GET /v1/communities` (05-01): ONE statement against the community tables, cover hydration
 * included. The cover's variant ladder is a `left join media_assets` inside the SAME statement the
 * community rows come from, never one lookup per card — which is the whole reason the join is in
 * `communityProjection` rather than in a loop over the page.
 */
// biome-ignore lint/suspicious/noExportsInTest: colocated with the only assertion that proves it
export const COMMUNITY_LIST_STATEMENT_BUDGET = 1;

/**
 * `GET /v1/stories` (05-05): ONE statement against the story tables, media hydration AND
 * `viewerLiked` included (Pitfall 11).
 *
 * The strip is the widget at the TOP of `/inicio`, so it pays on every home-screen render for every
 * member — a per-circle lookup for the thumbnail ladder would be the most-executed N+1 in the
 * product. `storyProjection` does the `join media_assets` and the `feed_likes` existence check in
 * the same statement the story rows come from, and this budget is what keeps it there.
 */
// biome-ignore lint/suspicious/noExportsInTest: colocated with the only assertion that proves it
export const STORY_LIST_STATEMENT_BUDGET = 1;

/**
 * `GET /v1/stories/highlights` (05.2): EXACTLY one statement against the story tables — the place's
 * row with each highlight's read-time cover (a lateral over the uploaded asset, the chosen story and
 * the most recently added image item) and its member-visible `itemCount`, all in the statement the
 * highlight rows come from. The row renders on `/inicio` and on every community page, so a lookup per
 * circle would be paid by every member on every visit.
 */
// biome-ignore lint/suspicious/noExportsInTest: colocated with the only assertion that proves it
export const STORY_HIGHLIGHT_ROW_STATEMENT_BUDGET = 1;

/**
 * Every table the feed module reads. `feed_comments` and `feed_likes` are now real (04-03) and the
 * list budget still holds at ONE: `viewerLiked`'s `feed_likes` join landed in the SAME statement,
 * which is exactly what this regex was written in 04-01 to force. `feed_post_media` and
 * `feed_link_previews` do not exist yet (04-04 adds them) and are named for the same reason.
 */
const FEED_TABLES_PATTERN = 'feed_(posts|post_media|comments|likes|link_previews)';

/**
 * The community module's own tables. `community_members` is named although V1 never reads it
 * (COMM-02 is a policy value): the day a join against it appears in the list, this budget is what
 * turns that into a red build rather than a silently more expensive page.
 */
const COMMUNITY_TABLES_PATTERN = 'communit(ies|y_members)';

/**
 * The story module's own table. `feed_likes` is deliberately NOT named here even though
 * `storyProjection` reads it: the feed regex already covers it, and naming it twice would let a
 * story page borrow the feed's budget headroom.
 */
const STORY_TABLES_PATTERN = 'stories';

/**
 * The highlight tables AND `stories`: the row read's cover and `itemCount` join `stories`, so a
 * per-highlight lookup against either would be counted.
 */
const STORY_HIGHLIGHT_TABLES_PATTERN = 'stor(ies|y_highlights|y_highlight_items)';

/**
 * 06-03: `GET /v1/events` — ONE statement per page, the viewer's own attendance and the two D-219
 * counts included. The counts come from a lateral aggregate inside `eventSource`, so a per-poster
 * count lookup would show up here as 10 statements instead of 1.
 */
const EVENT_LIST_STATEMENT_BUDGET = 1;

/**
 * `events` as a whole word (never `media_provider_events`, whose `_` is a word character) and
 * `event_attendances`: every statement that touches either table is counted.
 */
const EVENT_TABLES_PATTERN = '\\yevents\\y|event_attendances';

let token = '';
/**
 * The demo ADMIN (05.1-02): the archived community list is a manager read (D-89), so its budget is
 * measured with a session that holds `communities.community.manage`. Every other case keeps the
 * member token — the budgets that matter most are the ones every member pays.
 */
let adminToken = '';
let tenantId = '';
const created: string[] = [];
/** The post the detail/comments budget is measured against, plus its root comment. */
let detailPostId = '';
let detailRootId = '';

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  token = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  adminToken = await signInAs('admin@rede-demo.local', SEED_PASSWORD);

  const [tenant] = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = 'rede-demo'`;
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
      insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
      values (${tenantId}::uuid, ${detailPostId}::uuid, ${author?.id ?? null}::uuid,
              ${`Orcamento resposta ${i}`}, 1, ${detailRootId}::uuid, 0, 'post')`;
  }
});

afterAll(async () => {
  if (created.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${created}::uuid[])`;
  }
  await adminSql`delete from public.feed_posts where caption like 'Orcamento de consultas %'`;
  // Crash sweep for the 05.3-02 Reels fixture: its post went with the line above, so its container
  // can go now (`feed_posts.community_id` has no cascade).
  await adminSql`delete from public.communities where name = 'Orcamento de consultas reels'`;
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

  /**
   * 05-03 / D-71 — the community label is FREE, and this is where that claim is checked.
   *
   * `postProjection` gained a `left join public.communities`, which is the only way the "em
   * {Comunidade}" segment can cost nothing: a lookup per labelled post would be a ten-post page
   * paying ten extra round trips, and it would be invisible in every functional assertion because
   * the payload would be identical. The budget above already holds the FEED tables at one; this
   * holds the COMMUNITY tables at one for the same page, so the join really is inside the same
   * statement rather than beside it.
   *
   * Bidirectional again, and the floor here has real work to do: the regex must match the merged
   * feed's statement, and it can only match it if the join is actually in it. A zero would mean the
   * label had quietly stopped being hydrated, not that the page got cheaper.
   */
  it(`hydrates the D-71 community label inside the SAME statement (at most ${COMMUNITY_LIST_STATEMENT_BUDGET})`, async () => {
    await adminSql`select pg_stat_statements_reset()`;

    // A FULL page (the contract's maximum), so the page is wide enough to contain both sources —
    // this file's own 12 tenant-wide fixtures sit on top of the seed's community posts.
    const res = await api.request('/v1/feed?limit=25', {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { community: { name: string } | null }[] };
    expect(body.items.length).toBe(25);
    // Guard against the budget passing vacuously on a page whose posts are all tenant-wide — the
    // label's hydration is the thing under measurement, so a labelled post has to be on the page.
    expect(body.items.some((item) => item.community !== null)).toBe(true);

    const calls = await communityCalls();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(COMMUNITY_LIST_STATEMENT_BUDGET);
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

/** Sum of `calls` over the COMMUNITY tables since the last reset — filtered, never a total. */
async function communityCalls(): Promise<number> {
  const [measured] = await adminSql<{ calls: number }[]>`
    select coalesce(sum(calls), 0)::int as calls
      from pg_stat_statements
     where query ~ ${COMMUNITY_TABLES_PATTERN}`;
  return measured?.calls ?? 0;
}

/** Sum of `calls` over the EVENT tables since the last reset — filtered, never a total. */
async function eventCalls(): Promise<number> {
  const [measured] = await adminSql<{ calls: number }[]>`
    select coalesce(sum(calls), 0)::int as calls
      from pg_stat_statements
     where query ~ ${EVENT_TABLES_PATTERN}`;
  return measured?.calls ?? 0;
}

describe('GET /v1/events — the events list query budget (06-03)', () => {
  it(`costs at most ${EVENT_LIST_STATEMENT_BUDGET} statement against the event tables, counts included`, async () => {
    await adminSql`select pg_stat_statements_reset()`;

    const res = await api.request('/v1/events?period=upcoming&limit=10', {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { confirmedCount: number | null; presentCount: number | null }[];
    };
    // Guard against a vacuous pass: the seeded upcoming events are on the page, each carrying both
    // counts, and at least one of them is non-zero (the seeded answers), so the aggregate really ran.
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.confirmedCount).not.toBeNull();
      expect(item.presentCount).not.toBeNull();
    }
    expect(body.items.some((item) => (item.confirmedCount ?? 0) > 0)).toBe(true);

    // Floor AND ceiling: a zero would mean the regex matched nothing, not that the page got cheaper.
    const calls = await eventCalls();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(EVENT_LIST_STATEMENT_BUDGET);
  });
});

/** Sum of `calls` over the STORY table since the last reset — filtered, never a total. */
async function storyCalls(): Promise<number> {
  const [measured] = await adminSql<{ calls: number }[]>`
    select coalesce(sum(calls), 0)::int as calls
      from pg_stat_statements
     where query ~ ${STORY_TABLES_PATTERN}`;
  return measured?.calls ?? 0;
}

describe('GET /v1/communities — the community list query budget (05-01)', () => {
  it(`costs at most ${COMMUNITY_LIST_STATEMENT_BUDGET} statement against the community tables`, async () => {
    await adminSql`select pg_stat_statements_reset()`;

    const res = await api.request('/v1/communities?limit=10', {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { coverAssetId: string | null }[] };
    // Guard against the budget passing vacuously on an empty list, and against it passing on a page
    // whose covers all happened to be null — the hydration join is the thing under measurement.
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((item) => item.coverAssetId !== null)).toBe(true);

    // BIDIRECTIONAL, for the same reason the feed budgets are: a zero here would mean the regex
    // matched nothing (a table renamed, pg_stat_statements not loaded), not that the page got
    // cheaper. The floor is what stops an empty measurement passing at zero.
    const calls = await communityCalls();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(COMMUNITY_LIST_STATEMENT_BUDGET);
  });

  it(`05.1 / D-91: the ARCHIVED list (status=archived) also costs at most ${COMMUNITY_LIST_STATEMENT_BUDGET} statement, covers hydrated`, async () => {
    // The archived branch has NO dedicated index, by decision (D-91): the set is small and only
    // managers read it. What it may not do is cost more than one statement — its cover ladder comes
    // from the same `communityProjection` join, and its cursor key rides the same row.
    await adminSql`select pg_stat_statements_reset()`;

    const res = await api.request('/v1/communities?status=archived&limit=10', {
      headers: { authorization: `Bearer ${adminToken}`, 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { coverAssetId: string | null; status: string }[];
    };
    // The seed's archived community carries a cover (`scripts/seed.ts`, `coverIndex: 0`), so this
    // page is non-empty AND runs the hydration join — the budget cannot pass vacuously.
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.status === 'archived')).toBe(true);
    expect(body.items.some((item) => item.coverAssetId !== null)).toBe(true);

    const calls = await communityCalls();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(COMMUNITY_LIST_STATEMENT_BUDGET);
  });
});

describe('GET /v1/stories — the strip query budget (05-05, Pitfall 11)', () => {
  it(`costs at most ${STORY_LIST_STATEMENT_BUDGET} statement against the story tables`, async () => {
    await adminSql`select pg_stat_statements_reset()`;

    const res = await api.request('/v1/stories?limit=10', {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        mediaAssetId: string;
        mediaVariantWidths: number[];
        viewerLiked: boolean;
        viewerSeen: boolean;
      }[];
    };
    // Guard against the budget passing vacuously on an empty strip, and against it passing on a
    // page whose ladders all happened to be empty — the hydration join is the thing under
    // measurement, so a circle that really needs a thumbnail has to be on the page.
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((item) => item.mediaVariantWidths.length > 0)).toBe(true);
    // `viewerLiked` is in the same statement or it is an N+1; a page where the field is missing
    // entirely would satisfy the count while having stopped being answered.
    expect(body.items.every((item) => typeof item.viewerLiked === 'boolean')).toBe(true);
    // 05.2-10 (HIGHLIGHT-06): `viewer_seen` — the tenant ring — RIDES THE SAME STATEMENT, as one more
    // `exists` column of `storyProjection` over `story_views_uq`. The ceiling below stays 1, and a
    // statement that read `story_views` on its own (a second round trip for the ring) is refused
    // explicitly, because the `stories` regex would not count it.
    expect(body.items.every((item) => typeof item.viewerSeen === 'boolean')).toBe(true);

    // BIDIRECTIONAL, for the same reason every budget above is: a zero here would mean the regex
    // matched nothing (the table renamed, pg_stat_statements not loaded), not that the strip got
    // cheaper. The floor is what stops an empty measurement passing at zero (B-WR-06).
    const calls = await storyCalls();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(STORY_LIST_STATEMENT_BUDGET);
    // Read AFTER the ceiling, so this measurement can never be counted by it.
    const [separateViewReads] = await adminSql<{ calls: number }[]>`
      select coalesce(sum(calls), 0)::int as calls
        from pg_stat_statements
       where query ~ 'story_views' and query !~ 'stories'`;
    expect(separateViewReads?.calls ?? 0).toBe(0);
  });
});

/** Sum of `calls` over the story AND highlight tables since the last reset — filtered, never a total. */
async function storyHighlightCalls(): Promise<number> {
  const [measured] = await adminSql<{ calls: number }[]>`
    select coalesce(sum(calls), 0)::int as calls
      from pg_stat_statements
     where query ~ ${STORY_HIGHLIGHT_TABLES_PATTERN}`;
  return measured?.calls ?? 0;
}

describe('GET /v1/stories/highlights — the row read budget (05.2)', () => {
  it(`costs exactly ${STORY_HIGHLIGHT_ROW_STATEMENT_BUDGET} statement against the story tables, covers and counts included`, async () => {
    await adminSql`select pg_stat_statements_reset()`;

    const res = await api.request('/v1/stories/highlights', {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { coverAssetId: string | null; itemCount: number }[];
    };
    // Guard against a vacuous pass: the seeded `Bastidores` is on the member's row with an automatic
    // image cover, so the cover lateral and the count really ran.
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((item) => item.coverAssetId !== null)).toBe(true);
    expect(body.items.every((item) => item.itemCount > 0)).toBe(true);

    // Ceiling AND floor, as the strip case: a zero would mean the regex matched nothing.
    const calls = await storyHighlightCalls();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBe(STORY_HIGHLIGHT_ROW_STATEMENT_BUDGET);
  });
});

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

/**
 * `GET /v1/feed?media=video` (05.3-02, REELS-03): EXACTLY one statement against the feed tables. The
 * ready-video narrowing is an `exists` probe appended to the SAME keyset statement Início runs
 * (`READY_VIDEO_POST`), never a second query that filters the page afterwards — a per-post "is the
 * video ready?" lookup would be the N+1 the Reels pager pays on every swipe.
 */
// biome-ignore lint/suspicious/noExportsInTest: colocated with the only assertion that proves it
export const REELS_LIST_STATEMENT_BUDGET = 1;

/**
 * `GET /v1/feed/video-communities` (05.3-02, REELS-04): EXACTLY one statement — the active
 * communities AND the per-community "holds a ready video" `exists` in the statement the rows come
 * from. It is counted twice, once over the feed tables and once over the community tables, because
 * it reads both: a lookup per community on either side would move one of the two numbers.
 */
// biome-ignore lint/suspicious/noExportsInTest: colocated with the only assertion that proves it
export const REELS_LANES_STATEMENT_BUDGET = 1;

describe('Reels — the video list and the lanes query budgets (05.3-02)', () => {
  /** A fresh demo community holding one READY video post, so neither read is measured empty. */
  const fixture = { communityId: '', postId: '', assetId: '' };

  beforeAll(async () => {
    const [author] = await adminSql<{ id: string }[]>`
      select u.id from public.users u
        join public.memberships m on m.user_id = u.id
       where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant' limit 1`;
    const [community] = await adminSql<{ id: string }[]>`
      insert into public.communities (tenant_id, created_by_user_id, name, slug)
      values (${tenantId}::uuid, ${author?.id ?? null}::uuid, 'Orcamento de consultas reels',
              ${`orcamento-reels-${Date.now()}`})
      returning id`;
    const [asset] = await adminSql<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
         mime, bytes, width, height, duration_seconds, aspect_ratio, filename, ready_at)
      values (${tenantId}::uuid, ${author?.id ?? null}::uuid, 'video', 'post', 'ready', 'fake',
              ${`fake-budget-${crypto.randomUUID()}`}, ${`pb-budget-${crypto.randomUUID()}`},
              'video/mp4', 1048576, 1080, 1920, 15, '9:16', 'orcamento.mp4', now())
      returning id`;
    const [post] = await adminSql<{ id: string }[]>`
      insert into public.feed_posts (tenant_id, author_user_id, caption, media_kind, community_id)
      values (${tenantId}::uuid, ${author?.id ?? null}::uuid, 'Orcamento de consultas reels',
              'video', ${community?.id ?? null}::uuid)
      returning id`;
    await adminSql`
      insert into public.feed_post_media
        (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${tenantId}::uuid, ${post?.id ?? null}::uuid, 'video', ${asset?.id ?? null}::uuid,
              'video', 0)`;
    fixture.communityId = community?.id ?? '';
    fixture.postId = post?.id ?? '';
    fixture.assetId = asset?.id ?? '';
  });

  afterAll(async () => {
    // Post first (`feed_posts.community_id` has no cascade), then its container and its asset.
    if (fixture.postId)
      await adminSql`delete from public.feed_posts where id = ${fixture.postId}::uuid`;
    if (fixture.communityId) {
      await adminSql`delete from public.communities where id = ${fixture.communityId}::uuid`;
    }
    if (fixture.assetId) {
      await adminSql`delete from public.media_assets where id = ${fixture.assetId}::uuid`;
    }
  });

  it(`GET /v1/feed?media=video costs exactly ${REELS_LIST_STATEMENT_BUDGET} statement against the feed tables`, async () => {
    await adminSql`select pg_stat_statements_reset()`;

    const res = await api.request('/v1/feed?media=video&limit=10', {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; mediaKind: string }[] };
    // Guard against a vacuous pass: the fixture's ready video is on the page, and only videos are.
    expect(body.items.map((item) => item.id)).toContain(fixture.postId);
    expect(body.items.every((item) => item.mediaKind === 'video')).toBe(true);

    // Floor AND exact: a zero would mean the regex matched nothing, not that the page got cheaper.
    const calls = await feedCalls();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBe(REELS_LIST_STATEMENT_BUDGET);
  });

  it(`GET /v1/feed/video-communities costs exactly ${REELS_LANES_STATEMENT_BUDGET} statement, over the feed AND the community tables`, async () => {
    await adminSql`select pg_stat_statements_reset()`;

    const res = await api.request('/v1/feed/video-communities', {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[] };
    // Guard against a vacuous pass: the fixture community is a lane, so the `exists` really ran.
    expect(body.items.map((item) => item.id)).toContain(fixture.communityId);

    const feed = await feedCalls();
    expect(feed).toBeGreaterThan(0);
    expect(feed).toBe(REELS_LANES_STATEMENT_BUDGET);
    const community = await communityCalls();
    expect(community).toBeGreaterThan(0);
    expect(community).toBe(REELS_LANES_STATEMENT_BUDGET);
  });
});
