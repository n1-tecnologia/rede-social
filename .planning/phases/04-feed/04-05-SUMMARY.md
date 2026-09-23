---
phase: 04-feed
plan: 05
subsystem: api
tags: [feed, unfurl, ssrf, undici, open-graph-scraper, pg-boss, worker, oembed, rls, security]

requires:
  - phase: 04-feed
    provides: "04-01's feed module, service projection and keyset page; 04-04's PostMedia band and media projection, which the preview card renders beneath"
  - phase: 02-kernel
    provides: "pg-boss wiring (`enqueueInTx`, `registerJobQueues`, QUEUE_POLICY 'short'), the module manifest `jobs` array and MODULE_REGISTRY, `withTenantTx`"
  - phase: 03-media
    provides: "`media_assets`, `MediaImage` over the `/v1/media/{assetId}/{variant}` redirect, and the never-throwing `derive-job.ts` handler posture"
provides:
  - "A socket-pinned SSRF guard (`guardedAgent`) that refuses an IP literal, a hostname resolving into a private range, a redirect into one, an oversized body and a hung server — proven against local node:http fixtures with no public network"
  - "`feed_link_previews`: a per-tenant link-preview cache whose `unique (tenant_id, url_hash)` is a privacy boundary and the no-second-fetch mechanism at once"
  - "`feed.unfurl-link`: a pg-boss worker job that fetches through the guard, re-enters the tenant lane with the payload's tenant id, and never throws"
  - "`LinkPreviewCard`: the resolved-only bordered external-link card, including the YouTube/Vimeo thumbnail variant with no frame element"
  - "The shared URL matcher in contracts, so the caption's auto-linker and the unfurl create path can never disagree about what counts as a link"
affects: [05-stories, 07-notifications, 08-moderation, 04-09-composer]

actuals:
  tokens: 75100
  tasks: 3
  commits: 4

plan_head_before: b1c6318c4b8d08e8443d10d90ace56cd3fab30db

tech-stack:
  added:
    - "open-graph-scraper@6.12.0 (exact pin, approved at the blocking-human package-legitimacy gate)"
    - "undici@7.29.1 (exact pin, declared DIRECTLY so the module resolves the same instance the scraper does)"
  patterns:
    - "Socket-layer SSRF pinning via a connector FUNCTION, not a resolver hook"
    - "Injectable guard policy, so the reachable half of a loopback-only fixture suite is testable without relaxing production"
    - "Per-tenant cache keyed on sha256 of a normalised URL, with `on conflict do nothing` as the no-second-fetch mechanism"
    - "Silent refusal (UI-D-13): a policy refusal is asserted as the ABSENCE of a marker, never the presence of one"

key-files:
  created:
    - packages/modules/feed/server/unfurl/guard.ts
    - packages/modules/feed/server/unfurl/job.ts
    - packages/modules/feed/server/jobs.ts
    - packages/modules/feed/ui/LinkPreviewCard.tsx
    - packages/modules/feed/tests/unfurl-guard.test.ts
    - apps/api/tests/integration/feed-unfurl.test.ts
    - supabase/migrations/20260923010104_feed_link_previews.sql
  modified:
    - packages/modules/feed/db/schema.ts
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/module.ts
    - packages/modules/feed/ui/PostMedia.tsx
    - packages/modules/feed/ui/PostCaption.tsx
    - apps/web/lib/registry.tsx
    - apps/web/messages/pt-BR/feed.json
    - scripts/seed.ts
    - supabase/tests/090-feed.sql
    - supabase/tests/020-tenant-isolation.sql
    - supabase/tests/010-rls-coverage.sql

key-decisions:
  - "The SSRF guard is a connector FUNCTION, not a `lookup` hook: net.connect never consults the resolver for an IP literal, so a resolver-only guard blocks `localhost` and walks straight through to 127.0.0.1 and the cloud metadata address"
  - "`::ffff:0:0/96` was REMOVED from the IPv6 deny list the research prescribed: Node widens an IPv4 argument to its mapped form before comparing against IPv6 rules, so that one entry blocks the entire public IPv4 internet. IPv4-mapped spellings are unwrapped and re-checked against the IPv4 ranges instead"
  - "The create path validates the URL's SHAPE only, never its address: deciding an address needs a resolver, and a resolver in a request path is the outbound work this design moves to the worker. The SOCKET is the single boundary"
  - "A refused URL is silent end to end — the post publishes, the link renders bare, and the integration case asserts the ABSENCE of a refusal marker rather than its presence (UI-D-13)"
  - "`feed_link_previews.image_asset_id` stays NULL in V1: the card renders body-only rather than hot-linking a remote host into a tenant's branded page, which would leak every member's IP and Referer on each feed render"
  - "No frame element ships. YouTube and Vimeo resolve through oEmbed — reached through the SAME guarded Agent — to a thumbnail card that opens externally; inline playback is a Phase 8 item behind a real CSP"
  - "The unfurl job uses undici's OWN `fetch` for oEmbed, not the global: Node's bundled undici is a different instance and would not recognise the Agent as a dispatcher, sending the call out unguarded while still looking guarded"

patterns-established:
  - "Injectable guard policy: production connector + production lookup + production Agent options, with only the block list substituted, so a loopback fixture can stand in for a public host without a test-only branch in production code"
  - "Per-tenant cache as a privacy boundary: `unique (tenant_id, url_hash)`, asserted in BOTH directions by pgTAP (collides in one tenant, inserts across two)"
  - "Non-Error rejection unwrapping: a library that throws an object literal has its real cause lifted out before it reaches a classifier, or every failure collapses into one bucket"

requirements-completed: [MEDIA-04]

coverage:
  - id: D1
    description: "The SSRF guard refuses an IP literal, a hostname resolving into a private range, a redirect into one, an oversized body, a hung server, a non-http scheme and embedded credentials — all against local node:http fixtures"
    requirement: MEDIA-04
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/unfurl-guard.test.ts (40 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "open-graph-scraper driven through the guarded Agent is actually guarded — the dispatcher's identity is a test, not an assumption"
    requirement: MEDIA-04
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/unfurl-guard.test.ts#refuses a blocked target, and the guard MESSAGE reaches the scraper"
        status: pass
    human_judgment: false
  - id: D3
    description: "A post's first link creates ONE pending cache row and ONE job keyed on the preview id, with no outbound fetch in the request path"
    requirement: MEDIA-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-unfurl.test.ts#1. creating a post enqueues ONE job for ONE pending row"
        status: pass
    human_judgment: false
  - id: D4
    description: "A second post of the same link in the same tenant reuses the row and issues no second outbound fetch; the same link in another tenant is a separate row"
    requirement: MEDIA-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-unfurl.test.ts#3, #4"
        status: pass
      - kind: integration
        ref: "supabase/tests/090-feed.sql (cases 25-29, per-tenant uniqueness both directions)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The worker job writes a terminal resolved/failed state and never throws; a refused target records failure_reason 'blocked'"
    requirement: MEDIA-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-unfurl.test.ts#2, #6"
        status: pass
    human_judgment: false
  - id: D6
    description: "A refused URL publishes the post silently — 201, null preview, and no refusal marker anywhere in the response body"
    requirement: MEDIA-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-unfurl.test.ts#5. UI-D-13 — a refused URL publishes with 201, a null preview and NO refusal marker"
        status: pass
    human_judgment: false
  - id: D7
    description: "Tenant isolation on feed_link_previews: five cases plus a positive control, with an identical url_hash on both sides so the adjacency case cannot be faked"
    requirement: MEDIA-04
    verification:
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (feed_link_previews block)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-unfurl.test.ts#7"
        status: pass
    human_judgment: false
  - id: D8
    description: "A resolved preview projects onto the wire with title, description, siteName and a server-derived hostname; a pending or failed one projects as null"
    requirement: MEDIA-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-unfurl.test.ts#2b, #2c"
        status: pass
    human_judgment: false
  - id: D9
    description: "LinkPreviewCard renders the resolved-only bordered external-link card per UI-SPEC E06 — aspect-video image box, hostname 12/400 tertiary, title 14/700 line-clamp-2, description 14/400 line-clamp-2, and the provider thumbnail variant with its 56px play badge"
    requirement: MEDIA-04
    verification:
      - kind: other
        ref: "grep gates: rel=\"noopener noreferrer\", target=\"_blank\", line-clamp-2, aspect-video present; <iframe|dangerouslySetInnerHTML count 0; Skeleton count 0; non-resolved returns null"
        status: pass
    human_judgment: true
    rationale: "The card's visual fidelity against UI-SPEC E06 (populated, partial, overflow, long-text) has no component test in this plan — the structural rules are grep-pinned but the rendering has not been seen. 04-06/04-09 mount it in the web app, where a human can look at it."

duration: 78 min
completed: 2026-09-23
status: complete
---

# Phase 04 Plan 05: Link Unfurl Behind a Socket-Pinned SSRF Guard — Summary

**MEDIA-04 end to end: a link in a caption is validated at create time, cached per tenant, fetched by a worker through an `undici.Agent` whose connector refuses private targets on every redirect hop, and rendered as a bordered preview card only once it has actually resolved — silently doing nothing when it has not.**

## Performance

- **Duration:** 78 min across two executor dispatches (see Issues Encountered)
- **Tasks:** 3 of 3, plus the opening blocking-human checkpoint
- **Files modified:** 26 (7 created)
- **Commits:** 4 (measured: `git rev-list --count b1c6318..HEAD`)

## Accomplishments

- **The guard is pinned at the socket, and the pinning is proven.** `guardedAgent()` builds a connector FUNCTION that checks `net.isIP(opts.hostname)` against a `net.BlockList` *before* delegating to a `buildConnector({ lookup })` base whose lookup resolves ALL addresses and refuses if any is blocked. One guard therefore covers the IP literal, the hostname, the redirect into a private range and DNS rebinding — 40 unit cases prove each, against local `node:http` fixtures that never touch the public internet.
- **The dispatcher's identity is a test, not an assumption.** One case drives the real `open-graph-scraper` through the real Agent at a blocked target and asserts the guard's own message comes back. If the scraper had resolved a second copy of undici from the store, the Agent would not be recognised, the fetch would go out unguarded, and that case would return the fixture's title instead.
- **The cache's per-tenant uniqueness is both the privacy boundary and the performance mechanism.** `unique (tenant_id, url_hash)` means one tenant can never learn what another shared (pgTAP asserts the collision inside one tenant and the free insert across two, positive control in the same block), and `on conflict do nothing` means a second post of the same link enqueues nothing — the integration test's fixture request counter is the evidence.
- **A refused URL says nothing.** The post publishes with 201, the preview is null, and the integration case asserts the *absence* of any refusal marker in the body. A test that looked for one would have passed while the marker existed — and the marker is exactly the internal-network oracle UI-D-13 forbids.
- **No frame element ships.** YouTube and Vimeo resolve through oEmbed — reached through the same guarded Agent — into the same card with a thumbnail and a play badge that opens externally. `apps/web` has no CSP today, so an embedded third-party frame would have handed Phase 8 a CSP that must already allow it.

## Task Commits

1. **Task 1 (TDD, RED): the failing guard suite + the two approved packages** — `4104124` (test) — *landed by the first dispatch*
2. **Task 1 (TDD, GREEN): the real SSRF guard** — `6988bc5` (feat)
3. **Task 2: the preview cache, the worker job, the create-time enqueue and the resolved-only card** — `0dd687b` (feat)
4. **Task 3: the migration, the seed, and the cache / isolation / silence cases** — `53fe13d` (feat)

No REFACTOR commit: the GREEN implementation needed no cleanup pass, and `tdd.md` says to commit one only if changes were made.

### TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | `4104124` | Pass — 34 failed / 6 passed, `check tdd-red-evidence` → `RED_EVIDENCE_OK`. `guard.ts` landed as a deliberately INERT stub so the failure was an assertion failure, not a module-resolution crash (#3770). |
| GREEN | `6988bc5` | Pass — all 40 cases green in 1.3s. |
| REFACTOR | — | Not needed; correctly omitted. |

## Files Created/Modified

- `packages/modules/feed/server/unfurl/guard.ts` — the pure policy: `BlockedTargetError`, `isBlockedAddress`, `guardedAgent`, `assertAllowedUrl`, `normaliseUrl`, `urlHash`, `DEFAULT_GUARD_POLICY`. No database, no env, no logger, no network at import.
- `packages/modules/feed/server/unfurl/job.ts` — `unfurl` + `feedUnfurlJob`. One pooled Agent per process, the oEmbed branch, the never-throwing handler, the tenant-lane terminal write.
- `packages/modules/feed/ui/LinkPreviewCard.tsx` — the resolved-only card and the provider variant.
- `packages/modules/feed/db/schema.ts` — `feedLinkPreviews` + `feedPosts.linkPreviewId`.
- `packages/modules/feed/contracts/index.ts` — the queue name, the job payload, the status/provider/failure vocabularies, `linkPreviewSchema`, and the shared URL matcher.
- `packages/modules/feed/server/service.ts` — the create-time candidate/validate/cache/enqueue block, the widened projection, `setPostLinkPreview`.
- `packages/modules/feed/ui/PostCaption.tsx` — now IMPORTS the shared matcher instead of declaring its own.
- `apps/web/lib/registry.tsx`, `apps/web/messages/pt-BR/feed.json` — the host mapping and the pt-BR copy.
- `supabase/migrations/20260923010104_feed_link_previews.sql`, `supabase/tests/{010,020,090}*.sql`, `scripts/seed.ts`, `apps/api/tests/integration/feed-unfurl.test.ts` — the schema, its proofs and its fixtures.

## Decisions Made

See `key-decisions` in the frontmatter. The two that most constrain later phases:

1. **The socket is the single boundary.** No address check runs in the request path, because deciding an address needs a resolver and a resolver there is the outbound work this design exists to move to the worker. A refused URL costs one cache row and one job that lands `failed` — not a request-path error.
2. **`image_asset_id` is a deliberate null, not an omission.** Copying a remote thumbnail into Storage is a download-and-derive job in the same shape as `kernel.media-derive-variants`. Until it exists the card renders body-only, which is strictly better than hot-linking a third-party host into a tenant's branded page.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `::ffff:0:0/96` in the deny list blocked the entire public IPv4 internet**

- **Found during:** Task 1 (GREEN)
- **Issue:** `04-RESEARCH.md` §Code Examples 1 puts `['::ffff:0:0', 96]` in the IPv6 deny list to stop `::ffff:127.0.0.1` from smuggling a blocked IPv4 address past the IPv4 ranges. Node's `BlockList` widens an IPv4 argument to its mapped form before comparing it against IPv6 rules, so that one entry also makes `check('93.184.216.34', 'ipv4')` return **true**. The unfurler would have refused every real link on the internet while still looking correct — and every guard test except one would still have passed.
- **Fix:** removed the range from the deny list; IPv4-mapped spellings (both dotted `::ffff:127.0.0.1` and hex `::ffff:7f00:1`) are unwrapped to their IPv4 form and re-checked against the IPv4 ranges instead. Both mapped assertions and the public-address assertion now hold.
- **Verification:** `packages/modules/feed/tests/unfurl-guard.test.ts` — the suite's own `allows an ordinary public address` case is what caught it.
- **Committed in:** `6988bc5`

**2. [Rule 1 - Bug] every scraper refusal was classified `unreachable`**

- **Found during:** Task 3
- **Issue:** `open-graph-scraper@6.12.0` does not resolve with `{ error: true }` on failure — it **throws a plain object literal** `{ error, result: { error, errorDetails } }`, burying the real cause in `errorDetails`. That literal reached `failureReasonFor` as a non-Error with no `cause` chain to walk, so a `BlockedTargetError` was recorded as "the host did not answer". The distinction never reaches an admin (UI-D-13), but it is the only signal an operator reading the table has.
- **Fix:** the ogs call now unwraps `result.errorDetails` and rethrows the real `Error` before it propagates.
- **Verification:** `feed-unfurl.test.ts` cases 2 and 6 assert `failure_reason === 'blocked'`.
- **Committed in:** `53fe13d`

**3. [Rule 3 - Blocker] `feedUnfurlJob` was not reachable from the server barrel**

- **Found during:** Task 3
- **Issue:** the integration test imports `feedUnfurlJob` from `@tria/module-feed/server` (deep imports are blocked by Biome and the `exports` map), but `server/index.ts` did not re-export it.
- **Fix:** added the export.
- **Committed in:** `53fe13d`

### Plan cases restructured (with reasoning)

**4. Two Task 3 cases as written contradict the plan's own socket-layer design.**

The plan asks that a loopback caption "answers 201 … and no job enqueued", and that driving the handler against the metadata fixture "flips the row to resolved with the fixture's title". Both are unreachable at once: the create path cannot refuse an address without a resolver (which the design forbids in a request), and the production Agent refuses the loopback — which is the guard *working*, and is precisely why the guard's own suite has to inject a policy.

- The loopback case now asserts 201, a null preview, no refusal marker, a `pending` row and a request counter that did not move. The admin-visible outcome the plan specified is unchanged and asserted; only the internal expectation moved.
- The resolved path is proved in two places instead of one: case 2 asserts the honest terminal `failed`/`blocked`, cases 2b/2c assert the resolved and failed **wire shapes** against the rows `pnpm db:seed` writes directly, and the scraper's metadata parsing is proved at unit level where the block list can be substituted.
- **No production policy was relaxed for a test.** That was the constraint that decided this.

**5. Two acceptance-criteria greps are mis-specified against any real file layout; intent verified directly instead.**

- `awk '/assertAllowedUrl/,/^  }/' service.ts | grep -c throw` can never read 0 for a file that *imports* the symbol — the awk range starts at the import line. The intent holds and was verified over the actual call site: it sits in a `try` whose `catch` returns null, with **0** throws in that block.
- The `LinkPreviewCard` return-null gate matched my own docblock before reaching the code. The docblock was reworded so the gate pins the guard it was written to pin; it now reads 1.

---

**Total deviations:** 3 auto-fixed (2× Rule 1 bug, 1× Rule 3 blocker), 2 plan cases restructured with reasoning recorded.

**Impact:** deviation 1 is the significant one — shipped as prescribed, the guard would have refused every legitimate link in production while passing 39 of its 40 tests. The suite's public-address case is the only thing that caught it, which is an argument for keeping positive controls next to every negative.

## Issues Encountered

**The run was split across two executor dispatches by a provider rate limit.** The first dispatch resolved the opening package-legitimacy checkpoint (answered "approved"), installed `open-graph-scraper@6.12.0` and `undici@7.29.1` at the exact approved pins, and committed Task 1's RED (`4104124`) — then was terminated mid-run. **No work was lost and the working tree was clean at the handoff**; this second dispatch verified that state (the commit's contents, the two pins, the inert stub and the RED test suite) before building on it, resumed at Task 1's GREEN, and did not re-run the install or re-write the RED suite. The four commits form one continuous, correctly ordered TDD sequence.

**Pre-existing e2e failures were not chased.** The three failures logged in `.planning/phases/04-feed/deferred-items.md` (`shell.spec.ts:111`, `platform-branding.spec.ts:182`, the Storage-sweep interaction in `media.test.ts`) are out of scope for this plan and untouched by it. `pnpm e2e` was not run here — this plan ships no new e2e spec, and its own gates (module unit, API/web typecheck, UI literals, boundaries, pgTAP, integration) are all green.

## Known Stubs

**`feed_link_previews.image_asset_id` is null for every row this plan can produce.** This is a recorded decision, not an oversight: the card renders body-only rather than hot-linking a remote thumbnail into a tenant's branded page, and the column exists so a future download-and-derive job can fill it. Documented in the job's docblock and in the table's. The UI path for a present image is written and grep-pinned but is currently exercised only by a hand-constructed prop — no seeded or runtime row reaches it.

No other stubs: no TODO, FIXME, placeholder or hardcoded-empty value flows to UI rendering from this plan's files.

## Threat Flags

None. Every surface this plan adds is already in the plan's `<threat_model>` (T-04-29 … T-04-37, T-04-SC), and each carries its mitigation plus a test: the socket guard (unit, 40 cases), the body/timeout caps (unit), the silent refusal (integration, asserted as an absence), plain-text metadata rendering and the no-frame rule (grep gates), the per-tenant cache (pgTAP both directions), the job payload as data (pgTAP USING case written as the job's own update), shape-only logging, and the two exact pins behind the blocking-human approval.

## Next Phase Readiness

Ready for 04-06. Two hand-offs worth naming:

- **04-09 (composer/edit)** consumes `setPostLinkPreview(ctx, postId, linkPreviewId | null)` and `postLinkPreviewPatchSchema` for the remove affordance, plus the `feed.linkPreview.composer.*` catalog rows already added. There is no override path and must not be one.
- **Phase 8 (CSP)** inherits a clean slate: no third-party frame ships anywhere in the feed module, so inline YouTube/Vimeo playback is an additive change once a real Content-Security-Policy exists.

## Self-Check: PASSED

All 7 created files exist on disk; all 4 commits (`4104124`, `6988bc5`, `0dd687b`, `53fe13d`) resolve in `git log --all`. `pnpm db:generate` is a no-op with a clean `supabase/migrations` porcelain; `pnpm supabase test db` passes 199 tests; `pnpm test:integration` passes 366; the feed module's typecheck, lint and 65 unit tests, plus `@tria/api` and `@tria/web` typecheck, `check-ui-literals.sh` and `pnpm boundaries`, are all green.
