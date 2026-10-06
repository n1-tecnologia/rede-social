-- identity_has_password (08.1-06, V2-PLAT-07, D-314) — one fact about an identity: does it already
-- have a password? Custom migration (drizzle-kit cannot model a function over `auth.users`).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
-- D-314: a person who already has an identity (a member of another community) is invited to
-- administer a new one. An identity WITH a password gets the tokenless app-mailed invite ("use a
-- senha que você já tem", a plain link to the tenant's `/entrar`) and the accept screen skips the
-- password step; an identity WITHOUT one (a still-unaccepted invite, never set a password) keeps the
-- GoTrue path whose link lets them set it (WR-04). The split is "has a password", not "is
-- confirmed": `/auth/confirm` confirms an invited identity before the password is set.
--
-- The fact is read at the moment it is needed (the invite send, `GET /v1/me/invite`), never stored
-- on `tenant_invites`: a stored delivery column goes stale if the person sets a password elsewhere
-- before accepting (08.1-RESEARCH A3, alternative rejected).
--
-- ── HARDENING ───────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with `search_path = ''` and a fully qualified name, because `auth.users` is not
-- readable by `api_user` or the tenant lane. It returns a BOOLEAN only — never the hash, never a
-- row — for exactly the id it is given (no scan, no row cap needed: `auth.users.id` is the primary
-- key). An unknown id answers false. `revoke all … from public`, then execute for `api_user` (the
-- bare-connection read in `packages/core/server/tenancy/identity.ts`) and `service_role` (the admin
-- lane's `identityKind` in `packages/core/server/platform/invites.ts`) only; `authenticated` cannot
-- call it. `app` is not a PostgREST-exposed schema. Proved by `supabase/tests/040-schema-conventions.sql`.
--
-- ── RELEASE ORDER (D-318) ───────────────────────────────────────────────────────────────────────────
-- Expand-only: a new function, nothing altered or dropped, so the API revision still serving during
-- `supabase db push` is unaffected.

create or replace function app.identity_has_password(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select u.encrypted_password is not null and u.encrypted_password <> ''
       from auth.users u
      where u.id = p_user_id),
    false
  )
$$;
--> statement-breakpoint
revoke all on function app.identity_has_password(uuid) from public;
--> statement-breakpoint
grant execute on function app.identity_has_password(uuid) to api_user, service_role;
