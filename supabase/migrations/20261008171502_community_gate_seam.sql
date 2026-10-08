-- community_gate_seam (08.2-01, STORE-11, COMM-02; RESEARCH Pattern 1, Pitfall 2) — the KERNEL
-- declares the community gate; a module gives it a body.
--
-- WHY. Community read access used to be derived from tenant membership alone (D-73: every member
-- sees every community). From 08.2 a community linked to a store product is locked for a member who
-- holds no active entitlement to any of its products. That rule is asked by feed's restrictive
-- policies and services today and by stories and the notifications worker in later plans, so it is
-- ONE seam with a kernel-owned name (`packages/core/db/community-gate.ts`), never a call into a
-- module.
--
-- WHY STUBS FIRST. The generated `*_store.sql` migration creates `feed_posts_community_gate`, whose
-- `CREATE POLICY` must resolve `app.community_locked_ids()` when it runs, while the store body cannot
-- be created before the store tables exist (SQL-language bodies are validated at creation). So this
-- file sorts first and declares the four functions with their neutral answers; the store's
-- `*_store_functions.sql` swaps three bodies with `create or replace` (same signature, same OID, so
-- the dependent policies keep working). Until then, or in a project that reuses feed without the
-- store, every community is open and no asset is hidden:
--   app.community_locked_ids()               -> '{}'   (the request lane's locked communities)
--   app.community_locked_ids_for(p_user)     -> '{}'   (the same for an explicit user)
--   app.community_viewer_ids(p_community)    -> null   (null = not gated, everyone reads it)
--   app.media_asset_hidden(p_asset)          -> false  (no asset hidden by the gate)
--
-- Hardening (the T-06-29 posture, kept by every body that replaces these): SECURITY DEFINER,
-- `search_path = ''`, fully qualified names; EXECUTE revoked from PUBLIC and granted to
-- `authenticated` only. The stubs read no table.

create or replace function app.community_locked_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$ select '{}'::uuid[] $$;
--> statement-breakpoint
revoke all on function app.community_locked_ids() from public;--> statement-breakpoint
grant execute on function app.community_locked_ids() to authenticated;--> statement-breakpoint

create or replace function app.community_locked_ids_for(p_user uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$ select '{}'::uuid[] $$;
--> statement-breakpoint
revoke all on function app.community_locked_ids_for(uuid) from public;--> statement-breakpoint
grant execute on function app.community_locked_ids_for(uuid) to authenticated;--> statement-breakpoint

create or replace function app.community_viewer_ids(p_community uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$ select null::uuid[] $$;
--> statement-breakpoint
revoke all on function app.community_viewer_ids(uuid) from public;--> statement-breakpoint
grant execute on function app.community_viewer_ids(uuid) to authenticated;--> statement-breakpoint

create or replace function app.media_asset_hidden(p_asset uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
--> statement-breakpoint
revoke all on function app.media_asset_hidden(uuid) from public;--> statement-breakpoint
grant execute on function app.media_asset_hidden(uuid) to authenticated;
