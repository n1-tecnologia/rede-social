# 10-08 spike: the form and the index of the authors read (assumption A10, second half)

Measured 2026-11-11 on the local Postgres 17 stack (`pnpm db:reset && pnpm db:seed`, then
`psql -f 10-08-spike.sql`; the script is ONE transaction that ends in `rollback;`, so it leaves no tenant, no row and
none of the candidate indexes). It was run three times back to back; the tables give the MEDIAN of the three
`Execution Time`s and the median `Buffers: shared hit` of the root node. Every read ran as the `authenticated` lane
with the claims `withTenantTx` builds (`request.jwt.claims` plus `set local role`), so `stories_audience_gate`, the
`app.social_*` seams and `app.is_blocked_by_viewer` are INSIDE every plan.

## The two forms

| Form | Statement |
|------|-----------|
| **G** `GROUPED` | One grouped statement over the live member stories (`s.visibility = 'followers'`, `deleted_at is null`, `expires_at > now()`, ready media) joined to the author's live membership and profile, `author_user_id = any (SOCIAL_VISIBLE_AUTHOR_IDS)` for a member (no author filter for the moderator), `story_views` aggregated with `bool_or(not exists (... v.tenant_id = <tenant constant> ...))`, `group by` author, ordered and limited at the end (the Task 1 statement). Moderator keyset through `having (max(published_at), membership_id)`. |
| **L** `LATERAL` | `unnest(SOCIAL_VISIBLE_AUTHOR_IDS)` (member) or the live `memberships` (moderator), joined to the profile, then a `cross join lateral` that counts, takes `max(published_at)` and aggregates the unseen flag over THAT author's live stories. Moderator keyset on `(agg.latest, am.id)` in the outer `where`. |

## Fixture (tenant P, `social` on)

200 members and one admin; **8000 live member stories** (`'followers'`; members 1..5 wrote 100 each, the remaining 7500
spread over members 6..200, one every 10.7 seconds across the last 24 hours), **3000 expired** member stories (window
closed 1 to 5 days ago), **500 soft-deleted** ones inside the window, **3000 organization stories** (`'tenant'`).
`story_views`: viewer **VA** (member 190) follows 50 authors (1..50, the five heavy ones included) and has seen a third
of their live stories (723 rows); viewer **VB** (member 191) follows 3 authors (51..53) and has seen about half of
theirs (53 rows); the moderator lane is the admin (no views). Every table `analyze`d. The page-5 cursor is the real
80th row of the moderator ordering, captured with `\gset`.

Candidate indexes, created inside the transaction:

| Id | Definition |
|----|------------|
| BASE | the indexes that exist today (`stories_tenant_expires_idx`, `stories_pkey`, the rest) |
| **I1** | `stories_tenant_author_expires_idx (tenant_id, author_user_id, expires_at desc nulls first, id desc nulls first) where deleted_at is null and visibility = 'followers'` |
| I2 | the same columns WITHOUT the partial predicate |

## Results

`stories` node = the index the planner walked on `stories` (no plan in any state or form contains a `Seq Scan on stories`).
Reads: **R1** member with 50 followees; **R2** member with 3 followees in the tenant full of member stories; **R3** the
moderator's page 1 (21 rows); **R4** the moderator's page 5; **R5** the Início strip with 8000 member stories present.

| State | Read | Form | `stories` node | Execution Time | Shared hit |
|-------|------|------|----------------|---------------:|-----------:|
| BASE | R1 | G | stories_tenant_expires_idx | 39.7 ms | 5026 |
| BASE | R1 | L | stories_tenant_expires_idx | 33.7 ms | 20205 |
| BASE | R2 | G | stories_tenant_expires_idx | 5.1 ms | 639 |
| BASE | R2 | L | stories_tenant_expires_idx | 3.4 ms | 1563 |
| BASE | R3 | G | stories_tenant_expires_idx | 134.5 ms | 458 |
| BASE | R3 | L | stories_tenant_expires_idx | 121.5 ms | 74100 |
| BASE | R4 | G | stories_tenant_expires_idx | 131.8 ms | 458 |
| BASE | R4 | L | stories_tenant_expires_idx | 119.9 ms | 74100 |
| BASE | R5 | (strip) | stories_tenant_expires_idx, stories_pkey | 0.9 ms | 270 |
| I1 | R1 | G | stories_tenant_author_expires_idx (I1) | 18.1 ms | 12485 |
| I1 | R1 | **L** | I1 | **4.9 ms** | 7462 |
| I1 | R2 | G | I1 | 4.0 ms | 8378 |
| I1 | R2 | **L** | I1 | **1.2 ms** | 579 |
| I1 | R3 | G | I1 | 45.5 ms | 8196 |
| I1 | R3 | **L** | I1 | **12.0 ms** | 24553 |
| I1 | R4 | G | I1 | 45.5 ms | 8196 |
| I1 | R4 | **L** | I1 | **12.0 ms** | 24553 |
| I1 | R5 | (strip) | stories_tenant_expires_idx, stories_pkey | 0.8 ms | 270 |
| I2 | R1 | G | stories_tenant_expires_idx (I2 not chosen) | 40.4 ms | 4850 |
| I2 | R1 | L | I2 | 6.3 ms | 7630 |
| I2 | R2 | G | stories_tenant_expires_idx | 5.3 ms | 639 |
| I2 | R2 | L | I2 | 1.5 ms | 591 |
| I2 | R3 | G | stories_tenant_expires_idx | 136.6 ms | 458 |
| I2 | R3 | L | I2 | 13.7 ms | 25191 |
| I2 | R4 | G | stories_tenant_expires_idx | 133.2 ms | 458 |
| I2 | R4 | L | I2 | 12.4 ms | 25267 |
| I2 | R5 | (strip) | stories_tenant_expires_idx, stories_pkey | 0.8 ms | 270 |

## Reading

1. **G has no good answer for the moderator.** Without an author-led index the grouped statement walks the live window
   of `stories_tenant_expires_idx` (8000 rows) and the planner joins it to `memberships` with a nested loop and a join
   filter (`Rows Removed by Join Filter: 1600000`): 131 to 137 ms on R3 and R4, in BASE and in I2 (the planner never
   picks I2 for G). With I1 present the plan is better (45 ms) but still four times slower than L, with 8196 buffer hits.
2. **L is the form that uses the new index well**, for a member and for the moderator: one index range per author
   (`author_user_id = f.uid and expires_at > now()`), 1.2 to 4.9 ms for the two member reads and 12 ms for the moderator's
   pages. The moderator's page 5 costs the same as page 1 because a keyset on an aggregate cannot prune authors (every
   author's circle is still aggregated); the bound is the number of live authors, not the page number.
3. **The buffer clause of the decision rule is tripped by both forms on the moderator reads** (G 8196 under I1, L 24553):
   two thirds of L's hits are the per-story `story_views` index-only probe (16000 hits for 8000 stories), which is the
   price of the constant-tenant form that keeps `story_views_uq` index-only (pgTAP 120's pin) and is unchanged. The rule
   separates the forms by execution time, where L is 4 to 11 times faster than G, and no plan contains a sequential scan.
4. **I1 versus I2.** Under I1 the planner picks the new index for both forms; under I2 it picks it only for L. Their L
   timings are equal within noise (R3 12.0 versus 13.7 ms, R4 12.0 versus 12.4 ms). I1 is the smaller index (it holds
   only live member stories, not the organization's, not the expired-and-deleted) and its predicate is the literal the
   statement already names (`visibility = 'followers'`, `deleted_at is null`), so I1 is the shipped index.
5. **The Início strip is untouched** (R5: 0.8 to 0.9 ms, 270 buffer hits, the same two indexes in every state), with 8000
   member stories in the table: the statement's literal `visibility = 'tenant'` keeps branch 3 of the audience gate off
   the walked rows, as `10-04-SPIKE.md` found, and the new index changes nothing for it.

## The rule and the result

Decision rule (planner default): choose `GROUPED` unless the 3-followee member (R2) or the moderator page 5 (R4) shows a
Seq Scan on `stories`, an `Execution Time` above 50 ms or more than 5000 shared buffer hits, in which case `LATERAL`.
R4 under G is 131.8 ms (BASE), 45.5 ms with 8196 hits (I1) and 133.2 ms (I2): above 50 ms in two states and above 5000
hits in the third. The rule picks `LATERAL`, and the table above agrees on every read.

**Which part of assumption A10 the numbers confirmed or refuted.** Confirmed: the authors read needed a measured plan
and a dedicated index, and the simple grouped form (the Task 1 statement) is the wrong one for the moderator (136 ms on a
200-author, 8000-story tenant, with no index able to fix it). Refuted: that a story strip with member stories in the
table needs anything beyond what plan 04 already shipped (R5 is flat). The research's expectation that the follow set
bounds the cost held for the member (R1 and R2 are 1.2 to 4.9 ms under L and I1); it did not hold for the moderator,
whose cost is bounded by the number of live authors with a live story, which is what the cursor pages over.

CHOSEN_FORM: LATERAL
INDEXES:
- stories_tenant_author_expires_idx: (tenant_id, author_user_id, expires_at desc nulls first, id desc nulls first) where deleted_at is null and visibility = 'followers'
