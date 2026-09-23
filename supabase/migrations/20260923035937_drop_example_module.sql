-- drop_example_module — the forward-only removal of the throwaway reference module (D-19, 04-10).
--
-- THE ORDER OF THESE STATEMENTS IS THE WHOLE POINT, and it is not the order drizzle-kit emits.
-- `tenant_modules_key_chk` is GENERATED from `TOGGLEABLE_MODULES` in packages/contracts/src/modules.ts
-- (see packages/core/db/schema/tenant-modules.ts), so deleting a key from that TypeScript list is a
-- schema change. The narrowed CHECK is validated against every existing row at creation time, so it
-- REFUSES TO BE CREATED while any row still carries the retired key — and `scripts/seed.ts` enabled
-- exactly that key on the demo tenant until this plan. Hence:
--
--   1. delete the `tenant_modules` rows carrying the retired key   (must come FIRST, same file)
--   2. drop the module's policy and its table
--   3. drop and recreate the narrowed CHECK                        (drizzle-kit's own output)
--
-- Statements 2 and 3 are what `pnpm db:generate` produced; statement 1 and the pg-boss cleanup are
-- hand-added here rather than in a separate `--custom` file, because splitting them would allow the
-- two halves to be applied in the wrong order on some future environment — which is precisely the
-- failure this ordering exists to prevent. The generated snapshot
-- (`meta/20260923035937_snapshot.json`) is untouched, so `pnpm db:generate` stays idempotent: it
-- diffs the snapshot, never this file's body.

-- 1. The rows first. A `where` on the key, not on the tenant: any tenant that ever had it loses it.
delete from public.tenant_modules where module_key = 'example';--> statement-breakpoint

-- The module's pg-boss queue and any jobs still holding its name. `pgboss` is created at RUNTIME by
-- the worker, not by a migration, so a cold `supabase db reset` has no such schema — `to_regclass`
-- makes this a no-op there instead of a failed migration.
do $$
begin
  if to_regclass('pgboss.job_common') is not null then
    delete from pgboss.job_common where name = 'example.process';
  end if;
  if to_regclass('pgboss.queue') is not null then
    delete from pgboss.queue where name = 'example.process';
  end if;
end $$;--> statement-breakpoint

-- 2. The module's own table and its isolation policy.
DROP POLICY "example_items_tenant_isolation" ON "example_items" CASCADE;--> statement-breakpoint
DROP TABLE "example_items" CASCADE;--> statement-breakpoint

-- 3. The narrowed key vocabulary. This is the statement that would fail if 1 had not run.
ALTER TABLE "tenant_modules" DROP CONSTRAINT "tenant_modules_key_chk";--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_key_chk" CHECK ("tenant_modules"."module_key" in ('feed','communities','stories','events','chat','notifications'));
