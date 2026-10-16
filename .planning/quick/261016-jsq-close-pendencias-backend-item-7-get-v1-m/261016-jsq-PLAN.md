---
phase: quick-261016-jsq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/routes/members.ts
  - apps/api/tests/unit/members-directory-staff-only.test.ts
  - apps/api/tests/integration/members.test.ts
  - apps/api/tests/integration/member-admin.test.ts
  - apps/api/tests/integration/isolation.test.ts
  - docs/pendencias-backend.md
  - apps/web/lib/member-directory.ts
  - apps/web/app/(app)/membros/page.tsx
  - apps/web/app/(app)/membros/actions.ts
autonomous: true
requirements: [ROLE-06, PROF-03, PROF-02]
tags: [api, rbac, members, directory, privacy, pendencias-backend]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A `member` calling GET /v1/members gets 403 with the standard envelope, code `FORBIDDEN` and no details: with no query, with `?q=`, with `?cursor=` and with an invalid `?limit=0` (the role guard runs BEFORE the query validator, so a member learns nothing about the query contract). The kernel `listMembers` is never invoked for that member."
    - "`admin_tenant` and `support_tenant` still get 200 with the unchanged D-47 page (active `member` rows only, same ordering, same cursor, same search), and a staff caller's malformed query is still 400 `VALIDATION_FAILED`."
    - "GET /v1/members/{membershipId} stays open to every tenant role including `member` (a member opens another member's profile and a staff profile by direct link, 200), and its D-23 bare 404 is unchanged."
    - "The role is the membership of record on THIS host, read from the membership row by requireAuth (ROLE-06), never a JWT claim: the same identity that is `admin_tenant` on rede-lab lists on the lab host and is refused 403 `FORBIDDEN` on the demo host where it is a `member`. `super_admin` has no membership and still gets 403 `NO_MEMBERSHIP` from requireAuth before the role guard; a session on another tenant's host still gets `TENANT_HOST_MISMATCH` before it."
    - "The OpenAPI document of GET /v1/members declares the 403 `FORBIDDEN` response; GET /v1/members/{membershipId} declares none."
    - "docs/pendencias-backend.md records item 7 as done on the API side with its number kept (items 8, 9 and 10 are cited by number in code comments), and the three web comments that call the API restriction a pending backend item now say the API refuses a member."
    - "No schema or migration change, no web behaviour change, no commit carries a file of phase 08.6 or the unrelated working-tree changes, and no commit carries a Co-Authored-By trailer."
  artifacts:
    - path: "apps/api/src/routes/members.ts"
      provides: "list route guarded by requireRole('admin_tenant', 'support_tenant') as route middleware; 403 FORBIDDEN documented; single-read route unguarded"
      contains: "requireRole('admin_tenant', 'support_tenant')"
    - path: "apps/api/tests/unit/members-directory-staff-only.test.ts"
      provides: "DB-free test of the members router with requireAuth and the profiles service mocked: role matrix, guard-before-validation, single read open, OpenAPI 403"
      contains: "FORBIDDEN"
    - path: "apps/api/tests/integration/members.test.ts"
      provides: "list reads moved to staff tokens; new staff-only describe proving member 403 and staff 200 against the live local stack"
      contains: "FORBIDDEN"
    - path: "apps/api/tests/integration/member-admin.test.ts"
      provides: "D-331 and privacy cases read the directory as support_tenant"
    - path: "apps/api/tests/integration/isolation.test.ts"
      provides: "case n lists as the lab admin and asserts the lab member's 403; the D-309 directory case reads the demo host as the demo admin and asserts S (member on demo) gets 403"
    - path: "docs/pendencias-backend.md"
      provides: "item 7 marked done on the API side, Atualizado em 2026-10-16"
      contains: "403 `FORBIDDEN`"
  key_links:
    - from: "apps/api/src/routes/members.ts listRoute"
      to: "packages/core/server/rbac/require-role.ts requireRole"
      via: "createRoute({ middleware: [staffOnly] as const }) after members.use('*', requireAuth)"
      pattern: "requireRole\\('admin_tenant', 'support_tenant'\\)"
    - from: "requireRole"
      to: "ctx.role set by requireAuth from the membership row of the host's tenant"
      via: "c.get('ctx').role"
      pattern: "roles.includes\\(ctx.role\\)"
    - from: "apps/web/lib/member-directory.ts canBrowseMemberDirectory"
      to: "apps/api/src/routes/members.ts staffOnly"
      via: "the same two roles on both sides (admin_tenant, support_tenant)"
      pattern: "support_tenant"
---

<objective>
Close item 7 of docs/pendencias-backend.md: GET /v1/members (the plain list and the `?q=` search) requires a staff role and answers 403 `FORBIDDEN` to a `member`; GET /v1/members/{membershipId} stays open to members.

Purpose: since commit cf7d8490 (2026-10-12) the restriction exists only in the web screens (`canBrowseMemberDirectory` in apps/web/lib/member-directory.ts gates the /membros page and its load-more action), so any member can still enumerate the tenant's members (names, photos, bios) straight from the API. The API must enforce the same rule (ROLE-06: authorization is enforced in the API).

Output: the guarded route with its OpenAPI 403, a DB-free unit test of the router, the three integration suites that read the directory moved to staff tokens with new negative cases, the pendências doc updated, and three stale web comments corrected.

Design decisions (planner, Claude's discretion, recorded here so the executor does not revisit them):
- GUARD = the existing kernel `requireRole('admin_tenant', 'support_tenant')` from `@rede-social/core/server/rbac/require-role`, mounted as route middleware on the LIST route only, exactly like `requirePermission` is mounted in apps/api/src/routes/admin/members.ts (`middleware: [guard] as const` inside `createRoute`). NOT a new permission: `support_tenant` holds no kernel permission on purpose (D-223, the comment above `KERNEL_ROLE_PERMISSIONS` in packages/core/server/rbac/require-role.ts), so no permission names "the staff", and adding one would put a kernel grant on support that D-223 rules out and would change every support session's bootstrap `permissions`. The web made the same role-based choice for the same reason (comment in apps/web/lib/member-directory.ts). `requireRole` is already unit-tested for exactly this pair (packages/core/tests/require-role.test.ts case 3).
- `super_admin`: `TenantRole` has no `super_admin` (it lives in `platform_admins`), and requireAuth answers 403 `NO_MEMBERSHIP` before any tenant-lane route runs (isolation.test.ts case `p` already proves it for /v1/members). So the staff set is exactly `admin_tenant` + `support_tenant`; nothing to add for `super_admin`.
- `@hono/zod-openapi` registers route middleware BEFORE the request validators (`this.on(method, path, ...middleware, ...validators, handler)` in its dist/index.mjs line 164), so a member's malformed query is 403, never 400.
- Web: no behaviour change is needed. The only API consumer of the list is `getMembers` in apps/web/lib/profile.ts, called only by the /membros page and `loadMoreMembersAction`, both of which already stop a member before the call. `GET /v1/members/{id}` consumers (apps/web/lib/author-instagram.ts, `loadMemberProfile`) are untouched by this change.
- No schema or migration change is involved.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@docs/pendencias-backend.md

CONCURRENCY RULES (hard, apply to every task). Another GSD executor (phase 08.6, courses member area) runs in this SAME working tree on master and shares the local Supabase stack.
- Stage ONLY by explicit path (`git add <path>`); never `git add -A`, `git add .`, `git add -u` or `git commit -a`.
- Commit ONLY by explicit path: `git commit -m "<message>" -- <path> [<path>...]` (pathspec form = `--only`), so anything the other executor has staged stays out of this task's commits. A new file needs `git add <path>` first. If the commit fails on `.git/index.lock`, wait a few seconds and retry; never delete the lock.
- After every commit run `git show --stat --format= HEAD` and confirm it lists only the paths of that commit; and `git log -1 --format=%B` must contain no `Co-Authored-By` line (public repo rule; the author identity is already configured). Do NOT add any Claude or Co-Authored-By attribution.
- Never touch `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md` or anything under `.planning/phases/08.6-*`. Leave every unrelated working-tree change alone (currently `packages/modules/courses/db/schema.ts`, `supabase/migrations/meta/_journal.json`, untracked `.claude/**`, `docs/LOCAL-SETUP.md` and others): never stage, restore, stash or reformat them.
- Shared database: never run `pnpm db:reset`, `pnpm db:seed`, `supabase db reset`, `pnpm supabase test db` or the whole integration suite (`pnpm test:integration`). The ONLY integration run allowed is `pnpm --filter @rede-social/api exec vitest run tests/integration/members.test.ts`. If it fails for a reason outside this change (seed missing because the other executor is mid-reset, sign-in failing, counts drifting), wait about a minute and re-run it once; if it still fails that way, record the exact failure in the SUMMARY instead of resetting anything.
- `apps/api/tests/integration/isolation.test.ts` is ALSO edited by phase 08.6 plans; follow the protocol in Task 2 for it.

Key sources (read once each, then stop reading):
- apps/api/src/routes/members.ts (the router under change)
- packages/core/server/rbac/require-role.ts (`requireRole`, `KERNEL_ROLE_PERMISSIONS`, the D-223 comment)
- apps/api/src/routes/admin/members.ts lines 50-85 (the `middleware: [guard] as const` + `403: envelope(...)` precedent)
- packages/core/tests/require-role.test.ts (the hand-built Hono app + `errorEnvelope` onError pattern for a DB-free router test)
- packages/core/server/auth/context.ts (`RequestContext` = userId, tenantId, role, requestId, events; `AppEnv` Variables ctx, logger)
- apps/api/tests/integration/members.test.ts (helpers `members(query, token)` = list, `member(id, token)` = single read; `fixtureMember`, `fixtureToken`)
- apps/web/lib/member-directory.ts (`canBrowseMemberDirectory`, the front's rule)
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Tracer — the member directory list is staff-only end to end (guard, unit proof, live-stack proof)</name>
  <files>apps/api/src/routes/members.ts, apps/api/tests/unit/members-directory-staff-only.test.ts, apps/api/tests/integration/members.test.ts</files>
  <read_first>
    - apps/api/src/routes/members.ts
    - packages/core/server/rbac/require-role.ts
    - apps/api/src/routes/admin/members.ts (lines 50-85 only)
    - packages/core/tests/require-role.test.ts
    - apps/api/tests/integration/members.test.ts
  </read_first>
  <action>
    Implements pendencias-backend item 7 (ROLE-06, PROF-03 narrowed to staff by the 2026-10-12 product decision, PROF-02 kept open).

    Step A (test first). Create apps/api/tests/unit/members-directory-staff-only.test.ts, a DB-free test of the real `membersRoutes` router. At top level (Vitest 5: `vi.mock` must be top-level; use `vi.hoisted` for the mock functions) mock `@rede-social/core/server/auth/require-auth` so `requireAuth` is a `createMiddleware` (from `hono/factory`) that reads the role from a test-only request header (for example `x-test-role`), sets `ctx` to a full `RequestContext` (userId, tenantId, role, requestId, events: []) and sets `logger` to a stub whose `info` is a `vi.fn()`, then calls `next()`. Mock `@rede-social/core/server/profiles/index` so `listMembers` resolves `{ items: [], nextCursor: null }` and `getMemberProfile` resolves a valid `memberProfileSchema` object (membershipId a uuid, displayName, bio null, avatarUrl null, avatarAssetId null; check `packages/contracts/src/profiles.ts` for the exact fields). Build a `new Hono<AppEnv>()` whose `onError` returns `errorEnvelope(err, 'req-1')` as in packages/core/tests/require-role.test.ts, and mount `membersRoutes` (imported from `../../src/routes/members`) at `/v1/members`. Cases, each in its own `it`:
    1. role `member`: GET /v1/members, /v1/members?q=ana, /v1/members?cursor=abc and /v1/members?limit=0 each answer 403 with `error.code` `FORBIDDEN` and `error.details` undefined, and `listMembers` was never called (the `?limit=0` case proves the guard runs before validation: 403, not 400).
    2. roles `admin_tenant` and `support_tenant`: GET /v1/members and /v1/members?q=ana answer 200 and `listMembers` was called with the parsed query.
    3. role `support_tenant` with ?limit=0 answers 400 `VALIDATION_FAILED` (validation still applies to staff).
    4. role `member`: GET /v1/members/{a uuid} answers 200 (the single read stays open) and `getMemberProfile` was called with that id.
    5. the OpenAPI document from `membersRoutes.getOpenAPIDocument({ openapi: '3.0.0', info: { title: 't', version: '1' } })` has a `403` response on the GET of path `/` and none on the GET of `/{membershipId}`.
    Run it and confirm cases 1 and 5 FAIL before the guard exists; copy the Vitest failing/passing counts from that run into the SUMMARY as red evidence (real numbers from the output, never invented).

    Step B (guard). In apps/api/src/routes/members.ts import `requireRole` from `@rede-social/core/server/rbac/require-role` and declare `const staffOnly = requireRole('admin_tenant', 'support_tenant');` with a short comment: pendencias-backend item 7 / 2026-10-12 decision; role-based on purpose like `canBrowseMemberDirectory` in apps/web/lib/member-directory.ts, because `support_tenant` holds no kernel permission (D-223) so no permission names the staff; `super_admin` never reaches here (requireAuth answers NO_MEMBERSHIP). Add `middleware: [staffOnly] as const` to `listRoute` only (same placement as apps/api/src/routes/admin/members.ts). Add a `403: envelope(...)` response to `listRoute` describing: FORBIDDEN, the caller is a `member` of this tenant, the directory is for the tenant's staff (`admin_tenant`, `support_tenant`) only, answered before the query is validated so a member learns nothing about `q`, `cursor` or `limit`. Leave `readRoute` without any middleware; append to its 200 description that it is open to every tenant role including `member` (it opens a profile from an author's name and serves the author's @ on posts). Update the file's header docblock: the LIST is staff-only (403 FORBIDDEN for `member`, quick 261016-jsq), the single read stays open to every member; keep the D-47 paragraph as it is. Do not touch `listMembers`/`getMemberProfile` or any contract schema.

    Step C (live stack). Update apps/api/tests/integration/members.test.ts so every LIST read uses a staff token and every single read keeps its member token:
    - add tokens signed in in `beforeAll`: the seeded `admin@rede-demo.local` (ADMIN_EMAIL already exists) as the demo staff token, `support@rede-demo.local` as the demo support token, and `admin@rede-lab.local` as the lab staff token (all with SEED_PASSWORD);
    - make the `members(query, token)` helper default to the demo staff token (the `member(id, token)` helper keeps defaulting to the member token);
    - sign in the fixture tenant's support seat (`fixture.support`) into a new fixture staff token (extend `fixtureMember` so a non-member role that signs in fills the staff variable and a `member` fills `fixtureToken`), and switch every list call that currently passes `fixtureToken` (tests 7, 8, 11-22, 26) to the fixture staff token; tests 9 and 10 keep `fixtureToken` (single reads as a member);
    - switch the lab LIST reads in tests 23 and 25 to the lab staff token; test 24 keeps `labToken` (single read as a lab member);
    - add `describe('pendencias item 7 — the directory is staff-only (403 FORBIDDEN for member)')` with numbered cases continuing after 27: (28) the seeded demo member gets 403 `FORBIDDEN`, no details, on /v1/members, ?q=goncal, ?cursor=garbage and ?limit=0, and none of those bodies contains `João Gonçalves` or `Íris Muñoz`; (29) the seeded demo support and demo admin both get 200 and the same ordered membershipIds; (30) the fixture member gets 403 and the fixture support seat gets exactly the three active ids; (31) the lab member gets 403 on the list while the lab admin gets 200; (32) the seeded demo member still opens another member's profile and the admin's profile with 200 (GET /v1/members/{id});
    - add one invariant line to the header docblock: pendencias item 7, the LIST is staff-only and the single read stays open.
    Run the unit file, then the single integration file (members.test.ts only, per the concurrency rules).

    Commit (explicit paths only, no trailer): `git add apps/api/tests/unit/members-directory-staff-only.test.ts` then `git commit -m "fix(quick-261016-jsq): GET /v1/members is staff-only, 403 FORBIDDEN for member (pendencias item 7)" -- apps/api/src/routes/members.ts apps/api/tests/unit/members-directory-staff-only.test.ts apps/api/tests/integration/members.test.ts`.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/api exec vitest run tests/unit/members-directory-staff-only.test.ts &amp;&amp; pnpm --filter @rede-social/api exec vitest run tests/integration/members.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "requireRole('admin_tenant', 'support_tenant')" apps/api/src/routes/members.ts` shows the `staffOnly` declaration (at least 1 line), and `listRoute` carries `middleware: [staffOnly]` while `readRoute` carries no `middleware` key (read the two `createRoute` blocks).
    - `grep -c "FORBIDDEN" apps/api/src/routes/members.ts` prints at least 1; `grep -c "FORBIDDEN" apps/api/tests/integration/members.test.ts` prints at least 1.
    - The unit file reports 5 or more passing tests and 0 failing; members.test.ts reports 0 failing (32 or more passing).
    - `git show --stat --format= HEAD` lists exactly the three task files; `git log -1 --format='%(trailers:key=Co-Authored-By)'` prints nothing.
  </acceptance_criteria>
  <done>A member's GET /v1/members (any query) is 403 FORBIDDEN before validation, staff get the unchanged page, the single read stays open to members, the OpenAPI doc says so, and both the DB-free unit test and the live-stack members suite prove it; committed alone.</done>
</task>

<task type="auto">
  <name>Task 2: Move the other integration suites' directory reads to staff and assert the member/cross-identity 403</name>
  <files>apps/api/tests/integration/member-admin.test.ts, apps/api/tests/integration/isolation.test.ts</files>
  <read_first>
    - apps/api/tests/integration/member-admin.test.ts (lines 30-60, 150-160, 710-735, 1300-1312 only)
    - apps/api/tests/integration/isolation.test.ts (lines 115-130, 265-270, 5935-5960, 7255-7330 only; use grep to re-locate if the other executor shifted lines)
  </read_first>
  <action>
    These two suites call the list as a `member` and would turn red after Task 1. They may NOT be run here (shared database rule); they are proven by typecheck, Biome, the API unit suite (which reads isolation.test.ts titles through tests/unit/isolation-inventory.test.ts) and by the targeted runs the orchestrator does later.

    member-admin.test.ts (not touched by phase 08.6):
    - in `it('D-331: no member-facing response carries the reason', …)`, the loop that reads four paths as `tokens.member` keeps the comments, profile and bootstrap reads as the member but reads `/v1/members?limit=50` as `tokens.support` (the directory is staff-facing since pendencias item 7); keep the assertion that no body contains REASON; adjust the inline comment accordingly.
    - in `it('privacy: the member-facing directory carries no trace of the field', …)`, read the directory as `tokens.support`, keep `status 200` and the `nconfirmed` negative, and retitle it to say the staff-facing directory (role support_tenant) carries no trace of the field.
    Commit it alone: `git commit -m "test(quick-261016-jsq): member-admin reads the member directory as support (pendencias item 7)" -- apps/api/tests/integration/member-admin.test.ts`.

    isolation.test.ts (SHARED with phase 08.6 — protocol):
    1. Run `git diff --quiet HEAD -- apps/api/tests/integration/isolation.test.ts`. If it exits non-zero the other executor has uncommitted work there: do not edit it yet; finish member-admin first, then re-check every minute or so for up to about 10 minutes. If it is still dirty, do NOT edit or stage it; write both edits below, verbatim in intent, into the SUMMARY under a "Hand-off: isolation.test.ts" heading for the orchestrator, and continue to Task 3.
    2. When clean, make only these scoped `Edit` replacements (never `Write` the file):
       a. case `n.` (title unchanged, the inventory maps both /v1/members routes to case id `n`): keep the single-read negative as the lab member and the demo member's own positive; switch the list read from the lab member token to `tokens.labAdmin` (the positive control that lists the lab member and never A's names stays); then add that the lab member's own list read answers 403 with `code` `FORBIDDEN`.
       b. the case whose title starts `members directory and the D-309 admin view`: the lab-host loop over `[s.token, tokens.labAdmin]` stays (S is `admin_tenant` on rede-lab); replace the demo-host loop's readers with `tokens.demoAdmin` only (S and the seeded demo member are `member` on rede-demo); before that loop add a check that S's token and the seeded demo member's token on HOSTS.demo get 403 `FORBIDDEN` for `/v1/members?limit=50` via `send(...)` and `code(...)` — the same identity lists on the lab host and is refused on the demo host because the role is the host's membership of record. Keep the title unchanged.
       Leave case `p.` (super_admin, NO_MEMBERSHIP) unchanged: it already proves requireAuth refuses the platform identity before the role guard.
    3. Immediately `git add apps/api/tests/integration/isolation.test.ts`, then inspect `git diff --cached -- apps/api/tests/integration/isolation.test.ts`: every changed line must belong to edits 2a and 2b. If any other hunk appears (the other executor edited in between), run `git restore --staged apps/api/tests/integration/isolation.test.ts` (unstage only; never revert their working-tree change), and record the hand-off in the SUMMARY as in step 1. Otherwise commit at once: `git commit -m "test(quick-261016-jsq): isolation reads the member directory as staff and asserts the member 403 (pendencias item 7)" -- apps/api/tests/integration/isolation.test.ts`.
    Record in the SUMMARY the targeted runs the orchestrator should do when the shared stack is free: `pnpm --filter @rede-social/api exec vitest run tests/integration/member-admin.test.ts -t "D-331|privacy"` and `pnpm --filter @rede-social/api exec vitest run tests/integration/isolation.test.ts -t "n\. the directory|members directory and the D-309"`.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/api typecheck &amp;&amp; pnpm exec biome check apps/api/tests/integration/member-admin.test.ts apps/api/tests/integration/isolation.test.ts &amp;&amp; pnpm --filter @rede-social/api test</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "request('/v1/members?limit=50', tokens.member)" apps/api/tests/integration/member-admin.test.ts` prints 0.
    - Unless the hand-off path was taken: in isolation.test.ts the case `n.` block contains `tokens.labAdmin` and `FORBIDDEN`, and `grep -c "tokens.demoAdmin" apps/api/tests/integration/isolation.test.ts` is at least one higher than before the edit (it was already used by other cases).
    - `pnpm --filter @rede-social/api test` passes (isolation-inventory unit check still finds case `n`). A typecheck or lint error naming only files outside this plan (for example packages/modules/courses/**) is the other executor's in-progress work: record it in the SUMMARY, do not fix it.
    - Each commit's `git show --stat --format= HEAD` lists only its own file; no Co-Authored-By line.
  </acceptance_criteria>
  <done>No integration suite reads the directory as a member expecting 200; the cross-identity case proves the role is per host; the isolation edit is either committed alone with only its own hunks or handed off verbatim in the SUMMARY.</done>
</task>

<task type="auto">
  <name>Task 3: Record item 7 as done in pendencias-backend and correct the stale web notes</name>
  <files>docs/pendencias-backend.md, apps/web/lib/member-directory.ts, apps/web/app/(app)/membros/page.tsx, apps/web/app/(app)/membros/actions.ts</files>
  <read_first>
    - docs/pendencias-backend.md (lines 1-5 and 53-58)
    - apps/web/lib/member-directory.ts
    - apps/web/app/(app)/membros/page.tsx (lines 25-45 only)
    - apps/web/app/(app)/membros/actions.ts (lines 10-25 only)
  </read_first>
  <action>
    docs/pendencias-backend.md (pt-BR, same style as the document: bold label bullets, backticked routes and roles, no em dashes). Keep item 7 and its number (code comments cite items 8, 9 and 10 by number, so nothing is removed or renumbered):
    - header line: change the date in "Atualizado em 2026-10-15." to 2026-10-16;
    - heading: `### 7. Lista de membros só para a equipe (feito em 16/10)`;
    - keep the **O que mudou:** bullet as is;
    - replace the **Back:** bullet with a `**Back (feito em 16/10):**` bullet saying, in the document's voice: `GET /v1/members` (com e sem a busca `?q=`, e também com `cursor` ou `limit`) exige papel de equipe (`admin_tenant` ou `support_tenant`) e responde 403 `FORBIDDEN` para `member` antes de ler qualquer membro; o papel é o da participação da sessão no domínio aberto, então quem é admin num tenant e membro em outro lista no primeiro e recebe 403 no segundo; o `GET /v1/members/{id}` continua aberto para membros (perfil pelo nome no post e o @ do autor); o `super_admin` não tem participação e continua recebendo 403 `NO_MEMBERSHIP`;
    - replace the **Por quê:** bullet with one saying the restriction no longer lives only in the screens: the API itself now refuses the list to anyone outside the staff, matching the /membros page and the "Carregar mais".

    Web comments only (no code, no behaviour change, these files are not touched by phase 08.6):
    - apps/web/lib/member-directory.ts: rewrite the last paragraph of the `canBrowseMemberDirectory` docblock (the one saying this is front only and the API still answers a member) to say the API enforces the same rule since 2026-10-16 (quick 261016-jsq: `GET /v1/members` answers 403 `FORBIDDEN` to a `member`), so the screens and the data agree; keep the role-based rationale paragraph.
    - apps/web/app/(app)/membros/page.tsx: in the page docblock, replace the sentence that calls the API restriction a pending backend item with one saying `GET /v1/members` also refuses a member (403 `FORBIDDEN`), and the load-more action refuses them too.
    - apps/web/app/(app)/membros/actions.ts: replace the sentence about the API still listing the members to anyone with one saying the API refuses a member as well (403 `FORBIDDEN`), so this check is the friendly early answer, not the only gate.

    Commit (explicit paths, no trailer): `git commit -m "docs(quick-261016-jsq): pendencias-backend item 7 done; web notes say the API refuses a member" -- docs/pendencias-backend.md apps/web/lib/member-directory.ts "apps/web/app/(app)/membros/page.tsx" "apps/web/app/(app)/membros/actions.ts"`.
  </action>
  <verify>
    <automated>pnpm exec biome check apps/web/lib/member-directory.ts "apps/web/app/(app)/membros/page.tsx" "apps/web/app/(app)/membros/actions.ts" &amp;&amp; grep -q "Atualizado em 2026-10-16" docs/pendencias-backend.md &amp;&amp; grep -q "403 \`FORBIDDEN\`" docs/pendencias-backend.md &amp;&amp; grep -qE '^### 8\. ' docs/pendencias-backend.md &amp;&amp; grep -qE '^### 9\. ' docs/pendencias-backend.md &amp;&amp; grep -qE '^### 10\. ' docs/pendencias-backend.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nF "### 7. Lista de membros só para a equipe (feito em 16/10)" docs/pendencias-backend.md` shows at least 1 line, and items 8, 9 and 10 keep their numbers.
    - `grep -c "pendency" apps/web/lib/member-directory.ts "apps/web/app/(app)/membros/page.tsx" "apps/web/app/(app)/membros/actions.ts"` prints 0 for each file, and `grep -c "FORBIDDEN"` prints at least 1 for each of the three.
    - `git show --format= <this task's commit sha> -- apps/web` (the sha printed by the commit, never a relative `HEAD~N` anchor: the other executor commits in between) shows comment lines only (every changed line starts with ` *` or `/**` or ` */` after the +/- marker).
    - `git show --stat --format= HEAD` lists exactly the four files; no Co-Authored-By line.
  </acceptance_criteria>
  <done>The pendências doc records item 7 as done on the API side without renumbering, and no web comment still claims the API lists members to a member.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser/BFF → API `/v1/members` | an authenticated tenant session (any role) crosses here; the role must come from the membership row, not from the client |
| API → Postgres (`member_profiles` via `withTenantTx`) | tenant-lane read under RLS; unchanged by this plan |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-jsq-01 | Information disclosure | GET /v1/members (list, `?q=`) | medium | mitigate | `requireRole('admin_tenant', 'support_tenant')` as route middleware on `listRoute` (Task 1); proven DB-free (unit cases 1-2) and on the live stack (members.test.ts cases 28-31) |
| T-jsq-02 | Elevation of privilege | role used by the guard | medium | mitigate | `requireRole` reads `ctx.role`, which requireAuth sets from the membership row of the host's tenant on this request (ROLE-06, T-06-03), never a JWT claim; isolation D-309 case asserts the same identity is admin on lab (200) and member on demo (403) (Task 2) |
| T-jsq-03 | Information disclosure | query validation before the guard | low | mitigate | zod-openapi runs route middleware before validators; unit case 1 asserts a member's `?limit=0` is 403, not 400 `VALIDATION_FAILED` |
| T-jsq-04 | Information disclosure | 403 response body | low | mitigate | `ApiError(403, 'FORBIDDEN')` envelope carries no details; members.test.ts case 28 asserts no seeded member name appears in the refusal |
| T-jsq-05 | Denial of service (feature loss) | GET /v1/members/{membershipId} (profile from author name, author @ on posts) | medium | mitigate | `readRoute` gets no middleware; unit case 4 and members.test.ts cases 4, 5, 9, 32 assert a member still gets 200 |
| T-jsq-06 | Spoofing | super_admin / foreign-host sessions | low | accept | unchanged: requireAuth answers NO_MEMBERSHIP / TENANT_HOST_MISMATCH before the role guard; isolation case `p` already covers /v1/members |
| T-jsq-07 | Repudiation | refused list attempts | low | accept | the request logger already records method, path, status and requestId for every 403; no new audit trail is needed for a read refusal |
</threat_model>

<verification>
Run after Task 3 (API-scoped, no database reset, no full integration suite):
- `pnpm --filter @rede-social/api exec vitest run tests/unit/members-directory-staff-only.test.ts`
- `pnpm --filter @rede-social/api test` (whole API unit suite, includes the isolation-inventory title check)
- `pnpm --filter @rede-social/api typecheck`
- `pnpm --filter @rede-social/api lint`
- `pnpm exec biome check apps/web/lib/member-directory.ts "apps/web/app/(app)/membros/page.tsx" "apps/web/app/(app)/membros/actions.ts"`
- `pnpm --filter @rede-social/api exec vitest run tests/integration/members.test.ts` (the one integration file allowed)
- `git log --format='%h %s' -5` shows only this plan's commits on top of whatever the other executor committed meanwhile; `git log -1 --format='%(trailers:key=Co-Authored-By)' <sha>` prints nothing for each of this plan's commit shas; `git status --short` still shows the unrelated changes (`packages/modules/courses/db/schema.ts`, `supabase/migrations/meta/_journal.json`, …) exactly as they were, unstaged by this plan.
A typecheck or lint finding that names only files outside this plan is the other executor's in-progress work: record it, do not fix it.
</verification>

<success_criteria>
- A `member` cannot read the tenant's member list from the API (403 `FORBIDDEN`, any query), staff can, and every member can still open a profile by id.
- The OpenAPI document and the route docblock state the rule; the pendências doc records it; no web comment contradicts it.
- members.test.ts and the API unit suite are green; member-admin and isolation edits are committed (or the isolation edit is handed off verbatim) with the orchestrator's targeted run commands in the SUMMARY.
- No migration, no web behaviour change, no 08.6 file or unrelated change in any commit, no Co-Authored-By trailer.
- SUMMARY notes for the user: REQUIREMENTS.md PROF-03 still reads "Member can browse a searchable list of the tenant's members"; after this change it describes staff only. It is NOT edited here (REQUIREMENTS edits make phase verification stale and phase 08.6 is executing); flag it for the user to reword once 08.6 closes.
</success_criteria>

<output>
Create `.planning/quick/261016-jsq-close-pendencias-backend-item-7-get-v1-m/261016-jsq-SUMMARY.md` when done (do not touch `.planning/STATE.md`; the orchestrator owns tracking). Include: the red evidence counts from Task 1 Step A, the commits (hash + paths), the isolation.test.ts outcome (committed or hand-off text), the two targeted integration commands for the orchestrator, any out-of-scope typecheck/lint findings, and the PROF-03 wording flag.
</output>
