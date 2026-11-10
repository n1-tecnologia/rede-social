-- profile_form_professional_id_guard (quick 261110-ij7; D-587, D-591) — hand-written (`--custom`), applied right after its generated companion
-- `*_profile_form_professional_id.sql`, which widened the type CHECK to 14 names.
--
-- ADDITIVE: one new function and one new trigger. It does NOT restate the long `app.profile_form_question_guard()` function (the 12.2 version of
-- that body stays exactly as it is), so no older API revision is affected and nothing in PF001..PF010 changes.
--
-- WHAT IT ENFORCES. The mask of a professional_id question (`limits.format`) is part of what its stored answers mean: an answer saved as
-- 'CRO-SP 123456' stops being valid if the question turns into a CNPJ. Once the question has at least one answer, changing `limits.format` raises
-- PF005, the SAME SQLSTATE `guardIssueOf` already maps to `limits_locked`, so the race path answers the same coded 409 as the service rule
-- (`checkLocks`, D-587). A never-answered question may change its format; an update that leaves the format as it is (a title edit, a limits write
-- that repeats the format) passes. The trigger fires only on `update of limits`.
--
-- ORDER. Row triggers of one event fire in name order. `profile_form_questions_guard_format` sorts AFTER `profile_form_questions_guard`, so when one
-- update breaks both (the type changed AND the format changed) the existing guard speaks first with PF001, the same order the service uses.
--
-- SECURITY DEFINER with an empty search_path, every object fully qualified (the answers table is read under the owner's rights, not the caller's
-- row-level security). EXECUTE is revoked from PUBLIC like every function of this family; a trigger function needs no grant to fire.
create or replace function app.profile_form_format_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.type = 'professional_id'
     and (old.limits -> 'format') is distinct from (new.limits -> 'format')
     and exists (
       select 1
       from public.profile_form_answers a
       where a.tenant_id = old.tenant_id
         and a.question_id = old.id
     ) then
    raise exception 'profile form question % has answers: its format cannot change', old.id
      using errcode = 'PF005';
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger profile_form_questions_guard_format
  before update of limits on public.profile_form_questions
  for each row execute function app.profile_form_format_guard();
--> statement-breakpoint
revoke all on function app.profile_form_format_guard() from public;
