---
phase: 07-notifications-web-push-chat
plan: 06
subsystem: notifications
tags: [web-push, vapid, push-subscriptions, channel-abstraction, pg-boss, transport-seam, ssrf, pgtap, D-228, D-235, D-236, UI-D-266]
status: complete

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-01 channel registry (in_app delivered -> later channels' recipients), NotificationPushHint, notificationsSystemCtx, resolveCounters seam, cutOnWord; 07-04/07-05 push hints on every non-like intent (reminder Topic = 32-hex event id, tag events-reminder-<hex32>); 07-04 sink singleton-key rule"
provides:
  - "push_subscriptions table (tenant-scoped endpoint uniqueness, owner-only select/delete, no insert/update policy)"
  - "definers app.push_subscription_upsert / push_subscriptions_for / push_subscriptions_delete_dead (null = whole tenant) / push_subscription_report"
  - "POST and DELETE /v1/notifications/push-subscriptions (400 VALIDATION_FAILED details.push = endpoint_invalid | keys_invalid)"
  - "pushChannel registered after in_app; notifications.push-send job (pushSendJob / runPushSend) on notificationsModule.jobs"
  - "transport seam: pushTransport(), fakePushTransport (/status/<code>), webPushTransport, fakePushOutbox, resetFakePushOutbox, outcomeForStatus"
  - "buildPushPayload (v 1, <= 3072 bytes), isAllowedPushEndpoint, PUSH_SERVICE_HOST_SUFFIXES, PUSH_TITLE_COPY, NEUTRAL_PUSH_ICON"
  - "contracts: NOTIFICATIONS_QUEUES.pushSend, PUSH_PAYLOAD_VERSION, PUSH_PAYLOAD_MAX_BYTES, PUSH_SEND_CHUNK, PUSH_MAX_ATTEMPTS, PUSH_RETRY_DELAYS_SECONDS, PUSH_PATH, PUSH_TOPIC, PUSH_TAG, pushSubscriptionInputSchema, pushSubscriptionDeleteSchema, notificationPushHintSchema, pushSendJobSchema, pushPayloadSchema"
  - "kernel env PUSH_TRANSPORT (fake default), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT + assertProductionEnv rule"
  - "harness pushSendJobsOf(tenantId), runPushSendJobs(tenantId)"
  - "web-push 3.6.7 in the module and the API (external in the bundle); @types/web-push 3.6.4 (dev)"
affects: [07-07 browser subscribe flow and service worker, 07-08 chat push-only intents, 07-11 DEPLOY secrets, phase 8 block action (can call push_subscriptions_delete_dead eagerly)]

actuals:
  tokens: 38900
  tasks: 3
  commits: 3
plan_head_before: 4d1e91be53feee0b5d52e734a7d9d5619a2f2219

tech-stack:
  added: ["web-push 3.6.7", "@types/web-push 3.6.4 (dev)"]
  patterns:
    - "Second adapter on the NOTIF-04 registry: it enqueues in the fan-out transaction, sends in the worker"
    - "Transport seam selected by a kernel env enum with a fake default pinned in every vitest config (the VIDEO_PROVIDER rule)"
    - "Worker job in three steps: read in a tenant system lane, send outside any transaction, report and re-enqueue failed-only; a post-send failure is logged, never re-thrown"
    - "Per-recipient badge computed in a lane opened AS the recipient through the kernel counters resolver"
    - "Route-level zod-openapi hook mapping schema issues to a domain refusal (details.push)"

key-files:
  created:
    - packages/modules/notifications/server/channels/push.ts
    - packages/modules/notifications/server/push/send-job.ts
    - packages/modules/notifications/server/push/transport.ts
    - packages/modules/notifications/server/push/payload.ts
    - packages/modules/notifications/server/push/endpoint.ts
    - packages/modules/notifications/server/push-subscriptions.ts
    - packages/modules/notifications/tests/push-channel.test.ts
    - packages/modules/notifications/tests/push-transport.test.ts
    - packages/modules/notifications/tests/push-payload.test.ts
    - packages/modules/notifications/tests/push-endpoint.test.ts
    - supabase/migrations/20260930180214_push_subscriptions.sql
    - supabase/migrations/20260930180227_push_subscriptions_functions.sql
    - supabase/tests/153-push-subscriptions.sql
    - apps/api/tests/integration/push.test.ts
    - apps/api/tests/unit/env.test.ts
  modified:
    - packages/core/server/env.ts
    - packages/modules/notifications/contracts/index.ts
    - packages/modules/notifications/db/schema.ts
    - packages/modules/notifications/module.ts
    - packages/modules/notifications/server/index.ts
    - packages/modules/notifications/server/routes.ts
    - packages/modules/notifications/server/channels/registry.ts
    - packages/modules/notifications/tests/channels.test.ts
    - packages/modules/notifications/package.json
    - packages/modules/notifications/vitest.config.ts
    - apps/api/package.json
    - apps/api/vitest.config.ts
    - apps/api/tests/integration/setup.ts
    - apps/api/tests/integration/isolation.test.ts
    - supabase/tests/020-tenant-isolation.sql
    - supabase/tests/010-rls-coverage.sql
    - .env.example
    - pnpm-lock.yaml

key-decisions:
  - "app.push_subscriptions_delete_dead(null) sweeps every stale device of the tenant; the push adapter sweeps the audience (null for a members broadcast) before choosing recipients, because in_app's live predicate already drops a blocked member from the recipient list"
  - "The push adapter enqueues only recipients with a live device (app.push_subscriptions_for), so a fan-out whose recipients have no device enqueues no job"
  - "The neutral push icon is /icons/rede-social-192.png (the neutral manifest's i192); /icons/icon-192.png does not exist"
  - "A push url must be a same-origin path: PUSH_PATH refuses //, /\\ , backslashes and whitespace, since a browser resolves those to another origin"
  - "p256dh must be 65 bytes AND start with 0x04 (an uncompressed P-256 point, RFC 8291)"
  - "Any 2xx from the push service is sent (web-push resolves only on 2xx); 400/413 are reported as failed (failure_count) and never re-tried"
  - "The upsert deletes another owner's row of the endpoint, then inserts with on conflict do update (the owner's key refresh keeps the row id; concurrent saves by two users still leave one owner)"
  - "Retry jobs carry a unique singleton key push:<dedupeKey>:retry:<n>:<uuid> (the short policy drops a keyless second job)"

patterns-established:
  - "Push hint validated at the adapter (notificationPushHintSchema): an invalid Topic is logged notifications.push.bad_hint and never enqueued"
  - "CHANNEL_KEYS + a compile-time exhaustiveness check keep CANONICAL_ORDER equal to the NotificationChannelKey union"

requirements-completed: [NOTIF-03, NOTIF-04]

coverage:
  - id: D1
    description: "A subscribed member gets exactly one push per post: tenant display name, tenant i192 or the neutral icon, 'Novo post: {excerpt}', /post/{id}, tag feed-post, renotify false, badge = their counters; opts TTL 86400, urgency normal, Topic feed-post; 201 stamps last_success_at; a re-run fan-out enqueues nothing"
    requirement: NOTIF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/push.test.ts#1. a subscribed member gets ONE branded, tagged push per post"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-235: a feed.comment_liked fan-out writes the in-app row and enqueues no push job, even with a device"
    requirement: NOTIF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/push.test.ts#2. D-235"
        status: pass
      - kind: unit
        ref: "packages/modules/notifications/tests/push-channel.test.ts#D-235"
        status: pass
    human_judgment: false
  - id: D3
    description: "410 deletes the subscription; 503 is re-enqueued alone (attempt 1, ~30 s, then 2 min, 8 min) and dropped after the third attempt; a healthy sibling is never re-sent"
    requirement: NOTIF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/push.test.ts#4. 410 deletes the subscription, 503 is re-tried alone"
        status: pass
    human_judgment: false
  - id: D4
    description: "SC 4: a member blocked after subscribing loses their devices at the next push and gets nothing; a job whose listed user turned non-live deletes their devices"
    requirement: NOTIF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/push.test.ts#5 and 5b"
        status: pass
      - kind: other
        ref: "supabase/tests/153-push-subscriptions.sql fact 5 (pnpm supabase test db)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Subscription input and storage: SSRF endpoint rule, key lengths, device handoff, owner-only access, idempotent DELETE, tenant isolation"
    requirement: NOTIF-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/push.test.ts#6, 7, 8, 9"
        status: pass
      - kind: unit
        ref: "packages/modules/notifications/tests/push-endpoint.test.ts"
        status: pass
      - kind: other
        ref: "supabase/tests/153-push-subscriptions.sql facts 0-4, 6; 020-tenant-isolation.sql; 010-rls-coverage.sql"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b11. push subscriptions"
        status: pass
    human_judgment: false
  - id: D6
    description: "NOTIF-04: push is the second adapter on the registry; every channel key has an adapter, an intent listing a key reaches only that adapter, an unregistered key throws and is skipped, push receives only in_app's newly delivered recipients"
    requirement: NOTIF-04
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/channels.test.ts#assumption-delta invariant"
        status: pass
      - kind: unit
        ref: "packages/modules/notifications/tests/push-channel.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "Real transport pinned: generateRequestDetails headers (TTL, Urgency, Topic, aes128gcm, vapid Authorization with aud = endpoint origin) for broadcast, reminder and chat hints; status matrix; payload <= 3072 bytes with grapheme-safe cuts; env refuses a partial VAPID set or a localhost/http subject; the API bundle imports web-push"
    requirement: NOTIF-03
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/push-transport.test.ts"
        status: pass
      - kind: unit
        ref: "packages/modules/notifications/tests/push-payload.test.ts"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/env.test.ts"
        status: pass
      - kind: other
        ref: "pnpm --filter @rede-social/api build; dist/main.js has `import webpush from \"web-push\"` and no generateRequestDetails source"
        status: pass
    human_judgment: false
  - id: D8
    description: "A real banner on a real Android and iPhone (tenant name, icon, collapse by tag, tap target) against FCM/Apple"
    requirement: NOTIF-03
    verification: []
    human_judgment: true
    rationale: "No automated run reaches a real push service by design (PUSH_TRANSPORT=fake); the push-service host allow-list is [ASSUMED] and the banner rendering needs the 07-07 service worker and the real-device plan."

duration: 25min
completed: 2026-09-30
---

# Phase 7 Plan 06: Web Push, server half Summary

**Members' push subscriptions are stored behind four tenant-scoped definers and an SSRF-safe endpoint rule. A second channel adapter turns each fan-out's newly notified members into `notifications.push-send` jobs. The job sends one branded, versioned, size-bounded payload per device through a `PUSH_TRANSPORT` seam (fake by default, `web-push` with VAPID for real), deletes expired devices and those of blocked members, and re-tries only the failed ones.**

## Performance

- **Duration:** about 25 min
- **Started:** 2026-09-30T17:57:47Z
- **Completed:** 2026-09-30T18:22:37Z
- **Tasks:** 3 of 3
- **Files modified:** 36 (33 excluding drizzle snapshots and the lockfile)

## Accomplishments

- **Subscriptions.** `push_subscriptions` has owner-only select/delete policies ANDed with the tenant claim and no insert or update policy. Endpoints are unique per tenant. Every write goes through `app.push_subscription_upsert`. It requires a live membership and replaces another member's row with the same endpoint, so a device handed from A to B stops receiving A's pushes.
- **Routes.** `POST` and `DELETE /v1/notifications/push-subscriptions` take no permission beyond `requireAuth` and `requireModule`. The save refuses anything but `https:` on FCM, Mozilla, Apple or WNS (`push.fake.test` only under the fake transport), and refuses keys that are not 65 and 16 bytes. Both refusals answer `details.push`. The DELETE is idempotent and cannot reach another member's device.
- **Channel.** `pushChannel` runs after `in_app` and pushes only the members `in_app` newly wrote a row for, so a retried fan-out pushes nobody twice. It first sweeps the audience's dead devices, keeps only recipients with a live device, and chunks them 100 per job. Likes (`push: null`) and empty fan-outs enqueue nothing.
- **Job.** `notifications.push-send` works in three steps:
  1. It deletes the devices of listed users who are no longer live, then reads the live ones, the tenant name and the `icon-192`.
  2. It computes each recipient's badge in a lane opened as that recipient, then sends outside any transaction.
  3. It reports each outcome and re-enqueues only the failed subscriptions, after 30 s, 2 min and 8 min, up to three times.

  It logs counts only.
- **Env.** `PUSH_TRANSPORT` defaults to `fake`, and both vitest configs pin it. `assertProductionEnv` refuses `webpush` without the VAPID key pair and subject, and refuses a subject that names `localhost` or is not `mailto:` or `https:`.
- **Proof.** pgTAP 153 has 35 assertions, 020 has 3 more (plan 153), and 010 lists the table. The integration suites add 9 push cases and isolation case b11. There are 52 new unit cases covering the headers, the status matrix, payloads and endpoints, plus the env unit test. The built API bundle keeps `web-push` external.

## Task Commits

1. **Task 1: Push end to end on the fake transport** - `b7deedd` (feat)
2. **Task 2 [BLOCKING schema]: pgTAP 153, 020, 010, isolation b11** - `2c61419` (test)
3. **Task 3: Harden the real transport** - `05d7e39` (test)

**Plan metadata:** recorded in the docs commit that carries this SUMMARY.

## Files Created/Modified

- `packages/modules/notifications/server/channels/push.ts`: the push adapter (sweep, device filter, chunking, keys).
- `packages/modules/notifications/server/push/send-job.ts`: the job (read, badge, send, report, failed-only re-enqueue).
- `packages/modules/notifications/server/push/{transport,payload,endpoint}.ts`: the transport seam, the payload builder and the SSRF rule.
- `packages/modules/notifications/server/push-subscriptions.ts` and `routes.ts`: the save/delete service and routes.
- `packages/modules/notifications/{contracts/index.ts,db/schema.ts,module.ts,server/index.ts}`: the contracts, the table, the job registration and the channel registration.
- `supabase/migrations/20260930180214_push_subscriptions.sql` and `…180227_push_subscriptions_functions.sql`: the generated table and the four definers.
- `packages/core/server/env.ts`: `PUSH_TRANSPORT` and `VAPID_*`, plus the production rule.
- Tests: `supabase/tests/153-push-subscriptions.sql`, `020`, `010`, `apps/api/tests/integration/{push,isolation}.test.ts`, `apps/api/tests/unit/env.test.ts`, `packages/modules/notifications/tests/{channels,push-channel,push-transport,push-payload,push-endpoint}.test.ts`.

## Decisions Made

See `key-decisions`. The two that change behaviour relative to the plan text are deviations 1 and 2 below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] The job's per-listed-user cleanup could never see a blocked member**
- **Found during:** Task 1 (integration case 5)
- **Issue:** The plan cleaned dead subscriptions only for the job's listed `userIds`. Those are `in_app`'s newly delivered recipients, and the fan-out's live predicate has already removed a blocked member from that list. Case 5 ("blocked, then a publish deletes their subscriptions") could therefore never pass, and SC 4 would have held only until the member's next personal kind.
- **Fix:** `app.push_subscriptions_delete_dead(null)` now sweeps every stale device of the tenant (and never another tenant's). The adapter sweeps before choosing recipients: `null` for a `members` broadcast, the listed users otherwise. The job still sweeps its own listed users just before sending. pgTAP 153 fact 5 pins `null` and its tenant scope.
- **Files modified:** `*_push_subscriptions_functions.sql`, `server/channels/push.ts`
- **Committed in:** b7deedd, 2c61419

**2. [Rule 1 - Bug] The planned neutral icon path does not exist**
- **Found during:** Task 1
- **Issue:** The plan named `/icons/icon-192.png`. The shell's neutral set is `apps/web/public/icons/rede-social-192.png`, which is what `apps/web/lib/manifest.ts` serves as its `i192`.
- **Fix:** `NEUTRAL_PUSH_ICON = '/icons/rede-social-192.png'`, which the integration expectation uses too.
- **Committed in:** b7deedd

**3. [Rule 2 - Missing critical] The adapter keeps only recipients with a live device**
- **Found during:** Task 1
- **Issue:** The truth "a fan-out whose recipients all lack subscriptions enqueues no job" (case 6) needs a device lookup before enqueueing. The plan's adapter description enqueued every recipient.
- **Fix:** The adapter reads `app.push_subscriptions_for(recipients)` and enqueues only users that have a device. `delivered` is that list, and `skipped` counts the rest.
- **Committed in:** b7deedd

**4. [Rule 2 - Security] The payload URL rule refuses protocol-relative and backslash paths**
- **Issue:** "Must start with `/`" also admits `//evil.test` and `/\evil.test`, which a browser resolves to another origin.
- **Fix:** `PUSH_PATH` (`/^\/(?![/\\])[^\\\s]*$/`) is used by the hint schema, the payload schema and `buildPushPayload`. Unit tests cover it.
- **Committed in:** b7deedd, 05d7e39

**5. [Rule 2 - Correctness] `p256dh` must start with `0x04`, and the hint is validated at the adapter**
- **Fix:** The key check requires an uncompressed P-256 point (RFC 8291), not just 65 bytes. The adapter parses the hint (Topic of 32 characters or fewer, tag, same-origin URL, TTL). An invalid hint is logged as `notifications.push.bad_hint` and never enqueued, so one bad producer hint cannot make every job for that kind drop.
- **Committed in:** b7deedd

**6. [Rule 1 - Bug] Any 2xx counts as sent**
- **Issue:** The plan's matrix names 201/202. `web-push` resolves on any 2xx, so a 200 would have been mapped to `retry` and re-sent three times.
- **Fix:** `outcomeForStatus` maps any 2xx to `sent`. `dropped` (400/413) is reported as `failed` (it counts toward `failure_count`) and is never re-tried.
- **Committed in:** b7deedd

**7. [Design] Post-send failures are logged, never re-thrown**
- **Issue:** Planning decision 2 forbids re-sending to subscriptions that already succeeded. A throw from the report/re-enqueue step, which runs after the sends, would make pg-boss retry the whole job.
- **Fix:** Steps 1 and 2 throw on their own database failure, before any send. Step 3 logs `push.report_failed` (shape only) and returns. A per-subscription transport exception counts as `retry`.
- **Committed in:** b7deedd

**8. [Design] The upsert keeps the owner's row id on a key refresh**
- **Fix:** It deletes any row of the endpoint owned by ANOTHER user, then inserts with `on conflict (tenant_id, endpoint) do update` (rewriting `user_id` too). The observable handoff is unchanged: only the new owner's row exists, and the handoff is tenant-scoped. The upsert also refuses a non-`https://` endpoint (22023) as defence in depth.
- **Committed in:** b7deedd

**9. [Harness/tests] Files outside `files_modified`**
- `packages/modules/notifications/tests/push-channel.test.ts`: adapter unit tests.
- `packages/modules/notifications/vitest.config.ts`: pins `PUSH_TRANSPORT: 'fake'` like the API config.
- `.env.example`: the new env block, as the orchestrator asked.
- `registry.ts`: now exports `CHANNEL_KEYS`, with a compile-time exhaustiveness check, for the invariant test.
- The route's own zod-openapi hook maps schema issues to `details.push`.
- Isolation b11 also checks the DELETE on the lab host (403).
- Push cases 5b and 7 have a positive control and a "not a url" refusal.

---

**Total deviations:** 9 (2 Rule 1, 4 Rule 2, 2 design, 1 harness).
**Impact on plan:** Deviations 1 and 3 were needed for the plan's own truths (SC 4 and NOTIF-03 empty). Deviations 4 to 6 close correctness and SSRF-adjacent gaps. There is no scope creep.

## Issues Encountered

- **The full API integration suite passes 679 of 680.** The one failure is the known `signup.test.ts` case 2, caused by the env hosts (`tria-*` in `.env.local`), which is recorded in `deferred-items.md`. Not worked around.
- Local database: reset and re-seeded three times (allowed for this phase). `pnpm db:seed` still prints `tria-*` hosts.

## Verification (final runs)

- `pnpm --filter @rede-social/module-notifications typecheck`, `lint` and `test` (7 files, 90 tests) all pass. `pnpm --filter @rede-social/api typecheck`, `lint` and `test` (unit: 4 files, 29 tests) all pass. `pnpm boundaries` checked 785 files with no issues. `pnpm lint` and the web/core typechecks also pass.
- `pnpm db:generate`: "No schema changes", and `git status -- supabase/migrations` is clean.
- `pnpm db:reset && pnpm db:seed && pnpm supabase test db`: 20 files, 649 tests, PASS. Then `push`, `isolation` and `notifications` passed 62 of 62.
- `pnpm --filter @rede-social/api build`: `dist/main.js` has `import webpush from "web-push"`, and no dist file contains `generateRequestDetails`.

## Known Stubs

None. The fake transport is the intended default, and every automated run pins it.

## Threat Flags

None beyond the plan's threat model. T-07-33 to T-07-41 and T-07-SC are mitigated and tested as planned. The new routes and definers are the ones the register lists.

## User Setup Required

None for local development. `PUSH_TRANSPORT` defaults to `fake`, so the developer does not need to add anything to `apps/api/.env.local`. **Optional:** to try real pushes locally later (after 07-07 ships the browser side), add these to `apps/api/.env.local` with a pair from `npx web-push generate-vapid-keys` (never committed):

```
PUSH_TRANSPORT=webpush
VAPID_PUBLIC_KEY=<public>
VAPID_PRIVATE_KEY=<private>
VAPID_SUBJECT=mailto:<a real address, not localhost>
```

## Notes for 07-11 (DEPLOY.md and deploy-api.yml)

- Create three GCP Secret Manager secrets: **`vapid-public-key-prod`**, **`vapid-private-key-prod`** and **`vapid-subject-prod`** (a `mailto:` or `https:` contact, never `localhost`). Generate the pair ONCE with `npx web-push generate-vapid-keys`. Rotating it invalidates every stored subscription (one-way door; 07-07's key-mismatch resync re-subscribes granted devices).
- Mount them on the **worker** as `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`, and set **`PUSH_TRANSPORT=webpush`** there. The worker runs `notifications.push-send`. The API enqueues only, but it boots the same kernel env, so give it either the same three secrets plus `webpush` or leave it on `fake`. It never sends.
- On Vercel, set only the public key's twin, **`NEXT_PUBLIC_VAPID_PUBLIC_KEY`** (the same value as `vapid-public-key-prod`). The private key must never reach Vercel.
- The API image must ship `web-push` in `node_modules`: it is an `apps/api` dependency and stays external in `dist/`, like `sharp`.
- The push-service host allow-list (`PUSH_SERVICE_HOST_SUFFIXES`) is [ASSUMED]. The real-device plan should confirm it. An unlisted host shows up as a visible 400 `endpoint_invalid`.

## Next Phase Readiness

- 07-07 can build the browser half against `POST`/`DELETE /v1/notifications/push-subscriptions`, the `{ v: 1, title, body, icon, url, tag, renotify, badge }` payload (`pushPayloadSchema`) and the 400 `details.push` refusals.
- 07-08's chat kinds can be push-only intents (`channels: ['push']`, a `users` audience). The adapter resolves them. Their Topic must be the 32-hex conversation id.
- Phase 8's block action can call `app.push_subscriptions_delete_dead(array[userId])` eagerly.

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-09-30*

## Self-Check: PASSED

All fifteen created key files exist on disk, and the three task commits (`b7deedd`, `2c61419`, `05d7e39`) are in history.
