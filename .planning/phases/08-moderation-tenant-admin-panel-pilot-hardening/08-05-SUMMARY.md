---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 05
subsystem: moderation
tags: [member-admin, roles, guards, row-locks, permissions, admin-lane, radiogroup, portal, nextjs, hono, D-332, D-340, UI-D-273, UI-D-275, UI-D-284]
status: complete

requires:
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-04: lockAdminsAndTarget, decideAccessChange, readMemberForAdmin, the /v1/admin/members router, MemberAdminSheet, the Membros list and its actions, MEMBER_ADMIN_REFUSALS (with `blocked` reserved for this plan), the admin.json role copy"
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-01: recordModerationAction(tx) with the role_changed variant and the moderation_log CHECK that already allows it"
provides:
  - "decideRoleChange (pure) and setMembershipRole(ctx, membershipId, role) in @rede-social/core/server/tenancy/member-admin"
  - "memberRoleBodySchema in @rede-social/contracts/moderation"
  - "PUT /v1/admin/members/{membershipId}/role behind requirePermission('members.manage')"
  - "RoleOptionList (the three-option radiogroup with its brand confirm) and ProfileAdminTrigger (the profile header's admin entry)"
  - "changeMemberRoleAction and the shared handleAdminRefusal / runMemberAction mapping in configuracoes/membros/actions.ts"
  - "putMemberRole and loadAdminMemberForProfile in apps/web/lib/admin-members.ts; setMembershipRole in e2e/admin.ts"
affects: [08-09, 08-10, 08-12, 08.1]

actuals:
  tokens: 26000   # chars/4 over this plan's diff in apps/ and packages/ (104,117 chars, 18 files)
  tasks: 2
  commits: 6      # MEASURED: git rev-list --count 371119e..HEAD; 3 are this plan's, 3 are concurrent quick-261002-f4y commits
plan_head_before: 371119ebf921274a155bd2b3d34b51b0f7a6f209

tech-stack:
  added: []
  patterns:
    - "Role change = the block's write pattern: lockAdminsAndTarget + a pure decision + update with tenant_id = ctx.tenantId + recordModerationAction(tx) in one withAdminTx"
    - "An overlay opened from inside another overlay, or from a sticky header, is portalled to document.body after mount, so its stacking and its exit never depend on the host's"
    - "A confirm whose action decides the next screen awaits the server inside ConfirmDialog.onConfirm (dialog pending, the control behind it aria-busy and inert), never a fire-and-forget transition"

key-files:
  created:
    - apps/web/components/admin/RoleOptionList.tsx
    - apps/web/components/admin/RoleOptionList.test.tsx
    - apps/web/components/admin/ProfileAdminTrigger.tsx
  modified:
    - packages/contracts/src/moderation.ts
    - packages/contracts/tests/moderation.test.ts
    - packages/core/server/tenancy/member-admin.ts
    - packages/core/tests/member-admin-guards.test.ts
    - apps/api/src/routes/admin/members.ts
    - apps/api/tests/integration/member-admin.test.ts
    - apps/web/components/admin/MemberAdminSheet.tsx
    - apps/web/components/admin/MemberAdminSheet.test.tsx
    - apps/web/app/(app)/configuracoes/membros/actions.ts
    - apps/web/app/(app)/configuracoes/membros/AdminMembersList.tsx
    - apps/web/app/(app)/configuracoes/membros/page.tsx
    - apps/web/app/(app)/membros/[membershipId]/page.tsx
    - apps/web/lib/admin-members.ts
    - apps/web/e2e/admin-members.spec.ts
    - apps/web/e2e/admin.ts

key-decisions:
  - "Role-change guard order: self, then invited (not_active), then blocked (any role, even the current one), then same role (no-op), then last_admin. A blocked membership is refused rather than silently no-op'd, so its role never changes behind a suspension"
  - "Permission split (RESEARCH open question 3): the role change needs members.manage; block and unblock keep moderation.manage; the sheet shows each section only for its permission"
  - "The role list's aria-checked always shows the server's role. Arrow keys, Home and End move focus only; choosing (click, Space, Enter) opens the confirm, so a keyboard user never fires a dialog per keystroke"
  - "Role options are <button role=radio> (UI-D-273), with a justified biome-ignore for useSemanticElements: a native radio would check itself on arrow keys and cannot hold the description row"
  - "A role-change success keeps the sheet open (UI-D-273); block, unblock, gone and forbidden still close it"
  - "The role-change toast is fired by the host (list or profile trigger), like the block and unblock toasts"
  - "The profile's admin read happens only for permission holders, after the own-profile redirect and the profile's own notFound(). Any failure there renders no trigger and leaves the profile untouched"

patterns-established:
  - "Pattern: a member action's failure goes through ONE mapping (handleAdminRefusal): session refusal → navigate, 409 → inline refusal, 404 → gone, 403 FORBIDDEN → forbidden"
  - "Pattern: an overlay rendered from a sticky header or from inside another overlay is portalled to <body> after mount"

requirements-completed: [ADMIN-02, MODER-03]

coverage:
  - id: D1
    description: "Role tracer: the admin promotes member@rede-demo.local through PUT …/role. The answer is 200 and no-store. ONE role_changed row with { from: member, to: admin_tenant } exists. The member's next bootstrap, on the token minted before the change, carries moderation.manage, members.manage and tenant.manage. The demotion writes a second row, and the member's next admin call is 403"
    requirement: ADMIN-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-admin.test.ts#role tracer"
        status: pass
      - kind: unit
        ref: "packages/contracts/tests/moderation.test.ts#memberRoleBodySchema"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-332 guards: self for each admin (any role); invited is not_active; blocked and blocked_at-only are blocked; the same role is a no-op 200 with no row; the sequential last_admin; another admin can be promoted or demoted. Also: role vocabulary 400, a rede-lab or unknown id is the bare 404, support and member get 403, and a rede-demo session on the lab host gets TENANT_HOST_MISMATCH"
    requirement: ADMIN-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-admin.test.ts#role guards"
        status: pass
      - kind: unit
        ref: "packages/core/tests/member-admin-guards.test.ts#decideRoleChange"
        status: pass
    human_judgment: false
  - id: D3
    description: "Concurrency: with exactly two active admins, mutual demotions (Promise.all) give one 200 and one 409 last_admin, and one active admin remains (stable over 6 repeated runs)"
    requirement: ADMIN-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-admin.test.ts#role guards > two admins demoting each other at once"
        status: pass
    human_judgment: false
  - id: D4
    description: "ADMIN-02 adjacency: two memberships share the admin's display name. The admin's own membership is refused as self; the twin is changed"
    requirement: ADMIN-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-admin.test.ts#role guards > ADMIN-02 adjacency"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every real role change writes its role_changed row in the same transaction (MODER-03). The same role writes none"
    requirement: MODER-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-admin.test.ts#role tracer; #role guards > the same role is 200"
        status: pass
    human_judgment: false
  - id: D6
    description: "The role list (UI E05): named radiogroup, arrow/Home/End focus, current role checked, the role-specific brand confirm, cancel keeps the selection, busy and inert while the server answers, a refusal reverts with the inline alert, disabled with the helper on a blocked member, and the sheet's permission split"
    requirement: ADMIN-02
    verification:
      - kind: unit
        ref: "apps/web/components/admin/RoleOptionList.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/components/admin/MemberAdminSheet.test.tsx#role list (08-05)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/admin-members.spec.ts#role tracer; #the role list is disabled for a blocked member (mobile + desktop)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The profile entry (UI E07, D-340): the 44px Ellipsis button for admins, absent from the DOM for a member. It opens the sheet without 'Ver perfil', and a block from there lands on Membros filtered to Bloqueados with the toast"
    requirement: ADMIN-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/admin-members.spec.ts#the profile admin trigger; #a block from the profile lands on Bloqueados (mobile + desktop)"
        status: pass
    human_judgment: false
  - id: D8
    description: "UI-D-284 and E04/error: a demoted admin's action shows the forbidden toast, and the refreshed screen is notFound(). A vanished member shows the gone toast, the sheet closes and the row leaves"
    requirement: ADMIN-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/admin-members.spec.ts#a demoted admin taps an action; #a vanished member (mobile + desktop)"
        status: pass
    human_judgment: false
  - id: D9
    description: "UI E07/partial backstop: on a real iPhone, opening the sheet from the profile header and blocking a test member lands on Bloqueados with the toast, and the blocked member's phone shows 'Acesso suspenso'"
    verification: []
    human_judgment: true
    rationale: "Real-device behaviour. It belongs to the D-345 real-device checklist (08-12), which is blocked until run; phones cannot reach *.localhost"

duration: 31min
completed: 2026-10-02
---

# Phase 8 Plan 05: Role changes from the member sheet and the profile Summary

**Admins can now promote or demote any other member (Membro, Suporte, Administrador) from the shared member sheet. Each change is confirmed and guarded by D-332. The kernel `setMembershipRole` holds the same `order by id for update` locks as a block, logs `role_changed { from, to }` in the same transaction, and the change applies on the member's next request. The same sheet opens from a member's profile header. A demoted admin or a vanished member gets one clear toast and a refresh.**

## Performance

- **Duration:** 31 min
- **Started:** 2026-10-02T14:43:35Z
- **Completed:** 2026-10-02T15:15:28Z
- **Tasks:** 2
- **Files modified:** 18 (3 created, 15 modified)

## Accomplishments

- **Kernel `setMembershipRole`** (`packages/core/server/tenancy/member-admin.ts`):
  - runs in `withAdminTx` and reuses `lockAdminsAndTarget`;
  - the pure `decideRoleChange` checks, in order: `self`, `not_active`, `blocked`, the no-op, then `last_admin`;
  - the update carries `tenant_id = ctx.tenantId`;
  - `recordModerationAction(tx, { action: 'role_changed', details: { from, to } })` writes the log row in the same transaction;
  - the log line carries ids and role names only.
- **Route** `PUT /v1/admin/members/{membershipId}/role`:
  - behind `requirePermission('members.manage')`;
  - body is `memberRoleBodySchema` (strict `TENANT_ROLES`);
  - envelopes for 400/403/404/409;
  - every answer is `no-store`.
- **`RoleOptionList`** (UI-D-273, UI-D-288):
  - a named radiogroup of three `role="radio"` options, each with its description; the brand `Check` sits on the current role;
  - roving focus with the arrow keys, Home and End;
  - the role-specific `ConfirmDialog tone="brand"`, portalled to `<body>`;
  - while the server answers, the confirm shows its pending state and the group is `aria-busy` and `inert`;
  - a refusal shows the inline `role="alert"` line;
  - a blocked membership gets a disabled list with the helper.
- **The sheet and the list:**
  - `MemberAdminSheet` shows the list only for `members.manage`, above the access action;
  - after a successful change the sheet stays open;
  - the Membros list updates the row in place and fires the toast.
- **`ProfileAdminTrigger`** (D-340, UI-D-275):
  - the 44px `Ellipsis` in the profile's `PageHeader`;
  - rendered only for `members.manage` or `moderation.manage` holders, after the own-profile redirect;
  - opens the same sheet without "Ver perfil", portalled out of the header's stacking context;
  - a block lands on `/configuracoes/membros?status=blocked` with the toast.
- **UI-D-284:** `handleAdminRefusal` is the one mapping for every member action:
  - a session refusal navigates;
  - 409 is the inline refusal;
  - 404 is `gone` (toast, the sheet closes, refresh);
  - 403 `FORBIDDEN` is `forbidden` (toast, refresh into `notFound()`).

## Task Commits

1. **Task 1 (tracer): an admin promotes or demotes a member from the sheet, guarded, logged and effective on the next request.** `46c0c42` (feat)
2. **Task 2: the last admin can never be removed, admins reach the sheet from a profile, and a lost permission is told.** `c265dc9` (feat)
3. **Format fix for the Task 1 kernel file**, found by the plan-level root `pnpm lint`. `6cd9d03` (style)

**Plan metadata:** the docs(08-05) commit that adds this file.

## Files Created/Modified

See `key-files` in the frontmatter. The main ones:
- `packages/core/server/tenancy/member-admin.ts`: `decideRoleChange` and `setMembershipRole`.
- `apps/api/src/routes/admin/members.ts`: the PUT route.
- `apps/web/components/admin/{RoleOptionList,ProfileAdminTrigger}.tsx`: the role list and the profile entry.
- `apps/web/components/admin/MemberAdminSheet.tsx`: the role section.
- `apps/web/app/(app)/configuracoes/membros/actions.ts`: `changeMemberRoleAction` and the shared refusal mapping.
- `apps/web/app/(app)/membros/[membershipId]/page.tsx`: the trigger in the header.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The profile's sheet rendered under the TopBar**
- **Found during:** Task 2 (e2e)
- **Issue:** The trigger sits in the sticky `PageHeader`, which is its own z-40 stacking context. The sheet opened from it therefore stacked below the z-50 mobile TopBar, and the TopBar intercepted taps on the sheet's buttons.
- **Fix:** `ProfileAdminTrigger` portals `MemberAdminSheet` to `<body>` after mount.
- **Files modified:** `apps/web/components/admin/ProfileAdminTrigger.tsx`
- **Committed in:** `c265dc9`

**2. [Rule 1 - Bug] The role confirm outlived its action**
- **Found during:** Task 2 (e2e, the vanished-member case)
- **Issue:** The confirm fired the action inside a `startTransition` and asked to close at once. In practice the close was held until the async transition settled, so the dialog sat open with no pending state while the request ran. It was also nested inside the sheet's animated panel.
- **Fix:**
  - `onConfirm` now awaits the server action, so the dialog shows its own spinner and disabled buttons, the group behind it stays `aria-busy` and `inert`, and the dialog closes when the answer arrives;
  - the dialog is portalled to `<body>`;
  - the e2e asserts the role confirm's scrim covers the whole viewport.
- **Files modified:** `apps/web/components/admin/RoleOptionList.tsx`, `apps/web/e2e/admin-members.spec.ts`
- **Committed in:** `c265dc9`

**3. [Rule 1 - Bug] The 08-04 320px ellipsis backstop read the layout once**
- **Found during:** Task 2 (full `admin-members.spec.ts` run)
- **Issue:** The check failed twice in full runs and passed alone. Probed in isolation it measured 490 > 206 px (the text does truncate), so the single read was landing before the row's final layout.
- **Fix:** `expect.poll` around the same `scrollWidth > clientWidth` check.
- **Files modified:** `apps/web/e2e/admin-members.spec.ts`
- **Committed in:** `c265dc9`

**4. [Rule 3 - Blocking] The `role guards` suite assumed exactly two admins**
- **Found during:** Task 2 (full integration file)
- **Issue:** 08-04's `block concurrency` leaves its throwaway second admin active, so the tenant had three admins.
- **Fix:** The describe's `beforeAll` demotes this run's throwaway admins and asserts that exactly two remain.
- **Committed in:** `c265dc9`

**5. [Adaptation] Files outside the plan's list**
- `apps/web/app/(app)/configuracoes/membros/page.tsx` passes `canManageMembers` to the list.
- `apps/web/lib/admin-members.ts` gains `putMemberRole` and `loadAdminMemberForProfile`.
- `apps/web/e2e/admin.ts` gains `setMembershipRole` (the "demoted in another tab" fixture).
- **Committed in:** `46c0c42`, `c265dc9`

**6. [Adaptation] The e2e role tracer uses a throwaway member**
- **Issue:** The truth names `member@rede-demo.local`, but `e2e/admin.ts` forbids leaving seeded users changed, and a failed browser run could leave the seed member an admin.
- **Fix:**
  - The browser tracer promotes a throwaway member who signed in before the change, in a second browser context, and checks that their very next Configurações load shows the Membros row.
  - The API `role tracer` runs the change on `member@rede-demo.local` itself and restores it in `afterAll`. This is the 08-04 deviation 4 precedent.
- **Committed in:** `46c0c42`

**7. [Adaptation] The sequential `last_admin` case is reached through a simulated grant**
- **Issue:** An acting admin is always one of the active admins, so a sequential `last_admin` cannot occur with the default grants.
- **Fix:** The case overrides the permission resolver so that support holds `members.manage`, the 08-04 precedent for D-338's future grant. The concurrent case reaches `last_admin` with the default grants.
- **Committed in:** `c265dc9`

**8. [Adaptation] `admin.json` is unchanged**
- **Issue:** Every catalog key this plan names (`roleConfirm.*`, `roleLabel`, `roleBlockedHelper`, `toasts.roleChanged`, `actions`, `admin.errors.forbidden`, `members.errors.gone`) was already written by 08-04.
- **Fix:** None needed. The file is in the plan's list but has no diff.

---

**Total deviations:** 8 (3 bugs, 1 blocking, 4 adaptations).
**Impact on plan:** No scope creep. Every truth holds, except the real-device E07/partial backstop, which is the 08-12 checklist's by plan.

## Issues Encountered

- **Concurrent commits from another session.** The quick task `quick-261002-f4y` committed three times while this plan ran: `f9e3d30` (docs), `3c05be4` (docs) and `9588bd3` (ci, `.github/workflows/deploy-hml.yml`), all between Task 1 and Task 2. None touched this plan's files. The measured `commits: 6` counts them; three of the six are this plan's.
- **DB resets.** The developer consented on 2026-10-02 (this execution session) to `pnpm db:reset && pnpm db:seed` on the LOCAL Supabase stack for every Phase 8 plan. A backup exists at `~/rede-social-local-backups/pre-08-reset.sql`. Three local resets ran in this plan. Nothing touched the hosted Supabase, GCP or Vercel projects, and nothing was deployed or pushed.
- **Process hygiene.** Playwright started and stopped its own API and web servers on every run. No `tsx watch` or `next dev` process was left running (checked). A temporary probe spec was created for debugging and deleted, never committed.

## Verification Run

- **Task 1:**
  - contracts test (85);
  - core test (292);
  - api typecheck and lint;
  - `vitest components/admin` (27);
  - after a reset, `member-admin.test.ts -t "role tracer"`: 2/2;
  - `playwright admin-members.spec.ts -g "role tracer"`: 2/2 (mobile + desktop).
  - The tracer feedback gate (interactive, `end-of-phase`, automated-only verify) re-ran green with the full-viewport scrim assertion before expansion, with no checkpoint.
- **Task 2:**
  - after a reset, `member-admin.test.ts`: 44/44;
  - the concurrency case repeated 6 times: 6/6;
  - web typecheck and lint;
  - `check-ui-literals` OK;
  - `playwright admin-members.spec.ts members.spec.ts profile.spec.ts`: 71 passed and 1 skipped (the 320px backstop is mobile only by design).
- **Plan level:**
  - `member-admin` + `members` + `isolation` integration: 102/102;
  - web vitest: 55 files, 1328 tests;
  - root `pnpm lint` green after `6cd9d03`;
  - `pnpm boundaries`: no issues.
- **Acceptance greps:**
  - `export async function setMembershipRole`: 1;
  - `'role_changed'` in `member-admin.ts`: 1;
  - `requirePermission('members.manage')`: 1;
  - `role="radiogroup"`: 1;
  - `role guards`: 1, and `Promise.all` is present (4);
  - `ProfileAdminTrigger` in the profile page: 3;
  - `status=blocked` in `ProfileAdminTrigger.tsx`: 1.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- The role route is T-08-26, T-08-27 and T-08-28.
- The profile's admin read is T-08-30. It goes to the existing `GET /v1/admin/members/{id}` and is made only for permission holders.
- The UI-D-284 mapping is T-08-29.

## User Setup Required

None. There are no migrations. The route and the UI ship with the next release.

## Next Phase Readiness

- Member management (ADMIN-02) is complete: the list, block and unblock, roles, and the profile entry.
- The Moderação screen already renders `role_changed` rows (08-03).
- 08-12's D-345 real-device checklist should include the E07/partial row: block from the profile header on an iPhone.

## Self-Check: PASSED

- Created files exist: `RoleOptionList.tsx`, `RoleOptionList.test.tsx`, `ProfileAdminTrigger.tsx`.
- Commits `46c0c42`, `c265dc9` and `6cd9d03` are in `git log`.

---
*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Completed: 2026-10-02*
