---
phase: quick-260929-g0s
plan: 01
subsystem: platform-invites / auth-mail / platform-panel
status: complete
tags: [pg-boss, gotrue, send-email-hook, supabase-auth, invites, domains, nextjs, next-intl, vitest]
requires: [ROLE-03, TENANT-07, TENANT-06]
provides:
  - kernel.invite-send job (deferred, idempotent, retrying first-admin invite)
  - Send Email Hook link-host guard (redirect_host_not_tenant)
  - Admins tab invite states (awaiting domain / unsent / sent / accepted / expired / refused)
affects: [platform/domains.ts verified transition, tenancy/mail-tenant.ts, apps/api worker, Admins tab]
tech-stack:
  added: []
  patterns:
    - "Verified transition schedules work (pg-boss job, singletonKey = invite id, short policy) instead of calling GoTrue inline"
    - "Job handler that throws on purpose for transient errors (pg-boss retryLimit/retryBackoff/retryDelayMax), terminal on identity refusals"
    - "Hook refuses (never rewrites) a tenant recipient's link on a host that is not a verified host of that tenant; the verified-host check is uncached"
key-files:
  created:
    - packages/core/server/platform/invite-send.ts
    - packages/core/server/platform/invite-send-job.ts
    - packages/core/tests/invite-send.test.ts
    - packages/core/tests/mail-link-host.test.ts
    - apps/web/components/platform/AdminsCard.test.tsx
  modified:
    - packages/core/server/jobs/boss.ts
    - packages/core/server/platform/invites.ts
    - packages/core/server/platform/domains.ts
    - packages/core/server/tenancy/mail-tenant.ts
    - packages/core/server/mail/index.ts
    - apps/api/src/worker.ts
    - apps/api/tests/integration/setup.ts
    - apps/api/tests/integration/invites.test.ts
    - apps/api/tests/integration/platform-domains.test.ts
    - apps/api/tests/integration/send-email-hook.test.ts
    - apps/web/messages/pt-BR/platform.json
    - apps/web/components/platform/AdminsCard.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/admins/page.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/admins/actions.ts
    - apps/web/e2e/invite.spec.ts
    - apps/web/e2e/platform-tenants.spec.ts
decisions:
  - "First-admin invite after a verified domain is sent by kernel.invite-send (60 s delay with AUTH_ALLOW_LIST=supabase, 0 locally; 5 retries, 30 s doubling, capped 600 s); the manual Enviar/Reenviar convite stays immediate"
  - "The invite send is scheduled only when the allow-list step succeeded; the job records its own outcome (invite / invite:<reason>) on the verified primary's last_error"
  - "Send Email Hook refuses a tenant recipient's (member or open invitee) link mail whose redirect_to host is not a verified host of that tenant: 500 redirect_host_not_tenant; recipient tenant from server rows only, never user_metadata"
  - "Admins tab: Enviar convite while sentAt is null, Reenviar convite after, none once accepted; disabled with the helper whenever no verified primary host exists"
metrics:
  duration: "~16 min (11:53 to 12:09 local)"
  completed: 2026-09-29
  tasks: 3
  files: 21
actuals:
  tokens: 27000
  tasks: 3
  commits: 3
plan_head_before: f2cb5972298e97b6b98677db0d9d86068bfbf291
---

# Quick 260929-g0s: first-admin invite race fix + invite state on the Admins tab — Summary

**What changed: after a domain is verified, the first-admin invite is no longer sent a few seconds later inline. The verify now schedules a delayed, idempotent `kernel.invite-send` pg-boss job that retries. The Send Email Hook refuses a tenant recipient's link whenever GoTrue fell back to `site_url`, so the job retries instead of mailing a broken link. The Admins tab now shows where the invite stands, with "Enviar convite" / "Reenviar convite" and a disabled state that says why.**

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 (tracer) | The verify schedules one `kernel.invite-send` job per pending invite. The job sends through the one sender, `sendPendingInvites(…, { inviteId })`, and the worker polls it | d9d93e8 |
| 2 | Hook guard `redirect_host_not_tenant` (`decideLinkHostRefusal`, `isVerifiedHostOf`, `openInviteTenantId`) + hook cases 13-17 + platform-domains rewrites (4b reproduces the incident) | 890162a |
| 3 | `deriveInviteState` + Admins tab pills/labels + creation hint + component test + e2e copy/worker | c4e1fcb |

## Required confirmations (from the plan's `<output>`)

- **No migration for the new queue.** `grep -rn "kernel.media-sweep-orphans\|kernel.domain-verify" supabase/migrations` returns 0 lines. Kernel queues are runtime rows created by `createQueue` (DML on the reviewed `pgboss` schema). `kernel.invite-send` registers itself at import in `invite-send.ts`, and the worker creates it from its job list. No DDL was added.
- **No contract change for the panel.** `TenantInvite` already carries `status`, `sentAt`, `acceptedAt`, and `primaryVerifiedHost(detail)` already derives from the returned domains. `deriveInviteState` works on those fields only.
- **GoTrue rollback observed (platform-domains 4b).** When the Send Email Hook answers 500, the local GoTrue rolls the invited identity back. `auth.users` had 0 rows for the admin address after the refused deferred send, so the assertion stayed strict and nothing was weakened. The retry therefore does not trip the `email_in_use` identity pre-check. Log evidence: the GoTrue-originated `mail.refused` with `reason: redirect_host_not_tenant` and `actionType: invite`, then `invites.send_job.failed` with `retry: true` and `lastError: invite`.
- **Developer worker during the integration runs: none.** `curl 127.0.0.1:8788/v1/health` and `:8790/v1/health` both returned nothing before the runs, and only the Supabase stack and two unrelated node listeners on 4321/4322 were up. Nothing ran `kernel.invite-send` jobs besides the suites themselves.
- **E2E specs run: none.** See "Verification" below.

## Verification

| Gate | Result |
|------|--------|
| `pnpm --filter @rede-social/core test` | 25 files / 223 tests pass (includes invite-send, mail-link-host, mail-hook, mail-templates) |
| `pnpm --filter @rede-social/web test` | 40 files / 956 tests pass (includes AdminsCard.test.tsx, 18 cases with LogoUpload) |
| `TURBO_CACHE=local:r pnpm lint` (turbo lint + check-ui-literals) | pass |
| `TURBO_CACHE=local:r pnpm typecheck` | 12/12 pass (`.turbo/cache` stayed 0 B) |
| `bash scripts/check-ui-literals.sh apps/web` | OK |
| invites.test.ts | 17/25 pass, including the new **D1-D6** (deferred send) and the resend-lifecycle first send through the job. The other 8 fail only on local DB drift (see below) |
| platform-domains.test.ts / send-email-hook.test.ts (as committed) | **Not run.** Both fail in `beforeAll` on the missing `rede-demo` seed |
| Same two files through uncommitted copies with `'rede-demo'` → `'tria-demo'` and `TENANT_*_HOST=tria-*.localhost` (deleted afterwards) | platform-domains: **every case passes**, including 4, 4b, 13, 15, 18 and 21. send-email-hook: **13-16 pass**; 1, 10, 12 and 17 fail only on the seeded display name ("TRIA Demo" vs "Rede Demo"). The logs show 17 sent the notification (200, `via: membership`) |
| `pnpm test:integration` (whole folder) | 32 files fail, all on local DB drift: `signInWithPassword failed for *@rede-demo.local` / `@rede-lab.local`, `rede-demo is not seeded`, and 10× `consent_records_kind_chk` (accept-invite/signup). The hook logged **0** `redirect_host_not_tenant` refusals in the whole run, so no failure comes from the new guard |
| e2e (Playwright) | **e2e not run.** The local DB predates the 2026-09-28 rename (`tria-*` seed, `tria_terms` consent check), the specs need the `rede-*` seed (`createMember(…, 'rede-lab')`, seeded hosts), and no dev servers were up |
| Task 3 `<human-check>` (panel on `rede-social.localhost:3000`) | Not performed (no dev servers). The states are covered by AdminsCard.test.tsx |

### Local DB drift (pre-existing, not caused by this task)

The local Supabase database still holds the pre-rename state: tenants `tria-demo` / `tria-lab` (seeded 2026-09-28 09:03, before the rename commits), and `consent_records_kind_chk = ('tenant_rules','tria_terms')`. The migration history lists every file as applied, but the files were rewritten afterwards to say `platform_terms`. Per instructions, `pnpm db:reset` was **not** run. **To finish verification:** with the user's approval, run `pnpm db:reset && pnpm db:seed`, then `pnpm test:integration` and the four e2e specs (`invite.spec.ts platform-tenants.spec.ts phase2-smoke.spec.ts platform-domains.spec.ts --project=desktop-chromium`). Both gaps are recorded as `unrun-verify` in `.planning/WINDOWS.md`.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 2 - Correctness] `runInviteSendJobs` marks a row `completed` after its handler resolves**
- **Found during:** Task 1
- **Issue:** Run as specified, the helper would leave played rows in `created`. The `short` policy would then silently drop any later schedule of the same invite, unlike the real worker.
- **Fix:** After a successful `handler`, set `state = 'completed'` on that row (errors still propagate and the row stays `created`). platform-domains case 21 depends on this: the re-pended invite is scheduled again after the promotion.
- **Files:** apps/api/tests/integration/setup.ts. **Commit:** d9d93e8

**2. [Scope] `admins/actions.ts` comment updated**
- A docblock quoted the removed copy "Convite enviado em {date}". It now reads "Enviado em {date}" (comment only, no code change). **Commit:** c4e1fcb

**3. [Test strength] platform-domains case 15 also asserts zero auth users for B's admin.** Nothing is sent inline any more.

**4. [Verification] Integration suites checked through uncommitted, slug-substituted copies**, because the committed files cannot reach their seed on this machine (see drift above). The copies were deleted and never staged.

### Tracer gate
Task 1's slice (verify → job row → handler → branded mail on the tenant host) passed end to end (invites D1-D6), so expansion continued. The other red cases in the verify command are local DB drift, outside the tracer slice.

## Known Stubs

None.

## Threat Flags

None. The new surface is the one in the plan's threat model:
- T-g0s-01: tenant recipient from `memberships` / `tenant_invites` only.
- T-g0s-02: refuse instead of rewrite; uncached verified-host read.
- T-g0s-03: payload `{ tenantId, inviteId }`; logs carry ids and reason codes only.
- T-g0s-04: re-read by `id AND tenant_id`, one sender.
- T-g0s-05: `singletonKey` + bounded retries, identity refusals terminal.

## Self-Check: PASSED

- FOUND: packages/core/server/platform/invite-send.ts, packages/core/server/platform/invite-send-job.ts, packages/core/tests/invite-send.test.ts, packages/core/tests/mail-link-host.test.ts, apps/web/components/platform/AdminsCard.test.tsx
- FOUND commits: d9d93e8, 890162a, c4e1fcb (`git rev-list --count f2cb597..HEAD` = 3)
- `grep -c INVITE_SEND_QUEUE invite-send.ts` ≥ 2; `grep -c "scheduleInviteSends(" domains.ts` = 2; worker.ts lists `inviteSendJob`
