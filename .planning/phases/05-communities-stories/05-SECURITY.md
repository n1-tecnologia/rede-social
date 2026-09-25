---
phase: "05"
slug: "communities-stories"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
threats_total: 82
threats_closed: 82
asvs_level: 1
block_on: high
register_authored_at_plan_time: true
created: "2026-09-25"
verified: "2026-09-25"
residuals_open: 5
unregistered_flags: 1
---

# Phase 05 — Security

> Contrato de segurança da fase: registro de ameaças, riscos aceitos e trilha de auditoria.
> Registro autorado em tempo de planejamento (os 12 PLANs carregam `<threat_model>`), verificado
> retroativamente por `/gsd-secure-phase 05` em 2026-09-25.

**IDs não são únicos entre planos.** Os planos de gap closure (05-09..05-12) reusam `T-05-40`..`T-05-54`
com significados diferentes dos da 05-07/05-08, e `T-05-SC` aparece nos 12 planos. Toda ameaça é
identificada pelo par **(Threat ID, Plan)**. São 82 entradas: 74 `mitigate`, 8 `accept` no plano.

---

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → Next BFF | The member's session cookie is exchanged for a Bearer token; every community read/write crosses here |
| Next BFF → Hono API | `Authorization: Bearer` plus the tenant host; the API re-derives tenant authority from membership of record, never from the host alone |
| API → Postgres | `withTenantTx` sets `local role authenticated` and the JWT claims; RLS is the third layer under the explicit `tenant_id` predicate |
| repo → reviewer's browser | The mockup is opened locally as a file; it must carry no network fetch and no external script |
| catalog → rendered string | Interpolated catalog values reach a member's screen; a missing argument renders a raw brace |
| browser → Next BFF → Hono API | `communityId` arrives as untrusted client input on the create path |
| browser → Next server action → API | The community form's fields and the uploaded cover asset id cross here as untrusted input |
| browser → Storage | The cover's bytes go DIRECTLY to Supabase Storage on a signed upload URL; they never transit the API |
| browser → Storage / streaming vendor | Story bytes go DIRECTLY to Supabase Storage or the vendor's direct-upload endpoint on a signed token; they never transit Cloud Run (32 MiB body cap, MEDIA-01) |
| vendor webhook → worker | The asset's measured duration arrives asynchronously and is the authority for the ~60 s cap |
| browser → Next BFF → API | `mediaAssetId` and the caption arrive as untrusted client input |
| browser → API | The like toggle and the story id arrive as untrusted client input |
| API → streaming vendor | A per-request playback token is minted for the viewer and must never be cached, persisted or logged |
| viewer → member's screen | The caption is tenant content rendered into a full-screen surface |
| admin history → member surfaces | Deleting a story must remove it from every surface at once, including other communities' highlights |
| browser → `POST/PATCH /v1/communities` | An authenticated admin of tenant A supplies a uuid the server has so far trusted. Untrusted input crosses here. |
| API service → Postgres | The write runs as `api_user` under `set local role authenticated`; RLS decides visibility on SELECT but referential integrity on the FK runs as the table owner and does NOT. |
| API response → browser | The status/body difference between two refusals is an information channel across the tenant boundary. |
| tenant media → the member's device | Story media is fetched through `/v1/media/{assetId}/{variant}`, a per-request signed redirect; the component renders whatever the tenant's admin uploaded. |
| viewer component → member's device resources | An unbounded render loop is an untrusted-input-shaped resource consumption on hardware the product does not own. |
| gesture surface → member intent | A tap is the member's only input on this screen; a surface where one tap carries two meanings misreports intent. |
| browser → the playback-token server action | A short-lived, per-request credential for one asset crosses into the client. |
| vendor player element → the bridge | The bridge trusts a third-party custom element's event surface for the values that drive the viewer's clock. |
| build output → every tenant's host | A prerendered authenticated route would serve one tenant's shell to all hosts. |
| verification record → future reader | `REQUIREMENTS.md` and the dossier are what a future phase, a reviewer or a pilot go/no-go decision will consult instead of re-reading 75 files. |
| flagged item → verdict | The moment a `flagged` item is written down as evidence, it stops being fail-closed. |

---

## Threat Register

| Threat ID | Plan | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|------|----------|-----------|----------|-------------|------------|--------|
| T-05-01 | 05-01 | Information disclosure | `GET /v1/communities/{id}` | high | mitigate | Three layers: `requireModule` → explicit `tenant_id` predicate in `getCommunity` → `communities_tenant_isolation` RLS policy. Proved by the `020-tenant-isolation.sql` case and the cross-tenant integration case, each with a positive control | closed |
| T-05-02 | 05-01 | Information disclosure | community id enumeration | medium | mitigate | One bare `404` with NO `details` for unknown, other-tenant and soft-deleted alike (D-23). Task 3 asserts the absent `details` key, not just the status | closed |
| T-05-03 | 05-01 | Elevation of privilege | `POST /v1/communities` | high | mitigate | `requirePermission('communities.community.manage')` written as a literal in the route middleware; composed once in `permissionsFor` so the bootstrap and the guard cannot disagree. A member receives 403 (asserted) | closed |
| T-05-04 | 05-01 | Denial of service | `GET /v1/communities?limit=…` | medium | mitigate | Server-side clamp to `COMMUNITY_MAX_PAGE_SIZE` plus the `limit + 1` over-fetch; asserted at `limit=100000` | closed |
| T-05-05 | 05-01 | Injection | the `cursor` query parameter | medium | mitigate | `decodeCursor` is total and schema-validated; a tampered cursor degrades to page 1 and never reaches SQL as text (asserted) | closed |
| T-05-06 | 05-01 | Information disclosure | `community.created` event payload | low | mitigate | Payload is `{ tenantId, communityId, actorUserId }` — ids only; the community name never reaches a log line (T-04-05) | closed |
| T-05-07 | 05-01 | Tampering | `community_members` born unused | low | accept | The table has RLS, a policy and an isolation case but no route writes it in V1; there is no V1 code path to abuse, and `010-rls-coverage.sql` fails the build if the policy is ever dropped | closed (aceita) |
| T-05-SC | 05-01 | Tampering | npm/pnpm installs | high | mitigate | This phase installs ZERO external packages (05-RESEARCH §Standard Stack, §Package Legitimacy Audit). `pnpm install` here only links two new workspace packages. A `pnpm add` in this plan is a defect, not a checkpoint | closed |
| T-05-08 | 05-02 | Tampering | `.planning/sketches/003-*/index.html` | low | mitigate | The file is self-contained with no external script or stylesheet reference (asserted), so opening it executes nothing fetched from the network | closed |
| T-05-09 | 05-02 | Information disclosure | mockup content | low | accept | The drawing carries invented placeholder copy and the tenant-brand picker's sample values only; it holds no real tenant data and no credential, and it lives in the repo alongside the rest of `.planning/` | closed (aceita) |
| T-05-10 | 05-02 | Tampering | amended catalog interpolations | medium | mitigate | `apps/web/i18n/messages.test.ts` pins every `{tenant}` placeholder, and `pnpm --filter @tria/web typecheck` fails on a call site that stops supplying the argument — a dropped interpolation cannot reach a member as a stray brace | closed |
| T-05-11 | 05-02 | Repudiation | design approval | low | mitigate | The approval is recorded in the sketch README frontmatter (`approved_by`, `approved_at`, `approval_kind`) and in the manifest's Winner column, the same audit trail sketches 001 and 002 carry | closed |
| T-05-SC | 05-02 | Tampering | npm/pnpm installs | high | mitigate | This plan installs nothing. 05-RESEARCH §Package Legitimacy Audit is intentionally empty; a `pnpm add` here is a defect | closed |
| T-05-12 | 05-03 | Tampering | `POST /v1/posts` `communityId` | high | mitigate | The target community is resolved INSIDE the same `withTenantTx` transaction before the insert, so a cross-tenant id cannot be written; the FK plus the tenant predicate plus RLS are the three layers. Asserted by the cross-tenant integration case | closed |
| T-05-13 | 05-03 | Information disclosure | community id enumeration through the composer | medium | mitigate | Unknown, other-tenant and soft-deleted community ids all answer a bare `404` with no `details`; only an archived community in THIS tenant gets a distinguishable `400 { community: 'archived' }`, which discloses nothing the member cannot already see on the community page | closed |
| T-05-14 | 05-03 | Information disclosure | the D-71 label leaking another tenant's community name | high | mitigate | The projection's left join is constrained by `c.tenant_id = p.tenant_id` as well as the id, so a mis-keyed row cannot surface a foreign name; the two-tenant isolation suite covers `communities` and the merged feed is read under RLS | closed |
| T-05-15 | 05-03 | Denial of service | the merged feed at volume | medium | mitigate | The new non-partial index makes the plan an index scan; `090-feed.sql` pins it with an `EXPLAIN` assertion on a volume fixture, and the query-budget test keeps the statement count bounded with a floor | closed |
| T-05-16 | 05-03 | Elevation of privilege | posting into a community | high | mitigate | `requirePermission('feed.post.create')` as a route literal, plus the archived/visibility validation in the service. The FAB's absence is UX only and is never the control | closed |
| T-05-17 | 05-03 | Tampering | moving a published post between communities | medium | mitigate | `communityId` exists on the create schema only; the edit path cannot write `community_id`, asserted by the behaviour case | closed |
| T-05-SC | 05-03 | Tampering | npm/pnpm installs | high | mitigate | No external package is added; the only dependency change is a `workspace:*` link between two first-party packages | closed |
| T-05-18 | 05-04 | Elevation of privilege | `PATCH /v1/communities/{id}` and the archive transition | high | mitigate | The literal `requirePermission('communities.community.manage')` on the route; the form's affordance is UX only. A member receives 403 (asserted) | closed |
| T-05-19 | 05-04 | Information disclosure | a cover asset id belonging to another tenant | high | mitigate | The asset id is validated as belonging to this tenant at write time, and `GET /v1/media/{assetId}/{variant}` re-checks at read time — the payload never carries a signed Storage URL | closed |
| T-05-20 | 05-04 | Information disclosure | community id enumeration on the page route | medium | mitigate | Unknown, other-tenant and soft-deleted ids render the identical not-found screen with no `details` (D-23 / UI-D-16) | closed |
| T-05-21 | 05-04 | Stored XSS | community name and description | high | mitigate | Plain text with render-time linkify in JSX; no raw-HTML injection API is used anywhere in the community surfaces. Canon OWASP coverage is `/gsd-secure-phase`'s, tracked here because the boundary is new | closed |
| T-05-22 | 05-04 | Tampering | the `post_count` / `last_activity_at` counters | medium | mitigate | Trigger-owned with no application writer; the pgTAP reconciliation assertion compares them to `count(*)` and the absence of a clamp is what lets drift surface | closed |
| T-05-23 | 05-04 | Elevation of privilege | the counter trigger's privileges | medium | mitigate | The function is NOT declared with elevated privileges and sets an empty `search_path` with fully-qualified names, so it cannot be hijacked by a schema shadowing attack and cannot write outside what the caller may already write | closed |
| T-05-24 | 05-04 | Denial of service | oversized cover upload | low | mitigate | `MEDIA_LIMITS.image.cover` mimes and byte cap enforced at `POST /v1/media/uploads` and re-validated server-side; bytes never transit Cloud Run | closed |
| T-05-SC | 05-04 | Tampering | npm/pnpm installs | high | mitigate | No external package is added | closed |
| T-05-25 | 05-05 | Elevation of privilege | `POST /v1/stories` | high | mitigate | The literal `requirePermission('stories.story.publish')` on the route, composed once in `permissionsFor`. The own-circle's visibility is read from the bootstrap's permission array and is UX only; a member receives 403 (asserted) | closed |
| T-05-26 | 05-05 | Tampering | publishing another tenant's media asset | high | mitigate | The asset is resolved inside the same `withTenantTx` transaction and must belong to this tenant and carry `purpose: 'story'`; a foreign id answers a bare 404. The broker re-checks tenancy at read time | closed |
| T-05-27 | 05-05 | Information disclosure | a signed Storage URL in a strip payload | high | mitigate | Thumbnails render through `GET /v1/media/{assetId}/{variant}`; a payload never carries a signed Storage URL, and the browser never talks to Supabase for data | closed |
| T-05-28 | 05-05 | Denial of service | oversized or over-long story media | medium | mitigate | `MEDIA_LIMITS` mimes and byte caps at the signing call and re-validated server-side; the duration cap is enforced by the worker after ingest and the asset plus the provider copy are destroyed on refusal | closed |
| T-05-29 | 05-05 | Information disclosure | story caption in a log line or event payload | medium | mitigate | `story.published` carries `{ tenantId, storyId, authorUserId, mediaKind, expiresAt }` — no caption, no media URL. The module's event handler logs shape only (T-04-05) | closed |
| T-05-30 | 05-05 | Information disclosure | story id enumeration | medium | mitigate | Unknown, other-tenant, soft-deleted and expired-but-unpinned ids all answer a bare 404 with no `details` | closed (aceita — AR-09) |
| T-05-31 | 05-05 | Denial of service | `GET /v1/stories?limit=…` | medium | mitigate | Server-side clamp plus the `limit + 1` over-fetch, and the budget test's ceiling and floor | closed |
| T-05-32 | 05-05 | Repudiation | a story silently vanishing after a rejected upload | low | mitigate | The rejection is surfaced on the admin's own screens with the media catalog's reason; the row is never deleted, so the audit trail of what was attempted survives | closed |
| T-05-SC | 05-05 | Tampering | npm/pnpm installs | high | mitigate | No external package is added. 05-RESEARCH explicitly rejects a third-party stories-viewer library and the audit table is intentionally empty; a `pnpm add` here is a defect | closed |
| T-05-33 | 05-06 | Tampering | `POST /v1/stories/{id}/likes` | high | mitigate | The insert SELECTS the story inside the tenant transaction rather than trusting the path parameter, so a cross-tenant id cannot produce a like row; the partial unique index makes a repeat a no-op instead of a 409 | closed |
| T-05-34 | 05-06 | Information disclosure | the playback token | high | mitigate | Minted per request when the viewer opens, never embedded in the strip payload, never cached and never logged (D-44). Asserted by the absence of caching on the token call | closed |
| T-05-35 | 05-06 | Information disclosure | story id enumeration through the deep link | medium | mitigate | Unknown, other-tenant, soft-deleted and not-visible ids render the identical not-found screen with no `details` | closed |
| T-05-36 | 05-06 | Stored XSS | the story caption on a full-screen surface | high | mitigate | Plain text with render-time linkify in JSX; no raw-HTML injection API anywhere in the viewer. Canon OWASP coverage belongs to `/gsd-secure-phase`; tracked here because the surface is new | closed |
| T-05-37 | 05-06 | Tampering | `stories.like_count` | medium | mitigate | Trigger-owned in the single existing counter function with no application writer and no lower clamp; reconciled against the rows in pgTAP | closed |
| T-05-38 | 05-06 | Denial of service | the frame loop | low | mitigate | One clock for the whole sequence, cancelled on cleanup and on unmount, and paused on document visibility change, so a backgrounded PWA burns neither a story nor a frame budget | closed |
| T-05-39 | 05-06 | Information disclosure | the media URL in a payload | high | mitigate | Images render through the broker route by asset id; a signed Storage URL never appears in a payload | closed |
| T-05-SC | 05-06 | Tampering | npm/pnpm installs | high | mitigate | No external package is added — 05-RESEARCH's "Deliberately NOT added" table explicitly rejects a third-party stories-viewer library, and a `pnpm add` in this plan is a defect | closed |
| T-05-40 | 05-07 | Tampering / elevation | a crafted reply to a story comment | high | mitigate | The three-column composite foreign key plus the null-guarded shape CHECK make the row unrepresentable; both the honest and the lying variants are asserted to fail with their exact SQLSTATEs, each beside a positive control | closed |
| T-05-41 | 05-07 | Tampering / elevation | a crafted like on a story comment | high | mitigate | The two-column composite foreign key plus its null-guarded CHECK; the null-discriminator bypass (Pitfall 2) is asserted to fail, because the foreign key alone is silently skipped when the discriminator is null | closed |
| T-05-42 | 05-07 | Tampering | the latent three-valued CHECK hole on `feed_comments` | high | mitigate | Every equality inside every branch is guarded by an explicit not-null test, and the probe that inserts today is asserted to fail after the migration, in both this file's battery and the Phase 4 acceptance file | closed |
| T-05-43 | 05-07 | Information disclosure | comment body in a log line or event payload | medium | mitigate | `story.commented` carries ids only; the module's handlers log shape only (T-04-19) | closed |
| T-05-44 | 05-07 | Stored XSS | a story comment body | high | mitigate | Plain text with render-time linkify; the shipped comment components are reused unchanged and no raw-HTML injection API is introduced | closed |
| T-05-45 | 05-07 | Information disclosure | commenting on another tenant's story | high | mitigate | The story is resolved inside the tenant transaction before the insert; a foreign id answers a bare 404, and the two-tenant isolation suite covers `stories` | closed |
| T-05-46 | 05-07 | Denial of service | data migration on live tables | medium | accept | Adding a stored generated column rewrites `feed_comments`; at pilot volume this is milliseconds, the research ran the whole sequence as a dry run against the real tables with their rows and rolled it back, and the header records what would need staging at scale | closed (aceita) |
| T-05-47 | 05-07 | Tampering | `stories.comment_count` | medium | mitigate | One counter function, extended rather than duplicated, trigger-owned with no lower clamp and reconciled against the rows in pgTAP | closed |
| T-05-SC | 05-07 | Tampering | npm/pnpm installs | high | mitigate | No external package is added | closed |
| T-05-48 | 05-08 | Elevation of privilege | the pin, unpin and delete routes | high | mitigate | The literal `requirePermission('stories.story.manage')` on each; the history's affordances are read from the bootstrap's permission array and are UX only. A member receives 403 (asserted) | closed |
| T-05-49 | 05-08 | Tampering | pinning a story to another tenant's community | high | mitigate | BOTH ids are resolved inside the same `withTenantTx` transaction before the insert, and the pin row carries its own `tenant_id` under RLS; the cross-tenant case is asserted in pgTAP and in the integration suite with positive controls | closed |
| T-05-50 | 05-08 | Information disclosure | a pinned expired story reachable by a member | medium | accept | This is the REQUIREMENT (STORY-04): a pin is a deliberate editorial act that extends visibility, and the admin's unpin is the control. The risk is a story staying visible longer than the admin remembers, which the history's pin indicator surfaces | closed (aceita) |
| T-05-51 | 05-08 | Information disclosure | community highlights leaking another tenant's story | high | mitigate | The join is constrained on the tenant id as well as the story id, both tables carry their isolation policy, and the two-tenant suite covers the pin table with a positive control | closed |
| T-05-52 | 05-08 | Repudiation | a story deleted while pinned | low | mitigate | The story is soft-deleted and the highlights read filters removed stories, so the pin rows remain as the record of where it had been while the content stops rendering everywhere at once | closed |
| T-05-53 | 05-08 | Denial of service | `GET /v1/stories/pinned` | medium | mitigate | Server-side limit clamp on the highlights read and one statement per page; the community-scoped index serves the ordering | closed |
| T-05-54 | 05-08 | Tampering | a half-applied pin batch | low | mitigate | There is no batch: each toggle is its own row and its own request, which is why there is no save button to imply atomicity the schema does not provide | closed |
| T-05-SC | 05-08 | Tampering | npm/pnpm installs | high | mitigate | No external package is added anywhere in Phase 5 | closed |
| T-05-40 | 05-09 | Information disclosure | `createCommunity` / `updateCommunity` cover write | critical | mitigate | The 23503-vs-201 split is a working cross-tenant existence oracle. Task 1 collapses foreign, unknown and soft-deleted onto ONE bare 404 with no `details`; Task 1's integration case asserts the two bodies equal by `JSON.stringify` (negative case) beside a same-tenant 201 (positive control). Task 3's copy fix does NOT reopen it: the wire answer stays byte-identical, and the BFF distinguishes the two 404s by re-reading a community the admin already has open — a question keyed on a community id they hold, never on an asset id, so it is not enumerable and reveals nothing about another tenant's media. | closed |
| T-05-41 | 05-09 | Tampering | `communities.cover_asset_id` | high | mitigate | A cross-tenant asset id persists today because the single-column FK's RI bypasses RLS. Task 1 resolves the asset inside the same `withTenantTx` before the write; Task 1's case asserts no row is written and the stored value does not move. | closed |
| T-05-42 | 05-09 | Elevation of privilege | the cover-asset read | high | mitigate | The lookup must not reach for an elevated lane to "see" the asset. It stays in the tenant lane: no `withAdminTx`, no `service_role`, no `app.tenant_id()` override — asserted by a source-level negative grep in Task 1's acceptance criteria. | closed |
| T-05-43 | 05-09 | Information disclosure | structured logs | medium | mitigate | A refused foreign asset id must not be copied into this tenant's log line. The refusal throws before both `log.info` calls, and both keep recording `hasCover` as a boolean; Task 1's action forbids adding the id. | closed |
| T-05-44 | 05-09 | Denial of service | the extra SELECT per write | low | accept | One indexed primary-key lookup per community write, on a path an admin exercises a handful of times per day. The cost is unmeasurable against the correctness it buys. | closed (aceita) |
| T-05-SC | 05-09 | Tampering | npm/pip/cargo installs | high | mitigate | No package install occurs in this plan (Task 1-3 add zero dependencies). `05-RESEARCH.md` records the phase as adding no npm packages and `COVERAGE.md` restates it. If an install is introduced, the package-legitimacy gate and a blocking human checkpoint apply before it runs. | closed |
| T-05-45 | 05-10 | Denial of service | `MediaImage` under `StoryViewer` | high | mitigate | The effect↔render loop exhausts the device's heap; the verifier reproduced a JavaScript heap OOM. Task 1 removes the caller's identities from the effect's dependency array AND stabilises the caller's handlers; the bounded-render assertion with its ceiling throw is the regression gate. Residual risk on a real device stays open as the verifier's human check 1. | closed |
| T-05-46 | 05-10 | Denial of service | `MediaImage` empty-ladder branch | high | mitigate | A pinned not-ready asset — reachable because `listCommunityHighlights` deliberately omits the readiness filter — leaves a full-screen modal permanently in `loading`, which is an availability failure of the phase's headline surface. Task 2 reports the failure so the error state with its reachable close renders. | closed |
| T-05-47 | 05-10 | Repudiation | the gesture stage | medium | mitigate | A tap that both acts and advances means the recorded interaction does not match what the member intended. Task 3 removes the two offending controls from the pointer subtree; three cases pin act-without-advance, act-without-advance, and advance-still-works. | closed |
| T-05-48 | 05-10 | Information disclosure | the media error copy | low | accept | The viewer's error copy is a fixed catalog sentence naming no asset, no tenant and no provider; `check-ui-literals.sh` keeps it in the catalog. No change needed. | closed (aceita) |
| T-05-SC | 05-10 | Tampering | npm/pip/cargo installs | high | mitigate | No package install occurs in this plan. `COVERAGE.md`'s reasoned declaration stands. If an install is introduced, the package-legitimacy gate and a blocking human checkpoint apply before it runs. | closed |
| T-05-49 | 05-11 | Information disclosure | `scripts/check-static-routes.sh` coverage gap | high | mitigate | Three shipped authenticated routes are outside the TENANT-02 gate, so a future edit making any of them static would pass CI and serve one tenant's branded shell to every host. Task 3 adds the three source keys; the gate's own "route moved or renamed" offender keeps them there. | closed |
| T-05-50 | 05-11 | Denial of service | `StoryVideo` listener attachment | high | mitigate | The viewer's video path is permanently stuck — no progress, no auto-advance — which is an availability failure of the phase's headline surface for one of its two media kinds. Task 1's mutation-observed attachment fixes it; Task 1 and Task 2 assert it over the real bridge with the late mount reproduced. | closed |
| T-05-51 | 05-11 | Information disclosure | the per-request playback token | medium | accept | Unchanged by this plan and already correct: the token is minted in the bridge's own closure, never cached, never written to a cookie, the router cache or a log line. The prohibition above keeps it stated; Task 2's refusal case proves a refusal surfaces as a media error rather than a provider string on screen. | closed (aceita) |
| T-05-52 | 05-11 | Tampering | the vendor stand-in in tests | low | accept | The stand-in exists only inside two test files and is never bundled. The production path keeps the real package. | closed (aceita) |
| T-05-SC | 05-11 | Tampering | npm/pip/cargo installs | high | mitigate | No package install occurs in this plan. `@mux/mux-player-react` is already a declared dependency of `apps/web`. `COVERAGE.md`'s reasoned declaration stands. If an install is introduced, the package-legitimacy gate and a blocking human checkpoint apply before it runs. | closed |
| T-05-53 | 05-12 | Repudiation | the dossier's verdict column | high | mitigate | A dossier that reads as a resolution launders 14 fail-closed items into a passing verdict, and the strongest of them guard tenant isolation and member consent. Task 1 requires an explicit sentence marking the column a proposal, requires every conversion to cite a file and a case that exists on disk, and routes all 23 items to a human through `<verify><human-check>` rather than closing any of them. | closed |
| T-05-54 | 05-12 | Tampering | `.planning/REQUIREMENTS.md` | medium | mitigate | Editing the traceability table from a stale reading would mark a requirement done while its gap is open. Task 1 reads the file first and edits only on a real disagreement, with a scoped edit and never a whole-file write; the nine-rows-not-complete check runs as an automated gate. | closed |
| T-05-55 | 05-12 | Tampering | the executed plans and summaries | high | mitigate | The gap-closure contract forbids modifying `05-01` … `05-08`. The prohibition-source count gate fails if any of those eight files no longer carries exactly 14 flagged statements, and an acceptance criterion requires none of them to appear in `git status`. | closed |
| T-05-SC | 05-12 | Tampering | npm/pip/cargo installs | high | mitigate | No package install occurs in this plan. `COVERAGE.md`'s reasoned declaration stands. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-05-07@05-01 | `community_members` nasce sem uso no V1 (schema pronto para V2). Nada escreve nele; política de RLS e casos de isolamento já existem | plano 05-01 | 2026-09-23 |
| AR-02 | T-05-09@05-02 | O sketch de design contém só texto de exemplo, nenhum dado real | plano 05-02 | 2026-09-23 |
| AR-03 | T-05-46@05-07 | Migração de dados em tabelas vivas: a reescrita de tabela, o dry run e a exigência de staging em escala estão registrados na própria migração | plano 05-07 | 2026-09-23 |
| AR-04 | T-05-50@05-08 | Story expirado e fixado continua acessível a membros — é o requisito STORY-04. O desfixar do admin é o controle | plano 05-08 | 2026-09-23 |
| AR-05 | T-05-44@05-09 | Um SELECT extra por escrita (lookup por chave primária) em troca de validar a capa | plano 05-09 | 2026-09-24 |
| AR-06 | T-05-48@05-10 | A mensagem de erro de mídia é texto de catálogo fixo, sem dado do asset | plano 05-10 | 2026-09-24 |
| AR-07 | T-05-51@05-11 | Token de playback por requisição cruza para o cliente; é o modelo de playback assinado do Mux e nunca é cacheado (ver T-05-34@05-06) | plano 05-11 | 2026-09-24 |
| AR-08 | T-05-52@05-11 | Substituto do player do fornecedor existe só em arquivos de teste; produção importa o pacote real | plano 05-11 | 2026-09-24 |
| AR-09 | T-05-30@05-05 | O plano prometia 404 para story expirado e não fixado. O código lê qualquer story não apagado do próprio tenant por id (`packages/modules/stories/server/service.ts:286-307`), por decisão explícita da 05-06 (o histórico do admin abre um story por id) e da 05-08 (pins tornam legítima a leitura de expirado). Alcance: só membros do **mesmo** tenant que tenham guardado o link; o 404 idêntico para id desconhecido, de outro tenant ou apagado continua valendo. Severidade média, abaixo do limiar de bloqueio | Igor Vilas Boas (usuário) | 2026-09-25 |

*Accepted risks do not resurface in future audit runs.*

---

## Residuais (não são ameaças abertas)

Registrados pelo auditor sem mudar o status de nenhuma ameaça:

- **R-1 — cursor robusto contra injeção, mas não contra formato** (T-05-05@05-01, T-05-31@05-05, T-05-53@05-08). O schema compartilhado em `packages/core/server/paging.ts` aceita qualquer string em `n`. Um cursor bem formado como `{v:1,n:"ana paula",id:<uuid válido>}` vai como parâmetro ligado e é convertido com `::timestamptz`; o Postgres levanta 22007 (confirmado no banco local) e a API responde **500** em vez de voltar para a página 1. Não é explorável como injeção. Correção: validar `n` como datetime ISO no schema do cursor.
- **R-2 — linkify** (T-05-21@05-04, T-05-36@05-06). Descrição de comunidade e legenda de story são texto puro, sem linkify, embora a mitigação cite linkify em tempo de render. Mais seguro, não mais fraco.
- **R-3 — janela da checagem de capa** (T-05-19@05-04). Quando a 05-04 foi entregue, o id de capa não era checado contra o tenant na escrita: a checagem de FK roda como dono da tabela e ignora RLS. A 05-09 fechou isso (T-05-40 e T-05-41@05-09).
- **R-4 — leitura por id sem filtro de prontidão.** `getStory` também não filtra por prontidão: membros leem por id stories em processamento ou recusados. Observação; não é ameaça do registro.
- **R-5 — rastreabilidade defasada.** `.planning/REQUIREMENTS.md` ainda mostra 16 linhas "Gaps Found", embora UAT e verificação tenham passado. Atraso de documentação, não problema de segurança.

## Unregistered Flags

- `apps/web/e2e/admin.ts:320-335` tem um helper de superusuário que apaga stories por prefixo de legenda. Não coberto por nenhum Threat ID. Só de teste: nenhum código do app o importa. Informativo.
- A 05-12-SUMMARY não tem seção `## Threat Flags`.

---

## Evidência da verificação

Produzida por `gsd-security-auditor` em 2026-09-25 (123 leituras/buscas, nenhum arquivo de implementação modificado). Afirmações de SUMMARY foram usadas só como ponteiros, nunca como evidência.

**Legenda de caminhos** (relativos à raiz do repositório):
CR `packages/modules/communities/server/routes.ts` · CS `packages/modules/communities/server/service.ts` · CC `packages/modules/communities/contracts/index.ts` · SR `packages/modules/stories/server/routes.ts` · SS `packages/modules/stories/server/service.ts` · SC `packages/modules/stories/contracts/index.ts` · SV `packages/modules/stories/ui/StoryViewer.tsx` · FS `packages/modules/feed/server/service.ts` · FR `packages/modules/feed/server/routes.ts` · FC `packages/modules/feed/contracts/index.ts` · MIG `supabase/migrations/` · T020 `supabase/tests/020-tenant-isolation.sql` · T090 `supabase/tests/090-feed.sql` · T110 `supabase/tests/110-communities-stories.sql` · IT `apps/api/tests/integration/` · MEDIA `packages/core/server/media/` · WEB `apps/web/`

| Threat ID | Plan | Evidência |
|---|---|---|
| T-05-01 | 05-01 | CR:53 `requireAuth, requireModule('communities')`. CS:188 predicado `c.tenant_id`. MIG `20260923171503_communities.sql:41` política `communities_tenant_isolation`. T020:395-431. IT communities #7, #8 (controle positivo lab) |
| T-05-02 | 05-01 | CS:195 404 puro. `core/server/http/api-error.ts:50` só emite `details` quando definido. IT communities #8 (sem `details`), #9 (corpos de id desconhecido e estrangeiro idênticos byte a byte) |
| T-05-03 | 05-01 | Literal em CR:93. `apps/api/src/modules/registry.ts:91` `permissionsFor`, resolvedor único do guard e do bootstrap. `module.ts` concede só a admin_tenant. IT communities #12: membro recebe 403 |
| T-05-04 | 05-01 | CC:79-89 limita `limit` a 1..25 (com `.catch`). CS:143 busca `limit+1`. IT communities #4 (0, 100000, "abc") |
| T-05-05 | 05-01 | `core/server/paging.ts:84-94` `decodeCursor` total e validado por schema. CC:81 cursor até 512 caracteres. CS:139-140 parâmetros ligados. IT communities #5. Ver residual R-1 |
| T-05-06 | 05-01 | CS:378-382 e CC:211-241 só ids. Logs CS:392-394 e CS:586-590 registram só comprimentos e flags. IT communities #26 |
| T-05-07 | 05-01 | **accept** — nada escreve em `community_members` (só um comentário em CC:64). Política em MIG `communities.sql:42`, isolamento em T020:532-570 |
| T-05-SC | 05-01..05-12 | `pnpm-lock.yaml` mudou só nos commits 7e3b2c4, e29c1e8, 2d327a0, todos sob `importers:` (links de workspace e specifiers de versões já presentes). Nenhuma linha `resolution`/`integrity` adicionada na fase. 05-11: `@mux/mux-player-react` 3.13.4 já estava em `WEB/package.json` antes da fase (7e3b2c4^) |
| T-05-08 | 05-02 | `.planning/sketches/003-phase-05-designed-screens/index.html`: um `<script>` inline (:1150), nenhum `src`/`href` externo |
| T-05-09 | 05-02 | **accept** — o sketch só tem texto de exemplo; busca por credenciais só casa com a palavra "tokens" do design |
| T-05-10 | 05-02 | `WEB/i18n/messages.test.ts:138-146` fixa `{tenant}` em seis chaves |
| T-05-11 | 05-02 | `README.md:23-25` do sketch com `approved_by`, `approved_at`, `approval_kind`. `.planning/sketches/MANIFEST.md:31` coluna Winner |
| T-05-12 | 05-03 | FS:699 resolve a comunidade no mesmo `withTenantTx`, antes do insert. FS:638-653 predicado de tenant. `feed_posts_community_fk` em MIG `20260923185730`. IT feed #17 (id do lab → 404) |
| T-05-13 | 05-03 | FS:650 404 puro; FS:651-653 400 de arquivada. IT feed #17 (sem `details`, corpos idênticos) |
| T-05-14 | 05-03 | FS:162-163 join em `c.tenant_id = p.tenant_id`, leitura dentro de `withTenantTx` (FS:277). IT feed #14 |
| T-05-15 | 05-03 | T090:515-526 exige `feed_posts_tenant_created_all_idx` pelo nome e nunca Seq Scan no fixture de volume. `feed-query-budget.test.ts:206-224` teto e piso |
| T-05-16 | 05-03 | FR:125 literal. FS:651 checagem de arquivada. IT feed #6: membro recebe 403 |
| T-05-17 | 05-03 | FC:357-366 `updatePostSchema` `.strict()` sem `communityId`. A lista `set` em FS:945-953 não nomeia `community_id`. IT feed #18 |
| T-05-18 | 05-04 | CR:128 literal. IT communities #19: membro recebe 403 |
| T-05-19 | 05-04 | Escrita: CS:278-314 `resolveCoverAsset`/`loadCoverAsset` com predicado de tenant (desde a 05-09, ver residual R-3). Leitura: MEDIA `service.ts:622-642` monta a chave pelo tenant do chamador. O payload carrega id e escada de variantes, nunca URL (CC:111-125) |
| T-05-20 | 05-04 | `WEB/app/(app)/comunidades/[communityId]/not-found.tsx` sem props; `page.tsx:97` e `editar/page.tsx:39` chamam `notFound()`; `WEB/lib/communities.ts:144` trata 400 e 404 igual. IT communities #20 |
| T-05-21 | 05-04 | `CommunityHeader.tsx:109-115` e `CommunityCard.tsx:59-76` renderizam texto JSX; nenhum `dangerouslySetInnerHTML`/`innerHTML`/`__html` nas superfícies novas (só um teste lê `innerHTML`). Ver residual R-2 |
| T-05-22 | 05-04 | MIG `20260923204828_communities_counters.sql:51-99`: trigger é o único escritor, sem clamp. T110:180-196 reconcilia todas as comunidades |
| T-05-23 | 05-04 | MIG `communities_counters.sql:52` `language plpgsql set search_path = ''`, sem `security definer`, nomes qualificados `public.` |
| T-05-24 | 05-04 | `packages/contracts/src/media.ts:85` limite de capa. MEDIA `service.ts:347-360` (início) e :553-558 (conclusão). `CommunityForm.tsx:115-117` usa `useSignedUpload` |
| T-05-25 | 05-05 | SR:159 literal; `module.ts` concede só a admin_tenant. IT stories #10: membro recebe 403 |
| T-05-26 | 05-05 | SS:344-357 resolve o asset na transação, com predicado de tenant, antes do insert. IT stories #11, #12 |
| T-05-27 | 05-05 | SC:118-150 `storySummarySchema` `.strict()` sem campo de URL. `packages/core/ui/MediaImage.tsx:93-96` monta `/v1/media/{assetId}/{variant}` |
| T-05-28 | 05-05 | `media.ts:88,92` limites de story, aplicados em MEDIA `service.ts:347-360` e :553-558. MEDIA `video/event-job.ts:110-131` aplica o teto de duração: apaga o asset no provedor e marca a linha como recusada. IT stories #15, #16 |
| T-05-29 | 05-05 | SC:229-235 payload; SS:379-385 emissão; SS:397 loga só `captionLength`. IT stories #29 |
| T-05-30 | 05-05 | **Aberta na auditoria, aceita pelo usuário (AR-09).** Parte cumprida: id desconhecido, de outro tenant e apagado → 404 idêntico (SS:305; IT stories #9, #18). Parte não cumprida por decisão de design: SS:286-307 `getStory` lê story expirado por id sem checar pin; IT stories #3 afirma 200 para membro |
| T-05-31 | 05-05 | SC:85-95 clamp. SS:213 `limit+1`. IT stories #7, #8. `feed-query-budget.test.ts:278-303`. Ver residual R-1 |
| T-05-32 | 05-05 | SS:249-266 histórico mantém stories em processamento e recusados. `WEB/lib/story-view.ts:215-229` pílula Recusado com motivo. O worker nunca apaga a linha do story. IT stories #15 |
| T-05-33 | 05-06 | SS:479-484 insert-select de `stories` dentro de `withTenantTx` (RLS em MIG `stories.sql:73`). `feed_likes_story_uq` (MIG `20260922162440:47`) + `on conflict do nothing`. IT stories #23, #28. Sem predicado `s.tenant_id` explícito; a camada de tenant aqui é a RLS |
| T-05-34 | 05-06 | `WEB/components/stories/StoryVideo.tsx:26-29` token só em estado do componente. `WEB/app/(app)/configuracoes/midia/actions.ts:75-95` sem cache, loga só `String(error)`. `apps/api/src/routes/media.ts:166` `no-store` |
| T-05-35 | 05-06 | `WEB/app/(app)/stories/[storyId]/page.tsx:65` `notFound()`. `WEB/lib/stories.ts:173-185` trata 404 e 400 igual |
| T-05-36 | 05-06 | SV:644-656 legenda como texto JSX, sem sink de HTML bruto. Ver residual R-2 |
| T-05-37 | 05-06 | MIG `20260923234657_story_like_counters.sql:35-58` função única de contador, sem clamp. T110:413-472 reconciliação |
| T-05-38 | 05-06 | `ui/useStoryClock.ts:117-144` cancela o frame no cleanup. SV:254-264 escuta `visibilitychange`; SV:211 pausa quando oculto |
| T-05-39 | 05-06 | `WEB/components/stories/StoryViewerHost.tsx:179-186` usa `MediaImage` por asset id |
| T-05-40 | 05-07 | MIG `20260924005427_story_comment_rules.sql:91` FK composta e :95-99 CHECK com guarda. T110 #31 (23514), #32 (23503), #33 controle positivo. IT stories #33, #34 |
| T-05-41 | 05-07 | MIG :92 e :100-102. T110 #37, #38, #39 (discriminador nulo), #40-41 controles positivos. IT stories #35, #36 |
| T-05-42 | 05-07 | MIG :95-99 guarda cada igualdade com `is not null`. A sonda é exigida falhar em T110 #36 e T090:105-113 |
| T-05-43 | 05-07 | SC:431-438 payload só com ids; SS:815-821 emissão; SS:831 loga `bodyLength`. IT stories #41 |
| T-05-44 | 05-07 | `StoryViewerHost.tsx:4-9,228` reusa o `CommentSheet` do feed. `packages/modules/feed/ui/CommentItem.tsx:138` `linkify` só http/https |
| T-05-45 | 05-07 | SS:773-802 insert-select com `s.tenant_id`. SS:702-706 resolve o story primeiro. IT stories #39 |
| T-05-46 | 05-07 | **accept** — MIG `story_comment_rules.sql:59-64` registra a reescrita de tabela, o dry run e o que staging em escala exigiria |
| T-05-47 | 05-07 | MIG :130-167 função única, sem clamp. T110:628-663 |
| T-05-48 | 05-08 | Literais em SR:103, :185, :352, :367, :381. IT stories (pins) #17, #32 |
| T-05-49 | 05-08 | SS:912-935 resolve os dois ids com predicado de tenant; SS:979-986 insere a partir da linha resolvida. MIG `20260924022607_story_community_pins.sql:56` política. T020:512-521 (42501). IT `isolation.test.ts` b4: 3 cruzamentos × PUT/DELETE + controle positivo |
| T-05-50 | 05-08 | **accept** — SS:1106-1135 sem predicado de expiração (é o requisito STORY-04); rota de desfixar em SR:363-375 |
| T-05-51 | 05-08 | SS:1123-1127 join em `p.tenant_id = s.tenant_id` e `p.tenant_id = ctx.tenantId`. T020:500-511. Metade de leitura do b4 |
| T-05-52 | 05-08 | SS:416-431 soft delete; SS:1128 filtro. T110 #58. IT stories #35 |
| T-05-53 | 05-08 | SC:511-522 clamp; SS:1116-1135 uma instrução; MIG pins:55 índice. IT stories #36 |
| T-05-54 | 05-08 | SR:348-375 um par por requisição. `ui/PinStorySheet.tsx:8-13,147` dispara por toggle, sem botão de salvar |
| T-05-40 | 05-09 | CS:278-291 `resolveCoverAsset` um único 404 puro; CS:301-314 lookup com predicado de tenant. IT `isolation.test.ts` b5: corpos estrangeiro e desconhecido comparados por `JSON.stringify` (menos `requestId`), sem `details`, sem nomes de tenant, controle positivo 201. `WEB/app/(app)/comunidades/actions.ts:235-245` distingue os dois 404 só relendo a comunidade pelo próprio id; a resposta da API não muda |
| T-05-41 | 05-09 | CS:421 é a primeira instrução da transação de insert; CS:521-525 cobre update. b5 afirma que a capa gravada não mudou e que zero linhas apontam para o asset do lab |
| T-05-42 | 05-09 | CS:1 importa só `withTenantTx`. Busca por `withAdminTx`/`service_role`/`app.tenant_id()` nos servidores de módulo só acha comentários. `biome.json:46-55` bloqueia o import de `admin-tx` |
| T-05-43 | 05-09 | CS:287 lança antes de qualquer log. CS:394 e :590 logam `hasCover` como booleano |
| T-05-44 | 05-09 | **accept** — CS:306-312 é um único lookup por chave primária |
| T-05-45 | 05-10 | `MediaImage.tsx:84-87` lê callbacks por refs; :133 deps `[assetId, src]`. SV:322-346 memoiza o mapa de handlers sobre `[items]`. `tests/story-viewer-media.test.tsx:32-47` teto com throw, casos 1-3 |
| T-05-46 | 05-10 | `MediaImage.tsx:119-123` reporta falha com escada vazia. SV:587-601 estado de erro. `story-viewer-media.test.tsx` caso 4 (:287) |
| T-05-47 | 05-10 | SV:480-484 palco; SV:543-601 badge e retry fora do palco. `story-viewer.test.tsx` 12a, 12b, 12c. Metade de hit-testing confirmada em navegador real pela UAT (teste 3) |
| T-05-48 | 05-10 | **accept** — SV:590 renderiza `labels.mediaError` da chave de catálogo `viewer.errors.media` (`WEB/lib/story-view.ts:108`) |
| T-05-49 | 05-11 | `scripts/check-static-routes.sh:66-69,73-75` (adicionado em aeaaf19) e o ofensor "moved or renamed" em :100 |
| T-05-50 | 05-11 | `StoryVideo.tsx:146-176` anexa listeners via `MutationObserver`. `StoryVideo.test.tsx` #1 (montagem tardia), #5. `StoryViewerHost.test.tsx` #13 |
| T-05-51 | 05-11 | **accept** — mesmo comportamento da T-05-34@05-06. `StoryVideo.test.tsx` #6: token recusado aparece como erro de mídia |
| T-05-52 | 05-11 | **accept** — o substituto só existe em `StoryVideo.test.tsx` e `StoryViewerHost.test.tsx`; o `StoryVideo.tsx:13` de produção importa o pacote real |
| T-05-53 | 05-12 | `05-VERIFICATION-DEBT.md:92` declara a coluna de veredito como proposta; contagens 14/5/4; casos citados existem (`core/tests/media-image.test.tsx:134,148`, `story-viewer-media.test.tsx:287`, `story-viewer.test.tsx` 12a-12c); `05-UAT.md` item 11 mandou os 22 itens sinalizados para um humano |
| T-05-54 | 05-12 | Os commits da 05-12 (a3d30ce, 6198fd3, 810a7a5) não tocam `REQUIREMENTS.md`; em 810a7a5 havia 14 linhas "Gaps Found", atendendo o piso de 9 |
| T-05-55 | 05-12 | O portão, re-executado, imprime `PROHIBITION_SOURCE_COUNT_OK` (14). O último commit em `05-0[1-8]-{PLAN,SUMMARY}.md` é 6680f19, anterior ao planejamento do gap closure (c457c1e); `git status` não mostra nenhum deles modificado |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-25 | 82 | 81 | 1 (T-05-30@05-05, medium, não bloqueante) | gsd-security-auditor |
| 2026-09-25 | 82 | 82 | 0 | usuário aceitou T-05-30@05-05 como AR-09 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-25
