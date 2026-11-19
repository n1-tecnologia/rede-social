-- direct_notice (Phase 11 plan 06, CHAT-06; D-728, D-731; T-11-01, T-11-02, T-11-08) — `app.direct_message_notice`, the
-- ONE way the notifications worker reads what a direct-message push needs. Hand-written (`--custom`); expand-only: a new
-- function, no table, column, constraint or index change, and `chat_conversations_select` is NOT widened for staff or the
-- worker (a push reads the message through this definer, never through RLS).
--
-- WHO. A claims-pinned security definer that answers ONLY the notifications worker: the lane the worker opens carries the
-- tenant claim and the zero system user (`00000000-0000-0000-0000-000000000000`, the same guard as
-- `app.dashboard_build_snapshot` and `app.social_pair_open`). Every other caller (a member, an administrator, a support
-- member, a lane with no claims) is refused 42501, so no role can read a direct message's text through it (T-11-02).
--
-- WHAT. For a message of a PAIRED direct of the claim's tenant it answers one row, otherwise zero rows (a support case, a
-- bare direct, a group, a deleted message, an unknown id and another tenant's message are all the same empty answer):
--   recipient_user_id  the pair member that is not the author
--   writer_user_id     the author
--   writer_name        the author's live profile display name (null when it has none)
--   body               the text (null for a recording)
--   voice_seconds      the stored length of a recording (null for text)
--   voice_gone         the recording's asset is no longer a live row (the worker pushes nothing, and no length leaks)
--   deliverable        `app.pair_open_in(tenant, low, high)` RECOMPUTED now: a pair that became blocked, removed or
--                      social-off after the enqueue is not pushed (T-11-08)
-- Every statement pins `app.tenant_id()` (the owner bypasses RLS, so the pin is the function's own, T-11-01).
create or replace function app.direct_message_notice(p_message uuid)
returns table (
  recipient_user_id uuid,
  writer_user_id uuid,
  writer_name text,
  body text,
  voice_seconds integer,
  voice_gone boolean,
  deliverable boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
begin
  if v_t is null
     or app.user_id() is distinct from '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'direct_message_notice: system lane only' using errcode = '42501';
  end if;

  return query
  select case when m.author_user_id = c.direct_low_user_id then c.direct_high_user_id
              else c.direct_low_user_id end,
         m.author_user_id,
         mp.display_name,
         m.body,
         m.voice_seconds::integer,
         (m.media_asset_id is not null
          and not exists (
            select 1
              from public.media_assets va
             where va.id = m.media_asset_id
               and va.tenant_id = v_t
               and va.deleted_at is null)),
         app.pair_open_in(v_t, c.direct_low_user_id, c.direct_high_user_id)
    from public.chat_messages m
    join public.chat_conversations c
      on c.id = m.conversation_id
     and c.tenant_id = m.tenant_id
    left join public.memberships ms
           on ms.tenant_id = m.tenant_id
          and ms.user_id = m.author_user_id
          and ms.deleted_at is null
    left join public.member_profiles mp
           on mp.membership_id = ms.id
          and mp.tenant_id = m.tenant_id
   where m.id = p_message
     and m.tenant_id = v_t
     and m.deleted_at is null
     and c.kind = 'direct'
     and c.direct_low_user_id is not null;
end
$$;
--> statement-breakpoint
revoke all on function app.direct_message_notice(uuid) from public, anon;--> statement-breakpoint
grant execute on function app.direct_message_notice(uuid) to authenticated;
