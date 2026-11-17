-- chat_voice_gate (12.5-07, VOICE-24; D-858, D-867, D-868; T-12.5-24..27) — the CHAT module gives
-- `app.chat_asset_hidden(p_asset)` its body.
--
-- THE RULE. A voice recording is hidden from the caller when EITHER
--   (a) it is retired (`app.voice_asset_retired`, the definer of `*_chat_asset_gate_seam.sql`: a soft-deleted voice
--       asset of the caller's tenant), so a removed recording stops being served at once; OR
--   (b) it is a LIVE voice asset of the caller's tenant that the caller did not upload AND that no message the caller
--       can read references.
-- So a recording is NOT hidden from its uploader (who plays the take back before sending it), nor from any user who can
-- read a message that carries it: the member, the tenant's staff of a support case, the participants of a direct or a
-- group conversation. It IS hidden from a same-tenant non-participant, from the staff of a direct conversation they are
-- not part of, and (by tenant) from another tenant's user, who sees no row at all. An asset that is not a voice asset,
-- an unknown id or another tenant's id are never hidden by this gate: the route then answers its own bare 404 from the
-- missing Storage key, exactly as it does for an unknown id.
--
-- WHY SECURITY INVOKER (the deliberate departure from the definer posture of `app.course_asset_hidden` and
-- `app.media_asset_hidden`). The chat tables' own policies are the single definition of "can read this message":
-- `chat_messages_select` joins `chat_conversations_select`, which already answers the support case (staff), the
-- participants of a direct or a group conversation (Phase 11) and the creator. An invoker body inherits all of them and
-- cannot drift from them; a definer would have to restate the participant rules and would silently diverge the first time
-- a conversation kind changes. The media row is read under `media_assets_tenant_select` (tenant and not deleted), which
-- is exactly the "live voice asset of the caller's tenant" of (b); the retired case (a) is the one thing the invoker
-- cannot see and is why the definer helper exists.
--
-- FAIL CLOSED. A caller with no `user_id` claim cannot be the uploader and is hidden from every live recording; the
-- body never answers null (both branches are plain booleans), and the media service treats an answer that is not a plain
-- `false` as the bare 404.
--
-- Same signature and OID as the kernel stub (`create or replace`), `language sql stable security invoker`, empty
-- `search_path`, fully qualified names; the revoke and grant of the stub stay in force (this statement keeps the ACL).
-- Expand-only: a function body, no table, column, constraint, index or row changes. It sorts AFTER the stub, and after
-- `*_chat_voice_messages.sql`, whose `media_asset_id` column the `language sql` body is bound to at creation.
--
-- ONE-TASK REVERT: re-apply the stub body (`select false`) with `create or replace`; nothing else depends on this body.

create or replace function app.chat_asset_hidden(p_asset uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select app.voice_asset_retired(p_asset)
      or exists (
           select 1
             from public.media_assets a
            where a.id = p_asset
              and a.tenant_id = app.tenant_id()
              and a.purpose = 'voice'
              and (a.owner_user_id is null or app.user_id() is null or a.owner_user_id <> app.user_id())
              and not exists (
                    select 1
                      from public.chat_messages m
                     where m.tenant_id = app.tenant_id()
                       and m.media_asset_id = a.id
                  )
         )
$$;
