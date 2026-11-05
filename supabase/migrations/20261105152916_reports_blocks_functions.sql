-- reports_blocks_functions (Phase 13, NATIVE-31, NATIVE-33; D-616, AD-1, AD-7; T-13-21, T-13-22, T-13-23) — the rules
-- of the minimum report and member-block slice. Hand-written (`--custom`): drizzle-kit cannot model functions. Its
-- companion `*_reports_blocks.sql` is the GENERATED half (`content_reports` and `member_blocks` with their CHECKs,
-- keys, index and ONE select policy each, and NO write policy); this file is sorted AFTER it.
--
-- WHY DEFINERS. The two tables have no insert, update or delete policy, so a tenant lane can never write them
-- directly: every write is one of the functions below, which pin the tenant and the caller to the claims in EVERY
-- statement. The owner is `postgres`, which has `rolbypassrls`, so RLS protects NOTHING inside a definer and the
-- tenant scope is the function's own (the conventions of `20260930180227_push_subscriptions_functions.sql` carry
-- over: `security definer`, `set search_path = ''`, fully qualified names, `revoke all … from public`, `grant
-- execute … to authenticated` only). `app` is not a PostgREST-exposed schema, so none of this is RPC-reachable.
--
-- THE LIVE PREDICATE (the fan-out's, D-229): `status = 'active'`, `blocked_at is null`, `deleted_at is null`, in the
-- caller's tenant. A caller who is not live is refused with 42501, a member who asked to delete their account
-- (`deleted_at` set, plan 07) included.
--
-- SQLSTATE. `42501` refused (no claim, caller not live, caller not admin); `RP001` the caller's own content;
-- `RP002` a subject (or, on resolve, a report) that does not exist, is deleted or belongs to another tenant;
-- `RP004` a report that is already resolved; `BL001` a block target that is not a live `member` of the same
-- tenant, or is the caller. A duplicate report surfaces as the unique violation 23505, an over-long note as the
-- CHECK violation 23514. (`RP003` is deliberately unused.)
--
-- A report never removes content by itself (T-13-23). `content_report_resolve` only records the admin's decision;
-- the removal and its moderation-log row stay in the existing kernel paths, called by plan 14 in the SAME
-- transaction as the resolve, so a removal without its log row stays impossible.

-- ── app.is_blocked_by_viewer ──────────────────────────────────────────────────────────────────────────
-- The predicate the read paths filter with (plan 14 adds it to the feed): true only when the CALLER has blocked
-- `p_author` in the caller's tenant. `security invoker`, so the RLS of `member_blocks` applies (the caller's own
-- rows only) on top of the explicit scope below: the blocked member, looking at the blocker, always reads false,
-- and no member can learn who blocked them (T-13-21). A lane without claims reads false.
create or replace function app.is_blocked_by_viewer(p_author uuid)
returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1
      from public.member_blocks b
     where b.tenant_id = app.tenant_id()
       and b.blocker_user_id = app.user_id()
       and b.blocked_user_id = p_author
  )
$$;
--> statement-breakpoint
revoke all on function app.is_blocked_by_viewer(uuid) from public;--> statement-breakpoint
grant execute on function app.is_blocked_by_viewer(uuid) to authenticated;--> statement-breakpoint

-- ── app.member_block_create ───────────────────────────────────────────────────────────────────────────
-- The caller blocks another member. The target must be a LIVE member of the SAME tenant, with role `member` (staff
-- cannot be blocked by a member, AD-1, T-13-23) and not the caller; anything else is BL001, with no row written and
-- no way to tell "another tenant" from "no such member" (T-13-22). Idempotent: blocking twice is the same row.
-- Returns true when this call created the block, false when it already existed.
create or replace function app.member_block_create(p_blocked uuid)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_n int;
begin
  if v_t is null or v_u is null then
    raise exception 'member_block_create: refused' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.memberships m
     where m.tenant_id = v_t
       and m.user_id = v_u
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
  ) then
    raise exception 'member_block_create: refused' using errcode = '42501';
  end if;

  if p_blocked is null or p_blocked = v_u then
    raise exception 'member_block_create: invalid target' using errcode = 'BL001';
  end if;
  if not exists (
    select 1
      from public.memberships m
     where m.tenant_id = v_t
       and m.user_id = p_blocked
       and m.role = 'member'
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
  ) then
    raise exception 'member_block_create: invalid target' using errcode = 'BL001';
  end if;

  insert into public.member_blocks (tenant_id, blocker_user_id, blocked_user_id)
  values (v_t, v_u, p_blocked)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end
$$;
--> statement-breakpoint
revoke all on function app.member_block_create(uuid) from public;--> statement-breakpoint
grant execute on function app.member_block_create(uuid) to authenticated;--> statement-breakpoint

-- ── app.member_block_delete ───────────────────────────────────────────────────────────────────────────
-- The caller lifts their own block. Scoped to the caller's tenant and the caller as blocker, so nobody can remove
-- another member's block. Unblocking a non-block is a no-op. Returns true when a row was removed. It does not need
-- the target to be live (a member who was removed since can still be unblocked).
create or replace function app.member_block_delete(p_blocked uuid)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_n int;
begin
  if v_t is null or v_u is null then
    raise exception 'member_block_delete: refused' using errcode = '42501';
  end if;

  delete from public.member_blocks b
   where b.tenant_id = v_t
     and b.blocker_user_id = v_u
     and b.blocked_user_id = p_blocked;
  get diagnostics v_n = row_count;
  return v_n > 0;
end
$$;
--> statement-breakpoint
revoke all on function app.member_block_delete(uuid) from public;--> statement-breakpoint
grant execute on function app.member_block_delete(uuid) to authenticated;--> statement-breakpoint

-- ── app.content_report_create ─────────────────────────────────────────────────────────────────────────
-- A live member reports a post or a comment of the tenant. The subject is resolved INSIDE the caller's tenant with
-- the live predicate (`deleted_at is null`), so a deleted subject and one of another tenant are the same RP002
-- (T-13-22: the id of another tenant is inert). The caller's own content is RP001. The author's user id and the
-- first 280 code points of the caption or body are snapshotted (`left` counts characters, so a surrogate pair is
-- never cut in half); `note` is stored as given, an empty string as null, and 501 characters hit the CHECK (23514).
-- A second report of the same item by the same reporter is the unique violation (23505, AD-6). Returns the new id.
create or replace function app.content_report_create(
  p_subject_type text,
  p_subject_id uuid,
  p_reason text,
  p_note text
)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_author uuid;
  v_text text;
  v_id uuid;
begin
  if v_t is null or v_u is null then
    raise exception 'content_report_create: refused' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.memberships m
     where m.tenant_id = v_t
       and m.user_id = v_u
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
  ) then
    raise exception 'content_report_create: refused' using errcode = '42501';
  end if;

  if p_subject_type = 'feed_post' then
    select p.author_user_id, p.caption into v_author, v_text
      from public.feed_posts p
     where p.id = p_subject_id
       and p.tenant_id = v_t
       and p.deleted_at is null;
  elsif p_subject_type = 'post_comment' then
    select c.author_user_id, c.body into v_author, v_text
      from public.feed_comments c
     where c.id = p_subject_id
       and c.tenant_id = v_t
       and c.target_kind = 'post'
       and c.deleted_at is null;
  else
    raise exception 'content_report_create: unknown subject type' using errcode = '22023';
  end if;
  if v_author is null then
    raise exception 'content_report_create: no such subject' using errcode = 'RP002';
  end if;
  if v_author = v_u then
    raise exception 'content_report_create: own content' using errcode = 'RP001';
  end if;

  insert into public.content_reports (
    tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, note, excerpt
  ) values (
    v_t, v_u, p_subject_type, p_subject_id, v_author, p_reason, nullif(p_note, ''), left(coalesce(v_text, ''), 280)
  )
  returning id into v_id;
  return v_id;
end
$$;
--> statement-breakpoint
revoke all on function app.content_report_create(text, uuid, text, text) from public;--> statement-breakpoint
grant execute on function app.content_report_create(text, uuid, text, text) to authenticated;--> statement-breakpoint

-- ── app.content_report_resolve ────────────────────────────────────────────────────────────────────────
-- The admin's decision on one report: `admin_tenant` only (a member or a support member is refused with 42501),
-- and the admin must be live. The row is locked `for update` so two admins resolving at once leave exactly one
-- winner: the second finds it resolved (RP004). `open` goes to exactly one of `dismissed`, `content_removed`,
-- `author_blocked`; `resolved_by_user_id` and `resolved_at` are written once, from the claims and `now()`. A report
-- of another tenant is not found (RP002). The function removes NOTHING: it returns what plan 14 needs to act on
-- in the same transaction (the subject and the author at report time).
create or replace function app.content_report_resolve(p_id uuid, p_resolution text)
returns table (subject_type text, subject_id uuid, author_user_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
  v_u uuid := app.user_id();
  v_r public.content_reports%rowtype;
begin
  if v_t is null or v_u is null or app.tenant_role() is distinct from 'admin_tenant' then
    raise exception 'content_report_resolve: refused' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.memberships m
     where m.tenant_id = v_t
       and m.user_id = v_u
       and m.role = 'admin_tenant'
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
  ) then
    raise exception 'content_report_resolve: refused' using errcode = '42501';
  end if;
  if p_resolution is null or p_resolution not in ('dismissed', 'content_removed', 'author_blocked') then
    raise exception 'content_report_resolve: unknown resolution' using errcode = '22023';
  end if;

  select r.* into v_r
    from public.content_reports r
   where r.id = p_id
     and r.tenant_id = v_t
     for update;
  if not found then
    raise exception 'content_report_resolve: no such report' using errcode = 'RP002';
  end if;
  if v_r.status <> 'open' then
    raise exception 'content_report_resolve: already resolved' using errcode = 'RP004';
  end if;

  update public.content_reports r
     set status = p_resolution,
         resolved_by_user_id = v_u,
         resolved_at = now()
   where r.id = v_r.id
     and r.tenant_id = v_t;

  return query select v_r.subject_type, v_r.subject_id, v_r.author_user_id;
end
$$;
--> statement-breakpoint
revoke all on function app.content_report_resolve(uuid, text) from public;--> statement-breakpoint
grant execute on function app.content_report_resolve(uuid, text) to authenticated;
--> statement-breakpoint

-- ── app.account_anonymise (replaced) ──────────────────────────────────────────────────────────────────
-- `create or replace` of plan 07's function (`20261105150248_account_deletion_functions.sql`, left untouched): the
-- body is copied verbatim, every statement and the return value unchanged, plus the two statements marked
-- "Phase 13, plan 08" below. The grants of plan 07 (connection role and `service_role` only) are kept by the
-- replace; they are restated so this file states the contract on its own.
create or replace function app.account_anonymise(p_membership uuid)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_m public.memberships%rowtype;
  v_email text;
begin
  if p_membership is null then
    return false;
  end if;

  select m.* into v_m
    from public.memberships m
   where m.id = p_membership
     for update;
  if not found then
    return false;
  end if;

  if v_m.deletion_requested_at is null
     or v_m.anonymised_at is not null
     or v_m.deleted_at is null
     or v_m.deletion_due_at is null
     or v_m.deletion_due_at > now() then
    return false;
  end if;

  select lower(btrim(u.email)) into v_email
    from public.users u
   where u.id = v_m.user_id;

  update public.member_profiles p
     set display_name = 'Membro removido',
         bio = null,
         avatar_asset_id = null,
         updated_at = now()
   where p.tenant_id = v_m.tenant_id
     and p.membership_id = v_m.id;

  update public.media_assets a
     set status = 'deleted',
         deleted_at = coalesce(a.deleted_at, now()),
         filename = null
   where a.tenant_id = v_m.tenant_id
     and a.owner_user_id = v_m.user_id
     and a.purpose = 'avatar';

  delete from public.profile_form_answers a
   where a.tenant_id = v_m.tenant_id
     and a.membership_id = v_m.id;

  delete from public.push_subscriptions s
   where s.tenant_id = v_m.tenant_id
     and s.user_id = v_m.user_id;

  update public.consent_records c
     set ip = null,
         user_agent = null
   where c.tenant_id = v_m.tenant_id
     and c.user_id = v_m.user_id;

  update public.tenant_invites i
     set email = 'removed-' || i.id::text || '@removed.invalid'
   where i.tenant_id = v_m.tenant_id
     and (i.user_id = v_m.user_id or (v_email is not null and lower(i.email::text) = v_email));

  if v_email is not null and v_email <> '' then
    update public.access_grants g
       set email = 'removed-' || g.id::text || '@removed.invalid',
           updated_at = now()
     where g.tenant_id = v_m.tenant_id
       and g.email = v_email;

    update public.payment_events e
       set email = null
     where e.tenant_id = v_m.tenant_id
       and e.email = v_email;
  end if;

  -- Phase 13, plan 08 (NATIVE-31, NATIVE-33): the member's blocks go in BOTH directions (a block of them and a
  -- block by them), and the free text of the reports they filed is nulled. The report itself stays: it is the
  -- evidence an admin may still need, and it carries ids, a reason and a snapshot of the reported text only.
  -- Both statements are scoped by the LOCKED row's tenant, so the same person's rows in another tenant stay.
  delete from public.member_blocks b
   where b.tenant_id = v_m.tenant_id
     and (b.blocker_user_id = v_m.user_id or b.blocked_user_id = v_m.user_id);

  update public.content_reports r
     set note = null
   where r.tenant_id = v_m.tenant_id
     and r.reporter_user_id = v_m.user_id
     and r.note is not null;

  update public.memberships m
     set anonymised_at = now()
   where m.id = v_m.id
     and m.tenant_id = v_m.tenant_id;
  return true;
end
$$;
--> statement-breakpoint
revoke all on function app.account_anonymise(uuid) from public, anon, authenticated;--> statement-breakpoint
grant execute on function app.account_anonymise(uuid) to service_role, api_user;
