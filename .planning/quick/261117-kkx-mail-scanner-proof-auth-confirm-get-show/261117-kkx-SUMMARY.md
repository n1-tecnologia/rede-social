---
phase: quick-261117-kkx
plan: 01
subsystem: auth
tags: [bugfix, auth, mail-scanner, safelinks, auth-confirm, quick]
status: complete
commits: 3
plan_head_before: 68bd4ee255eb8fc6e8428d46217d7b1fc5567c64
key-files:
  created:
    - apps/web/lib/auth-confirm.ts
    - apps/web/lib/auth-confirm.test.ts
    - apps/web/app/(auth)/auth/continuar/page.tsx
    - apps/web/app/(auth)/auth/continuar/ConfirmForm.tsx
    - apps/web/app/(auth)/auth/continuar/page.test.tsx
    - apps/web/messages/pt-BR/confirmLink.json
  modified:
    - apps/web/app/auth/confirm/route.ts
    - apps/web/app/auth/confirm/route.test.ts
    - apps/web/lib/link-return.ts
    - apps/web/lib/link-return.test.ts
    - apps/web/components/pwa/InstallGate.test.tsx
    - apps/web/lib/route-handlers.inventory.ts
    - apps/web/e2e/mail.ts
    - apps/web/e2e/recovery.spec.ts
    - apps/web/e2e/signup.spec.ts
    - apps/web/e2e/invite.spec.ts
    - docs/deploy/auth-mail.md
---

# Quick 261117-kkx: mail-scanner-proof /auth/confirm

A GET on `/auth/confirm` no longer consumes the one-time token. It redirects to a new interstitial `/auth/continuar` (tenant shell, one button, native form POST); only the POST to `/auth/confirm` calls `verifyOtp`, writes `link_return` and answers 303. Microsoft SafeLinks (and other scanners) that GET the mail link now only see the interstitial.

## Commits

| Task | SHA | Message |
|------|-----|---------|
| 1 (tracer) | ba37f69b | fix(auth): a GET on /auth/confirm no longer consumes the mail token; an interstitial POSTs it (SafeLinks) |
| 2 | d95e421d | fix(auth): the install gate lets a phone reach the /auth/continuar interstitial |
| 3 | 1f2c0465 | test(auth): follow mail links through the /auth/continuar button; scanner regression cases |

Each commit was path-scoped; `git show --stat HEAD` listed only the intended files each time. No Claude trailer. Nothing under `.planning/` committed (the orchestrator commits PLAN/SUMMARY/STATE).

## What changed

- `lib/auth-confirm.ts` (new, pure): `sameOriginPath`, `sanitizeNext`, `isOtpType`/`OTP_TYPES`, `isAcceptInvitePath`, `failureDestination`, `continueHref`, `isCrossSiteSubmission`, `CONFIRM_POST_PATH`, `CONFIRM_CONTINUE_PATH`. Moved out of `route.ts` (a Next route file may only export HTTP methods).
- `app/auth/confirm/route.ts`: GET is inert (redirect to the interstitial or to the old fallbacks, no Supabase, no cookie); POST re-applies the OTP allow-list and the open-redirect guard to the form fields, refuses cross-site POSTs with 403, is the only `verifyOtp` caller, keeps the allow-list branch, the invite/signup/default fallbacks and the `link_return` cookie, and answers 303 with a relative `Location` and `Cache-Control: no-store`.
- `app/(auth)/auth/continuar/{page,ConfirmForm}.tsx` + `messages/pt-BR/confirmLink.json`: server page (copy by link kind via `linkReturnFor`, `referrer: same-origin`, noindex) and a native `<form method=post action=/auth/confirm>` with three hidden fields and a ref-guarded double-submit block.
- `lib/link-return.ts`: `linkReturnScreen` answers `pass` for `/auth/continuar` and below, marker or not (first rule). No other marker rule touched.
- `lib/route-handlers.inventory.ts`: exempt reason for `auth/confirm/route.ts` now describes both methods.
- e2e: `followMailLink(page, link)` in `e2e/mail.ts`; recovery, signup and invite specs use it; scanner-first GET cases in recovery case 3 and signup case 1; new recovery case 4b (no token, no button).
- `docs/deploy/auth-mail.md`: one paragraph on the interstitial.

Untouched by construction (confirmed by an empty `git diff --stat 68bd4ee2..HEAD -- packages apps/api apps/web/proxy.ts apps/web/lib/auth-link-forward.ts`): packages, apps/api, proxy.ts (its public list already holds `/^\/auth\//`), auth-link-forward.ts.

## TDD evidence (real output)

Task 1 RED, before any implementation (`vitest run lib/auth-confirm.test.ts app/auth/confirm/route.test.ts "app/(auth)/auth/continuar/page.test.tsx"`):

```
 FAIL  lib/auth-confirm.test.ts  Error: Cannot find module './auth-confirm' imported from .../lib/auth-confirm.test.ts
 FAIL  app/(auth)/auth/continuar/page.test.tsx  Error: Failed to resolve import "./page" from "app/(auth)/auth/continuar/page.test.tsx". Does the file exist?
 FAIL  app/auth/confirm/route.test.ts > ... TypeError: POST is not a function   (and the two GET-inert cases: "Cannot destructure property 'error' ... undefined", i.e. the old GET still called verifyOtp)
 Test Files  3 failed (3)
      Tests  23 failed | 1 passed (24)
```

Task 1 GREEN after implementation: `Test Files 4 passed (4), Tests 1640 passed (1640)` (the named files plus `i18n/messages.test.ts`).

Task 2 RED (`link-return.test.ts components/pwa/InstallGate.test.tsx route-handlers.inventory.test.ts install-gate.test.ts`): `Test Files 2 failed | 2 passed (4), Tests 3 failed | 56 passed (59)` (8b, 8c, and InstallGate case 10: `expected null to be 'pass'`, `expected 'show' to be 'pass'`). GREEN after the change: `Test Files 4 passed (4), Tests 59 passed (59)`.

Vitest does not emit TAP, so `gsd_run check tdd-red-evidence` was not run; the lines above are the real Vitest output, nothing fabricated.

## Commands run and results

- Per task: named vitest files (green, as above); `pnpm --filter @rede-social/web typecheck` (green after one fix, see deviations); `bash scripts/check-ui-literals.sh` OK; `pnpm boundaries` (turbo boundaries, 2588 files, no issues; run after tasks 1 and 2, and not re-run after task 3 whose files are e2e and a doc); `pnpm exec biome check` on the touched files (clean; `--write` used only for formatting on touched files).
- End: the plan's eight vitest files (`auth-confirm`, `link-return`, `route`, `page` of continuar, `InstallGate`, `route-handlers.inventory`, `auth-link-forward`, `i18n/messages`): 8 files, 1689 tests, all passed. The whole web suite (`pnpm --filter @rede-social/web exec vitest run`): `Test Files 409 passed (409), Tests 9811 passed (9811)`, no flake, no reruns needed (load was 2.5 to 4.6, under the 7 limit). `pnpm guard:lanes`: OK.
- Final typecheck after task 3 (covers the e2e files via tsconfig): green.

## NOT run

- The Playwright e2e edits (`mail.ts`, `recovery.spec.ts`, `signup.spec.ts`, `invite.spec.ts`) were NOT run: they need the local Supabase stack. They were checked by reading, `tsc` and biome only. The scanner-first cases and the no-token case are therefore unproven in a browser.
- `pnpm check:static-routes` was NOT run (needs a production build). The page reads `searchParams`, so it stays dynamic by construction. No `next build` was run, so there was no `.next/cache` or `.next/dev` to clean.
- Not run by design: `db:reset`, integration suites, `next dev`, push, deploy.
- The cookie merge of a returned `NextResponse` (the `link_return` cookie written through `cookies()` in the POST) is covered at unit level only by asserting the `cookies().set` call. The plan's claim that Next merges these into a returned Response was checked by finding `appendMutableCookies` in `next/dist/server/route-modules/app-route/module.js`, not by a live request.

## Deviations from Plan

1. **[Rule 1 - typing] Test header objects.** Two `route.test.ts` loops built header arrays of mixed shapes that failed `tsc` against `Record<string, string>`. Annotated the arrays as `Record<string, string>[]`. Test-only, same task, no behaviour change. Found by the typecheck gate.
2. **`isOtpType` widened.** Its parameter is `string | null | undefined` (the plan said `string | null`) so the interstitial page can pass an optional query value without a cast. Behaviour for strings and null is identical.
3. **Extra pins beyond the plan, in `link-return.test.ts`:** cases 8, 8b and 8c cover the plan's behaviour list (`/auth/confirm` and `/auth/continuar-x` not exempt, `/auth/continuar/x` exempt, stale marker still passes). No semantic deviation, just numbering (8b/8c) to keep the file's existing numbering.
4. **Recovery case numbering:** the new no-token case is `4b` (the file's cases 5 and 7 sit before 6/8 in source order), to avoid renumbering neighbours.
5. **`auth-confirm.ts` exports `DEFAULT_NEXT` and `OTP_TYPES`** (the plan listed them as moved, not as exported); they are exported, harmlessly, so tests and later callers can use them.
6. **Doc paragraph** was placed after the sentence at step 3 of the signup list and states that it holds for recovery and invite links too.

No other deviations. No auth gates. No stubs introduced. No threat flags beyond the plan's register (the new POST surface is the planned T-kkx-01..08 surface).

## Residual notes for the developer

- The working tree still holds other people's edits and untracked files (`.planning/phases/12.5-.../12.5-CONTEXT.md` modified, `.claude/*`, `.planning/**`); none were staged or reverted.
- Manual check after deploy (plan's verification section): open a real recovery mail link on a Hotmail/Outlook address, see the interstitial, press the button, land on the password form.
- Nothing pushed, nothing deployed. Until the three commits ship together, do not ship Task 1 alone: a phone behind `INSTALL_GATE=on` could not reach the button without the Task 2 exemption.

## Self-Check: PASSED

- Created files exist (auth-confirm.ts and test, continuar/page.tsx, ConfirmForm.tsx, page.test.tsx, confirmLink.json): confirmed by the green vitest run importing them.
- Commits ba37f69b, d95e421d, 1f2c0465 exist on master; `git rev-list --count 68bd4ee2..HEAD` = 3 (measured), matches `commits: 3`.
