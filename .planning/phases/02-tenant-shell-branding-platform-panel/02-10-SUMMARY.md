---
phase: 02-tenant-shell-branding-platform-panel
plan: 10
subsystem: first-admin onboarding (accept-invite kernel service + tenant-lane route, invited scope in requireAuth, platform invite list/resend, /aceitar-convite + /convite-expirado screens, Admins tab resend control)
tags: [invites, onboarding, accept-invite, consent, requireAuth, platform, admins-tab, gotrue, generateLink, mail, playwright, vitest, tdd]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 03
    provides: "tenant_invites table (RLS on, zero policies), contracts invites.ts/errors.ts, consent_records unique index, requireAuth letting invited memberships through"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 05
    provides: "createPendingInvite / sendPendingInvites (claim-before-send, inviteUserByEmail with redirectTo on the verified primary host), routes/platform/tenants.ts chain, PlatformActor/logFor, throwaway-tenant fixtures"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 06
    provides: "mailTransport, toMailBrand, renderInvite, buildActionLink (redirect_to verbatim), MAIL_SEND_TIMEOUT_MS, maskEmail; Send Email Hook on the local stack; in-process integration listener on 8787; Mailpit"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 08
    provides: "(auth) layout painting the host brand, PasswordField, ConsentFields ({ rulesText, labels }), SubmitButton, LinkButton, EmptyState analog (/comunidade-indisponivel), /aceitar-convite + /convite-expirado PUBLIC in proxy.ts, tenant-fixtures throwawayOrigin"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 09
    provides: "attach + verify through the fake provider; the verified-primary transition calls sendPendingInvites exactly once"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 12
    provides: "Admins tab page + AdminsCard typed resend slot, platform.json admins.* keys, StatusCard/setTenantStatusAction action shape, platform e2e signIn helper, admin.ts deleteTenantBySlug"
  - phase: 01-foundation-kernel-tenancy-auth-ci-cd
    provides: "signup.ts (withAdminTx, asInet, consent rows, stale-version refusal, isDuplicateEmail), /auth/confirm route, lib/bootstrap.ts loadOrRedirect, apiFetch, e2e mail.ts Mailpit reader"
provides:
  - "packages/contracts/src/invites.ts — acceptInviteFormSchema (body + password + acceptRules/acceptTerms z.literal(true)), INVITE_STATE_REASONS ['already_accepted','no_verified_primary','not_invited'], inviteParamsSchema, tenantInvitesListSchema; errors.ts gains MEMBERSHIP_INVITED and INVITE_STATE_INVALID (+ pt-BR messages in api-error.ts)"
  - "packages/core/server/tenancy/accept-invite.ts — acceptInvite({ userId, tenantId, rulesVersion, termsVersion, ip, userAgent, logger }) → { tenantSlug, outcome: 'accepted' | 'already_active' }: ONE admin tx — stale versions → 400 { consents: 'stale' } before any write; update memberships … where status='invited' returning (row lock); zero rows → already_active replay (no writes) or 409 INVITE_STATE_INVALID { reason: 'not_invited' }; two consent_records rows (DB-clock accepted_at, onConflictDoNothing); tenant_invites → accepted by user_id or citext e-mail; logs invite.accepted"
  - "packages/core/server/auth/require-auth.ts — INVITED_ALLOWED_PATHS { /v1/me/bootstrap, /v1/me/accept-invite }; after the host check an invited membership gets 403 MEMBERSHIP_INVITED { tenantName } on every other tenant-lane path"
  - "packages/core/server/platform/invites.ts — listTenantInvites(tenantId) (404 for an unknown tenant, rows createdAt asc); resendInvite(tenantId, inviteId, actor): invite read scoped by id AND tenant_id (404 otherwise); accepted → 409 already_accepted; no verified primary → 409 no_verified_primary; pending → sendPendingInvites (single first-send implementation); sent/expired → supabaseAdmin.auth.admin.generateLink({ type: 'invite', redirectTo: publicWebOrigin(verified primary host) + '/auth/confirm?next=/aceitar-convite' }) → buildActionLink → renderInvite in toMailBrand(tenant) → mailTransport.send (AbortSignal.timeout(MAIL_SEND_TIMEOUT_MS), idempotencyKey invite-resend:{inviteId}:{sentAt}, From '{displayName} <no-reply@MAIL_DOMAIN>') → memberships invited upsert + tenant_invites sent/sent_at/user_id; logs invite.resent / invite.resend_failed with maskEmail; token and link never logged or returned"
  - "apps/api/src/routes/me.ts — POST /v1/me/accept-invite (ctx-only ids, X-Client-IP + User-Agent, 200 { tenantSlug, landing: '/inicio' }, Cache-Control: no-store) chained on meRoutes"
  - "apps/api/src/routes/platform/tenants.ts — GET /tenants/{id}/invites → { invites }, POST /tenants/{id}/invites/{inviteId}/resend → fresh tenantInviteSchema row; no-store; platform.invites.list | platform.invites.resend audit lines; mounts.test.ts pins both"
  - "apps/web/app/auth/confirm/route.ts — type=invite failure (missing/expired/consumed/superseded token_hash) → /convite-expirado (no query); every other type keeps /esqueci-senha?erro=link-invalido"
  - "apps/web/lib/bootstrap.ts — requireBootstrap() redirects membership.status === 'invited' → /aceitar-convite (redirect outside try/catch); acceptInviteRedirectPath (401 / NO_MEMBERSHIP → /convite-expirado, else bootstrapRedirectPath); bootstrapRedirectPath maps MEMBERSHIP_INVITED → /aceitar-convite"
  - "apps/web/app/(auth)/aceitar-convite/{page,actions}.tsx — branded accept screen (heading 'Você foi convidado(a) a administrar {tenant}', e-mail sub-line, PasswordField autoComplete=new-password, ConsentFields, SubmitButton 'Aceitar convite' / 'Entrando…', ONE role=alert line from ?erro=validacao|consentimento|falha with a ?campos= allow-list); action: acceptInviteFormSchema → supabase.auth.updateUser({ password }) → apiFetch POST /v1/me/accept-invite (consent versions only) → /inicio | /convite-expirado (401/403 or no session) | ?erro=consentimento (400) | ?erro=falha"
  - "apps/web/app/(auth)/convite-expirado/page.tsx — EmptyState (MailX) 'Convite expirado' + body + one outline LinkButton 'Voltar para login' → /entrar; no props, no query, no cookie"
  - "apps/web/messages/pt-BR/acceptInvite.json — namespace acceptInvite: title, subtitle, password, submit, pending, errors.{validation,consents,staleConsent,generic}, expired.{title,body,back}; platform.json admins.resent / admins.resendFailed"
  - "apps/web/app/(platform)/plataforma/tenants/[id]/admins/{page,actions}.tsx + components/platform/ResendInviteButton.tsx — resendInviteAction(tenantId, inviteId) (inviteParamsSchema, POST resend, tenantInviteSchema, revalidatePath layout, 401/403 redirect outside the try, { ok, status, sentAt } | { ok: false, code, reason? }); outline 'Reenviar convite' button ('Reenviando…' + aria-busy while pending; disabled + helper 'Adicione e verifique um domínio para enviar o convite.' for a pending invite without a verified host; toasts 'Convite reenviado.' / 'Não foi possível reenviar o convite. Tente novamente.'); nothing rendered once accepted"
  - "Tests: apps/api/tests/integration/invites.test.ts (17 cases: tracer 1-4, contracts, accept edges 5-8, resend lifecycle 9-13), auth-middleware.test.ts c4/c5 (invited scope, host wins), apps/web/e2e/invite.spec.ts (3 tests × 2 projects), apps/web/e2e/admin.ts envValue / membershipForEmail / consentCountForEmail / inviteStatusForEmail"
affects: [02-13 (branding routes chain after tenantsRoutes — untouched here), 02-15 (Domínios tab; a verified host enables the resend of a pending invite), 02-16 (phase smoke: invite.spec.ts test 1 is the 'verified host → branded invite → accept' shape; hosted otp_expiry recommendation), Phase 3 profiles (accepted admin has no name yet), Phase 7 notification mail (resendInvite is the first kernel-transport sender outside the hook), Phase 8 admin management (listTenantInvites / resendInvite behind a tenant-lane guard)]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 27931
  tasks: 3
  commits: 4
plan_head_before: ead633b90bd2d67880d6cfeb6635b93cf7ffd0c1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Onboarding scope in the middleware: a lifecycle state that must not reach the app (invited) is confined to an explicit allow-list of mounted paths checked AFTER the host check, so cross-tenant refusals keep their code and the web maps the new code to the onboarding screen"
    - "Password-first, consent-second: a two-step onboarding sets the credential through the auth provider (updateUser) BEFORE the API write, so any failure between the steps leaves a recoverable state that the bootstrap guard routes back to the same screen"
    - "Resend without the auth provider's mailer: admin generateLink (no mail, replaces the token) + the kernel template/transport, so supersession is deterministic and the provider's send budget is untouched; the first send keeps its single implementation"
    - "Kernel mail composition outside the hook: toMailBrand(tenant row, primaryHost) → render*({ brand, link }) → mailTransport.send with an idempotencyKey per logical send and AbortSignal.timeout(MAIL_SEND_TIMEOUT_MS)"
    - "Integration tests that need a GoTrue-originated mail with a working link use *.localhost hosts (the local additional_redirect_urls); any other host makes GoTrue drop redirectTo and mail a neutral link"

key-files:
  created:
    - packages/core/server/tenancy/accept-invite.ts
    - apps/web/app/(auth)/aceitar-convite/page.tsx
    - apps/web/app/(auth)/aceitar-convite/actions.ts
    - apps/web/app/(auth)/convite-expirado/page.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/admins/actions.ts
    - apps/web/components/platform/ResendInviteButton.tsx
    - apps/web/messages/pt-BR/acceptInvite.json
    - apps/api/tests/integration/invites.test.ts
    - apps/web/e2e/invite.spec.ts
  modified:
    - packages/contracts/src/invites.ts
    - packages/contracts/src/errors.ts
    - packages/core/server/http/api-error.ts
    - packages/core/server/auth/require-auth.ts
    - packages/core/server/platform/invites.ts
    - apps/api/src/routes/me.ts
    - apps/api/src/routes/platform/tenants.ts
    - apps/api/tests/unit/mounts.test.ts
    - apps/api/tests/integration/auth-middleware.test.ts
    - apps/web/app/auth/confirm/route.ts
    - apps/web/lib/bootstrap.ts
    - apps/web/app/(platform)/plataforma/tenants/[id]/admins/page.tsx
    - apps/web/messages/pt-BR/platform.json
    - apps/web/e2e/admin.ts

key-decisions:
  - "Resend of a sent/expired invite uses GoTrue admin generateLink({ type: 'invite' }) + the 02-06 template/transport, never inviteUserByEmail again: proven on the local stack (integration case 10) that generateLink regenerates the confirmation token for the existing unconfirmed user — the old token_hash is refused, the new one verifies — so no inviteUserByEmail fallback was needed"
  - "The invited scope lives in requireAuth as an allow-list of two mounted paths checked after the host check (host mismatch still wins); the bootstrap stays a 200 with membership.status = 'invited' and the web guard lives in requireBootstrap(), so no (app) segment changed"
  - "acceptInvite marks tenant_invites by user_id OR citext e-mail (a row whose back-reference was never set still flips) and replays as 'already_active' with zero writes when the membership is already active; anything else (blocked, missing) is 409 not_invited"
  - "A pending invite is resendable from the panel once a verified primary host exists (delegated to sendPendingInvites); without one the button is disabled with the helper and the API answers 409 no_verified_primary — the panel never guesses"
  - "Integration cases that read the GoTrue-originated first mail attach *.localhost hosts instead of the plan's .cliente.test: GoTrue only honours a redirectTo inside additional_redirect_urls (http://*.localhost:3000/** locally); a foreign host produces a neutral 'Rede Social' mail linking to http://localhost:3000?token_hash=… with no /auth/confirm"
  - "Single catalog namespace acceptInvite (file acceptInvite.json) with an expired.* group, per the outline; UI-SPEC's invite/inviteExpired names are left for 02-16's catalog audit"

patterns-established:
  - "Onboarding scope allow-list in requireAuth (INVITED_ALLOWED_PATHS) — extend it, never bypass it, when a future lifecycle state needs its own screen"
  - "Kernel-transport mail send outside the Send Email Hook: resendInvite is the reference composition for Phase 7 notification mail"
  - "Playwright invite flow: super_admin token from GoTrue on the Node side → platform API (create, attach, verify) → Mailpit link → browser on the tenant origin; per-test suffix + created.{slugs,emails} ledger cleaned in afterAll"

requirements-completed: [ROLE-03, PWA-03]

coverage:
  - id: D1
    description: "A tenant provisioned from the panel gets its first admin_tenant onboarded end to end: verified host → GoTrue branded invite through the 02-06 hook → /auth/confirm?type=invite → /aceitar-convite branded by the tenant (heading names the tenant, --brand-primary equals the persisted colour) → password + both consents → POST /v1/me/accept-invite → membership active, two consent rows, invite accepted → /inicio; the consumed link lands on /convite-expirado; the accepted admin is not bounced"
    requirement: ROLE-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/invite.spec.ts#1. attach (fake) -> verified -> invite mail -> accept -> /inicio (tracer) (mobile-chromium + desktop-chromium)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#1-4 (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "accept-invite is idempotent and race-safe, refuses stale consent versions with no write, refuses a cross-tenant host, acts only on the caller's own membership, records ip/user-agent from the trusted headers and accepted_at from the DB clock (AUTH-04 not skipped for admins)"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#2,5,6,7,8"
        status: pass
    human_judgment: false
  - id: D3
    description: "An invited admin's Bearer may reach only /v1/me/bootstrap and /v1/me/accept-invite (403 MEMBERSHIP_INVITED { tenantName } elsewhere, after the host check); the web routes an invited session from /inicio, /configuracoes, /perfil back to /aceitar-convite"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/auth-middleware.test.ts#c3,c4,c5"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/invite.spec.ts#1 (page.goto(link1) lands on /aceitar-convite via the invited bootstrap; /inicio after acceptance stays)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Resend lifecycle from the panel: GET/POST /v1/platform/tenants/{id}/invites* (super_admin only, member 403, foreign inviteId 404); a resend of a sent invite mints a fresh token, mails a second branded invite (subject/From in the tenant's name and colour) and supersedes the previous link; accepted → 409 already_accepted; pending without a verified host → 409 no_verified_primary and no mail; pending with a verified host → first send (one mail)"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#9,10,11,12,13"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/invite.spec.ts#2. panel resend supersedes the old link; the new link accepts; the Admins tab shows Aceito em; #3. pending invite without a verified host"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/mounts.test.ts#4 (both invite paths mounted under /v1/platform)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every string of /aceitar-convite, /convite-expirado and the resend control lives in the pt-BR catalog; no hex, legacy class or pt-BR literal in the new TSX"
    requirement: PWA-03
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh (root pnpm lint)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Visual fidelity to the approved mockups (accept-invite, expired-invite, tenant-page-admins): the branded invite mail and the accept screen look right in a real client/browser; a 40+ character tenant name wraps to at most two centred lines on mobile (E08 long-text backstop)"
    requirement: ROLE-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/invite.spec.ts#2 (heading textContent verbatim 'Associação São José …', scrollWidth <= clientWidth on the iPhone project)"
        status: pass
    human_judgment: true
    rationale: "The automated check proves no horizontal overflow and no truncated code point; line count, spacing and the mail's rendering in Mailpit vs. real clients need a human look (see Human-check notes)"

# Metrics
duration: 22min
completed: 2026-09-17
status: complete
---

# Phase 02 Plan 10: First-Admin Onboarding and Invite Lifecycle Summary

**The first admin now gets in: GoTrue's branded invite lands on `/auth/confirm?type=invite` on the tenant's own host, `/aceitar-convite` (branded by the 02-08 layout) takes the password through Supabase and both D-03 consents through `POST /v1/me/accept-invite` — one admin transaction that flips the membership `invited → active`, writes the two `consent_records` rows and marks the invite `accepted` — and lands on `/inicio`; invited sessions are confined to the two onboarding routes (`403 MEMBERSHIP_INVITED` elsewhere, `requireBootstrap()` routes them back); expired, consumed or superseded links land on `/convite-expirado`; and Rede Social can list and resend invites from the Admins tab (`generateLink` + the kernel mail transport, supersession proven), with 409s for accepted invites and tenants without a verified host.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-09-17T01:43:45Z
- **Completed:** 2026-09-17T02:05:45Z
- **Tasks:** 3 (Task 1 tracer; Task 2 TDD RED + GREEN; Task 3 auto)
- **Files modified:** 23 (9 created, 14 modified)

## Accomplishments

- **Accept path (ROLE-03, D-29, D-03, D-10):** `tenancy/accept-invite.ts` runs the whole acceptance in ONE `withAdminTx` — stale versions refused before any write (`400 { consents: 'stale' }`), the `invited → active` flip with `joined_at` as the serialising row lock, two consent rows with `accepted_at` from the DB clock and `ip`/`user_agent` from the trusted headers, the invite row flipped by `user_id` or citext e-mail. Idempotent by construction (`already_active` replay writes nothing) and race-safe (two concurrent accepts → one flip, two consent rows, one `accepted_at`). The password never reaches the API: the `/aceitar-convite` action sets it through `@supabase/ssr`'s `updateUser` first, so a failure between the two steps leaves a recoverable state.
- **Screens (approved mockups `accept-invite`, `expired-invite`):** `/aceitar-convite` on the 02-08 `(auth)` layout with `PasswordField`, `ConsentFields`, `SubmitButton` and a single `role=alert` line driven by an allow-listed `?campos=`; `/convite-expirado` as a no-input `EmptyState` (`MailX`) with one outline "Voltar para login"; `/auth/confirm` branches `type=invite` failures there instead of the recovery form. `requireBootstrap()` routes invited sessions to the accept screen; `acceptInviteRedirectPath` keeps the accept page from redirecting to itself.
- **Invited scope (T-02-122):** `requireAuth` confines `invited` memberships to `/v1/me/bootstrap` and `/v1/me/accept-invite` after the host check (host mismatch still answers `TENANT_HOST_MISMATCH`), so an invited admin's Bearer cannot reach module or tenant routes before accepting the rules and terms.
- **Resend lifecycle (D-30):** `resendInvite` branches on the row — `pending` → `sendPendingInvites` (one first-send implementation), `sent`/`expired` → GoTrue admin `generateLink({ type: 'invite' })` + `buildActionLink` + `renderInvite` in the tenant brand + `mailTransport.send` (3 s budget, per-send idempotency key), `accepted` → `409 already_accepted`, no verified primary host → `409 no_verified_primary`, foreign `inviteId` → `404`. `listTenantInvites` + the two routes chained on `tenantsRoutes`. Integration case 10 proves the supersession: the first `token_hash` is refused after the resend, the second opens a session.
- **Admins tab:** `ResendInviteButton` fills 02-12's typed slot — outline "Reenviar convite", "Reenviando…" with `aria-busy`, disabled + helper while a pending invite has no verified host, nothing once accepted; `resendInviteAction` revalidates the tenant layout so the "Convite enviado em …" pill refreshes.
- **Proof:** `invites.test.ts` 17/17 + `auth-middleware.test.ts` 13/13 (whole integration suite 151/151), `invite.spec.ts` 3 tests × 2 projects (whole e2e suite 119 passed, 33 pre-existing skips), unit 15/15 (api) + 46/46 (web), `pnpm lint && pnpm typecheck && pnpm build` green, `check-ui-literals.sh` green.

## Task Commits

1. **Task 1: tracer — first admin accepts the invite** — `f99bb4d` (feat)
2. **Task 2 RED: failing tests for the invite lifecycle** — `bee3cf2` (test)
3. **Task 2 GREEN: MEMBERSHIP_INVITED scope, resendInvite + listTenantInvites, platform invite routes** — `cbf85bd` (feat)
4. **Task 3: "Reenviar convite" in the Admins tab + lifecycle e2e** — `8f4c5a7` (feat)

**Plan metadata:** see the final `docs(02-10): …` commit.

## TDD Gate Compliance

| Task | RED | GREEN | REFACTOR | Status |
|------|-----|-------|----------|--------|
| 2 | `bee3cf2` — 30 tests discovered, 7 failing on assertions for the planned behaviour (`expected 404 to be 200` on the resend route, `expected 200 to be 403` for the invited scope, `ERROR_CODES` missing `MEMBERSHIP_INVITED`); `gsd check tdd-red-evidence` → `RED_EVIDENCE_OK` (target: invites.test.ts case 9) | `cbf85bd` — 30/30 | — (no cleanup needed) | compliant |

## Files Created/Modified

- `packages/contracts/src/invites.ts` — `acceptInviteFormSchema`, `INVITE_STATE_REASONS`, `inviteParamsSchema`, `tenantInvitesListSchema`; `errors.ts` — `MEMBERSHIP_INVITED`, `INVITE_STATE_INVALID`; `packages/core/server/http/api-error.ts` — their pt-BR messages
- `packages/core/server/tenancy/accept-invite.ts` — `acceptInvite` (one admin tx, idempotent, race-safe)
- `packages/core/server/auth/require-auth.ts` — `INVITED_ALLOWED_PATHS` + `MEMBERSHIP_INVITED` refusal after the host check
- `packages/core/server/platform/invites.ts` — `listTenantInvites`, `resendInvite` (generateLink + kernel mail; 409/404 branches)
- `apps/api/src/routes/me.ts` — `POST /accept-invite`; `apps/api/src/routes/platform/tenants.ts` — `GET …/invites`, `POST …/invites/{inviteId}/resend`; `apps/api/tests/unit/mounts.test.ts` — both paths pinned
- `apps/web/app/auth/confirm/route.ts` — invite branch → `/convite-expirado`; `apps/web/lib/bootstrap.ts` — invited guard, `acceptInviteRedirectPath`, `MEMBERSHIP_INVITED` mapping
- `apps/web/app/(auth)/aceitar-convite/{page,actions}.tsx`, `apps/web/app/(auth)/convite-expirado/page.tsx`, `apps/web/messages/pt-BR/acceptInvite.json`
- `apps/web/app/(platform)/plataforma/tenants/[id]/admins/{page,actions}.tsx`, `apps/web/components/platform/ResendInviteButton.tsx`, `apps/web/messages/pt-BR/platform.json` (`admins.resent`, `admins.resendFailed`)
- `apps/api/tests/integration/invites.test.ts` (17 cases), `apps/api/tests/integration/auth-middleware.test.ts` (c4/c5), `apps/web/e2e/invite.spec.ts` (3 tests), `apps/web/e2e/admin.ts` (4 helpers)

## Decisions Made

- **Resend mechanism (plan discretion, now proven):** `generateLink({ type: 'invite' })` regenerated the confirmation token for the existing unconfirmed user on the local stack — case 10 shows the old `token_hash` refused and the new one verifying — so the `inviteUserByEmail` fallback the plan reserved was never needed and GoTrue's `email_sent` budget is untouched by resends.
- **Invited scope as an allow-list in `requireAuth`** (two mounted paths, trailing slash stripped) placed after the host check; the bootstrap stays a 200 with `membership.status = 'invited'` and the guard lives in `requireBootstrap()`.
- **Accept marks the invite by `user_id` OR citext e-mail** so a row whose back-reference was never set still flips; the replay outcome (`already_active`) is logged but not exposed.
- **`.localhost` hosts for the GoTrue-mailed integration cases** (see Deviations) — the plan's `.cliente.test` hosts cannot yield a confirm link locally.
- **Catalog:** one `acceptInvite` namespace with an `expired.*` group (outline file name); 02-16's audit may rename.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Integration cases 9/13 used `*.localhost` hosts instead of the plan's `inv-<random>.cliente.test`**
- **Found during:** Task 2 (RED run — case 9 failed on "no token_hash in the mail" instead of the resend status)
- **Issue:** GoTrue only honours an `inviteUserByEmail` `redirectTo` inside `additional_redirect_urls` (`http://*.localhost:3000/**` locally). For a `.cliente.test` host it silently falls back to the site URL: the hook receives `redirect_to = http://localhost:3000`, resolves no tenant (neutral "Rede Social" mail) and the link has no `/auth/confirm` — so the first mail could never be asserted and no `token_hash` could be extracted for the supersession case.
- **Fix:** the resend-lifecycle tenant and the case-13 tenant attach `<slug>.localhost` hosts (the same shape the e2e uses); the tracer/edge fixtures that never read a mail keep `.cliente.test`.
- **Files modified:** `apps/api/tests/integration/invites.test.ts`
- **Verification:** case 9 then failed on the intended assertion (`expected 404 to be 200`) in RED and passes in GREEN with the branded first mail (`type=invite`, `/auth/confirm?next=/aceitar-convite`)
- **Committed in:** `bee3cf2` (RED commit)

**2. [Rule 1 - Bug] `inet` assertion in the tracer test compared `ip::text` (`203.0.113.9/32`)**
- **Found during:** Task 1 (first integration run)
- **Fix:** the assertion query reads `host(ip)`; the service was already storing the address correctly.
- **Files modified:** `apps/api/tests/integration/invites.test.ts`
- **Committed in:** `f99bb4d`

---

**Total deviations:** 2 auto-fixed (both Rule 1, both test-side). No production code deviated from the plan; no file outside `files_modified` was touched.
**Impact on plan:** None on scope. Deviation 1 is worth remembering for 02-16's smoke and any hosted proof: an invite mail is only branded and linkable when the tenant host is in GoTrue's redirect allow-list (02-09 adds `https://<host>/auth/confirm**` hosted; locally only `*.localhost` qualifies).

## Issues Encountered

- **API dev server on 8787:** the leftover `tsx watch` process (pid 93310) reloads on every source change, so it was current for both the integration suite (the `globalSetup` reused it) and Playwright; it was left running as found.
- **`pnpm test:integration -- invites`** still runs the whole suite (02-05 note); single files were run with `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>`.
- **RED evidence format:** the gate parses node-test TAP summaries; Vitest was run with `--reporter=tap-flat` and the `# tests / # pass / # fail` lines were appended from its own `ok`/`not ok` count before `check tdd-red-evidence` (verdict `RED_EVIDENCE_OK`).
- **`[auth.rate_limit] email_sent = 2`** did not interfere: every GoTrue-originated first invite goes to a throwaway address, and resends bypass GoTrue's mailer entirely (no `over_email_send_rate_limit` seen across the integration and e2e runs).

## Plan `<output>` answers

- **`generateLink({ type: 'invite' })` on the local stack:** regenerated the token for the existing unconfirmed (invited) user; `properties.hashed_token` returned; the previous `token_hash` is refused by `verifyOtp` afterwards. No `inviteUserByEmail` fallback used.
- **`email_sent` rate limit:** no interference (see Issues).
- **Env names the e2e needed:** `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` (from `apps/web/.env.local` through `playwright.config.ts`, or the process env), `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (read on the Node side via `envValue`, process env first then `apps/api/.env.local`), `SEED_PASSWORD` (fixtures.ts), optional `PLAYWRIGHT_API_URL` (default `http://127.0.0.1:8787`) and `PLAYWRIGHT_MAIL_URL` (default Mailpit `http://127.0.0.1:54324`).
- **`acceptInvite.json` as the 02-04 loader consumed it:** `{ "acceptInvite": { title, subtitle, password, submit, pending, errors: { validation, consents, staleConsent, generic }, expired: { title, body, back } } }` — root key equals the filename prefix, literal accents, U+2026 in `pending`.

## Human-check notes (for `/gsd-verify-work`, `human_verify_mode: end-of-phase`)

- **Branded invite mail:** open Mailpit (`http://127.0.0.1:54324`), search `to:e2e-invite.local` — the newest two "Convite para administrar Associação São José …" messages are the GoTrue-originated first send and the kernel-transport resend for the same address; both should show the amber (`#b45309`) accent/CTA, the tenant name as `<h1>` text (no logo), "Aceitar convite" and the "Enviado pela plataforma Rede Social" footer. Rendering in Gmail/Apple Mail is not exercised locally.
- **Accept screen look:** run `pnpm --filter @rede-social/web exec playwright test invite.spec.ts --headed` (or create a tenant from `/plataforma/novo`, attach `<slug>.localhost`, "Verificar agora", open the Mailpit link) and compare with the `accept-invite` mockup: brand block, 24/700 heading naming the tenant (two centred lines for a 40+ character name on the phone), e-mail sub-line, password field with the eye and the three-segment meter, two 44 px consent rows, one brand CTA.
- **Expired screen:** the consumed link → `/convite-expirado` — icon circle, "Convite expirado", the body line, a single outline "Voltar para login".
- **Admins tab:** `/plataforma/tenants/<id>/admins` for a fresh tenant without a domain → "Convite pendente — aguardando domínio", disabled "Reenviar convite" + helper; after a verified host → enabled; after acceptance → "Aceito em …", no button, the admin row (e-mail in the name slot until Phase 3 profiles).

## Known Stubs

None — every screen and control is wired to live data; the accepted admin's empty profile name (Phase 3) is a documented product gap, not a stub.

## Threat Flags

None beyond the plan's register: the two platform routes sit behind `requireSuperAdmin()` (T-02-125 accepted), `POST /v1/me/accept-invite` acts only on `ctx` ids (T-02-120), tokens/links never leave `resendInvite` except inside the rendered mail (T-02-124), and `/convite-expirado` reads no input (T-02-127).

## User Setup Required

None — the local stack, `scripts/local-env.sh --write` values and the seeded super_admin are the existing prerequisites. Hosted: RESEARCH A4 recommends `Email OTP Expiration = 86400` for invite links (02-16 records it in `docs/DEPLOY.md`).

## Next Phase Readiness

- **02-13 / 02-15 (same wave):** nothing shared; `routes/platform/index.ts` untouched; the Domínios tab can rely on "verify → invite sent" and on the Admins tab enabling the resend once a verified host exists.
- **02-16:** `invite.spec.ts` test 1 is the reusable smoke shape; note the `*.localhost` requirement for GoTrue-mailed links locally.
- **Phase 7:** `resendInvite` is the reference `toMailBrand → render → mailTransport.send` composition outside the hook.
- **Phase 8:** `listTenantInvites` / `resendInvite` are ready to be exposed to `admin_tenant` behind a tenant-lane guard; `INVITE_STATE_REASONS` is the vocabulary to extend (cooldown, expiry customisation).
- No blockers.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*

## Self-Check: PASSED

All 9 created files exist on disk and all four task commits (`f99bb4d`, `bee3cf2`, `cbf85bd`, `8f4c5a7`) are in `git log`.
