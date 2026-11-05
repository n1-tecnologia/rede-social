-- profile_form_steps_backfill (Phase 12.1-06, PFORM-27, PFORM-40; D-627; T-12.1-14) —
-- every question of the profile form lives in exactly one step. This custom migration makes that true for the rows
-- that already exist (Phase 12 has been live since 2026-11-02) and for the rows still being written by the API revision
-- that is serving while the fan-out runs. Its generated companion `20261105194320_profile_form_steps.sql` created the
-- `profile_form_steps` table and added `step_id` NULLABLE; the functions and the guard are the next file,
-- `*_profile_form_steps_functions.sql`.
--
-- ── ORDER (it is the point of this file) ────────────────────────────────────────────────────────────
--   1. The BEFORE INSERT trigger first. From here on a question inserted WITHOUT a step (by the previous API revision,
--      by `seedProfileFormQuestion` or by the Phase 12 pgTAP fixtures) is put in the tenant's first step, and the
--      first step is created when the tenant has none. A per-tenant transaction-scoped advisory lock makes two
--      concurrent inserts create ONE default step, not two.
--   2. The backfill second: one default step per tenant that already has questions and no step yet, then every
--      question without a step is pointed at the tenant's first step by (position, created_at, id), archived
--      questions included. The `not exists` guards make a re-run a no-op, and a tenant with no question gets no step.
--   3. `SET NOT NULL` last: it can only succeed once the backfill has run, and a row inserted after the trigger cannot
--      be null.
--   4. `revoke truncate` on the steps table: TRUNCATE is not subject to row-level security and Supabase's default
--      privileges hand it to every lane (the Phase 12 precedent, `20261029233037_profile_form_functions.sql`).
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- EXPAND-ONLY and fan-out safe: one trigger function, one trigger, rows added to the new steps table, one column made
-- NOT NULL after its backfill; nothing dropped, no question or answer moved, renamed or discarded, no begin, commit
-- or concurrent index build and no reference to the platform schema (the tenant-set guard enforces it).
-- The title written below is data in every tenant project: the developer confirmed it before this file was written
-- (checkpoint of plan 12.1-06). After release it is an ordinary step title the admin can rename.

create or replace function app.profile_form_default_step()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.step_id is null then
    -- One default step per tenant even when two inserts race: the lock is held until the transaction ends.
    perform pg_advisory_xact_lock(hashtextextended('profile_form_steps:' || new.tenant_id::text, 0));

    select s.id
      into new.step_id
      from public.profile_form_steps s
     where s.tenant_id = new.tenant_id
     order by s."position", s.created_at, s.id
     limit 1;

    if new.step_id is null then
      insert into public.profile_form_steps (tenant_id, title, "position")
      values (new.tenant_id, 'Informações gerais', 1)
      returning id into new.step_id;
    end if;
  end if;

  return new;
end
$$;
--> statement-breakpoint
create trigger profile_form_questions_default_step
  before insert on public.profile_form_questions
  for each row execute function app.profile_form_default_step();
--> statement-breakpoint
revoke all on function app.profile_form_default_step() from public;
--> statement-breakpoint
insert into public.profile_form_steps (tenant_id, title, "position")
select distinct q.tenant_id, 'Informações gerais', 1
  from public.profile_form_questions q
 where not exists (
         select 1
           from public.profile_form_steps s
          where s.tenant_id = q.tenant_id
       );
--> statement-breakpoint
update public.profile_form_questions q
   set step_id = (
         select s.id
           from public.profile_form_steps s
          where s.tenant_id = q.tenant_id
          order by s."position", s.created_at, s.id
          limit 1
       )
 where q.step_id is null;
--> statement-breakpoint
alter table public.profile_form_questions alter column step_id set not null;
--> statement-breakpoint
revoke truncate on public.profile_form_steps from authenticated;
