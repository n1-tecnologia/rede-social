# Phase 5: Communities & Stories - Context

**Gathered:** 2026-09-23
**Status:** Ready for planning

> Decision numbering continues from Phase 4 (D-01..D-24 in `01-CONTEXT.md`, D-25..D-42 in `02-CONTEXT.md`, D-43..D-50 reserved by `03-CONTEXT.md`, D-51..D-65 reserved by `04-CONTEXT.md` of which D-51..D-62 are used) because code comments already cite those ids; this phase owns **D-66..D-85**.

<domain>
## Phase Boundary

Phase 5 gives the tenant two ways to organise and broadcast the content Phase 4 taught it to publish: **communities** (a durable container a post can belong to) and **stories** (a 24 h ephemeral channel). Both are published by `admin_tenant` and consumed by members, and both reuse the Phase 4 content conventions rather than inventing new ones.

- **Communities (COMM-01..COMM-04):** `admin_tenant` creates, edits and archives a community (name, description, cover image) and posts into it from its page. Members browse a `Comunidades` tab listing every community (COMM-02 — all members see all communities in V1, while a `community_members` table is born unused for V2) and open one to see its posts and its pinned stories. The main feed shows tenant-wide posts **plus** community posts, which is what makes `feed_posts.community_id` — reserved with its own index in Phase 4 — finally carry values.
- **Stories (STORY-01..STORY-05):** `admin_tenant` publishes an image or a short video (~60 s, through the Phase 3 Mux broker) with an optional caption, from a phone. Members see active stories in a horizontal strip on `/inicio` and open a full-screen viewer with progress bars, auto-advance, tap-to-navigate and hold-to-pause. A story leaves the strip 24 h after publishing by an `expires_at` predicate (no cron, roadmap-locked) while the record is retained; a story pinned to one or more communities stays visible on those community pages after expiry until unpinned. Members can like a story and comment on it flatly — a like on a story comment and a reply to a story comment are refused by the API **and** by the database.

Out of this phase: events (Phase 6); notifications generated from the domain events emitted here, Web Push and support chat (Phase 7); moderation of other people's comments, blocking and the tenant admin panel (Phase 8); member-created communities and private/opt-in communities (V2-CONT-02, which is why `community_members` exists now).

</domain>

<decisions>
## Implementation Decisions

### The design already exists — port it

- **D-66:** **`reference/frontend-design/` is the source for every Phase 5 surface that it covers, and the researcher/planner go there before designing anything.** Verified on 2026-09-23, the prototype already provides: the community list (`app/(app)/community/page.tsx` — the `card-magazine` cover card with its gradient, overlaid name and tagline, counts row and chevron), the community page (`app/(app)/community/[communityId]/page.tsx` — cover, overlapping avatar, credit line, tagline, **the horizontal highlights circle row**, posts), a community post detail (`.../[topicId]/page.tsx`), and — critically — `app/(app)/reels/page.tsx`, the pointer-driven vertical pager with dominant-axis lock, 60 px threshold, `translateY(-i*100%)` with rubber-band `dy*0.35`, **side progress ticks**, pre-mounted neighbours and a mute toggle, which is the story viewer's gesture model. Reusable primitives already ported: `DoubleTapHeart`, `BottomSheet`, `Tabs`, `Avatar`, `EmptyState`, `InfiniteScroll` (in `@rede-social/ui`), plus `CommentSheet`/`CommentsList`/`CommentInput` and `LikeButton` (in `@rede-social/module-feed`).

  **Exactly five Phase 5 surfaces are genuinely absent from the prototype** and are therefore the only ones that need a D-33 UI-SPEC + mockup review: (1) the stories strip, (2) the story viewer screen, (3) the admin's story publish flow, (4) the community create/edit/archive form, (5) the pin-a-story-to-a-community flow. Everything else is a port, not a design. — **Reversibility:** reversible — but treating a covered screen as prototype-less wastes a design-review cycle and risks drifting from the visual language the pilot tenant already signed off on.

### Communities — the community page

- **D-67:** A community page header is **cover + name + description, with no human "owner" credit**. The prototype's overlapping `OWNER` avatar, the "por {nome}" line and `VerifiedBadge` are not ported (`VerifiedBadge` is already on PROTOTYPE.md's do-not-port list). A community belongs to the organisation; D-52 already puts a face on every post inside it, so a second byline on the container would compete with the real one. No `created_by` value is surfaced in the read, which also means a community never inherits the nullable-author problem Phase 4 had to solve for comments. — **Reversibility:** reversible — a creator byline is an additive column read plus one header row.
- **D-68:** The **pinned-stories row is a horizontal circle strip directly under the header, above the first post** — the prototype's exact "Destaques" position. This is the V1 answer to **PROTOTYPE.md open question 1** ("should the community highlights circles be the pinned-stories UI?"): **yes**, and the design team should be told that the circles now open the story viewer instead of opening nothing. No tabbed community page.
- **D-69:** The **cover image is optional**. A community with no cover renders a **brand-gradient block with its name on it**, derived from the D-25 `primary`/`secondary` pair via `color-mix` the same way the CTA gradients already are — not the prototype's neutral `bg-tertiary`, so a coverless community reads as unfinished rather than broken. The admin can create a community without waiting on an upload and add the art later. — **Reversibility:** reversible — making the column `not null` later needs a backfill of existing rows, which is why it starts nullable.
- **D-70:** The admin posts into a community through an **`admin_tenant`-only FAB on the community page that navigates to `/criar` with the community pre-filled** — the same `ComposeFab` D-57 built for `/inicio`. There is no second composer: multi-image upload, link resolution and PDF attachment are why D-57 rejected sheet-sized composers, and a community is a parameter the composer accepts, not a different screen. COMM-04 is a pre-filled case of the existing flow. — **Reversibility:** reversible.

### Communities — how community posts behave in the feed

- **D-71:** A community post in the main feed carries a **tappable "em {Comunidade}" line in the post header's second row**, navigating to the community. Criterion 1 mixes two sources into one list, so without the label a member cannot tell why a post is there — and the label is the discovery path into the community. On the community page itself the label is suppressed (it would restate the page). This closes PROTOTYPE.md's noted gap "no community label on post".
- **D-72:** The admin chooses a community in **both places, through one optional "Publicar em" picker in `/criar`** that defaults to the tenant-wide feed and arrives pre-selected when the composer was opened from a community's FAB (D-70). **A published post cannot be moved between communities** — moving it would change which feed it lives in after members have already seen and liked it, and would make `community_id` an editable field in the D-57 edit flow. A mis-placed post is deleted and reposted. — **Reversibility:** costly — "Mover para…" later means deciding what happens to the likes, comments and share links a post already accumulated in its old placement.
- **D-73:** The main feed shows **all community posts mixed in, strictly chronological** — roadmap criterion 1 verbatim: tenant-wide posts OR posts from communities the member can see, newest first. Because COMM-02 makes every member a viewer of every community, the V1 predicate is simply "no community filter", and the query is served by the index Phase 4 already built for exactly this moment: `feed_posts_tenant_community_created_idx` on `(tenant_id, community_id, created_at desc, id desc)`. No ranking, no per-page cap on community posts — D-62's lesson is that anything but a stable ordered expression cannot be keyset-paginated. — **Reversibility:** costly — the ordering expression and its index are the feed's contract; changing it invalidates every outstanding cursor.
- **D-74:** When a tenant turns the **`communities` module off**, the main feed predicate **reverts to `community_id is null`** — which is the partial index `feed_posts_tenant_created_idx` Phase 4 already built and has been using all along. Community posts stop appearing, the `Comunidades` tab disappears, the rows are untouched, and re-enabling the module restores everything. The module flag is the single switch; nothing else branches.

### Communities — the list

- **D-75:** A community list card shows **COMM-03's four fields only: cover, name, description, post count**, in the prototype's `card-magazine` layout. The prototype's "3 novos posts" / "Novas interações" activity badge and its member count are **both dropped** — the badge needs a per-user read-marker table nothing in V1 builds, and a member count is meaningless while COMM-02 puts every member in every community.
- **D-76:** The list lives at **`/comunidades` behind the `Comunidades` nav tab D-55 already reserved**, ordered by **most recent post activity** (a stable expression over an aggregate, so it pages), and **keyset-paged on the existing envelope** — `packages/core/server/paging.ts` plus the `@rede-social/ui` `InfiniteScroll` that already takes its IntersectionObserver root from `ScrollContainerContext`. Nothing new is built for paging; the list simply cannot break the day a tenant has sixty communities.
- **D-77:** A tenant with no communities yet shows the ported **`@rede-social/ui` `EmptyState` with pt-BR copy, and the tab stays visible** — navigation is driven by the module flag, never by data (the rule D-40 built the whole shell on). An `admin_tenant` additionally sees the "Criar comunidade" action on that screen, so the empty state is also the creation entry point.

### Stories — the strip and publishing

- **D-78:** **One circle per active story**, newest first, each showing its own thumbnail; tapping any circle opens the viewer at that story and auto-advances through the rest. Not the Instagram per-publisher grouping: V1 has a single publisher (`admin_tenant`), so grouping would collapse the strip to exactly one circle forever, which reads as a bug. — **Reversibility:** costly — V2 member stories will want per-publisher grouping, and that is a change to the strip's query shape and to what the viewer treats as a sequence, not just to the component.
- **D-79:** **No seen/unseen ring state in V1.** Every active story renders with the same ring, and newest-first order is what tells the member what is new. A seen ring needs a per-user `story_views` table and a write on every story open — the same read-marker mechanism D-75 just rejected for community cards, and keeping both out holds one rule across the phase. A device-local `localStorage` variant is also rejected: it disagrees between a member's phone and desktop and is lost on PWA reinstall. — **Reversibility:** reversible — a views table is additive, and it is the same table a future "quem viu" admin list would need.
- **D-80:** The admin publishes from the **strip's leading "+" circle ("Seu story")**, visible only to `admin_tenant`, opening a full-screen publish route. This is the position every user already knows, and it keeps the feed's existing `ComposeFab` a one-tap button for the thing the admin does most. Members never see the circle.
- **D-81:** The publish flow is **pick media → caption → publish** on a full-screen route: the picker opens into the camera roll, the chosen image or video fills the screen, an optional caption overlays it, one "Publicar" button. It reuses the Phase 3 `useSignedUpload` path — including the Mux direct-upload branch that skips `complete` (03-07) and the "processando" state for video. A story is **not editable after publishing** (consistent with every other V1 content type except a post's text), so the caption is part of the publish step, never added afterwards.

### Stories — comments and history

- **D-82:** A member comments through the ported **`CommentSheet` sliding over the viewer, and the story pauses while the sheet is open**. It is D-59's same component in its second container, rendering **`CommentsList` in a flat variant** — no reply affordance, no comment `LikeButton`. STORY-05 is therefore a prop on the existing list, not a second list implementation, and the API/DB refusals back it up rather than the UI hiding it. The inline "send-only" bar (comments nobody can read) and a separate `/story/[id]` page (which would break the auto-advance sequence the viewer exists for) are both rejected.
- **D-83:** Story comments run **oldest → newest**. A flat list with no threads is one conversation, so it runs forward in time — exactly what D-62 chose for replies *inside* a post thread. D-62's newest-first applies to root comments because that list is a ranking of threads, and a story has no threads. New comments land at the bottom while the sheet is open. One keyset direction, one index.
- **D-84:** Expired stories live in an **admin-only "Seus stories" list**, reachable from the strip's "+" circle, showing the tenant's stories newest first with thumbnail, date, like and comment counts, and pinned state. **This screen is also where pin/unpin lives** (STORY-04) and where a story is deleted — which makes it the home of the one Phase 5 flow with no prototype at all, instead of scattering the pin action across the viewer and the publish flow. Rejected: a grid on the admin's own `/perfil`, because D-45 deliberately stripped the profile to photo, name and bio and this is tenant content, not personal content.

### Claude's Discretion

Everything below was not selected for discussion or was explicitly left to Claude. Decide it during research/planning, record the choice, and pin the behaviour with tests — do not re-ask the user.

**Archiving a community (COMM-01) — not selected for discussion**
- What archive *means*: whether its posts leave the main feed (D-73's predicate) or stay, whether the community page still opens by direct link, what happens to its pinned stories, and whether archive is reversible. Constraint: whatever is chosen must be expressible as a predicate on the same feed query, not as a second query path.
- Whether archive is a `status` column or an `archived_at` timestamp (SCHEMA-CONVENTIONS prefers the soft-delete/`status` shape), and whether an archived community can still be posted into.

**The story viewer (STORY-02) — not selected for discussion**
- The gesture and timing model, built against `reference/frontend-design/app/(app)/reels/page.tsx`: image duration (the prototype's unused `STORY_DURATION_MS = 5000` is the design team's own number), video duration = its own length, progress bars, tap-left/tap-right zones, hold-to-pause, swipe-down to dismiss, whether the sequence loops or closes at the end, and what happens when a story expires mid-view.
- Where the like and comment affordances sit in the overlay, and how `DoubleTapHeart` behaves over a playing video.
- Pre-mounting neighbours (the reels pager already does this) versus lazy media loads, and the mute/unmute default for story video.

**Pinning mechanics (STORY-04) — not selected for discussion**
- The pin table shape (a `story_community_pins` join carrying `tenant_id`, the story and the community) and how the "pinned stories stay after expiry" rule is expressed — a pin row overriding the `expires_at` predicate in the community query, not a second `stories` column.
- Whether a pinned expired story stays likeable and commentable, and what its circle looks like versus an active one.
- Whether the community page's circle row shows active *and* pinned stories together or pinned only.

**Schema, API and V2 safety**
- The `communities` table, `community_members` (born unused for COMM-02/V2-CONT-02), `stories` and the pin join — all under `packages/core/docs/SCHEMA-CONVENTIONS.md`: `tenant_id` first in every index, RLS plus a policy on every table, generic `author_user_id` on stories, nullable-FK targets, soft-delete/`status` columns.
- **Wiring the Phase 4 slots**: adding the real FKs to `feed_posts.community_id`, `feed_comments.story_id` and `feed_likes.story_id` — these columns exist and carry checks, so Phase 5 adds the references and nothing else.
- **Enforcing STORY-05 declaratively.** Today `feed_comments_parent_shape_chk` allows `depth = 1` regardless of target, and `feed_likes_comment_uq` allows a like on any comment. The roadmap requires both refusals in the API *and* the DB. Favour the Phase 4 posture — an index-level or CHECK-level fact with no read-then-write window (the way the one-reply-level rule and D-53's gallery-XOR-video rule were expressed) over a trigger or a security-definer function. A composite-FK trick similar to `feed_comments_parent_fk` is the likely shape for "a reply's parent must be a post comment"; the like case needs the target comment's `story_id` to be visible to the constraint.
- The story length rule (~60 s) on the same `MEDIA_LIMITS` mechanism Phase 3 built and Phase 4 reused, and the `expires_at` column versus a computed predicate (the roadmap says `expires_at`).
- Domain events for this phase (`community.created`, `story.published`, `story.liked`, …) declared through the `EventMap` declaration-merging point in `packages/contracts/src/events.ts`, with payloads that carry what a Phase 7 notification row needs without a re-read.
- Whether `@rede-social/module-communities` and `@rede-social/module-stories` are two packages or one, given they are two registry keys (`communities`, `stories` already exist in `packages/contracts/src/modules.ts`) and D-74 makes the feed depend on the communities flag. Module-to-module dependency must go through published contracts only (MOD-02, enforced by the boundary lint and `packages/boundary-fixture`).

**UI and composition**
- Where the stories strip sits on `/inicio` relative to the D-02 profile nudge and the feed home slot (`ModuleHomeSlot.order`), and what it does on desktop under D-39's rail + centred column.
- Empty states and skeletons for the strip, the community page and the community post list; what the strip renders when no story is active (hidden entirely, or the "+" alone for an admin).
- The community create/edit form itself, and the story publish screen — both prototype-less, both through the D-33 UI-SPEC + `/gsd-sketch` mockup review with the design team before being coded, alongside the strip, the viewer and the pin flow (D-66).
- pt-BR catalog namespaces for the two modules; no string literals (`scripts/check-ui-literals.sh`).

**Test strategy**
- Extending the two-tenant pgTAP + API isolation suite with `communities`, `stories`, the pin join and the new comment/like targets — every case asserting its positive control in the same test (03-08).
- Negative tests for STORY-05 at both layers, and for a story comment attempting `depth = 1`.
- The expiry predicate under a clock the test controls, and the pinned-survives-expiry case.
- Playwright on a mobile viewport for the strip, the viewer's tap/hold/advance gestures, the comment sheet pausing playback, and the community tab → page → post path.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 5: Communities & Stories" — the goal, the five success criteria, and the Notes: posts scoped via `community_id`, feed query = tenant-wide OR visible community, the strip query is `expires_at > now()` with **no cron**, and the admin story history view is in scope
- `.planning/ROADMAP.md` §Overview "Cross-cutting rules carried by every phase" — the two-tenant isolation suite as the exit gate, the schema conventions doc, the module package + registry rules, the design-language rule (UI-01/UI-04), the pt-BR catalog rule, and the Supabase Free-plan constraint
- `.planning/REQUIREMENTS.md` — COMM-01..COMM-04, STORY-01..STORY-05 (exact wording); **V2-CONT-02** (members create communities; private/opt-in communities reuse COMM-02's membership table) and V2-CONT-03 (pinned community posts) for what the schema must not preclude
- `.planning/PROJECT.md` §Key Decisions — "Stories are soft-expired (hidden after 24 h, never deleted)", "Pinned stories outlive the 24 h expiry in their community", "Communities: all members see all communities in V1; `community_members` table exists for V2", "Comments allow one reply level on posts, none on stories"

### Prior decisions this phase builds on
- `.planning/phases/04-feed/04-CONTEXT.md` — **D-51** (one post model, no titles or type chips — the `CommunityTopic` concept from the prototype is retired), **D-52** (posts are attributed to the person, which is why D-67 gives the community no second byline), **D-53** (gallery-XOR-video, DB-enforced), **D-54** (plain text + render-time linkify), **D-55** (feed is a home slot; the `Comunidades` tab budget this phase spends), **D-56** (`/post/[id]` share target), **D-57** (full-screen `/criar`, reused by D-70/D-72), **D-59** (two comment surfaces, one `CommentsList` — extended to a flat variant by D-82), **D-61** (a member soft-deletes their own comment), **D-62** (comment ordering; D-83 explains why a story's flat list differs)
- `.planning/phases/03-media-pipeline-member-profiles/03-CONTEXT.md` — **D-43/D-44** (Mux with a signed playback policy and a short-lived per-request playback JWT — story video rides this unchanged), **D-45** (profiles carry no role badge and no tenant content, which is why D-84 rejects a story grid on `/perfil`)
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-CONTEXT.md` — **D-33** (UI-SPEC + static mockup approved with the design team before prototype-less screens are coded — the five surfaces named in D-66), **D-40** (nav tabs come from the registry `nav` entries of *enabled* modules; `stories` declares no nav entry), **D-42** (`/inicio` home slots — where the strip registers), **D-25** (the `primary`/`secondary` brand pair D-69's gradient fallback derives from), D-39 (desktop rail + centred column), D-41 (light/dark tokens)
- `.planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-CONTEXT.md` — D-09 (stable machine error codes in the envelope — the STORY-05 refusals need one), D-16/D-17 (`communities` and `stories` are toggleable modules, on by default), D-18 (`@rede-social/*` package layout)
- `.planning/STATE.md` §Accumulated Context → Decisions — especially the Phase 4 entries on the declarative one-reply-level constraint, `feed_likes` nullable typed FKs, trigger-owned counters, `.desc().nullsFirst()` on DESC keyset indexes, the `requirePermission` (never `requireRole`) rule, and `InfiniteScroll`/`ScrollContainerContext` living in `@rede-social/ui` **specifically so Phase 5's community list can reuse them**

### Design — the prototype is the visual source of truth (D-66)
- `reference/frontend-design/app/(app)/community/page.tsx` — the community list card: `card-magazine`, 16/7 cover, gradient, overlaid name + tagline, counts row, chevron. Port; drop the activity badge and member count (D-75).
- `reference/frontend-design/app/(app)/community/[communityId]/page.tsx` — the community page: cover, `-mt-10` overlapping avatar, credit line, tagline, **the "Destaques" circle row (`w-16 h-16 rounded-full border-2`)**, posts. Port the layout and the circle row (D-68); drop the owner block (D-67).
- `reference/frontend-design/app/(app)/community/[communityId]/[topicId]/page.tsx` — community post detail; superseded by `/post/[id]` (D-56) but useful for the page's header treatment.
- `reference/frontend-design/app/(app)/reels/page.tsx` — **the story viewer's gesture model**: pointer-driven pager, dominant-axis lock, 60 px threshold, `translateY(-i*100%)`, rubber-band `dy*0.35`, side progress ticks, pre-mounted neighbours, mute toggle, status-bar ink override.
- `reference/frontend-design/components/members/VideoPoster.tsx` — tap-to-pause poster, the closest thing to a story media surface.
- `reference/frontend-design/lib/constants.ts` — `STORY_DURATION_MS = 5000` and `STORY_EXPIRY_HOURS = 24`, the design team's own numbers, unused in the prototype.
- `reference/frontend-design/components/ui/` and `components/comments/` — `DoubleTapHeart`, `BottomSheet`, `Tabs`, `Avatar`, `EmptyState`, `CommentSheet`, `CommentInput`. All already ported (`packages/ui/src/`, `packages/modules/feed/ui/`).
- `.planning/research/PROTOTYPE.md` §4 (routes `/community`, `/community/[id]`), §5 (port notes), §9 rows **communities (M)** and **stories (L)** — the port plan and what must be built new, §10 **open question 1** (answered by D-66/D-68), §11 the do-not-port list (`VerifiedBadge`, `CommunityTopic`, `CommentRow`)
- `.planning/sketches/MANIFEST.md` — the design language and the D-33 review pattern (sketches 001 and 002 are the Phase 2 and Phase 4 precedents). ⚠ No `sketch-findings-*` skill is packaged, so read the manifest directly.
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-UI-SPEC.md` and `.planning/phases/04-feed/04-UI-SPEC.md` — the Copywriting Contract and Visual Anchors every designed screen is drawn from

### Architecture, schema and pitfalls
- `packages/core/docs/SCHEMA-CONVENTIONS.md` — `tenant_id` first in every index, RLS on every table, admin-lane-only writes, soft-delete columns, generic `author_user_id`, §(e).3 nullable typed-FK targets (the shape `feed_likes` and `feed_comments` already use for their story slots)
- `.planning/research/PITFALLS.md` §Pitfall 1 (service role kills RLS), §Pitfall 9 (V2-safe schema conventions), and the N+1 / query-budget concern the feed's CI check already enforces
- `.planning/research/STACK.md` §Stack Pattern 2 (Hono module layout, per-request tenant lane), §Stack Pattern 3 (drizzle-kit generate → Supabase CLI applies, `api_user` role)
- `.planning/research/ARCHITECTURE.md` §Pattern 1 (two lanes) and §Recommended Project Structure
- `.claude/CLAUDE.md` §"What NOT to Use" — no `@supabase/supabase-js` in the browser for data, no uploads through Cloud Run

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/modules/feed/db/schema.ts` — **the Phase 4 slots this phase fills**: `feedPosts.communityId` (nullable, no FK yet) with `feed_posts_tenant_community_created_idx` on `(tenant_id, community_id, created_at desc, id desc)` built for D-73's query and `feed_posts_tenant_created_idx` partial on `community_id is null` for D-74's fallback; `feedComments.storyId` under `feed_comments_target_chk` (`num_nonnulls(post_id, story_id) = 1`); `feedLikes.storyId` under `feed_likes_target_chk` and the partial `feed_likes_story_uq`. Every docblock names Phase 5 as the inheritor.
- `packages/modules/feed/ui/` — `PostCard`, `PostHeader` (the second header row D-71's community label lands in), `PostMedia`, `PostActions`, `LikeButton`, `CommentSheet`, `CommentsList`, `CommentItem` (the flat variant D-82 needs is a prop here), `CommentInput`, `ComposeFab` (D-70), `linkify`, `sharePost`.
- `packages/ui/src/` — `InfiniteScroll` + `useInfiniteScroll` reading `ScrollContainerContext` (put there in Phase 4 **explicitly so the Phase 5 community list could reuse them**), `BottomSheet`, `DoubleTapHeart`, `Tabs`, `Avatar`, `EmptyState`, `Chip`, `PageHeader` (note 03-05: pass `stickyTop=0px` inside a padded scrollport), `Skeleton`, `FileDropZone`.
- `packages/core/server/paging.ts` — the ONE keyset cursor envelope (opaque base64url `{v,n,id}`, ordered by the expression the index carries, over-fetch `limit+1`, clamp server-side). D-76's community list and both story comment directions ride it. Do not write a second envelope.
- `packages/core/server/media` + `apps/web/app/v1/media/[assetId]` — the `GET /v1/media/{id}/{variant}` broker every community cover, story thumbnail and story image goes through; `VideoProvider`/`mux.ts` and the per-request playback token (D-44) for story video; `useSignedUpload` with the provider-owned branch that skips `complete` (03-07).
- `packages/core/server/modules/manifest.ts` — `ModuleNav` (`placement: 'tab'` for D-76's Comunidades entry) and `ModuleHomeSlot` (`order`, for the strip); `apps/web/lib/registry.tsx` is the composition point that supplies a renderer per module key, so the kernel still imports no module UI (MOD-02).
- `packages/core/server/tenancy` → `membershipOfRecord`; `packages/core/server/events/bus.ts` + `packages/contracts/src/events.ts` (`EventMap` declaration merging); `packages/core/server/jobs/boss.ts` if any job is needed.
- `packages/contracts/src/modules.ts` — `communities` and `stories` are **already in the module key vocabulary**, the route enum and `tenant_modules_key_chk`; Phase 4's 04-10 removal work proved the add/remove path end to end.

### Established Patterns
- **Three-layer tenant scoping**: JWT/membership check → explicit `tenant_id` predicate → RLS under `authenticated` inside a per-request transaction. Cross-tenant reads live only in `packages/core/server/platform/*`, confined by Biome.
- **Write guards are `requirePermission('<module>.<thing>.<verb>')`, never `requireRole`** (04-01) — the V1 rule lives in `tenant_modules[key].settings`, so V2 member-created communities and member stories stay one UPDATE with no migration and no route edit.
- **Rules that must hold are expressed declaratively in the schema** — the one-reply-level composite FK, D-53's gallery-XOR-video index+FK+CHECK, partial unique indexes as the idempotency arbiter for likes. STORY-05 belongs in this family, not in a trigger.
- **Counter columns are written only by triggers**, and a soft-delete transition moves the number.
- **A DESC keyset index must be declared `.desc().nullsFirst()`** — drizzle's `.desc()` emits `DESC NULLS LAST`, which `order by … desc` cannot use.
- **Every cross-tenant isolation case asserts its positive control in the same test** (03-08).
- **Migrations**: Drizzle schema → `drizzle-kit generate` → `supabase/migrations` → Supabase CLI applies; `tenant_id` first in indexes; every new table gets RLS plus a policy and `supabase/tests/010` asserts it.
- **pt-BR catalog only**, enforced by `scripts/check-ui-literals.sh`; `pnpm verify` is the local exit gate (Phase 4 baseline ~21m51s: unit 512, pgTAP 191, integration 373, e2e 328).
- **Server-action pagination is the one paging paradigm** (04-06) — no client data-cache library; Phase 7 is where that is revisited.

### Integration Points
- `packages/modules/communities/` and `packages/modules/stories/` (new) → `db/schema.ts`, `server/routes.ts` behind `requireModule`, `contracts/index.ts` (`EventMap` entries), `ui/`, `module.ts` (a `nav` tab for communities, a home slot for the stories strip).
- `packages/modules/feed/` → `feed_posts.community_id` gains its FK; the feed read gains D-73's predicate and D-74's module-flag branch; `PostHeader` gains D-71's label; `CommentsList` gains the flat variant; `/criar` gains the "Publicar em" picker.
- `packages/core/db/schema/index.ts`, `supabase/migrations/*`, `supabase/tests/*` → new tables, the STORY-05 constraints, counter triggers, RLS policies, the extended two-tenant isolation plan.
- `apps/api/src/modules/registry.ts` and `apps/api/src/worker.ts` → the two modules mounted in the tenant lane.
- `apps/web/app/(app)/` → new routes `comunidades/`, `comunidades/[id]/`, the story viewer, the story publish route and the admin "Seus stories" list; `inicio/page.tsx` gains the strip home slot.
- `apps/web/messages/pt-BR/` → `communities` and `stories` namespaces.
- `scripts/seed.ts` → seeded communities with covers and posts, active and expired stories, at least one pinned story, plus story likes and flat comments, so the strip, the community page, the isolation suite and the expiry predicate all have something to assert against.

</code_context>

<specifics>
## Specific Ideas

- **"Todo o design já está no folder `reference`."** The user restated this as a standing constraint during the discussion: go to the prototype first, port what is there, and design only the five surfaces it genuinely lacks (D-66).
- The community "Destaques" circles the design team drew become the real pinned-stories row and actually open the viewer — the prototype's circles open nothing.
- No owner byline on a community: the organisation owns it, and each post inside already shows a face.
- A community without a cover falls back to the tenant's own brand gradient, not grey.
- One circle per story, newest first — grouping would leave the pilot tenant with a strip of exactly one circle.
- The admin's "+" is the first circle in the strip, the position everyone already knows, and it is also the door to the story history where pinning lives.
- A story's comments are one conversation running forward in time, unlike the feed's ranking of threads.

</specifics>

<deferred>
## Deferred Ideas

- **Per-user read markers** — the prototype's "3 novos posts" / "Novas interações" badge on community cards (D-75) and seen/unseen story rings (D-79). Both need the same per-user marker table and a write on every open. Revisit alongside Phase 7's notification read state, which is the module that would naturally own it.
- **"Quem viu" a story (viewer list for the admin)** — not in the requirements; it is the same `story_views` table D-79 deferred.
- **Member count on a community card** — meaningless while COMM-02 puts every member in every community; becomes real with V2 private communities (V2-CONT-02).
- **Moving a published post between communities** — rejected by D-72; a mis-placed post is deleted and reposted in V1.
- **Admin-defined community ordering (a `position` column and a reorder UI)** — deferred by D-76 in favour of recent-activity ordering; revisit with V2 member-created communities.
- **A tabbed community page (Posts / Destaques)** — rejected by D-68; revisit only if a pilot community accumulates more pinned stories than a circle row can carry.
- **Editing a story after publishing** — rejected by D-81; a story is deleted and republished.
- **Member-created communities and private/opt-in communities** — V2-CONT-02. `community_members` is born in this phase precisely so that arrives as a policy change rather than a migration.
- **Pinned posts inside a community** — V2-CONT-03, not this phase.
- **Per-community notification preferences** — Phase 7 territory, and not in the V1 requirements.

</deferred>

---

*Phase: 05-communities-stories*
*Context gathered: 2026-09-23*
