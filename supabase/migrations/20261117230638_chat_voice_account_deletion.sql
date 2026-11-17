-- chat_voice_account_deletion (Phase 12.5 plan 08, VOICE-37; D-868; T-12.5-34, T-12.5-35) — a deleted or anonymised
-- member's voice recordings go with the account (Igor, 2026-11-17), hand-written (`--custom`): drizzle-kit cannot model
-- functions. This is a `create or replace` of the anonymisation step as `20261105152916_reports_blocks_functions.sql` left it
-- (that file replaced the Phase 13 plan 07 original with the member blocks and the report notes steps, and stays untouched);
-- the body below is that one CHARACTER FOR CHARACTER with ONE statement added, right after the avatar step: the member's
-- `voice` assets (owner = the locked membership's user, tenant = the locked row's tenant) get `status = 'deleted'`,
-- `deleted_at = coalesce(a.deleted_at, now())` and `filename = null`. Nothing is reordered, no literal is edited and no
-- step is dropped; the verify command of the plan diffs the two bodies before this file is applied.
--
-- WHAT THE MEMBER'S THREAD READS AFTERWARDS (D-868). The message row stays with its `media_asset_id` and `voice_seconds` (no
-- message is ever deleted, D-609), the message projection answers `voice.deleted: true` because the asset is soft-deleted,
-- the bubble reads "Mensagem de voz apagada", the recording is no longer served (the read gate's retired helper answers
-- hidden at once) and its Storage object is purged by the kernel's hourly sweeper (an hour after the soft delete). This is a
-- system action, not a delete button (D-859 stands).
--
-- THE PRIVACY INVENTORY, refreshed. Erased in place: the profile name, bio and photo, the form answers, the push devices, the
-- consent ip and browser, the invite and grant and payment e-mail addresses, the member's blocks, the report notes the member
-- filed, and (new) the member's voice recordings. The old "residual" line about chat message bodies still holds for TEXT:
-- a chat text body stays as written; only the recording, which is the member's voice, goes.
--
-- Grants: re-stated below exactly as the original gave them (the connection role and `service_role` only), so the file
-- states its own contract; `create or replace` keeps them anyway.

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

  -- Phase 12.5, plan 08 (VOICE-37, D-868): the member's chat recordings go the same way as the avatar, in the same step:
  -- every `voice` asset of the member in the LOCKED row's tenant (sent or not, never another tenant's, never another
  -- member's) is soft-deleted and its file name blanked. The message row stays with its asset id and its seconds and reads
  -- "Mensagem de voz apagada"; the read gate stops serving the recording at once (`app.voice_asset_retired`) and the hourly
  -- sweeper purges the Storage object.
  update public.media_assets a
     set status = 'deleted',
         deleted_at = coalesce(a.deleted_at, now()),
         filename = null
   where a.tenant_id = v_m.tenant_id
     and a.owner_user_id = v_m.user_id
     and a.purpose = 'voice';

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
