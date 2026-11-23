---
phase: "11"
slug: rede-social-direct-messages-member-blocking-and-reports
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
threats_total: 41
threats_closed: 41
threats_open_below_threshold: 0
accepted_risks: 5
accepted_by: "Igor"
accepted_on: "2026-11-23"
created: "2026-11-23"
---

# Phase 11 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

No threat is open. On 2026-11-23 the owner accepted the five risks the auditor proposed (AR-11-01 to AR-11-05) and asked for the review warnings to be fixed. Accepting AR-11-01, AR-11-02 and AR-11-03 means WR-01, WR-04 and WR-02 stay as found; WR-03 and WR-05 are the warnings that get fixed (see the log below).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| tenant lane to `chat_conversations` / `chat_participants` | a member's session creates or reads rows; one direct per pair, created only by `app.direct_conversation_open` | message bodies, voice assets, participant rows |
| definer to the tenant tables | the pair gate, the block effects, the report create and the voice gate run as the owner and bypass RLS | every tenant row of the pair, the reports, the blocks |
| worker lane to `direct_message_notice` / `social_pair_open` | the notification fan-out asks the database for the recipient, the body and the deliverable flag | message excerpt, display name, pair state |
| web BFF and server actions to the API | closed error codes, same-origin reads, Zod before the request, no API message echoed | member ids (membership-keyed), report reasons, direct conversation ids |
| member to administrator (reports) | a report stores one message or an id, never the conversation; a recording opens only through its report | reported excerpt, reporter identity |
| notice audience | `report.created` reaches `moderation.manage` holders only, ids only, fixed copy | event ids, bell rows, push titles |

---

## Threat Register

Severity is the highest severity declared for the id across the plans that carry it. Evidence is `file:line` from the auditor's pass of 2026-11-23 (ASVS level 1, mitigations verified by reading code and tests; no test, pgTAP or integration suite was run by the auditor). Migration names drop the `20261119` prefix.

| Threat ID | Category | Component | Severity | Disposition | Mitigation (evidence) | Status |
|-----------|----------|-----------|----------|-------------|------------------------|--------|
| T-11-01 | Information disclosure | cross-tenant reach of a direct (a user in two tenants; `users.id` shared) | high | mitigate | `155818:40-61,105-111` (tenant pinned from the claim), `155903:3` (pair index carries `tenant_id`), `160110:1`, `155914:45-64`, `162800:35,69`; pgTAP 237 §4 with positive control; `isolation.test.ts` phase 11 sweeps | closed |
| T-11-02 | Information disclosure | staff or a third member reading a direct | high | mitigate | `160110:1` (staff term only for `kind='support'`), `155818:104-111` (both users role `member`), `194838:1` + `194821:23-33` (staff see support participant rows only), `162800:37-40`; pgTAP 237 §4, 240 §1 | closed |
| T-11-03 | Information disclosure | a refusal that tells the caller why (block, staff, removed) | high | mitigate | one `DM001` for every refusal (`155914:45-47`, `162341:47-49`); `member_blocks_select` blocker-only; unknown-target 404 for follows; no "blocked me" key; one closed-strip sentence (`chat-view.ts:1290-1296`, `chat.json:48`); tests `direct-chat-block.test.ts:98-104`, pgTAP 237 §5, 238. **Residual WR-01 (blocked side can infer and enumerate who blocked them through `canFollow`/`canMessage: false` and a conversation-less `composer: 'closed'`, up to 50 ids per `follows/state` call): closed as written; the owner accepted the residual as AR-11-01 on 2026-11-23** | closed (residual accepted, AR-11-01) |
| T-11-04 | Tampering | a send racing a block | high | mitigate | send trigger `for update` then `pair_open_in` (`162341:35-48`); block definer takes the same lock (`173204:76-87`); two-connection proofs `direct-chat-block.test.ts:578,631,645`, pgTAP 238 `:526`. Edge: a first-ever message has no row to lock (`173204:13-15`, accepted AR-11-04) | closed (accepted, AR-11-04) |
| T-11-05 | Elevation of privilege | a lane creating a direct row or enrolling a participant | high | mitigate | `160110:2` (insert policy keeps only the support branch), `155914:18-77` (only creator), `155903:5`; pgTAP 237 `:154-171` | closed |
| T-11-06 | Information disclosure | member enumeration through the entry points | high | mitigate | one bare 404 (`direct.ts:74-101`), one `CANNOT_BLOCK` body (`blocks.ts:117`, `reports.ts:229-230`), uuid check in the BFF and pages; `direct-chat.test.ts`, `block-by-membership.test.ts`, isolation sweeps | closed |
| T-11-07 | Denial of service | message, report and block floods | medium | mitigate | `limits.ts:51-62`, `direct.ts:154,161,239,275`, `safety.ts:177,191,199`, body CHECK `20260930190151_chat.sql:10` | closed |
| T-11-08 | Information disclosure | push copy | high | mitigate | `deliverable` recomputed at fan-out (`162800:56`, `chat/server/notifications.ts:262-302`); body cut at 100 graphemes (`notification-copy.ts:48,80`); title is the display name only, cut at 60 (`push/payload.ts:49-58`, schema `contracts/index.ts:358,369`); report title fixed (`report-notice.ts:105`). Lock-screen name and excerpt are the D-728 behavior (accepted AR-11-05) | closed (accepted, AR-11-05) |
| T-11-09 | Information disclosure | a message report exposing the conversation | high | mitigate | `194436:106-132` snapshots one message and stores no conversation column; staff narrowed on participants (`194838`); queue projection `reports.ts:280-328`; `DirectMessageReportRow.tsx` has no link; `reports-new-subjects.test.ts` | closed |
| T-11-10 | Information disclosure | an administrator playing an unreported recording | high | mitigate | `195211:31-54` (the clause matches `media_asset_id` of a report the caller can read), `content_reports_select` reporter or `admin_tenant` only, `core/server/media/service.ts:922`; pgTAP 240 §2 | closed |
| T-11-11 | Tampering | a removal without a log row, or two winners | high | mitigate | single transaction `reports.ts:538-550`, report locked `for update` (`20261105152916_reports_blocks_functions.sql:242`), log row in the same transaction (`stories/server/service.ts:1104-1112,1766-1775`, `communities/server/service.ts:1343+`); `report-removers.test.ts` | closed |
| T-11-12 | Information disclosure | event, log or notice naming the subject, reporter or reported | high | mitigate | ids-only event and closed-vocabulary log (`reports.ts:108-125`), empty facts and fixed title and body (`report-notice.ts:92-121`), fixed row href (`notification-renderers.tsx:345`); `reports-notice`, `reports-new-subjects` tests | closed |
| T-11-13 | Denial of service | bell or device flood | medium | mitigate | `limits.ts:14-17`, one report per reporter and item gives 409 (`reports.ts:227`), dedupe keys (`report-notice.ts:112`, `social/server/notifications.ts:67`), tag per conversation (`chat/server/notifications.ts:72-89`) | closed |
| T-11-14 | Tampering / DoS | release order (migrations, web, API and worker) | high | mitigate | `docs/DEPLOY.md` "Phase 11 release": order and failing windows; `titleText` optional and additive (`contracts/index.ts:369`) | closed |
| T-11-15 | Information disclosure | follow notice to a blocked pair or with `social` off | high | mitigate | `social/server/notifications.ts:37-55` calls `app.social_pair_open`, worker lane only (`155818:80-91`) | closed |
| T-11-16 | Injection | member strings as markup | medium | mitigate | no `dangerouslySetInnerHTML` or `innerHTML` in the phase's web, lib or module-UI files; urls from canonical uuid plus `encodeURIComponent` (`notification-renderers.tsx:315-319`) | closed |
| T-11-17 | Repudiation | UI built before the design approval | high | mitigate | commit `cfe1568d` holds only the five approval lines; plans 19 to 26 carry the `approved: true` guard. Git cannot prove who typed the lines (the agent and Igor share an identity); the approval is Igor's word of 2026-11-19 | closed |
| T-11-18 | Information disclosure | real data in the mockup | medium | mitigate | sketch 025: no e-mail, no long hex run | closed |
| T-11-19 | Tampering | `pair_open_in` called with an arbitrary tenant | medium | mitigate | `155818:63` revoke from public, anon, authenticated; wrappers pin `app.tenant_id()`; pgTAP 237 `:446-449` | closed |
| T-11-20 | Elevation of privilege | a moderator removing an organization item | medium | mitigate | `report-removal.ts:46-57`, `communities/server/service.ts` `canManage` then `not_removable`, `stories/server/service.ts:1085-1089,1190`, `reports.ts:545-547` | closed |
| T-11-21 | Tampering | the follow delete on block | medium | mitigate | `173204:90-93` tenant-pinned and limited to the two rows; pgTAP 238 `:495` | closed |
| T-11-22 | Elevation of privilege | staff or a `social`-off caller reaching the routes | medium | mitigate | `registry.ts:243-254` composes `chat.direct` for `member` only; `chat/server/routes.ts:486,523,563,584,601` use `requireModule('social')` + `requirePermission`; `registry.test.ts:836` | closed |
| T-11-23 | Spoofing | reporting one's own or a non-participant message | high | mitigate | `194436:130-131,136-141` (reporter in the pair, author in the pair, RP001 own, RP002 missing or foreign) | closed |
| T-11-24 | Tampering | forged subject or voice column | medium | mitigate | CHECKs `194425:2-6`; `content_reports` has only a select policy | closed |
| T-11-25 | Information disclosure | a hidden conversation lighting a badge | medium | mitigate | counter runs in the lane under the same policy (`chat/server/service.ts:1252-1308`); `direct-chat-block.test.ts` | closed |
| T-11-26 | Tampering | forged cursor | low | mitigate | `service.ts:1018-1040` guard reused at `direct.ts:495` | closed |
| T-11-27 | Information disclosure | a voice refusal revealing a block | medium | mitigate | asset validation precedes target and pair (`direct.ts:233-246`); equal bodies `direct-chat-voice.test.ts:99`. WR-03 noted (idempotent short-circuit can answer for another conversation; reveals nothing about the named recipient) | closed |
| T-11-28 | Tampering | a reporter learning that an item exists | medium | mitigate | readable-first through the lane, one 404, no 201 (`reports.ts:90-92,144-215`) | closed |
| T-11-29 | Elevation of privilege | a rider mistaken for enforcement | medium | mitigate | the plan carves out the staff-as-blocker case as the recorded A-11-ROLE residual; report definer refuses own content (`194436:139`); block definer refuses staff targets (`173204:63-74`) | closed |
| T-11-30 | Tampering | removing a message | high | mitigate | `report-removal.ts:58-59` `not_removable`, `reports.ts:545-547` refuses the resolution with 409, `reports-view.ts:331-340` offers no remove row for a message | closed |
| T-11-31 | Information disclosure | the reporter or the reported being told | high | mitigate | `report-notice.ts:96-98,112` exclude both; `reports-notice.test.ts` | closed |
| T-11-32 | Elevation of privilege | the notice audience drifting from the SQL role check | medium | mitigate | `report-notice.ts:60-64` derives roles from `KERNEL_ROLE_PERMISSIONS`; `unit/report-audience-drift.test.ts` | closed |
| T-11-33 | Spoofing | cross-site read of the BFF | medium | mitigate | `app/api/chat/direct/route.ts:34-37`, `[conversationId]/route.ts:36-44` (`sameOriginGet`, session claims) | closed |
| T-11-34 | Information disclosure | a user id exposed | high | mitigate | membership-keyed routes answering `{changed}` only (`blocks.ts:110-136`, `safety.ts:136-151`); the contract diff since `adc12ee6` adds no user id to any API answer. IN-01 noted: `GET /v1/blocks` and `BlockedList.tsx` still carry `userId` (a route that predates the phase) | closed |
| T-11-35 | Elevation of privilege | hiding is not enforcement | medium | mitigate | pages 404 without `chat.direct` (`conversas/page.tsx:31`, `[conversationId]/page.tsx:42`, `com/[membershipId]/page.tsx:41`); API guards as T-11-22; `chat-nav.ts:27` permission-only | closed |
| T-11-36 | Elevation of privilege | an entry offered to the wrong viewer (staff as blocker, WR-04) | medium | mitigate | Expected: the API and the database refuse what the screen no longer offers. Found: only the riders (`canBlock`) hide Bloquear from staff; `app.member_block_create` (`173204:37-96`) checks that the caller is a live member and the target a `member`, with no caller-role check, and `/v1/blocks*` has no permission guard (`safety.ts:103-203`). Effect is self-inflicted (a staff account filters its own lists). Decision: the owner accepted AR-11-02 on 2026-11-23, so the one-migration fix (`BL001` when `app.tenant_role() <> 'member'`) is not made | closed (accepted, AR-11-02) |
| T-11-37 | Elevation of privilege | a non-moderator tapping the report row | low | mitigate | `denuncias/page.tsx:30,33` (`notFound()`); audience is moderators only | closed |
| T-11-38 | Tampering | e2e fixtures left behind | medium | mitigate | `direct-chat.spec.ts:105-112` and `safety.spec.ts:92` drop their own tenants in `afterAll` | closed |
| T-11-39 | Information disclosure | a credential in a spec | low | mitigate | `direct-admin.ts:26` and the specs read `SEED_PASSWORD` from the environment; no literal password | closed |
| T-11-40 | Repudiation | an agent recording a proof as done | high | mitigate | `11-MANUAL-PROOFS.md`: only Igor writes `passed`; 41 rows `pending`, 0 `passed` | closed |
| T-11-41 | Information disclosure | secrets in notes or the ledger | medium | mitigate | scan of the ledger and the `docs/DEPLOY.md` Phase 11 section finds no JWT, `sb_` key, DSN, project ref or long hex | closed |

`T-11-SC` (supply chain) is not applicable: `git diff adc12ee6..HEAD` shows no change to any `package.json`, lockfile or workspace file.

*Status: open · closed · closed (accepted, AR-11-NN) · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `high` count toward `threats_open`*

---

## Accepted Risks Log

Accepted by Igor on 2026-11-23 ("Aceitar os 5 riscos e corrigir os avisos de revisao"). The five entries are the auditor's proposals, accepted as written. Accepting a risk means its warning is left as found: WR-01 (AR-11-01), WR-04 (AR-11-02) and WR-02 (AR-11-03) are not fixed. WR-03 and WR-05 are covered by no accepted risk and are fixed.

| Risk ID | Threat Ref | Rationale | Accepted by | Date |
|---------|------------|-----------|-------------|------|
| AR-11-01 | T-11-03 (WR-01) | D-722 and plan 23 lock that the blocked member sees no Seguir or Enviar buttons and a `closed` composer, so a block is inferable per profile. `POST /v1/social/follows/state` and `GET /v1/chat/direct/with/{id}` make the same signal bulk-enumerable (50 ids per call, no dedicated limiter). No field says "blocked me" and a script could already read profiles one by one, so the marginal harm is small. No hardening is made (no throttle on `follows/state`, no change to what the blocked side sees). | Igor | 2026-11-23 |
| AR-11-02 | T-11-36, T-11-29 (WR-04, A-11-ROLE) | Staff can create blocks through the API; the effect is self-inflicted (the staff account filters its own lists). The one-migration fix (`BL001` when the caller is not `member`) is not made. | Igor | 2026-11-23 |
| AR-11-03 | WR-02 (unregistered) | `app.realtime_topic_allowed` `conv:` ignores `app.direct_pair_readable`; a participant of an unreadable pair keeps the ids-only topic and its 72 h replay. Plan 09's pgTAP 240 records the residual. The `direct_pair_readable` term is not added. | Igor | 2026-11-23 |
| AR-11-04 | T-11-04 (empty edge) | The first message of a pair has no conversation row to lock, so a block committed in that window is not serialised. Documented at `173204:13-15`. | Igor | 2026-11-23 |
| AR-11-05 | T-11-08 (D-728) | The lock screen shows the writer's display name and the first 100 graphemes. Plans 04 and 13 call this accepted D-728 behavior. | Igor | 2026-11-23 |

### Other findings that reopen no threat

- **WR-03** (`direct.ts:233-236`, `voice-sql.ts:71-85`): the idempotent voice short-circuit returns the caller's own prior message, possibly from another conversation. A real correctness defect, no disclosure about the named recipient. Owner asked for the fix on 2026-11-23: compare the stored conversation with the pair.
- **WR-05** (`safety.ts:196-201`): unblock by membership shares the 60-per-hour limiter. Maps to no register threat. Owner asked for the fix on 2026-11-23.
- **IN-01** (`GET /v1/blocks`, `BlockedList.tsx` carry `userId`), **IN-02** (`direct_message_notice` not bound to the event's conversation id), **IN-03** (the send trigger does not check that the author is one of the pair; the `chat_messages_insert` participant check covers it today).
- Auditor's own observation: `app.direct_pair_readable(uuid, uuid)` is executable by `authenticated` with arbitrary ids; it is tenant-pinned and needs a known user id, so it is a minor liveness probe.
- Summary 11-09 flag `rls-narrowing` on `chat_participants_select` maps to T-11-09 and T-11-02 and was verified (`194838:1`, `194821:23-33`).

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-23 | 41 | 40 | 1 (T-11-36, medium, non-blocking) | gsd-security-auditor (read-only, ASVS 1, block_on high), written by the orchestrator |
| 2026-11-23 | 41 | 41 | 0 | owner decision: AR-11-01..05 accepted (T-11-36 closed as accepted AR-11-02) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer): all 41 are `mitigate`
- [x] Accepted risks documented in the Accepted Risks Log: five accepted by the owner on 2026-11-23
- [x] `threats_open: 0` confirmed (blocking count; T-11-36 is below `high`)
- [x] `status: verified` set in frontmatter (owner decided AR-11-01 and AR-11-02 on 2026-11-23)

**Approval:** Igor, 2026-11-23 (accepted AR-11-01 to AR-11-05 in chat; he did not review each line of the register)
