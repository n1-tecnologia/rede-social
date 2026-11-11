# 10-04 spike: the shape of branch 3 of the story audience gate (assumption A10)

Measured 2026-11-11 on the local Postgres 17 stack (`pnpm db:reset && pnpm db:seed`, then `psql -f 10-04-spike.sql`; the
whole script is one transaction that ends in `rollback;`). Everything below was read as the `authenticated` member lane
with the claims `withTenantTx` builds, so the restrictive policies and the seam functions are INSIDE every plan.

## The two candidates

| Form | Policy text of the third door | Notes |
|------|-------------------------------|-------|
| **E** `EXISTS_JOIN` | `exists (select 1 from story_highlight_items i join story_highlights h on h.id = i.highlight_id and h.tenant_id = i.tenant_id where i.story_id = stories.id and h.community_id is not null and exists (select 1 from communities c where c.id = h.community_id and c.tenant_id = app.tenant_id() and c.deleted_at is null))` | per-row, the inner `communities` read runs under the caller's RLS (so `communities_member_hidden_gate` applies) |
| **D** `IDS_DEFINER` | `id = any (coalesce((select app.story_highlight_readable_ids()), '{}'::uuid[]))` | SECURITY DEFINER function returning the story ids held by a highlight of a readable community (deleted and hidden-creator communities excluded in the body), read as an InitPlan |

## Fixture (tenant P, `social` on)

62 members (50 authors, viewer V20 who follows 20 authors, viewer V2 who follows 2), 3000 organization stories
(`'tenant'`, one every 43.2 minutes, 33 of them inside the 24 hour window), 6000 member stories (`'followers'`, one every
3.36 minutes, 466 stories of both kinds inside the window), 40 communities (15 member communities, 25 organization),
400 highlights (300 in a community, 100 in Inicio), 3000 highlight items, one member story S200 with 200 comments.
Every table `analyze`d. Row counts read through the gate are IDENTICAL for both forms (V20 reads 6090 stories, 3090 of
them member stories; V2 reads 4344), so D is a faithful rewrite and the comparison is about cost only.

## Results

`Execution Time` in ms, `Buffers: shared hit` of the top node (planning buffers excluded), per read.

| Read | Form | Execution Time | Buffers hit | Nodes of interest |
|------|------|---------------:|------------:|-------------------|
| (a) Inicio strip, V20 (`visibility = 'tenant'`, window) | E | 1.318 | 96 | Bitmap Heap Scan on `stories` via `stories_tenant_expires_idx`; 428 rows removed by filter; branch 3 SubPlan **never executed** |
| (a) | D | 0.927 | 257 | same scan; the definer ran once (66 + 99 hits inside it) |
| (b) a member story by id, V20 | E | 1.048 | 8 | Index Scan using `stories_pkey`; branch 3 never executed (branch 2 true for a followed author) |
| (b) | D | 0.909 | 8 | same |
| (c) comments page of S200 (200 comments), V20 | E | 8.620 | 216 | 26 `stories_pkey` probes (one per comment returned), each answered by branch 2 |
| (c) | D | **88.844** | 435 | **Seq Scan on `stories`, 6090 rows kept, 2920 removed** (the planner hashed the now-uncorrelated story gate) |
| (c2) comments page of S200, V2 (does not follow the author, story not in a readable highlight) | E | 5.697 | 2013 | 200 `stories_pkey` probes, each running branch 3 (2 index probes on `story_highlight_items_tenant_story_idx`: 400 hits); 0 rows returned |
| (c2) | D | **82.367** | 440 | **Seq Scan on `stories`, 4344 rows** |
| (d) Inicio strip, V2 (follows 2) | E | 0.291 | 72 | Index Scan using `stories_tenant_expires_idx`; 334 rows removed by filter; branch 3 never executed |
| (d) | D | 0.331 | 72 | same |

## Reading

1. **On the read that matters most, the Inicio strip, branch 3 costs nothing in either form.** The statement's own
   `visibility = 'tenant'` qual is evaluated before the policy's disjunction on every scanned row, so the member stories
   the walk passes over (428 and 334 rows) are dropped by that qual and branch 3 is never reached (`never executed` in
   the E plan). The strip keeps ranging and ordering on `stories_tenant_expires_idx` (an Index Scan for V2, a Bitmap
   Index Scan feeding the sort for V20, the planner's cost choice at this size); no `Seq Scan on stories`.
2. **The per-row form is cheap where it does run.** A branch 3 probe is two index probes (2 buffer hits each) because
   `story_highlight_items_tenant_story_idx (tenant_id, story_id)` serves the correlated lookup; the worst measured read
   (200 comments of a story the caller cannot read, so every row runs branch 3) is 5.7 ms and 2013 buffers.
3. **The ids-array form is the worse one**, and not for the reason the assumption feared. Writing the third door as
   `id = any (coalesce((select ...)))` makes the stories gate uncorrelated, so when `feed_comments_story_gate` tests the
   story through its inner `exists`, the planner turns it into a hashed subplan over the WHOLE visible set of stories
   (a `Seq Scan on stories` of 6090 or 4344 rows, 80 to 89 ms) instead of 26 or 200 primary key probes (5.7 to 8.6 ms).
   The definer also pays an aggregate over every highlight item on every statement that touches `stories`.

## The rule and the result

Decision rule (planner default): choose `EXISTS_JOIN` unless read (a) shows a Seq Scan on `stories`, an `Execution Time`
above 50 ms or more than 5000 shared buffer hits, in which case choose `IDS_DEFINER`.
Read (a) under form E: no Seq Scan on `stories`, 1.318 ms, 96 buffer hits. The rule keeps `EXISTS_JOIN`, and reads (c)
and (c2) independently say the same (E is 10 to 15 times faster than D on the comments page).

**Which part of assumption A10 the numbers confirmed or refuted.** Confirmed: branch 3 needed a measured plan, and the
measurement found a real cliff, in the form that was NOT shipped (D). Refuted: that the per-row `exists` degrades the
story strip. It does not, because of the order the planner evaluates the statement's own `visibility` qual and the
policy's disjunction, and the cost where it does run is two index probes per row. The shipped Task 1 policy is kept
unchanged (no edit to the unshipped `*_member_stories.sql`, no `*_member_stories_functions.sql`), and the A5 media-gate
branch of Task 2 is written in the same per-row form, inline, with the explicit hidden-creator pin a definer needs.

Caveat recorded for plan 08 (the authors read): a strip that does NOT carry the literal `visibility = 'tenant'` qual would
make every walked member story run the policy disjunction; the service must keep naming the audience in the strip
statement, as it already must for Explorar (`'followers'`) and as plan 03 left it for Inicio and Reels "Todos".

CHOSEN_FORM: EXISTS_JOIN
