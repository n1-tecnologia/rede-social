# 09-03 Wave 0 spike: the Explorar query form and its indexes

Measured 2026-10-19 on the local stack (PostgreSQL 17, `pnpm db:reset && pnpm db:seed` first), by
`09-03-spike.sql` in this directory. The script is ONE transaction that ends in `rollback;`; after it
the stack holds no spike row and no spike index (`select count(*) from pg_indexes where indexname like
'spike_%'` is 0, and the spike tenant has 0 posts). Nothing in the repository's production code was
touched by this task. Plan 04 consumes the last lines of this file and does not hard-code a form.

## What was measured

**Fixture** (one tenant, `social` enabled): 60 members and 1 admin; **20000 member posts**
(`visibility = 'followers'`, skewed authors: member 1 wrote 5157, member 2 1296, member 10 385, the three
rarest members 58, 59, 60 wrote 113, 116 and 119; 3373 are ready videos); **2400 organization posts**
(`visibility = 'tenant'`, 2000 tenant-wide and 400 inside 4 communities, 50 of them ready videos). The
member timeline is about ten times denser than the organization's, which is the shape RESEARCH Pitfall 4
worries about. Two probe members:

- **F50** (member 30) follows 50 prolific authors (their posts: 18755 of the 20000);
- **F3** (member 31) follows the 3 rarest authors (their posts: 348).

Every read ran as the `authenticated` role with the tenant claims (`set local role` plus
`request.jwt.claims`), so RLS, including the new restrictive `feed_posts_social_gate` and the
`app.social_visible_author_ids()` definer, is inside every plan. The statement is the service's
projection verbatim in shape (the `memberships`, `member_profiles`, `feed_likes`, `feed_link_previews`,
`communities` joins and the media lateral), keyset page of 12 (11 rows plus the over-fetch), `explain
(analyze, buffers)`. Page 5 and page 21 cursors are the real (created_at, id) of row 44 and row 220 of that
member's own feed, captured with `\gset`.

**Forms.** A = ANY_SET: `author_user_id = any (app.social_visible_author_ids())` through the policy and the
service fragment (the Task 1 statement). B = LATERAL_TOPN: `unnest` of the followed set, a `LATERAL`
taking at most 11 newest rows per followee with the keyset predicate inside each branch, merged by
`order by created_at desc, id desc limit 12`, then the projection joined on the picked ids.

**Index states.** BASE = only the indexes that exist today. WITH adds I1 and I2. ORG adds I3 and I4.
TRAIL replaces I1 by I1b to test RESEARCH A2.

| Id | Definition |
|---|---|
| I1 | `(tenant_id, created_at desc nulls first, id desc nulls first) where visibility = 'followers'` |
| I2 | `(tenant_id, author_user_id, created_at desc nulls first, id desc nulls first) where visibility = 'followers'` |
| I3 | `(tenant_id, created_at desc nulls first, id desc nulls first) where visibility = 'tenant'` |
| I4 | `(tenant_id, created_at desc nulls first, id desc nulls first) where visibility = 'tenant' and community_id is null` |
| I1b | `(tenant_id, created_at desc nulls first, id desc nulls first, author_user_id) where visibility = 'followers'` |

## Results

Columns: the `feed_posts` node(s) the planner chose (by index name), `Execution Time`, the root node's
`Buffers: shared hit`, and the sum of `Rows Removed by Filter` across the plan. No plan in any state
contains a `Seq Scan on feed_posts`.

| State | Read | feed_posts node(s) | Execution Time | Shared hit | Rows removed by filter |
|---|---|---|---|---|---|
| BASE | A ANY_SET F50 page 1 | feed_posts_tenant_created_idx | 0.806 ms | 158 | 32 |
| BASE | A ANY_SET F50 page 5 | feed_posts_tenant_created_idx | 0.594 ms | 110 | 31 |
| BASE | A ANY_SET F3 page 1 | feed_posts_tenant_created_idx | 0.632 ms | 157 | 310 |
| BASE | A ANY_SET F3 page 5 | feed_posts_tenant_created_idx | 0.615 ms | 210 | 563 |
| BASE | B LATERAL_TOPN F50 page 1 | feed_posts_id_media_kind_uq, feed_posts_tenant_author_idx | 5.686 ms | 9119 | 48 |
| BASE | B LATERAL_TOPN F50 page 5 | feed_posts_id_media_kind_uq, feed_posts_tenant_author_idx | 5.293 ms | 9119 | 49 |
| BASE | B LATERAL_TOPN F3 page 1 | feed_posts_id_media_kind_uq, feed_posts_tenant_author_idx | 1.154 ms | 637 | 48 |
| BASE | B LATERAL_TOPN F3 page 5 | feed_posts_id_media_kind_uq, feed_posts_tenant_author_idx | 1.056 ms | 629 | 59 |
| BASE | C MODERATOR all members page 1 | feed_posts_tenant_created_idx | 0.175 ms | 88 | 29 |
| BASE | D INICIO merged (communities on) | feed_posts_tenant_created_all_idx | 0.650 ms | 307 | 128 |
| BASE | D INICIO community_id is null | feed_posts_tenant_created_idx | 0.082 ms | 61 | 148 |
| BASE | D REELS today (video path, visibility tenant) | feed_posts_tenant_video_created_idx | 0.951 ms | 946 | 3361 |
| BASE | D REELS plan 04 (video path, shared member fragment) | feed_posts_tenant_video_created_idx | 0.602 ms | 214 | 29 |
| WITH | A ANY_SET F50 page 1 | spike_i1 | 0.684 ms | 101 | 31 |
| WITH | A ANY_SET F50 page 5 | spike_i1 | 0.627 ms | 105 | 29 |
| WITH | A ANY_SET F3 page 1 | spike_i1 | 0.620 ms | 99 | 284 |
| WITH | A ANY_SET F3 page 5 | spike_i1 | 0.617 ms | 96 | 513 |
| WITH | B LATERAL_TOPN F50 page 1 | feed_posts_id_media_kind_uq, spike_i2 | 1.421 ms | 653 | 28 |
| WITH | B LATERAL_TOPN F50 page 5 | feed_posts_id_media_kind_uq, spike_i2 | 1.145 ms | 711 | 28 |
| WITH | B LATERAL_TOPN F3 page 1 | feed_posts_id_media_kind_uq, spike_i2 | 0.865 ms | 202 | 28 |
| WITH | B LATERAL_TOPN F3 page 5 | feed_posts_id_media_kind_uq, spike_i2 | 0.835 ms | 195 | 28 |
| WITH | C MODERATOR all members page 1 | spike_i1 | 0.171 ms | 85 | 28 |
| WITH | D INICIO merged (communities on) | feed_posts_tenant_created_all_idx | 0.449 ms | 88 | 128 |
| WITH | D INICIO community_id is null | feed_posts_tenant_created_idx | 0.095 ms | 61 | 148 |
| WITH | D REELS today (video path, visibility tenant) | feed_posts_tenant_video_created_idx | 1.076 ms | 946 | 3361 |
| WITH | D REELS plan 04 (video path, shared member fragment) | feed_posts_tenant_video_created_idx | 0.662 ms | 214 | 29 |
| WITH | A ANY_SET F3 page 21 | spike_i1 | 0.641 ms | 95 | 628 |
| WITH | B LATERAL_TOPN F3 page 21 | feed_posts_id_media_kind_uq, spike_i2 | 0.863 ms | 195 | 28 |
| ORG | A ANY_SET F50 page 1 | spike_i1 | 0.644 ms | 103 | 31 |
| ORG | A ANY_SET F50 page 5 | spike_i1 | 0.586 ms | 105 | 29 |
| ORG | A ANY_SET F3 page 1 | spike_i1 | 0.596 ms | 100 | 284 |
| ORG | A ANY_SET F3 page 5 | spike_i1 | 0.587 ms | 99 | 513 |
| ORG | B LATERAL_TOPN F50 page 1 | feed_posts_id_media_kind_uq, spike_i2 | 1.193 ms | 713 | 28 |
| ORG | B LATERAL_TOPN F50 page 5 | feed_posts_id_media_kind_uq, spike_i2 | 1.189 ms | 711 | 28 |
| ORG | B LATERAL_TOPN F3 page 1 | feed_posts_id_media_kind_uq, spike_i2 | 0.840 ms | 205 | 28 |
| ORG | B LATERAL_TOPN F3 page 5 | feed_posts_id_media_kind_uq, spike_i2 | 0.853 ms | 196 | 28 |
| ORG | C MODERATOR all members page 1 | spike_i1 | 0.170 ms | 85 | 28 |
| ORG | D INICIO merged (communities on) | spike_i3 | 0.429 ms | 63 | 28 |
| ORG | D INICIO community_id is null | spike_i4 | 0.075 ms | 31 | 28 |
| ORG | D REELS today (video path, visibility tenant) | spike_i3 | 0.754 ms | 543 | 2428 |
| ORG | D REELS plan 04 (video path, shared member fragment) | feed_posts_tenant_video_created_idx | 0.658 ms | 214 | 29 |
| TRAIL | A ANY_SET F50 page 1 | spike_i1b | 0.601 ms | 101 | 31 |
| TRAIL | A ANY_SET F50 page 5 | spike_i1b | 0.578 ms | 106 | 29 |
| TRAIL | A ANY_SET F3 page 1 | spike_i1b | 0.547 ms | 100 | 284 |
| TRAIL | A ANY_SET F3 page 5 | spike_i1b | 0.600 ms | 97 | 513 |
| TRAIL | B LATERAL_TOPN F50 page 1 | feed_posts_id_media_kind_uq, spike_i2 | 1.162 ms | 713 | 28 |
| TRAIL | B LATERAL_TOPN F50 page 5 | feed_posts_id_media_kind_uq, spike_i2 | 1.165 ms | 711 | 28 |
| TRAIL | B LATERAL_TOPN F3 page 1 | feed_posts_id_media_kind_uq, spike_i2 | 0.859 ms | 205 | 28 |
| TRAIL | B LATERAL_TOPN F3 page 5 | feed_posts_id_media_kind_uq, spike_i2 | 0.810 ms | 196 | 28 |
| TRAIL | C MODERATOR all members page 1 | spike_i1b | 0.153 ms | 86 | 28 |
| TRAIL | D INICIO merged (communities on) | spike_i3 | 0.431 ms | 65 | 28 |
| TRAIL | D INICIO community_id is null | spike_i4 | 0.081 ms | 33 | 28 |
| TRAIL | D REELS today (video path, visibility tenant) | spike_i3 | 0.725 ms | 560 | 2428 |
| TRAIL | D REELS plan 04 (video path, shared member fragment) | feed_posts_tenant_video_created_idx | 0.630 ms | 214 | 29 |

Run-to-run noise: the script was run four times while it was being built. The numbers above are the final
run. An earlier run recorded 1207 shared hits for BASE / A / F3 page 5 (the same plan, the same 563 removed
rows, a cold function plan for the seam definer); every other number moved by a few percent. All runs sit
far below the decision thresholds.

## Decision

The planner default (Claude's discretion, written in the plan): choose `ANY_SET` unless F3 page 5 shows a
Seq Scan on `feed_posts`, an `Execution Time` above 50 ms or more than 5000 shared buffer hits.
F3 page 5 measured **no Seq Scan, 0.6 ms and 96 to 210 shared hits** in every state (page 21: 0.64 ms, 95
hits). `ANY_SET` it is.

Evidence for the choice, state by state:

- **Index I1 earns its place.** Without it Explorar rides the existing community-null partial index, which
  also holds every organization post (F3 page 5: 210 hits). With I1 it rides an index that holds follower
  posts only (96 hits), and the moderator's all-members read (C) is served by the same index (85 hits,
  0.17 ms).
- **LATERAL_TOPN with I2 is correct and bounded but costs more here**: F50 about 650 to 710 hits and
  1.1 to 1.4 ms against ANY_SET's 100 hits and 0.6 ms, because the fixture's followed set is large and its
  density is high. Without I2 the LATERAL form is the worst measurement in the file (F50: 9119 hits,
  5.3 to 5.7 ms on `feed_posts_tenant_author_idx`).
- **I3 and I4 pay for Início.** With the member timeline ten times denser than the organization's, Início
  (communities on) discarded 128 member rows to return 12 and Início without communities discarded 148
  (BASE and WITH). With the organization-only partials the discarded rows fall to 28 and the hits to 63
  and 31. The gain is proportional to the member to organization post ratio, so it grows with the tenant.
- **Reels needs no new sibling.** Reels 'Todos' as plan 04 will write it (the shared member fragment on the
  video path) is served by the existing `feed_posts_tenant_video_created_idx` at 214 hits and 29 removed
  rows. Reels as THIS plan leaves it (video path with the literal `visibility = 'tenant'`) walks the
  member videos in its way (946 hits, 3361 removed rows), which plan 04 removes by relaxing the video path.

## RESEARCH assumptions

- **A1 (the pull model stays within budget for pilot-sized tenants): confirmed at this scale.** 22400 posts,
  a member following 50 prolific authors or 3 rare ones, every Explorar page under 1 ms and about 100 shared
  hits; the moderator's read 0.17 ms.
- **A2 (a btree filters a non-leading key column inside the index scan): refuted for this policy shape.**
  I1b (author as a trailing key column) changed nothing: 97 hits and 513 removed rows, identical to I1. The
  author test is not an index condition at all: it arrives inside `feed_posts_social_gate`'s
  `visibility = 'tenant' or (...)` disjunction, which the planner applies as a filter on the fetched tuple
  (Index Cond holds only the tenant and the keyset row comparison). So the form that lets a btree do the
  work is the LATERAL one, which puts `author_user_id = <one value>` in the index condition (I2).
- **A3 (the real production tenant has no member-authored posts): not measurable here.** No cloud project
  was touched. The column default (`'tenant'`) is what keeps the answer harmless if it is false.
- **A4 (count queries over a popular member's followers are acceptable live): not measured in this spike**
  (it measures the feed reads only); `app.social_counts` was proved functionally in plan 02.
- **A5 (`pg_stat_statements` counts only top-level statements): confirmed.** The Explorar page costs one
  statement against the feed tables in `apps/api/tests/integration/feed-social.test.ts` case 14, with the
  definers running inside it.

## What to watch (stated plainly, because the rule chose the simple form)

ANY_SET's cost per page is about `12 / density`, where density is the share of the tenant's member
timeline written by the people the viewer follows (F3: 348 of 20000, so about 500 rows examined and
discarded per page, independent of depth: page 21 removed 628). It does NOT depend on page depth, but it
grows with the tenant: the same member following the same three rare authors in a tenant a hundred times
larger would examine about a hundred times more rows per page. At the pilot's scale that is invisible. The
escape hatch is measured and ready: switch the service to the LATERAL form and create I2 (F3 stays near 200
hits whatever the tenant size, F50 near 700). Plan 04 should record that trigger in its own summary; this
plan does not build I2.

## Consequences for plan 04

1. Build exactly the three `INDEXES:` lines below, pin each plan BY NAME on a volume fixture in
   `090-feed.sql` / `130-reels.sql`-style tests, and keep the old indexes (expand-contract).
2. Explorar and the moderator read both use the followers partial; keep the literals
   `visibility = 'followers'` and `visibility = 'tenant'` in the service (never bound parameters), as
   Task 1 already does.
3. Reels 'Todos' relaxes to the shared member fragment (`memberPostVisible(false)`) on the video path; no
   video sibling index is needed.
4. If the Explorar form is ever flipped to LATERAL, add I2 and re-run `09-03-spike.sql`.

CHOSEN_FORM: ANY_SET
INDEXES:
- feed_posts_tenant_followers_created_idx: (tenant_id, created_at desc nulls first, id desc nulls first) where visibility = 'followers'
- feed_posts_tenant_org_created_idx: (tenant_id, created_at desc nulls first, id desc nulls first) where visibility = 'tenant'
- feed_posts_tenant_org_nocommunity_created_idx: (tenant_id, created_at desc nulls first, id desc nulls first) where visibility = 'tenant' and community_id is null
