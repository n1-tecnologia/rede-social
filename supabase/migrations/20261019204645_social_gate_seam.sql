-- social_gate_seam (09-02, FOLLOW-01, SOCIAL-06, D-483; RESEARCH Pattern 2) - the KERNEL declares the
-- social gate; the social module gives it a body.
--
-- WHY. From Phase 9 a member post is readable only by its author, the author's followers and a
-- moderator. That rule is asked by feed's restrictive policies and services (plans 03-05), by the
-- notifications worker and by the dashboard, so it is ONE seam with a kernel-owned name
-- (`packages/core/db/social-gate.ts`), never a call into a module: feed must not depend on the
-- social module's table (MOD-02).
--
-- WHY STUBS FIRST. The generated `*_social_follows.sql` migration creates the `social_follows`
-- insert policy, whose `CREATE POLICY` must resolve `app.social_enabled()` when it runs, while the
-- bodies below cannot be created before the `social_follows` table exists (SQL-language bodies are
-- validated at creation). So this file sorts first and declares the two functions with their neutral
-- answers, and `*_social_functions.sql` swaps both bodies with `create or replace` (same signature,
-- same OID, so the dependent policies keep working). Until then, or in a project that reuses the
-- feed without `social`, the gate is a no-op for authors:
--   app.social_enabled()              -> false  (social is off for everyone)
--   app.social_visible_author_ids()   -> '{}'   (no author is visible through the follow graph)
--
-- Hardening (the T-06-29 posture, kept by every body that replaces these): SECURITY DEFINER,
-- `search_path = ''`, fully qualified names; EXECUTE revoked from PUBLIC and granted to
-- `authenticated` only. The stubs read no table.

create or replace function app.social_enabled() returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
--> statement-breakpoint
revoke all on function app.social_enabled() from public;--> statement-breakpoint
grant execute on function app.social_enabled() to authenticated;--> statement-breakpoint

create or replace function app.social_visible_author_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$ select '{}'::uuid[] $$;
--> statement-breakpoint
revoke all on function app.social_visible_author_ids() from public;--> statement-breakpoint
grant execute on function app.social_visible_author_ids() to authenticated;
