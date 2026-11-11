-- member_communities_functions (10-03, MCOMM-07, MPUB-04, MPUB-07; D-708, D-718; the Escopo seam) — the two
-- SECURITY DEFINER functions the member communities need. Hand-written (`--custom`) and EARLIER than the
-- generated `*_member_communities.sql`, because that file's CREATE POLICY resolves
-- `app.member_community_hidden_ids()` when it runs (EP-54); the same order holds for
-- `*_feed_community_audience.sql`, which also reads it.
--
--   1. `app.member_community_hidden_ids() uuid[]` (D-708): the ids of this tenant's MEMBER communities whose
--      creator has no live membership (`status = 'active'`, `blocked_at is null`, `deleted_at is null`); '{}'
--      when there are none or when the lane carries no tenant claim (never null). It is a definer because an
--      invoker function reading `public.memberships` and `public.communities` from a policy would evaluate
--      their own policies inside EVERY community and feed statement; the definer pins
--      `tenant_id = app.tenant_id()` itself, like every function of the community gate. It returns ids only
--      (no names, no counts, no creators) and is read once per statement, as an InitPlan, by the policies
--      (`coalesce((select app.member_community_hidden_ids()), '{}'::uuid[])`; the `<> all (subquery)` form
--      fails, see `packages/core/db/community-gate.ts`). It has no `limit` and no single-row pick clause, so
--      pgTAP 040's convention on row-picking functions does not apply. It is NOT folded into
--      `app.community_deleted_ids()`: pgTAP 112 pins that function's meaning (a SOFT-DELETED community). It
--      writes nothing: blocking, removing or unblocking a creator changes only what the lanes can read and
--      never touches a row, so nothing a moderator or an auditor may need is destroyed.
--
--   2. `app.community_action_allowed(p_community_id uuid, p_action text) boolean` — the ESCOPO SEAM, a
--      KERNEL STUB, in the pattern of `20261008171502_community_gate_seam.sql`. The per-product action scope
--      of a buyer inside a community (what a buyer may do there: `like`, `comment`, `share`, `post`,
--      `story`; the vocabulary is RESERVED here in this comment only, the stub never inspects it) is built
--      after Phase 11. Until then the stub reads no table, ignores both arguments and answers `false` for
--      every input (a null community and an unknown action included), so the reserved branch of
--      `feed_posts_social_insert_gate` that calls it is never taken and NO refusal, read or write of Phase 10
--      changes. The Escopo phase swaps ONLY the body with `create or replace`, keeping the signature and the
--      attributes, so the dependent policy keeps working (same OID), exactly as the store replaced the
--      community gate seam. pgTAP 230 pins the stub (false for the five actions, every lane) and catches the
--      day the body changes.
--
-- Hardening (the T-06-29 posture): `search_path = ''`, fully qualified names; EXECUTE revoked from PUBLIC and
-- granted to `authenticated` only.
--
-- Expand-only (MPUB-07): two new functions, no table, no column, no row touched. Both reach every tenant
-- project through the ledgered `migrateAll`.
--
-- WHY THE FIRST FUNCTION IS plpgsql AND NOT `language sql` (the one deviation from the template above): a
-- `language sql` body is parsed and bound AT CREATION, and it reads `public.communities.kind`, a column the
-- GENERATED `*_member_communities.sql` adds one file LATER (this file must sort first, EP-54, because that
-- file's policies call the function). A plpgsql body binds its statement at first call, long after both files
-- have run, so the function can be declared here without adding the column twice. The attributes the policies
-- and pgTAP rely on are identical (stable, security definer, `search_path = ''`, the same grants).

create or replace function app.member_community_hidden_ids() returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((
    select array_agg(c.id)
      from public.communities c
     where c.tenant_id = app.tenant_id()
       and c.kind = 'member'
       and not exists (
             select 1
               from public.memberships m
              where m.tenant_id = c.tenant_id
                and m.user_id = c.created_by_user_id
                and m.status = 'active'
                and m.blocked_at is null
                and m.deleted_at is null)
  ), '{}'::uuid[]);
end
$$;
--> statement-breakpoint
revoke all on function app.member_community_hidden_ids() from public;--> statement-breakpoint
grant execute on function app.member_community_hidden_ids() to authenticated;--> statement-breakpoint

create or replace function app.community_action_allowed(p_community_id uuid, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
--> statement-breakpoint
revoke all on function app.community_action_allowed(uuid, text) from public;--> statement-breakpoint
grant execute on function app.community_action_allowed(uuid, text) to authenticated;
