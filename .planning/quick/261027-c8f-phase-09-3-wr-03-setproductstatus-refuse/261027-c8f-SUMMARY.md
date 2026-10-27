---
phase: quick-261027-c8f
plan: 01
subsystem: store
tags: [store, communities, soft-delete, review-fix, quick]
requirements: [PEND-04, PEND-06]
status: complete
commits: 4
plan_head_before: 068e11ce
actuals:
  tasks: 3
  commits: 4
key-files:
  modified:
    - packages/modules/store/contracts/index.ts
    - packages/modules/store/tests/contracts.test.ts
    - packages/modules/store/server/service.ts
    - packages/modules/store/server/routes.ts
    - packages/modules/store/README.md
    - apps/api/tests/integration/communities-delete.test.ts
    - apps/web/app/(app)/loja/product-actions.ts
    - apps/web/app/(app)/loja/ProductForm.tsx
    - apps/web/app/(app)/loja/ProductForm.test.tsx
    - apps/web/app/(app)/loja/[productId]/ReactivateProduct.tsx
    - apps/web/messages/pt-BR/store.json
  created:
    - apps/web/app/(app)/loja/product-actions.test.ts
---

# Quick 261027-c8f: WR-03, setProductStatus refuses a product that links a deleted community

One-liner: reactivating a non-active Loja product that links a soft-deleted community of the tenant is now `409 { store: 'community_deleted' }` (product row FOR NO KEY UPDATE, then linked community rows FOR SHARE, so it serialises with `deleteCommunity`), with its own pt-BR toast on both reactivate surfaces.

## Commits (no trailer, nothing pushed)

| Task | SHA | Message |
|------|-----|---------|
| 1 (tracer) | 466576ee | fix(store): refuse reactivating a product that links a deleted community (09.3 WR-03) |
| 2 | 30116846 | test(store): prove the reactivation guard across tenants, links and races (09.3 WR-03) |
| 3 | 2541f946 | fix(web): explain a refused reactivation of a product that links a deleted community (09.3 WR-03) |
| fmt | 2939d5a3 | style(store): format the WR-03 integration cases (Biome re-flowed two lines of Task 2's test code) |

## What was built

- `STORE_ISSUES` gains `community_deleted` (docblock and contracts test updated).
- `setProductStatus`: locking read of the product (`for no key update`), 404 first and unchanged, then, only on a transition to `active`, `refuseDeletedCommunityLinks` (tenant-scoped join, `order by c.id for share of c`, deleted flag read from the locked row, ids-only `store.product_status_refused` log line). The idempotent UPDATE is unchanged. The docblock records the lock order and the no-cycle argument.
- OpenAPI 409 on `setProductStatusRoute`, a clause on the 200, and a README clause.
- Integration cases 13-19 appended to `communities-delete.test.ts`.
- Web: `ProductStatusResult` code `community_deleted`, mapped in `setProductStatusAction`; both `ReactivateProduct` and `ProductForm.changeStatus` show `store.errors.reactivateCommunityDeleted`.

## Red-then-green evidence

Before the service change, with cases 13-15 written: `communities-delete.test.ts` 14 passed, 1 failed. Case 13 failed with `expected 200 to be 409` (the body was the active product), the right reason. Cases 14 and 15 are controls and passed before and after. After the change: 15/15, then 19/19.

## Test counts

| File | Result |
|------|--------|
| apps/api/tests/integration/communities-delete.test.ts | 19 passed (12 existing + 13-19) |
| apps/api/tests/integration/store.test.ts | 50 passed |
| packages/modules/store/tests/contracts.test.ts | 35 passed |
| apps/web `app/(app)/loja` + i18n | 11 files, 1679 passed (new product-actions.test.ts: 5 tests; new ProductForm case 13a) |
| turbo typecheck + lint (module-store, api, web) | 8/8 tasks successful |

Case 18 shows the waiting behaviour in both directions (the PUT did not settle within 400 ms behind a held FOR UPDATE; the delete did not settle behind a held FOR SHARE plus an uncommitted reactivation), so the lock is taken and conflicts. Case 19 (3 rounds of a real race) ended in `204/409` or `409/200` every time.

## Deviations from Plan

- Added a fourth commit (`style`), because `biome check` after the lint gate re-flowed two lines in the Task 2 test code. No behaviour change.
- Case 16 foreign-link sub-step: the database ACCEPTED the planted link (demo product -> lab deleted community; the FK is single-column), so the sub-step ran in full and the demo reactivation stayed 200 with no lab detail in the body.
- Lab store access in the new describe: `withStoreEnabled('lab')` in its own `beforeAll`/`afterAll`, as planned.
- `apps/web/.next` was created by the turbo build and removed afterwards.
- No migration, no pgTAP edit (`git status --short supabase` empty).

## Follow-up (not changed, by plan)

`replaceLinks` drops links only to ACTIVE, live communities (CR-02), so a link to a deleted community can never be removed by an edit. A product that was refused stays archived for good, and the pt-BR copy tells the admin to create a new product. Letting an edit drop links to deleted communities (or treating such a product as unavailable at read time) is a separate decision that touches CR-02 reasoning.

## Known Stubs

None.

## Threat Flags

None. The 409 carries only the closed code; unknown and foreign ids stay the bare 404 (T-qc8-02, case 16); the join is tenant-scoped (T-qc8-03, case 16 foreign link); the race is proved (T-qc8-01, cases 18-19).

## Self-Check: PASSED

Commits 466576ee, 30116846, 2541f946, 2939d5a3 exist on master; the summary's files exist; no Co-Authored-By trailer.
