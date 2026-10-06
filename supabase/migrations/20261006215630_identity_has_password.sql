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
-- ── WHY A HASH ALONE IS NOT ENOUGH (verified against the local GoTrue, 08.1-06) ────────────────────
-- GoTrue writes a RANDOM bcrypt hash into `encrypted_password` when an invite link is verified
-- (`/auth/confirm` -> `verifyOtp({ type: 'invite' })`): `''` after `inviteUserByEmail`, a 60-char
-- `$2a$` hash right after the exchange, before the person ever chose a password. An admin who
-- abandoned `/aceitar-convite` (WR-04) would read as "has a password" and lose both the password step
-- and the recovery-link resend. So a hash counts only when the person is known to have chosen it:
--   * `invited_at is null` — the identity was never created by a GoTrue invite (sign-up, or created
--     with a password by the platform), so the hash is the one that was chosen; or
--   * the identity holds a membership that is NOT `invited` (active or blocked, removed or not) —
--     it accepted an invite or joined, and both paths run with a password the person set (the accept
--     action's `updateUser`, the sign-up/join form).
-- An invited-only identity that set a password through "Esqueci a senha" reads false: it is asked
-- for a password once more on the accept screen and its resend keeps the recovery link — harmless.
--
-- ── HARDENING ───────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with `search_path = ''` and fully qualified names, because `auth.users` is not
-- readable by `api_user` or the tenant lane. It returns a BOOLEAN only — never the hash, never a
-- row — for exactly the id it is given (no scan, no row cap needed: `auth.users.id` is the primary
-- key, the membership probe is an `exists` on the user's own rows). An unknown id answers false.
-- `revoke all … from public`, then execute for `api_user` (the bare-connection read in
-- `packages/core/server/tenancy/identity.ts`) and `service_role` (the admin lane's `identityKind` in
-- `packages/core/server/platform/invites.ts`) only; `authenticated` cannot call it. `app` is not a PostgREST-exposed schema. Proved by `supabase/tests/040-schema-conventions.sql`.
--
-- ── RELEASE ORDER (D-318) ───────────────────────────────────────────────────────────────────────────
-- Expand-only: a new function, nothing altered or dropped, so the API revision still serving during
-- `supabase db push` is unaffected.

create or replace function app.identity_has_password(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select u.encrypted_password is not null
            and u.encrypted_password <> ''
            and (u.invited_at is null
                 or exists (select 1
                              from public.memberships m
                             where m.user_id = u.id
                               and m.status <> 'invited'))
       from auth.users u
      where u.id = p_user_id),
    false
  )
$$;
--> statement-breakpoint
revoke all on function app.identity_has_password(uuid) from public;
--> statement-breakpoint
grant execute on function app.identity_has_password(uuid) to api_user, service_role;
