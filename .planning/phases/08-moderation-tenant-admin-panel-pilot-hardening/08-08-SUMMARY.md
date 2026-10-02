---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 08
subsystem: security
tags: [security, csp, nonce, cors, embeds, youtube, vimeo, zod, review-items, nextjs, proxy, D-346]
status: complete
requires:
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-06 Marca and 08-07 Regras: the admin screens the enforced-CSP walk visits; 08-04/08-05 Membros and 08-01/08-03 Moderação"
  - phase: 04-feed
    provides: "LinkPreviewCard, the resolved oEmbed previews (provider + URL) and the strict linkPreviewSchema"
  - phase: 02-tenant-shell-branding-platform-panel
    provides: "proxy.ts host routing and session refresh; the 02-REVIEW IN-01..IN-08 items"
provides:
  - "apps/web/lib/csp.ts: cspFor(nonce, { https, mode, reportUri }), cspHeaderName(mode), newNonce(), CSP_REPORT_PATH, NONCE_HEADER"
  - "proxy.ts: the per-request policy and x-nonce on the forwarded request headers and on every returned response (refresh rebuild, /cadastro rewrite, 307/308 redirects, /serwist/sw.js)"
  - "POST /api/csp-report: the 16 KB, bounded, never-reflecting violation sink (public in proxy.ts)"
  - "CSP_MODE (report-only | enforce, default report-only) in env.ts, .env.example, turbo.json; the Playwright harness runs enforce"
  - "apps/web/instrumentation-client.ts: Zod jitless in the browser (no eval probe)"
  - "e2e: csp-collector.ts (collectCspViolations), csp.spec.ts (tracer, collector liveness, refreshed session, three walks); csp.spec also runs in e2e:pwa on the production build"
  - "feed: embedUrlFor(provider, url) (server/embed-url.ts), optional embedUrl on linkPreviewSchema, LinkPreviewCard click-to-play, feed.linkPreview.play/.playUntitled/.frameTitle"
  - "apps/api/tests/unit/cors.test.ts: no Access-Control-Allow-* on any preflight or GET"
  - "docs/DEPLOY.md 'Content Security Policy (Phase 8)' with the CSP_MODE Vercel row, report-only then enforce, rollback, the CORS rule"
  - "02-REVIEW.md 'Resolution (Phase 8, 08-08)': IN-03..IN-07 fixed, IN-01/IN-02 superseded by 08.1-06, IN-08 unchanged"
affects: [08-10, 08-12, 08.1]
actuals:
  tokens: 24061   # chars/4 over the added lines of this plan's five code/doc commits (96,247 chars)
  tasks: 3
  commits: 7      # MEASURED: git rev-list --count d968f00..HEAD at SUMMARY time; 5 are this plan's, 2 (06cae49, 6034f67) are the concurrent quick-task session's
plan_head_before: d968f00922a8159331bb0e96d445e978e815b870
tech-stack:
  added: []
  patterns:
    - "One Csp value per request threaded through every proxy helper that builds request headers or a response, so no branch can return without the policy"
    - "A CSP violation collector bound through page.exposeFunction + addInitScript, so violations survive navigations, with a liveness case that splices a nonce-less script into the real served HTML"
    - "Third-party frame navigations answered by page.route stubs, so an e2e proves frame-src without any request leaving the machine"
    - "Production-only policy checks run in the production-build Playwright config, because next dev needs 'unsafe-eval'"
key-files:
  created:
    - apps/web/lib/csp.ts
    - apps/web/lib/csp.test.ts
    - apps/web/app/api/csp-report/route.ts
    - apps/web/app/api/csp-report/route.test.ts
    - apps/web/e2e/csp-collector.ts
    - apps/web/e2e/csp.spec.ts
    - apps/web/instrumentation-client.ts
    - apps/web/instrumentation-client.test.ts
    - apps/web/app/auth/confirm/route.test.ts
    - apps/web/components/platform/ResendInviteButton.test.ts
    - packages/modules/feed/server/embed-url.ts
    - packages/modules/feed/tests/embed-url.test.ts
    - packages/modules/feed/tests/link-preview-card.test.tsx
    - apps/api/tests/unit/cors.test.ts
  modified:
    - apps/web/proxy.ts
    - apps/web/proxy.test.ts
    - apps/web/lib/env.ts
    - apps/web/.env.example
    - apps/web/playwright.config.ts
    - apps/web/playwright.pwa.config.ts
    - turbo.json
    - apps/web/e2e/admin.ts
    - apps/web/lib/feed-view.tsx
    - apps/web/lib/feed-view.test.ts
    - apps/web/messages/pt-BR/feed.json
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/ui/LinkPreviewCard.tsx
    - docs/DEPLOY.md
    - apps/web/app/auth/confirm/route.ts
    - "apps/web/app/(platform)/plataforma/tenants/[id]/admins/page.tsx"
    - apps/web/components/platform/ResendInviteButton.tsx
    - apps/web/components/platform/LogoUpload.tsx
    - apps/web/components/platform/LogoUpload.test.ts
    - apps/web/lib/tenant-host.test.ts
    - packages/core/server/platform/tenants.ts
    - apps/api/tests/integration/invites.test.ts
    - .planning/phases/02-tenant-shell-branding-platform-panel/02-REVIEW.md
key-decisions:
  - "cspFor reads env.NEXT_PUBLIC_SUPABASE_URL and NODE_ENV per call and takes mode only for the header switch; the Supabase origin and its ws/wss twin come from that one URL, so local, hml and production need no host list"
  - "proxy.ts drops any client-sent content-security-policy / -report-only / x-nonce request header before setting its own, so a client can never choose the nonce Next stamps"
  - "/api/csp-report is a PUBLIC path in proxy.ts: browsers report from the signed-out sign-in page too, and a redirect to /entrar would drop every such report"
  - "Zod runs jitless in the browser (instrumentation-client.ts): Zod 4 probes new Function when it builds an object schema, which is a CSP eval violation on every page in production; the server keeps the JIT"
  - "csp.spec.ts also runs in playwright.pwa.config.ts against next build + next start, because only the production build serves the production policy (dev adds 'unsafe-eval')"
  - "The click-to-play card needs embedUrl AND the host's labels; without either it renders the shipped external card unchanged (an unnamed control is worse than the link)"
  - "embedUrl uses z.url().optional() (the Zod 4 idiom the contract already uses, z.uuid()) rather than the deprecated z.string().url()"
  - "IN-06 follows the review's order: onCompleted, then the success toast, both after the try; a throwing parent callback propagates as itself instead of being reported as a failed upload"
  - "The developer's 2026-10-02 consent covered every pnpm db:reset && pnpm db:seed in this plan (local stack only; backup at ~/rede-social-local-backups/pre-08-reset.sql)"
patterns-established:
  - "Pattern: every e2e spec runs under CSP_MODE=enforce, so a new third-party host must be added to cspFor or a spec fails"
  - "Pattern: a pure helper (resendReasonCopy, embedUrlFor) owns each allow-list, and the component only calls it"
requirements-completed: [ADMIN-01, MOD-05]
coverage:
  - id: D1
    description: "Tracer: with CSP_MODE=enforce every HTML response carries Content-Security-Policy with a fresh nonce that Next stamps on its scripts, on every proxy branch including the session-refresh rebuild, and the signed-out and signed-in pages record zero violations"
    requirement: MOD-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/csp.spec.ts#csp tracer; #csp on a refreshed session; #the collector is live (dev and production build, mobile + desktop)"
        status: pass
      - kind: unit
        ref: "apps/web/proxy.test.ts#12-17 (policy on the next, rewrite, 307/308, platform, refresh and SW branches; forged nonce headers dropped); apps/web/lib/csp.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The policy: nonce + strict-dynamic, no nonce in style-src, Supabase origin and its ws twin, Mux hosts, two-host frame-src, frame-ancestors 'none', object-src 'none', upgrade-insecure-requests only over https, 'unsafe-eval' only under next dev"
    requirement: MOD-05
    verification:
      - kind: unit
        ref: "apps/web/lib/csp.test.ts (7 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Violation sink POST /api/csp-report: both report formats, 16 KB cap (413), 415 for other types, one bounded csp.violation line (directive, blocked host, document path), empty 204, never reflected"
    requirement: MOD-05
    verification:
      - kind: unit
        ref: "apps/web/app/api/csp-report/route.test.ts (4 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The whole app under the enforced policy with zero violations: member surfaces (communities, an event, a story, Suporte over Realtime, Notificações, an avatar upload to Storage, a video post), the four admin screens with the member sheet and the rules preview, the platform panel; on the dev server and on the production build"
    requirement: MOD-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/csp.spec.ts#csp walk (3 cases), dev run and e2e:pwa production run (iPhone, Pixel, desktop)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Service worker: /serwist/sw.js passes through proxy.ts with the policy; the PWA suite stays green on the production build under enforce"
    requirement: MOD-05
    verification:
      - kind: e2e
        ref: "pnpm --filter @rede-social/web e2e:pwa (64 passed, 5 skipped by design, 0 failed, CSP_MODE=enforce)"
        status: pass
      - kind: unit
        ref: "apps/web/proxy.test.ts#17"
        status: pass
    human_judgment: false
  - id: D6
    description: "CORS lock: no Access-Control-Allow-* on a preflight OPTIONS or a simple GET from https://evil.example, on /v1/health and on /v1/members; DEPLOY.md states the rule for a future browser-facing route"
    requirement: MOD-05
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/cors.test.ts (5 cases)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Inline embeds: strict server-side embedUrl (YouTube 11-char id from watch/youtu.be/shorts/embed, Vimeo numeric id, lookalike hosts and javascript: refused); click-to-play stage, sandboxed iframe without top-level navigation after the tap; the shipped card without embedUrl; zero provider requests before the tap; the frame mounts under frame-src behind a local stub"
    requirement: MOD-05
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/embed-url.test.ts; packages/modules/feed/tests/link-preview-card.test.tsx; apps/web/lib/feed-view.test.ts#the inline player labels"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/csp.spec.ts#csp walk — member surfaces ... and the inline players (providerRequests empty before the tap; YouTube and Vimeo frames stubbed)"
        status: pass
    human_judgment: false
  - id: D8
    description: "UI E15/error backstop: tapping play on a real YouTube and Vimeo link plays inline on a real iPhone and Android phone under the enforced CSP with no Error 153 and no violation"
    requirement: MOD-05
    verification: []
    human_judgment: true
    rationale: "Real provider playback and the referrer-policy Error 153 need a real device and the real provider; the e2e stubs the frame. Runs in the 08-12 D-345 real-device pass."
  - id: D9
    description: "Phase 2 review items: IN-03 lapsed recovery-type invite link to /convite-expirado; IN-04 no_verified_primary helper copy; IN-05 newest invite; IN-06 callback after the upload try; IN-07 self-contained cache case; IN-01/IN-02 recorded as superseded by 08.1-06"
    requirement: ADMIN-01
    verification:
      - kind: unit
        ref: "apps/web/app/auth/confirm/route.test.ts; apps/web/components/platform/ResendInviteButton.test.ts; apps/web/components/platform/LogoUpload.test.ts#4; apps/web/lib/tenant-host.test.ts#2 (alone with -t and --sequence.shuffle)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/invites.test.ts#14 (sent invite, lost primary -> 409 no_verified_primary); #15 (oldest-first, newest last); 27/27"
        status: pass
      - kind: e2e
        ref: "invite.spec.ts + platform-tenants.spec.ts (23 passed, 1 skipped, enforce)"
        status: pass
    human_judgment: false
duration: 1h 55m
completed: 2026-10-02
---

# Phase 8 Plan 08: Nonce CSP, CORS lock, inline players and the Phase 2 review items Summary

**Every response now carries a per-request nonce Content Security Policy (switchable report-only/enforce), threaded through every `proxy.ts` branch and proven with zero violations across the whole app on both the dev server and the production build. YouTube and Vimeo now play inline only after a tap, in a sandboxed frame on a two-host `frame-src`. The API is proven to answer no cross-origin caller. Phase 2's IN-03..IN-07 are fixed with tests, and IN-01/IN-02 are recorded as superseded by 08.1-06.**

## Performance

- **Duration:** 1h 55m (about 1h 10m of it was the full 868-case e2e regression run)
- **Started:** 2026-10-02T16:27:21Z
- **Completed:** 2026-10-02T18:22:53Z
- **Tasks:** 3 (plus one verification-driven fix)
- **Files modified:** 38 (14 created, 24 modified)

## Accomplishments

- **The policy (D-346).** `lib/csp.ts` builds the Pattern 10 policy. `proxy.ts` puts it with the nonce on the forwarded request headers and on every response it returns: the initial `next`, the `setAll` refresh rebuild, the `/cadastro` rewrite, the 307/308 redirects, and the service-worker script, whose policy becomes the worker's own. Forged client headers are dropped.
- **Rollout switch and sink.** `CSP_MODE` defaults to `report-only`, so production ships safely. `POST /api/csp-report` logs one bounded `csp.violation` line per report. DEPLOY.md has the report-only, then enforce after 08-12, then rollback steps.
- **Proof, not configuration.** Every e2e spec runs enforced. `csp.spec.ts` walks the member surfaces (including a real avatar PUT to Storage and Realtime chat), the four admin screens and the platform panel. It also runs in `e2e:pwa` against `next build`.
  - A liveness case splices a nonce-less script into the real served HTML and checks that it is blocked and recorded. That way "zero violations" can never pass vacuously.
- **A real production bug found and fixed.** The first production-build walk caught an `eval` violation on every page. Zod 4 probes `new Function` when it builds an object schema. `next dev` hides this because it allows `'unsafe-eval'`. `instrumentation-client.ts` now sets Zod `jitless` in the browser.
- **Inline players (UI-D-282).**
  - `embedUrlFor` derives only `www.youtube-nocookie.com/embed/{id}` or `player.vimeo.com/video/{id}`, using strict ids.
  - `LinkPreviewCard` shows a flat black 16:9 stage with the play disc. A tap swaps in the sandboxed iframe with the exact attributes and no top-level navigation. The text block stays the external link.
  - Before any tap, the feed makes zero requests to YouTube or Vimeo hosts (the D-346 prohibition, now verified by the walk).
- **CORS lock.** `cors.test.ts` checks a preflight and a GET from `https://evil.example` against `/v1/health` and `/v1/members` and finds no `Access-Control-*` header.
- **Phase 2 review closed.** IN-03..IN-07 are fixed, each with a discriminating test. IN-01/IN-02 are superseded by 08.1-06, and IN-08 is unchanged; 02-REVIEW.md records all of it.

## Task Commits

1. **Task 1 (tracer): enforced nonce CSP on every proxy branch, sink, env switch, collector e2e:** `df48fb7` (feat)
2. **Task 2: inline players, CORS proof, the full walk, DEPLOY.md:** `c917833` (feat)
3. **Task 3: IN-03..IN-07 fixed with tests:** `ce29cba` (fix); 02-REVIEW resolution: `da142f5` (docs)
4. **Verification-driven fix: no eval in the production browser bundle; csp.spec in e2e:pwa:** `529cc1e` (fix)

**Concurrent commits in this range (not this plan's):** `06cae49` fix(ci) turbo-ignore fallback (touches `docs/DEPLOY.md`'s Vercel ignore notes, `scripts/vercel-ignore.sh`) and `6034f67` docs(state). Both come from the developer's quick-task session on the same branch. My DEPLOY.md hunks were committed before them, and they don't overlap.

**Plan metadata:** this SUMMARY commit (docs)

## Files Created/Modified

- `apps/web/lib/csp.ts`: the policy builder, header switch and nonce
- `apps/web/proxy.ts`: one `Csp` per request through `buildRequestHeaders`, `withCookies`, `primaryHostRedirect`, the 307 alias redirect and `setAll`; `/api/csp-report` public
- `apps/web/app/api/csp-report/route.ts`: the violation sink
- `apps/web/instrumentation-client.ts`: Zod jitless in the browser
- `apps/web/e2e/csp-collector.ts`, `apps/web/e2e/csp.spec.ts`: the collector and the specs; `apps/web/e2e/admin.ts` gains `createLinkPreviewPostAs`, `deleteLinkPreviewPosts`, `cspWalkFixtureIds`
- `apps/web/playwright.config.ts` (`CSP_MODE ??= 'enforce'`), `apps/web/playwright.pwa.config.ts` (csp.spec on the production build)
- `apps/web/lib/env.ts`, `apps/web/.env.example`, `turbo.json`: `CSP_MODE`
- `packages/modules/feed/server/embed-url.ts`, `contracts/index.ts` (`embedUrl: z.url().optional()`), `server/service.ts` (`toLinkPreview`), `ui/LinkPreviewCard.tsx` (click-to-play)
- `apps/web/lib/feed-view.tsx`, `apps/web/messages/pt-BR/feed.json`: the host labels
- `apps/api/tests/unit/cors.test.ts`: the CORS proof
- `docs/DEPLOY.md`: the "Content Security Policy (Phase 8)" section and the `CSP_MODE` Vercel row
- IN fixes: `app/auth/confirm/route.ts`, `admins/page.tsx`, `ResendInviteButton.tsx`, `LogoUpload.tsx`, `tenant-host.test.ts`, `packages/core/server/platform/tenants.ts` (docblock), `invites.test.ts` (cases 14, 15)

## Decisions Made

See `key-decisions` in the frontmatter. The notable ones:

- `/api/csp-report` must be public in `proxy.ts`. Otherwise every report from a signed-out page would be redirected away.
- Zod runs jitless in the browser only, and only the production build proves the production policy. That is why csp.spec runs in e2e:pwa.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod 4's `new Function` probe was a CSP eval violation on every production page**
- **Found during:** plan-level verification (csp.spec against `next build && next start`)
- **Issue:** 10 of 12 csp cases failed on the production build, each with one `script-src`/`eval` violation per page. The dev run allows `'unsafe-eval'`, so it never showed this. Under report-only it would have filed a report on every page view.
- **Fix:** `apps/web/instrumentation-client.ts` sets `z.config({ jitless: true })` before any client schema is built. This config is shared through `globalThis.__zod_globalConfig`, so it covers both Zod copies (4.6.2 and 4.4.3). It is pinned by `instrumentation-client.test.ts`. `playwright.pwa.config.ts` now also runs `csp.spec.ts`, so the production policy stays proven.
- **Verification:** csp.spec 12/12 on the production build, then `e2e:pwa` gave 64 passed (18 of them csp cases), 5 skipped by design, 0 failed.
- **Committed in:** `529cc1e`

**2. [Rule 2 - Missing critical] `/api/csp-report` added to `proxy.ts` PUBLIC**
- **Found during:** Task 1
- **Issue:** the sink is not a public path, so an unauthenticated browser's report would be 307'd to `/entrar` and lost. `/entrar` itself reports.
- **Fix:** an anchored `^\/api\/csp-report$` entry; `proxy.test.ts#17` asserts it.
- **Committed in:** `df48fb7`

**3. [Rule 2 - Security] Client-sent CSP and `x-nonce` request headers are dropped before the proxy sets its own**
- **Found during:** Task 1
- **Fix:** `buildRequestHeaders` deletes both CSP request headers and overwrites `x-nonce`; `proxy.test.ts#13` asserts that a forged nonce never reaches Next.
- **Committed in:** `df48fb7`

**4. [Rule 3 - Blocking] Host wiring and fixtures the plan's file list did not name**
- `apps/web/lib/feed-view.tsx` (+ test): the module ships no language, so the host must pass `embedUrl` and the three labels, or the card cannot show the player.
- `apps/web/e2e/admin.ts`: DB helpers for a resolved YouTube/Vimeo preview post and the walk's fixture ids. Nothing is added to `scripts/seed.ts`, because its pinned feed counts must not move.
- `apps/web/proxy.test.ts`: six branch cases for the policy.
- `apps/web/app/api/csp-report/route.test.ts`: the sink's cases.
- **Committed in:** `df48fb7`, `c917833`

**5. [Plan wording] `embedUrl: z.url().optional()` instead of `z.string().url().optional()`**
- Zod 4's own idiom, consistent with the contract's `z.uuid()`; `.optional()` is kept per the 08-01 web-first rule. The acceptance grep still holds.

**6. [Plan wording] The refresh-branch e2e helper did not exist ("the session spec's helper")**
- `session.spec.ts` has no expired-cookie helper. `csp.spec.ts` gained `expireSessionCookie`: it decodes the `base64-` session cookie (chunk-aware), backdates `expires_at` and re-sets it. The case proves the refresh happened by the rotated cookie and its future `expires_at`, and asserts the policy and nonce on that document response.

---

**Total deviations:** 4 auto-fixed (1 bug, 2 missing critical, 1 blocking) plus 2 plan-wording adjustments.
**Impact on plan:** each fix was needed for correctness or to make the proof real. The Zod fix is the one that would have mattered in production: report-only would have flooded the logs on the first deploy, and enforce would have broken every page's Zod JIT detection.

## Issues Encountered

- **Full dev e2e under enforce** (every spec is now enforced): 735 passed, 125 skipped, 8 failed. All 8 failures were on `desktop-chromium` late in a 1.1 h run, and the same cases passed on mobile in that run.
  - A fresh reset+seed rerun of the four files on desktop gave 55 passed, 1 failed. The remaining case (`stories.spec.ts:1440`, a missing "Story publicado." toast after a successful publish) passes 3/3 alone under both enforce and report-only.
  - Verdict: load and order flakes, not a policy regression. Recorded in `deferred-items.md` for the 08-12 gate run.
- **Unrelated to the policy, deferred** (`deferred-items.md`):
  - the dev-log `reading 'waiting'` browser rejection, which is identical under report-only;
  - `/_global-error`, the one prerendered HTML page, which can't carry a nonce;
  - a `goto` right after `/plataforma/tenants/{id}` loads aborts, also identical under report-only.

## Verification Log

- Task 1: `web typecheck && web lint && vitest run lib/csp`: pass. `db:reset && db:seed && playwright test csp.spec.ts session.spec.ts`: 6 passed, rerun 6/6 as the tracer gate; later 9 csp cases with the liveness case.
- Task 2: `module-feed typecheck/lint/test` (215 passed) and `api vitest tests/unit/cors.test.ts` (5 passed). `db:reset && db:seed && playwright test csp.spec.ts feed.spec.ts`: 35 passed, 3 skipped (pre-existing).
- Task 3: `web typecheck/lint`, `vitest run lib/tenant-host components/platform app/auth` (33 passed), and `lib/tenant-host --sequence.shuffle` (3 passed). IN-07 alone: `vitest run lib/tenant-host -t "the generic answer is served from the error TTL"` gave 1 passed, 2 skipped. `db:reset && db:seed && invites.test.ts`: 27 passed. `invite.spec.ts platform-tenants.spec.ts`: 23 passed, 1 skipped.
- Plan-level: `e2e:pwa` under enforce gave 64 passed, 5 skipped, 0 failed. `pnpm check:static-routes`: OK (58 guarded routes, 0 offenders). Web unit suite: 60 files, 1369 tests passed. API `module-readmes` drift test: pass.
- Acceptance greps:
  - `x-nonce` in `proxy.ts`: 1; `cspFor`: 4.
  - `CSP_MODE` in `env.ts`: 3; in `turbo.json`: 2.
  - `embedUrl` in the contract uses `.optional()`.
  - Sandbox string: 1; `allow-top-navigation`: 0.
  - DEPLOY.md: section heading 1, `CSP_MODE` 7.
  - 02-REVIEW resolution heading: 1.
  - `aceitar-convite` in `confirm/route.ts`: 4; `no_verified_primary` in `ResendInviteButton.tsx`: 2; `at(-1)` in `admins/page.tsx`: 1.
- DB resets: the developer consented on 2026-10-02 for all Phase 8 plans (local stack only; backup at `~/rede-social-local-backups/pre-08-reset.sql`). Five resets ran in this plan.
- No API, web or production server process was left running.

## User Setup Required

None now. At the Phase 8 web deploy, the developer sets `CSP_MODE=report-only` on the production Vercel project, then `enforce` after the 08-12 real-device pass (DEPLOY.md "Content Security Policy (Phase 8)"). Nothing was deployed or changed on the hosted projects.

## Next Phase Readiness

- 08-10 can map `POST /api/csp-report` in the web route-handler inventory.
- 08-12's gate inherits the following:
  - the report-only, then enforce, rollout with its `vercel logs` filter;
  - the real-device E15 backstop (an inline YouTube and Vimeo play on a real iPhone and Android, no Error 153);
  - the deferred full-suite flake notes.

## Self-Check: PASSED
