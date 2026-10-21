-- Who would the production Auth hooks lock out?  (plan 09.1-18, PAY-28, closes WR-01 of quick 261018-owq)
--
-- WHAT IT ANSWERS
--   Before a human flips `enabled = false` to `true` in [remotes.production.auth.hook.*] of
--   supabase/config.toml, this report says which accounts the REAL custom_access_token hook would refuse
--   a token to, and which tenants have the payment gate on.
--
-- HOW TO USE IT (human step, docs/DEPLOY.md "Phase 09.1 release", "Enabling the production Auth hooks")
--   Run it in the Supabase SQL editor of the hosted project, after the Phase 09.1 migrations are pushed
--   (it needs public.hook_custom_access_token_allowlist as replaced by 20261020230440_access_hooks.sql).
--   * `locked_out` rows:  each is an account whose call to the real hook answers an `error`. An EMPTY
--     `locked_out` list is the go signal. Every row that is listed must be someone the owner intends to
--     refuse (a member cut in their only gated tenant, an account with no membership and no access).
--   * `gate_on` rows:     the tenants whose payments module is enabled with settings.gate = true. Review
--     them: those are the only tenants where the hook can refuse a member at all.
--   The e-mails in `detail` are internal; do not paste the result into a ticket.
--
-- WHY IT CALLS THE REAL FUNCTION
--   A re-implementation of the hook's predicate here would drift from the hook. Calling
--   public.hook_custom_access_token_allowlist once per account asks the only question that matters:
--   "would GoTrue refuse this person". The event is built like GoTrue's: the user id and a claims object
--   carrying the e-mail (the hook reads event->>'user_id' and event->'claims'->>'email').
--
-- READ-ONLY, ONE STATEMENT
--   One SELECT, no write of any kind; the function it calls is `stable`. Columns: finding, ref, detail.
--   Rows are ordered by finding, then detail, then ref, so two runs print the same rows.
--   The gate is read the way the API and the hook read it (public tenant_modules row for the module
--   `payments`, enabled, settings -> 'gate' equal to the JSON boolean true: the text "true" is not a gate).
--   An empty auth.users set returns no locked_out row and no error.

select 'locked_out' as finding,
       u.id::text as ref,
       coalesce(u.email, '') as detail
  from auth.users u
 where (public.hook_custom_access_token_allowlist(
          jsonb_build_object(
            'user_id', u.id::text,
            'claims', jsonb_build_object('email', u.email)
          )
        ) -> 'error') is not null
union all
select 'gate_on',
       t.id::text,
       t.slug::text
  from public.tenants t
  join public.tenant_modules tm
    on tm.tenant_id = t.id
   and tm.module_key = 'payments'
   and tm.enabled
   and tm.settings -> 'gate' = 'true'::jsonb
 order by 1, 3, 2;
