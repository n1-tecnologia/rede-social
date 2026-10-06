# Phase 08.1 — Deferred Items

Out-of-scope discoveries logged by executors (not fixed in the plan that found them).

## Deferred Items

- `apps/web/e2e/blocked.spec.ts` "AUTH-06/D-09 — blocked on the next request" aborts intermittently at step 3
  status: open
  **Found by:** 08.1-01 Task 3 (running its verify command).
  **What:** `page.goto('/inicio')` right after `setMembershipStatus(email, 'blocked')` sometimes fails with `net::ERR_ABORTED`: the Início page still open from step 1 fires the media playback-token server action, which receives the 403 `MEMBERSHIP_BLOCKED`, throws `NEXT_REDIRECT` (`media.playback_token_failed { error: 'Error: NEXT_REDIRECT' }` in the web log) and navigates the page to the blocked flow at the same moment the test navigates. The end state is the one the test asserts; only the test's own `goto` is aborted. Observed on 1 of 2 projects in 2 of 5 runs; the next two full runs of the spec passed 6/6.
  **Why deferred:** the race lives in the playback-token action and this pre-08.1 spec step; 08.1-01 does not change the blocked path on a host where the membership exists (the host-selected membership is the same row `membership_for_user` returned). Fix candidates: tolerate `ERR_ABORTED` on that one `goto` (the next `toHaveURL` still asserts the outcome), or have the playback-token action not redirect from a background fetch.

- `pnpm --filter @rede-social/web typecheck` fails on two test fixtures that predate 08.1-02
  status: resolved
  **Resolved by:** 08.1-05 (`22df2ed`): both fixtures set `look: emptyBrandLook()`; the web typecheck exits 0; WINDOWS #74 marked fixed.
  **Found by:** 08.1-02 Task 1 (running its verify command).
  **What:** `components/admin/DisplayNameCard.test.tsx:55` and `components/platform/BrandingForm.test.tsx:84` build a `BrandingView` without the `look` field, which became required in the FRONT-PENDENCIAS merge (`b357507`, "tenant look"). `tsc` reports TS2741 / TS2322 there and nowhere else; vitest still runs both files green (1907 tests).
  **Why deferred:** neither file nor `BrandingView` is touched by 08.1-02; the fix (add a `look` fixture, or make the test helpers build one) belongs to whoever owns the tenant-look work. Every file 08.1-02 changed typechecks.

- `/participar`'s `join` action leaves the session alive when the join answers `MEMBERSHIP_BLOCKED`
  status: resolved
  **Resolved by:** 08.1-03 (`0f7e02c`): `join` signs out locally before the `/auth/blocked` and `/auth/suspended` redirects (and `TENANT_SUSPENDED` now goes to `/auth/suspended` instead of `?erro=falha`); `participar/actions.test.ts` and the e2e "WINDOWS #75" case prove the rede-lab session is gone while rede-demo's survives; WINDOWS #75 marked fixed.
  **Found by:** 08.1-02 Task 2 ("blocked in B" e2e on the sign-up join).
  **What:** a server action that `redirect()`s to the `/auth/blocked` (or `/auth/suspended`) route handler reaches it through the router's RSC fetch: the handler renders `/acesso-suspenso` but its `signOut({ scope: 'local' })` cookie clear does not reach the browser, and the address bar keeps `/auth/blocked?t=…`. 08.1-02's `joinFromSignup` now signs out inside the action before that redirect. `apps/web/app/(auth)/participar/actions.ts` `join` still relies on the handler for both refusals, so a person blocked in B who reaches `/participar` (only possible if the block lands between `GET /v1/join/state` and the POST) keeps a B-origin session that `requireAuth` then refuses on every request.
  **Why deferred:** the file belongs to 08.1-01 and is not in 08.1-02's list. Fix: set the same local sign-out in `join` for `MEMBERSHIP_BLOCKED` and `TENANT_SUSPENDED` (a natural fit for the 08.1 code-review pass or 08.1-03).

- `apps/web/e2e/platform-tenants.spec.ts` test 8 (WR-03) fails intermittently on mobile-chromium at `continueFromData`
  status: open
  **Found by:** 08.1-04 Task 2 (running its e2e verify command).
  **What:** the test fills `#displayName`, `#slug` and `#adminEmail` right after `page.goto('/plataforma/novo')` without waiting for `form[data-draft-ready]` (the guard `fillTenantData` in `e2e/wizard.ts` has). When the session draft is read back after hydration it resets the name field, so "Continuar" is refused with "Informe o nome de exibição." and the URL never reaches `/plataforma/novo/marca`. Observed once on mobile-chromium; the re-run of the whole spec passed 15/15 (1 skipped).
  **Why deferred:** a pre-existing race in a Phase 2 spec, unrelated to names or memberships; 08.1-04 changes neither the wizard nor that spec. Fix: `await expect(page.locator('form[data-draft-ready]')).toBeVisible()` before the three `fill` calls (or call `fillTenantData`).
