-- platform_tenant_apps_hardening (13-05, D-605, D-615, D-539, T-13-09, T-13-10) — the hand-written half of the
-- tenant-apps migration (drizzle-kit cannot model grants). Applied by the in-house runner right after
-- `platform_tenant_apps`, in ONE transaction. EXPAND-ONLY: it adds grants and revokes, it drops and rewrites
-- nothing.
--
-- CENTRAL SET ONLY. `platform.tenant_apps` and `platform.tenant_app_credentials` are never applied to a
-- tenant's project (`tenant-set-no-platform.test.ts` and `scripts/db-two-databases.sh --assert-no-platform`
-- prove it). The first holds the non-secret facts of a tenant's native app; the second holds every store
-- credential SEALED (AES-256-GCM, AAD `<rowId>:<kind>`), and no plain column can hold a secret, a prefix, a
-- hash, a length or a Key ID.
--
-- ── EXPOSURE ─────────────────────────────────────────────────────────────────────────────────────
-- RLS is ON with ZERO policies (the table definitions enable it). On top of that `anon`, `authenticated` and
-- the bare `api_user` (a `noinherit` member of both lanes) hold no privilege; only `service_role`, reached
-- through the platform lane behind the explicit super_admin guard (or the operator's script), reads or writes
-- the two tables. The statements are repeated by name, as the moves and token-event hardening do, so the
-- closed state does not depend on which role ran which migration. A policy for `authenticated` must NEVER be
-- added to either table (SCHEMA-CONVENTIONS (i)).
revoke all on table platform.tenant_apps from public, anon, authenticated, api_user;
revoke all on table platform.tenant_app_credentials from public, anon, authenticated, api_user;
grant select, insert, update, delete on table platform.tenant_apps to service_role;
grant select, insert, update, delete on table platform.tenant_app_credentials to service_role;
