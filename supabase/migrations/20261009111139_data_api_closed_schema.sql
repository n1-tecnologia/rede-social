-- data_api_closed_schema (quick 261009-8fz, CR-01 of the 08.2 review) — hand-written (`--custom`).
--
-- `[api] schemas` in supabase/config.toml exposes only this schema, so the Supabase Data API
-- (PostgREST /rest/v1 and the /graphql/v1 route) serves nothing: every table, RPC and profile request
-- is refused before it reaches SQL. The API is the only data client; `public` stays unexposed and off
-- the request search path.
--
-- This schema must never hold an object (table, view, function, type) or a grant: anything placed
-- here would be served to any holder of the publishable key. apps/api/tests/integration/
-- data-api-not-exposed.test.ts pins its emptiness and its privileges. deploy-api.yml applies this
-- migration ("Migrations", `supabase db push`) before its `supabase config push`, so the schema
-- exists before the hosted Data API is pointed at it.
--
-- A plain `create schema` (no `if not exists`): a pre-existing schema of this name on any project
-- must fail loudly, never be adopted. The revoke is a no-op on a fresh schema and pins owner-only
-- privileges against hosted default differences.

create schema data_api_closed;--> statement-breakpoint
comment on schema data_api_closed is 'Intentionally empty; the only schema the Supabase Data API exposes. Never add objects or grants (quick 261009-8fz).';--> statement-breakpoint
revoke all on schema data_api_closed from public, anon, authenticated, service_role;
