---
phase: quick-261023-ssq
plan: 01
subsystem: ci-e2e
tags: [ci, e2e, pwa, supabase-origin, build-time-flag, deploy-guard, quick]
requirements: [DBT-39]
status: complete
commits: 3
plan_head_before: 80fd6d8df612cc8dc0a2e02771a5eb7433f2c1c0
actuals:
  tokens: 30000
  tasks: 3
  commits: 3
key-files:
  modified:
    - apps/web/lib/supabase-origin.ts
    - apps/web/playwright.pwa.config.ts
    - scripts/check-workflows.sh
    - docs/DEPLOY.md
  created:
    - apps/web/lib/supabase-origin.test.ts
    - apps/web/lib/e2e-loopback-flag.test.ts
---

# Quick 261023-ssq: loopback Supabase origins behind an e2e-only build flag

A build-time flag, `NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS`, lets the production-build PWA e2e upload to the local http Supabase stack. Real deploys are unchanged.

**The e2e itself was NOT run locally.** Disk was at 98 percent, so no web build, `next build`, Playwright, integration suite or db reset was run. Unit tests and guards pass locally. The proof that `csp.spec.ts:215` now passes in the iPhone 14, Pixel 7 and desktop projects is the next CI run of the `e2e-pwa` job. If `csp.spec.ts` fails later than line 274, that is a different defect and not part of this plan.

## What changed

- `isAllowedSupabaseOrigin` takes an optional `allowLoopback`. It defaults to the direct read `process.env.NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS === '1'`, so Next inlines it at build time. When it is on in a production build, the same loopback hosts a non-production build admits are accepted (`http(s)://127.0.0.1` and `localhost`, with or without a port). Every structural check (userinfo, path, query, fragment, bare `?` or `#`, parse failure, look-alike hosts) still runs first. The hosted rule is untouched.
- `apps/web/playwright.pwa.config.ts` sets the flag to `'1'` in the `env` of the one `next build && next start` webServer entry. Nothing else carries it: not the base config, not `ci.yml`, not the API entry.
- `scripts/check-workflows.sh` has a new `e2e-flag` scan. It fails on any mention in `deploy-api.yml`, `deploy-hml.yml` or a `vercel.json`/`vercel.ts`. It also fails on an assignment form in a `.env.example` or `docs/DEPLOY.md`, and on a table row in `docs/DEPLOY.md` whose first cell is the flag. A prose mention passes. The self-test adds six offence cases (each must fail with an `e2e-flag:` message) and one prose case that must pass.
- `docs/DEPLOY.md` has an "E2E-only build flag" paragraph under "Vercel environment variables (web)". It says the flag is never set on Vercel (production or `homolog`) and not in any deploy workflow or env template.

## Tests

- `lib/supabase-origin.test.ts` covers the flag-off, flag-on and unchanged-hosted-rule matrix. A differential corpus shows that non-loopback answers are identical with the flag on and off, for production true and false. It also covers the default env read: only the exact string `'1'` enables the flag. `'0'`, `'true'`, `'yes'`, `' 1'`, `'1 '`, empty and unset do not.
- `lib/e2e-loopback-flag.test.ts` has three parts:
  - the exact `tusEndpointFor` call that failed in CI, which now returns the loopback TUS endpoint with production and the flag, and still throws without the flag;
  - the PWA config proof, with a self-check that the regex rejects a copy where the env sits on another object;
  - the deploy-surface proof, which reuses the guard's two regexes.
- Red was observed first: with the tests written and the implementation absent, 4 flag-on tests failed (2 in each file). They went green after the predicate and config change.

## Verification run

- vitest on `supabase-origin`, `e2e-loopback-flag`, `supabase-coordinates`, `upload` and `no-build-time-supabase`: 5 files, 54 tests passed. The existing `supabase-coordinates`, `upload` and `no-build-time-supabase` tests were not modified.
- `biome check` on the four web files: clean.
- `pnpm guard:workflows`: ok, including the new self-test line and the release-env self-test.
- `pnpm guard:lanes`: ok. `pnpm boundaries`: no issues.
- The optional whole-app `tsc --noEmit` was skipped (disk pressure).

## Deviations from Plan

**1. [Rule 1 - Bug] Config-matching regex failed on `${PORT}` braces.**
- Found during Task 1: the first draft of the "PWA config carries the flag" regex excluded `{` and `}` between the `command` and `env` properties, but the `url` template literal holds `${PORT}`.
- Fix: the pattern now treats template literals as opaque bodies. Test file only.
- Commit: 759e9845.

Otherwise the plan was executed as written.

## Commits (code only; this SUMMARY and the PLAN are left for the orchestrator's docs commit)

- 759e9845 fix(quick-261023-ssq): admit loopback Supabase origins in a production build behind the e2e-only flag
- 0cf0e791 test(quick-261023-ssq): fail the workflow guard when the e2e loopback flag reaches a deploy surface
- a63340db docs(quick-261023-ssq): state that the e2e loopback flag is never set on Vercel and prove no deploy surface carries it

None carries a trailer. Nothing was pushed.

## Known Stubs

None.

## Threat Flags

None. The flag is the plan's threat T-quick-ssq-01 to 05 surface, mitigated by the guard, the unit scan and the docs.

## Self-Check: PASSED

Six files exist, three commits exist, `git rev-list --count 80fd6d8d..HEAD` is 3, and no commit message has a Co-Authored-By line.
