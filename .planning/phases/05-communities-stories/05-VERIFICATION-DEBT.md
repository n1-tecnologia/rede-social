---
phase: 05-communities-stories
assembled: 2026-09-24
source_report: .planning/phases/05-communities-stories/05-VERIFICATION.md
source_report_verified: 2026-09-24T02:05:00Z
source_report_status: gaps_found
assembled_by: 05-12-PLAN.md (Task 1)
counts:
  prohibitions: 14
  backstop_claims: 5
  device_checks: 4
  total: 23
gap_closure_plans: ["05-09", "05-10", "05-11"]
new_prohibitions_added_by_gap_closure: 8
status: awaiting_human_resolution
---

# Phase 5 — Verification Debt

`05-VERIFICATION.md` fails closed on twenty-three items: **14 prohibitions** carried
`status: unverified` / `verification: flagged` across the eight executed plans, **5** declared
`verification: backstop` visual claims that abstain with reason `insufficient_spec`, and **4** human
checks that need a real device. None of them can be absorbed into a passing verdict by silence.

This file assembles all twenty-three in one place, with the evidence beside each, and marks the ones
gap closure (05-09, 05-10, 05-11) actually converted. It resolves nothing. Every row is input to a
human decision, not the output of one.

---

## Section 1 — The traceability finding (`.planning/REQUIREMENTS.md`)

**What the plan expected, and why that expectation was stale.** `05-12-PLAN.md` truth 5 says the
verifier's closing note ("COMM-01 and STORY-02 are already marked `[x]` / `Complete` … Both should
revert to in-progress until the two gaps close") had already been acted on by commit **`99782b6`**
*docs(phase-05): revert premature Complete requirements after gaps found*, and that the correct action
here was therefore to **confirm and record, making no edit**.

**What is actually on disk, read before deciding anything.** `.planning/REQUIREMENTS.md` was read at
lines **63-66** (the COMM checklist), **69-73** (the STORY checklist) and **245-253** (the Phase 5
rows of the traceability table). The state is:

| Requirement | Checklist (lines 63-73) | Traceability table (lines 245-253) |
|---|---|---|
| COMM-01 | `- [x]` (line 63) | `Complete` (line 245) |
| COMM-02, COMM-03, COMM-04 | `- [ ]` | `Gaps Found` |
| STORY-01 | `- [ ]` | `Gaps Found` |
| STORY-02 | `- [x]` (line 70) | `Complete` (line 251) |
| STORY-03, STORY-04, STORY-05 | `- [ ]` | `Gaps Found` |

So **COMM-01 and STORY-02 read `Complete` again** — the opposite of what the plan predicted. The
commit history explains it exactly, and the ordering matters:

1. **`99782b6`** reverted all nine Phase 5 requirements from `[x]` / `Complete` to `[ ]` /
   `Gaps Found`, as the verifier asked. This is the state the plan was written against.
2. **`5e0334f`** *docs(5-9): complete the cover-asset tenant gate plan* re-marked **COMM-01** only —
   `- [ ]` → `- [x]` and `Gaps Found` → `Complete` — after 05-09 closed GAP 1 (the unvalidated
   `coverAssetId` write). `05-09-SUMMARY.md:61` declares `requirements-completed: [COMM-01]`.
3. **`350f88f`** *docs(5-11): complete the story viewer video path plan* re-marked **STORY-02** only,
   after 05-11 closed the video half of GAP 2 and ran `apps/web/e2e/stories.spec.ts` green
   (20 passed / 1 skipped on `mobile-chromium`). `05-11-SUMMARY.md:96` declares
   `requirements-completed: [STORY-02]`. 05-10 deliberately withheld the same mark while the video
   half was still broken (`05-10-SUMMARY.md`, "Open Items Carried Forward").

**Decision taken: NO EDIT.** Both marks were made by the plans that closed the corresponding gap,
each against a re-read of reality rather than a memory, and each records its evidence in its own
SUMMARY. Reverting them on the strength of a plan sentence written before those plans ran would be
precisely the failure mode the plan's second prohibition names — editing the record to match what
someone remembers rather than what is on disk. `git diff` for `.planning/REQUIREMENTS.md` in this
plan is empty.

**What this does change.** `05-12-PLAN.md`'s third automated gate reads
`grep -c 'Gaps Found' .planning/REQUIREMENTS.md` and fails below 9, on the premise that "the nine
Phase 5 requirement rows must all still read as not-yet-complete". That premise is superseded:
seven Phase 5 rows read `Gaps Found`, two read `Complete`, and the file's total of 14 comes from the
seven Phase 5 rows plus seven Phase 2 rows (TENANT-06, ROLE-04, ROLE-05, UI-01, UI-03, UI-04,
PWA-01). The gate passes numerically (14 ≥ 9) but no longer measures what it was written to measure.
It is recorded here so the next reader does not treat the passing number as a confirmation of the
nine-row claim.

**Still outstanding for the two re-marked requirements.** `Complete` here means *the implementation
gap is closed and has executable evidence*, not *the phase re-verification has run*.
`05-VERIFICATION.md` still carries `status: gaps_found` and has not been re-run; COMM-01 additionally
carries one open human item from 05-09 (whether the pt-BR refusal sentence "Não foi possível usar
esta imagem de capa. Escolha outra." reads well in the alert card on a phone), and STORY-02 carries
device check H-05-02 below, which is open and cannot be closed locally.

---

## Section 2 — The 14 flagged prohibitions

**The verdict column is a PROPOSAL, not a resolution.** Every row below still carries
`status: unverified` / `verification: flagged` in its source plan, and this file does not and cannot
change that. A dossier that reads as a resolution launders a fail-closed item into evidence and
removes the reason anyone would look again — so nothing here is marked resolved, and the `Evidence`
column is a reading of the shipped code by file and line, not a restatement of the plan that promised
it. Only a human reading section 2 can settle these.

**Status vocabulary:** `converted` = an automated check now asserts the must-NOT and the test exists
on disk. `carried` = still a reading; carried forward by name.

| Id | Source | Statement (verbatim) | Status | Evidence (a reading of the shipped code) | Proposed verdict |
|---|---|---|---|---|---|
| P-05-01 | 05-01 | "A community must not acquire a human owner byline. The organisation owns the container and each post inside it already shows a face; a second byline on the container competes with the real one and invents an authorship claim the product does not make (D-67)." | carried | `packages/modules/communities/ui/CommunityHeader.tsx` (122 lines) renders no owner or author element; the only occurrence of "author" in the file is its own docblock at line 14 stating the rule. `created_by_user_id` exists on the row and is not projected into the header's props. | Appears honoured. A human should confirm no byline reappeared through `CommunityCard.tsx` or the community page header. |
| P-05-02 | 05-02 | "A prototype-less surface must not be coded before its drawing is reviewed. D-33 exists because prose describing a screen and a screen are different artifacts, and the phase that skips the drawing discovers the disagreement in code review instead of in a five-minute conversation." | carried | `.planning/sketches/003-phase-05-designed-screens/README.md:21-24` reads `status: approved`, `approved: true`, `approved_by: Igor Vilas Boas`, `approved_at: 2026-09-23`; README line 196 names the six tasks that were blocked on it. Verifier truth 14 independently confirmed the gate and the `precondition` elements. | Appears honoured — this is the one prohibition with an approval artifact and a date. A human should confirm the approval preceded the coding of all six gated tasks. |
| P-05-03 | 05-02 | "The mockups must not introduce a new spacing value, type size, type weight or colour token. Phase 5 inherits the whole design system unchanged; a mockup that invents a value silently makes the review approve a system change nobody asked for." | carried | `index.html` (1201 lines) declares 60 of its own `--token: value` lines with literal hex, which is how a standalone sketch must work. Spot-checked literals resolve to existing values, not new ones: `#2563eb` is in `packages/ui/src/styles/tokens.css`; `#0f1118` appears in the built `globals.css`; `#14b8a6` is not a design token at all but the **Lab tenant's brand preset** (line 337, `data-s="#14b8a6"`, the same value used by `packages/contracts/tests/branding.test.ts`), i.e. tenant brand data driving the sketch's brand switcher. | Appears honoured on a spot check of three literals. Not exhaustively cleared — 60 declarations were not each traced. The weakest evidence in this table; a human who cares about this one should diff the sketch's `:root` block against `tokens.css`. |
| P-05-04 | 05-03 | "A community post must not appear in the main feed without a visible statement of where it came from. Criterion 1 mixes two sources into one list; an unlabelled post misrepresents its origin to the member reading it, and the label is also the only discovery path into the community." | carried | `packages/modules/feed/ui/PostCard.tsx:56` takes `community?: { label; href; ariaLabel } \| null` and line 206 passes `post.community ?? null` through; the only suppression is `suppressCommunity` on the community page's own LIST (lines 53-54, 131), where the whole list shares one community and the label would restate the page (UI-D-36). | Appears honoured, with one deliberate, scoped exception that is itself the argument for the rule. A human should confirm `suppressCommunity` is passed nowhere but the community page. |
| P-05-05 | 05-03 | "The merged feed must not be filtered by an IN-list of community ids, and must not gain a denormalised per-post visibility flag. Both were measured: the IN-list plans as a sequential scan plus sort, and the flag buys a table-wide UPDATE on every archive plus a fourth index plus a new class of drift — a performance shortcut that quietly becomes a correctness surface." | carried | `packages/modules/feed/server/service.ts:334-341` — `listFeed` switches on `communitiesEnabled` between an EMPTY predicate (D-73) and `and p.community_id is null` (D-74). No `in (` over community ids anywhere in the read; no visibility column on `feed_posts`. `supabase/tests/090-feed.sql:519` pins `feed_posts_tenant_created_all_idx` by name in an `EXPLAIN` with a `Seq Scan` negative at 510. | Appears honoured, and this one has independent automated backing (the EXPLAIN assertion) even though the prohibition itself was never marked verified. |
| P-05-06 | 05-04 | "Archiving a community must not retroactively hide or unpublish content members have already seen, liked and commented on. An organisational tidy-up must not read to a member as censorship or as data loss, which is what an archive that empties the feed would look like from the only side that matters." | carried | The verifier's reading, re-checked: `packages/modules/feed/server/service.ts:158-161` carries an explicit SQL comment that there is **no** `c.status` and no `c.deleted_at` predicate ("Archive is a write gate and a list gate, never a feed gate"), and line 378 repeats it in prose; `packages/modules/communities/server/service.ts:137` applies `and c.status = 'active'` to the LIST only, and lines 413-417 state the community still opens by id, read-only. pgTAP archive cases ship in `supabase/tests/110-communities-stories.sql`. | Appears honoured — three independent gates agree and one of them is a comment placed exactly where a future edit would break it. This is the strongest `carried` row. |
| P-05-07 | 05-04 | "A community must not be given a destructive delete in V1. COMM-01 asks for archive, archive is reversible, and a delete would cascade over posts, comments and likes authored by members who never agreed to lose them." | carried | `packages/modules/communities/server/routes.ts` declares exactly four routes — `get` list (55), `get` by id (71), `post` create (87), `patch` update (122). `grep -cE "method: 'delete'\|\.delete\("` prints **0**. Archive is a `status` write on the PATCH route (line 116), so there is one write path, not two. | Appears honoured. A human should confirm no delete exists on the web action layer either (`apps/web/app/(app)/comunidades/actions.ts`). |
| P-05-08 | 05-05 | "A story or a community card must not silently acquire a per-user read marker. No views table, no seen/unseen ring, no device-local seen set, no 'X novos posts' badge: watching a story must not quietly become a tracked, reportable act performed on a member by their own organisation." | carried | `packages/modules/stories/db/schema.ts` declares no views/seen table (the module's tables are `stories` and `story_community_pins`). `packages/modules/stories/ui/StoryCircle.tsx:18-19` carries the rule as a docblock ("There is no seen/unseen state, and there must never be one" — D-79) and every circle in a row renders identically. | Appears honoured. A human should confirm no `localStorage`/`sessionStorage` seen-set crept into `StoryViewerHost.tsx`. |
| P-05-09 | 05-05 | "Expiry must not be implemented as a destructive operation. No sweeper, no scheduled delete, no update that blanks the row, and no cascade that removes the likes and comments members left on it — a member's comment must not vanish because a clock passed." | carried | `packages/modules/stories/db/schema.ts:46-47` states there is no scheduled job of any kind and that adding one would break STORY-03; `expires_at` is a plain `timestamptz` with a volatile default plus `check ('stories_expiry_window_chk')` at line 131. `packages/modules/stories/server/service.ts:39` and :176 repeat it. Verifier truth 9 proved under a transaction-controlled clock that the expired row is still selectable by id. | Appears honoured, with pgTAP backing for the retention half. |
| P-05-10 | **05-06** | "The viewer must not mount two different meanings on the same tap. A surface whose primary gesture is 'advance' must not also treat a tap as 'like', because the member cannot express one without risking the other — and the failure is silent, costing them both the story and the like." | **converted (partial — see note)** | **Test file:** `packages/modules/stories/tests/story-viewer.test.tsx`. **Cases:** `12a. CR-04: tapping the play badge starts playback and does NOT advance the story` (line 420); `12b. CR-04: tapping the media-error retry re-mounts the media and does NOT advance` (line 445); `12c. CR-04: the stage is still LIVE — a tap on the media area advances as before` (line 464). 05-10 Task 3 moved the badge and the error container OUT of the gesture-owning subtree (structural isolation, `grep -c stopPropagation` = 0). | **Converted for the two controls, with one named hole.** 12a/12b prove a control tap does not advance; 12c prevents the trivial pass where the pipeline was simply broken. **Not** asserted at unit level: that a tap on the error **COPY** still advances (the `pointer-events-none` transparency). `05-10-SUMMARY.md` deviation 3 records this as coverage D6 `status: deferred` — happy-dom does not hit-test, so the property is real-browser-only. It was routed to `apps/web/e2e/stories.spec.ts`, which 05-11 **ran green** (20 passed / 1 skipped on `mobile-chromium`, all 8 gesture cases) — but that suite asserts the gesture contract generally, not the error-copy transparency specifically. A human confirming this row should tap the error copy as well as the two controls. |
| P-05-11 | 05-07 | "The absence of the reply and comment-like affordances must not be the enforcement. If the UI is the only thing refusing, a member who calls the API directly gets a capability the product deliberately withheld, and a rule the roadmap states twice silently becomes advisory." | carried | `packages/modules/feed/db/schema.ts:320` declares a stored generated `target_kind`; :329 `parent_target_kind`; :374-383 the null-guarded `feed_comments_parent_chk` (which pins `parent_target_kind = 'post'`) and `feed_comments_target_chk` (`num_nonnulls(post_id, story_id) = 1`); :452 records that `feed_likes_comment_kind_chk` pins the like FK to `'post'`. Verifier truth 12 lists the `throws_ok` assertions at `110-communities-stories.sql` lines 361, 396, 503, 517, 541, 554, 569, each with a positive control, including a probe that lies about the target. | Appears honoured, and this is the phase's strongest work — the refusal is declarative in the database, not in the UI. A human can confirm cheaply by running `supabase test db`. |
| P-05-12 | 05-07 | "A second comment list must not be created for stories. The moment two lists exist, the removed-author row, the optimistic insert and the failure copy start drifting apart on surfaces a member reads as the same feature." | carried | `CommentSheet` is defined once, in `packages/modules/feed/ui/CommentSheet.tsx`, and imported by `packages/modules/stories/ui/StoryViewer.tsx`, `packages/modules/feed/ui/FeedList.tsx`, `apps/web/components/stories/StoryViewerHost.tsx` and `apps/web/lib/registry.tsx`. No stories-owned comment list file exists. | Appears honoured — one component, four call sites, the stories module consuming the feed module's list rather than copying it. |
| P-05-13 | 05-08 | "Pinning must not be presented as a form awaiting a save. STORY-04 is a set of independent facts, one row per community, and a save button would invent a transaction the schema does not have — leaving the admin to believe a half-failed batch either fully applied or fully did not." | carried | `packages/modules/stories/ui/PinStorySheet.tsx:181` renders a `Switch` per row; lines 7-18 state one request per switch and that a `Salvar` "would invent a transaction the schema does not have"; line 57 records that `onSelect` is deliberately absent because the switch IS the control. No submit button and no `Salvar` string in the file. | Appears honoured. A human should confirm a failed individual toggle reverts only its own row. |
| P-05-14 | 05-08 | "A story's expiry must not become a gate on interaction. A member who can see a pinned story must be able to like and comment on it; an affordance that renders and then refuses is worse than one that was never drawn." | carried | `packages/modules/stories/server/service.ts` — `likeStory` (477) keys on `s.id = … and s.deleted_at is null` (483, 489), `unlikeStory` (513) the same (517, 523), `listStoryComments` (691) on `s.id … and s.tenant_id …` (704), `createStoryComment` (761) likewise. **No `expires_at` predicate on any interaction path**; `expires_at > now()` appears only in the strip read (`listActiveStories`, line 206). | Appears honoured — the expiry predicate is confined to the one read it belongs to, and every interaction path was checked individually. |

---

## Section 3 — The 5 backstop claims and the 4 device checks

### 3a. Backstop visual claims (`verification: backstop`, abstain reason `insufficient_spec`)

All five are declared `verification: backstop` in their source plans with no automated evidence
anywhere in the phase. Per the abstain rule they route to a human unchanged. **Gap closure converted
none of these** — 05-09, 05-10 and 05-11 touched no layout, no type scale and no truncation rule.

| Id | Source | Claim (verbatim) | Disposition |
|---|---|---|---|
| B-05-01 | 05-04 | "A 60-character community name at 24/700 on a 320px viewport wraps to at most three lines without clipping the cover above it" | open — needs a 320px viewport |
| B-05-02 | 05-05 | "A tenant display name of 40 characters does not reach the strip (the strip carries no tenant string), while the `/inicio` welcome heading above it does — pinned together with the Phase 2 backstop for that heading" | open — needs a 320px viewport; the first half ("the strip carries no tenant string") is greppable, the second half inherits a Phase 2 backstop that is itself unverified |
| B-05-03 | 05-06 | "A 25-story sequence at 320px keeps every progress segment at least 2px wide and does not wrap the bar row" | open — needs a 25-story sequence at 320px |
| B-05-04 | 05-08 | "A 90-character story caption and a 40-character community name in the same history row at 320px both truncate with a title attribute while the row keeps its minimum height" | open — needs a 320px viewport with long fixture content |
| B-05-05 | 05-08 | "Twelve communities with 40-character names in the pin sheet each truncate while the switch stays fully reachable inside the 80%-height sheet" | open — needs twelve long-named communities in the pin sheet |

### 3b. Device checks (`05-VERIFICATION.md` → `### Human Verification Required`, items 1-4)

| Id | Verifier item | Test / Expected | Disposition | Evidence or reason |
|---|---|---|---|---|
| H-05-01 | 1. Real-device profile of the viewer on an image story | Open the viewer on a phone (or a mobile emulation profile) on a story whose image is cached and decoded; watch CPU and memory for 30 s. **Expected:** the bar fills smoothly and the tab is idle between frames. | **partially covered** | **Covered half (the unbounded render loop):** 05-10 Task 1 fixed it at both ends and bounded it in a test — `packages/modules/stories/tests/story-viewer-media.test.tsx`, case `1. a decoded story image renders the real component, reports once, and lets the clock start` (line 229), which asserts a render-count ceiling (the counting wrapper throws at 400; settled is ~8) with the REAL `MediaImage` under the REAL `StoryViewer`, proved un-stubbed by an `<img>` whose `srcSet` names `/v1/media/asset-0/w320 320w`. Supported by `packages/core/tests/media-image.test.tsx` case `1. a decoded image under a caller that rebuilds both reports every render SETTLES` (line 123). **Open half (the device profile):** a render-RATE property under a real decoder on real hardware cannot be asserted by any check in this repo. 05-10 records it as coverage D7 `human_judgment: true`. **A ceiling is a bound, not a profile** — the 30 s device observation this item asks for is still required. |
| H-05-02 | 2. A video story in the viewer, end to end | Publish a VIDEO story as `admin_tenant`, wait for it to become ready, then open it from the `/inicio` strip. **Expected:** the segment fills from the video's own time and auto-advances, or closes, when the video ends. | **OPEN — not discharged** | The local video provider is `fake` with no real HLS stream and the seed fixture is image-only, so an e2e would assert over a player that cannot play. 05-11 proved the component chain and nothing further: `apps/web/components/stories/StoryVideo.test.tsx` (six cases, line 1 onward) for the bridge's own contract, and `apps/web/components/stories/StoryViewerHost.test.tsx` case 13 for a video segment filling to 50% off a forwarded `timeupdate` and then handing over — with `./StoryVideo` un-stubbed and `next/dynamic` deliberately left unmocked. 05-11 records this as coverage D8 `human_judgment: true` with the rationale "NAMED LIMITATION, carried forward rather than absorbed", and logged `.planning/WINDOWS.md` entry **42** (`unrun-verify`, `open`) for exactly it. **Nothing local can prove a real transcode plays.** This is not softened anywhere in this file. |
| H-05-03 | 3. A pinned, still-transcoding story on a community page | Pin a story whose video is still transcoding to a community, then open its Destaques circle. **Expected:** an error or placeholder with a reachable close control — never a permanent loading state. | **converted** | **Test file:** `packages/modules/stories/tests/story-viewer-media.test.tsx`. **Case:** `4. CR-03: a story with an EMPTY variant ladder reaches the error state and is not consumed` (line 287) — asserts the media-error test id, the retry, a **focusable close**, fill at 0% and the story index unchanged after 2× the story duration, i.e. exactly "not a permanent loading state" and "a reachable exit". Component-level support: `packages/core/tests/media-image.test.tsx` case `2. an EMPTY variant ladder reports FAILURE exactly once and renders the fallback (CR-03)` (line 134) and case `3. an image that decoded to ZERO natural width reports FAILURE exactly once` (line 148). The empty ladder is the exact shape a still-transcoding pinned asset takes, because `listCommunityHighlights` deliberately omits the `status = 'ready'` filter. | Converted. A human may still want to see it once on the real surface, but the behaviour the item asks about is now asserted. |
| H-05-04 | 4. The play badge and the media-error retry | In the viewer, tap the centred play badge on a blocked-autoplay video, and tap the retry under the media-error copy. **Expected:** the badge starts playback and the retry re-attempts the media — neither advances to the next story. | **converted (same partial as P-05-10)** | **Test file:** `packages/modules/stories/tests/story-viewer.test.tsx`. **Cases:** `12a` (line 420), `12b` (line 445), `12c` (line 464). 12a asserts the host's `onRequestPlay` spy fired once and the story index did not move (the plan's `data-play-attempt` attribute is unreadable because the tap unmounts the badge — see `05-10-SUMMARY.md` adjustment 2); 12b asserts the retry re-mounts the media without advancing; 12c asserts a media tap still advances, so 12a/12b cannot pass over a broken pipeline. This is the SAME claim as P-05-10 and is discharged by the SAME three cases. | Converted for both controls. The error-**copy** transparency (`pointer-events-none`) is the named hole — happy-dom does not hit-test, so it is real-browser-only; `05-10-SUMMARY.md` records it as coverage D6 `deferred`. A human doing this check should tap the copy too. |

---

## Section 4 — What gap closure ADDED

Plans 05-09, 05-10 and 05-11 author **8 new prohibitions** of their own, all
`status: unverified` / `verification: flagged` by construction — exactly as the original 14 were when
their plans were written. They enter the NEXT verification flagged and fail closed there. This
section exists so the next reader finds the second set stated rather than discovering it the way the
first set was discovered.

| Id | Source | Statement (verbatim) |
|---|---|---|
| N-05-01 | 05-09 | "A refusal must never reveal that the supplied asset exists somewhere else. No tenant slug, no owner, no asset status, no 'belongs to another organisation' phrasing may reach the response body or the client — a member of one organisation learning the shape of another's media library is the exact leak the product's core value names." |
| N-05-02 | 05-09 | "A refused cover must never be silently dropped, nulled or substituted so the write can proceed. A create that quietly stores no cover, or an edit that quietly keeps the old one, tells the admin their intent was honoured when it was not — a refusal the admin cannot see is worse than the unvalidated write it replaces." |
| N-05-03 | 05-09 | "A refused foreign asset id must never be written into this tenant's log line. The phase's logging rule already says lengths and flags rather than words; an identifier minted inside another organisation is content of theirs, and copying it into this tenant's log is a leak that outlives the request." |
| N-05-04 | 05-10 | "The fix must never make the viewer advance past a story whose media never rendered. A story the member did not see must stop and say so; consuming it silently means the product decided on their behalf that they had watched something they had not." |
| N-05-05 | 05-10 | "A story that cannot render must never leave the member without a reachable exit. Whatever state the media lands in, the close control stays focusable and operable — a full-screen surface with no way out is a trap, not an error state." |
| N-05-06 | 05-10 | "Progress must never be fabricated. A segment may only fill from a real signal — elapsed time for an image that has decoded, the element's own reported time for a video — and never from a wall-clock substitute standing in for a signal that did not arrive. A bar that fills over a frozen frame tells the member a lie about what they are watching." |
| N-05-07 | 05-11 | "A video segment must never be driven by a substitute clock. If the element's own time does not arrive, the correct behaviour is a bar that does not move and a state that says so — not a timer standing in for a signal that never came. A bar filling over a frozen frame tells the member they are watching something they are not." |
| N-05-08 | 05-11 | "The playback token must never be cached, persisted or reused. It is minted per request for one viewing; putting it in a cookie, a router cache, a log line or a payload turns a scoped credential into a durable one that outlives the member's session with it." |

**Executable evidence already pointing the right way** (recorded by the source SUMMARYs, and still not
a resolution): N-05-04 by `story-viewer-media.test.tsx#4` (index unchanged after 2× the story
duration); N-05-05 by the focusable close in the same case; N-05-07 by the zero/non-finite duration
guard at both levels (`StoryVideo.test.tsx#2`, `StoryViewerHost.test.tsx#13`). N-05-01 through
N-05-03 have the `isolation.test.ts` case b5 refusal assertions behind them (no `details` key, the
two refusal bodies equal by `JSON.stringify`). N-05-06 and N-05-08 are unchanged by any gap-closure
plan and rest on the existing gates.

---

## Arithmetic

| Set | Count |
|---|---|
| Flagged prohibitions carried from 05-01 … 05-08 (section 2) | **14** |
| Declared `backstop` visual claims (section 3a) | **5** |
| Device checks requiring real hardware (section 3b) | **4** |
| **Total unresolved items assembled here** | **23** |

Of the 23: **3 converted** (P-05-10, H-05-03, H-05-04 — two of which are the same claim seen from two
sides), **1 partially covered** (H-05-01: the render bound is automated, the device profile is not),
**1 explicitly open and not closable locally** (H-05-02, the video story end to end), and **18
carried** to a human unchanged (13 prohibitions + 5 backstop claims).

Separately, gap closure **added 8** new flagged prohibitions (section 4), which enter the next
verification as the original 14 entered this one.

**Nothing in this file resolves anything.** Every row is input to a human decision.
