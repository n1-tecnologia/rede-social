---
phase: quick-261016-jsq
plan: 01
subsystem: api
status: complete
tags: [api, rbac, members, directory, privacy, pendencias-backend]
requires: []
provides:
  - "GET /v1/members guarded by requireRole('admin_tenant', 'support_tenant'), 403 FORBIDDEN for member before validation"
affects:
  - apps/api/src/routes/members.ts
  - apps/api/tests/integration/members.test.ts
  - apps/api/tests/integration/member-admin.test.ts
  - apps/api/tests/integration/isolation.test.ts
tech-stack:
  added: []
  patterns:
    - "route-level role guard via createRoute({ middleware: [guard] as const }), runs before the zod-openapi validators"
    - "DB-free router unit test: requireAuth and kernel service mocked with top-level vi.mock + vi.hoisted"
key-files:
  created:
    - apps/api/tests/unit/members-directory-staff-only.test.ts
  modified:
    - apps/api/src/routes/members.ts
    - apps/api/tests/integration/members.test.ts
    - apps/api/tests/integration/member-admin.test.ts
    - apps/api/tests/integration/isolation.test.ts
    - docs/pendencias-backend.md
    - apps/web/lib/member-directory.ts
    - apps/web/app/(app)/membros/page.tsx
    - apps/web/app/(app)/membros/actions.ts
decisions:
  - "Staff-only directory list is role-based (requireRole admin_tenant + support_tenant), not a new permission: support_tenant holds no kernel permission (D-223)"
  - "GET /v1/members/{membershipId} stays open to every tenant role (author profile and author @ on posts)"
metrics:
  duration: "~4 min"
  completed: 2026-10-16
plan_head_before: dc0dc744642ad2f831f8f9c8ba178616766c4446
actuals:
  tokens: 8820
  tasks: 3
  commits: 4
---

# Quick 261016-jsq: GET /v1/members is staff-only Summary

The member directory list (`GET /v1/members`, with or without `q`, `cursor` or `limit`) now requires `admin_tenant` or `support_tenant` through the kernel `requireRole` as route middleware, answering 403 `FORBIDDEN` (no details) to a `member` before the query is validated; the single read `GET /v1/members/{membershipId}` stays open to every tenant role. Closes pendencias-backend item 7.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Tracer: guard + DB-free unit proof + live-stack proof | f3b7df5a | apps/api/src/routes/members.ts, apps/api/tests/unit/members-directory-staff-only.test.ts, apps/api/tests/integration/members.test.ts |
| 2a | member-admin reads the directory as support | 85600bc2 | apps/api/tests/integration/member-admin.test.ts |
| 2b | isolation reads the directory as staff, asserts member 403 | 9900faaf | apps/api/tests/integration/isolation.test.ts |
| 3 | pendencias item 7 done; web comments corrected | d2367c86 | docs/pendencias-backend.md, apps/web/lib/member-directory.ts, apps/web/app/(app)/membros/page.tsx, apps/web/app/(app)/membros/actions.ts |

Each commit's `git show --stat` listed only its own files; no commit carries a Co-Authored-By trailer.

## Red evidence (Task 1 Step A)

Before the guard existed, `pnpm --filter @rede-social/api exec vitest run tests/unit/members-directory-staff-only.test.ts`:
`Tests  2 failed | 3 passed (5)`. The two failures were case 1 (member got 200, expected 403) and case 5 (OpenAPI responses `[ '200', '400' ]` did not include `403`). After the guard: `Tests  5 passed (5)`.

## Verification run

- `vitest run tests/unit/members-directory-staff-only.test.ts`: 5 passed (5)
- `pnpm --filter @rede-social/api test` (unit suite, includes isolation-inventory): 8 files, 67 passed (67)
- `pnpm --filter @rede-social/api typecheck`: exit 0
- `pnpm --filter @rede-social/api lint` (biome check .): 107 files, no findings
- `pnpm exec biome check` on the three web files and the two edited integration files: clean
- `vitest run tests/integration/members.test.ts` (the one allowed integration file, live local stack): 32 passed (32), run twice (after Task 1 and at the end)
- No out-of-scope typecheck or lint findings.

## isolation.test.ts outcome

Committed (9900faaf). The file was clean against HEAD before editing; the staged diff held only edits 2a (case `n.`: list read as `tokens.labAdmin`, plus the lab member's 403 `FORBIDDEN`) and 2b (D-309 case: S and the seeded demo member get 403 `FORBIDDEN` on the demo host via `send(...)`, then the demo-host directory loop reads as `tokens.demoAdmin` only). Case `p.` untouched. No hand-off needed.

## Targeted integration runs for the orchestrator (when the shared stack is free)

- `pnpm --filter @rede-social/api exec vitest run tests/integration/member-admin.test.ts -t "D-331|privacy"`
- `pnpm --filter @rede-social/api exec vitest run tests/integration/isolation.test.ts -t "n\. the directory|members directory and the D-309"`

These were NOT run here (shared-database rule); they are proven by typecheck, Biome and the unit suite only.

## Deviations from Plan

- New members.test.ts cases 28-32 are placed in a describe that runs BEFORE the `teardown` describe (case 27), because case 27 deletes the fixture memberships that case 30 needs. Numbering continues after 27 as the plan asked; an inline comment explains the order.
- The tracer docblock sentence in members.test.ts was adjusted ("the seeded admin lists ... a seeded member opens one of the results") to match the staff-token default.

Otherwise the plan executed as written.

## Flag for the user: PROF-03 wording

REQUIREMENTS.md PROF-03 still reads "Member can browse a searchable list of the tenant's members". After this change the list is staff-only (`admin_tenant`, `support_tenant`). Not edited here (REQUIREMENTS edits make phase verification stale and phase 08.6 is executing); please reword it once 08.6 closes.

## Known Stubs

None.

## Threat Flags

None. The change narrows an existing surface (T-jsq-01..05 mitigated as planned); no new endpoint, auth path or schema.

## Self-Check: PASSED

- FOUND: apps/api/tests/unit/members-directory-staff-only.test.ts
- FOUND commits: f3b7df5a, 85600bc2, 9900faaf, d2367c86
- Measured commits since plan_head_before: 4
