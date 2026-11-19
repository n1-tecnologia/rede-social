-- report_voice_gate (Phase 11 plan 09, MODER-05; D-731, D-858, D-867, D-868; T-11-09, T-11-10) — `app.chat_asset_hidden` REPLACED from its
-- newest body (`20261117223747_chat_voice_gate.sql`; `20261117223744_chat_asset_gate_seam.sql` holds the stub and the retired helper)
-- with ONE more clause: a recording is also NOT hidden from a caller who can read a report of the tenant that carries it.
--
-- THE RULE after this file. A voice recording is hidden from the caller when EITHER
--   (a) it is retired (`app.voice_asset_retired`, unchanged): a soft-deleted voice asset of the caller's tenant, hidden from EVERY
--       caller at once, the administrator and the reporter included (D-868; a report keeps a REFERENCE to the asset, so the copy
--       lives as long as the recording does and reads as gone once it is retired); OR
--   (b) it is a LIVE voice asset of the caller's tenant that the caller did not upload AND that no message the caller can read
--       references AND that no `content_reports` row the caller can read carries (this file's clause).
--
-- WHY THE REPORT CLAUSE (D-731). A reported voice message stores the asset id and its stored length on the report row, not the
-- conversation. The administrator reads no chat row of a direct conversation, so without this clause the report would carry a
-- recording nobody could play. With it the administrator hears the recording ONLY through its report, never through any
-- conversation row: a third member, the support staff and another tenant's user stay exactly as they were.
--
-- WHY THE INVOKER STAYS THE ANSWER. The body stays SECURITY INVOKER, so the invoker policy `content_reports_select` (the reporter's
-- own rows and, for `admin_tenant`, every row of the tenant, always `tenant_id = app.tenant_id()`) is the single definition of
-- "can this caller read a report of it". A definer would have to restate that rule and would silently diverge from it. The
-- clause also repeats `r.tenant_id = a.tenant_id`, so a row of another tenant that names the id (which the policy already hides)
-- could never unhide a recording of this one. It is a plain boolean, no null: a caller with no `user_id` claim reads no report and
-- stays hidden (fail closed).
--
-- Same signature and OID as the Phase 12.5 body (`create or replace`), `language sql stable security invoker set search_path = ''`,
-- fully qualified names; the revoke and the grant of the stub stay in force. Expand-only: a function body, no table, column,
-- constraint, index or row changes. It sorts AFTER `*_report_subjects.sql`, whose `media_asset_id` column the `language sql` body is
-- bound to at creation, and after the chat gate body it replaces.
--
-- ONE-TASK REVERT: re-apply the body of `20261117223747_chat_voice_gate.sql` with `create or replace`.

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
              and not exists (
                    select 1
                      from public.content_reports r
                     where r.tenant_id = a.tenant_id
                       and r.media_asset_id = a.id
                  )
         )
$$;
