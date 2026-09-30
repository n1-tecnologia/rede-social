-- notifications_functions (07-01) — the ONLY writer of `public.notifications` rows (NOTIF-01; RESEARCH
-- Pattern 6, planning decision 4). Its companions `*_notifications.sql` / `*_notifications_drop_event_id.sql`
-- are the GENERATED half (the reshaped table, its indexes and its owner-only policies).
--
-- WHY A SECURITY DEFINER FUNCTION. The table's policies are owner-only (`tenant_id = app.tenant_id()
-- and user_id = app.user_id()`), and there is NO insert policy. The fan-out runs in the worker's
-- system lane (a synthetic, never-real user of the event's tenant), so a tenant-lane
-- `insert … returning` would be refused, and the `returning user_id` set is exactly what the caller
-- needs: only NEWLY inserted recipients are signalled (and, in 07-06, pushed), so a retried job
-- re-signals nobody.
--
-- PITFALL 2 (the check-in precedent): the owner is `postgres`, which has `rolbypassrls`. RLS
-- protects NOTHING in here, so every statement scopes `tenant_id` to `app.tenant_id()` itself, and a
-- lane without a tenant claim is refused (42501). A forged tenant id in a job payload can therefore
-- only write rows for THAT tenant's own live members (T-07-05). `supabase/tests/151-notifications.sql`
-- proves the scoping with a cross-tenant `users` audience and a positive control.
--
-- THE LIVE PREDICATE (D-229): `status = 'active'`, `blocked_at is null`, `deleted_at is null`, and for
-- the `members` audience `role = 'member'` (staff never get the broadcast kinds). The excluded ids (the
-- author/actor) are always removed. A `users` audience is filtered by the SAME live predicate, of any
-- role, and only within the caller's tenant.
--
-- IDEMPOTENT: `on conflict (tenant_id, user_id, dedupe_key) do nothing`. One statement per intent, so
-- every row of one fan-out shares one `created_at` (the list orders ties by `id desc`). Chunking past
-- ~5k members is not built (RESEARCH Pattern 6).
--
-- Hardening: `set search_path = ''`, fully qualified names, `#variable_conflict use_column` (the OUT
-- column `user_id` must not shadow the tables' own), `revoke all … from public`, `grant execute … to
-- authenticated` only. `app` is not a PostgREST-exposed schema, so this is not RPC-reachable.

create or replace function app.notifications_fanout(
  p_audience text,
  p_user_ids uuid[],
  p_exclude uuid[],
  p_kind text,
  p_dedupe text,
  p_subject_type text,
  p_subject_id uuid,
  p_object_type text,
  p_object_id uuid,
  p_actor uuid,
  p_payload jsonb
)
returns table (user_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_t uuid := app.tenant_id();
begin
  if v_t is null or p_audience is null or p_audience not in ('members', 'users') then
    raise exception 'notifications_fanout: refused' using errcode = '42501';
  end if;

  return query
  with inserted as (
    insert into public.notifications as n (
      tenant_id, user_id, kind, payload, dedupe_key,
      subject_type, subject_id, object_type, object_id, actor_user_id
    )
    select m.tenant_id, m.user_id, p_kind, coalesce(p_payload, '{}'::jsonb), p_dedupe,
           p_subject_type, p_subject_id, p_object_type, p_object_id, p_actor
      from public.memberships m
     where m.tenant_id = v_t
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
       and (
         (p_audience = 'members' and m.role = 'member')
         or (p_audience = 'users' and m.user_id = any(coalesce(p_user_ids, '{}'::uuid[])))
       )
       and m.user_id <> all(coalesce(p_exclude, '{}'::uuid[]))
    on conflict (tenant_id, user_id, dedupe_key) do nothing
    returning n.user_id
  )
  select inserted.user_id from inserted;
end
$$;
--> statement-breakpoint
revoke all on function app.notifications_fanout(text, uuid[], uuid[], text, text, text, uuid, text, uuid, uuid, jsonb) from public;--> statement-breakpoint
grant execute on function app.notifications_fanout(text, uuid[], uuid[], text, text, text, uuid, text, uuid, uuid, jsonb) to authenticated;
