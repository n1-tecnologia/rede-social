-- notifications_retract (07-04) — keep-and-mark retraction of a deleted target's notification rows
-- (CONTEXT Claude's Discretion, decided in 07-04 planning decision 1).
--
-- WHEN A POST, COMMENT, STORY OR STORY COMMENT IS DELETED, its rows are KEPT and MARKED: the payload
-- is replaced WHOLESALE with `{"removed": true}`, so the excerpt, the community name, the preview id
-- and every other fact are gone, while the row keeps its place in the member's list and renders
-- "Este conteúdo foi removido." (UI-D-251). A notification must never keep showing, storing or pushing
-- the text of content its author or a moderator took down. No new column: `removed` is a payload key
-- (SCHEMA-CONVENTIONS: no boolean for a state a payload already carries).
--
-- The vocabulary (planning decision 2): comment kinds carry `subject (post, postId)` and `object
-- (comment, commentId)`; story kinds carry `subject (story, storyId)` and story comments add `object
-- (story_comment, commentId)`. So a deleted POST retracts on the subject (every row about the post:
-- the post, like and reply kinds), and a deleted COMMENT retracts on the object (only the rows about
-- that one comment).
--
-- WHY A SECURITY DEFINER FUNCTION (the `notifications_fanout` rule restated): the table's policies
-- are owner-only, and the fan-out worker's system lane owns no row, so a lane UPDATE would touch
-- nothing. PITFALL 2: the owner is `postgres` (`rolbypassrls`), so RLS protects NOTHING in here and
-- the statement scopes `tenant_id = app.tenant_id()` itself; a lane without a tenant claim is refused
-- (42501). The same subject id in another tenant is never touched (T-07-21, pgTAP 151 fact 10).
--
-- IDEMPOTENT: a row already marked is skipped, so a retried job changes nothing twice. Returns the
-- number of rows it marked.
--
-- Hardening: `set search_path = ''`, fully qualified names, `revoke all … from public`, `grant
-- execute … to authenticated` only (the worker's tenant lane). `app` is not PostgREST-exposed.

create or replace function app.notifications_retract(p_on text, p_type text, p_id uuid)
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_t uuid := app.tenant_id();
  v_n int;
begin
  if v_t is null or p_on is null or p_on not in ('subject', 'object') then
    raise exception 'notifications_retract: refused' using errcode = '42501';
  end if;

  update public.notifications n
     set payload = '{"removed": true}'::jsonb
   where n.tenant_id = v_t
     and (
       (p_on = 'subject' and n.subject_type = p_type and n.subject_id = p_id)
       or (p_on = 'object' and n.object_type = p_type and n.object_id = p_id)
     )
     and coalesce(n.payload->>'removed', '') <> 'true';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
--> statement-breakpoint
revoke all on function app.notifications_retract(text, text, uuid) from public;--> statement-breakpoint
grant execute on function app.notifications_retract(text, text, uuid) to authenticated;
