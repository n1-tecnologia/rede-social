---
phase: quick-261012-s0v
plan: 01
subsystem: auth
tags: [auth, mail, signup, proxy, allow-list, worker, domains]
requires:
  - packages/core/server/tenancy/mail-tenant.ts (row 6a brand of a hostless signup mail)
  - packages/core/server/domains/auth-allow-list.ts (idempotent local/supabase adapters)
  - apps/web/app/auth/confirm/route.ts (OTP_TYPES + sameOriginPath guards)
provides:
  - packages/core/server/mail/index.ts: SIGNUP_CONFIRM_PATH, rehomedSignupRedirect, mail.link_rehomed
  - packages/core/server/tenancy/mail-tenant.ts: hostMatched on the tenant resolution
  - apps/web/lib/auth-link-forward.ts: authLinkForwardTarget
  - packages/core/server/platform/allow-list-lock.ts: shared withAllowListLock
  - packages/core/server/platform/reconcile-allow-list.ts: reconcileAuthAllowList
  - apps/api/src/worker.ts: boot-time reconcile, domains.allow_list.reconciled log line
affects:
  - Send Email Hook (signup mails only)
  - apps/web/proxy.ts (requests to / carrying token_hash + type)
  - worker boot sequence (one extra best-effort step before the probe)
tech-stack:
  added: []
  patterns:
    - "Re-home a GoTrue site_url-fallback link from server truth (tenant_domains), never from the payload"
    - "Boot-time reconcile of externally-wiped config (allow-list) under the existing advisory lock"
key-files:
  created:
    - apps/web/lib/auth-link-forward.ts
    - apps/web/lib/auth-link-forward.test.ts
    - packages/core/server/platform/allow-list-lock.ts
    - packages/core/server/platform/reconcile-allow-list.ts
    - apps/api/tests/integration/allow-list-reconcile.test.ts
  modified:
    - packages/core/server/tenancy/mail-tenant.ts
    - packages/core/server/mail/index.ts
    - packages/core/server/platform/invites.ts
    - packages/core/server/platform/domains.ts
    - packages/core/tests/mail-link-host.test.ts
    - apps/api/tests/integration/send-email-hook.test.ts
    - apps/api/src/worker.ts
    - apps/web/lib/signup-confirmation.ts
    - apps/web/proxy.ts
    - docs/DEPLOY.md
decisions:
  - "The re-home host is resolution.primaryHost (verified + primary tenant_domains row); the payload is never consulted for a host, so T-02-26 holds"
  - "Re-home scope is strict: signup only, hostMatched === false, non-empty primaryHost; every other type and every host-matched link is byte-identical to before"
  - "proxy.ts forwards /?token_hash&type to /auth/confirm on every host mode, authenticated or not, before the private-routes block; PUBLIC unchanged"
  - "withAllowListLock moved to platform/allow-list-lock.ts (admin lane stays under platform/); one lock per host in the reconcile so a panel verify is never starved"
  - "request.nextUrl passed the URL parameter typing directly; new URL(request.url) was NOT needed"
metrics:
  duration: "~5 min wall clock (2026-10-12T23:26:51Z to 2026-10-12T23:31:29Z)"
  completed: 2026-10-12
  tasks: 3
  files: 15
actuals:
  tokens: 8400
  tasks: 3
  commits: 3
plan_head_before: 29f1ff07fc7ed36a49fa92656f3edd106791160e
status: complete
---

# Quick 261012-s0v: Fix the sign-up confirmation link falling back to the platform root — Summary

Three independent layers now close the `site_url`-fallback hole: the Send Email Hook re-homes a hostless `signup` link onto the tenant's VERIFIED primary host as `/auth/confirm?next=/inicio`; `proxy.ts` forwards a stray `/?token_hash=…&type=…` to `/auth/confirm` on the same origin; and the worker reconciles the auth allow-list for every verified host at boot so a deploy self-heals the list that `supabase config push` wipes.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `5ea318a` | fix(quick-261012-s0v): re-home a site_url-fallback signup link onto the tenant's verified primary host |
| 2 | `f6c11cb` | fix(quick-261012-s0v): forward a token link that reached / to /auth/confirm |
| 3 | `03a4576` | feat(quick-261012-s0v): reconcile the auth allow-list at worker boot |

`git log -3 --format=%B | grep -ci co-authored` = 0. No file under `supabase/migrations/` or `packages/core/db/schema/` changed. Nothing pushed, nothing deployed, no migration. Docs artifacts (this SUMMARY, PLAN, STATE) were NOT committed — the orchestrator owns the docs commit.

## What was built

### Task 1 — hook re-home (`5ea318a`)

- `MailTenantResolution`'s `tenant` variant carries `hostMatched: boolean`, set in `resolveMailTenant` as `hostTenantId !== null`. The two `invites.ts` literals handed to `toMailBrand` carry `hostMatched: true` (composed from the tenant's own verified primary host). Row 6a of the file comment gained the sentence about the re-home.
- `packages/core/server/mail/index.ts` exports `SIGNUP_CONFIRM_PATH = '/auth/confirm?next=/inicio'` and `rehomedSignupRedirect(resolution, actionType)`; `sendAuthMail` renders `payload.email_data` with `redirect_to` replaced only when the helper returns non-null, and logs `mail.link_rehomed` with `{ event, actionType, tenantId, host }` only (T-02-25).
- `apps/web/lib/signup-confirmation.ts` got the sync comment; no behaviour change on the web side.

### Task 2 — proxy forward (`f6c11cb`)

- `apps/web/lib/auth-link-forward.ts`: `authLinkForwardTarget(url)` returns `new URL(url.href)` with only `pathname` set to `/auth/confirm` when `pathname === '/'` and both `token_hash` and `type` are present; `null` otherwise. Input URL is not mutated.
- `apps/web/proxy.ts`: after the host-mode block and immediately before "4. Private routes require a verified session", `const forward = authLinkForwardTarget(url); if (forward) return withCookies(NextResponse.redirect(forward, 307), response, csp);`. `request.nextUrl` satisfied the `URL` parameter type directly — `new URL(request.url)` was not needed. PUBLIC list untouched.

### Task 3 — allow-list self-heal (`03a4576`)

- `packages/core/server/platform/allow-list-lock.ts`: `withAllowListLock` moved out of `domains.ts` verbatim (advisory xact lock on `hashtext('tenant_domains.allow_list')`); `domains.ts` imports it. The `sql` import in `domains.ts` stays — it is still used by the `lastError like 'invite%'` predicate.
- `packages/core/server/platform/reconcile-allow-list.ts`: `reconcileAuthAllowList()` selects every `tenant_domains.host` with `verified_at is not null` (ordered by host), then per host `await withAllowListLock(() => authAllowList.add(host))` in a try/catch; returns `{ hosts, added, failed }`; per-host failures log `platform.domains.allow_list_reconcile_failed` with `host` and `err.message` only.
- `apps/api/src/worker.ts`: best-effort block after the sweeper arm and before the probe listener; logs `domains.allow_list.reconciled` with `{ hosts, added, failed, adapter }` or an error line; the probe still binds on failure. Header comment updated.
- `docs/DEPLOY.md` WR-09: the two "After each push … Verificar agora" lines replaced by the boot-time reconcile paragraph, plus the bold **Sign-up confirmation link (quick 261012-s0v)** sub-note.

## Verification (real outputs)

TDD order was followed per task: tests written first, RED observed, then implementation, then GREEN.

| Gate | Command | Result |
|------|---------|--------|
| Task 1 RED | `pnpm --filter @rede-social/core exec vitest run tests/mail-link-host.test.ts` | 5 failed / 20 passed (helper not exported yet) |
| Task 1 core unit | same | **25 passed** (20 existing + 5 `rehomedSignupRedirect`) |
| Task 1 hook suite | `pnpm --filter @rede-social/api exec vitest run tests/integration/send-email-hook.test.ts` | **24 passed** (cases 1-21 + 6b unchanged, 22 and 23 new) — no seed-residue trip, `pnpm supabase test db` not needed |
| Task 1 biome | core (4 files), api (1 file), web (1 file) | clean, no fixes |
| Task 1 typecheck | `pnpm --filter @rede-social/core typecheck`, `… api typecheck` | clean |
| Task 1 grep | `SIGNUP_CONFIRM_PATH` literal | 1 |
| Task 2 RED | `pnpm --filter @rede-social/web exec vitest run lib/auth-link-forward.test.ts` | module not found |
| Task 2 web unit | same | **9 passed** |
| Task 2 biome | `lib/auth-link-forward.ts lib/auth-link-forward.test.ts proxy.ts` | one format-only fix on the test file (line wrap), then clean |
| Task 2 typecheck | `pnpm --filter @rede-social/web typecheck` (`next typegen && tsc --noEmit`) | clean |
| Task 2 grep | `authLinkForwardTarget(url` in proxy.ts | 1 |
| Task 3 RED | `pnpm --filter @rede-social/api exec vitest run tests/integration/allow-list-reconcile.test.ts` | package not found |
| Task 3 reconcile + worker | `pnpm --filter @rede-social/api exec vitest run tests/integration/allow-list-reconcile.test.ts tests/integration/worker.test.ts` | **2 files, 3 passed** (reconcile 2, worker boot 1) |
| Task 3 regression | `pnpm --filter @rede-social/api exec vitest run tests/integration/platform-domains.test.ts` | **22 passed** (not in the plan; run because `domains.ts` lost its private lock) |
| Task 3 biome | core (3 files) clean; api (2 files) import-sort + one line wrap fixed by `biome check --write`, then clean | clean |
| Task 3 typecheck | core, api | clean |
| Task 3 greps | reconcile export / worker call / DEPLOY.md mention | 1 / 1 / 1 |

Nothing was run through turbo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Biome formatting on new files**
- **Found during:** Task 2 and Task 3 verify
- **Issue:** one over-long `expect` line in `auth-link-forward.test.ts`; import order + one line wrap in `worker.ts`
- **Fix:** `biome format --write` / `biome check --write` on exactly those files; no logic change
- **Commits:** `f6c11cb`, `03a4576`

Everything else executed exactly as written. Additional (not required) regression run: `platform-domains.test.ts`, 22/22.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. The new surface (proxy forward on `/`, boot-time Management API writes) is covered by T-s0v-03/04 and T-s0v-05..09; no new endpoint, auth path or schema change was introduced.

## Production proof

After the user's manual deploy, the worker's first boot log line `domains.allow_list.reconciled` with `{ hosts, added, failed, adapter: 'supabase' }` is the evidence that the hosted `uri_allow_list` was healed.

## Self-Check: PASSED
