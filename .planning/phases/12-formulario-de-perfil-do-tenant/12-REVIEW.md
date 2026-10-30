---
phase: 12-formulario-de-perfil-do-tenant
depth: standard
reviewed: 2026-10-30
files_reviewed: 93
files_reviewed_list:
  - apps/api/src/app.ts
  - apps/api/src/modules/registry.ts
  - apps/api/src/routes/me.ts
  - apps/api/src/routes/members.ts
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/ArchiveDialog.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/ArchivedList.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/ExportDialog.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/FormSummaryCard.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/ImpactDialog.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/LimitsFields.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/OptionsEditor.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/PreviewSheet.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/ProfileFormTabs.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionBuilder.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionEditorSheet.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/QuestionList.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/TypePicker.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/VisibilitySwitches.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/actions.ts
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/editor-state.ts
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/loading.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/page.tsx
  - apps/web/app/(app)/configuracoes/formulario-de-perfil/tabs.ts
  - apps/web/app/(app)/configuracoes/page.tsx
  - apps/web/app/(app)/membros/[membershipId]/page.tsx
  - apps/web/app/(app)/perfil/page.tsx
  - apps/web/app/(app)/perfil/profile-form-actions.ts
  - apps/web/app/(auth)/completar-perfil/actions.ts
  - apps/web/app/(auth)/completar-perfil/loading.tsx
  - apps/web/app/(auth)/completar-perfil/page.tsx
  - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx
  - apps/web/app/api/me/counters/route.ts
  - apps/web/app/api/profile-form/export/route.ts
  - apps/web/components/admin/ModerationLogRow.tsx
  - apps/web/components/profile-form/AnswerValue.tsx
  - apps/web/components/profile-form/MemberAnswersBlock.tsx
  - apps/web/components/profile-form/MyAnswersSection.tsx
  - apps/web/components/profile-form/NewQuestionsNotice.tsx
  - apps/web/components/profile-form/ProfileForm.tsx
  - apps/web/components/profile-form/PublicAnswersBlock.tsx
  - apps/web/components/profile-form/QuestionField.tsx
  - apps/web/components/profile-form/StaffAnswersBlock.tsx
  - apps/web/components/profile-form/fields.tsx
  - apps/web/components/shell/LiveShell.tsx
  - apps/web/lib/bootstrap.ts
  - apps/web/lib/moderation-view.ts
  - apps/web/lib/profile-form/admin-reads.ts
  - apps/web/lib/profile-form/answer-view.ts
  - apps/web/lib/profile-form/download.ts
  - apps/web/lib/profile-form/form-state.ts
  - apps/web/lib/profile-form/link.ts
  - apps/web/lib/profile-form/member-form.ts
  - apps/web/lib/profile-form/number.ts
  - apps/web/lib/profile-form/phone.ts
  - apps/web/lib/profile-form/profile-reads.ts
  - apps/web/lib/profile-form/profile-surfaces.ts
  - apps/web/lib/profile-form/question-types.ts
  - apps/web/lib/profile-form/type-key.ts
  - apps/web/lib/route-handlers.inventory.ts
  - apps/web/lib/safe-next-path.ts
  - apps/web/proxy.ts
  - packages/contracts/src/bootstrap.ts
  - packages/contracts/src/errors.ts
  - packages/contracts/src/moderation.ts
  - packages/contracts/src/modules.ts
  - packages/contracts/src/profile-form.ts
  - packages/core/db/schema/index.ts
  - packages/core/db/schema/member-profiles.ts
  - packages/core/db/schema/moderation-log.ts
  - packages/core/db/schema/profile-form-answers.ts
  - packages/core/db/schema/profile-form-questions.ts
  - packages/core/server/auth/require-auth.ts
  - packages/core/server/http/api-error.ts
  - packages/core/server/logging.ts
  - packages/core/server/moderation/log.ts
  - packages/core/server/profile-form/admin.ts
  - packages/core/server/profile-form/answers.ts
  - packages/core/server/profile-form/csv.ts
  - packages/core/server/profile-form/export.ts
  - packages/core/server/profile-form/lock-rules.ts
  - packages/core/server/profile-form/member.ts
  - packages/core/server/tenancy/membership.ts
  - packages/core/ui/nav.ts
  - packages/modules/profile-form/contracts/index.ts
  - packages/modules/profile-form/module.ts
  - packages/modules/profile-form/server/index.ts
  - packages/modules/profile-form/server/routes.ts
  - packages/modules/profile-form/vitest.config.ts
  - scripts/check-static-routes.sh
  - supabase/migrations/20261029230924_profile_form_module_key.sql
  - supabase/migrations/20261029232606_profile_form_tables.sql
  - supabase/migrations/20261029233037_profile_form_functions.sql
  - supabase/migrations/20261029234918_profile_form_lock_active.sql
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 12: Code Review Report

## Summary

Reviewed at standard depth by reading the four migrations, the kernel services (member, answers, admin, export, csv, lock-rules), `requireAuth` and its membership lookup, the `/v1/me`, `/v1/members` and `/v1/profile_form` routes, the web actions and export relay, `safeNextPath`, and the web form-state and editor-state logic. A cross-tenant read or write could not be constructed. The e2e specs were not run (written, not executed; ledger row M8).

- **Tenant scoping:** every service statement carries `tenant_id`, including the admin-lane export pages. The answer RLS policies are owner, staff or public-and-active. Membership ids in `publicAnswersOf` and `staffAnswersOf` are re-checked against the caller's tenant.
- **Gate:** the allow-list is exact-match after trailing-slash stripping, and `profile_form_missing_self` takes the membership from session claims.
- **Lock rules:** the SQL trigger and the TypeScript `checkLocks`/`narrows` agree check for check (PF001..PF005, same order). Lock order `position, created_at, id` is the same in `app.profile_form_lock_active`, `readActive`, `readActiveQuestions` and the reorder lock, so no deadlock cycle was found.
- **CSV:** the formula-injection guard covers header cells and the full-width trigger forms.
- **`safeNextPath`:** no open-redirect bypass found (`//`, `/\`, `%2F`, double encoding, control characters, look-alike slashes). Only the low-impact gap in IN-03 remains.

The orchestrator spot-checked WR-01 (no role check in `recordAndReadHeader`; `Ctx` carries `role` but it is never compared) and WR-02 (no NUL or surrogate rejection in `contracts/src/profile-form.ts`; the only control-character test is on links) against the source before saving this report.

## Warnings

### WR-01: `exportAnswers` has no role check of its own, and the admin-lane page reads bypass RLS

**File:** `packages/core/server/profile-form/export.ts:80-93` and `126-154`
**Issue:**
- `readPage` runs under `withAdminTx`, so RLS is off. Every member's e-mail, name and every answer, private ones included, is read by predicates alone.
- Authorization lives only in the route guard (`routes.ts:328`, `requirePermission('profile_form.manage')`).
- The audit-row step does not enforce a role either. `moderation_log_tenant_insert` (`packages/core/db/schema/moderation-log.ts:117-121`) only checks `tenant_id` and `actor_user_id`, so it accepts any role.
- `exportAnswers` is a published kernel function. A future route, job or refactor that calls it with a `support_tenant` or `member` ctx gets a complete PII and private-answer dump, with only a normal-looking audit row.
- Every write in `admin.ts` is backstopped by `admin_tenant`-only RLS. Nothing equivalent protects the export, which reads the most sensitive data.

**Fix:** make the service refuse before anything is read or logged.
```ts
export async function exportAnswers(ctx: Ctx, opts = {}) {
  if (ctx.role !== 'admin_tenant') throw new ApiError(403, 'FORBIDDEN');
  ...
}
```

### WR-02: A NUL character or lone surrogate in any free-text value becomes a 500, not a 400

**File:** `packages/contracts/src/profile-form.ts:137-141` (`parseText`), `167-176` (`otherText`), `333-347` (`requiredText`, `helpTextField`), `380-402` (option labels); sinks at `packages/core/server/profile-form/member.ts:341-346` and `admin.ts:275-289`
**Issue:**
- Nothing rejects `\u0000` or an unpaired surrogate in these fields.
- Member answers and "Outro" text are written as `${JSON.stringify(value)}::jsonb`, which carries the NUL as `\u0000`. Postgres jsonb refuses it ("\u0000 cannot be converted to text").
- Question title and help text are bound as plain `text`, where a NUL byte is refused.
- Unpaired surrogates fail similarly.
- Scenario: any authenticated member sends `PUT /v1/me/profile-form/answers` with `{"<qid>": "a\u0000b"}` on a `short_text` question. `parseAnswer` returns ok, the insert throws, `onError` logs `unhandled`, and the member gets a 500 instead of a keyed `invalid`. A gated member is stuck on a 500 for that input, and the log fills with 5xx noise.
- The code comment in `saveAnswers` already says the table CHECK would otherwise raise a 500.

**Fix:** reject these characters in one shared helper used by `parseText`, `otherText`, `requiredText`, `helpTextField` and the option labels.
```ts
const hasUnsafeChars = (s: string) => s.includes('\u0000') || !s.isWellFormed();
// parseText / otherText -> fail('invalid'); zod fields -> .refine(v => !hasUnsafeChars(v), 'invalid')
```

## Info

### IN-01: The BOM constant is a literal invisible U+FEFF although the comment says it is an escape

**File:** `packages/core/server/profile-form/csv.ts:20-21`
**Issue:**
- The comment says "written as an escape so no invisible character lives in the source".
- The file bytes are a literal BOM inside the quotes (reviewer's reading; the orchestrator did not re-verify the bytes).
- An editor, formatter or copy-paste that strips U+FEFF silently removes the BOM. Excel then misreads accents in the export, and the byte-pinning tests may be the only thing that notices.

**Fix:** `export const CSV_BOM = '﻿';`

### IN-02: The export is a state-changing GET, and `sameOriginGet` allows requests with neither `Sec-Fetch-Site` nor `Origin`

**File:** `apps/web/app/api/profile-form/export/route.ts:24`; helper at `apps/web/lib/notifications-bff.ts:58-62`
**Issue:**
- When a browser sends neither header (old Safari on cross-site navigations), the request is accepted.
- A page an admin visits can then trigger the export. That writes an audit row and runs a full member scan.
- The CSV is not readable cross-site, so this is audit-log spam and load, not exfiltration.

**Fix:** for this route require `sec-fetch-site === 'same-origin'` strictly, or make the export a POST with a same-origin check.

### IN-03: `safeNextPath` accepts `/api/*` and `/_next/*` destinations

**File:** `apps/web/lib/safe-next-path.ts:36-56` and `82-86`
**Issue:**
- The exclusion list only covers the form and the `(auth)` paths. `?next=/api/me/counters` (attacker-supplied through a crafted `/completar-perfil?next=` link) passes the shape and exclusion checks.
- After a successful save, `saveProfileFormAction` returns that as the destination and the client navigates to a raw JSON route-handler URL.
- Impact is low: same origin, and the members' routes are GET-read-only.

**Fix:** add `/api` and `/_next` to the excluded prefixes, or allow only paths that map to `(app)` pages.

### IN-04: `reorderBodySchema` lets more than 30 ids through as a generic 400, not the documented `order_mismatch` 409

**File:** `packages/contracts/src/profile-form.ts:491-499`
**Issue:**
- `.max(PROFILE_FORM_LIMITS.activeQuestions)` has no `'order_mismatch'` message.
- `defaultHook` in `routes.ts:60-74` only lifts messages in `PROFILE_FORM_ISSUE_SET` to a coded error.
- A 31-id list therefore gets `VALIDATION_FAILED` with an `issues[]` list, while `routes.ts:171` and the web action's `mismatch` handling expect 409. It is harmless but inconsistent.

**Fix:** `.max(PROFILE_FORM_LIMITS.activeQuestions, 'order_mismatch')`.

_Reviewed: 2026-10-30_
_Reviewer: gsd-code-reviewer (report saved by the orchestrator, which spot-checked WR-01 and WR-02)_
_Depth: standard_
