-- reels_module — the `reels` module key, Reels' 'Todos' index and the key's backfill (05.3-01, D-121,
-- D-122, REELS-01, REELS-03).
--
-- The three statements drizzle-kit generated come first, unchanged:
--   1. drop `tenant_modules_key_chk`;
--   2. create `feed_posts_tenant_video_created_idx`, the partial index (`where media_kind = 'video'`)
--      that serves Reels' 'Todos' list in both communities-module states (pinned by name in
--      supabase/tests/130-reels.sql);
--   3. recreate the CHECK, now ending in 'reels'. It is GENERATED from `TOGGLEABLE_MODULES` in
--      packages/contracts/src/modules.ts, so appending the key there is what produced it.
--
-- Then ONE hand-written statement, the D-122 backfill: every EXISTING tenant gets an enabled `reels`
-- row, because a missing row reads as disabled and the key is on by default (new tenants get theirs
-- from `createTenant`, which writes one row per `TOGGLEABLE_MODULES` key). Why it lives here:
--   - hand SQL in the generated file, not a separate `--custom` migration: the backfill MUST run after
--     the widened CHECK (the old CHECK refuses the key), and two files could be applied in the wrong
--     order on some future environment — the 04-10 `drop_example_module` precedent;
--   - `on conflict (tenant_id, module_key) do nothing`: a row that already exists keeps its value, so
--     a tenant a super_admin already switched OFF stays off, and a re-run writes no second row;
--   - the generated snapshot (`meta/20260926184147_snapshot.json`) is untouched, so `pnpm db:generate`
--     stays idempotent: it diffs the snapshot, never this file's body;
--   - locally, `pnpm db:reset` applies migrations to an EMPTY database and seeds afterwards, so this
--     statement touches no row there. It was proven once by applying this migration on top of the
--     seeded local database (`supabase migration up`, after a data-only backup), and its semantics are
--     pinned in 130-reels.sql. It first reaches a hosted database at Phase 01.1's `supabase db push`,
--     where it runs once against the real tenants.

ALTER TABLE "tenant_modules" DROP CONSTRAINT "tenant_modules_key_chk";--> statement-breakpoint
CREATE INDEX "feed_posts_tenant_video_created_idx" ON "feed_posts" USING btree ("tenant_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE media_kind = 'video';--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_key_chk" CHECK ("tenant_modules"."module_key" in ('feed','communities','stories','events','chat','notifications','reels'));--> statement-breakpoint

-- D-122 backfill. AFTER the widened CHECK above, which is the statement that admits the key.
insert into public.tenant_modules (tenant_id, module_key, enabled)
select t.id, 'reels', true from public.tenants t
on conflict (tenant_id, module_key) do nothing;
