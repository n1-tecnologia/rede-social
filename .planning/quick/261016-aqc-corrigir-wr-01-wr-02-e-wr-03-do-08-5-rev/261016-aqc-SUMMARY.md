---
phase: quick-261016-aqc
plan: 01
subsystem: courses
status: complete
tags: [courses, asset-gate, pgtap, rls, materials, pwa, review-fix, 08.5]
requirements: [COURSE-19, COURSE-20, COURSE-26]
requires:
  - "08.5 member function family (20261015194825_courses_member_functions.sql)"
provides:
  - "course_lesson_materials.deleted_at (soft-deletable material rows)"
  - "app.course_asset_hidden governs any asset that is or was a course material of the tenant"
  - "app.course_lesson_access fails closed ('missing') when the evaluator has no row"
  - "member material download opens its tab inside the tap"
affects:
  - "packages/core/server/media/service.ts serveVariant('original') / playbackTokens (through courseAssetHidden, unchanged call)"
tech-stack:
  added: []
  patterns:
    - "post-review SQL fix as a new --custom create-or-replace migration (08.2 WR-01 precedent)"
    - "soft-delete + on-conflict revive for a join table under an unfiltered select policy"
    - "08.3 WR-07 synchronous blank tab before the first await"
key-files:
  created:
    - supabase/migrations/20261016110155_courses_material_soft_delete.sql
    - supabase/migrations/20261016110251_courses_asset_gate_fail_closed.sql
    - supabase/migrations/meta/20261016110155_snapshot.json
    - supabase/migrations/meta/20261016110251_snapshot.json
    - apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.test.tsx
  modified:
    - packages/modules/courses/db/schema.ts
    - supabase/migrations/meta/_journal.json
    - supabase/tests/195-courses-member.sql
    - docs/DEPLOY.md
    - packages/modules/courses/server/service.ts
    - packages/modules/courses/README.md
    - apps/api/tests/integration/courses.test.ts
    - apps/api/tests/integration/media-playback.test.ts
    - apps/web/e2e/courses-admin.ts
    - apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.tsx
decisions:
  - "WR-01 detach path: soft-delete course_lesson_materials rows (nullable deleted_at) instead of retiring the asset or adding a purpose; GOVERNED = any material row of the tenant, live or soft-deleted, under any lesson"
  - "WR-03: app.course_lesson_access maps a missing evaluator row to 'missing' through a left join from a one-row probe"
  - "RLS policies and indexes on course_lesson_materials unchanged: the select policy must see soft-deleted rows so on conflict do update can revive them"
metrics:
  duration: "~37 min"
  completed: 2026-10-16
actuals:
  tokens: 12142     # chars/4 over the realized diff, excluding the two generated drizzle snapshots (146422 with them)
  tasks: 3
  commits: 3
plan_head_before: f699857ba011f89822cae9ae49e8edc4de615d2f
commits: 3
---

# Quick 261016-aqc Plan 01: 08.5 review WR-01, WR-02, WR-03 Summary

The course asset gate now governs every asset that is or ever was a course material of the tenant (material rows are soft-deleted on detach and revived on re-attach), `app.course_lesson_access` answers `missing` instead of NULL when the evaluator has no row, and the member material download opens its tab synchronously inside the tap.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | efcbb8b8 | fix(08.5): WR-01 + WR-03 course asset gate governs every course material and the access answer fails closed |
| 2 | fe78e193 | fix(08.5): WR-01 detaching a material soft-deletes its row so the asset gate keeps governing it |
| 3 | cb2a13b1 | fix(08.5): WR-02 member material download opens its tab inside the tap |

No commit carries a Co-Authored-By trailer (`git log -3 --format=%B | grep -ci co-authored-by` = 0). Nothing pushed.

## Migrations

- `20261016110155_courses_material_soft_delete.sql` (generated, journal idx 94): exactly one statement, `ALTER TABLE "course_lesson_materials" ADD COLUMN "deleted_at" timestamp with time zone;`, plus a two-line hand-written header. Expand-only.
- `20261016110251_courses_asset_gate_fail_closed.sql` (`--custom`, journal idx 95): `create or replace` of `app.course_lesson_access` (WR-03), `app.course_lesson_material_list` (live rows only) and `app.course_asset_hidden` (WR-01), each followed by `revoke all … from public` / `grant execute … to authenticated`. Same signatures, `security definer set search_path = ''`, `app.tenant_id()` pins. Expand-only.
- `20261015194825_courses_member_functions.sql` is byte-identical (`git diff --quiet f699857b -- …` passes).
- Both applied locally with `bash scripts/supabase.sh migration up`.

## Task 1: SQL (WR-01 + WR-03), pgTAP 195

**pgTAP 195 plan count: 74 -> 86** (9 WR-01 assertions in § 4, 3 WR-03 assertions in the new § 8). I counted the assertions in the file: 86.

**RED** (column applied, old function bodies). Command: `bash scripts/supabase.sh test db supabase/tests/000-helpers.sql supabase/tests/195-courses-member.sql`, exit 1:

```
# Failed test 57: "WR-01: P2's material stays hidden from N once P2 is removed"            have: false  want: true
# Failed test 58: "WR-01: P2's material is hidden from H (a former buyer) once P2 is removed: no live lesson holds it"  have: false  want: true
# Failed test 60: "WR-01: P2's material stays hidden from N once module P is removed"     have: false  want: true
# Failed test 63: "WR-01: a detached material is hidden from H although P2 is live and open to H"  have: false  want: true
# Failed test 64: "WR-01: H's material list of P2 no longer names the detached material"  Unexpected records: (1)
# Failed test 84: "WR-03: with no evaluator row the free P1 answers missing to N (fails closed, never NULL)"  have: NULL  want: missing
# Failed test 85: "WR-03: with no evaluator row P1's video is hidden from N"              have: false  want: true
# Failed test 86: "WR-03: with no evaluator row P1 answers missing to admin_tenant"       have: NULL  want: missing
# Looks like you failed 8 tests of 86
Failed tests:  57-58, 60, 63-64, 84-86
```

These are exactly the 8 failures the plan predicted. The N-detached case (test 61) and all three admin_tenant cases passed under the old bodies, as expected.

**GREEN** (after the custom migration). Same command, exit 0: `Files=2, Tests=87 … Result: PASS`.

Courses-adjacent set (000, 010, 020, 030, 040, 160, 190, 195): `Files=8, Tests=619, Result: PASS`. 190 is unchanged and § 6 posture still counts 8 definer functions with an empty search_path. EP-45 stays green.

`pnpm db:generate`: "No schema changes, nothing to migrate". The expand-only grep over both new files prints nothing.

## Task 2: API detach path (WR-01)

**RED.** Command: `pnpm --filter @rede-social/api exec vitest run tests/integration/media-playback.test.ts tests/integration/courses.test.ts`, exit 1, `Tests 2 failed | 86 passed (88)`:

```
× the ordered set (D-410, P27, P28, P30, P26): … [] clears; a new lesson has materials: []
  AssertionError: expected [ [ …(3) ] ] to deeply equal [ [ …(3) ] ]      (revive: a new id was inserted)
× WR-01: a detached material and the material of a removed lesson stay governed — bare 404 by remembered id to the member (even a holder), 302 to the admin
  AssertionError: expected 'http://127.0.0.1:54321/storage/v1/obj…' to be null   (the detached free material still 302)
```

**GREEN.** `pnpm --filter @rede-social/api exec vitest run tests/integration/media-playback.test.ts tests/integration/courses.test.ts tests/integration/courses-learn.test.ts`, exit 0: `Test Files 3 passed (3), Tests 122 passed (122)`.

The isolation sweeps (`-t "phase 08.3 sweep|phase 08.5 sweep"`) gave `Tests 3 passed | 59 skipped (62)`. The `module-courses` and `api` typechecks are clean. `service.ts` has 0 `delete from course_lesson_materials`.

## Task 3: Member download tab (WR-02)

**RED.** Command: `pnpm --filter @rede-social/web exec vitest run MemberMaterials`, exit 1, `Tests 5 failed (5)`:

```
× WR-02: the blank tab opens INSIDE the tap … — expected "bound bound open" to be called with arguments: [ '', '_blank' ]
× WR-02: a lock refusal closes the blank tab … — expected "vi.fn()" to be called at least once
× WR-02: a refusal the session does not handle closes the blank tab … — expected "vi.fn()" to be called at least once
× WR-02: a thrown action closes the blank tab … — expected "vi.fn()" to be called at least once
× WR-02: a blocked blank tab (null) falls back … — expected 1st "bound bound open" call to have been called with [ '', '_blank' ], but called only 0 times
```

**GREEN.** `pnpm --filter @rede-social/web exec vitest run MemberMaterials LessonForm`, exit 0: `Test Files 2 passed (2), Tests 30 passed (30)`. The web typecheck (`next typegen && tsc --noEmit`) is clean.

Vitest does not emit TAP, and no TAP red-evidence gate was invoked for this quick task. The lines above are copied from the real Vitest output; no counts were fabricated.

## Plan-level verification

1. **Targeted pgTAP** (000/010/020/030/040/160/190/195): PASS, 619 tests.
2. **Full pgTAP** (`pnpm supabase test db`): the first run failed only on `154-moderation-log.sql` test 28 ("fact 5: every log row is anchored to two memberships…"), 1 of 1431. This is the integration-residue trip documented in the 08.5-VERIFICATION environment note. My Task 2 integration runs had just written to the local DB, and none of my changes touch moderation_log. **Path taken:** `pnpm db:reset && pnpm db:seed`, then a re-run: `Files=31, Tests=1431, Result: PASS`.
3. **Integration** (courses, courses-learn, media-playback, isolation; run after the reset): `Test Files 4 passed (4), Tests 184 passed (184)`.
4. **Web units:** `MemberMaterials` + `LessonForm`, 30/30 pass.
5. **Schema drift:** `pnpm db:generate` reports no schema changes. The expand-only grep is empty.
6. **Gate:** `TURBO_CACHE=local:r pnpm turbo lint typecheck test --continue --concurrency=4` gave `Tasks: 49 successful, 49 total`. The ERROR-severity log lines in the output are deliberate test fixtures ("subscriber exploded", "boom"). `bash scripts/check-ui-literals.sh` is OK. `.turbo/cache` is 0 B, so no cleanup was needed.
7. **No Co-Authored-By** in the last 3 commit messages.

## Gap and finding closure map

| Item | Closed by | Proven by |
|------|-----------|-----------|
| gaps[0].missing 1: the materials half of GOVERNED no longer depends on lesson or module liveness (new create-or-replace, same signature) | efcbb8b8 (`20261016110251` statement c) | pgTAP 195 tests 57-60 (removed lesson: N, H true and admin false; removed module: N true and admin false) |
| gaps[0].missing 2: the detach path | efcbb8b8 (column) + fe78e193 (`replaceMaterials` soft-delete and revive; readers filter) | pgTAP 195 tests 61-65 (detached: N, H true, H's list empty, admin false); media-playback `WR-01:` case; courses.test revive assertion |
| gaps[0].missing 3: pgTAP 195 cases, optionally a media-playback `/original` case | efcbb8b8, fe78e193 | the 9 `WR-01:` pgTAP assertions and media-playback `WR-01:` (detached free material: member bare 404, admin 302; removed paid lesson: holder bare 404 on `/original` and `/playback`, admin 302) |
| gaps[0].missing 4: override alternative | not taken (fixed instead) | n/a |
| WR-01 | efcbb8b8 + fe78e193 | as above |
| WR-02 | cb2a13b1 | `MemberMaterials.test.tsx`, 5 `WR-02:` cases |
| WR-03 | efcbb8b8 (`20261016110251` statement a) | pgTAP 195 § 8 tests 84-86 (drift simulation) |

## Deviations from Plan

**1. [Rule 2 - Doc consistency] DEPLOY.md step 1 text also said "four"**
- **Found during:** Task 1, step 4.
- **Issue:** Besides the "What ships" list and the grep sentence, the Order step 1 said "these four" pending files and "All four files are expand-only", and its bullet "the new column has a default" no longer covered a nullable column.
- **Fix:** Changed these to six. The bullet now reads "the new columns have a default or are nullable". The note on functions now says the WR-01/WR-03 file only re-creates three functions in place.
- **Commit:** efcbb8b8

**2. [Rule 2 - Doc consistency] Two more doc comments in service.ts**
- `readMaterials` and `materialUrl` doc comments now name the detached-row exclusion, next to the code filters the plan asked for.
- **Commit:** fe78e193

**3. Process note.** The first `migration up` for the custom migration was piped through `head -2`. The pipe closed early and killed the CLI before it applied the file, so the first "green" run still showed the red results. I re-ran `migration up` without the pipe; the file was applied (`20261016110251` is in `schema_migrations`), and the green run above comes after that.

Otherwise the plan was executed as written.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or trust-boundary surface. The threat register entries T-aqc-01..06 are mitigated as planned, and T-aqc-07/08 are accepted as planned.

## Hand-off

Not edited: `08.5-VERIFICATION.md`, `08.5-REVIEW.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`.

The orchestrator should re-run the gsd-verifier for phase 08.5 in re-verification mode, with the phase-dir argument for the fingerprint. Expected result:
- truth 4 is VERIFIED;
- COURSE-20 and COURSE-26 go back to complete;
- the WR-02 human item reduces to the real-device check, which stays blocked until Phase 01.1.

Note: the local DB was reset and re-seeded (step 2 recipe). Hand-made local rows are gone.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261016110155_courses_material_soft_delete.sql
- FOUND: supabase/migrations/20261016110251_courses_asset_gate_fail_closed.sql
- FOUND: apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials.test.tsx
- FOUND commits: efcbb8b8, fe78e193, cb2a13b1
