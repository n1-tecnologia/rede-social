-- confirm_existing_auth_emails (quick 261007-gzu, request 2) — a ONE-TIME DATA backfill, not a schema
-- change. Hand-written (drizzle-kit cannot model a write over `auth.users`).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
-- Quick 261007-gbk made member sign-up require a confirmed e-mail and switches `enable_confirmations`
-- on for the hosted project. Accounts created under the OLD autoconfirm rule (Phase 1 D-04), plus
-- anything created by hand without Auto Confirm (for example the platform super_admin created on
-- 2026-09-28), may carry a null `email_confirmed_at`. Once confirmations are on, GoTrue refuses their
-- password sign-in with `email_not_confirmed`: those people would be locked out of an account that
-- worked yesterday. This statement marks them confirmed.
--
-- ── ONE-TIME ────────────────────────────────────────────────────────────────────────────────────────
-- It is a backfill for the moment confirmations are enabled, not a recurring job. The Supabase CLI
-- records it as applied, so it normally runs once; the guards below make a late or repeated run
-- harmless anyway.
--
-- ── THE CUTOFF (the re-run guard) ───────────────────────────────────────────────────────────────────
-- `created_at < 2026-10-07 14:58:35+00` is the commit instant of 1bad76a (the sign-up confirmation
-- code, 2026-10-07T11:58:35-03:00). Production creates unconfirmed identities only after that code
-- ships, and every account created before it was autoconfirmed, so every legitimately PENDING sign-up
-- is newer than the cutoff and is never touched, however late or often this file runs. No clock is
-- read at run time: the guard is a literal, deterministic and testable.
--
-- ── THE INVITED EXCLUSION ───────────────────────────────────────────────────────────────────────────
-- `invited_at is null`: a pending GoTrue invite is not an "existing account that would be blocked".
-- Its invite link confirms it on acceptance and works regardless of the confirmations setting, and
-- confirming it early only risks interfering with the invite exchange.
--
-- ── IDEMPOTENT ──────────────────────────────────────────────────────────────────────────────────────
-- It matches only rows with a null `email_confirmed_at` and sets it, so a second run finds nothing and
-- changes nothing. An already-confirmed account keeps its original instant. `confirmed_at` is a
-- generated column and follows.
--
-- ── ORDER OF APPLICATION ────────────────────────────────────────────────────────────────────────────
-- Before or with the config push that enables confirmations. deploy-api.yml already runs
-- `supabase db push` before `supabase config push` in the same job; if the config is ever pushed by
-- hand, push this migration first. See docs/deploy/auth-mail.md "Existing accounts: one-time backfill".
--
-- ── ROLLBACK / REVERSIBILITY ────────────────────────────────────────────────────────────────────────
-- A data change with no schema effect, so rolling back the API or the web needs nothing. Once applied
-- to a real database a confirmation made here cannot be told apart from a genuine one (rated costly).
--
-- This file is NOT applied to production or homolog by the task that created it: the production apply
-- is a human step, after the pre-flight query in docs/deploy/auth-mail.md.

update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now())
 where email_confirmed_at is null
   and invited_at is null
   and created_at < timestamptz '2026-10-07 14:58:35+00';
