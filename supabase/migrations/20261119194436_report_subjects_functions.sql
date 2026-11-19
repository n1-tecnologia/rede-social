-- report_subjects_functions (Phase 11 plan 09, MODER-05; D-730, D-731; T-11-01, T-11-09, T-11-23) — `app.content_report_create`
-- REPLACED from its newest body (`20261105152916_reports_blocks_functions.sql`) with four new branches inside the same
-- claims-pinned switch. Hand-written (`--custom`): drizzle-kit cannot model functions. Sorted AFTER `*_report_subjects.sql`,
-- which adds the widened subject CHECK and the two voice columns this body writes (a `plpgsql` body binds columns at run
-- time, but the first call must find them).
--
-- WHAT STAYS. The signature, the grants, `security definer`, `set search_path = ''`, the claims pinning (the tenant and the
-- caller come from the claims, never from an argument), the live-caller guard (42501), the live predicate of every subject
-- (`deleted_at is null`), the author snapshot, the first 280 CODE POINTS of the text (`left` counts characters, so a surrogate
-- pair or a combining sequence is never cut inside a code point), the empty note stored as null, the unknown type 22023, the
-- own-item refusal RP001 and the missing / deleted / other-tenant refusal RP002 (one code, so the API is no existence oracle).
-- `content_report_resolve` is not touched: it already returns `(subject_type, subject_id, author_user_id)` for ANY type, so
-- "Bloquear autor" for every new subject needs no new SQL.
--
-- THE FOUR NEW BRANCHES (each resolves the subject in the CALLER'S tenant; a definer bypasses RLS, so each restates the
-- predicate the policies would apply):
--   story          author `stories.author_user_id`, text the caption (the empty string for a story with no caption).
--   story_comment  a `feed_comments` row with `story_id` NOT null and `target_kind = 'story'` (a comment on a POST is never one).
--   community      author `communities.created_by_user_id`, text the name, a line break and the description, or the name ALONE
--                  when the description is empty. An organization community is reportable too (AD-1).
--   direct_message the reporter is one of the two users of a PAIRED direct (`direct_low_user_id` set, the reporter is the low or
--                  the high one), the message exists in the caller's tenant, is not deleted, and `app.direct_pair_readable` holds
--                  (`social` on, both sides live or anonymised). Any other message (a support case's, another pair's, another
--                  tenant's) is not found: RP002. The author must be the OTHER side; one's own message is RP001. For a
--                  recording the asset must still be live (`deleted_at is null`): a retired one is RP002 after the own-item check
--                  (there is nothing to judge).
--
-- D-731 (a message report stores only the message). The row gets the text of a text message as its excerpt, and for a recording
-- `excerpt = ''` plus the asset id and the stored length: a REFERENCE to the existing asset, not a second file. NO column, row
-- or function stores the conversation id, the counterpart or any other message. The recording is audible to the administrator
-- only through this row (`*_report_voice_gate.sql`).
--
-- EXPAND-ONLY: a function body replaced with `create or replace` (same signature and OID, so the ACL stays; the revoke and the
-- grant are repeated below anyway). Nothing else changes.
-- ONE-TASK REVERT: re-apply the Phase 13 body from `20261105152916_reports_blocks_functions.sql`; reports of the new types that
-- exist by then stay readable (the CHECK stays wide, D-730).

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
  v_asset uuid;
  v_seconds smallint;
  v_retired boolean := false;
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
  elsif p_subject_type = 'story' then
    select s.author_user_id, s.caption into v_author, v_text
      from public.stories s
     where s.id = p_subject_id
       and s.tenant_id = v_t
       and s.deleted_at is null;
  elsif p_subject_type = 'story_comment' then
    select c.author_user_id, c.body into v_author, v_text
      from public.feed_comments c
     where c.id = p_subject_id
       and c.tenant_id = v_t
       and c.story_id is not null
       and c.target_kind = 'story'
       and c.deleted_at is null;
  elsif p_subject_type = 'community' then
    select c.created_by_user_id,
           case when c.description = '' then c.name else c.name || E'\n' || c.description end
      into v_author, v_text
      from public.communities c
     where c.id = p_subject_id
       and c.tenant_id = v_t
       and c.deleted_at is null;
  elsif p_subject_type = 'direct_message' then
    -- The reporter must be one of the two users of a PAIRED direct of the caller's tenant and the pair must be readable;
    -- the author is the other side (or the reporter, which is RP001 below). A recording keeps its asset and length.
    select m.author_user_id,
           coalesce(m.body, ''),
           m.media_asset_id,
           m.voice_seconds,
           m.media_asset_id is not null
             and not exists (
               select 1
                 from public.media_assets a
                where a.id = m.media_asset_id
                  and a.tenant_id = v_t
                  and a.deleted_at is null)
      into v_author, v_text, v_asset, v_seconds, v_retired
      from public.chat_messages m
      join public.chat_conversations c
        on c.id = m.conversation_id
       and c.tenant_id = m.tenant_id
     where m.id = p_subject_id
       and m.tenant_id = v_t
       and m.deleted_at is null
       and c.kind = 'direct'
       and c.direct_low_user_id is not null
       and v_u in (c.direct_low_user_id, c.direct_high_user_id)
       and m.author_user_id in (c.direct_low_user_id, c.direct_high_user_id)
       and app.direct_pair_readable(c.direct_low_user_id, c.direct_high_user_id);
  else
    raise exception 'content_report_create: unknown subject type' using errcode = '22023';
  end if;
  if v_author is null then
    raise exception 'content_report_create: no such subject' using errcode = 'RP002';
  end if;
  if v_author = v_u then
    raise exception 'content_report_create: own content' using errcode = 'RP001';
  end if;
  if v_retired then
    raise exception 'content_report_create: no such subject' using errcode = 'RP002';
  end if;

  insert into public.content_reports (
    tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, note, excerpt,
    media_asset_id, voice_seconds
  ) values (
    v_t, v_u, p_subject_type, p_subject_id, v_author, p_reason, nullif(p_note, ''),
    left(coalesce(v_text, ''), 280), v_asset, v_seconds
  )
  returning id into v_id;
  return v_id;
end
$$;
--> statement-breakpoint
revoke all on function app.content_report_create(text, uuid, text, text) from public;--> statement-breakpoint
grant execute on function app.content_report_create(text, uuid, text, text) to authenticated;
