---
phase: 04-feed
part: B
scope: apps/api, supabase, scripts
reviewed: 2026-09-23T00:00:00Z
depth: standard
files_reviewed: 32
files_reviewed_list:
  - apps/api/package.json
  - apps/api/src/app.ts
  - apps/api/src/modules/registry.ts
  - apps/api/src/routes/me.ts
  - apps/api/tests/integration/auth-middleware.test.ts
  - apps/api/tests/integration/feed-edit-delete.test.ts
  - apps/api/tests/integration/feed-interactions.test.ts
  - apps/api/tests/integration/feed-media.test.ts
  - apps/api/tests/integration/feed-query-budget.test.ts
  - apps/api/tests/integration/feed-unfurl.test.ts
  - apps/api/tests/integration/feed.test.ts
  - apps/api/tests/integration/isolation.test.ts
  - apps/api/tests/integration/jobs.test.ts
  - apps/api/tests/integration/media-playback.test.ts
  - apps/api/tests/integration/media.test.ts
  - apps/api/tests/integration/modules.test.ts
  - apps/api/tests/integration/mux-webhook.test.ts
  - apps/api/tests/integration/platform-tenants.test.ts
  - apps/api/tests/unit/mounts.test.ts
  - apps/api/tests/unit/registry.test.ts
  - scripts/check-static-routes.sh
  - scripts/seed.ts
  - supabase/migrations/20260922152230_feed_posts.sql
  - supabase/migrations/20260922162440_feed_interactions.sql
  - supabase/migrations/20260922162449_feed_counters.sql
  - supabase/migrations/20260922165218_feed_post_media.sql
  - supabase/migrations/20260923010104_feed_link_previews.sql
  - supabase/migrations/20260923035937_drop_example_module.sql
  - supabase/tests/010-rls-coverage.sql
  - supabase/tests/020-tenant-isolation.sql
  - supabase/tests/030-lanes.sql
  - supabase/tests/090-feed.sql
findings:
  critical: 1
  warning: 16
  info: 7
  total: 24
status: issues_found
---

# Phase 04 (Part B): Code Review Report — API, database, seed

**Reviewed:** 2026-09-23
**Depth:** standard
**Files Reviewed:** 32
**Partition:** `apps/api/**`, `supabase/**`, `scripts/**` (feed module package and web app are Parts A and C)
**Status:** issues_found

## Summary

The migrations, the pgTAP suites and the seed are unusually careful work, and several things I
expected to be wrong are right: the plan count in every pgTAP file matches the assertions actually
present (010 = 4, 020 = 73, 030 = 15, 090 = 35); every `throws_ok` in `090-feed.sql` names the
SQLSTATE that will genuinely fire (I traced the constraint-evaluation order for all thirteen — RLS
`WITH CHECK` before RI triggers, `CHECK` before RLS, composite-FK before partial-unique where the
test claims it); the keyset index `NULLS FIRST` convention matches the emitted `order by` in all
three directions; and `node - "$NEXT_DIR"` really does put the directory at `process.argv[2]`
(verified empirically), so `check-static-routes.sh` is not silently reading `undefined`.

The write-path FK hole the phase context asked me to hunt is **real at the schema layer and closed
at the service layer**: not one foreign key on the five new tables carries `tenant_id`, and Postgres
runs RI checks as the referenced table's owner with RLS bypassed — but I traced every user-supplied
id through `packages/modules/feed/server/service.ts` and each one (`parentId`, `imageAssetIds`,
`attachmentAssetIds`, `videoAssetId`, `postId` on the like paths, `linkPreviewId`) is re-read or
`insert … select`-ed inside the tenant lane. So this is a defense-in-depth gap, not a live leak
(B-WR-01). It matters because the phase's own executor found one instance (`updatePost`) that had
survived unpatched, which is evidence the pattern depends on nobody forgetting.

The one defect I would block on is not in the feed at all: **the Phase 3 media fixture cleanups,
edited in 04-04 precisely so they would stop destroying seeded content, still destroy it** — they
protect the database rows and then delete the Storage objects those rows point at, and they delete
the seeded member avatars outright.

Findings that depend on files outside this partition are marked with the dependency rather than
resolved here.

## Critical Issues

### B-CR-01: the 04-04 media-cleanup fix protects the rows and then deletes their objects

**File:** `apps/api/tests/integration/media.test.ts:149-172`, `apps/api/tests/integration/mux-webhook.test.ts:192-209`

**Issue:** Both cleanups were changed in this phase with the comment *"it must skip anything a post
still points at — otherwise it fails on the foreign key AND destroys seeded content the e2e
measures."* The row half was implemented. The object half was not, and it runs first:

```ts
// media.test.ts
async function cleanup(): Promise<void> {
  for (const tenantId of [demoTenantId, labTenantId].filter(Boolean)) {
    await removeTenantMediaObjects(tenantId);          // <- deletes EVERYTHING under <tenant>/media/%
    await adminSql`
      delete from public.media_assets
       where tenant_id = ${tenantId}::uuid
         and id not in (select media_asset_id from public.feed_post_media)`;
  }
```

`removeTenantMediaObjects` selects `storage.objects where bucket_id = 'media' and name like
'<tenantId>/media/%'` and removes every hit. `mediaOriginalKey`/`mediaVariantKey`
(`packages/core/server/media/keys.ts`) build exactly that prefix for **every** asset in the tenant,
so the sweep removes the objects behind the seeded gallery images, the seeded PDF attachment and the
seeded avatars. The row-preserving `delete` one line below then keeps the `media_assets` rows for
the three seeded feed posts — pointing at objects that no longer exist. `mux-webhook.test.ts:194-200`
does the same object sweep for the demo tenant.

Two further consequences of the same `delete`:

1. It is scoped only by `feed_post_media`. The seeded **avatar** assets (`purpose: 'avatar'`, written
   by `seedMemberProfile` in `scripts/seed.ts:640-673`) are not referenced there, so their rows are
   deleted. `member_profiles_avatar_asset_id_media_assets_id_fk` is `ON DELETE set null`
   (`supabase/migrations/20260921190226_member_profiles.sql:18`), so the deletion is **silent** —
   no foreign-key error, the seeded members simply stop having photos.
2. `media.test.ts` runs the sweep for **both** `rede-demo` and `rede-lab`.

Net effect: one `pnpm test:integration` run leaves the shared seed in a state where the 04-04 media
posts render broken images, `photoCount` from the seed is zero, and every downstream e2e that
measures seeded media (`feed-media.spec.ts`, the profile and comment-row avatar assertions) is
invalidated — with `pnpm db:seed` required to recover and nothing telling anyone.

**Fix:** exclude the referenced objects the same way the rows are excluded, and widen the row
predicate to every table that points at `media_assets`:

```ts
async function removeTenantMediaObjects(tenantId: string): Promise<void> {
  const rows = await adminSql<{ name: string }[]>`
    select o.name
      from storage.objects o
     where o.bucket_id = 'media'
       and o.name like ${`${tenantId}/media/%`}
       and split_part(o.name, '/', 3)::uuid not in (
             select media_asset_id from public.feed_post_media
             union all
             select avatar_asset_id from public.member_profiles where avatar_asset_id is not null
             union all
             select image_asset_id from public.feed_link_previews where image_asset_id is not null)`;
  ...
}

await adminSql`
  delete from public.media_assets a
   where a.tenant_id = ${tenantId}::uuid
     and not exists (select 1 from public.feed_post_media m where m.media_asset_id = a.id)
     and not exists (select 1 from public.member_profiles p where p.avatar_asset_id = a.id)
     and not exists (select 1 from public.feed_link_previews l where l.image_asset_id = a.id)`;
```

Apply the identical change in `mux-webhook.test.ts:193-200`. (`media-playback.test.ts:86-101` has no
object sweep and its row sweep is already narrowed to `kind = 'video'` plus the
`feed_post_media` exclusion, so it is correct as written.)

## Warnings

### B-WR-01: no foreign key on the feed tables carries `tenant_id`, and the RLS policies say nothing about authorship

**File:** `supabase/migrations/20260922162440_feed_interactions.sql:35-42,51-52`,
`supabase/migrations/20260922165218_feed_post_media.sql:27-30,34`,
`supabase/migrations/20260923010104_feed_link_previews.sql:21-25`,
`supabase/migrations/20260922152230_feed_posts.sql:17-21`

**Issue:** Postgres evaluates referential integrity as the *referenced* table's owner and bypasses
RLS while doing it. Every foreign key this phase adds points at a single-column key:

| child | column | references |
|---|---|---|
| `feed_comments` | `post_id` | `feed_posts(id)` |
| `feed_comments` | `(parent_id, parent_depth)` | `feed_comments(id, depth)` |
| `feed_likes` | `post_id` / `comment_id` | `feed_posts(id)` / `feed_comments(id)` |
| `feed_post_media` | `media_asset_id` | `media_assets(id)` |
| `feed_post_media` | `(post_id, post_media_kind)` | `feed_posts(id, media_kind)` |
| `feed_posts` | `link_preview_id` | `feed_link_previews(id)` |

None of them includes `tenant_id`, so a row stamped with the caller's own `tenant_id` (which is all
the `WITH CHECK` tests) may legally name **another tenant's** parent, post, comment, asset or
preview. The database will accept it. The only thing that refuses today is the service layer's
in-lane re-read — which is exactly the hole the executor had to patch by hand in `updatePost` before
`linkPreviewId` was stamped.

Separately, all five policies are `FOR ALL TO authenticated USING (tenant_id = app.tenant_id())`.
They constrain tenancy and nothing else, so at the database layer any member of a tenant may
`update`/`delete` any post or comment of that tenant; authorship is enforced solely by the
`author_user_id` predicate inside each statement. The repo already has the stronger precedent —
`member_profiles_self_update`, pinned by `020-tenant-isolation.sql:497-508` ("an update aimed at a
NEIGHBOUR's row in the same tenant touches nothing") — and `feed_posts`/`feed_comments` did not get
it.

**Fix:** make tenancy a referential fact, the same way D-53 made gallery-XOR-video one. Add the
composite keys and repoint the child FKs:

```sql
alter table feed_posts   add constraint feed_posts_tenant_id_uq   unique (tenant_id, id);
alter table feed_comments add constraint feed_comments_tenant_id_uq unique (tenant_id, id);
alter table media_assets add constraint media_assets_tenant_id_uq unique (tenant_id, id);

alter table feed_comments
  drop constraint feed_comments_post_id_feed_posts_id_fk,
  add  constraint feed_comments_tenant_post_fk
    foreign key (tenant_id, post_id) references feed_posts (tenant_id, id) on delete cascade;
-- …and the same shape for feed_likes.post_id/comment_id, feed_post_media.media_asset_id,
--    feed_posts.link_preview_id, and (tenant_id, parent_id, parent_depth) on the reply FK.
```

and split the two `for all` policies into a tenant-wide `select` plus author-scoped
`update`/`delete`, so a forgotten `author_user_id` predicate is caught one layer down. Add the
matching negative cases to `020-tenant-isolation.sql`.

### B-WR-02: `jobs.test.ts` contains raw NUL bytes and is therefore a binary file to git

**File:** `apps/api/tests/integration/jobs.test.ts:58,67` (byte offsets 2271 and 2681)

**Issue:** The file carries two literal `0x00` bytes — one inside the comment `` a `\0` escape `` and
one inside the string `'nul\0byte'` — written as raw bytes rather than as escape sequences. `file`
reports the path as `data`, and `git diff --stat` for this phase shows
`apps/api/tests/integration/jobs.test.ts | Bin 5280 -> 5641 bytes`: the change was submitted with no
reviewable diff and cannot be three-way merged. Any editor, formatter or tool that normalises control
characters will silently rewrite the literal, at which point `enqueueInTx` no longer produces 22P05
and the test's whole premise is gone.

**Fix:** use escape sequences, which produce the same runtime value with an all-ASCII source file:

```ts
    // Postgres jsonb refuses a `\u0000` escape (22P05), so the insert fails INSIDE the transaction
    ...
          bad: 'nul\u0000byte',
```

Then confirm with `git check-attr text -- apps/api/tests/integration/jobs.test.ts` and a re-diff.

### B-WR-03: the seeded feed order is derived from eight different `Date.now()` snapshots

**File:** `scripts/seed.ts:816,834,846,856,881,1000,1069,1090`

**Issue:** Every seeded post computes its own anchor at the moment its statement runs:

```ts
const createdAt = new Date(Date.now() - (feedPostIds.length - index) * 60_000);   // line 816
const createdAt = new Date(Date.now() - (60 + index) * 60_000);                   // line 834
${new Date(Date.now() - 6 * 60_000).toISOString()}                                // line 846
...
${new Date(Date.now() - minutesAgo * 60_000).toISOString()}                       // line 1000 (media)
${new Date(Date.now() - agoMin * 60_000).toISOString()}                           // line 1090 (links)
```

Between the 04-01 block (lines 809-828) and the 04-04 media block (line 996) the script performs ten
`ensureUser` round trips, three `sharp` ladder derivations and ~20 `putObject` uploads. The docblocks
claim a fixed relative layout ("one minute apart", "six minutes back … below the 04-01/04-04/04-05
fixtures **without disturbing their relative order**"), but the offsets are measured from different
clocks. With `T1 - T0` under 60 s the order is one thing; over 60 s the gallery post crosses
`feedPostIds[0]` and the attachment post crosses `feedPostIds[1]`. On a slow machine, a cold sharp,
or a hosted Storage endpoint, the seeded page-1 order silently changes — and `feed.test.ts` test 1,
`feed-interactions.test.ts` tests 12-14 and the web e2e all name specific rows by position.

**Fix:** take one anchor at module scope and derive everything from it:

```ts
/** One clock for the whole seed: relative offsets must not drift with how long the script runs. */
const SEED_NOW = Date.now();
const minutesAgo = (n: number) => new Date(SEED_NOW - n * 60_000).toISOString();
```

and replace all eight `Date.now()` call sites with `minutesAgo(...)`.

### B-WR-04: `permissionsFor` hardcodes a `feed`-shaped branch in the generic composition point

**File:** `apps/api/src/modules/registry.ts:12,99-105`

**Issue:** The file's own docblock (lines 20-22) claims *"a module comes out the same way it went
in."* It does not, any more:

```ts
import { FEED_PERMISSIONS, feedSettingsSchema } from '@rede-social/module-feed/contracts';
...
  if (enabled.has('feed') && role === 'member') {
    const parsed = feedSettingsSchema.safeParse(settings.get('feed') ?? {});
    const policy = parsed.success ? parsed.data.postingPolicy : 'admins_only';
    if (policy === 'members') permissions.add(FEED_PERMISSIONS.create);
  }
```

Removing `feed` from `MODULE_REGISTRY` now leaves a dead `if`, a dead import of a deleted package and
a broken build — the exact cost D-19's removal was staged to prove is one line. The next module that
wants a settings-derived permission adds a second `if` here, and the function stops being generic.

The behaviour itself is right (`safeParse` fails closed to `admins_only`, a disabled module grants
nothing, `registry.test.ts:162-202` pins both), so this is structural, not a live bug.

**Fix:** move the rule behind the manifest so the registry stays a pure fold:

```ts
// packages/core/server/modules/manifest.ts
type ModuleManifest = {
  ...
  /** Permissions this module grants for `role` given the tenant's settings blob. */
  settingsPermissions?: (role: TenantRole, settings: Record<string, unknown>) => string[];
};

// registry.ts — no module-specific branch, no module import
for (const key of enabled) {
  for (const p of MODULE_REGISTRY[key]?.defaultRolePermissions?.[role] ?? []) permissions.add(p);
  for (const p of MODULE_REGISTRY[key]?.settingsPermissions?.(role, settings.get(key) ?? {}) ?? [])
    permissions.add(p);
}
```

The `feedSettingsSchema.safeParse` fail-closed logic then lives in `feedModule`, where the schema
already does. (Touches `packages/core` and `packages/modules/feed` — Part A dependency.)

### B-WR-05: `090-feed.sql`'s `analyze` is not undone by its `rollback`

**File:** `supabase/tests/090-feed.sql:371-372` (and the docblock claim at lines 23-28)

**Issue:** The file promises it *"rolls back, so it re-runs identically against a seeded or an empty
database, twice in a row, in any order."* `ANALYZE` breaks half of that. `vac_update_relstats` writes
`pg_class.reltuples`/`relpages` with `heap_inplace_update`, which is deliberately **non**-transactional
and survives the `rollback` on line 440, while the `pg_statistic` rows it inserts are transactional
and do not. After the file runs, `feed_posts` and `feed_comments` are left claiming ~253 and ~500 live
rows with no column statistics to match, against a table that actually holds only the seeded rows.
That skews every plan chosen for those tables in every later session until an autovacuum or an
explicit `ANALYZE` corrects it — including, potentially, the plans behind `feed-query-budget.test.ts`.

**Fix:** re-`analyze` the real contents on the way out, after the rollback would have restored them:

```sql
select * from finish();
rollback;
-- ANALYZE's pg_class update is in-place and survives the rollback above; restore honest
-- statistics for the rows that actually remain, or every later session plans from this
-- file's 250-row fixture.
analyze public.feed_posts;
analyze public.feed_comments;
```

### B-WR-06: the query budgets are `<=` assertions, so a measurement that stops matching passes at zero

**File:** `apps/api/tests/integration/feed-query-budget.test.ts:149,177,190`

**Issue:**

```ts
expect(measured?.calls ?? 0).toBeLessThanOrEqual(FEED_LIST_STATEMENT_BUDGET);
```

The budget is measured by matching `pg_stat_statements.query` against the literal regex
`'feed_(posts|post_media|comments|likes|link_previews)'` (line 53). If the service ever wraps the
statement so the table name stops appearing in the normalised text, if `pg_stat_statements` is not
loaded, if it is full and evicting, or if the reset silently fails, `sum(calls)` is `0` and every one
of the three assertions passes. The vacuity guards on lines 142, 174-175 and 188 check the *response*
payload, not that the measurement found anything. The whole point of the file is that the number "has
a name so a future regression is a diff rather than a mystery" — `<=` gives that up.

**Fix:** assert equality, which is what the docblocks actually claim (1, 3, 1):

```ts
expect(measured?.calls ?? 0).toBe(FEED_LIST_STATEMENT_BUDGET);
...
expect(await feedCalls()).toBe(FEED_DETAIL_STATEMENT_BUDGET);
expect(await feedCalls()).toBe(FEED_REPLIES_STATEMENT_BUDGET);
```

A drop below the budget is as much a signal (the statement is no longer being measured) as a rise
above it.

### B-WR-07: the "cursors are not interchangeable" case asserts two tautologies

**File:** `apps/api/tests/integration/feed-interactions.test.ts:336-341`

**Issue:**

```ts
// The two cursors are not interchangeable: a foreign cursor degrades to page 1, never a 500.
const rootCursor = (await comments(tokens.demoMember, postId, '?limit=2')).nextCursor;
expect(rootCursor).not.toBeNull();
const crossed = await replies(tokens.demoMember, firstRoot.id, `?cursor=${rootCursor}`);
expect(crossed.items.length).toBeGreaterThanOrEqual(0);     // can never fail
expect(REPLIES_PAGE_SIZE).toBeGreaterThan(0);               // asserts a constant about itself
```

A `length` is always `>= 0`, and `REPLIES_PAGE_SIZE > 0` restates an imported literal. The stated
claim — *degrades to page 1* — is never checked; only the "not a 500" half is covered, and only
incidentally, by `replies()`'s internal `expect(res.status).toBe(200)`. `feed.test.ts:235-248` does
this correctly against a captured baseline; this case should mirror it.

**Fix:**

```ts
const baseline = await replies(tokens.demoMember, firstRoot.id);
const crossed = await replies(tokens.demoMember, firstRoot.id, `?cursor=${rootCursor}`);
expect(crossed.items.map((c) => c.id)).toEqual(baseline.items.map((c) => c.id));
```

### B-WR-08: a refusal test accepts two different status codes

**File:** `apps/api/tests/integration/feed-interactions.test.ts:274`

**Issue:** `expect([400, 404]).toContain(res.status);` — a `parentId` naming a comment on another
post is asserted to produce *either* a validation error *or* a not-found. The rest of this phase is
scrupulous about which refusal a caller gets (`feed-edit-delete.test.ts` exists largely to separate
403-from-the-guard from 404-from-the-predicate, and T-04-21 is specifically "every miss is the same
bare 404"). Accepting both here means a future change that flips the branch — turning a bare 404 into
a 400 that names the parent, or vice versa — passes silently.

**Fix:** pick the contracted one and assert it, plus its body:

```ts
expect(res.status).toBe(404);
expect((await envelope(res)).error.code).toBe('NOT_FOUND');
expect((await envelope(res)).error.details).toBeUndefined();
```

(The routes' OpenAPI description at `packages/modules/feed/server/routes.ts:274` says the 404 branch
covers "`parentId` is not a live comment on this post", so 404 is the documented answer — Part A
dependency if the service disagrees.)

### B-WR-09: the drop migration edits pg-boss's catalogue by hand instead of calling `delete_queue`

**File:** `supabase/migrations/20260923035937_drop_example_module.sql:27-35`

**Issue:**

```sql
    delete from pgboss.job_common where name = 'example.process';
    ...
    delete from pgboss.queue where name = 'example.process';
```

pg-boss 12 ships `pgboss.delete_queue(text)` for exactly this, and that function does more than these
two statements: it reads `queue.table_name` and `queue.partition` and, for a partitioned queue,
`DROP TABLE`s the queue's dedicated partition before removing the catalogue row
(`pg-boss/dist/plans.js:637-668`). Deleting the `pgboss.queue` row directly throws away the only
mapping back to that table, so a partitioned queue's partition is orphaned permanently — still
attached to the parent, still visible through fan-out reads, and unreachable by any later cleanup.
The project's queues are currently non-partitioned (`jobs.test.ts:107-109` finds rows in
`job_common`), so today the `job_common` delete happens to hit the right table; the migration is one
pg-boss option away from being wrong and leaves no evidence when it is.

Secondary, in the same file: `DROP POLICY … ON "example_items" CASCADE` (line 38) and
`DROP TABLE "example_items" CASCADE` (line 39) carry no `IF EXISTS`, so a re-apply after a partial
failure aborts on the first statement; and the `DROP POLICY` is redundant because the `DROP TABLE
CASCADE` on the next line removes it anyway.

**Fix:**

```sql
do $$
begin
  if to_regproc('pgboss.delete_queue(text)') is not null then
    perform pgboss.delete_queue('example.process');
  end if;
end $$;--> statement-breakpoint

DROP TABLE IF EXISTS "example_items" CASCADE;
```

### B-WR-10: a hardcoded password creates a real `admin_tenant` identity on the seeded demo tenant

**File:** `apps/api/tests/integration/feed-edit-delete.test.ts:42-43,121-136,146-153`

**Issue:**

```ts
const SECOND_ADMIN_EMAIL = 'segundo-admin@rede-demo-04-09.local';
const SECOND_ADMIN_PASSWORD = 'segundo-admin-04-09-Aa1!';
```

`scripts/seed.ts:57-71` refuses to run without `SEED_PASSWORD` and `SUPER_ADMIN_PASSWORD` from the
environment precisely because *"passwords come from env only, never from git"*. This file commits one,
and unlike the existing throwaway-member pattern (`isolation.test.ts`'s `THROWAWAY_PASSWORD`,
`platform-tenants.test.ts:689`), the identity it creates is an **`admin_tenant` of the seeded
`rede-demo` tenant** — a real GoTrue account with post-management authority over seeded content. The
account is removed in `afterAll` (line 162) and defensively in `beforeAll` (line 119), but both are
best-effort: an interrupted run, a failing `beforeAll`, or a crash inside a test leaves the account
live with its password in the repository. Escalate this to a blocker if the integration suite is ever
pointed at anything other than a throwaway local stack.

**Fix:** generate it per run and never write it down:

```ts
const SECOND_ADMIN_PASSWORD = `${crypto.randomUUID()}Aa1!`;
```

and add the same sweep to a `globalTeardown` so an aborted file still cleans up.

### B-WR-11: the 04-10 module removal has no database-level assertion that it happened

**File:** `supabase/tests/010-rls-coverage.sql:67-111`

**Issue:** Assertion 4 lists every table Phases 1-4 *declare* and fails if any is missing — "a guard
against assertions 1-3 passing vacuously if a migration silently stopped being applied." There is no
symmetric assertion for the thing 04-10 actually did. Nothing in any pgTAP file checks that
`public.example_items` is gone, that its policy is gone, or that `tenant_modules_key_chk` now refuses
`'example'`. A migration that stopped being applied at `20260923035937` — or a hand-restored table on
some environment — passes every file in `supabase/tests/`. Assertion 2's exemption list is also a
latent hole here: a resurrected `example_items` carrying `tenant_id` would be caught by assertions 1
and 3, but a table dropped *and re-created without RLS* is the only shape those cover.

**Fix:** add the removal as a fifth assertion in the same file:

```sql
select plan(6);
...
-- 5. 04-10 / D-19: the reference module's table is GONE, not merely unused.
select is(
  (select to_regclass('public.example_items')::text),
  null,
  'D-19: example_items no longer exists (20260923035937 applied)'
);
-- 6. …and its key is out of the vocabulary, so no tenant can be flagged with it again.
select throws_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     select id, 'example', true from public.tenants limit 1 $$,
  '23514',
  null,
  'D-19: tenant_modules_key_chk refuses the retired key'
);
```

### B-WR-12: `NOT IN (subquery)` in the media cleanups is one schema change from silently deleting nothing

**File:** `apps/api/tests/integration/media.test.ts:167`, `apps/api/tests/integration/mux-webhook.test.ts:206`, `apps/api/tests/integration/media-playback.test.ts:99`

**Issue:** `id not in (select media_asset_id from public.feed_post_media)` is correct **only**
because `feed_post_media.media_asset_id` is declared `NOT NULL`
(`20260922165218_feed_post_media.sql:17`). The day that column becomes nullable — or the day the
subquery is widened to a nullable column such as `member_profiles.avatar_asset_id` or
`feed_link_previews.image_asset_id`, which is exactly what B-CR-01's fix needs — a single NULL makes
the whole predicate `UNKNOWN` for every row and the `delete` quietly becomes a no-op. Nothing would
fail; the cleanups would simply stop cleaning, and the next run would page over the previous run's
fixtures.

**Fix:** use `NOT EXISTS`, which is NULL-safe by construction (see the snippet in B-CR-01).

### B-WR-13: the integration suite exercises exactly one SSRF deny shape

**File:** `apps/api/tests/integration/feed-unfurl.test.ts:196-222,341-358`

**Issue:** Both guard cases point at a literal `http://127.0.0.1:<port>/…`, i.e. an address the guard
can refuse by string inspection alone, before any DNS lookup. The classes that actually break SSRF
guards are absent from this file: a *hostname* that resolves to a private address, a public host that
`302`s to a private one, a `0.0.0.0` / `[::1]` / `169.254.169.254` / decimal-IP spelling, and the
DNS-rebinding TOCTOU where the guard resolves an allowed address and the socket then connects to a
re-resolved private one. The docblock (lines 185-194) defers the allow-path to
`packages/modules/feed/tests/unfurl-guard.test.ts` "which can substitute the block list" — but
substituting the block list is precisely what makes that suite unable to prove the deny path for
anything the production list must catch.

**Dependency:** whether these cases are covered, and whether the guard pins the resolved address for
the connect, lives in `packages/modules/feed/server/unfurl/**` — **Part A**. Flagging here because
the gap is in this file's coverage and because `open-graph-scraper` is marked LOW confidence in
`CLAUDE.md` with an explicit SSRF-allow-list requirement.

**Fix:** add loopback-by-name and redirect-to-loopback cases against the existing local fixtures,
which needs no network:

```ts
it('8. a hostname that RESOLVES to the loopback is refused, not just a literal 127.0.0.1', async () => {
  const url = `http://localhost:${internal.port}/painel`;   // resolves private; not a literal IP
  ...
  expect(after?.failure_reason).toBe('blocked');
  expect(internal.requests).toBe(before);
});

it('9. a redirect INTO the private range is refused after the first hop', async () => {
  const redirector = await listen((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${internal.port}/painel` });
    res.end();
  });
  ...
  expect(internal.requests).toBe(0);   // the hop was never followed
});
```

### B-WR-14: an unknown module key now reaches the database as a raw 23514 instead of a 400

**File:** `apps/api/tests/integration/platform-tenants.test.ts:304-319`

**Issue:** 04-10 removed the `not_toggleable` refusal from `setModuleEnabled`, and the test was
rewritten to document the new behaviour rather than to flag it:

```ts
let checkViolation: { code?: string; constraint_name?: string } | null = null;
try {
  await setModuleEnabled(ids.demo, 'nao-existe' as ModuleKey, true, actor);
} catch (error) { checkViolation = (error as { cause?: … }).cause ?? null; }
expect(checkViolation?.code).toBe('23514');
expect(checkViolation?.constraint_name).toBe('tenant_modules_key_chk');
```

The **route** still refuses via `z.enum(...)` (test 17 pins that), so no HTTP caller can reach it.
But the exported service function now has no input validation of its own: any non-route caller — a
future platform script, a backfill job, a worker — gets an unhandled `23514` that
`errorEnvelope` will surface as a 500 `INTERNAL`, not a 400 `VALIDATION_FAILED`. The phase's own
convention elsewhere ("the composer's visibility can never disagree with what the API will allow") is
that the service, not only the route, owns the rule.

**Dependency:** `setModuleEnabled` lives in `packages/core/server/platform/**` — **Part A**. Noting
it here because the assertion in this file is the only thing that records the change.

**Fix:** restore a cheap guard in the service and keep the test asserting the API-level answer:

```ts
if (!TOGGLEABLE_MODULES.includes(key)) {
  throw new ApiError(400, 'VALIDATION_FAILED', { module: 'unknown_key' });
}
```

### B-WR-15: several `afterAll` sweeps are database-wide and safe only because `fileParallelism` is off

**File:** `apps/api/tests/integration/feed.test.ts:133-135`, `apps/api/tests/integration/feed-unfurl.test.ts:150-151`, `apps/api/tests/integration/feed-interactions.test.ts:171-172`, `apps/api/tests/integration/feed-query-budget.test.ts:124-125`

**Issue:** The sweeps are scoped by caption/body prefix or by queue name, never by tenant:

```ts
// feed.test.ts
delete from public.feed_posts where caption like 'Publicacao %' or caption ~ '^a{100,}$'
// feed-unfurl.test.ts — every job on the queue, whoever enqueued it
delete from pgboss.job_common where name = ${FEED_UNFURL_QUEUE}
```

They are correct today only because `apps/api/vitest.config.ts:74` sets `fileParallelism: false` —
an unrelated performance knob that no comment in any of these files mentions and that a future
"speed up CI" change would flip. The moment two files run concurrently, `feed-unfurl`'s teardown
deletes jobs another suite is asserting on, and `feed.test.ts:176-179`'s `expect(ids.length).toBe(total?.count)`
(a full-tenant `count(*)` compared against a paged walk) becomes a race.

Similarly, `feed-query-budget.test.ts:134,164,181` calls `pg_stat_statements_reset()`, which is
cluster-global.

**Fix:** scope every sweep by `tenant_id` as well as by prefix, and record the dependency where it
is load-bearing:

```ts
await adminSql`
  delete from public.feed_posts
   where tenant_id = ${tenantIds.demo}::uuid
     and (caption like 'Publicacao %' or caption ~ '^a{100,}$')`;

// feed-unfurl.test.ts
await adminSql`
  delete from pgboss.job_common
   where name = ${FEED_UNFURL_QUEUE} and data->>'tenantId' = any(${[tenantIds.demo, tenantIds.lab]})`;
```

and add a comment at `vitest.config.ts:74` explaining that the integration sweeps depend on it.

### B-WR-16: `ensureUser` only ever looks at the first page of GoTrue users

**File:** `scripts/seed.ts:576-590`

**Issue:**

```ts
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) throw error;
```

One page, no pagination loop, and the fallback on a miss is to rethrow the original `createUser`
error — which on a re-run is "user already registered". Phase 4 raised the seeded identity count
(nine extra demo members, plus `SEED_REMOVED_MEMBER` per tenant), and every test file that creates a
throwaway identity and fails to clean it up adds one more. Past 1000 accounts in the project's auth
store, `pnpm db:seed` starts failing on an existing user with a misleading message.

**Fix:** page until the user is found or the list is exhausted:

```ts
for (let page = 1; ; page++) {
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
  if (listError) throw listError;
  const hit = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (hit) return hit.id;
  if (list.users.length < 1000) throw error;
}
```

## Info

### B-IN-01: `./setup` is imported twice in the same file

**File:** `apps/api/tests/integration/jobs.test.ts:13,15`
`import { adminSql } from './setup';` already evaluates the module, so the bare
`import './setup';` on line 15 is a no-op. The comment on line 14 explains a real requirement (the
app import registers queue names), but the named import on line 13 already satisfies it. Drop line 15
or move the comment onto line 13.

### B-IN-02: `DROP POLICY` immediately before `DROP TABLE … CASCADE` is dead

**File:** `supabase/migrations/20260923035937_drop_example_module.sql:38-39`
`DROP TABLE "example_items" CASCADE` removes the policy with the table. The separate
`DROP POLICY … CASCADE` cannot fail in a healthy database and cannot succeed in a drifted one that
lost the table. Covered by B-WR-09's fix.

### B-IN-03: test identifiers are out of order

**File:** `apps/api/tests/integration/isolation.test.ts` (case `q.` declared immediately before case `p.`)
The 04-08 post-detail case was inserted above the pre-existing `p.` case, so the file now reads
`… o. q. p.`. Cosmetic, but the letters are used as stable references in `04-VALIDATION.md`.

### B-IN-04: `expect(body).not.toContain('http')` is broader than its intent

**File:** `apps/api/tests/integration/feed-media.test.ts:332`
The assertion means "no signed Storage URL leaked" and the two lines above it say so precisely
(`'storage/v1/object/sign'`, `'token='`). The bare `'http'` will also fire on a caption, a filename or
a future `linkPreview.url` that legitimately contains the substring. Consider
`expect(body).not.toMatch(/https?:\/\//)` scoped to the media rows, or drop the line.

### B-IN-05: two pgTAP files claim the same tenant and user UUIDs under different slugs

**File:** `supabase/tests/030-lanes.sql:36-38` vs `supabase/tests/090-feed.sql:32-35`
Both use `0c000000-0000-4000-8000-000000000001` as the tenant id and `…0002` as a member id, with
different slugs (`pgtap-lane` vs `pgtap-feed`). Harmless today because each file is its own rolled-back
transaction, but it means the two files can never be merged or run inside one transaction, and a
reader grepping for the literal finds two unrelated fixtures. Give 030 its own prefix (e.g. `0f…`).

### B-IN-06: `090-feed.sql`'s reconciliation assertions are not hermetic

**File:** `supabase/tests/090-feed.sql:156-170`
Both `is_empty` assertions scan **every** post and comment in the database, by design ("a seed that
wrote a counter by hand … shows up here"). The cost is that a leftover row from a killed integration
run — one whose counters drifted for reasons unrelated to this phase — turns the isolation-adjacent
gate red with a message that points at the wrong place. Worth a note in the docblock so the next
person reading a red 090 knows to check for orphans first.

### B-IN-07: `feed-unfurl.test.ts` case 2 reaches into case 1's state by index

**File:** `apps/api/tests/integration/feed-unfurl.test.ts:214`
`api.request(\`/v1/feed/posts/${createdPostIds[0]}\`, …)` assumes case 1 ran first and pushed exactly
one id. Fine under Vitest's in-file ordering, but a `.only`, a re-order or an inserted case ahead of
it silently retargets the assertion at a different post. Capture the id in case 1 into a named
`let articlePostId` instead.

---

_Reviewed: 2026-09-23_
_Reviewer: Claude (gsd-code-reviewer), Part B — apps/api, supabase, scripts_
_Depth: standard_
