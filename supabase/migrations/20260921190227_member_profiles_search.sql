-- member_profiles_search — everything about `member_profiles` that drizzle-kit cannot model
-- (PROF-01/PROF-03, R-08, R-10, CONTEXT decision "the eager row is created by a database trigger").
--
-- Why this file is hand-written and its companion `*_member_profiles.sql` is generated:
--   * `create extension` — drizzle-kit does not emit extensions.
--   * `app.imm_unaccent(text)` — a schema-qualified IMMUTABLE wrapper function; not modelled.
--   * the two EXPRESSION indexes over `app.imm_unaccent(lower(display_name))` — declaring them in
--     the drizzle TS as well as here would make `pnpm db:generate` non-idempotent (it would keep
--     proposing them), so the schema file declares the PLAIN indexes and this file the expression
--     ones, with a comment in each pointing at the other.
--   * `app.ensure_member_profile()` + its trigger and the one-row-per-membership backfill — R-08
--     requires one profile row per membership, EAGERLY. Memberships are inserted in at least four
--     places today (tenancy/signup.ts, platform/invites.ts twice, scripts/seed.ts) and Phase 8 will
--     add more; a trigger makes the invariant structural, so a future call site cannot forget it.
--     A lazy row would force the 03-03 directory into `coalesce(mp.display_name, u.name)` across two
--     tables, which the trigram expression index below cannot cover.

-- Supabase keeps extensions in the `extensions` schema (the `citext` precedent, 20260912030541).
create extension if not exists unaccent with schema extensions;--> statement-breakpoint
create extension if not exists pg_trgm with schema extensions;--> statement-breakpoint

-- R-10, proven against this project's Postgres: the TWO-ARGUMENT `unaccent(regdictionary, text)`
-- form pins the dictionary, which is what makes IMMUTABLE honest (the one-argument form depends on
-- the search_path-resolved default dictionary and may not be indexed). Without IMMUTABLE the
-- expression indexes below cannot be created at all, so an accidental STABLE is a loud failure —
-- and pgTAP 080 asserts the marking anyway, because `create or replace` could weaken it later.
create or replace function app.imm_unaccent(text) returns text
  language sql immutable parallel safe strict
  as $$ select extensions.unaccent('extensions.unaccent', $1) $$;--> statement-breakpoint
grant execute on function app.imm_unaccent(text) to authenticated, service_role, api_user;--> statement-breakpoint

-- Accent- and case-insensitive substring search (PROF-03): `goncal` finds `João Gonçalves`,
-- `MUNOZ` finds `Íris Muñoz`.
create index if not exists member_profiles_name_trgm_idx on public.member_profiles
  using gin (app.imm_unaccent(lower(display_name)) extensions.gin_trgm_ops);--> statement-breakpoint

-- The keyset ORDER index 03-03 pages on: `order by app.imm_unaccent(lower(display_name)), id`.
-- `tenant_id` first, per SCHEMA-CONVENTIONS (a)4 / the 01-08 convention.
create index if not exists member_profiles_tenant_name_idx on public.member_profiles
  (tenant_id, app.imm_unaccent(lower(display_name)), id);--> statement-breakpoint

-- SECURITY DEFINER is REQUIRED: `member_profiles` carries no insert policy (by design — see the
-- schema file's policy-intent docblock), so the function must run with the owner's rights to write
-- the row. `set search_path = ''` plus fully-qualified names is the standard hardening (the
-- `public.handle_new_user` precedent, 20260912031030): a hostile search_path cannot shadow
-- `public.users` or `public.member_profiles`. The function derives every value from the NEW
-- membership row and does nothing else; `on conflict do nothing` makes it non-destructive.
create or replace function app.ensure_member_profile() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.member_profiles (tenant_id, membership_id, user_id, display_name)
  select new.tenant_id, new.id, new.user_id, coalesce(u.name, '')
    from public.users u
   where u.id = new.user_id
  on conflict (membership_id) do nothing;
  return new;
end
$$;--> statement-breakpoint

drop trigger if exists member_profiles_from_membership on public.memberships;--> statement-breakpoint
create trigger member_profiles_from_membership
  after insert on public.memberships
  for each row execute function app.ensure_member_profile();--> statement-breakpoint

-- Backfill: one row per membership that already exists (the seed tenants' admins and members on a
-- warm database). Idempotent, so a re-applied migration is harmless.
insert into public.member_profiles (tenant_id, membership_id, user_id, display_name)
select m.tenant_id, m.id, m.user_id, coalesce(u.name, '')
  from public.memberships m
  join public.users u on u.id = m.user_id
on conflict (membership_id) do nothing;
