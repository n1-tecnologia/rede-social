---
phase: quick-261016-aqc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/modules/courses/db/schema.ts
  - supabase/migrations/*_courses_material_soft_delete.sql
  - supabase/migrations/*_courses_asset_gate_fail_closed.sql
  - supabase/migrations/meta/_journal.json
  - supabase/migrations/meta/*_snapshot.json
  - supabase/tests/195-courses-member.sql
  - docs/DEPLOY.md
  - packages/modules/courses/server/service.ts
  - packages/modules/courses/README.md
  - apps/api/tests/integration/courses.test.ts
  - apps/api/tests/integration/media-playback.test.ts
  - apps/web/e2e/courses-admin.ts
  - apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.tsx
  - apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.test.tsx
autonomous: true
requirements: [COURSE-19, COURSE-20, COURSE-26]
tags: [courses, asset-gate, pgtap, rls, materials, pwa, review-fix, 08.5]

estimate:
  tokens: 85000
  raw_tokens: 85000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "WR-01 / COURSE-20 / T-08.3-08: an asset that is, or ever was, a course material of the tenant stays GOVERNED by app.course_asset_hidden. A member who cannot open any LIVE lesson holding it through a LIVE material row gets true (so GET /v1/media/{assetId}/original answers the bare 404) after its lesson is soft-deleted, after its module is soft-deleted, and after it is detached through PUT /v1/courses/lessons/{lessonId}/materials. admin_tenant still gets false (302). Lesson videos behave exactly as before."
    - "Detaching a material soft-deletes its course_lesson_materials row (deleted_at) instead of removing it. The detached row is absent from the admin lesson detail, the admin material URL route (bare 404) and app.course_lesson_material_list (so the member lesson, the replay and the member URL route). Re-attaching the same asset revives the same row: same material id, created_at kept, no duplicate."
    - "WR-03: app.course_lesson_access answers 'missing', never NULL, when app.course_lesson_states returns no row for a lesson the outer join accepted. So content, materials, the progress with check and the asset gate fail closed if the two liveness predicates ever drift."
    - "WR-02: tapping 'Baixar' on a member lesson material or a replay material calls window.open('', '_blank') synchronously inside the tap, before any await, and sets opener to null. It then points that tab at the freshly minted URL. A refusal or a thrown action closes the tab (a refusal also goes through session.refuse), and if the blank tab was blocked (null) it falls back to window.open(url, '_blank', 'noopener,noreferrer')."
    - "Posture and gates: the eight member functions stay SECURITY DEFINER with search_path '' and EXECUTE for authenticated only, and both new migrations are expand-only. pgTAP 010/020/030/040/190/195 and the courses, courses-learn, media-playback and isolation integration files pass, `pnpm db:generate` reports no schema changes, and the lint/typecheck/test gate is clean. No commit carries a Co-Authored-By trailer."
  artifacts:
    - path: "supabase/migrations/*_courses_material_soft_delete.sql"
      provides: "generated ADD COLUMN course_lesson_materials.deleted_at timestamptz (nullable, expand-only) with a hand-written header"
      contains: "deleted_at"
    - path: "supabase/migrations/*_courses_asset_gate_fail_closed.sql"
      provides: "create or replace of app.course_lesson_access (WR-03), app.course_lesson_material_list (live rows only) and app.course_asset_hidden (WR-01), same signatures, hardening and grants"
      contains: "when s.lesson_id is null then 'missing'"
    - path: "supabase/tests/195-courses-member.sql"
      provides: "WR-01 cases (removed lesson, removed module, detached material) and the WR-03 drift simulation; plan count updated"
      contains: "WR-01"
    - path: "packages/modules/courses/server/service.ts"
      provides: "replaceMaterials soft-deletes and revives material rows; readMaterials and materialUrl read live rows only"
      contains: "deleted_at = null"
    - path: "apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.tsx"
      provides: "the 08.3 WR-07 synchronous-tab pattern in the member download"
      contains: "window.open('', '_blank')"
    - path: "apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.test.tsx"
      provides: "happy-dom component test pinning the in-gesture open, the navigation, the close on refusal/throw and the null-tab fallback"
      contains: "WR-02"
  key_links:
    - from: "packages/core/server/media/service.ts serveVariant('original') / playbackTokens"
      to: "app.course_asset_hidden"
      via: "courseAssetHidden(assetId) in the caller's tenant transaction (unchanged); the body now governs any course_lesson_materials row of the tenant regardless of lesson, module or row liveness"
      pattern: "courseAssetHidden"
    - from: "packages/modules/courses/server/service.ts replaceMaterials"
      to: "course_lesson_materials.deleted_at"
      via: "an update stamping deleted_at on rows outside the sent set, plus on conflict (tenant_id, lesson_id, asset_id) do update clearing deleted_at"
      pattern: "deleted_at = null"
    - from: "app.course_lesson_access else branch"
      to: "app.course_lesson_states"
      via: "left join from a one-row probe, so a missing evaluator row maps to 'missing'"
      pattern: "s.lesson_id is null then 'missing'"
    - from: "MemberMaterials open(materialId)"
      to: "learnMaterialUrlAction"
      via: "the blank tab opens before the first await; tab.location.href is set from result.url"
      pattern: "tab.location.href"
---

<objective>
Fix the three warnings of `.planning/phases/08.5-liberacao-de-cursos-e-lives-para-o-membro/08.5-REVIEW.md` and close the one gap recorded in `08.5-VERIFICATION.md` (truth 4, COURSE-20 partial):

- **WR-01:** the course asset gate stops governing a lesson material once its lesson or module is removed or the material is detached. `GET /v1/media/{assetId}/original` then serves a paid file by remembered id.
- **WR-02:** the member material download calls `window.open` after an awaited server action, and popup blockers drop it on iOS Safari and the installed PWA.
- **WR-03:** `app.course_lesson_access` answers NULL ("open") when the evaluator has no row for a lesson.

Purpose: COURSE-20's text, the "airtight" T-08.3-05/T-08.3-08 closure that 08.5-CONTEXT requires, and COURSE-26's "T-08.3-08 resolved" all promise more than the code delivers today. Phase 08.5 cannot pass re-verification until truth 4 holds.

**Detach-path decision (WR-01, picked from the review's three options): soft-delete the material rows.**
- Retiring the asset was rejected, for three reasons:
  - `serveVariant('original')` never reads the asset row. It asks only the course gate and signs the key, and the Storage object survives until the 03-08 sweeper runs, so a retired asset would still be signed.
  - Feed post files share `purpose = 'attachment'` (`packages/modules/feed/server/service.ts:697`, `ComposerForm.tsx:272`), and PUT materials accepts any ready attachment id of the tenant. Retiring on detach could therefore destroy a post's file.
  - The gate would still answer `false`, so no pgTAP case could pin the behaviour.
- A dedicated purpose was rejected because it touches five surfaces beyond the bug: `media_assets_purpose_chk`, `MEDIA_PURPOSES`, the upload rules, the `MaterialsList` uploader, and a backfill of existing materials.
- Soft-deleting the rows costs one nullable column (generated, expand-only). The GOVERNED test becomes "any material row of the tenant, live or soft-deleted, under any lesson". An asset that was ever a course material therefore stays governed for good, and that one change closes the removed-lesson, removed-module and detach paths together.
- Four readers learn `deleted_at is null`. A re-attach revives the same row through the existing unique arbiter.
- The RLS policies stay unchanged. The select policy stays unfiltered so the soft-deleted conflicting row stays visible to `on conflict … do update` under RLS.

Migrations follow the repo's post-review precedent (08.2 WR-01, commit 61bec269): a NEW timestamped migration that `create or replace`s the function bodies. The applied `20261015194825_courses_member_functions.sql` is never edited.

Output: three local commits (one per task). No push, no deploy, no Co-Authored-By trailer. After the SUMMARY, the orchestrator re-runs phase 08.5 verification.
</objective>

<execution_context>
@.claude/gsd-core/workflows/execute-plan.md
@.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.planning/phases/08.5-liberacao-de-cursos-e-lives-para-o-membro/08.5-REVIEW.md
@.planning/phases/08.5-liberacao-de-cursos-e-lives-para-o-membro/08.5-VERIFICATION.md
@supabase/migrations/20261015194825_courses_member_functions.sql
@supabase/tests/195-courses-member.sql
@packages/modules/courses/db/schema.ts
@packages/modules/courses/server/service.ts
@apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.tsx
@apps/web/app/(app)/cursos/[courseId]/aulas/LessonForm.tsx

Facts observed at planning time (2026-10-16) that the tasks rely on:

**Migrations**
- The last migration is `20261015195954_courses_progress_open_lesson.sql` (journal idx 93).
- Post-review SQL fixes in this repo are new `--custom` migrations: `pnpm db:generate --custom --name=<name>` writes the timestamped file, its snapshot and the journal entry.
- Generated migrations get a hand-written `--` header (see the first two lines of `20261015194814_courses_member_columns.sql`). Statements are separated by `--> statement-breakpoint`.
- `pnpm db:generate` = `pnpm --filter @rede-social/api exec drizzle-kit generate`. Extra flags pass through.

**Current SQL** (`20261015194825_courses_member_functions.sql`)
- `app.course_lesson_access`: lines 130-163. The WR-03 scalar subquery is at 143-148.
- `app.course_lesson_material_list`: lines 256-285.
- `app.course_asset_hidden`: lines 356-399. The governed `or exists` joins live lessons and modules at 366-375. The held-by material member of the union is at 390-393.

**pgTAP 195** (`select plan(74)`, rolls back)
- Ids:
  - tenant A `19500000-0000-4000-8000-000000000001`
  - admin `…0002`, support `…0003`
  - M `…0004` (holds R), H `…0005` (holds Q, completes P1 in § 1), N `…0006` (holds nothing)
  - course P `…00c2`, module P `…00d6`
  - P1 free `…00f8` (video `…0a01`, material `…0a02`)
  - P2 paid `…00f9` (video `…0a03`, material `…0a04`)
- § 4 asset gate is at lines 366-417, ending with the EP-45 `pg_get_functiondef` check. § 6 is posture, § 7 is the tenant pin, and `finish()` is at line 524.
- `tests.as_tenant(tenant, user[, role])` switches to the authenticated lane. `reset role` returns to the migration role, which may run UPDATEs and DDL.

**Current service code** (`packages/modules/courses/server/service.ts`)
- `replaceMaterials` is at 1637-1690:
  - the hard delete of rows outside the sent set is at 1660-1664;
  - the insert is at 1666-1672, with `on conflict (tenant_id, lesson_id, asset_id) do update set position = excluded.position where course_lesson_materials.position <> excluded.position`.
- The other readers of the table: `readMaterials` at 1408-1417 and `materialUrl` at 1701-1717. No other file in `packages/` reads the table except the member functions.
- Lessons and modules are only ever soft-deleted (`deleteLesson` 1555, `deleteModule` 1168), and courses have no delete route.

**Media and RLS**
- `serveVariant('original')` (`packages/core/server/media/service.ts:751-772`) asks only `courseAssetHidden` and fails closed on anything but `false`.
- `adminWritePolicies` (`schema.ts:30-43`) gives `admin_tenant` INSERT/UPDATE/DELETE on `course_lesson_materials`.
- The select policy `course_lesson_materials_select_lesson` is `tenant_id = app.tenant_id() and exists (lesson visible)`.

**Tests that read the table directly**
- `courses.test.ts` `materialRows` (292-298), used by the P26 `[]` clear assertion at 2551 and others.
- `apps/web/e2e/courses-admin.ts` `lessonMaterials` (609-618).
- `courses-learn.test.ts` EP-17 and `isolation.test.ts` 3002-3009 count rows without detaching, so they are unaffected.

**Integration and pgTAP runs**
- `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts` narrows the run to the named files and keeps the integration listener. `pnpm test:integration -- x` does not filter.
- `LearnFixture` (`apps/api/tests/integration/learn-fixture.ts`) exposes `freeLessonId`, `paidLessonId`, `freeMaterialAssetId`, `paidMaterialAssetId`, `paidVideoId` and `learnRequest(method, path, token, host, body?)`.
- The `08.5 lesson asset gate` describe in `media-playback.test.ts` (625-700) is order-dependent. Its last case grants DEMO_MEMBER the fixture product.
- The local stack goes through `bash scripts/supabase.sh` (never bare `supabase`).
- `bash scripts/supabase.sh migration up` applies pending migrations without wiping local data.
- The full pgTAP run can trip `154-moderation-log.sql` fact 5 on pre-existing integration residue (08.5-VERIFICATION environment note). `pnpm db:reset && pnpm db:seed` clears it; reset always needs the seed, and it wipes hand-made local rows. Run pgTAP BEFORE integration.

**Web unit tests**
- `apps/web` vitest defaults to the `node` environment. Component tests opt in with a first-line `// @vitest-environment happy-dom`.
- `LessonForm.test.tsx` lines 1-100 are the mock pattern: `next-intl` through `loadMessages`, `@rede-social/ui` `useToast`, and `vi.mock` of the action module. Its WR-07 case is at 450-475.
- `vitest run <name>` filters by file-path substring.

**Component facts**
- `LessonRefusalCode` = `'lesson_locked' | 'lesson_sequence_locked' | 'gone' | 'generic'`.
- `LearnMaterialUrlActionResult` = `{ ok: true; url } | { ok: false; code }`.
- The toast text for `courses.member.player` `errors.material` is "Não foi possível abrir o material. Tente novamente.".
- `MemberMaterials` is rendered by `MemberLessonPage.tsx:143` and by `lives/[liveId]/LiveStateZone.tsx:66` (the replay), so one component fix covers both.

**Process**
- Turbo gates run with `TURBO_CACHE=local:r` (`.turbo/cache` fills the disk).
- Commits carry NO `Co-Authored-By` trailer (public repo, project memory); the git identity is already igor.vboas.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: WR-01 + WR-03 in SQL — soft-deletable material rows, governed-for-good materials, fail-closed access answer, pinned by pgTAP 195</name>
  <files>packages/modules/courses/db/schema.ts, supabase/migrations/*_courses_material_soft_delete.sql, supabase/migrations/*_courses_asset_gate_fail_closed.sql, supabase/migrations/meta/_journal.json, supabase/migrations/meta/*_snapshot.json, supabase/tests/195-courses-member.sql, docs/DEPLOY.md</files>
  <precondition>The local Supabase stack is up (`bash scripts/supabase.sh status` succeeds) and `bash scripts/supabase.sh migration list` shows 20261015195954 applied locally.</precondition>
  <read_first>
    - supabase/migrations/20261015194825_courses_member_functions.sql:
      - lines 1-66 (header style, hardening paragraph);
      - 130-163 (`course_lesson_access`);
      - 256-285 (`course_lesson_material_list`);
      - 356-399 (`course_asset_hidden`).
    - supabase/migrations/20261015194814_courses_member_columns.sql (the header on a generated migration)
    - supabase/tests/195-courses-member.sql:
      - lines 1-42 (header sections, `plan(74)`);
      - 92-131 (assets, lessons, materials, lives, entitlements);
      - 366-417 (§ 4);
      - 475-525 (§ 6, § 7, finish).
    - packages/modules/courses/db/schema.ts lines 300-345 (`courseLessonMaterials`, its indexes and policies)
    - docs/DEPLOY.md lines 1588-1625 ("Phase 08.5 release", the migration list and the expand-only grep sentence)
  </read_first>
  <behavior>
    - pgTAP § 4, P2's material (asset …0a04), after `course_lessons.deleted_at` is set on P2 (…00f9):
      - `app.course_asset_hidden(…0a04)` is true for N;
      - it is true for H (a former buyer: no live lesson holds it);
      - it is false for admin_tenant.
    - Same asset after `course_modules.deleted_at` is set on module P (…00d6): true for N, false for admin_tenant.
    - Same asset after its `course_lesson_materials` row (P2, …0a04) gets `deleted_at` (detached), with P2 itself live and open to H:
      - true for N and true for H;
      - false for admin_tenant;
      - H's `app.course_lesson_material_list(…00f9)` is empty.
    - Each mutation is undone before the next scenario, so § 5 onwards sees the original fixture.
    - pgTAP § 8 (WR-03 drift simulation), as the migration role and inside the file's rolled-back transaction: `app.course_lesson_states` is replaced, with the same signature, by a body that returns no row. Then:
      - for N, `app.course_lesson_access(…00f8)` (the free P1, open in § 2) is 'missing';
      - for N, `app.course_asset_hidden(…0a01)` (P1's video, served in § 4) is true;
      - for admin_tenant, `app.course_lesson_access(…00f8)` is 'missing'.
    - § 6 posture is unchanged: the eight functions are definer, `search_path=""`, authenticated-only.
    - The EP-45 check stays green.
  </behavior>
  <action>
**Order: column first, then the RED cases, then the function fix.** This gives a clean red: the new cases fail as assertions instead of erroring on a missing column.

1. **Column (WR-01 detach path).**
   - In `courseLessonMaterials` (`packages/modules/courses/db/schema.ts`), add a nullable `deletedAt: timestamp('deleted_at', { withTimezone: true })` after `createdAt`.
   - Add a doc comment explaining why:
     - quick 261016-aqc, 08.5 WR-01;
     - a detach stamps it instead of removing the row, so the asset stays governed by `app.course_asset_hidden` for good;
     - every reader filters `deleted_at is null`;
     - a re-attach revives the row through `course_lesson_materials_uq`.
   - Do NOT change the indexes or the policies. Explain in the comment: the select policy must keep seeing a soft-deleted row so `on conflict … do update` can revive it under RLS.
   - Run `pnpm db:generate --name=courses_material_soft_delete`. Open the generated SQL. It must contain exactly one statement that adds the nullable `deleted_at timestamp with time zone` column to `course_lesson_materials`. If drizzle emits anything else, stop and report the drift.
   - Prepend a two-line `--` header in the style of `20261015194814_courses_member_columns.sql`: quick 261016-aqc, 08.5 code review WR-01, expand-only, the reason.
   - Apply it with `bash scripts/supabase.sh migration up`.

2. **RED (pgTAP 195).** Extend `supabase/tests/195-courses-member.sql`.
   - **New § 4 cases.** Add them after the EP-45 assertion (still inside § 4). Every mutation runs after `reset role` as the migration role; every check runs under `tests.as_tenant(...)`.
     - Removed lesson:
       - set P2's lesson `deleted_at = now()`;
       - assert N true, H true, admin_tenant false on …0a04;
       - set `deleted_at = null` again.
     - Removed module:
       - set module P's `deleted_at = now()`;
       - assert N true, admin_tenant false;
       - restore.
     - Detached material:
       - set `deleted_at = now()` on the `course_lesson_materials` row with lesson …00f9 and asset …0a04;
       - assert N true, H true, H's `course_lesson_material_list('…00f9')` `is_empty`, admin_tenant false;
       - restore.
     - Description strings start with `WR-01:`.
   - **New § 8.** Put it between § 7's final `reset role;` and `select * from finish();`.
     - As the migration role, `create or replace function app.course_lesson_states(p_course uuid)` with the identical `returns table (...)` column list and `language sql stable security definer set search_path = ''`. The body selects seven typed nulls `where false`.
     - Then the three WR-03 assertions from `<behavior>`, with descriptions starting `WR-03:`.
     - Add a one-line comment: the file rolls back, so the real evaluator returns at `rollback`.
   - **Header.** Add the § 4 WR-01 bullet and the § 8 bullet to the header's section list. Set `select plan(N)` to the new exact total: 74 plus 9 WR-01 plus 3 WR-03 = 86 if exactly the listed assertions are added. Count the assertions you actually wrote.
   - **Run** `bash scripts/supabase.sh test db supabase/tests/000-helpers.sql supabase/tests/195-courses-member.sql`. It must FAIL on exactly these assertions under the old bodies:
     - the removed-lesson N and H;
     - the removed-module N;
     - the detached H and H's list;
     - the three WR-03 assertions.
   - Keep the TAP output (pgTAP emits real TAP) as red evidence in the SUMMARY.

3. **GREEN (new custom migration).**
   - Run `pnpm db:generate --custom --name=courses_asset_gate_fail_closed`. Its timestamp sorts after the column migration, which it needs: SQL-language bodies are validated at creation and now read `course_lesson_materials.deleted_at`.
   - Replace the placeholder with a header and three statements. Each statement is a `create or replace`, followed by its `revoke all on function … from public;` / `grant execute on function … to authenticated;` pair, separated by `--> statement-breakpoint`.
   - **Header.** Cover:
     - why: 08.5 code review WR-01 and WR-03, the 08.5-VERIFICATION gap on truth 4, COURSE-20;
     - what each statement changes;
     - the hardening line copied from 20261015194825: definer, `search_path = ''`, fully qualified names, every statement pinned to `app.tenant_id()`, EXECUTE revoked from PUBLIC and granted to `authenticated` only, no LIMIT;
     - that it is expand-only;
     - that the earlier migration stays untouched.
   - **Statement a — `app.course_lesson_access(p_lesson uuid) returns text` (WR-03).** The body is byte-identical to lines 130-160 except the course-door `else (...)` subquery. That subquery becomes a left join from a one-row probe to `app.course_lesson_states(l.course_id) s on s.lesson_id = l.id`, selecting:
     - `case when s.lesson_id is null then 'missing'`
     - `when s.lock_reason in ('module', 'lesson') then 'sequence'`
     - `else s.lock_reason end`
     - Give the probe an alias distinct from the outer `one`, for example `probe`.
   - **Statement b — `app.course_lesson_material_list(p_lesson uuid)`.** Identical to lines 256-282, plus `and mt.deleted_at is null` in the where clause. This hides detached rows from the member lesson, the replay and the member URL route.
   - **Statement c — `app.course_asset_hidden(p_asset uuid) returns boolean` (WR-01).**
     - The staff branch is identical (`admin_tenant`, `support_tenant` → false). IN-01 is out of scope.
     - GOVERNED becomes either of:
       - the existing `purpose = 'lesson'` exists;
       - `exists (select 1 from public.course_lesson_materials mt where mt.tenant_id = app.tenant_id() and mt.asset_id = p_asset)`, with NO lesson, module or `deleted_at` condition.
     - The "held by an openable lesson" `and not exists (...)` half is identical to lines 377-394, except that the material member of the union adds `and mt.deleted_at is null`.
   - Apply with `bash scripts/supabase.sh migration up` and re-run the same pgTAP command: all assertions must pass.
   - Then run the courses-adjacent pgTAP set (see `<verify>`); it must all pass.

4. **DEPLOY.md.** In "Phase 08.5 release":
   - change "Four migrations" to "Six migrations";
   - add a bullet for each new file, saying generated or hand-written and what it does;
   - make the "step 1 grep … prints nothing for these four files" sentence say six.

5. **Commit** with `fix(08.5): WR-01 + WR-03 course asset gate governs every course material and the access answer fails closed`. The body names the two migrations and the pgTAP cases. No Co-Authored-By trailer.
  </action>
  <verify>
    <automated>bash scripts/supabase.sh test db supabase/tests/000-helpers.sql supabase/tests/010-rls-coverage.sql supabase/tests/020-tenant-isolation.sql supabase/tests/030-lanes.sql supabase/tests/040-schema-conventions.sql supabase/tests/190-courses.sql supabase/tests/195-courses-member.sql && grep -c "when s.lesson_id is null then 'missing'" supabase/migrations/*_courses_asset_gate_fail_closed.sql && test "$(grep -c 'mt.deleted_at is null' supabase/migrations/*_courses_asset_gate_fail_closed.sql)" -ge 2 && ! grep -inE 'drop (table|column)|rename|set not null|alter column .* type' supabase/migrations/*_courses_material_soft_delete.sql supabase/migrations/*_courses_asset_gate_fail_closed.sql && pnpm db:generate 2>&1 | grep -i "no schema changes" && MSG="$(git log -1 --format=%B)" && ! printf '%s\n' "$MSG" | grep -qi co-authored-by</automated>
  </verify>
  <done>
    - The targeted pgTAP run passes. 195's plan count matches its assertions: 86 if exactly the listed cases were added.
    - The red run recorded in the SUMMARY shows exactly the expected failures under the old bodies.
    - Both new migrations are expand-only. Keep their headers free of the words the step-1 grep matches, so the grep gate stays meaningful.
    - `pnpm db:generate` reports no schema changes.
    - The applied `20261015194825_courses_member_functions.sql` is byte-identical (`git diff --quiet HEAD~1 -- supabase/migrations/20261015194825_courses_member_functions.sql`).
    - § 6 posture still counts 8 definer functions with an empty search_path.
    - DEPLOY.md lists six migrations.
    - One commit, with no Co-Authored-By trailer.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: WR-01 detach path through the API — replaceMaterials soft-deletes and revives, readers ignore detached rows, remembered-id refusal proven over HTTP</name>
  <files>packages/modules/courses/server/service.ts, apps/api/tests/integration/media-playback.test.ts, apps/api/tests/integration/courses.test.ts, apps/web/e2e/courses-admin.ts, packages/modules/courses/README.md</files>
  <precondition>Task 1 is committed and both new migrations are applied locally (`bash scripts/supabase.sh migration list` shows *_courses_asset_gate_fail_closed applied).</precondition>
  <read_first>
    - packages/modules/courses/server/service.ts:
      - lines 1404-1417 (`readMaterials`);
      - 1545-1575 (`deleteLesson` doc comment);
      - 1624-1690 (`replaceMaterials`);
      - 1692-1717 (`materialUrl`).
    - apps/api/tests/integration/media-playback.test.ts lines 625-700 (the order-dependent `08.5 lesson asset gate` describe, `expectBare404`, `get`)
    - apps/api/tests/integration/learn-fixture.ts lines 21-60 (`LearnFixture`, `learnRequest`) and 155-200 (how the fixture attaches one material per lesson)
    - apps/api/tests/integration/courses.test.ts lines 288-300 (`materialRows`) and 2490-2552 (the P26/P28/P30 replace test that ends with `[]` clears)
    - apps/web/e2e/courses-admin.ts lines 606-618 (`lessonMaterials`)
    - packages/modules/courses/README.md lines 90-95 (the lesson DELETE and materials rows) and 192-200 (the asset-seam paragraph)
  </read_first>
  <behavior>
    - media-playback, new LAST case in the `08.5 lesson asset gate` describe:
      - The admin PUTs `{ assetIds: [] }` to `/v1/courses/lessons/{fixture.freeLessonId}/materials` and gets 200. Then `/v1/media/{fixture.freeMaterialAssetId}/original` is a bare 404 for DEMO_MEMBER (who got a 302 for it in case 2) and a 302 for the admin.
      - The admin DELETEs `/v1/courses/lessons/{fixture.paidLessonId}` and gets 204. Then, for DEMO_MEMBER (who now holds the product):
        - `/v1/media/{fixture.paidMaterialAssetId}/original` is a bare 404;
        - `/v1/media/{fixture.paidVideoId}/playback` is a bare 404;
        - the admin still gets 302 on that `/original`.
    - courses.test.ts, in the existing replace test after `cleared`:
      - Re-sending `{ assetIds: [xlsx] }` answers ONE material whose `id` equals the xlsx material id answered earlier (`one.materials[0].id`): the row is revived, not duplicated.
      - `materialRows(lesson.id)` lists exactly one row.
    - Every existing assertion of courses.test.ts, courses-learn.test.ts and isolation.test.ts keeps passing, including the P30 identical re-send (same ids, same created_at) and the concurrent-replace rounds.
  </behavior>
  <action>
1. **RED.**
   - Append the media-playback case from `<behavior>` as the LAST `it` of `describe('08.5 lesson asset gate')`. It mutates the fixture, so it must run after the grant case. Use the describe's `get` / `expectBare404` helpers and `learnRequest('PUT' | 'DELETE', path, demoAdminToken, HOSTS.demo, body)` for the admin writes. Start the name with `WR-01:`.
   - In `courses.test.ts`, change `materialRows` to read live rows only: add `and deleted_at is null`, and say so in its doc comment ("as the API lists them").
   - Add the revive assertion from `<behavior>` to the replace test.
   - Run `pnpm --filter @rede-social/api exec vitest run tests/integration/media-playback.test.ts tests/integration/courses.test.ts`. Two things must fail:
     - the detached free material still answers 302 to the member, because the row is still removed outright, so the asset falls out of the gate;
     - the revive id assertion, because a new row is inserted.
   - Keep the output for the SUMMARY. Vitest does not emit TAP: if a red-evidence record is required, pipe the real failure output through a throwaway normalizer in the session scratchpad (real names, real counts, never fabricated). The record fields `command`, `exitCode`, `targetTest`, `targetFile` and `output` go at the top level.

2. **GREEN** in `packages/modules/courses/server/service.ts`.
   - **`replaceMaterials`.**
     - Replace the statement that removes rows outside the sent set with an `update course_lesson_materials set deleted_at = now()`. Keep the same predicate (tenant, lesson, `asset_id <> all (…)`) and add `deleted_at is null`.
     - Extend the insert's `on conflict (tenant_id, lesson_id, asset_id) do update` to `set position = excluded.position, deleted_at = null`, firing when `course_lesson_materials.position <> excluded.position or course_lesson_materials.deleted_at is not null`. An identical live re-send therefore still writes nothing (P30), and a re-attach revives the same row with the same id and created_at.
     - Update the doc comment: detached rows are soft-deleted so the asset stays governed by the course asset gate (08.5 WR-01), and a re-sent asset revives its row.
   - **`readMaterials`.** Add `and m.deleted_at is null`.
   - **`materialUrl`.** Add `and m.deleted_at is null` to the join row's predicates, so a detached material is the bare 404 on the admin URL route.
   - **`deleteLesson`.** Add one sentence to its doc comment: the kept material rows keep their assets governed by the course asset gate.
   - Do not touch the lane, the lock order or any other statement.

3. **`apps/web/e2e/courses-admin.ts` `lessonMaterials`.** Add `and m.deleted_at is null`. Its doc comment already says "as the API lists them". The e2e suite is not re-run for this one-line helper filter; the web typecheck covers it.

4. **`packages/modules/courses/README.md`.**
   - The DELETE lesson row: the material rows stay and keep their assets governed.
   - The PUT materials row: rows outside the sent set are soft-deleted (`deleted_at`) and a re-sent asset revives its row.
   - The asset-seam paragraph: the gate governs a `lesson` video, or any asset that is or was a material of the tenant (any lesson, any row state), and hides it unless a live material row or video slot of an openable live lesson holds it.

5. **Run** the GREEN set:
   - `pnpm --filter @rede-social/api exec vitest run tests/integration/media-playback.test.ts tests/integration/courses.test.ts tests/integration/courses-learn.test.ts`;
   - then `pnpm --filter @rede-social/api exec vitest run tests/integration/isolation.test.ts -t "phase 08.3 sweep|phase 08.5 sweep"`. If that filtered run fails on a case that depends on an earlier one (a known trait of this file, per 08.5-VERIFICATION), run the whole `tests/integration/isolation.test.ts` instead.
   - Then run `pnpm --filter @rede-social/module-courses typecheck` and `pnpm --filter @rede-social/api typecheck`.

6. **Commit** with `fix(08.5): WR-01 detaching a material soft-deletes its row so the asset gate keeps governing it`. No Co-Authored-By trailer.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/api exec vitest run tests/integration/media-playback.test.ts tests/integration/courses.test.ts tests/integration/courses-learn.test.ts && test "$(grep -c 'delete from course_lesson_materials' packages/modules/courses/server/service.ts)" -eq 0 && test "$(grep -c 'deleted_at is null' packages/modules/courses/server/service.ts)" -ge 1 && pnpm --filter @rede-social/module-courses typecheck && pnpm --filter @rede-social/api typecheck && MSG="$(git log -1 --format=%B)" && ! printf '%s\n' "$MSG" | grep -qi co-authored-by</automated>
  </verify>
  <done>
    - The three integration files pass.
    - The new `WR-01:` media-playback case proves both halves over HTTP:
      - a detached material is a bare 404 by remembered id;
      - the material of a removed lesson is a bare 404 even for a holder, and the admin is still served.
    - The revive assertion holds: same material id.
    - The isolation 08.3/08.5 sweeps pass.
    - `service.ts` has no statement that removes material rows outright.
    - Both typechecks are clean.
    - One commit, with no Co-Authored-By trailer.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: WR-02 member material download opens its tab inside the tap (08.3 WR-07 pattern), pinned by a component test</name>
  <files>apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.tsx, apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.test.tsx</files>
  <read_first>
    - apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.tsx (the whole file; `open()` is at lines 60-75, the doc comment at 19-32)
    - apps/web/app/(app)/cursos/[courseId]/aulas/LessonForm.tsx lines 298-324 (the WR-07 precedent: the doc comment and `openMaterial`)
    - apps/web/app/(app)/cursos/[courseId]/aulas/LessonForm.test.tsx:
      - lines 1-100 (environment pragma, `vi.hoisted`, the `next-intl` / `@rede-social/ui` / action mocks);
      - 450-475 (the WR-07 case to mirror).
    - apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonSession.tsx lines 30-55 (`useLessonSession`, `refuse(code): boolean`)
    - apps/web/app/(app)/cursos/learn-actions.ts lines 150-160 and 220-240 (`LessonRefusalCode`, `LearnMaterialUrlActionResult`, `learnMaterialUrlAction`)
  </read_first>
  <behavior>
    - Clicking the "Baixar {file}" button calls `window.open('', '_blank')` synchronously, before the mocked `learnMaterialUrlAction` resolves, and the returned tab's `opener` is null at once.
    - When the action resolves `{ ok: true, url }`, `tab.location.href` equals that url and `window.open` has been called exactly once.
    - When it resolves `{ ok: false, code: 'lesson_locked' }`:
      - `tab.close` is called, and `session.refuse` is called with `'lesson_locked'`;
      - if refuse answers true, no toast is shown;
      - if refuse answers false (for example `'generic'`), the error toast "Não foi possível abrir o material. Tente novamente." is shown.
    - When the action throws, `tab.close` is called and the same error toast is shown.
    - When `window.open('', '_blank')` returns null (a blocked blank tab), the fallback runs after the action resolves: a second call `window.open(url, '_blank', 'noopener,noreferrer')`.
    - While the call runs, the button is disabled with `aria-busy` (unchanged behaviour).
  </behavior>
  <action>
1. **RED.** Create `MemberMaterials.test.tsx` next to the component.
   - The first line is `// @vitest-environment happy-dom`.
   - Mirror `LessonForm.test.tsx`'s mocks:
     - `vi.hoisted` shared fns;
     - `next-intl` `useTranslations` through `createTranslator` + `loadMessages(join(process.cwd(), 'messages', 'pt-BR'))`;
     - `@rede-social/ui` with `useToast: () => toast`;
     - `vi.mock('@/app/(app)/cursos/learn-actions', () => ({ learnMaterialUrlAction: mint }))`;
     - `vi.mock('./LessonSession', () => ({ useLessonSession: () => session }))`, where `session.refuse` is a `vi.fn`.
   - Render `MemberMaterials` with one `MemberMaterialView` (`id`, `name`, `meta`, `kind: 'pdf'`, `downloadLabel: 'Baixar Apostila.pdf'`) and a `countLabel`.
   - Write the cases from `<behavior>`, with names starting `WR-02:`. Use a `{ opener, close: vi.fn(), location: { href: '' } }` tab double from `vi.spyOn(window, 'open')`, a deferred promise for the in-gesture assertion, and `mockRestore` in `afterEach` together with `cleanup`.
   - Run `pnpm --filter @rede-social/web exec vitest run MemberMaterials`. The in-gesture case and the close cases must FAIL against the current component. Keep the output for the SUMMARY; the Vitest TAP note from Task 2 applies.

2. **GREEN.** Rewrite `open(materialId)` in `MemberMaterials.tsx` with the 08.3 WR-07 pattern, in this order:
   - Before `setPendingId` and before any await: `const tab = window.open('', '_blank')`, then `if (tab) tab.opener = null`.
   - Then `setPendingId(materialId)`.
   - In `try`, await `learnMaterialUrlAction(lessonId, materialId)`:
     - on ok: `if (tab) tab.location.href = result.url; else window.open(result.url, '_blank', 'noopener,noreferrer')`, then return;
     - otherwise: `tab?.close()`, then `if (session.refuse(result.code)) return;`, then the error toast.
   - In `catch`: `tab?.close()` and the error toast.
   - In `finally`: `setPendingId(null)`.
   - Rewrite the doc comment paragraph about the tap (lines 26-29). It should say:
     - why: 08.5 WR-02, the 08.3 WR-07 precedent in `LessonForm.tsx`;
     - iOS Safari and the installed PWA drop a `window.open` that runs after an await;
     - `opener` is cut at once;
     - a refusal or failure closes the blank tab;
     - a blocked blank tab falls back to the `noopener` open;
     - the URL still lives only in this closure.
   - No other change: the markup, `data-testid`s, strings and props stay as they are.
   - `LiveStateZone.tsx` (the replay's "Materiais da gravação") renders this same component, so it needs no edit.

3. **Run** `pnpm --filter @rede-social/web exec vitest run MemberMaterials LessonForm` (green), then `pnpm --filter @rede-social/web typecheck`.

4. **Commit** with `fix(08.5): WR-02 member material download opens its tab inside the tap`. No Co-Authored-By trailer.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run MemberMaterials LessonForm && grep -c "window.open('', '_blank')" "apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.tsx" && pnpm --filter @rede-social/web typecheck && MSG="$(git log -1 --format=%B)" && ! printf '%s\n' "$MSG" | grep -qi co-authored-by</automated>
  </verify>
  <done>
    - `MemberMaterials.test.tsx` exists and passes, with `WR-02:` cases for: the in-gesture open with opener null, the navigation, the close on refusal (refuse handled and unhandled), the close on throw, and the null-tab fallback.
    - The red run recorded in the SUMMARY shows the in-gesture and close cases failing before the fix.
    - `LessonForm.test.tsx` still passes and the web typecheck is clean.
    - One commit, with no Co-Authored-By trailer.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| member session → `GET /v1/media/{assetId}/original` / `playback` | an asset id remembered from an earlier signed URL crosses here; the course asset gate is the only check on `original` |
| member session → definer SQL functions | the access answer, the material list and the asset gate run as the owner (RLS bypassed), so each pins the tenant itself |
| admin session → `PUT /v1/courses/lessons/{id}/materials` | admin-supplied asset ids (any ready attachment of the tenant) |
| member tab → signed Storage URL tab | the opened tab must not keep a handle on the app window |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-aqc-01 | Information disclosure | `app.course_asset_hidden` materials branch | high | mitigate | GOVERNED = any `course_lesson_materials` row of the tenant, live or soft-deleted, under any lesson (Task 1 statement c). pgTAP § 4 WR-01 cases cover the removed lesson, the removed module and the detached material. The media-playback `WR-01:` case covers HTTP. |
| T-aqc-02 | Information disclosure | `replaceMaterials` detach | high | mitigate | Detach stamps `deleted_at` instead of removing the row (Task 2), so the governing row survives. The only remaining outright removal is the FK cascade of a lesson row's own hard delete, which no API route performs (lessons and modules soft-delete; courses have no delete route). |
| T-aqc-03 | Elevation of privilege | `app.course_lesson_access` evaluator drift | medium | mitigate | A missing evaluator row maps to `'missing'` (Task 1 statement a). The pgTAP § 8 drift simulation proves that content, the access answer and the asset gate fail closed. |
| T-aqc-04 | Information disclosure | detached rows reappearing | medium | mitigate | `deleted_at is null` in `readMaterials`, `materialUrl`, `app.course_lesson_material_list` and the held-by half of the gate. pgTAP asserts that H's list is empty after a detach. The courses.test.ts `materialRows` filter plus the revive assertion cover the admin side. |
| T-aqc-05 | Tampering | definer function hardening | medium | mitigate | `create or replace` keeps `security definer set search_path = ''`, qualified names, `app.tenant_id()` pins, and EXECUTE for `authenticated` only. pgTAP § 6 posture (8 / 8 / grants) and 040 schema conventions stay green. |
| T-aqc-06 | Tampering | member download tab (reverse tabnabbing) | low | mitigate | `tab.opener = null` runs synchronously on the blank tab, and the fallback open keeps `noopener,noreferrer` (Task 3, component test). |
| T-aqc-07 | Denial of service | a feed post's `attachment` asset sent as a course material | low | accept | It becomes governed and is refused to members by id on the feed too. Only `admin_tenant` can send it, through the admin API, with the id of the tenant's own post file; this pre-dates this fix for live lessons. |
| T-aqc-08 | Information disclosure | soft-deleted material rows visible in the member lane | low | accept | The select policy is deliberately unchanged, because the revive conflict needs it. A lane read shows only ids and positions of a lesson the caller can already see under the restrictive lesson gate, never bytes or a URL. The Data API is closed (`data_api_closed`) and no member route reads the table directly. |
</threat_model>

<verification>
Run in this order. pgTAP goes before integration, because integration residue trips pgTAP 154.

1. Targeted pgTAP:

   `bash scripts/supabase.sh test db supabase/tests/000-helpers.sql supabase/tests/010-rls-coverage.sql supabase/tests/020-tenant-isolation.sql supabase/tests/030-lanes.sql supabase/tests/040-schema-conventions.sql supabase/tests/160-shared-identity.sql supabase/tests/190-courses.sql supabase/tests/195-courses-member.sql`

   Expect PASS, with 190 unchanged (137) and 195 at its new count.
2. Full pgTAP: `pnpm supabase test db`. If its only failure is `154-moderation-log.sql` fact 5 on pre-existing moderation_log residue (the 08.5-VERIFICATION environment note), run `pnpm db:reset && pnpm db:seed` and re-run. This is the recorded recipe; it wipes hand-made local rows, none of which this task needs. Record whichever path was taken in the SUMMARY.
3. Integration:

   `pnpm --filter @rede-social/api exec vitest run tests/integration/courses.test.ts tests/integration/courses-learn.test.ts tests/integration/media-playback.test.ts tests/integration/isolation.test.ts`

   Expect all to pass.
4. Web units: `pnpm --filter @rede-social/web exec vitest run MemberMaterials LessonForm`.
5. Schema drift: `pnpm db:generate` reports no schema changes. Expand-only grep: `grep -inE 'drop (table|column)|rename|set not null|alter column .* type'` over the two new migration files prints nothing.
6. Gate: `TURBO_CACHE=local:r pnpm turbo lint typecheck test --continue --concurrency=4 && bash scripts/check-ui-literals.sh`. Afterwards remove `.turbo/cache` if disk space is low (project memory).
7. `MSGS="$(git log -3 --format=%B)" && ! printf '%s\n' "$MSGS" | grep -qi co-authored-by` succeeds.
</verification>

<success_criteria>
- The 08.5-VERIFICATION gap's `missing` list is satisfied, item by item:
  - The materials half of GOVERNED no longer depends on lesson or module liveness, through a new `create or replace` migration with the same signature.
  - The detach path is covered: material rows are soft-deleted.
  - pgTAP 195 has the three scenarios, each true for a member and false for `admin_tenant`.
  - A media-playback `/original` case covers it over HTTP.
- WR-03: no evaluator row means `'missing'`, pinned by the pgTAP § 8 drift simulation.
- WR-02: the member download (lesson and replay) uses the in-gesture blank tab, pinned by `MemberMaterials.test.tsx`.
- Every command in `<verification>` passes, apart from a pre-existing pgTAP 154 residue trip that a reset and seed clears and the SUMMARY records.
- Three local commits, none pushed, none with a Co-Authored-By trailer.
</success_criteria>

<output>
Create `.planning/quick/261016-aqc-corrigir-wr-01-wr-02-e-wr-03-do-08-5-rev/261016-aqc-SUMMARY.md` when done.

The SUMMARY must contain:
- the red and green evidence per task (pgTAP TAP lines for Task 1; Vitest output for Tasks 2-3);
- the two migration filenames with their timestamps;
- the final 195 plan count;
- which pgTAP path step 2 took;
- a mapping from each 08.5-VERIFICATION `gaps[0].missing` item and each review id (WR-01, WR-02, WR-03) to the commit and test that closes it.

Hand-off for re-verification of phase 08.5 (the orchestrator's step, not this executor's):
- Do NOT edit `08.5-VERIFICATION.md`, `08.5-REVIEW.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` or `.planning/STATE.md`.
- After this SUMMARY, the orchestrator re-runs the gsd-verifier for phase 08.5 in re-verification mode, pointing at `.planning/phases/08.5-liberacao-de-cursos-e-lives-para-o-membro/`, with the phase-dir argument for the fingerprint.
- Re-verification should then:
  - find truth 4 VERIFIED;
  - flip COURSE-20 and COURSE-26 back to complete;
  - reduce the WR-02 human item to the real-device check, which stays blocked until Phase 01.1.
</output>
