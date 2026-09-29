---
phase: quick-260929-g0s
verified: 2026-09-29T15:20:00Z
status: human_needed
score: 4/8 must-haves verified
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/quick/260929-g0s-fix-first-admin-invite-race-and-show-inv/260929-g0s-PLAN.md
  - .planning/quick/260929-g0s-fix-first-admin-invite-race-and-show-inv/260929-g0s-SUMMARY.md
  - apps/api/src/worker.ts
  - apps/api/tests/integration/invites.test.ts
  - apps/api/tests/integration/platform-domains.test.ts
  - apps/api/tests/integration/send-email-hook.test.ts
  - apps/api/tests/integration/setup.ts
  - apps/web/app/(platform)/plataforma/tenants/[id]/admins/actions.ts
  - apps/web/app/(platform)/plataforma/tenants/[id]/admins/page.tsx
  - apps/web/components/platform/AdminsCard.test.tsx
  - apps/web/components/platform/AdminsCard.tsx
  - apps/web/e2e/invite.spec.ts
  - apps/web/e2e/platform-tenants.spec.ts
  - apps/web/messages/pt-BR/platform.json
  - packages/core/server/jobs/boss.ts
  - packages/core/server/mail/index.ts
  - packages/core/server/platform/domains.ts
  - packages/core/server/platform/invite-send-job.ts
  - packages/core/server/platform/invite-send.ts
  - packages/core/server/platform/invites.ts
  - packages/core/server/tenancy/mail-tenant.ts
  - packages/core/tests/invite-send.test.ts
  - packages/core/tests/mail-link-host.test.ts
covered_digest: "v1:sha256:b3e3fa1e7d12e96d6bb3e881a505e84b24f64c42c24e6146dacf6883dd5c2158"
behavior_unverified: 4
overrides_applied: 0
behavior_unverified_items:
  - truth: "kernel.invite-send re-reads the invite by (id AND tenant_id) and sends only while pending with a verified primary; re-run / accepted / expired / refused / deleted tenant / no verified primary resolve without sending or throwing"
    test: "After db:reset + db:seed, run apps/api/tests/integration/invites.test.ts (describe 'deferred first send — kernel.invite-send', D1-D6)"
    expected: "D2 sends one branded invite on http://<tenant-host>:3000/auth/confirm?next=/aceitar-convite; D3-D5 resolve with no second mail, no second identity"
    why_human: "State transitions through Postgres, pg-boss and GoTrue; the committed suite cannot reach its rede-demo seed on this machine (local DB predates the rename) and db:reset needs the user's approval"
  - truth: "A GoTrue/hook failure in the job reverts the claim, writes last_error 'invite' and rethrows for pg-boss retry; an identity refusal writes 'invite:<reason>' and does not retry; a later success clears an 'invite…' last_error"
    test: "Run platform-domains.test.ts cases 4b and 21 after db:reset + db:seed"
    expected: "4b: handler rejects, invite pending with sentAt null, 0 auth users, 0 Mailpit messages, last_error 'invite'. 21: last_error 'invite:email_in_use', invite expired, sentAt null"
    why_human: "Claim/revert and last_error bookkeeping are DB state transitions only the integration suite exercises; only classifyInviteSendError (pure) ran here"
  - truth: "The Send Email Hook answers 500 'redirect_host_not_tenant' and sends nothing for a tenant recipient's (member or open invitee) link mail whose redirect_to host is not a verified host of that tenant; platform admins, tenantless recipients and non-link types are unaffected"
    test: "Run send-email-hook.test.ts cases 13-17 (and 1-12 for regression) after db:reset + db:seed"
    expected: "13 and 15 answer 500 redirect_host_not_tenant with no Mailpit message; 14 answers 200 SJ-branded; 16 answers 200 neutral; 17 answers 200"
    why_human: "The pure decideLinkHostRefusal / isLinkActionType tables passed, but the DB branches (openInviteTenantId, isVerifiedHostOf) and the route's 500 mapping are only exercised by the integration suite, which cannot run on the drifted local DB"
  - truth: "Locally the deferred send for a .cliente.test host reproduces the 2026-09-29 production fallback and is refused end-to-end"
    test: "Run platform-domains.test.ts case 4b as committed (not the slug-substituted copies the executor used)"
    expected: "Handler rejects; invite pending; no neutral invite mail in Mailpit; domain last_error 'invite'"
    why_human: "Needs the local GoTrue + hook + DB; the executor's evidence comes from uncommitted, deleted test copies and cannot be re-checked"
human_verification:
  - test: "With the user's approval, run pnpm db:reset && pnpm db:seed, then pnpm test:integration (whole folder)"
    expected: "invites.test.ts (D1-D6), platform-domains.test.ts (4, 4b, 13, 15, 18, 21) and send-email-hook.test.ts (1-17) are all green on the committed files"
    why_human: "The local DB predates the 2026-09-28 rename (tria-* seed, tria_terms consent check); the verifier is not allowed to reset it"
  - test: "Run the e2e specs: pnpm --filter @rede-social/web exec playwright test invite.spec.ts platform-tenants.spec.ts phase2-smoke.spec.ts platform-domains.spec.ts --project=desktop-chromium"
    expected: "Green; invite.spec.ts starts a worker and the first send goes through kernel.invite-send"
    why_human: "Needs dev servers and the rede-* seed; e2e was not run by the executor"
  - test: "Panel check on http://rede-social.localhost:3000/plataforma: create a tenant, open its Admins tab, then 'Verificar agora' on a *.localhost host with a worker running"
    expected: "Before verify: 'Aguardando domínio verificado', a disabled 'Enviar convite' and the helper line. After the job runs: 'Enviado em <data/hora>' and 'Reenviar convite'. The creation form shows the new hint under the admin e-mail"
    why_human: "Visual check of the Admins tab (a human-check the plan deferred to the end of the task)"
  - test: "Production retest of the incident flow (AUTH_ALLOW_LIST=supabase, DOMAIN_PROVIDER=vercel), once the cloud work is resumed: create a tenant, attach and verify its domain"
    expected: "Invite arrives about 60 s or more after verified_at, with a link on https://<tenant-host>/auth/confirm?next=/aceitar-convite. If GoTrue still falls back, the logs show mail.refused redirect_host_not_tenant followed by invites.send_job.failed retry:true and a later success. The invite never becomes 'refused' with email_in_use"
    why_human: "The retry path depends on hosted GoTrue rolling back the invited auth.users row when the Send Email Hook fails. It was only observed on the local GoTrue. If hosted GoTrue kept the row, identityConflict would turn the retry into a terminal email_in_use refusal"
---

# Quick 260929-g0s: first-admin invite race fix + invite state on the Admins tab. Verification Report

**Task goal:** Fix the first-admin invite race in production (the invite was sent before the Supabase Auth allow-list entry took effect, so the link landed on the platform host). Harden the Send Email Hook so a tenant recipient never gets a link on a non-tenant host. Make the invite state visible in the platform panel.
**Verified:** 2026-09-29T15:20:00Z
**Status:** human_needed
**Re-verification:** No. This is the initial verification.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The verified transition (poller, "Verificar agora", alias promoted to primary) never calls GoTrue inline. After the allow-list step succeeds it enqueues one `kernel.invite-send` job per pending invite: ids-only payload, singletonKey = inviteId, delay 60 s with the supabase adapter and 0 locally, retryLimit 5, backoff capped at 600 s | ✓ VERIFIED | `domains.ts` has no `sendPendingInvites` call left. `ensureVerifiedSideEffects` calls `scheduleInviteSends` only inside `if (ok)`, after the allow-list step (l.408-425). `setPrimaryDomain` calls it at l.683. The poller reaches this through `verify-job.ts` → `checkDomain` → `ensureVerifiedSideEffects` (l.484/562). `invite-send.ts` enqueues through `enqueueInTx(... inviteSendJobOptions(invite.id, delayS))`. `invite-send.test.ts` checks the exact options, the 60/0 delay and the queue registration. The queue is created with the `short` policy (`boss.ts` `createQueues`) |
| 2 | The job re-reads by (id AND tenant_id) and sends through the one sender only while the invite is pending and the tenant has a verified primary. Re-run, accepted, expired, refused, deleted tenant and no verified primary resolve without sending | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The code is present and wired. `runScheduledInviteSend` does the scoped read and returns `gone` / `not_pending`, then calls `sendPendingInvites(..., { inviteId })`. `sendPendingInvites` still claims before sending and filters by `inviteId`. Integration cases D2-D5 exist but could not run here (seed drift) |
| 3 | A GoTrue/hook failure leaves the invite pending, writes last_error 'invite' and rethrows. An identity refusal writes 'invite:<reason>' and does not retry. A later success clears 'invite…' | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `invite-send-job.ts` classifies the error, records the outcome in its own try/catch and rethrows only when `retry`. `sendPendingInvites` reverts the claim and throws a 500. `recordInviteSendOutcome` with null clears only `like 'invite%'` on the verified primary. `classifyInviteSendError` passed its unit tests. Claim revert and bookkeeping (4b, 21) are integration-only |
| 4 | "Enviar convite" / "Reenviar convite" stays immediate: `resendInvite` is unchanged | ✓ VERIFIED | In d9d93e8 the only change to `invites.ts` is the optional `opts.inviteId` on `sendPendingInvites` plus docblocks. `resendInvite` (l.448+) still calls `sendPendingInvites(tenantId, actor)` inline for a `pending` invite, and generateLink + mailTransport for sent/expired |
| 5 | The hook answers 500 'redirect_host_not_tenant' and sends nothing for a tenant recipient's (member or open invitee) link mail on a non-verified-tenant host. Platform admins, tenantless recipients and non-link types are unaffected. redirect_to is never rewritten | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `mail-tenant.ts` resolves in this order: membership → guard, platform admin → neutral, open invite (server rows, `pending`/`sent`) → guard, then redirect host, then neutral. `isVerifiedHostOf` is uncached. `mail/index.ts` passes `email: to` and `linkRequired: isLinkActionType(actionType)`. `routes/hooks.ts` l.52-57 maps `MailRefusedError` to `500 { message: reason }`. The pure tables in `mail-link-host.test.ts` passed. Hook cases 13-17 are integration-only |
| 6 | Locally, the deferred send for a `.cliente.test` host reproduces the production fallback and is refused end-to-end | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | platform-domains case 4b exists with strict assertions (rejects, pending, sentAt null, 0 auth users, 0 mails, last_error 'invite'). The executor ran it only through uncommitted, slug-substituted copies that were then deleted |
| 7 | The Admins tab shows awaiting-domain / unsent / "Enviado em <data/hora>" / "Aceito em <data>". The button reads "Enviar convite" before any send and "Reenviar convite" after, is absent once accepted, and is disabled with the helper line while no verified primary exists | ✓ VERIFIED | `deriveInviteState` in `AdminsCard.tsx` implements the planned table. The page computes it from `primaryVerifiedHost(detail) !== null`, renders `ResendInviteButton` only when `action !== null`, picks the send or resend labels by action and passes `canResend = canSend`. The button shows the helper when `!canResend`. `AdminsCard.test.tsx` passes 14 tests (derive table, pills, disabled send, enabled resend, success and reason toasts) |
| 8 | The creation-form hint names the address and the domain verification. Every string comes from platform.json and the literal guard passes | ✓ VERIFIED | `platform.new.adminEmailHelper` = "O convite será enviado para este e-mail assim que o domínio da comunidade for verificado.", rendered at `NewTenantForm.tsx:236`. `check-ui-literals.sh apps/web` is OK. The old `invitePending` key has no remaining reference |

**Score:** 4/8 truths verified (4 are present and wired, but their behavior is unverified)

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/core/server/platform/invite-send.ts` | ✓ VERIFIED | Every planned export is present and substantive. `registerJobQueues` is called at module top |
| `packages/core/server/platform/invite-send-job.ts` | ✓ VERIFIED | `inviteSendJob`, `INVITE_SEND_SYSTEM_ACTOR`. The handler throws on purpose for retryable failures |
| `packages/core/server/platform/domains.ts` | ✓ VERIFIED | Two `scheduleInviteSends(` calls plus `recordInviteSendOutcome` |
| `packages/core/server/tenancy/mail-tenant.ts` | ✓ VERIFIED | `decideLinkHostRefusal`, `isVerifiedHostOf`, `openInviteTenantId`, the new `resolveMailTenant` input, `via: 'invite'` |
| `apps/web/components/platform/AdminsCard.tsx` | ✓ VERIFIED | `deriveInviteState` + 6 view statuses |
| New test suites (3) | ✓ VERIFIED | All exist and all ran green here |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| domains.ts `ensureVerifiedSideEffects` / `setPrimaryDomain` | `scheduleInviteSends` → `enqueueInTx(INVITE_SEND_QUEUE, {tenantId, inviteId}, opts)` | direct import | WIRED |
| `apps/api/src/worker.ts` jobs array | `inviteSendJob` | import + listed after `domainVerifyJob` (so `createQueues` and `boss.work` pick it up) | WIRED |
| `inviteSendJob.handler` | `runScheduledInviteSend` → `sendPendingInvites(..., { inviteId })` | import | WIRED |
| invite-send.ts import side effect | API lazy `startedBoss()` queue creation | `registerJobQueues` at top level; domains.ts imports invite-send.ts at top | WIRED (unit test asserts the registration) |
| `sendAuthMail` | `resolveMailTenant({ email, linkRequired })` → `MailRefusedError` → route 500 | import + route catch | WIRED |
| hook verified-host decision | `isVerifiedHostOf` (uncached DB read), not `resolveTenantHost` | `redirectHostVerifiedForRecipient` input | WIRED |
| Admins page | `deriveInviteState` → AdminsCard pill + ResendInviteButton labels/canResend | import | WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Job options, delay, classification, payload, queue registration; hook refusal table; mail regressions | `pnpm --filter @rede-social/core exec vitest run tests/invite-send.test.ts tests/mail-link-host.test.ts tests/mail-hook.test.ts tests/mail-templates.test.ts` | 4 files / 41 tests passed | ✓ PASS |
| Admins tab states and button | `pnpm --filter @rede-social/web exec vitest run components/platform/AdminsCard.test.tsx` | 1 file / 14 tests passed | ✓ PASS |
| Typecheck | `TURBO_CACHE=local:r pnpm typecheck` | 12/12 tasks successful | ✓ PASS |
| Lint + literal guard | `TURBO_CACHE=local:r pnpm lint`; `bash scripts/check-ui-literals.sh apps/web` | 11/11 successful; OK | ✓ PASS |
| Integration (invites D1-D6, platform-domains 4/4b/13/15/18/21, hook 13-17) | not run | local DB seed drift; db:reset forbidden | ? SKIP → human |
| e2e | not run | needs the rede-* seed and dev servers | ? SKIP → human |

### Probe Execution

No probes are declared by the plan or the summary. Step 7c does not apply.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| ROLE-03 | super_admin creates a tenant with the first admin invited by e-mail | ? NEEDS HUMAN | Invite scheduling and job are wired, and the panel states are verified. The end-to-end send is integration/e2e only |
| TENANT-07 | custom domain attach + allow-list + verification | ? NEEDS HUMAN | The verified transition now schedules the invite only after the allow-list step succeeds. The flow is integration-only |
| TENANT-06 | auth e-mails carry the tenant's brand | ? NEEDS HUMAN | The hook guard prevents neutral links for tenant recipients, and the invite branch brands from the DB. Integration cases 13-17 were not run here |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (all 21 changed files) | - | TBD/FIXME/XXX/TODO/HACK | none found | - |
| `packages/core/server/platform/invite-send.ts` | 129-135 | `singletonKey` under the `short` policy only drops duplicates while a job is `created`. A "Verificar agora" during a job's `retry` window can enqueue a second job | ℹ️ Info | Harmless: the claim-before-send in `sendPendingInvites` still guarantees a single send |
| Production retry path | - | The retry assumes hosted GoTrue rolls back the invited auth user when the hook fails (observed locally only). If it does not, `identityConflict` would classify the retry as a terminal `email_in_use` | ⚠️ Warning | Routed to human verification (production retest) |

### Human Verification Required

1. **Full integration run on a reset DB.** With the user's approval, run `pnpm db:reset && pnpm db:seed`, then `pnpm test:integration`. Expected: invites D1-D6, platform-domains 4/4b/13/15/18/21 and send-email-hook 1-17 are green on the committed files.
2. **e2e.** Run `invite.spec.ts platform-tenants.spec.ts phase2-smoke.spec.ts platform-domains.spec.ts --project=desktop-chromium`. Expected: green, with the first send going through the worker.
3. **Admins tab visual check** on `rede-social.localhost:3000/plataforma`. Expected: the awaiting-domain state with a disabled "Enviar convite" and the helper line. After verify plus the worker: "Enviado em …" and "Reenviar convite". The new creation hint is shown.
4. **Production incident retest** (after the cloud work resumes). Expected: the invite arrives on the tenant host at least 60 s after verification. If GoTrue falls back, the hook refuses and a pg-boss retry later succeeds. The invite never flips to a refused `email_in_use`.

### Gaps Summary

No blocking gaps. All code for the three parts is present, substantive and wired:
- the race fix: the verified transition schedules a delayed, deduplicated, retrying job instead of sending inline;
- the hook guard: it refuses and never rewrites, recognises the open invitee from server rows, and checks the verified host uncached;
- the panel states.

The pure logic ran green here, along with the component behaviour, typecheck, lint and the literal guard.

Four truths are behavior-dependent and could not be exercised on this machine:
- the job's state transitions;
- the failure bookkeeping;
- the hook refusal through GoTrue;
- the local reproduction of the incident (4b).

The committed integration suites that cover them cannot reach their `rede-demo` seed until the local DB is reset. The executor's pass claims for platform-domains and send-email-hook came from deleted, slug-substituted copies, so they are not independently checkable. The status is therefore `human_needed`, not `passed`.

---

_Verified: 2026-09-29T15:20:00Z_
_Verifier: Claude (gsd-verifier)_
