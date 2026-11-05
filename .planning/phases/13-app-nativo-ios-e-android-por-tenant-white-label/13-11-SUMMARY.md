---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 11
subsystem: api
tags: [native-app, push, api, contracts, additive, isolation, D-606, D-603, tracer]

requires:
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-03 token shapes (APNS_TOKEN_PATTERN, FCM_TOKEN_PATTERN, NATIVE_PLATFORMS) and 13-06 app.push_device_upsert"
provides:
  - "pushDeviceInputSchema and the pushSubscriptionSaveBodySchema union (body without kind = web shape, kind apns|fcm = native device)"
  - "savePushDevice(ctx, body) in module-notifications/server, exported"
  - "the existing POST /v1/notifications/push-subscriptions branches on kind; DELETE takes a native token up to 4096 characters"
  - "PUSH_DEVICE_TOKEN_MAX_LENGTH and the PushDeviceInput / PushSubscriptionSaveBody types"
affects: [13-12, 13-17]

plan_head_before: 83c19a3cb6e0abe8452f4c01a49e94574f8813c7
actuals:
  tokens: 21000
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "additive body union: z.preprocess tags a kind-less body 'webpush', then a z.discriminatedUnion over the web arm and the strict native arm"
    - "native token is shape-checked by anchored patterns from @rede-social/contracts/native, never by the push-service host list"
    - "refusal messages are fixed sentences so a delivery credential never reaches an error"

key-files:
  created:
    - packages/modules/notifications/tests/push-devices.test.ts
    - apps/api/tests/integration/push-devices.test.ts
  modified:
    - packages/modules/notifications/contracts/index.ts
    - packages/modules/notifications/server/push-subscriptions.ts
    - packages/modules/notifications/server/routes.ts
    - packages/modules/notifications/server/index.ts
    - apps/api/tests/isolation-inventory.ts

key-decisions:
  - "The save answer stays 204 for both arms. The plan text says 200 in two truths, but its own first truth says the route answers as it does for a web body, and the shipped route is 204; changing it would break every client."
  - "A client-sent kind: 'webpush' is refused (preprocess rewrites it to a value no arm accepts): the tag is the server's, so the published contract has exactly three body shapes: no kind, apns, fcm."
  - "environment is required for BOTH native kinds (fcm fixed to production), matching app.push_device_upsert, which refuses a null environment."
  - "The delete schema bound moves from 2048 to 4096 (PUSH_DEVICE_TOKEN_MAX_LENGTH) so an FCM token of 4096 characters deletes through the existing route; the web SAVE endpoint bound stays 2048."

patterns-established:
  - "Route-level native arm without a new route: the handler destructures the server-added tag and calls the sibling function"

requirements-completed: [NATIVE-09]

coverage:
  - id: D1
    description: "Tracer: a member saves an apns and an fcm token through the existing route, the rows exist for that member only, another tenant sees none and saves the same strings as separate rows, the owner-scoped DELETE removes only the caller's row, and the kind-less web body still saves"
    requirement: NATIVE-09
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/push-devices.test.ts#tracer"
        status: pass
    human_judgment: false
  - id: D2
    description: "The eight NATIVE-09 edges of the device body (boundary, adjacency, empty, encoding, ordering, precision, idempotency, concurrency) as 46 unit rows and 11 HTTP cases"
    requirement: NATIVE-09
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/push-devices.test.ts"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/push-devices.test.ts#NATIVE-09 edges over HTTP"
        status: pass
    human_judgment: false
  - id: D3
    description: "Blocked and soft-deleted members get the same status and code on a native save as on a web save; isolation inventory points at the native proof; every repository gate stays green"
    requirement: NATIVE-09
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/push-devices.test.ts#NATIVE-09 member state"
        status: pass
      - kind: other
        ref: "pnpm boundaries; pnpm guard:lanes; module-notifications vitest 186 tests; web route-handlers.inventory 4 tests; api isolation-inventory unit 9 tests"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 11: Native device token on the existing push save route Summary

**`POST /v1/notifications/push-subscriptions` now takes a second, additive body (`kind: 'apns' | 'fcm'`), validates it with strict kind/platform pairing and anchored token patterns, and writes it through `app.push_device_upsert` in the tenant transaction, while a body without `kind` is the web shape exactly as before.**

## Performance

- **Duration:** about 14 min
- **Tasks:** 3 (one tracer, one TDD, one gate)
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- `pushSubscriptionSaveBodySchema`: a `z.preprocess` tags a kind-less object `webpush`, then a discriminated union selects the web arm (the unchanged `pushSubscriptionInputSchema` plus the tag) or the strict `pushDeviceInputSchema`. Web refusals keep their paths (`keys.*`, `endpoint`), so `details.push = 'keys_invalid' | 'endpoint_invalid'` still works for web bodies.
- `savePushDevice` binds the five parameters into `select app.push_device_upsert(...)` inside `withTenantTx`, never calls `isAllowedPushEndpoint`, returns the id, and logs only `{ event: 'push.device.saved', kind, platform }`.
- The route handler branches on the tag and answers the same `204` for both arms; no route and no read door for tokens was added. The delete door is the existing owner-scoped one, with its bound raised to 4096.
- All eight NATIVE-09 edge truths have a test: 46 table rows in the unit file (boundary 15, adjacency 6, empty 5, encoding 7 mutations over both kinds, precision 3, union/delete/T-13-20 14) and 11 HTTP cases (refusals write nothing and never echo the token; idempotent save and delete; PWA row plus app token kept in stable order; `Promise.all` handoff of two members of one tenant over three rounds and of two tenants; blocked and soft-deleted members).

## Task Commits

1. **Task 1 + Task 2 unit half, RED** - `f1407d10` (test): 46 unit rows and the tracer integration, with an inert stub of the two new exports so the failures are assertions
2. **Task 1 GREEN** - `5ecdce4f` (feat): contracts, `savePushDevice`, route branch, export, delete bound
3. **Task 2 integration half** - `04b24862` (test): the edges over HTTP, idempotency, ordering, concurrency, member state
4. **Task 3: gate** - `b6ee98d6` (test): the isolation inventory comment; every gate below ran against the committed state

## TDD Gate Compliance

RED `f1407d10` precedes GREEN `5ecdce4f` (`test(13-11)` then `feat(13-11)`). No refactor commit.

RED evidence, from real Vitest output (JSON reporter, converted to the node:test-style record by a throwaway script in the scratchpad, outside the repo): command `pnpm --filter @rede-social/module-notifications exec vitest run tests/push-devices.test.ts`, exit 1, 46 tests, 33 passed, 13 failed; target test `NATIVE-09 boundary: token and appVersion lengths accepts apns 32 hex characters` failed on its assertion (the stub refused the body). `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK / target_test_failed`. The tracer integration test also failed on `expected 400 to be 204`. The 33 passing rows in RED are the refusals and the unchanged web arm, which the inert stub already satisfied. GREEN: 46 of 46.

Task 2's integration cases were written after Task 1's implementation (the plan orders them so) and passed on first run: they characterise behaviour of the route plus plan 06's function, and no probe revealed a gap in Task 1. The unit half of Task 2 went RED first.

## Verification run

- `pnpm --filter @rede-social/module-notifications exec vitest run`: 15 files, 186 tests pass (pre-existing 140 untouched, 46 new).
- `pnpm db:reset` then `pnpm db:seed` (once) and `pnpm supabase test db`: 55 files, 3304 tests, PASS.
- API integration: `push-devices.test.ts` 13 tests and `push.test.ts` 11 tests pass together (24); `isolation.test.ts -t b11` passes (1). The plan's "push-subscriptions" integration file does not exist; `push.test.ts` is the real counterpart.
- `pnpm boundaries`: 2224 files, no issues. `pnpm guard:lanes`: OK. Web `route-handlers.inventory.test.ts`: 4 pass; web `app/api/push/subscriptions/route.test.ts`: 5 pass; api `tests/unit/isolation-inventory.test.ts`: 9 pass.
- `tsc --noEmit` clean in module-notifications, api, web and contracts (run directly, see Deviations).
- Acceptance: no `isAllowedPushEndpoint` inside `savePushDevice`; no change to `packages/contracts/package.json`; no `apps/mobile` under the module; `grep -c "it(\|test("` on the unit file is 26 (and the table loops generate more at runtime); `Promise.all` appears twice in the integration file (once per concurrency case, each over two saves); `push-devices` appears once in the inventory.

## Deviations from Plan

**1. [Rule 3 - Blocking] Typecheck by `tsc --noEmit`, not `turbo typecheck`**
- `turbo typecheck --filter=@rede-social/web` depends on `build` and would start `next build`, which the executor rules forbid on this disk. Each of the four packages was checked with `pnpm --filter <pkg> exec tsc --noEmit`. All clean. No `.turbo` or `.next` was created.

**2. [Rule 1 - Plan text] Answer is 204, not 200**
- Two edge truths say "answers 200"; the first truth and the shipped route say "answers as it does for a web body", which is 204. Kept 204 for both arms (a different code would break every shipped client). Tests assert 204.

**3. [Acceptance metric] `git diff -U0 ... contracts/index.ts` removes one line, not zero**
- Raising the delete bound (the plan's own instruction, "raise the bound to 4096 only if it is lower") rewrites one existing line, `.max(PUSH_ENDPOINT_MAX_LENGTH)` to `.max(PUSH_DEVICE_TOKEN_MAX_LENGTH)`. Nothing else is removed. A 4096-character FCM token could not be deleted otherwise. The web save endpoint bound is still 2048 (tested). The BFF delete route shares the schema, so its bound is 4096 too; harmless.

**4. [Plan wording] The inventory case id stays `b11`; the new file is referenced in a comment**
- `tests/unit/isolation-inventory.test.ts` requires a case id to be the prefix of an `it(` title in `isolation.test.ts` or `realtime.test.ts`, so pointing the entry at `push-devices.test.ts` by id would fail the gate. The cross-tenant case stays `b11` and a comment above both entries names `push-devices.test.ts` as the native arm's proof (satisfies the `grep -c push-devices` criterion).

**5. [Rule 2 - Missing critical] A client-sent `kind: 'webpush'` is refused**
- The union tags the web arm server-side; accepting a client-sent tag would publish a fourth body shape. The preprocess rewrites an explicit `webpush` to a value no arm accepts (400 `VALIDATION_FAILED`). Tested in unit and over HTTP.

**Total deviations:** 5 (1 blocking-rule workaround, 1 bug in plan text, 2 acceptance-metric/wording notes, 1 missing-critical hardening). **Impact:** none on scope.

## Issues Encountered

- A stray `cat > /tmp/x` in one command waited on stdin and stalled a shell for two minutes (killed; the file was never written and was removed). No effect on the repo.
- `GET /v1/openapi.json` answers 500 in this checkout because `notificationQuerySchema.limit` uses `z.coerce.number().int().catch(...)`, which `@hono/zod-openapi` cannot convert ("Unknown zod object type ... type: catch"). This is not from this plan: the failing schema is the list route's query, untouched here. The new save body, built alone through `getOpenAPIDocument`, generates without error. Logged for the verifier; not fixed (out of scope).

## Known Stubs

None. The RED stubs were fully replaced in the GREEN commit.

## Threat Flags

None beyond the plan's register. T-13-19 (forged or cross-tenant token, or a URL-shaped token) is mitigated and proven: strict union, kind/platform pairing, anchored patterns, the write scoped by the definer, and two-tenant negatives next to positive controls. T-13-20 (token in a log, error or read route) is mitigated and proven: the log event is shape-only, issue messages are fixed text (unit test asserts a distinctive token never appears in any issue; the HTTP test asserts it never appears in the 400 body), no read route exists, and delete answers 204 identically for unknown, foreign-member and foreign-tenant tokens.

## Next Phase Readiness

- Plan 12 (the worker) reads `app.push_subscriptions_for_v2` and can rely on a native row always carrying a pattern-valid token, a paired platform, an environment and a semver app version.
- Plan 17 (the web BFF door and permission screens) still parses with `pushSubscriptionInputSchema` in `apps/web/app/api/push/subscriptions/route.ts`; it must switch to `pushSubscriptionSaveBodySchema` (and forward `kind` bodies) to let the shell register a token. NATIVE-09 is shared with plan 17, so it stays pending in REQUIREMENTS.md until that plan finishes.
- Deploy order is migration, API, worker. Not pushed, nothing applied to a hosted project.

## Self-Check: PASSED

- Files exist: both new test files and the five modified files (checked with `ls`).
- Commits found: `f1407d10`, `5ecdce4f`, `04b24862`, `b6ee98d6`; `plan_head_before..HEAD` counts 4.
- Acceptance criteria re-run as listed under Verification run; nothing under `.planning/sketches/` staged.

---
*Phase: 13-app-nativo-ios-e-android-por-tenant-white-label*
*Completed: 2026-11-05*
