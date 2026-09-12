-- Runtime DB role for the API. No password here: the local credential is set by scripts/db-local-role.sh,
-- the hosted one by CI (`alter role api_user with login password :'pw'`). Applied with
-- `supabase db push --include-roles`; the app_helpers migration repeats this block idempotently.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'api_user') then
    create role api_user nologin nobypassrls noinherit;
  end if;
end $$;
grant authenticated to api_user;   -- allows SET LOCAL ROLE authenticated (tenant lane)
grant service_role to api_user;    -- allows SET LOCAL ROLE service_role (admin lane)
