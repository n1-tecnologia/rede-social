---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 04
subsystem: moderation
tags: [moderation, member-admin, block, admin-lane, row-locks, keyset, membership, realtime, push, nextjs, hono, D-330, D-331, D-332, D-333, D-339, D-340]
status: complete

requires:
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-01/08-03: moderation_log, recordModerationAction(tx), moderation.manage, the /v1/admin mount, the Moderação screen that already renders member_blocked / member_unblocked rows"
  - phase: 07-notifications-web-push-chat
    provides: "app.push_subscriptions_delete_dead, app.realtime_signal, LiveShell + LiveCountersProvider, the chat member_blocked 409 (D-333)"
provides:
  - "blockMembership / unblockMembership / lockAdminsAndTarget / decideAccessChange in @rede-social/core/server/tenancy/member-admin (admin lane, D-332 guards under one order-by-id row lock)"
  - "listMembersForAdmin / getMemberForAdmin / readMemberForAdmin in @rede-social/core/server/tenancy/admin-members (e-mail, status folding, three-key keyset)"
  - "GET /v1/admin/members, GET /v1/admin/members/{id}, POST …/block, POST …/unblock"
  - "@rede-social/contracts/moderation: ADMIN_MEMBER_STATUSES, adminMemberListQuerySchema, adminMemberSchema, adminMemberPageSchema, memberAccessBodySchema, MEMBER_ADMIN_REFUSALS, MembershipBlocked and the EventMap entry 'membership.blocked'"
  - "notifications subscriber onMembershipBlocked (eager push cleanup + notifications.changed nudge)"
  - "LiveCountersProvider onRefused hook; the counters BFF forwards 403 MEMBERSHIP_BLOCKED with the blocked flow's path; LiveShell lands there"
  - "/configuracoes/membros (page, loading, actions, AdminMembersList), AdminMemberRow, MemberAdminSheet (main + confirm step), the Membros row in Configurações"
  - "apps/web/messages/pt-BR/admin.json (root admin) and moderation.member.*"
affects: [08-05, 08-09, 08-10, 08-12, 08.1]

actuals:
  tokens: 53400   # chars/4 over this plan's three task commits (213,788 chars, 33 files)
  tasks: 3
  commits: 4      # MEASURED: git rev-list --count 36755be..HEAD; 3 are this plan's, fc9ab92 is a concurrent quick-task docs commit
plan_head_before: 36755be256f20e6df2508ca8319ab7d7c773a9d6

tech-stack:
  added: []
  patterns:
    - "Admin-lane membership write: ONE `select … order by id for update` over the active admins plus the target, a pure decision function, the update and recordModerationAction(tx) in the same withAdminTx, emit after commit"
    - "Three-key keyset inside the shared {v, n, id} envelope: n is the JSON array of the two text keys read back from the projection"
    - "A kernel bus event a module subscribes to for best-effort side effects: each step in its own tenant-lane transaction, logged with ids only, never thrown"
    - "A BFF route forwards exactly one refusal code with a server-built same-origin path; the shell navigates only to /auth/blocked"

key-files:
  created:
    - packages/core/server/tenancy/member-admin.ts
    - packages/core/server/tenancy/admin-members.ts
    - packages/core/tests/member-admin-guards.test.ts
    - packages/modules/notifications/server/membership-blocked.ts
    - packages/modules/notifications/tests/membership-blocked.test.ts
    - apps/api/src/routes/admin/members.ts
    - apps/api/tests/integration/member-admin.test.ts
    - apps/web/lib/admin-members.ts
    - apps/web/components/admin/AdminMemberRow.tsx
    - apps/web/components/admin/MemberAdminSheet.tsx
    - apps/web/components/admin/MemberAdminSheet.test.tsx
    - apps/web/components/shell/LiveShell.blocked.test.ts
    - apps/web/app/(app)/configuracoes/membros/page.tsx
    - apps/web/app/(app)/configuracoes/membros/loading.tsx
    - apps/web/app/(app)/configuracoes/membros/actions.ts
    - apps/web/app/(app)/configuracoes/membros/AdminMembersList.tsx
    - apps/web/messages/pt-BR/admin.json
    - apps/web/e2e/admin-members.spec.ts
  modified:
    - packages/contracts/src/moderation.ts
    - packages/contracts/tests/moderation.test.ts
    - packages/core/ui/realtime/LiveCountersProvider.tsx
    - packages/core/tests/live-counters.test.tsx
    - packages/modules/notifications/module.ts
    - apps/api/src/routes/admin/index.ts
    - apps/web/app/(app)/configuracoes/page.tsx
    - apps/web/app/api/me/counters/route.ts
    - apps/web/components/shell/LiveShell.tsx
    - apps/web/messages/pt-BR/moderation.json
    - apps/web/messages/pt-BR/app.json
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/admin.ts
    - apps/web/e2e/blocked.spec.ts
    - scripts/check-static-routes.sh

key-decisions:
  - "Status folding everywhere: blocked = status 'blocked' OR blocked_at set (the app.membership_for_user rule); invited and active both require blocked_at null, so the three filters are disjoint; an unblock also clears a legacy blocked_at-only row"
  - "The admin list runs in the admin lane (users is self-select only and invited admins have no name), with m.tenant_id = ctx.tenantId and m.deleted_at is null on every statement"
  - "Block/unblock refusals are 409 CONFLICT { member: self | last_admin | not_active }, the chat module's details convention; an unknown or foreign id is the bare 404"
  - "The 'membership.blocked' EventMap entry is declared against '@rede-social/contracts' by name: a relative declare module './events' stopped the module contracts' entries merging in the API program"
  - "The counters BFF forwards ONE refusal with a body (403 MEMBERSHIP_BLOCKED + /auth/blocked path); the kernel LiveCountersProvider gained onRefused and never interprets the body"
  - "Search and chips use router.replace (UI-D-271, the /membros rule): a keystroke is not a history entry; back/forward restore the query when the admin leaves and returns"
  - "admin.json is created here; moderation.log.{back,roles,errors} stay where 08-01 put them (the log screen keeps working); moving them is for the plan that next touches the log"

patterns-established:
  - "Pattern: guarded admin-lane membership write = lockAdminsAndTarget + decideAccessChange + update + recordModerationAction(tx) + emit after commit"
  - "Pattern: best-effort post-commit side effect = module manifest events subscriber, one transaction per step, ids-only failure log"

requirements-completed: [MODER-02, ADMIN-02, MODER-03]

coverage:
  - id: D1
    description: "An admin blocks and unblocks a member: 200, both columns written/cleared, one member_blocked / member_unblocked log row with the reason and both memberships, the member's next request 403 MEMBERSHIP_BLOCKED then 200; idempotent repeats write no row; self 409, invited 409 not_active, only active admin 409 last_admin; a rede-lab id the bare 404; support and member 403"
    requirement: MODER-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-admin.test.ts#block tracer"
        status: pass
      - kind: unit
        ref: "packages/core/tests/member-admin-guards.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Concurrency: two concurrent blocks give both 200 and one log row; block + unblock end consistent with one row per real transition; mutual blocks of the only two admins give one 200 and one 409 last_admin and leave one active admin"
    requirement: MODER-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-admin.test.ts#block concurrency"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /v1/admin/members lists every membership (active, staff, blocked incl. blocked_at-only, invited) with e-mail; name (accent-insensitive) or e-mail search, literal %, spaces-only q, empty result shape, stable twins and a limit=1 walk, nameless rows by e-mail, tampered cursor, 403 for support/member, tenant isolation and TENANT_HOST_MISMATCH"
    requirement: ADMIN-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-admin.test.ts#admin list"
        status: pass
      - kind: unit
        ref: "packages/contracts/tests/moderation.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Membros screen: Configurações row, the sheet's block and unblock with reason, toasts and pills in place, the Bloqueados/Convidados empty states, search and chips on the URL restored through history, invited and blocked sheet variants, focus back to the row, and the 320px long-text backstop"
    requirement: ADMIN-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/admin-members.spec.ts (mobile-chromium + desktop-chromium; the 320px case is mobile only by design)"
        status: pass
      - kind: unit
        ref: "apps/web/components/admin/MemberAdminSheet.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#08-04"
        status: pass
    human_judgment: false
  - id: D5
    description: "Block effects: the member's push devices are deleted and notifications.changed lands on their user topic (ids only); their comment stays listed (D-330); the reason is in no member-facing body (D-331); signup with the same e-mail is 409 EMAIL_ALREADY_REGISTERED; staff reply 409 member_blocked while blocked and 201 after unblock (D-333)"
    requirement: MODER-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-admin.test.ts#block effects"
        status: pass
      - kind: unit
        ref: "packages/modules/notifications/tests/membership-blocked.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "A member with /inicio open lands on 'Acesso suspenso' within 15 s of an admin's block, with no manual reload; unblock and sign-in restore"
    requirement: MODER-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/blocked.spec.ts#blocked by an admin with the app open (both projects)"
        status: pass
      - kind: unit
        ref: "apps/web/components/shell/LiveShell.blocked.test.ts; packages/core/tests/live-counters.test.tsx#08-04"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every real block/unblock writes its moderation_log row in the same transaction (MODER-03), which the shipped Moderação screen lists under Bloqueios / Desbloqueios"
    requirement: MODER-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-admin.test.ts#block tracer"
        status: pass
    human_judgment: false
  - id: D8
    description: "The Membros list and the member sheet look and feel right on a phone (UI-D-271..274 geometry, sticky toolbar, sheet step swap, pull to refresh)"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity and the pull gesture are not asserted by any test; the 08-12 real-device pass covers them"

duration: 35min
completed: 2026-10-02
---

# Phase 8 Plan 04: Block and unblock from the Membros admin list Summary

**Admins find any membership in the new Configurações → Membros screen, including blocked and invited ones, by name or e-mail. They block or unblock it from one sheet with an optional internal reason. The kernel writes the membership row under the D-332 guards and row locks, and logs it in the same transaction. After commit, a `membership.blocked` event cleans the member's push devices and sends their open app to the shipped "Acesso suspenso" flow within seconds.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-10-02T14:04:45Z
- **Completed:** 2026-10-02T14:39:55Z
- **Tasks:** 3
- **Files modified:** 33

## Accomplishments

- **Kernel block and unblock** (`packages/core/server/tenancy/member-admin.ts`), in the admin lane, with `tenant_id = ctx.tenantId` on every statement:
  - one `order by id for update` statement locks every active admin plus the target;
  - the pure `decideAccessChange` checks self, then invited, then the no-op, then last admin;
  - the update writes both columns, and `recordModerationAction(tx, …)` logs in the same transaction;
  - `membership.blocked` is emitted after commit.
- **Kernel admin list** (`admin-members.ts`):
  - every membership of the tenant, with the e-mail, the folded status and `isViewer` computed in SQL;
  - name-or-e-mail search through the directory's own `normaliseQuery` and `likeEscape`;
  - a total order (folded name or e-mail, then e-mail, then id), paged by a three-key keyset in the shared envelope.
- **Routes:** `/v1/admin/members` (list, single read, block, unblock). Reads need `members.manage` or `moderation.manage`; writes need `moderation.manage`. Every answer is `no-store` and the logs carry ids only.
- **Membros screen.**
  - A permission-gated Configurações row in the UI-D-269 order.
  - `notFound()` for anyone without either permission, and on the platform host.
  - A sticky search and four chips on the URL, a generation-guarded `InfiniteScroll`, pull to refresh, and the 8- and 3-row skeletons.
  - The first-load and load-more errors, plus the per-filter empty copies.
  - `AdminMemberRow`: a button row, the static "Você" row, a pill line that wraps.
  - `MemberAdminSheet`: the identity block, the access action, "Ver perfil", the invited body, and the confirm step. The confirm step has the reason, the counter from 450 characters, inline refusals and pending labels, and focus moves as UI-D-288 says.
- **Felt at once.**
  - The notifications module subscribes to `membership.blocked`. It calls `app.push_subscriptions_delete_dead([userId])` and publishes `notifications.changed` on the member's user topic.
  - The counters BFF forwards 403 `MEMBERSHIP_BLOCKED` together with the blocked flow's path.
  - `LiveCountersProvider` hands refusals to `onRefused`, and `LiveShell` navigates to `/auth/blocked`.

## Task Commits

1. **Task 1 (tracer): admins block and unblock a member from Membros, guarded, logged and scoped to one membership.** `8717c4b` (feat)
2. **Task 2: the full Membros list with search, status chips on the URL, keyset paging and every state.** `7c59bd6` (feat)
3. **Task 3: a block is felt at once.** Eager push cleanup, a Realtime nudge, and the open app on the blocked flow. `e18adc2` (feat)

**Plan metadata:** the docs(08-04) commit that adds this file.

## Files Created/Modified

See `key-files` in the frontmatter. The main ones:
- `packages/core/server/tenancy/{member-admin,admin-members}.ts`: the services.
- `apps/api/src/routes/admin/members.ts`: the routes.
- `apps/web/app/(app)/configuracoes/membros/*` and `apps/web/components/admin/{AdminMemberRow,MemberAdminSheet}.tsx`: the screen.
- `packages/modules/notifications/server/membership-blocked.ts`: the subscriber.
- `apps/web/app/api/me/counters/route.ts` and `components/shell/LiveShell.tsx`: the open-app landing.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The EventMap entry is declared by package name**
- **Found during:** Task 1
- **Issue:** `declare module './events'` type-checked inside contracts. In the API program, though, every module's `emit` then rejected its own event names, because the map did not merge.
- **Fix:** `declare module '@rede-social/contracts'`, the spelling every module contract uses. The docblock explains why.
- **Files modified:** `packages/contracts/src/moderation.ts`
- **Committed in:** `8717c4b`

**2. [Rule 2 - Missing critical] The counters BFF dropped the refusal code**
- **Found during:** Task 3
- **Issue:** `/api/me/counters` answered every API refusal with an empty body, so `LiveShell` could never see `MEMBERSHIP_BLOCKED`. `LiveCountersProvider` also swallowed non-2xx answers.
- **Fix:**
  - The route answers ONE refusal with a body: `{ error: { code: 'MEMBERSHIP_BLOCKED' }, location }`, where the location comes from `bootstrapRedirectPath`.
  - The kernel provider gained `onRefused`; a throwing callback is contained.
  - `landOnBlockedFlow` navigates only on that code, and only to a path starting with `/auth/blocked`.
- **Files modified:** `apps/web/app/api/me/counters/route.ts`, `packages/core/ui/realtime/LiveCountersProvider.tsx`, `packages/core/tests/live-counters.test.tsx`, `apps/web/components/shell/LiveShell.tsx`, and the new `LiveShell.blocked.test.ts`.
- **Committed in:** `e18adc2`

**3. [Rule 1 - Bug] The debounced search fought back/forward**
- **Found during:** Task 2
- **Issue:** The `/membros` debounce pattern runs when `q` changes. It would push the field's stale value back onto the URL after a back/forward. Syncing the field to the URL would also eat a trailing space while the admin types.
- **Fix:** Navigation fires only when the debounced value itself changed. The field follows the URL only when the URL differs from the field's own trimmed value.
- **Files modified:** `AdminMembersList.tsx`
- **Committed in:** `7c59bd6`

**4. [Adaptation] Throwaway subjects in the browser and in the effects suite**
- **Issue:** `e2e/admin.ts` says seeded users must never be left blocked, and posting to the seeded support thread would drift `chat.test.ts`.
- **Fix:**
  - The API `block tracer` uses `member@rede-demo.local` and restores it in `afterAll` even after a failure.
  - The e2e tracer, `block effects` and `block concurrency` use throwaway identities. Each effects subject has its own devices, comment and support thread.
- **Committed in:** `8717c4b`, `e18adc2`

**5. [Adaptation] The sign-up route is `POST /v1/public/signup/{slug}`**
- **Issue:** The plan named `/v1/auth/signup`, which does not exist. The re-registration case uses the shipped route.
- **Committed in:** `e18adc2`

**6. [Adaptation] Back/forward e2e under `router.replace`**
- **Issue:** UI-D-271 binds search and chips through `router.replace`, so a keystroke or chip tap is not a history entry.
- **Fix:** The spec proves the URL is the query this way: it sets `q` and the chip, leaves through the header's back link, returns with `goBack` and forward again, and checks that the field and the chip are restored. It also checks that clearing the field never pushes a stale value back.
- **Committed in:** `7c59bd6`

**7. [Adaptation] Three-key cursor inside the shared envelope**
- **Issue:** `keysetComparison` pairs one key with `id`. The order here has three keys.
- **Fix:** `n` is the JSON array `[sortName, sortEmail]` read back from the projection, compared as one row comparison. A malformed `n` is page 1. This is documented in the docblock, as the plan allowed.
- **Committed in:** `8717c4b`

**8. [Adaptation] E2e and test helpers outside the file list**
- **Fix:** `setMemberDisplayName`, `blockedMembershipCount` and `memberAccessAs` were added to `e2e/admin.ts`, and the 08-04 catalog block to `i18n/messages.test.ts`.
- **Committed in:** `7c59bd6`, `e18adc2`

---

**Total deviations:** 8 (1 blocking, 1 missing critical, 1 bug, 5 adaptations).
**Impact on plan:** No scope creep. Every truth holds. The role list in the sheet is 08-05's, as the plan states.

## Issues Encountered

- **Concurrent commits from another session.** A quick task (`quick-261002-f4y`) committed while this plan ran: `36755be` just before Task 1, and `fc9ab92` (docs/DEPLOY.md) between Task 2 and Task 3. Neither touched this plan's files. The measured `commits: 4` counts `fc9ab92`; three of the four are this plan's.
- **DB resets.** The developer consented on 2026-10-02 (this execution session) to `pnpm db:reset && pnpm db:seed` on the LOCAL Supabase stack for every Phase 8 plan, and a backup exists at `~/rede-social-local-backups/pre-08-reset.sql`. Five local resets ran in this plan. Nothing touched the hosted Supabase, GCP or Vercel projects, and nothing was deployed or pushed.
- **Process hygiene.** Playwright started and stopped its own API and web servers on every run. No `tsx watch` or `next dev` process was left running.

## Verification Run

- **Task 1:**
  - contracts test (83);
  - core typecheck, lint and test (282);
  - api typecheck, lint and unit tests (29);
  - `pnpm boundaries`: no issues;
  - after a reset, `member-admin.test.ts -t "block tracer"`: 11/11;
  - web typecheck and lint, `check-ui-literals` OK;
  - `playwright admin-members.spec.ts -g "block tracer"`: 2/2.
  - The tracer feedback gate (interactive, `end-of-phase`, automated-only verify) re-ran green before expansion, with no checkpoint.
- **Task 2:**
  - web typecheck and lint;
  - `vitest components/admin i18n`: 641;
  - `check-ui-literals` OK;
  - after a reset, `member-admin.test.ts`: 22/22;
  - `playwright admin-members.spec.ts`: 9 passed and 1 skipped (the 320px backstop is mobile only by design).
- **Task 3:**
  - module-notifications typecheck, lint and test (111);
  - web typecheck;
  - `pnpm boundaries`;
  - after a reset, `member-admin`, `chat`, `push` and `realtime` integration files: 67/67;
  - `playwright blocked.spec.ts`: 6/6.
- **Plan level:**
  - after a reset, `member-admin` + `isolation` + `chat`: 76/76;
  - the full `test:integration`: 45 files, 770 tests;
  - web vitest: 54 files, 1312 tests;
  - root `pnpm lint` (including Biome's admin-lane rule) green;
  - regression e2e: `moderation.spec.ts -g "moderation tracer"` 2/2, and the `media-video.spec.ts` admin-group isolation cases 6/6.
- **Acceptance greps:**
  - `member-admin.ts` carries `tenant_id = ${ctx.tenantId}` 3 or more times and `for update` once or more;
  - `status = 'blocked', blocked_at = now()` appears exactly once;
  - `'membership.blocked'` is in the contracts;
  - `configuracoes/membros` appears once in `check-static-routes.sh`;
  - `admin.json` exists, with every key the plan's node check lists;
  - `push_subscriptions_delete_dead` appears once in `membership-blocked.ts`;
  - the describe and test names are each present once.
- **Not run:** `scripts/check-static-routes.sh`, which needs a production web build that this plan's verify does not include. The new `REQUIRED_KEYS` entry is checked at the next build gate (the 08-01 precedent).

## Known Stubs

None. The sheet's role list ("Papel") is 08-05's by plan. Without `members.manage` the sheet already shows the access action alone, which is UI E04/partial.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: response-body | apps/web/app/api/me/counters/route.ts | A same-origin BFF refusal now carries a body for 403 `MEMBERSHIP_BLOCKED` only: the code and a server-built `/auth/blocked?t=<tenant>` path, the same value `requireBootstrap` already redirects to. No reason, no ids. This falls within T-08-24, and the client navigates only to `/auth/blocked…` |

## User Setup Required

None. There are no migrations. The routes, the subscriber and the UI ship with the next release.

## Next Phase Readiness

- 08-05 adds the role list to `MemberAdminSheet` under `members.manage`, with the `blocked` refusal already in `MEMBER_ADMIN_REFUSALS`. It can reuse `lockAdminsAndTarget` for the role change's last-admin guard, and it adds the profile's "⋯" entry (`showViewProfile={false}`).
- The `admin.*` catalog exists. Moving `moderation.log.{back,roles,errors}` into it can happen whenever the log screen is next touched.

## Self-Check: PASSED

- All 17 key created source and test files exist on disk.
- Commits `8717c4b`, `7c59bd6` and `e18adc2` are in `git log`.

---
*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Completed: 2026-10-02*
