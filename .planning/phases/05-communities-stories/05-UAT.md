---
status: complete
phase: 05-communities-stories
source: [05-VERIFICATION.md]
started: 2026-09-24T15:40:00Z
updated: 2026-09-25T02:25:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Publish a VIDEO story as `admin_tenant`, wait for it to become ready, then open it from the `/inicio` strip and watch it end to end
expected: The segment fills from the video's own time and auto-advances (or closes) when the video ends
why_human: H-05-02 / WINDOWS entry 42, still OPEN. The local video provider is `fake` with no HLS stream (console shows `[mux-player] The playback-token provided is invalid or malformed` for every seeded video) and the seed fixture is image-only, so no e2e can assert over a player that cannot play.
result: pass
previously: "blocked (third-party) on 2026-09-24 — VIDEO_PROVIDER=fake, no HLS stream"
unblocked_by: "Mux Development environment wired into the local stack on 2026-09-24/25 (VIDEO_PROVIDER=mux, five MUX_* values, cloudflared quick tunnel -> API webhook, worker on ROLE=worker PORT=8788)"
evidence: |
  Real ingest proven in the database before the tester answered: media_assets e75468f9-c01d-493c-94f5-40fbf34f45be
  and 4111fa06-ebc0-443b-adc8-0857cbca524d reached status=ready with real Mux playback ids and duration 4 s;
  media_provider_events holds the full real delivery chain (video.upload.created, video.upload.asset_created,
  video.asset.created, video.asset.ready). The tester then opened a real-Mux video story from the /inicio strip,
  watched it to the end and reported it working ("abri vi e funcionou"), having been told beforehand the two
  things to watch: the segment filling at the video's own pace, and the auto-advance (or close) at its end.
caveat: "Non-production Mux assets are TEST assets (watermarked, capped at 10 s). Verified on a 4 s clip on desktop Chrome. Real iOS Safari / Android Chrome playback remains the separate DEPLOY.md Phase 01.1 runbook item 7(b), not claimed here."

### 2. Open the story viewer on a phone (or a mobile emulation profile) on a story whose image is already decoded, and watch CPU and memory for 30 s
expected: The bar fills smoothly and the tab stays idle between frames
why_human: H-05-01's open half. 05-10's render-count ceiling (throws at 400, settles at ~8) is an automated BOUND, not a render-RATE profile on a real decoder.
result: pass

### 3. In the viewer, tap the story error COPY (not the retry button) on a failed story
expected: The tap falls through the `pointer-events-none` container to the stage and advances the story
why_human: happy-dom does not hit-test, so `pointer-events-none` has no effect on synthetic dispatch (05-10 deviation 3, coverage D6 `deferred`). `apps/web/e2e/stories.spec.ts` contains ZERO references to the badge, the media-error container or the retry control — quick-260924-fwv deleted the comments that falsely claimed it did, which is not the same as adding coverage.
result: pass
note: "Reached the error state on the SEEDED VIDEO story rather than by blocking an image request — the fake Mux provider fails the manifest on its own, which sets `mediaState = 'error'` and renders the same overlay. The hit-test half asserted by no automated test is therefore confirmed in a real browser: the tap on the copy fell through to the stage. See gap G-05-OBS-01 for a defect observed on the same screen that is NOT part of this test's assertion."


### 4. As `admin_tenant`, open a community whose cover asset was retired, rename it, and read the pt-BR refusal sentence "Não foi possível usar esta imagem de capa. Escolha outra." in the CommunityForm alert card on a 320px phone viewport. Then pick another cover (or clear it) and save again
expected: The sentence reads naturally, fits the alert card as UI-SPEC error/E13 designs it, and the recourse (choose another cover, or clear it) is obvious and works
why_human: 05-09 coverage D6, `human_judgment: true` — tone and placement are editorial. This is the surface of the DEVELOPER-ACCEPTED residual behaviour (the shipped form always submits `coverAssetId`, so a rename that re-asserts a retired id still gets `cover_invalid`). The mechanism is accepted; judge only whether the copy makes the recourse clear.
result: pass

### 5. As `admin_tenant`, archive (and then reactivate) a community whose cover asset was retired through the media library, on the real admin screen
expected: Both writes succeed, no "Comunidade não encontrada" appears, and the card falls back to the brand gradient
why_human: Mechanism is covered by integration case 33, which the verifier ran green — this is the product-surface confirmation of the previously failed gap. A confirmation, not an open defect.
result: pass
note: "Precondition was NOT satisfied at first: `media_assets` held 0 retired rows out of 25, and the community's cover was a live file the tester had uploaded during test 4. The tester retired that cover through /configuracoes/midia first, so the archive+reactivate pair did run against a dangling cover as the test intends. Community exercised: 0d000000-0000-4000-8000-0000000000c1 (\"Avisos da diretoria renomeado\", tria-demo)."


### 6. Backstop B-05-01 (05-04): a 60-character community name at 24/700 on a 320px viewport
expected: Wraps to at most three lines without clipping the cover above it
why_human: Declared `verification: backstop`, abstain reason `insufficient_spec` — no automated evidence anywhere in the phase.
result: pass
note: "Fixture confirmed present rather than assumed: the seed carries \"Grupo de trabalho de comunicacao interna e eventos do ano 26\" in BOTH tenants, measured at exactly 60 characters — so the backstop was judged against a real 60-char name, not a shorter one passing vacuously."


### 7. Backstop B-05-02 (05-05): a 40-character tenant display name on /inicio above the strip
expected: The strip carries no tenant string; the welcome heading above it absorbs the length as Phase 2 pinned it
why_human: Declared `verification: backstop`, reason `insufficient_spec`; the second half inherits a Phase 2 backstop that is itself unverified.
result: pass
partial: true
note: "PASS COVERS THE PHASE-5 HALF ONLY. Measured against the live DB: no tenant carries a 40-character display_name — `tria-demo` is 9 chars and `tria-lab` is 8. (a) 'the strip carries no tenant string' is a STRUCTURAL property, true at any length, and is genuinely discharged by this observation — it is also the half Phase 5 owns. (b) 'the welcome heading absorbs the length' is NOT exercised: it needs a 40-char tenant name that does not exist in this environment, and it is the half the entry already marks as inherited from an unverified Phase 2 backstop. Exercising (b) requires renaming a tenant to 40 characters through the platform panel."


### 8. Backstop B-05-03 (05-06): a 25-story sequence at 320px
expected: Every progress segment stays at least 2px wide and the bar row does not wrap
why_human: Declared `verification: backstop`, reason `insufficient_spec`. NOTE: `stories.spec.ts:552` asserts exactly this at 320px for `STORY_PAGE_SIZE` stories and ran green — but `STORY_PAGE_SIZE` is 10, not 25, and the strip shows one page, so 25 is not a reachable state. A human may judge the claim discharged at the reachable maximum.
result: pass
judged_at: reachable_max
note: "Discharged at the REACHABLE MAXIMUM of 10, not at the 25 the backstop names. `STORY_PAGE_SIZE = 10` is confirmed at packages/modules/stories/contracts/index.ts:17 and the strip renders one page, so a 25-segment bar row cannot occur in the shipped product. The tester was told this before answering. The 25-story wording of B-05-03 is therefore unsatisfiable as written and should be restated against STORY_PAGE_SIZE rather than left as a standing unverified claim."


### 9. Backstop B-05-04 (05-08): a 90-character story caption and a 40-character community name in one history row at 320px
expected: Both truncate with a title attribute while the row keeps its minimum height
why_human: Declared `verification: backstop`, reason `insufficient_spec`.
result: pass
note: "Both fixtures exceed the backstop's thresholds, so neither half passed vacuously: the longest seeded story caption measures 189 characters (\"Encerramento do encontro de sabado...\") against the 90 the backstop names, and the longest seeded community name measures 60 characters against the 40 it names. Truncation was judged under harder input than specified."


### 10. Backstop B-05-05 (05-08): twelve communities with 40-character names in the pin sheet
expected: Each truncates while the switch stays fully reachable inside the 80%-height sheet
why_human: Declared `verification: backstop`, reason `insufficient_spec`.
result: pass
judged_at: reachable_max
note: "Discharged at the REACHABLE MAXIMUM of 4, not the 12 the backstop names: the live DB holds 4 active communities per tenant, so a 12-row pin sheet cannot occur in this environment. The 40-character name half IS exercised — the longest seeded name is 60 characters. Tester's own framing on answering: 'tudo isso é micro usabilidade, pode passar' — a deliberate decision to discharge the layout backstops (tests 6-10) as a group, recorded here as the basis for this pass. Like B-05-03, B-05-05's row count is unsatisfiable as written in a seeded environment and should be restated against a reachable fixture."


### 11. Resolve the 22 flagged prohibitions — the 14 carried from 05-01..05-08 (P-05-01..P-05-14) and the 8 that gap closure added (N-05-01..N-05-08). `05-VERIFICATION-DEBT.md` sections 2 and 4 carry the evidence beside each
expected: Each must-NOT is judged still honoured by the shipped code
why_human: All 22 carry `status: unverified` with `verification: flagged`. They fail closed and need explicit human resolution. The dossier reads each one but resolves none, by its own governing rule.
result: pass
evidence_gathered_this_session: |
  Not a bare reading — the orchestrator executed the dossier's own named confirmations before the
  tester answered, and NONE of the 22 was contradicted.

  EXECUTED (pgTAP, `pnpm supabase test db`): 12 files, 285 tests, all green, Result: PASS.
  Discharges P-05-11 (the dossier's own "a human can confirm cheaply by running supabase test db")
  and backs P-05-05 (090-feed.sql EXPLAIN, Seq Scan negative), P-05-06 (110 archive cases) and
  P-05-09 (expiry retention under a transaction-controlled clock).
  NOTE: `npx supabase test db` FAILS with LegacyDbConfigLoadError because config.toml reads
  `env(SEND_EMAIL_HOOK_SECRETS)`; the suite must be run through the project wrapper
  (`pnpm supabase test db` -> scripts/supabase.sh), which exports it. Recorded so the next reader
  does not conclude the suite is broken.

  MECHANICAL (grep over shipped code):
  - P-05-01: zero owner/author elements in CommunityCard.tsx and CommunityHeader.tsx; the only
    matches are docblocks stating the rule.
  - P-05-04: `suppressCommunity` is SET in exactly one place — CommunityPosts.tsx:28, the
    community's own page; PostCard.tsx:207 and FeedList.tsx:477 are prop pass-through.
  - P-05-07: zero delete routes in packages/modules/communities/server/routes.ts AND zero in
    apps/web/app/(app)/comunidades/actions.ts (the web-layer half the dossier asked for).
  - P-05-08: zero localStorage/sessionStorage/indexedDB/seen/viewed in StoryViewerHost.tsx and
    StoryViewer.tsx.
  - P-05-13: revert-in-place per row confirmed at PinStorySheet.tsx:150-158; no Salvar/submit.

  CLOSED BY THIS UAT SESSION: P-05-10's one named hole. The dossier said "a human confirming this
  row should tap the error copy as well as the two controls" — that is test 3, performed in a real
  browser, passed.
residual: |
  NINE remain a reading of the code only: P-05-02, P-05-03, P-05-12, P-05-14, N-05-01, N-05-02,
  N-05-03, N-05-06, N-05-08.
  P-05-03 is the weak one and is ACCEPTED WITHOUT ITS DIFF: the dossier itself calls it "the
  weakest evidence in this table" (3 of 60 token literals traced). The orchestrator offered to diff
  the sketch's `:root` against tokens.css before the tester answered; the tester passed without it.
  If a mockup introduced a new spacing, size, weight or colour value, this UAT did not catch it.
result_basis: "Tester answered pass with the evidence table and the P-05-03 caveat in front of them."


### 12. Judge prohibition N-05-02 ("A refused cover must never be silently dropped, nulled or substituted so the write can proceed") against the CR-01 self-heal specifically
expected: A human decides whether nulling a DANGLING STORED cover on a request that asserted nothing about a cover is inside or outside that must-NOT
why_human: NEW this round, and the only prohibition whose subject matter the fix actually moved. The literal case is intact — a request that SENDS an unusable id is still refused with the bare 404 (`service.ts:522`) — and only a reference the community's own admin already retired is dropped. But the admin is not told, and N-05-02's sentence is about silence. Belongs to the same human resolving the other 22.
result: pass
ruling: "The tester ruled the CR-01 self-heal INSIDE N-05-02 — nulling a dangling STORED cover on a request that asserted nothing about a cover does not violate the must-NOT."
basis: |
  Ruled with firsthand experience of the mechanism, not in the abstract: test 5 exercised exactly
  this path (the tester retired the cover through /configuracoes/midia, then reactivated the
  community; the self-heal dropped the dangling reference and the write succeeded).
  Both sides were put to the tester before the ruling:
  - INSIDE — the admin asserted nothing about a cover, so there was no refusal to surface; without
    the drop the row is bricked, every later write 404s forever and the BFF reports "Comunidade não
    encontrada" about a community open on the admin's screen. That is the test 5 gap.
  - OUTSIDE — N-05-02's sentence is about SILENCE, and the admin is not told the cover was dropped.
  Code as ruled on: packages/modules/communities/server/service.ts:521-525. The literal case stays
  refused (an explicitly SENT unusable id still gets the bare 404), and the self-heal is bounded by
  `changedContent` to a one-time repair.
residual: "The admin is still not told when a dangling cover is dropped. The ruling accepts that silence; it does not deny it."


## Summary

total: 12
passed: 12
issues: 1
pending: 0
skipped: 0
blocked: 0

## Deferred Follow-Ups

- test: 5
  idea: "deu certo. Mas seria interessante conseguir ver as que foram arquivadas com uma tag pra pessoa conseguir entrar sem ter que decorar um id ne"
  deferred_at: 2026-09-24
  decision: "Tester chose to KEEP this as a follow-up rather than promote it to a Phase 5 gap, with the reachability evidence below in front of them. It therefore generates no fix plan this round."
  decided_at: 2026-09-24
  orchestrator_note: "Demonstrated in session, not hypothetical: archive has NO reverse path reachable from the UI. `listCommunities` filters `status = 'active'` (packages/modules/communities/server/service.ts:137) so an archived community leaves /comunidades entirely, and the only reactivate control lives at the bottom of that same community's edit form (apps/web/app/(app)/comunidades/CommunityForm.tsx:458-470) — a route the admin can only reach by already knowing the UUID. The tester could not complete test 5 unaided; the id came from a direct Postgres query. Suggested shape (the tester's): keep archived communities in the list behind an `Arquivada` tag/filter. Recorded as a follow-up per the tester's own framing; promote to a gap on request."

## Gaps

- gap_id: G-05-OBS-01
  truth: "A story whose media fails shows ONE legible error message with its recourse"
  status: failed
  reason: "Observed by the orchestrator in the tester's screenshot while setting up test 3, NOT reported as a test failure — test 3's own assertion passed. On the seeded VIDEO story the viewer stacks TWO error layers on the same centre point, overlapping into illegibility: the app's own pt-BR overlay (`Não foi possível carregar este story.` + `Tentar novamente`, StoryViewer.tsx:580-602) and mux-player's built-in English dialog (`Video URL is formatted incorrectly`). Neither sentence can be read. Reachability is NOT confined to VIDEO_PROVIDER=fake: mux-player renders its own dialog whenever playback fails, and our overlay renders whenever `onError` sets `mediaState = 'error'` (StoryViewer.tsx:327) — a real Mux asset that fails in production would stack the same two layers."
  severity: minor
  test: 3
  incidental: true
  artifacts: []
  missing: []
  deferred: true
  deferred_at: 2026-09-24
  deferred_by: tester
  deferred_rationale: |
    Deliberately NOT routed to diagnosis or gap planning this round. Two reasons, both stated to the
    tester before the choice: (1) the defect is only reachable when the player itself errors, and the
    only error available in this environment is the fake provider's own invalid token — the real
    shape of the bug under a live Mux asset is unknown; (2) phase 05 cannot transition regardless,
    because test 1 is blocked on that same absent provider. Bundling the two means one look instead
    of two.
    REVISIT CONDITION: when VIDEO_PROVIDER flips to `mux` (docs/DEPLOY.md:177-192) and test 1 becomes
    runnable, re-check whether a genuinely failing Mux asset still stacks mux-player's own dialog on
    top of the app's pt-BR overlay. If it does, this is a real product defect and not a fake-provider
    artifact.
    NOTE ON STATUS: left as `failed` rather than rewritten, so the finding is not laundered into
    something already handled. `deferred: true` is what keeps it out of this round's gap closure.
