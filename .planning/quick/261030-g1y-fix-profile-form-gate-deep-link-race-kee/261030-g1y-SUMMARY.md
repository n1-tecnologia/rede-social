---
phase: quick-261030-g1y
plan: 01
subsystem: web / profile-form gate
tags: [profile-form, gate, deep-link, redirect, e2e, quick]
requirements: [PFORM-12, PFORM-15]
status: complete
plan_head_before: 24b3a106
commits: 2
key-files:
  modified:
    - apps/web/lib/bootstrap.ts
    - apps/web/lib/safe-next-path.ts
    - apps/web/e2e/profile-form-admin.spec.ts
  created:
    - apps/web/lib/bootstrap.destination.test.ts
decisions:
  - "Request-scoped slot (React cache) filled first by requireBootstrap and read by bootstrapRedirectPath for PROFILE_FORM_PENDING, instead of touching ~60 loader call sites or serialising every page's Promise.all."
actuals:
  tasks: 3
  commits: 2
---

# Quick 261030-g1y: deep link survives the profile-form gate Summary

A gated member who opens `/post/{id}` now reaches `/completar-perfil` with `next=/post/{id}` whichever refusal wins the page's `Promise.all`, through one request-scoped slot in `bootstrap.ts` and with no page edited.

## What changed

**Task 1, commit 87f701d9 (`fix(quick-261030-g1y)`).**
- `apps/web/lib/bootstrap.ts`: `renderDestination` is a slot created with React `cache` (one object per request render, never a module-level variable). `readRenderDestination` is its only writer: it awaits `headers()`, validates `x-rede-path` through `safeNextPath` and stores the result. `requireBootstrap` starts it as its first statement, before awaiting the bootstrap. `bootstrapRedirectPath` appends `&next=<encoded>` for `PROFILE_FORM_PENDING` only when the slot is filled. The guard's own two redirect strings are byte-identical to before. Two doc comments were rewritten to say this.
- `apps/web/lib/safe-next-path.ts`: comment only.
- `apps/web/lib/bootstrap.destination.test.ts` (new, 11 tests): runs the real `requireBootstrap` against the real `loadPost` with the bootstrap held open. Cases: loader wins (`/completar-perfil?t=Rede%20Demo&next=%2Fpost%2Fabc`) and then the guard (`/completar-perfil?next=%2Fpost%2Fabc`) with the same decoded next; `Promise.allSettled` shape; seven hostile or useless values (`//evil.com`, `/\evil.com`, `https://evil.com`, `/%2F%2Fevil.com`, `/completar-perfil`, `/entrar`, empty) yield no `next`; no guard in the request keeps the bare path; source pin (`renderDestination = cache(`, no top-level `let`). `react`'s `cache` is mocked with a memoising stand-in, one fresh module graph per test.
- Red evidence: before the change 3 of 11 failed (loader path without `next`, the allSettled case, the source pin); after it, all pass.

**Task 2, commit b2f924b7 (`test(quick-261030-g1y)`).** `.first()` on the replace-button click in `profile-form-admin.spec.ts` with a two-line comment; biome wrapped the chain over four lines, so the plan's single-line grep pattern does not match literally, the diff is otherwise exactly as planned. The commit touches only that file.

## Verification

- `vitest run` on bootstrap.destination, bootstrap, feed, safe-next-path, `(auth)/completar-perfil`, counters route and LiveShell.form: 8 files, 146 tests pass. Also the four other tests that import the real `./bootstrap` through `importOriginal` (membros/[membershipId], configuracoes, formulario-de-perfil, completar-perfil page): 50 pass. No test needed a mock change.
- `tsc --noEmit --incremental false` in apps/web: clean. `biome check` on the four touched files: clean.
- Commit messages carry no trailer and no mention of Claude or Anthropic (grep printed `clean` after each commit); author igor.vboas.

## Task 3: Playwright re-run (`profile-form-gate.spec.ts`, `profile-form-admin.spec.ts`, mobile-chromium)

Precondition met (container up, 15 GiB free). Result: 10 passed, 1 failed, 2 did not run (49 s).

| Spec | Result |
| --- | --- |
| gate 1 deep link meets the form, answer lands on the same post (tracer) | pass (the assertion that failed with `next` null) |
| gate 2 hostile next / complete member | pass |
| gate 3 staff never taken to the form | pass |
| gate 4 "Sair" signs out | pass |
| gate 5 direct navigation goes back to the form | pass |
| gate 6 archive last required / module off (D-589) | pass |
| admin 1 builder, 2 reorder | pass |
| admin 3 locked question, replace, archive (the replace click, past the strict-mode violation) | pass |
| admin 4 export CSV | pass |
| admin 5 support user and typed URL | FAIL, unrelated, not fixed |
| admin 6 at 320px / 390px backstop | did not run (serial group stops after the failure of 5) |

Unrelated failure, recorded not fixed: `e2e/profile-form-admin.spec.ts:363` (`expect(response?.status()).toBe(404)`), Expected 404, Received 200, on `page.goto(${hosts.lab}/configuracoes/formulario-de-perfil)` as a support user. The page is not named in this plan and the planned fixes are not involved (the support user is never gated). Likely the not-found page streams with a 200 status in this Next build while the spec assumes a 404 status, but this was not diagnosed. Trace: `apps/web/test-results/profile-form-admin-5-a-sup-b7bfa-RL-meets-the-not-found-page-mobile-chromium/trace.zip`. The 320/390px specs (6) are therefore still unproven in browser by this run. Raw log: `/private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/1323ccd9-6dfd-435c-a404-408a2b873a4d/scratchpad/pw.log`.

Cleanup: no `next dev` was running; `apps/web/.next/dev` and `apps/web/.next/cache` were removed; free space still 15 GiB. No forbidden command was run. `profile-form-member.spec.ts` (failure #4) was not run.

## Deviations from Plan

None to the product code. One note: the plan's Task 2 grep pattern (`...').first()` on one line) cannot match because biome formats the chain over four lines; the formatted form was committed.

## Known Stubs

None.

## Threat Flags

None. T-quick-01..04 are mitigated as planned (the slot is written only from `safeNextPath`; request-scoped through `cache`; only `requireBootstrap` writes it; excluded paths never stored).

## Self-Check: PASSED

- apps/web/lib/bootstrap.destination.test.ts: found; commits 87f701d9 and b2f924b7: found in `git log`.
