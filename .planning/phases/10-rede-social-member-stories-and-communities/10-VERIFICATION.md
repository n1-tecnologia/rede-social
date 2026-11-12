---
phase: 10-rede-social-member-stories-and-communities
verified: 2026-11-12T19:00:00Z
status: passed
score: 5/5 truths verified (4 roadmap criteria + D-711 amendment); 28/28 requirement ids satisfied (MPUB-04 closed)
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-01-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-01-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-02-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-02-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-03-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-03-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-04-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-04-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-05-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-05-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-06-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-06-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-07-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-07-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-08-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-08-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-09-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-09-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-10-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-10-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-11-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-11-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-12-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-12-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-13-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-13-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-14-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-14-SUMMARY.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-15-PLAN.md
  - .planning/phases/10-rede-social-member-stories-and-communities/10-15-SUMMARY.md
  - apps/api/src/modules/registry.ts
  - apps/web/app/(app)/comunidades/CommunitiesList.tsx
  - apps/web/app/(app)/comunidades/CommunityForm.tsx
  - apps/web/app/(app)/comunidades/CommunityLimitNotice.tsx
  - apps/web/app/(app)/comunidades/[communityId]/CommunityPosts.tsx
  - apps/web/app/(app)/comunidades/[communityId]/DeleteCommunityControl.tsx
  - apps/web/app/(app)/comunidades/[communityId]/destaques/page.tsx
  - apps/web/app/(app)/comunidades/[communityId]/editar/page.tsx
  - apps/web/app/(app)/comunidades/[communityId]/page.tsx
  - apps/web/app/(app)/comunidades/actions.ts
  - apps/web/app/(app)/comunidades/nova/page.tsx
  - apps/web/app/(app)/comunidades/page.tsx
  - apps/web/app/(app)/criar/ComposerForm.tsx
  - apps/web/app/(app)/criar/actions.ts
  - apps/web/app/(app)/criar/page.tsx
  - apps/web/app/(app)/inicio/ExplorarBody.tsx
  - apps/web/app/(app)/inicio/ExplorarSkeleton.tsx
  - apps/web/app/(app)/inicio/ExplorarStoriesRow.tsx
  - apps/web/app/(app)/inicio/page.tsx
  - apps/web/app/(app)/stories/highlight-actions.ts
  - apps/web/app/(app)/stories/meus/StoryHistoryList.tsx
  - apps/web/app/(app)/stories/meus/page.tsx
  - apps/web/app/(app)/stories/publicar/StoryComposer.tsx
  - apps/web/app/(app)/stories/publicar/page.tsx
  - apps/web/app/(app)/stories/story-actions.ts
  - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx
  - apps/web/components/admin/ModerationLogRow.tsx
  - apps/web/components/feed/PostDetail.tsx
  - apps/web/components/platform/SocialLimitsSheet.tsx
  - apps/web/components/stories/HighlightManager.tsx
  - apps/web/components/stories/StoriesSurface.tsx
  - apps/web/components/stories/StoryViewerHost.tsx
  - apps/web/components/stories/StoryVisibilityNotice.tsx
  - apps/web/e2e/comunidades.spec.ts
  - apps/web/e2e/member-journey.ts
  - apps/web/e2e/social-platform.spec.ts
  - apps/web/e2e/social.spec.ts
  - apps/web/e2e/stories.spec.ts
  - apps/web/lib/communities.ts
  - apps/web/lib/feed-view.tsx
  - apps/web/lib/moderation-view.ts
  - apps/web/lib/platform.ts
  - apps/web/lib/registry.tsx
  - apps/web/lib/social-limits.ts
  - apps/web/lib/stories.ts
  - apps/web/lib/story-view.ts
  - packages/contracts/src/moderation.ts
  - packages/core/db/schema/moderation-log.ts
  - packages/core/server/communities/action-gate.ts
  - packages/core/server/communities/member-policy.ts
  - packages/core/server/media/member-policy.ts
  - packages/core/server/media/member-share.ts
  - packages/core/server/media/service.ts
  - packages/core/server/moderation/log.ts
  - packages/core/server/safety/index.ts
  - packages/core/server/safety/limits.ts
  - packages/modules/communities/contracts/index.ts
  - packages/modules/communities/db/schema.ts
  - packages/modules/communities/module.ts
  - packages/modules/communities/server/routes.ts
  - packages/modules/communities/server/service.ts
  - packages/modules/communities/ui/CommunityCard.tsx
  - packages/modules/communities/ui/CommunityHeader.tsx
  - packages/modules/feed/contracts/index.ts
  - packages/modules/feed/db/schema.ts
  - packages/modules/feed/server/notifications.ts
  - packages/modules/feed/server/routes.ts
  - packages/modules/feed/server/service.ts
  - packages/modules/feed/ui/FeedList.tsx
  - packages/modules/feed/ui/PostCard.tsx
  - packages/modules/feed/ui/PostMenu.tsx
  - packages/modules/social/contracts/index.ts
  - packages/modules/stories/contracts/index.ts
  - packages/modules/stories/db/schema.ts
  - packages/modules/stories/server/notifications.ts
  - packages/modules/stories/server/routes.ts
  - packages/modules/stories/server/service.ts
  - packages/modules/stories/ui/HighlightSheet.tsx
  - packages/modules/stories/ui/StoriesStrip.tsx
  - packages/modules/stories/ui/StoryCircle.tsx
  - packages/modules/stories/ui/index.ts
  - scripts/seed.ts
  - supabase/migrations/20261111143858_member_communities_functions.sql
  - supabase/migrations/20261111143948_member_communities.sql
  - supabase/migrations/20261111144148_feed_community_audience.sql
  - supabase/migrations/20261111144205_feed_member_update_allowlist.sql
  - supabase/migrations/20261111145716_member_stories.sql
  - supabase/migrations/20261111150352_story_media_gate.sql
  - supabase/migrations/20261111151218_moderation_member_content.sql
  - supabase/migrations/20261111163020_member_stories_authors.sql
  - supabase/migrations/20261112182228_member_content_write_gates.sql
covered_digest: "v1:sha256:21a8bab981e5998f82aaf30321f699edb07ab95ec99ba58fd013bcacf91430b0"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "4/4 roadmap criteria; 27/28 requirement ids (MPUB-04 partial)"
  gaps_closed:
    - "MPUB-04: restrictive database gates on stories UPDATE/DELETE, story_highlights, story_highlight_items and the staff branch of feed_posts_social_insert_gate (WR-03, WR-04), plus the hidden-community video leg of app.media_asset_hidden (WR-05)"
  gaps_remaining: []
  regressions: []
advisory: []
human_verification:
  - test: "P1: member story composer, create-community entry and Explorar story row on a real phone with the installed PWA"
    expected: "Own circle 'Seu story' with the + badge publishes; follower sees the unseen circle and opens the grouped viewer; new community listed after organization cards with 'Criada por'; stranger sees no publish control"
    why_human: "A phone cannot reach *.localhost; needs a homolog or production host and Igor's hand"
  - test: "P2: social switched off then on in a live per-tenant project"
    expected: "Writes stop, member communities/posts/highlight story stay readable, moderator keeps removing, on restores everything with no row changed"
    why_human: "Needs a hosted tenant project with the nine Phase 10 migrations applied"
  - test: "P3: viewer menus and destination sheet at 320px on a real device"
    expected: "Reachable with a thumb, not clipped, delete dialogs read right in both copy variants"
    why_human: "Real-device layout"
  - test: "P4: held-out backstops E02, E04, E06, E08, E09"
    expected: "No clipping or horizontal scroll at 320px, screen reader names read well"
    why_human: "Visual and accessibility, no automated assertion"
  - test: "P5-P9: planner assumptions A1..A12, UI-SPEC defaults OQ-1..OQ-7, D-478 legal wording, owner-dashboard counts decision, release order"
    expected: "Igor confirms or overturns each in 10-MANUAL-PROOFS.md"
    why_human: "Owner decisions and deploys; an agent never records these as passed"
  - test: "Release: ninth migration through the ledgered fan-out, then API deploy (the resolveHighlight change must ship with the API)"
    expected: "pnpm db:two and pnpm db:migrate-all -- --dry-run clean; migration applied to every ready tenant project before the API; a non-owner member naming a foreign highlight still gets 403, not 404"
    why_human: "Deploy and hosted projects are Igor's; not authorized or observable here"
  - test: "Full pnpm e2e baseline and e2e:pwa"
    expected: "The 118 red failures outside Phase 10 specs are shown pre-existing by a run at the commit before the phase, and e2e:pwa runs green"
    why_human: "No baseline run exists; the verdict on those failures is an inference from touched files"
---

# Phase 10: Rede Social - Member Stories and Communities Verification Report

**Phase Goal:** With "Rede social" on, members also publish stories and create their own communities, and a community only accepts publications from its owner: the creator for a member-created community, any `admin_tenant` for an organization community (D-706).
**Verified:** 2026-11-12
**Status:** passed by developer closure on 2026-11-12 (was human_needed: everything automatable passes; the items below stay open and are Igor's)

> **Closure note (2026-11-12).** Igor closed Phase 10 with "se ja estiver pronto, fechar fase 10". The status is `passed` on that word, as in Phases 9, 12.1, 12.2 and 12.3. What this does NOT record as observed:
> - The nine real-device and owner proofs P1..P9 in `10-MANUAL-PROOFS.md` are all still `pending`; no agent passed one and none is claimed here.
> - The full `pnpm e2e` stage was RED (118 failures, none in a Phase 10 spec) and `e2e:pwa` never ran; "not caused by Phase 10" is an inference from the files the phase touched, with no baseline run at the pre-phase commit.
> - No Phase 10 security audit (`/gsd-secure-phase 10`) and no UI review (`/gsd-ui-review 10`) were run; the plans' threat models were checked only through the code review and this verification.
> - Sketch 020 is approved provisionally (Igor, 2026-11-11), and the two new copy keys `feed.deleteCommunity.body` and `feed.removeCommunity.body` await his confirmation.
> - The release steps are his: `pnpm db:two`, `pnpm db:migrate-all -- --dry-run`, fan-out of the nine Phase 10 migrations, then the API deploy together with the migration, web first for A7. Nothing was pushed or deployed.
> - `covered_digest` was recomputed on 2026-11-12 after the REQUIREMENTS.md and ROADMAP.md closure edits; no covered source file changed in between.
**Re-verification:** Yes, after gap closure (quick 261112-kuk, commits 35226de7, 28f83dd8, cb2b4507, 2a522c06)

## Goal Achievement

The four roadmap criteria and the D-711 amendment held in the first report and still hold. The one gap of that report, MPUB-04 (database defense in depth on the highlight tables, on stories UPDATE/DELETE and on the staff branch of the post insert gate), is now delivered in the database and proven by pgTAP negatives that this verifier re-ran and mutation-checked. WR-03, WR-04 and WR-05 are closed. No new gap was found.

### Observable Truths (ROADMAP success criteria + amendments)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | With social on a member publishes stories; Inicio's grouped circle stays admin-only; Explorar shows one circle per author for followers | VERIFIED | Unchanged from the first report (migration `20261111145716`, `member-stories.test.ts`, `ExplorarBody.tsx`). Re-checked against this change: the new `stories_member_update_guard` only holds a `member` claim and lets the two counters through on any story, so the like and comment counter triggers (invoker, `20260923234657`, `20260924005427`) keep working; pgTAP 231 section 12a asserts it (M2 likes M4's story, counter 0 to 1 and back, with the guard in place). `stories` has 12 columns and no view counter, and the only other writer in code is the soft delete at `stories/server/service.ts:1045` (live to deleted, allowed by the guard) |
| 2 | With social on a member creates a community and its highlights | VERIFIED | Unchanged. Highlight creation by the creator in her own member community is the positive control of pgTAP 231 12c (insert, rename, delete of the own highlight succeed) and 12d (own story into own highlight succeeds) |
| 3 | Only the community's owner publishes in it (posts, stories, highlights): creator for a member community, any admin_tenant for an organization community; others and an admin on a member community get 403 and no control | VERIFIED, now also at the database | Posts: `resolveCommunityTarget` as before, and the staff branch of `feed_posts_social_insert_gate` now admits a `'tenant'` post only with no community or an `organization` community (pgTAP 232 section 8: admin and system lane refused 42501 in a member community of the tenant and of another tenant, allowed in an organization community and with none). Highlights and items: seven restrictive gates (pgTAP 231 12c, 12d). Stories: trigger plus delete gate (12a, 12b). The service-level 403 order is intact, see the `resolveHighlight` section |
| 4 | Turning social off stops new member stories and communities; existing member communities stay readable | VERIFIED | Unchanged. New insert gates carry the `social` term from SQL (`app.social_enabled()`): pgTAP 231 12c asserts a creator cannot insert a highlight in her own community with `social` off. UPDATE/DELETE carry none on purpose (assumption A11), so a creator can still take down her own highlight and the moderator lanes are untouched |
| 5 | Moderation (D-711): moderator soft-deletes any member story and archives/removes any member community and a single community post, with a `moderation_log` row | VERIFIED | Unchanged. Moderators are staff claims (`admin_tenant` / `support_tenant`), which the guard returns untouched; pgTAP 231 12a asserts the admin_tenant soft-deletes a member story and edits an organization story, and the system lane edits a story |

**Score:** 5/5 truths verified. Real-device behaviour is not part of this score (see Human Verification).

### MPUB-04 closure (the only gap of the first report)

Requirement text: "The member lane is bounded by RESTRICTIVE RLS gates on `communities`, `stories`, `story_highlights`, `story_highlight_items` and `feed_posts` that refuse (42501) a forged kind, owner, audience or non-owner write, reading `social` from SQL ..., and `feed_posts_member_update_guard` becomes an allow-list".

Live catalog on the local database (read from `pg_policies` and `pg_trigger`), RESTRICTIVE policies and guards per table:

| Table | Restrictive gates / guards present | Source |
|-------|-----------------------------------|--------|
| communities | kind insert, member update, member delete, hidden select | Phase 10 plans 03/04 (unchanged) |
| stories | audience select, social insert, **member delete gate**, **trigger `stories_member_update_guard`** | insert/select Phase 10; delete and update new in `20261112182228` |
| story_highlights | **member insert, update, delete gates** | new |
| story_highlight_items | **member insert, update, delete gates** | new |
| feed_posts | social insert (staff branch **now carries the organization-kind term**), member delete, select gates, `feed_posts_member_update_guard` (allow-list since `20261111144205`) | insert gate amended |

Reading of the new migration (`supabase/migrations/20261112182228_member_content_write_gates.sql`):

- Highlights: a `member` claim writes only where `communities.kind = 'member'`, same tenant, `created_by_user_id = app.user_id()`; insert also needs `app.social_enabled()`; update carries the owner term in both USING and WITH CHECK (no re-point). A null role claim makes every branch null and denies (fail closed).
- Items: member insert needs the highlight's community owned by the caller AND the story's `author_user_id = app.user_id()` (the D-716 audience-widening hole, branch 3 of `stories_audience_gate`, is shut in the database); member update refused outright; member delete only inside an owned highlight.
- Stories: a restrictive DELETE gate (`tenant_role() <> 'member'`) and a BEFORE UPDATE invoker trigger. For a member claim: on a story it did not write only the counters may differ (comparison via `to_jsonb(new) - counters`, so a column added later is covered); author, visibility, tenant and media frozen on every story; on its own story only the counters and `deleted_at`, and `deleted_at` only as null to value (no resurrection). Function is `SECURITY INVOKER`, `search_path = ''`, fixed message with no row data, errcode 42501.
- WR-05: `app.media_asset_hidden` re-created. I diffed its body against `20261111150352_story_media_gate.sql`: exactly two inserted alternatives (`app.member_community_hidden_ids()` in the hiding group and inside the trailing exemption), nothing else changed, same signature, `revoke all from public` and `grant execute to authenticated` re-applied.
- Drift: `pnpm db:generate` printed "No schema changes, nothing to migrate" (run by this verifier, no tracked file changed). The TS mirrors in `packages/modules/stories/db/schema.ts` and `packages/modules/feed/db/schema.ts` carry the same predicate text; the docblock of `resolveCommunityTarget` now states the database agrees (the false claim of WR-04 is gone).

Verdict: MPUB-04 SATISFIED. Gates exist on all five tables, refuse with 42501 (or zero rows for a USING-filtered delete, which is how the previous gates on this project already refuse), read `social` from SQL on every insert gate, and the allow-list guard of `feed_posts` was already in place.

### Review findings re-checked

| Finding | State | Evidence |
|---------|-------|----------|
| WR-03 no UPDATE/DELETE gate on stories, highlights, items | CLOSED | migration above; pgTAP 231 section 12; mutation check below |
| WR-04 staff branch lacks community-kind term; docblock false | CLOSED | policy text in `pg_policies` contains `c.kind = 'organization'` (pgTAP 232 section 8, last assertion); docblock corrected |
| WR-05 video of a hidden member community still gets a token | CLOSED | pgTAP 232 section 9: hidden for the member, the admin_tenant and the system lane (no staff exemption, matching the RLS gate), false when a visible organization post also carries the asset, false in another tenant, reopens when the creator is restored, hides again on membership `deleted_at` |
| WR-01, WR-02, WR-06 | FIXED (unchanged) | not touched by this change |

### Behavioral Spot-Checks (run by this verifier)

pgTAP was run with `psql -f` against the local stack, with the helper schema (`000-helpers.sql`, which commits) prepended inside one outer transaction and the test file's own `rollback` ending it. After the runs the `tests` schema and `pgtap` extension are absent and no `pgtap-%` tenant remains, so the freshly reset and seeded stack is as it was.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Member stories incl. new section 12 | helpers + `supabase/tests/231-member-stories.sql` via `psql -At -f` | plan 167, 167 ok, 0 not ok | PASS |
| Feed community audience incl. new sections 8, 9 | helpers + `supabase/tests/232-feed-community-audience.sql` | plan 74, 74 ok, 0 not ok | PASS |
| Schema conventions (pins app functions, no single-row pick) | helpers + `040-schema-conventions.sql` | 71 ok, 0 not ok | PASS |
| Mutation check, stories/highlights/items (do the negatives really bite?) | same transaction, `drop trigger stories_member_update_guard` and the seven `drop policy`, then file 231 | 37 not ok, all in section 12, all negatives and catalog pins; every positive control stayed ok; 130 ok | PASS (the 38th red assertion of the executor is the function-hardening pin, which stays true while the function exists) |
| Mutation check, WR-04 | same transaction, `alter policy feed_posts_social_insert_gate` back to the pre-migration text, then file 232 | 5 not ok, all section 8 (3 forged-community refusals, system lane, policy-text pin); positive controls ok | PASS |
| Module stories unit tests | `pnpm exec vitest run` in `packages/modules/stories` | 16 files, 217/217 | PASS |
| Module feed unit tests | `pnpm exec vitest run` in `packages/modules/feed` | 27 files, 345/345 | PASS |
| Schema drift | `pnpm db:generate` | "No schema changes" | PASS |
| Debt markers in migration, stories service and schema | grep TBD/FIXME/XXX | none | PASS |
| Attribution | `git log` over the four quick commits | no Co-Authored-By or tool trailer | PASS |

Test quality read: every negative in 231 section 12 and 232 sections 8 and 9 attempts the forged write itself (update, delete, insert, re-point, cross-tenant, null role, social off) and expects 42501 or zero rows, and each sub-block has positive controls (staff, system lane, the creator's own highlight, own story, counters, soft delete). Zero-row negatives are meaningful because the mutation run turned them red, which shows the restrictive gate and not the select policy is what stops them. No weakened assertion was found; the two statement-order pins edited in `packages/modules/stories/tests` (`events.test.ts`, `story-highlights.test.ts`) only add the second `highlight` read that the service change introduces, and still assert the story row is never written.

### `resolveHighlight` change (service beyond the plan)

`packages/modules/stories/server/service.ts` `resolveHighlight` now reads the highlight with no lock, calls `resolveHighlightPlace`, and for a write intent re-reads it `for update` after the place is judged. Reason: `select ... for update` also passes the table's UPDATE policy, so under the new `story_highlights_member_update_gate` a non-owner member would read zero rows and get the 404 of a miss instead of the 403.

- Order of answers is unchanged: 404 for a miss (unknown, another tenant, hidden creator), then 403 for a non-curator, then the place rules; the unlocked first read passes the select policies exactly as the locked read did before for any caller who could see the row. No new existence oracle: a non-owner already received 403 for a highlight of a visible community before this change.
- No new race: the place seam (`resolveHighlightPlace`) still takes the community `for share` on a write intent before the highlight is locked, so a concurrent archive waits; the highlight is then locked and the columns a write compares are taken from the LOCKED read, so a concurrent rename is seen, not overwritten. A concurrent delete between the two reads gives 404, which is the honest answer. The service never updates `story_highlights.community_id` (the three highlight updates touch title/cover, cover clear and position), and a member cannot re-point it (WITH CHECK), so the place judged on the first read cannot differ from the locked row's place by any path the product offers.
- Cost: one extra indexed read per highlight write. Unit pins updated accordingly (217/217 green here).
- Not re-run by me: the API integration file `member-stories.test.ts` (executor reports 46/46 after the fix, 41/46 before it).

### Requirement Coverage (all 28 phase ids)

| Requirement | Verdict | Note |
|-------------|---------|------|
| MCOMM-01..11 | SATISFIED | as in the first report; the communities gates are untouched; MCOMM-07 and MCOMM-11 residual WR-05 is now closed |
| MPUB-01, MPUB-02, MPUB-03, MPUB-05, MPUB-06, MPUB-07 | SATISFIED | unchanged; MPUB-07 gains a ninth expand-only migration (tightening only, no table/column/row change) documented in `docs/DEPLOY.md` item 9 and the order section ("nine versions") |
| **MPUB-04** | **SATISFIED (was PARTIAL)** | see closure section |
| MSTORY-01..09 | SATISFIED | counters, moderator delete, creator highlight and notifications paths checked above for interaction with the new guard and gates; no regression found in 231 (167/167) |
| UI-04 (gate reference) | SATISFIED as a gate reference | sketch 020 approval still provisional |

Count: 28/28 requirement ids satisfied. No orphaned ids.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `apps/web/app/(app)/comunidades/actions.ts:303` | stale "409" for `limit_reached` (IN-01) | Info | comment only |
| `apps/api/src/routes/media.ts:129` | OpenAPI text member video only for `post` (IN-02) | Info | description drift |
| `packages/modules/stories/server/service.ts` | `scope.isMember` accepted, never read (IN-03) | Info | dead input |
| `communities_member_update_gate` | staff UPDATE may change `kind` (IN-04) | Info | accepted in the quick plan |
| `safety/limits.ts` | per-instance limiters (IN-05) | Info | soft ceiling |
| `docs/DEPLOY.md` item 9 | says "safe to apply ahead of any code"; true for data and security, but with the OLD API the new highlight UPDATE gate turns a non-owner member's 403 on a foreign highlight into a 404 (status difference, no data leak). The quick SUMMARY says the service change must ship with the API; DEPLOY.md does not | Info | release note to add when Igor next touches DEPLOY.md |
| `story_highlights.created_by_user_id` | not constrained by the new insert gate (a creator may write another id into the audit column) | Info | display/audit column only, no authority derived from it; not in MPUB-04 text |

No new Blocker or Warning.

### Human Verification Required

Unchanged in substance: P1 to P9 in `10-MANUAL-PROOFS.md` all `pending` (real phone on a homolog or production host, `social` switched off and on in a live per-tenant project, 320px viewer menus, five held-out visual/accessibility backstops, planner assumptions A1..A12 and UI-SPEC defaults OQ-1..OQ-7, D-478 wording, owner-dashboard counts decision, release order with the A7 web-first exception). Added for the release: apply the ninth migration through the ledgered fan-out to every ready tenant project before the API deploys (`pnpm db:two` and `pnpm db:migrate-all -- --dry-run` were not run by this verifier). Also open: the full `pnpm e2e` stage (118 failures outside Phase 10 specs, inference from touched files, no baseline run) and `e2e:pwa` never ran; sketch 020 approval is provisional.

### Not observed by this verifier

- The 141-file API integration suite, the full 65-file pgTAP run (only 231, 232 and 040 were run here, in rolled-back transactions), the web test suite, lint/typecheck/build, Playwright e2e and `e2e:pwa`. The executor's figures (65 files / 4552 pgTAP tests, 20 integration files one at a time, member-stories 46/46) are taken as reported, not independently confirmed.
- Mutation checks were run for the stories, highlights and items gates and for the WR-04 staff term; no mutation run was made against the WR-05 function (its section 9 was run green only, plus the textual body diff).
- Hosted per-tenant projects: nothing was applied or observed there.

### Gaps Summary

None. MPUB-04 is closed; WR-03, WR-04 and WR-05 are closed. Remaining items are human or release items, not code gaps.

---

_Verified: 2026-11-12_
_Verifier: Claude (gsd-verifier)_
