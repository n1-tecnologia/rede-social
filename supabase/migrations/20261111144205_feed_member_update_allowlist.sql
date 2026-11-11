-- feed_member_update_allowlist (10-03, MPUB-04, MPUB-07; D-473, D-702, T-10-05; closes the Phase 9 advisory) —
-- `app.feed_posts_member_update_guard()` rewritten from a DENY-LIST of four columns to an ALLOW-LIST.
--
-- WHY. `20261020123631_feed_member_update_guard.sql` refused a member author only for `author_user_id`,
-- `visibility`, `community_id` and `tenant_id`; every other column was open, so an author could clear
-- `deleted_at` (resurrecting a post a moderator took down) or rewrite `deleted_by_user_id`. With the third
-- audience (`'community'`) the number of columns a forged update could aim at grows, so the guard now names
-- what a member MAY change and refuses everything else.
--
-- THE RULE for a `member` claim (staff and system lanes are not held: the function returns NEW at once):
--   * on a post it did NOT write (`OLD.author_user_id` distinct from `app.user_id()`, which also covers a null
--     user): only `like_count` and `comment_count` may change. UNCHANGED from the deny-list version;
--   * `author_user_id`, `visibility`, `community_id` and `tenant_id` may not change on ANY post: the explicit
--     check of the old guard is KEPT as a second line (now redundant with the allow-list);
--   * on a post it DID write, the columns that may change are exactly the ones `updatePost` writes (`caption`,
--     `media_kind`, `link_preview_id`, `edited_at`) and the two counter columns the counter triggers write as
--     the invoker (`like_count`, `comment_count`). The soft delete the service writes (`deleted_at = now()`,
--     `deleted_by_user_id = <the author>`, never one without the other) is allowed ONLY as that transition, from
--     a live post to a deleted one stamped with the caller. Clearing `deleted_at`, changing `deleted_at` or
--     `deleted_by_user_id` on its own, stamping another user, and every other column (`id`, `created_at`, ...)
--     raise 42501.
-- A violation raises SQLSTATE 42501 with a fixed message that names no row data.
--
-- SECURITY INVOKER (the default, said here on purpose), `language plpgsql`, `set search_path = ''`, fully
-- qualified names, no single-row pick clause: SAME signature and attributes as before, so the trigger
-- `feed_posts_member_update_guard` and its grants are untouched (`create or replace` keeps the OID).
-- Expand-only: one function body replaced, no table, no column, no row touched.

create or replace function app.feed_posts_member_update_guard() returns trigger
  language plpgsql set search_path = '' as $$
declare
  -- the columns `updatePost` writes plus the counters (`like_count`, `comment_count`) other triggers move
  v_allow constant text[] := array['caption', 'media_kind', 'link_preview_id', 'edited_at', 'like_count', 'comment_count'];
  -- the soft delete pair, judged as a transition below, never as two free columns
  v_delete constant text[] := array['deleted_at', 'deleted_by_user_id'];
begin
  if coalesce(app.tenant_role(), '') <> 'member' then
    return new;
  end if;

  if old.author_user_id is distinct from app.user_id()
     and (to_jsonb(new) - array['like_count', 'comment_count'])
         is distinct from (to_jsonb(old) - array['like_count', 'comment_count']) then
    raise exception 'a member may only move the counters of a post it did not write'
      using errcode = '42501';
  end if;

  if new.author_user_id is distinct from old.author_user_id
     or new.visibility is distinct from old.visibility
     or new.community_id is distinct from old.community_id
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'a member may not change the author, audience, community or tenant of a post'
      using errcode = '42501';
  end if;

  -- the allow-list: any column outside it (and outside the soft-delete pair) must be unchanged
  if (to_jsonb(new) - v_allow - v_delete) is distinct from (to_jsonb(old) - v_allow - v_delete) then
    raise exception 'a member author may change only the allow-listed columns of a post'
      using errcode = '42501';
  end if;

  -- the soft-delete pair: unchanged, or exactly the service's transition (live -> deleted by the caller)
  if (new.deleted_at is distinct from old.deleted_at
      or new.deleted_by_user_id is distinct from old.deleted_by_user_id)
     and not (old.deleted_at is null
              and new.deleted_at is not null
              and new.deleted_by_user_id is not distinct from app.user_id()) then
    raise exception 'a member author may change only the allow-listed columns of a post'
      using errcode = '42501';
  end if;

  return new;
end
$$;
