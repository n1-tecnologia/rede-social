-- chat_asset_gate_seam (12.5-07, VOICE-24, VOICE-25; D-858, D-867, D-868) — the KERNEL declares the chat ASSET gate;
-- the chat module gives it a body (`*_chat_voice_gate.sql`).
--
-- WHY. From 12.5 a voice recording is private to the conversation it was sent in: the media route that signs its
-- bytes (`GET /v1/media/{id}/original`, `serveVariant`) must answer the bare 404 of a miss to anybody who could not
-- read the message that carries it. The kernel media service asks ONE read gate before it signs an original
-- (`packages/core/db/course-gate.ts` `courseAssetHidden`, 08.5); this file adds the chat question beside it, with a
-- kernel-owned name (`packages/core/db/chat-gate.ts` `chatAssetHidden`) and no call into a module.
--
-- WHY A SECOND SEAM and not an edit of `app.media_asset_hidden` (D-867, the research's correction of D-858's
-- mechanism). `app.media_asset_hidden` is asked only by the VIDEO playback route, never by `/original`, so extending it
-- would protect nothing; and a feed migration that re-creates its body inlines it, so a later redefinition would
-- silently drop the chat branch. A function of its own, like `app.course_asset_hidden`, survives both (08.5, MOD-02).
--
-- WHY STUBS FIRST. The chat body references `public.chat_messages` and is applied by a chat-owned migration; the kernel
-- seam must exist before it, and in a project that reuses the media kernel without the chat module it must answer
-- "nothing is hidden". So this file declares the function with its neutral answer and sorts BEFORE the chat body, which
-- swaps it with `create or replace` (same signature, same OID):
--   app.chat_asset_hidden(p_asset)    -> false   (no recording hidden by this gate)
-- The stub reads no table. It is SECURITY INVOKER on purpose, like the body that replaces it: the chat tables' own
-- policies must decide who may read a message (D-858), and a definer would have to restate them.
--
-- ALSO HERE (D-868): `app.voice_asset_retired(p_asset)`, a small SECURITY DEFINER. A recording that was soft-deleted
-- (the account-deletion step, the orphan sweep) is invisible to the tenant lane because `media_assets_tenant_select`
-- carries `deleted_at is null`; the gate must still say "hidden" for it, at once and not after the hourly purge, and an
-- invoker body cannot see the row to say so. The function answers only a boolean about the caller's OWN tenant
-- (`app.tenant_id()`), for a `voice` asset, and reads nothing else.
--
-- Hardening (the T-06-29 posture): `search_path = ''`, fully qualified names; EXECUTE revoked from PUBLIC and granted to
-- `authenticated` only. Expand-only: for every existing tenant this file changes nothing a member can observe (the stub
-- hides nothing and no voice asset exists yet).

create or replace function app.chat_asset_hidden(p_asset uuid) returns boolean
language sql stable security invoker set search_path = '' as $$ select false $$;
--> statement-breakpoint
create or replace function app.voice_asset_retired(p_asset uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.media_assets a
     where a.id = p_asset
       and a.tenant_id = app.tenant_id()
       and a.purpose = 'voice'
       and a.deleted_at is not null
  )
$$;
--> statement-breakpoint
revoke all on function app.chat_asset_hidden(uuid) from public;--> statement-breakpoint
revoke all on function app.voice_asset_retired(uuid) from public;--> statement-breakpoint
grant execute on function app.chat_asset_hidden(uuid) to authenticated;--> statement-breakpoint
grant execute on function app.voice_asset_retired(uuid) to authenticated;
