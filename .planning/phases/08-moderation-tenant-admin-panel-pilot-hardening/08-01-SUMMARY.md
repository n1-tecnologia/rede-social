---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 01
subsystem: moderation
tags: [moderation, tracer, kernel-capability, append-only, audit-log, comments, rls, pgtap, drizzle, hono, nextjs]
status: complete

requires:
  - phase: 04-feed
    provides: feed_comments soft delete, comment.deleted retraction, CommentItem/CommentsList, the shared ConfirmDialog
  - phase: 07-notifications-web-push-chat
    provides: feedNotificationRetractions (comment.deleted marks the "X respondeu" rows removed)
provides:
  - kernel append-only table public.moderation_log (two policies, revoked update/delete/truncate, immutability triggers)
  - recordModerationAction(tx, ctx, entry) and moderationExcerpt(body) in @rede-social/core/server/moderation/log
  - listModerationLog(ctx, query) in @rede-social/core/server/moderation/read
  - kernel permission moderation.manage (admin_tenant only)
  - "@rede-social/contracts/moderation subpath (actions, subject types, caps, KERNEL_PERMISSIONS, removal enum, log query/page schemas)"
  - feed_comments.deleted_by_user_id and the D-334 reply cascade on both delete paths
  - server-derived removal ('own' | 'moderation' | null) on every feed comment
  - GET /v1/admin/moderation-log and the /v1/admin mount (adminRoutes)
  - web moderator control, Configurações "Moderação" row, /configuracoes/moderacao page 1
  - orphan-reply repair migration and pgTAP 154-moderation-log
affects: [08-03, 08-04, 08-05, 08-09, 08-10, 08-12, 08.1]

actuals:
  tokens: 173000   # chars/4 over the full realized diff (691,828 chars); ~46,000 of it is hand-written, the rest is two drizzle snapshots
  tasks: 2
  commits: 2
plan_head_before: 33b5303e7878aa2fa61e2be6d03f00ee530c42f0

tech-stack:
  added: []
  patterns:
    - "Kernel audit write inside the owning module's transaction: recordModerationAction(tx, ...) — never a bus subscriber"
    - "Append-only table = select+insert policies only + revoke update/delete/truncate + row and statement triggers raising 42501"
    - "Permission read via permissionsForRequest(ctx) in the ROUTE, before the service opens withTenantTx (pool max 5)"
    - "Server-derived optional enum on a strict contract for release-order compatibility (absent = pre-Phase-8 behaviour)"
    - "Copy-free row: the pure view returns sentence parts (strong/plain); the component never builds markup from a template"
    - "useToast owned by a component that mounts only when a toast must show (PostMedia rule), so lists need no provider in tests"

key-files:
  created:
    - packages/core/db/schema/moderation-log.ts
    - packages/core/server/moderation/log.ts
    - packages/core/server/moderation/read.ts
    - packages/core/tests/moderation-excerpt.test.ts
    - packages/contracts/src/moderation.ts
    - packages/contracts/tests/moderation.test.ts
    - packages/modules/feed/tests/comments-removal.test.tsx
    - apps/api/src/routes/admin/index.ts
    - apps/api/src/routes/admin/moderation.ts
    - apps/api/tests/integration/moderation-comments.test.ts
    - apps/web/app/(app)/configuracoes/moderacao/page.tsx
    - apps/web/components/admin/ModerationLogRow.tsx
    - apps/web/lib/moderation.ts
    - apps/web/lib/moderation-view.ts
    - apps/web/lib/moderation-view.test.ts
    - apps/web/messages/pt-BR/moderation.json
    - apps/web/e2e/moderation.spec.ts
    - supabase/migrations/20261002121805_moderation_log.sql
    - supabase/migrations/20261002123245_moderation_log_immutable.sql
    - supabase/migrations/20261002123247_feed_comments_orphan_replies.sql
    - supabase/tests/154-moderation-log.sql
  modified:
    - packages/core/db/schema/index.ts
    - packages/core/server/rbac/require-role.ts
    - packages/core/ui/nav.ts
    - packages/contracts/package.json
    - packages/modules/feed/db/schema.ts
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/server/routes.ts
    - packages/modules/feed/ui/CommentItem.tsx
    - packages/modules/feed/ui/CommentsList.tsx
    - packages/modules/feed/ui/index.ts
    - packages/modules/feed/tests/events.test.ts
    - apps/api/src/app.ts
    - apps/api/tests/unit/registry.test.ts
    - apps/api/tests/integration/modules.test.ts
    - apps/web/lib/feed-view.tsx
    - apps/web/lib/registry.tsx
    - apps/web/app/(app)/configuracoes/page.tsx
    - apps/web/app/(app)/post/[postId]/page.tsx
    - apps/web/app/(app)/reels/page.tsx
    - apps/web/app/(app)/comunidades/[communityId]/page.tsx
    - apps/web/messages/pt-BR/app.json
    - apps/web/e2e/admin.ts
    - scripts/check-static-routes.sh
    - supabase/tests/020-tenant-isolation.sql
    - supabase/tests/040-schema-conventions.sql
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "Moderation is a KERNEL capability (no flag, no packages/modules/moderation): feed and stories call recordModerationAction(tx, ...) inside their own transaction, so a removal without its log row is impossible"
  - "The feed comment DELETE keeps its shipped 200 { deleted: true } (the plan said 204): changing a live route's status is a breaking change and the web only checks res.ok; the response is identical for own and moderation removals"
  - "removal is .optional() on the strict commentSchema; the web reads an absent value as canDelete ? 'own' : null, so the Phase 8 web can ship before the Phase 8 API"
  - "The log's actor and target are NOT NULL membership ids resolved in the same transaction; no FK on any user or membership column; tenant_id references tenants with no cascade"
  - "Until admin.json exists (later plans), the Moderação screen's back label, role names and error copy live under moderation.log.{back,roles,errors}"

patterns-established:
  - "Pattern: append-only audit table — two policies, revoke update/delete/truncate, row + statement triggers raising 42501, pgTAP proving every lane including the owner"
  - "Pattern: tenant admin API lives under /v1/admin, tenant lane only, each route behind requirePermission(...)"

requirements-completed: [MODER-01, MODER-03]

coverage:
  - id: D1
    description: "A moderator removes a member's root comment with its replies atomically with one anchored moderation_log row; the replies' notifications are retracted and the author is not notified"
    requirement: MODER-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-comments.test.ts#moderation tracer"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/moderation.spec.ts#moderation tracer (mobile-chromium, desktop-chromium)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Members and support cannot remove other people's comments (bare 404) or read the log (403); idempotency and concurrency of removals and log appends"
    requirement: MODER-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-comments.test.ts#moderation tracer"
        status: pass
    human_judgment: false
  - id: D3
    description: "moderation_log refuses update, delete and truncate in the tenant lane, the admin lane and as the table owner; CHECKs and the membership-anchor invariant hold"
    requirement: MODER-03
    verification:
      - kind: other
        ref: "pnpm supabase test db (154-moderation-log.sql 28/28, 020, 040)"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /v1/admin/moderation-log lists newest first with live names, isViewer and the excerpt; the Moderação screen renders the sentence, context, excerpt and tenant-time stamp"
    requirement: MODER-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-comments.test.ts#moderation tracer"
        status: pass
      - kind: unit
        ref: "apps/web/lib/moderation-view.test.ts"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/moderation.spec.ts#moderation tracer"
        status: pass
    human_judgment: false
  - id: D5
    description: "Server-derived removal control on every feed comment, moderation label/dialog/toast in the shared list, release-order compatible contract"
    requirement: MODER-01
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/comments-removal.test.tsx"
        status: pass
      - kind: unit
        ref: "packages/contracts/tests/moderation.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Legacy orphan replies of already-deleted roots are repaired idempotently and stay identifiable"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-comments.test.ts#orphan repair"
        status: pass
    human_judgment: false
  - id: D7
    description: "The Moderação screen's look on a phone (UI-D-277/278 geometry, excerpt block, permanence line)"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity to the UI-SPEC is not asserted by any test; the 08-12 real-device pass covers it"

duration: 26min
completed: 2026-10-02
---

# Phase 8 Plan 01: Moderation tracer (remove a comment, find it in Moderação) Summary

**Kernel append-only `moderation_log` written by `recordModerationAction(tx)` inside the feed's comment delete, with the reply cascade, `moderation.manage`, `GET /v1/admin/moderation-log` and the Moderação screen, proven end to end from Postgres to the browser.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-10-02T12:13:33Z
- **Completed:** 2026-10-02T12:40:01Z
- **Tasks:** 2
- **Files modified:** 51 (incl. two generated drizzle snapshots)

## Accomplishments

- `public.moderation_log`: four actions, two subject types, 280/500 caps, NOT NULL membership anchors, no user/membership FKs, two keyset indexes, select + insert policies only. A custom migration revokes update, delete and truncate and adds row and statement triggers that raise 42501 for every lane, the owner included.
- Kernel writer `recordModerationAction(tx, ctx, entry)`. It resolves both memberships in the caller's transaction, cuts the excerpt on a word without splitting a grapheme, and logs ids only. Kernel reader `listModerationLog` returns keyset pages newest first, with live names and `isViewer` computed in SQL.
- Feed `deleteComment` now does the following:
  - locks the row with `for update`;
  - decides author-or-`moderation.manage`, with one bare 404 for every miss;
  - soft-deletes the root and its live replies in one statement, with `deleted_by_user_id` set;
  - writes the log row in the same transaction when the actor is not the author;
  - emits one `comment.deleted` per removed id.
- Every comment read derives `removal`, and the permission is read before the transaction.
- `GET /v1/admin/moderation-log` sits behind `requireAuth` + `requirePermission('moderation.manage')` and answers `no-store`. It is mounted at `/v1/admin`.
- Web changes:
  - the shipped trash control now carries the moderation name "Remover comentário de {author}" and opens the moderation dialog;
  - confirming removes the row with its replies, the count drops by 1 + N, and the "Comentário removido." toast shows;
  - Configurações gains a permission-gated "Moderação" row;
  - `/configuracoes/moderacao` renders page 1 with the UI-D-278 sentence, context, excerpt and tenant-time stamp.
- One-off DML migration repairing replies orphaned under roots deleted the pre-Phase-8 way. It is idempotent and leaves `deleted_by_user_id` null.

## Task Commits

1. **Task 1: tracer, from the kernel table to the Moderação screen** - `51fba20` (feat)
2. **Task 2: lock the log, repair orphan replies, pgTAP 154/020/040** - `d319dd0` (feat)

**Plan metadata:** see the docs(08-01) commit that adds this file.

## Files Created/Modified

- `packages/core/db/schema/moderation-log.ts`: the kernel audit table, CHECKs, indexes and the two policies.
- `packages/core/server/moderation/log.ts`: `recordModerationAction`, `moderationExcerpt` and `ModerationEntry`.
- `packages/core/server/moderation/read.ts`: `listModerationLog` (keyset, tenant lane).
- `packages/contracts/src/moderation.ts`: the vocabulary, caps, `KERNEL_PERMISSIONS`, `commentRemovalSchema` and the log query/entry/page schemas.
- `packages/modules/feed/server/{service,routes}.ts`: the widened delete, the cascade, `removal` on every read, and the permission read in the route.
- `packages/modules/feed/ui/{CommentItem,CommentsList}.tsx`: `removalOf`, the moderation label, dialog and toast, and the root+replies removal.
- `apps/api/src/routes/admin/{index,moderation}.ts`: the `/v1/admin` group and the log route.
- `apps/web/app/(app)/configuracoes/moderacao/page.tsx`, `apps/web/components/admin/ModerationLogRow.tsx`, `apps/web/lib/{moderation,moderation-view}.ts`: the screen.
- `supabase/migrations/2026100212{1805_moderation_log,3245_moderation_log_immutable,3247_feed_comments_orphan_replies}.sql`: one generated migration, then the immutability migration, then the data repair.
- `supabase/tests/154-moderation-log.sql` (28 cases), `020`/`040` additions.

## Decisions Made

- Moderation is a kernel capability, as the plan's Claude's Discretion choice recorded. `role_changed` is in the action CHECK from day one. Removals always go through `ConfirmDialog`, and there is no undo.
- The feed DELETE keeps its shipped `200 { deleted: true }` (see Deviations).
- `removal` is optional on the strict contract. Absent means `canDelete ? 'own' : null`, so the release order is free.
- The moderation copy for the screen's back label, role names and errors lives under `moderation.log.*` until a later plan creates `admin.json`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 4 avoided - live contract] Kept the feed DELETE at `200 { deleted: true }` instead of the plan's 204**
- **Found during:** Task 1
- **Issue:** The plan's truths say the route "answers 204". The shipped route answers 200 with `{ deleted: true }`, and existing integration tests assert that. Production is live, so changing the status would break the route's contract for no product gain.
- **Fix:** The status and body are unchanged. The intent of the truth still holds: the response is identical for an own delete and a moderation removal and never names who removed it. The OpenAPI description was updated for moderators.
- **Files modified:** `packages/modules/feed/server/routes.ts`
- **Verification:** `moderation-comments.test.ts` asserts 200 + `{ deleted: true }` on both paths. `feed-interactions.test.ts` is unchanged and green.
- **Committed in:** 51fba20

**2. [Rule 3 - Blocking] The "commentSchema without `removal` parses" test lives in the feed package**
- **Found during:** Task 1
- **Issue:** `packages/contracts` may not import `@rede-social/module-feed` (MOD-02 boundary, `turbo boundaries`).
- **Fix:** The contracts test proves the optional-enum shape. `packages/modules/feed/tests/comments-removal.test.tsx` parses the real `commentSchema` with and without `removal`.
- **Committed in:** 51fba20

**3. [Rule 3 - Blocking] Extended the existing e2e helper instead of adding a duplicate**
- **Found during:** Task 1 (e2e)
- **Issue:** `createFeedCommentAs` already existed in `apps/web/e2e/admin.ts`, so adding a second one was a redeclaration.
- **Fix:** Added an optional `parentId` to the existing helper. This is backward compatible, and the Reels spec is untouched.
- **Committed in:** 51fba20

**4. [Rule 2 - Correctness] An author's own root delete also drops the visible count by 1 + replies**
- **Found during:** Task 1
- **Issue:** The server now cascades on both paths (D-334), but the list decremented the own path by 1 only.
- **Fix:** `confirmDelete` removes a root together with its loaded thread and calls `onCountChange(-(1 + replyCount))` on both paths. The own dialog's `bodyWithReplies` copy and the race/failure toasts remain 08-03's.
- **Committed in:** 51fba20

**5. [Adaptation] 020's "USING-touches-0" case for `moderation_log` is a `throws_ok` 42501**
- **Found during:** Task 2
- **Issue:** The lane holds no UPDATE privilege on the log, so no `USING` clause is ever reached.
- **Fix:** An update aimed at B's rows is asserted as refused outright. B-invisible and adjacency cases are added beside it, and the plan was recounted (157 → 160).
- **Committed in:** d319dd0

**6. [Adaptation] Moderation labels reach the comment list through an optional `tm` translator on `feedCommentsProps`**
- **Found during:** Task 1
- **Issue:** The registry's comment block is built from the `feed` namespace translator only.
- **Fix:** The four feed surfaces (Início, post page, community page, Reels) pass `getTranslations('moderation')`. The story host does not yet, because story-comment moderation is 08-03. Without it the list keeps the own dialog, and which dialog opens is still decided by the server's `removal`.
- **Committed in:** 51fba20

**7. [Adaptation] The revoke names `anon` and `api_user` as well, although locally neither held the privileges**
- **Found during:** Task 2 (`\dp public.moderation_log`: `postgres`, `authenticated` and `service_role` held `arwdDxtm`)
- **Fix:** All four roles are revoked, with the observed grantees recorded in the migration header. A hosted project's default privileges can differ, and revoking a privilege that was never granted is a no-op.
- **Committed in:** d319dd0

---

**Total deviations:** 7 (1 contract-preserving correction, 2 blocking, 1 correctness, 3 adaptations).
**Impact on plan:** No scope creep. Every truth holds except the literal status code, whose intent is preserved.

## Issues Encountered

- pgTAP 040: comparing a `text[]` and then a `string_agg` of `name` values hit "dissimilar column types" and then "could not determine which collation". Fixed with `is()` over `string_agg(tgname::text …)`.

## Verification Run

- DB reset consent: the developer consented on 2026-10-02 (this session) to `pnpm db:reset && pnpm db:seed` on the LOCAL stack for every Phase 8 plan. A backup was taken at `~/rede-social-local-backups/pre-08-reset.sql`. Two resets ran, both local only.
- Task 1 verify:
  - contracts test, core typecheck, lint and test, feed typecheck, lint and test, api typecheck, lint and unit tests, and `pnpm boundaries`: all green;
  - `vitest run tests/integration/moderation-comments.test.ts -t "moderation tracer"`: 11/11;
  - web typecheck and lint, `vitest run lib/moderation-view` (8/8), `check-ui-literals` OK;
  - `playwright test moderation.spec.ts -g "moderation tracer"`: 2/2 (mobile-chromium, desktop-chromium).
- Tracer feedback gate (interactive, `end-of-phase`, automated-only verify): the verify was re-run green before expansion, with no checkpoint.
- Task 2 verify:
  - `pnpm db:generate` produced no diff after the migrations were committed;
  - `pnpm supabase test db` PASS, 22 files and 764 tests, including 154 (28/28);
  - `moderation-comments`, `isolation` and `feed-interactions` green (61 tests).
- Extra regression runs:
  - full `pnpm --filter @rede-social/api test:integration`: 43 files, 720 tests, all green;
  - web vitest: 51 files, 1194 tests;
  - `feed-comments.spec.ts` e2e green;
  - root `pnpm lint` green.
- Inherited e2e reds (WINDOWS 69-71, `e2e:pwa`) were not exercised by this plan's runs. They remain 08-02's.
- Not run: `scripts/check-static-routes.sh`, which needs a production web build that this plan's verify does not include. The new `REQUIRED_KEYS` entry is checked at the next build gate.

## Known Stubs

None that block the plan's goal. The Moderação screen is at tracer depth by design: page 1 only, with no action chips, paging or pull to refresh. 08-03 owns those, plus story-comment moderation and the own dialog's "with replies" body.

## Threat Flags

None. The only new network surface, `GET /v1/admin/moderation-log`, is in the plan's threat model (T-08-04, T-08-07).

## User Setup Required

None. The three migrations are expand-only and are listed for 08-12's `supabase db push` release step.

## Next Phase Readiness

- 08-03 can chain the story-comment removal onto `recordModerationAction(tx, …)` with `subjectType: 'story_comment'`, and extend the screen with chips and paging over the same `listModerationLog`.
- 08-04 and 08-05 write `member_blocked`, `member_unblocked` and `role_changed` through the same writer in the admin lane, and mount their routes on `adminRoutes`.
- The two prohibitions (D-335 silence, MODER-03 privacy) are covered so far as follows: no notification row for the author (integration), and ids-only log lines (code). There is no automated log-line scan yet; `/gsd-secure-phase` should verify them.

## Self-Check: PASSED

- All 16 key created files exist on disk.
- Commits `51fba20` and `d319dd0` are present in `git log`.

---
*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Completed: 2026-10-02*
