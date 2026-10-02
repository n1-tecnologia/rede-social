---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 07
subsystem: tenant-admin
tags: [rules, consents, versioning, admin-lane, shared-renderer, hono, nextjs, D-339, D-341, UI-D-280, UI-D-281]
status: complete

requires:
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-05/08-06: the /v1/admin router, the Administração group gated on bootstrap.permissions, admin.json, the UI-D-284 refusal posture, the throwaway-community e2e fixture (createMembersTenant)"
  - phase: 02-tenant-shell-branding-platform-panel
    provides: "D-03: tenants.rules_text / rules_version, the versioned tenant_rules consent, the RulesSheet on /cadastro and /aceitar-convite"
  - phase: 01-foundation
    provides: "signupMember's { consents: 'stale' } refusal and the consent insert at the version in force"
provides:
  - "RULES_TEXT_MAX, RULES_ISSUES, normaliseRulesText, rulesBodySchema, adminRulesSchema in the client-safe @rede-social/contracts/rules, re-exported by legal.ts"
  - "packages/core/server/tenancy/rules.ts: getTenantRules(ctx), saveTenantRules(ctx, rulesText) (admin lane, change-only bump)"
  - "GET and PUT /v1/admin/rules behind tenant.manage, details.rulesText = required | too_long, no-store"
  - "apps/web/components/rules/RulesText.tsx: the one rules renderer (sign-up, accept-invite, preview)"
  - "/configuracoes/regras (page, loading, actions with saveRulesAction, RulesEditor with the preview sheet)"
  - "Configurações 'Regras da comunidade' row (scroll-text), app.settings.rows.rules, admin.rules.*"
affects: [08-08, 08-10, 08-11, 08-12, 08.1]

actuals:
  tokens: 18800   # chars/4 over this plan's added lines in apps/, packages/ and scripts/ (75,279 chars, 23 files)
  tasks: 2
  commits: 3      # MEASURED: git rev-list --count 3da322c..HEAD before this SUMMARY commit (no concurrent quick-task commit in the range)
plan_head_before: 3da322c953fe0f1ffef0ea324e94f5f18471c31a

tech-stack:
  added: []
  patterns:
    - "A contract a client component needs lives in its own client-safe file with a subpath export, and the server-only module re-exports it (legal.ts imports node:fs)"
    - "Change-only version bump in one statement: update … where id = ctx.tenantId and col is distinct from $new returning version; no row means unchanged, answer the current one"
    - "The editor compares its draft through the same normaliser the API stores with, so the UI can never cause an empty bump"

key-files:
  created:
    - packages/contracts/src/rules.ts
    - packages/core/server/tenancy/rules.ts
    - apps/api/src/routes/admin/rules.ts
    - apps/api/tests/integration/admin-rules.test.ts
    - apps/web/components/rules/RulesText.tsx
    - apps/web/components/rules/RulesText.test.tsx
    - apps/web/app/(app)/configuracoes/regras/page.tsx
    - apps/web/app/(app)/configuracoes/regras/loading.tsx
    - apps/web/app/(app)/configuracoes/regras/actions.ts
    - apps/web/app/(app)/configuracoes/regras/RulesEditor.tsx
    - apps/web/app/(app)/configuracoes/regras/RulesEditor.test.tsx
    - apps/web/e2e/admin-rules.spec.ts
  modified:
    - packages/contracts/src/legal.ts
    - packages/contracts/package.json
    - packages/contracts/tests/legal.test.ts
    - packages/core/ui/nav.ts
    - packages/core/server/moderation/README.md
    - apps/api/src/routes/admin/index.ts
    - apps/web/app/(app)/configuracoes/page.tsx
    - apps/web/app/(auth)/RulesSheet.tsx
    - apps/web/messages/pt-BR/admin.json
    - apps/web/messages/pt-BR/app.json
    - scripts/check-static-routes.sh

key-decisions:
  - "The rules contract lives in a client-safe packages/contracts/src/rules.ts (subpath ./rules), re-exported by legal.ts: legal.ts imports node:fs, and the editor (a client component) needs RULES_TEXT_MAX and normaliseRulesText"
  - "The 10,000 cap is counted in UTF-16 code units with value.length only (no z.string().max(), which Zod 4 counts in code points, the 08-06 finding), so it matches the textarea's maxLength"
  - "PUT /v1/admin/rules maps a refusal about the text only to details.rulesText (required | too_long) through a per-route hook; any other key (a tenant id, a version) keeps the shared issue list"
  - "The Regras editor is keyed on the version in force, so a refresh after any save starts from the stored text"
  - "The counter is rendered by the editor, not the Textarea's counter prop, so it reads the catalog's pt-BR grouping ('1.234/10.000') like the chat composer"
  - "A paste that the native maxLength cuts shows 'Use até 10.000 caracteres.' (the browser drops the end silently otherwise); the save stays allowed because the kept text is valid"
  - "The e2e subject is a throwaway community (createMembersTenant(…, 0)); the integration suite runs the tracer on admin@rede-demo.local and restores both seed rules rows (text and version) and the identities it created"

patterns-established:
  - "Pattern: an integration suite that bumps a seed tenant's version restores the version too, because other suites treat version 1 as current and 2 as stale"

requirements-completed: [ADMIN-03]

coverage:
  - id: D1
    description: "Tracer: the admin saves new rules; PUT answers 200 with rulesVersion + 1; the version line reads 'Versão {n} em vigor'; /cadastro's rules sheet shows the new text; the next sign-up records tenant_rules at the new version"
    requirement: ADMIN-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/admin-rules.test.ts#rules tracer > a change answers 200 with the version plus one; a new sign-up presenting the new version"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/admin-rules.spec.ts#rules tracer (mobile + desktop)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-341: the bump happens only when the normalised text changed (identical text, and identical text pasted with CRLF and padding, keep the version); existing consents keep their version; a sign-up holding the old version gets 400 { consents: 'stale' }; no re-acceptance wall"
    requirement: ADMIN-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/admin-rules.test.ts#the same text again keeps the version; an existing member's consent keeps the version; a sign-up still holding the old version"
        status: pass
      - kind: unit
        ref: "packages/contracts/tests/legal.test.ts#tenant rules contract (ADMIN-03)"
        status: pass
      - kind: other
        ref: "grep -c consent_records packages/core/server/tenancy/rules.ts = 0; grep -c 'rules_text is distinct from' = 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "ADMIN-03 empty and encoding: empty or whitespace-only is 400 { rulesText: 'required' }, over 10,000 UTF-16 code units (an emoji counts two) is 400 { rulesText: 'too_long' }, exactly 10,000 is accepted, a strict body refuses any other key"
    requirement: ADMIN-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/admin-rules.test.ts#empty and whitespace-only; 10,001 code units; a body carrying anything else"
        status: pass
      - kind: unit
        ref: "packages/contracts/tests/legal.test.ts#tenant rules contract (ADMIN-03)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Admin lane, tenant-scoped: tenant.manage on both routes (support and member 403), rede-lab's rules never move from rede-demo, rede-lab's admin edits rede-lab only, a rede-demo session on the lab host is 403 TENANT_HOST_MISMATCH"
    requirement: ADMIN-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/admin-rules.test.ts#support and member get 403; rede-lab's admin edits rede-lab only; TENANT_HOST_MISMATCH"
        status: pass
    human_judgment: false
  - id: D5
    description: "One renderer (UI-D-281): RulesText behind /cadastro, /aceitar-convite and the preview; blank-line paragraphs, single breaks kept, long URLs wrap anywhere, text never markup; the preview equals /cadastro's sheet paragraph for paragraph"
    verification:
      - kind: unit
        ref: "apps/web/components/rules/RulesText.test.tsx (5 cases); apps/web/app/(app)/configuracoes/regras/RulesEditor.test.tsx#RulesEditor preview (E14)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/admin-rules.spec.ts#the preview shows exactly what /cadastro shows (mobile + desktop); signup.spec.ts; invite.spec.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Editor states (E13): disabled save while unchanged (CRLF-normalised) or empty, preview disabled while empty, 'Salvando…' while pending, success toast and version bump, server too_long field error, cut-paste error, failure toast with the draft kept, lost-permission toast and refresh"
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/configuracoes/regras/RulesEditor.test.tsx#RulesEditor (E13) (8 cases)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/admin-rules.spec.ts#the save stays disabled while the draft equals the saved text; a failed save toasts and keeps the draft (mobile + desktop)"
        status: pass
    human_judgment: false
  - id: D7
    description: "E14 long-text backstop (automated half): a 10,000-character text reads with identical paragraphs in the preview and on /cadastro, and both sheets scroll inside at 320×568"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/admin-rules.spec.ts#E14 backstop (mobile + desktop)"
        status: pass
      - kind: unit
        ref: "apps/web/components/rules/RulesText.test.tsx#renders every paragraph of a 10,000-character text"
        status: pass
    human_judgment: false
  - id: D8
    description: "D-339 completion: the Administração group holds Marca, Membros, Regras da comunidade, Moderação, Mídia, Seus stories in that order, each row on its own permission, absent from the DOM for a member"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/admin-rules.spec.ts#rules tracer (the row opens /configuracoes/regras); admin-branding/admin-members specs keep the member-absence cases"
        status: pass
    human_judgment: true
    rationale: "The six-row order and the 320px one-line truncation of 'Regras da comunidade' are visual facts no test asserts; the gating is code-reviewed in configuracoes/page.tsx"
  - id: D9
    description: "The Regras screen's look on a phone and on desktop: intro, editor, counter, helper, version line, footer buttons, preview sheet, skeleton"
    verification: []
    human_judgment: true
    rationale: "Visual fit against UI-D-280 and the shell is a judgment no test asserts"

duration: 16min
completed: 2026-10-02
---

# Phase 8 Plan 07: Regras da comunidade Summary

**Admins now edit their community's rules from Configurações → Regras da comunidade and preview them through the same `RulesText` renderer that `/cadastro` and `/aceitar-convite` use. `PUT /v1/admin/rules` (admin lane, `id = ctx.tenantId`, `tenant.manage`) raises `rules_version` by one only when the normalised text changed. New sign-ups consent to the new version, and every recorded consent keeps the version it was accepted at.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-10-02T16:07:28Z
- **Completed:** 2026-10-02T16:23:45Z
- **Tasks:** 2
- **Files modified:** 23 (12 created, 11 modified)

## Accomplishments

- **Contract** (`@rede-social/contracts/rules`, re-exported by `legal.ts`):
  - `normaliseRulesText` converts CRLF and a lone CR to LF, then trims;
  - `rulesBodySchema` normalises first and then checks `required` and `too_long`. The cap is counted in UTF-16 code units, and the schema is strict;
  - `adminRulesSchema` is `{ rulesText, rulesVersion }`.
- **Kernel** (`tenancy/rules.ts`): `getTenantRules` and `saveTenantRules` run in `withAdminTx`.
  - The single update carries `rules_text is distinct from`, so an unchanged text returns the version in force.
  - It never touches the consent table.
  - It logs `tenancy.rules.saved` with ids, the version and `changed`, never the text.
- **API:** `GET` and `PUT /v1/admin/rules` sit behind `requireAuth` and `tenant.manage`. A refusal answers `details.rulesText`, and every answer is `no-store`.
- **Web:**
  - `/configuracoes/regras` holds the intro, the 12-row editor with the "{count}/10.000" counter and helper, the version line, the preview and "Salvar regras". The page answers `notFound()` without `tenant.manage` and on the platform host.
  - The "Regras da comunidade" row (`scroll-text`) takes the third Administração slot, so the D-339 group is now complete.
- **One renderer:** `RulesText` keeps single line breaks (`whitespace-pre-line`) and lets long URLs wrap (`[overflow-wrap:anywhere]`). `RulesSheet` and the editor's preview both render through it.

## Task Commits

1. **Task 1 (tracer): an admin saves new rules and the next sign-up reads and accepts them at the new version.** `6d59af4` (feat)
2. **Task 2: one rules renderer for sign-up, accept-invite and the admin's preview.** `1fc594c` (feat)
3. **Follow-up: the kernel admin routes table lists `GET` and `PUT /v1/admin/rules`.** `83c9d06` (docs)

**Plan metadata:** the docs(08-07) commit that adds this file.

## Files Created/Modified

See `key-files` in the frontmatter. The main ones:
- `packages/core/server/tenancy/rules.ts`: the read and the change-only bump.
- `apps/api/src/routes/admin/rules.ts`: the two routes and the `rulesText` refusal hook.
- `apps/web/app/(app)/configuracoes/regras/RulesEditor.tsx`: the editor, its states and the preview sheet.
- `apps/web/components/rules/RulesText.tsx`: the shared renderer.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The rules contract lives in a client-safe `rules.ts`, re-exported by `legal.ts`**
- **Found during:** Task 1.
- **Issue:** `legal.ts` imports `node:fs` (server-only), and the package root re-exports it. `RulesEditor`, a client component, needs `RULES_TEXT_MAX` and `normaliseRulesText`, and importing them from `legal.ts` would pull `node:fs` into the browser bundle.
- **Fix:**
  - The symbols live in `packages/contracts/src/rules.ts`, exported as `@rede-social/contracts/rules`.
  - `legal.ts` re-exports them (`export * from './rules'`), so the server consumers and the plan's location both still hold.
- **Committed in:** `6d59af4`.

**2. [Rule 2 - Missing critical] Unit test for the editor**
- **Issue:** e2e cannot force several states: a server `too_long`, the lost permission (403 `FORBIDDEN`), a cut paste, or a thrown action.
- **Fix:** `RulesEditor.test.tsx`, 9 cases, uses the real `admin.json` and `signup.json` catalogs. It sets `MotionGlobalConfig.skipAnimations`, the `MemberAdminSheet.test` precedent.
- **Committed in:** `1fc594c`.

**3. [Rule 2 - Missing critical] The kernel README's `/v1/admin` routes table**
- **Issue:** `packages/core/server/moderation/README.md` lists every `/v1/admin` route with its guard, branding and tenant included. Without the new rows it would no longer be true (the 08-09 contract).
- **Fix:** added `GET`/`PUT /v1/admin/rules | tenant.manage`. `module-readmes.test.ts` passes (14 cases).
- **Committed in:** `83c9d06`.

**4. [Adaptation] The e2e subject is a throwaway community, not `admin@rede-demo.local`**
- **Issue:** the tracer truth names the seed admin. Other suites, however, treat rede-demo's version 1 as current and version 2 as stale (for example, `invites.test.ts` case 7), so an e2e bump would leak into them.
- **Fix:**
  - The spec uses `createMembersTenant(…, 0)`, which gives it its own admin and a host that is unique per run and per project.
  - The API integration suite runs the same tracer on `admin@rede-demo.local`. In `afterAll` it restores both seed rules rows (text and version) and deletes the identities it signed up. This follows the 08-06 deviation 5 precedent.
- **Committed in:** `6d59af4`, `1fc594c`.

**5. [Adaptation] Paste-cut error**
- **Issue:** the field's native `maxLength` silently drops the end of a paste that is too long, so "a paste exceeds the cap" could never surface as text over the cap.
- **Fix:** the editor reads the clipboard length on paste. When the paste would pass 10,000, it shows "Use até 10.000 caracteres." until the text drops back under the cap. The server's `too_long` shows the same error.
- **Committed in:** `1fc594c`.

**6. [Acceptance grep wording] Two docblocks reworded**
- `grep -c "rules_text is distinct from"` must print 1, and `grep -c whitespace-pre-line RulesText.tsx` must print 1. The docblocks named the same strings, so they now describe them in other words.
- Under zsh, `grep -c "id = \${ctx.tenantId}"` prints 0 because of how zsh expands the quoted `\$`. Under bash it prints 4, which is the criterion's intent.

**7. [Test fix] The preview title assertion**
- The first Task 2 run expected "Regras da comunidade {slug}". The throwaway tenant's display name is "Comunidade {slug}", so the assertion now names it. There is no product change.

---

**Total deviations:** 7 (1 Rule 3, 2 Rule 2, 2 adaptations, 1 acceptance-grep wording, 1 test fix).
**Impact on plan:** No scope creep. Every truth holds, and the E14 long-text row's automated half is green.

## Issues Encountered

- **DB resets.** The developer consented on 2026-10-02 (this execution session) to `pnpm db:reset && pnpm db:seed` on the LOCAL Supabase stack for every Phase 8 plan, which satisfies the plan's "consent once per session". A backup exists at `~/rede-social-local-backups/pre-08-reset.sql`. This plan ran two local resets, one before each proving run. Nothing touched the hosted Supabase, GCP or Vercel projects, and nothing was deployed or pushed.
- **No migration.** The plan uses the existing `tenants.rules_text` and `rules_version` columns, so production needs nothing before the new API ships.
- **Concurrent session.** No `quick-261002-f4y` commit landed in this plan's range (`3da322c..83c9d06`). The plan's commits carry no co-author trailer.
- **Process hygiene.** Playwright started and stopped its own API and web processes on every run. No `tsx watch` or `next dev` process was left running (checked).
- **Disk.** Every turbo run used `TURBO_CACHE=local:r`. Free space stayed at 13-14 GiB.

## Verification Run

- **Task 1:**
  - contracts test: 108 (9 new);
  - core typecheck and lint, api typecheck and lint;
  - after a reset, `admin-rules.test.ts` + `signup.test.ts`: 22/22, and the seed rules rows were back at version 1 afterwards;
  - web typecheck and lint;
  - `check-ui-literals` OK;
  - `playwright admin-rules.spec.ts -g "rules tracer"`: 2/2 (mobile and desktop).
  - The tracer feedback gate (`end-of-phase`, automated-only verify, auto mode off) passed on that green run, so expansion continued with no checkpoint.
- **Task 2:**
  - web typecheck and lint;
  - `vitest components/rules i18n` plus the editor test: 644;
  - `check-ui-literals` OK;
  - after a reset, `playwright admin-rules.spec.ts signup.spec.ts invite.spec.ts`: 34/34 on the second run. The first run had 2 failures from the title assertion (deviation 7), and the serial mode skipped 6 cases.
- **Plan level:**
  - web vitest: 58 files, 1350 tests;
  - api unit: 43, `module-readmes.test.ts` included;
  - root `pnpm lint` green;
  - `pnpm boundaries`: no issues.
- **Not run:** `scripts/check-static-routes.sh` needs a production `next build`. The new `REQUIRED_KEYS` entry is checked at the 08-12 gate's `pnpm verify`.
- **Acceptance greps (bash):**
  - `rules_text is distinct from`: 1;
  - `id = ${ctx.tenantId}`: 4;
  - `consent_records` in `rules.ts`: 0;
  - `configuracoes/regras` in `check-static-routes.sh`: 1;
  - `RulesText` in `RulesSheet.tsx`: 3;
  - `whitespace-pre-line` in `RulesText.tsx`: 1;
  - `RulesText` in `RulesEditor.tsx`: 7.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- T-08-36: `tenant.manage` on both routes, and the admin-lane update is scoped by `id = ctx.tenantId`. The rede-lab and host-mismatch cases are green.
- T-08-37: the consent table is never touched. Old consents keep their version (integration), and stale sign-ups are refused.
- T-08-38: `RulesText` renders React text only. A unit case proves that markup is shown as text.
- T-08-39: the 10,000 code-unit cap applies in the contract and in `maxLength`, and both sheets scroll inside their 80% height.

## User Setup Required

None. There are no migrations. The routes and the screen ship with the next release.

## Next Phase Readiness

- ADMIN-03's editor is complete, and the D-339 Administração group is now complete in the UI-D-269 order.
- `REQUIREMENTS.md` still reads ADMIN-03 Pending, by design. The shared-ID gate (`requirements.ready-ids`) keeps it open because 08-10, 08-11 and 08-12 also declare ADMIN-03, and the last of those to finish flips it. A premature `mark-complete` was reverted before commit.
- 08-08's CSP covers the rules text on the public sign-up page (T-08-38's second layer).
- 08-12's D-345 real-device checklist can add one row: edit the rules on a phone and read them on `/cadastro`.

---
*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Completed: 2026-10-02*

## Self-Check: PASSED

- All 12 created files exist on disk.
- Commits `6d59af4`, `1fc594c` and `83c9d06` are in `git log`, and none carries a co-author trailer.
