# Phase 5: Communities & Stories - Research

**Researched:** 2026-09-23
**Domain:** Tenant-scoped content containers (communities) and a 24 h ephemeral broadcast channel (stories) on the existing Hono + Drizzle + Next 16 kernel, reusing the Phase 3 media broker and the Phase 4 feed/comment/like tables
**Confidence:** HIGH for the schema mechanics and the index/plan findings (all falsified against this project's local Postgres 17.6 this session); HIGH for the prototype port surface (read from disk); MEDIUM for the story-viewer timing/gesture model (prototype-less, D-33 gate); LOW for nothing that blocks planning

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

> Decision numbering continues from Phase 4 (D-01..D-24 in `01-CONTEXT.md`, D-25..D-42 in `02-CONTEXT.md`, D-43..D-50 reserved by `03-CONTEXT.md`, D-51..D-65 reserved by `04-CONTEXT.md` of which D-51..D-62 are used) because code comments already cite those ids; this phase owns **D-66..D-85**.

**The design already exists — port it**

- **D-66:** **`reference/frontend-design/` is the source for every Phase 5 surface that it covers, and the researcher/planner go there before designing anything.** Verified on 2026-09-23, the prototype already provides: the community list (`app/(app)/community/page.tsx` — the `card-magazine` cover card with its gradient, overlaid name and tagline, counts row and chevron), the community page (`app/(app)/community/[communityId]/page.tsx` — cover, overlapping avatar, credit line, tagline, **the horizontal highlights circle row**, posts), a community post detail (`.../[topicId]/page.tsx`), and — critically — `app/(app)/reels/page.tsx`, the pointer-driven vertical pager with dominant-axis lock, 60 px threshold, `translateY(-i*100%)` with rubber-band `dy*0.35`, **side progress ticks**, pre-mounted neighbours and a mute toggle, which is the story viewer's gesture model. Reusable primitives already ported: `DoubleTapHeart`, `BottomSheet`, `Tabs`, `Avatar`, `EmptyState`, `InfiniteScroll` (in `@tria/ui`), plus `CommentSheet`/`CommentsList`/`CommentInput` and `LikeButton` (in `@tria/module-feed`).

  **Exactly five Phase 5 surfaces are genuinely absent from the prototype** and are therefore the only ones that need a D-33 UI-SPEC + mockup review: (1) the stories strip, (2) the story viewer screen, (3) the admin's story publish flow, (4) the community create/edit/archive form, (5) the pin-a-story-to-a-community flow. Everything else is a port, not a design. — **Reversibility:** reversible — but treating a covered screen as prototype-less wastes a design-review cycle and risks drifting from the visual language the pilot tenant already signed off on.

**Communities — the community page**

- **D-67:** A community page header is **cover + name + description, with no human "owner" credit**. The prototype's overlapping `OWNER` avatar, the "por {nome}" line and `VerifiedBadge` are not ported (`VerifiedBadge` is already on PROTOTYPE.md's do-not-port list). A community belongs to the organisation; D-52 already puts a face on every post inside it, so a second byline on the container would compete with the real one. No `created_by` value is surfaced in the read, which also means a community never inherits the nullable-author problem Phase 4 had to solve for comments. — **Reversibility:** reversible — a creator byline is an additive column read plus one header row.
- **D-68:** The **pinned-stories row is a horizontal circle strip directly under the header, above the first post** — the prototype's exact "Destaques" position. This is the V1 answer to **PROTOTYPE.md open question 1** ("should the community highlights circles be the pinned-stories UI?"): **yes**, and the design team should be told that the circles now open the story viewer instead of opening nothing. No tabbed community page.
- **D-69:** The **cover image is optional**. A community with no cover renders a **brand-gradient block with its name on it**, derived from the D-25 `primary`/`secondary` pair via `color-mix` the same way the CTA gradients already are — not the prototype's neutral `bg-tertiary`, so a coverless community reads as unfinished rather than broken. The admin can create a community without waiting on an upload and add the art later. — **Reversibility:** reversible — making the column `not null` later needs a backfill of existing rows, which is why it starts nullable.
- **D-70:** The admin posts into a community through an **`admin_tenant`-only FAB on the community page that navigates to `/criar` with the community pre-filled** — the same `ComposeFab` D-57 built for `/inicio`. There is no second composer: multi-image upload, link resolution and PDF attachment are why D-57 rejected sheet-sized composers, and a community is a parameter the composer accepts, not a different screen. COMM-04 is a pre-filled case of the existing flow. — **Reversibility:** reversible.

**Communities — how community posts behave in the feed**

- **D-71:** A community post in the main feed carries a **tappable "em {Comunidade}" line in the post header's second row**, navigating to the community. Criterion 1 mixes two sources into one list, so without the label a member cannot tell why a post is there — and the label is the discovery path into the community. On the community page itself the label is suppressed (it would restate the page). This closes PROTOTYPE.md's noted gap "no community label on post".
- **D-72:** The admin chooses a community in **both places, through one optional "Publicar em" picker in `/criar`** that defaults to the tenant-wide feed and arrives pre-selected when the composer was opened from a community's FAB (D-70). **A published post cannot be moved between communities** — moving it would change which feed it lives in after members have already seen and liked it, and would make `community_id` an editable field in the D-57 edit flow. A mis-placed post is deleted and reposted. — **Reversibility:** costly — "Mover para…" later means deciding what happens to the likes, comments and share links a post already accumulated in its old placement.
- **D-73:** The main feed shows **all community posts mixed in, strictly chronological** — roadmap criterion 1 verbatim: tenant-wide posts OR posts from communities the member can see, newest first. Because COMM-02 makes every member a viewer of every community, the V1 predicate is simply "no community filter", and the query is served by the index Phase 4 already built for exactly this moment: `feed_posts_tenant_community_created_idx` on `(tenant_id, community_id, created_at desc, id desc)`. No ranking, no per-page cap on community posts — D-62's lesson is that anything but a stable ordered expression cannot be keyset-paginated. — **Reversibility:** costly — the ordering expression and its index are the feed's contract; changing it invalidates every outstanding cursor.
- **D-74:** When a tenant turns the **`communities` module off**, the main feed predicate **reverts to `community_id is null`** — which is the partial index `feed_posts_tenant_created_idx` Phase 4 already built and has been using all along. Community posts stop appearing, the `Comunidades` tab disappears, the rows are untouched, and re-enabling the module restores everything. The module flag is the single switch; nothing else branches.

**Communities — the list**

- **D-75:** A community list card shows **COMM-03's four fields only: cover, name, description, post count**, in the prototype's `card-magazine` layout. The prototype's "3 novos posts" / "Novas interações" activity badge and its member count are **both dropped** — the badge needs a per-user read-marker table nothing in V1 builds, and a member count is meaningless while COMM-02 puts every member in every community.
- **D-76:** The list lives at **`/comunidades` behind the `Comunidades` nav tab D-55 already reserved**, ordered by **most recent post activity** (a stable expression over an aggregate, so it pages), and **keyset-paged on the existing envelope** — `packages/core/server/paging.ts` plus the `@tria/ui` `InfiniteScroll` that already takes its IntersectionObserver root from `ScrollContainerContext`. Nothing new is built for paging; the list simply cannot break the day a tenant has sixty communities.
- **D-77:** A tenant with no communities yet shows the ported **`@tria/ui` `EmptyState` with pt-BR copy, and the tab stays visible** — navigation is driven by the module flag, never by data (the rule D-40 built the whole shell on). An `admin_tenant` additionally sees the "Criar comunidade" action on that screen, so the empty state is also the creation entry point.

**Stories — the strip and publishing**

- **D-78:** **One circle per active story**, newest first, each showing its own thumbnail; tapping any circle opens the viewer at that story and auto-advances through the rest. Not the Instagram per-publisher grouping: V1 has a single publisher (`admin_tenant`), so grouping would collapse the strip to exactly one circle forever, which reads as a bug. — **Reversibility:** costly — V2 member stories will want per-publisher grouping, and that is a change to the strip's query shape and to what the viewer treats as a sequence, not just to the component.
- **D-79:** **No seen/unseen ring state in V1.** Every active story renders with the same ring, and newest-first order is what tells the member what is new. A seen ring needs a per-user `story_views` table and a write on every story open — the same read-marker mechanism D-75 just rejected for community cards, and keeping both out holds one rule across the phase. A device-local `localStorage` variant is also rejected: it disagrees between a member's phone and desktop and is lost on PWA reinstall. — **Reversibility:** reversible — a views table is additive, and it is the same table a future "quem viu" admin list would need.
- **D-80:** The admin publishes from the **strip's leading "+" circle ("Seu story")**, visible only to `admin_tenant`, opening a full-screen publish route. This is the position every user already knows, and it keeps the feed's existing `ComposeFab` a one-tap button for the thing the admin does most. Members never see the circle.
- **D-81:** The publish flow is **pick media → caption → publish** on a full-screen route: the picker opens into the camera roll, the chosen image or video fills the screen, an optional caption overlays it, one "Publicar" button. It reuses the Phase 3 `useSignedUpload` path — including the Mux direct-upload branch that skips `complete` (03-07) and the "processando" state for video. A story is **not editable after publishing** (consistent with every other V1 content type except a post's text), so the caption is part of the publish step, never added afterwards.

**Stories — comments and history**

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
- Whether `@tria/module-communities` and `@tria/module-stories` are two packages or one, given they are two registry keys (`communities`, `stories` already exist in `packages/contracts/src/modules.ts`) and D-74 makes the feed depend on the communities flag. Module-to-module dependency must go through published contracts only (MOD-02, enforced by the boundary lint and `packages/boundary-fixture`).

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

### Deferred Ideas (OUT OF SCOPE)

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
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMM-01 | `admin_tenant` can create, edit and archive communities (name, description, cover image) | §Pattern 1 (module layout), §Pattern 4 (`communities` table + trigger-owned activity/post counters), §Pattern 7 (archive semantics — the only discretion item with a schema consequence), §Pattern 8 (`cover` purpose already exists in `MEDIA_LIMITS`) |
| COMM-02 | Every tenant member sees every community in V1; a membership table exists so V2 needs no migration | §Pattern 4 (`community_members` born unused, RLS + policy + isolation case from day one), §Pattern 11 (`communities.*` permissions, never `requireRole`) |
| COMM-03 | Member browses the community list (cover, name, description, post count) and opens a community to see its posts and its pinned stories | §Pattern 4 (`post_count` is trigger-owned; `last_activity_at` is what makes D-76's ordering keyset-pageable), §Pattern 6 (pinned circle row query), §Pattern 3 (community page post list is the one query the Phase 4 composite index *does* serve) |
| COMM-04 | `admin_tenant` posts directly into a community from the community page | §Pattern 3 (the `community_id` FK finally lands), §Pattern 11 (`feed.post.create` + a community-scoped write check), D-70/D-72 (`/criar?comunidade=<id>`) |
| STORY-01 | `admin_tenant` publishes a story with image or short video (≤ ~60 s via the streaming vendor) and optional caption | §Pattern 8 — **`MEDIA_LIMITS.video.story.maxDurationSeconds = 60` and `MEDIA_LIMITS.image.story` already exist**; Phase 5 adds no media plumbing, only `purpose: 'story'` at upload start and the async `duration_too_long` rejection path (Pitfall 5) |
| STORY-02 | Members see active stories in a horizontal strip; tapping opens a full-screen viewer with progress bars, auto-advance, tap-to-navigate, hold-to-pause | §Pattern 5 (strip query + index), §Pattern 9 (the reels pager adapted: axis flip, rAF clock, tap zones, hold-to-pause), Pitfall 6 (iOS autoplay), Pitfall 7 (`DoubleTapHeart` vs tap-to-navigate) |
| STORY-03 | A story is visible for 24 h, then hidden by an `expires_at` filter with the record retained | §Pattern 5 — `expires_at` **cannot** be a generated column (falsified this session); it is a plain column with a `default (now() + interval '24 hours')` and a CHECK, and the strip must **order by the column it ranges on** or the plan degrades to a sort |
| STORY-04 | `admin_tenant` pins a story to one or more communities; a pinned story stays visible there after expiry until unpinned | §Pattern 6 (`story_community_pins` join; the pin row *is* the override, expressed as `or exists(pin)` in the community query, never a second `stories` column) |
| STORY-05 | Member likes and comments on a story; story comments cannot be liked or replied to | §Pattern 2 — **fully falsified this session against the real `feed_comments`/`feed_likes` tables**: a generated `target_kind` discriminator + 3-column composite self-FK refuses a reply to a story comment, and a 2-column composite FK on `feed_likes` refuses a like on one. Both refusals verified with their positive controls, and the existing 3-valued-CHECK hole (Pitfall 1) is closed in the same migration |

</phase_requirements>

---

## Summary

Phase 5 is a **composition and constraint** phase, not a discovery phase. Every runtime mechanism it needs is already in the tree and was read from disk this session: the keyset cursor envelope, the after-commit event bus, the module manifest + registry composition points, the three-layer tenant lane, the media broker — which **already declares the `story` and `cover` purposes with their ladders and caps** — the Mux playback-token seam, `InfiniteScroll` (ported in Phase 4 *explicitly* so this phase's community list could use it), and the whole comment/like surface. Phase 4 also left three labelled slots (`feed_posts.community_id`, `feed_comments.story_id`, `feed_likes.story_id`) whose docblocks name Phase 5 as the inheritor. The correct posture is **fill the slots, copy the patterns, add no dependency** — this phase installs **zero** npm packages.

Four things genuinely needed research rather than imitation, and all four were **falsified against this project's local Postgres 17.6** this session rather than reasoned about:

1. **STORY-05 declaratively.** Today `feed_comments_parent_shape_chk` permits `depth = 1` whatever the target, and `feed_likes_comment_uq` permits a like on any comment. A purely declarative fix exists and was proved end to end: a **stored generated `target_kind`** column on `feed_comments` (`'post' | 'story'`), a `unique (id, depth, target_kind)` and a **three-column** composite self-FK, plus a `unique (id, target_kind)` and a **two-column** composite FK from `feed_likes`. A reply to a story comment fails 23514 (honest) or 23503 (lying); a like on a story comment fails the same two ways. Positive controls — a reply to a post comment, a like on a post comment, a like on the story itself — all still succeed. No trigger, no `security definer`, no read-then-write window.

2. **A latent hole in Phase 4's constraint.** A CHECK that evaluates to `NULL` is **satisfied**, and `feed_comments_parent_shape_chk`'s second branch evaluates to `NULL` when `parent_depth` is null. Combined with MATCH SIMPLE (a composite FK is not enforced when any of its columns is null), a `depth = 1` comment with `parent_id` set and `parent_depth` null **inserts today** — verified against the real table and rolled back. The API never writes that shape, so it is a defense-in-depth gap rather than a live bug, but Phase 5 rewrites that exact CHECK and closing it costs one `is not null` per branch.

3. **D-73's index claim is wrong, and the fix is one index.** D-73 states the merged feed is served by `feed_posts_tenant_community_created_idx`. It is not: with no filter on `community_id`, that column is the second key column and cannot be skipped, so the plan is **`Seq Scan` + `Sort`** (verified with a 500-row fixture and `analyze`). Phase 5 must add a third, **non-partial** `(tenant_id, created_at desc nulls first, id desc nulls first)` index; with it the plan is a clean `Index Scan`. The same probe shows an `IN`-list predicate (the naive "exclude archived communities" shape) is **also** `Seq Scan` + `Sort` — which decides the archive question in §Pattern 7.

4. **`expires_at` cannot be a generated column** (`timestamptz + interval` is not immutable — Postgres refuses with `generation expression is not immutable`), and the strip must **order by `expires_at`, the same column it ranges on**: ordering by `published_at` while ranging on `expires_at` produces `Bitmap Heap Scan` + `Sort`, while ordering by `expires_at` produces an `Index Only Scan` that both filters and delivers the order.

**Primary recommendation:** build **two** module packages, `@tria/module-communities` and `@tria/module-stories`, as structural copies of `@tria/module-feed` (manifest → contracts → db/schema → server/{routes,service} → ui), because they are two independently toggleable registry keys and D-74 makes the feed branch on `communities` alone. Land the schema in **one** migration pair (generated + `--custom`) that creates `communities`, `community_members`, `stories`, `story_community_pins`, wires the three Phase 4 FK slots, adds the STORY-05 discriminator/FK machinery, adds the merged-feed index, and installs the counter triggers. Keep every read inside `withTenantTx`, keep every write behind `requirePermission`, and put the five prototype-less surfaces through the D-33 UI-SPEC gate before any of them is coded.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Community list / detail / post list | API / Backend (Hono tenant lane) | Database (RLS) | Tenant authority is the membership of record; RLS is layer 3. The browser never queries Supabase for data (CLAUDE.md §What NOT to Use). |
| Community create / edit / archive | API / Backend | Frontend Server (Next server action → `apiFetch`) | The guard is `requirePermission('communities.community.manage')`; the web only renders the affordance from `bootstrap.permissions`. |
| "Which communities does this member see" (COMM-02) | Database (`community_members` + RLS) *shape*, API *policy* | — | V1's answer is "all of them", and that is a **permission/policy value**, not a column shape (SCHEMA-CONVENTIONS §(c).3). The table exists so V2 flips a policy, not a migration. |
| Merged feed predicate (D-73) + module-off fallback (D-74) | API / Backend | Database (index) | One query, one ordering expression, two predicates chosen by the tenant's `communities` flag. Never a second query path. |
| Story publish (media) | Browser → Storage / Mux **directly** | API (signing + record only) | MEDIA-01 / CLAUDE.md: bytes never transit Cloud Run. `useSignedUpload` already implements both branches. |
| Story ≤ 60 s enforcement | Worker (Mux webhook job) | API (rejects at `complete` for the Storage branch) | Verified: `event-job.ts` reads `MEDIA_LIMITS[kind][purpose].maxDurationSeconds` and flips the asset to `rejected`/`duration_too_long`. Mux does not enforce duration at ingest, so this is necessarily **asynchronous**. |
| Story expiry (STORY-03) | Database (`expires_at` predicate) | — | SCHEMA-CONVENTIONS §(d).3: "Time-based visibility is a predicate, not a cron." Roadmap-locked: **no cron**. |
| Pin survives expiry (STORY-04) | Database (`story_community_pins` row) | API (the `or exists(pin)` branch in the community query) | A pin row is the fact; the query reads it. A second `stories` column would need to stay in sync with the join. |
| STORY-05 refusals | **Database (constraints)** | API (400 mapping from 23503/23514), Browser (affordance absent) | The roadmap requires "rejected by the API **and** the DB". The DB is the arbiter; the API translates; the UI merely does not draw the button. |
| Story like / comment counters | Database (triggers) | — | Established rule: counter columns are trigger-owned; a soft-delete transition moves the number. |
| Community `post_count` + `last_activity_at` | Database (triggers) | — | COMM-03 needs the count; D-76's ordering needs the timestamp to be a **column**, not an aggregate, or it cannot be keyset-paged. |
| Story viewer gestures, progress clock, hold-to-pause | Browser (client component) | — | Pure presentation over a prop-driven list; the module's `ui/` stays dumb (the `FeedList` posture). |
| Stories strip placement on `/inicio` | Frontend Server (`apps/web/lib/registry.tsx`) | API (`ModuleHomeSlot.order` on the bootstrap) | D-42: the kernel carries the declaration, the web supplies the renderer, so the kernel imports no module UI (MOD-02). |
| `Comunidades` nav tab | API (`ModuleNav`, `placement: 'tab'`) | Frontend (shell) | D-40: navigation is driven by the module flag, never by data (D-77). |
| Domain events (`community.*`, `story.*`) | API / Backend (in-process bus, after commit) | Worker (Phase 7 consumers) | `flushEventsAfterHandler` already runs after the producing transaction commits. |

---

## Project Constraints (from CLAUDE.md)

Actionable directives the plan must honour. These carry the same authority as CONTEXT.md's locked decisions.

| Directive | Source | Consequence for Phase 5 |
|---|---|---|
| All business logic goes through the Node/TS API; the browser talks to Supabase only for auth session and read-only Realtime | §Project Constraints | Communities, stories, pins, story likes and story comments are all `apiFetch` calls. Realtime is **not** used in this phase. |
| `@supabase/supabase-js` in the browser for data/storage is forbidden | §What NOT to Use | Community covers and story thumbnails render through `GET /v1/media/{assetId}/{variant}`, never a signed Storage URL in a payload |
| Uploading files **through** Cloud Run is forbidden (32 MiB body cap) | §What NOT to Use | Story media uses `useSignedUpload` (signed PUT / TUS / Mux direct), unchanged from Phase 3 |
| `service_role` key / `postgres` role for tenant queries is forbidden | §What NOT to Use | Every read/write uses `withTenantTx`; `withAdminTx` is Biome-confined to `server/{tenancy,platform,media}` and unavailable to `packages/modules/**` |
| Running `drizzle-kit migrate` **and** `supabase db push` is forbidden | §What NOT to Use | `pnpm db:generate` → review SQL → Supabase CLI applies. Triggers, the generated column and the composite FKs that drizzle-kit cannot model go in a `--custom` migration in the same folder |
| Storing raw HEVC/MOV as the playback source is forbidden | §What NOT to Use | Story video goes to Mux exactly as post video does; `REFUSED_IMAGE_MIMES` already blocks HEIC stills |
| `prepare: true` on the transaction pooler is forbidden | §What NOT to Use | Already set: `postgres(env.DATABASE_URL, { prepare: false, max: 5 })` |
| Tenant authority taken from the hostname alone is forbidden | §What NOT to Use | Unchanged: membership of record decides; every new route inherits `requireAuth → requireModule → requirePermission` |
| pt-BR UI, all strings centralised | §Project Constraints, PWA-03 | New `apps/web/messages/pt-BR/communities.json` and `stories.json`; `scripts/check-ui-literals.sh` fails the build on a literal |
| Each feature is a self-contained package depending only on the kernel and other modules' **published contracts** | MOD-01/MOD-02 | `@tria/module-stories` may import `@tria/module-feed/contracts` (for the comment/like contracts) but **never** `@tria/module-feed/server/*`. The boundary lint + `packages/boundary-fixture` enforce it |
| UI follows the prototype; prototype-less screens are designed and reviewed first | UI-01/UI-04, D-33 | The five D-66 surfaces need a UI-SPEC + mockup before code |
| Supabase Free plan for the pilot (50 MB/file, no native transforms) | §Project Constraints | Story images resize in the worker through the existing `PURPOSE_WIDTHS.story` ladder — no new path |

---

## Standard Stack

### Core — already installed, nothing to add

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hono` + `@hono/zod-openapi` | 4.13.7 / 1.6.3 | The two modules' routes with the `requireAuth → requireModule → requirePermission` chain | `[VERIFIED: packages/modules/feed/server/routes.ts:1-34]` — the file imports `requireAuth`, `requireModule` and `requirePermission` from `@tria/core/server/*` and builds `new OpenAPIHono<AppEnv>`; it is the exact template |
| `drizzle-orm` | 0.45.2 | Schema, RLS policies, queries, the composite FKs | `[VERIFIED: packages/modules/feed/node_modules/drizzle-orm/package.json]` — `0.45.2`. `generatedAlwaysAs` exists on the pg column builder `[VERIFIED: packages/modules/feed/node_modules/drizzle-orm/pg-core/columns/common.d.ts:49]` — `generatedAlwaysAs(as: SQL \| T['data'] \| (() => SQL)): HasGenerated<this, {` |
| `drizzle-kit` | 0.31.10 | `pnpm db:generate` → `supabase/migrations` | `[VERIFIED: supabase/migrations/20260922162449_feed_counters.sql:4-6]` — "drizzle-kit 0.31.10 emitted every one of them cleanly" |
| `zod` | 4.6.2 | Module contracts shared by API + web | `[VERIFIED: apps/web/package.json]` — `"zod": "4.6.2"` |
| `postgres` (postgres.js) | 3.4.9 | Driver, `prepare: false`, `max: 5` | `[VERIFIED: apps/web/package.json devDependencies]` — `"postgres": "3.4.9"`; the client config is quoted in 04-RESEARCH.md §Standard Stack |
| `@mux/mux-player-react` | 3.13.4 | Story video playback (HLS + signed tokens) | `[VERIFIED: apps/web/package.json]` — `"@mux/mux-player-react": "3.13.4"`; already wired in `apps/web/components/media/VideoPlayer.tsx:212-224` with `streamType="on-demand"`, `playsInline`, `tokens={{ playback, thumbnail, storyboard }}` |
| `tus-js-client` / `@mux/upchunk` | 4.3.1 / 3.5.0 | Resumable Storage upload / Mux direct upload | `[VERIFIED: apps/web/package.json]` — `"tus-js-client": "4.3.1"`, `"@mux/upchunk": "3.5.0"` |
| `@tria/ui` primitives | workspace | `InfiniteScroll`, `BottomSheet`, `DoubleTapHeart`, `Avatar`, `EmptyState`, `Skeleton`, `PageHeader`, `Card`, `IconButton`, `Chip` | `[VERIFIED: packages/ui/src/index.ts:19-66]` — `export { InfiniteScroll, type InfiniteScrollProps } from './layout/InfiniteScroll';` … `export { DoubleTapHeart, … } from './overlays/DoubleTapHeart';` … `export { EmptyState, … } from './primitives/EmptyState';` |
| `@tria/module-feed/ui` | workspace | `CommentSheet`, `CommentsList`, `CommentItem`, `CommentInput`, `LikeButton`, `ComposeFab`, `PostCard`, `PostHeader` | `[VERIFIED: ls packages/modules/feed/ui/]` — all present as `.tsx` files |
| `motion` | 13.3.0 | Sheet/heart springs; the progress bar is a rAF clock, not a spring | `[VERIFIED: apps/web/package.json]` — `"motion": "13.3.0"` |
| `lucide-react` | 1.46.0 | Plus / Heart / MessageCircle / Pin icons | `[VERIFIED: apps/web/package.json]` — `"lucide-react": "1.46.0"` |
| `next-intl` | 4.14.4 | The two new pt-BR namespaces | `[VERIFIED: apps/web/package.json]` — `"next-intl": "4.14.4"` |

### Supporting — none

There is **no new runtime dependency in this phase.** Every capability listed in the roadmap for Phase 5 maps onto something already installed and already exercised by Phases 1–4.

### Deliberately NOT added

| Candidate | Why not |
|---|---|
| A stories-viewer library (`react-insta-stories` and friends) | The gesture model is a ~150-line client component built from the prototype's own pager (`reels/page.tsx`), and D-66 makes the prototype the visual source of truth. A library would impose its own progress bar, its own tap zones and its own DOM, and would have to be fought to match the design. The repo precedent is exactly this (Phase 4 dropped `lite-youtube-embed`; Phase 3 dropped `file-type`). |
| `@tanstack/react-query` | Still the Phase 4 answer: server-action pagination is the one paging paradigm (04-06), and Phase 7 is where a client cache is revisited. The community list and the comment sheet both ride the existing pattern. |
| A cron / scheduled job for story expiry | Roadmap-locked and SCHEMA-CONVENTIONS §(d).3-locked: `expires_at > now()` is a predicate. pg-boss is present but has no work in this phase. |
| `date-fns` for the 24 h window | The window is a DB default and a DB predicate. Relative-time rendering already exists in the ported formatters. |
| A second cursor envelope | `packages/core/server/paging.ts:28-59` is explicit: `export const CURSOR_VERSION = 1;` … `export function encodeCursor({ n, id }: KeysetCursor): string`. Its docblock says "Do not write a second envelope." |

**Installation:** none. The plan should contain **no `pnpm add`** task, and a reviewer should treat one as a smell.

---

## Package Legitimacy Audit

**This phase installs no external packages**, so the legitimacy gate has nothing to check. The audit table is intentionally empty:

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| — | — | — | — | — | — | No external package is added by Phase 5 |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

If planning later discovers a genuine need for a dependency (it should not), that plan must carry a `checkpoint:human-verify` before the install, per the 02-02 / 03-06 / 04 precedent.

---

## Architecture Patterns

### System Architecture Diagram

```
                        ┌──────────────────────── BROWSER (PWA, mobile-first) ───────────────────────┐
                        │                                                                            │
  member opens /inicio  │  StoriesStrip (client)          FeedList (client, Phase 4)                 │
       ───────────────► │   ├─ circles = active stories    └─ PostCard + "em {Comunidade}" (D-71)    │
                        │   └─ tap ─► StoryViewer (client, full-screen, fixed inset-0)               │
                        │                ├─ rAF progress clock (image 5 s / video = duration)        │
                        │                ├─ tap-left / tap-right zones, hold-to-pause                │
                        │                ├─ swipe-down = dismiss (dominant-axis lock, 60 px)         │
                        │                ├─ <MuxPlayer playsInline muted> for video                  │
                        │                └─ CommentSheet (flat variant) ─ pauses the clock (D-82)    │
                        │                                                                            │
  member opens          │  CommunityList (server page + InfiniteScroll sentinel)                     │
   /comunidades ──────► │   └─ CommunityPage ─ cover/gradient header + Destaques circles + posts     │
                        │                                                                            │
  admin taps "+" ─────► │  /stories/publicar  ─ pick media ─► useSignedUpload ─┐                     │
                        └─────────────────────────────────────────────────────┼─────────────────────┘
                                          │ apiFetch (Bearer, via Next BFF)   │ bytes DIRECT
                                          ▼                                   ▼
        ┌───────────────── API (Hono on Cloud Run, tenant lane) ─────┐   ┌──────────────────────┐
        │ requireAuth → requireModule('communities'|'stories')       │   │ Supabase Storage     │
        │            → requirePermission(...) on writes             │   │ (signed PUT / TUS)   │
        │                                                            │   │  …or Mux direct      │
        │  @tria/module-communities         @tria/module-stories     │   └──────────┬───────────┘
        │   GET  /v1/communities             GET  /v1/stories        │              │ webhook
        │   GET  /v1/communities/{id}        POST /v1/stories        │              ▼
        │   POST /v1/communities             DELETE /v1/stories/{id} │   ┌──────────────────────┐
        │   PATCH /v1/communities/{id}       POST /v1/stories/{id}/  │   │ WORKER (pg-boss)     │
        │   (archive = PATCH status)              likes | comments   │   │ media provider event │
        │                                    PUT /v1/stories/{id}/   │   │  → duration > 60 s ? │
        │  @tria/module-feed (amended)            pins               │   │    reject asset      │
        │   GET /v1/feed  ── D-73 predicate  GET /v1/stories/mine    │   └──────────┬───────────┘
        │                    D-74 fallback        (admin history)    │              │
        └───────────────────────────┬────────────────────────────────┘              │
                                    │ withTenantTx (set local role authenticated)   │ withAdminTx
                                    ▼                                               ▼
        ┌──────────────────────────── POSTGRES (RLS on every table) ──────────────────────────────┐
        │ communities ─1:N─► feed_posts.community_id (FK lands here)                              │
        │      │  post_count, last_activity_at  ◄── TRIGGERS on feed_posts                        │
        │      ├─N:M─ community_members (born unused, RLS + policy + isolation case)              │
        │      └─N:M─ story_community_pins ──► stories                                            │
        │                                        │ expires_at (default now()+24h)                 │
        │                                        │ like_count, comment_count ◄── TRIGGERS         │
        │ feed_comments.story_id ─FK─────────────┘                                                │
        │   + target_kind (GENERATED)  ──► unique(id,depth,target_kind) ◄─ composite self-FK      │
        │                              ──► unique(id,target_kind)       ◄─ feed_likes composite FK│
        │ feed_likes.story_id ─FK────────────────►  (STORY-05 refusals live HERE)                 │
        └─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/modules/communities/
├── module.ts                 # nav: { placement:'tab', label:'Comunidades', icon:'users', order:20, href:'/comunidades' }
├── contracts/index.ts        # zod schemas, COMMUNITY_PERMISSIONS, EventMap declaration merge
├── db/schema.ts              # communities, community_members
├── server/{routes,service}.ts
└── ui/                       # CommunityCard, CommunityList, CommunityHeader, HighlightsRow

packages/modules/stories/
├── module.ts                 # home: [{ order: 5 }]  — ABOVE the feed's home[0].order = 10
├── contracts/index.ts        # zod schemas, STORY_PERMISSIONS, EventMap declaration merge
├── db/schema.ts              # stories, story_community_pins
├── server/{routes,service}.ts
└── ui/                       # StoriesStrip, StoryCircle, StoryViewer, StoryProgressBars, StoryComposer

packages/modules/feed/        # AMENDED, not rewritten
├── db/schema.ts              # community_id FK; comments/likes target_kind machinery; merged-feed index
├── server/service.ts         # listFeed predicate (D-73/D-74); listCommunityFeed
└── ui/PostHeader.tsx         # D-71 "em {Comunidade}" row; CommentsList gains `flat` prop (D-82)

apps/web/app/(app)/
├── comunidades/page.tsx, comunidades/[communityId]/page.tsx
├── comunidades/nova/page.tsx, comunidades/[communityId]/editar/page.tsx
├── stories/publicar/page.tsx, stories/meus/page.tsx   (admin history + pin/unpin, D-84)
└── stories/[storyId]/page.tsx   (viewer route — intercepting/modal over /inicio)

apps/web/messages/pt-BR/{communities,stories}.json
supabase/migrations/<ts>_communities_stories.sql        (drizzle-generated)
supabase/migrations/<ts>_communities_stories_rules.sql  (--custom: triggers + generated col + composite FKs)
supabase/tests/110-communities-stories.sql
```

**Two packages, not one.** `communities` and `stories` are two independently toggleable keys `[VERIFIED: packages/contracts/src/modules.ts:2-9]` — `export const TOGGLEABLE_MODULES = [ 'feed', 'communities', 'stories', 'events', 'chat', 'notifications', ] as const;`. A single package would have to be registered under one key, so the other key could never be turned on or off; D-74 explicitly branches the feed on `communities` alone, and D-80's "+" circle belongs to `stories`. Cross-module needs go through published contracts: `@tria/module-stories/contracts` exports the pin shape that `@tria/module-communities/ui` renders, and `@tria/module-feed` imports `@tria/module-communities/contracts` for the community summary on a post header — never the other module's `server/` or `db/`.

---

### Pattern 1: The module package is a copy, not a design

`@tria/module-feed` is the reference module since 04-10 removed the example. The manifest is data `[VERIFIED: packages/core/server/modules/manifest.ts]` — `export interface ModuleHomeSlot { order: number; }` and `ModuleNav` with `label`, `icon`, `href`, `order`, `placement?: 'tab' | 'topbar'`, `badge?`. Registration is **one line** in `apps/api/src/modules/registry.ts`:

```ts
export const MODULE_REGISTRY: Partial<Record<ModuleKey, ModuleManifest>> = {
  feed: feedModule,
  communities: communitiesModule,   // ← Phase 5
  stories: storiesModule,           // ← Phase 5
};
```

That file's loop already subscribes every manifest's events and registers every job queue, so nothing else in the API changes. The web composition point (`apps/web/lib/registry.tsx`) supplies a renderer per `<key> → home[index]`; the stories strip registers there. `defineModule` throws on a key outside `TOGGLEABLE_MODULES`, so a typo fails at import time.

**Nav budget:** the feed deliberately declares **no** nav entry so this phase could spend the tab. `communities` takes `placement: 'tab'`; `stories` declares **no nav entry at all** and only a `home` slot (the strip), which is why D-80 puts the publish entry inside the strip rather than in the tab bar.

### Pattern 2: STORY-05 as a declarative fact — VERIFIED, with its positive controls

**The gap today.** `[VERIFIED: packages/modules/feed/db/schema.ts:282-288]`:

```
    check(
      'feed_comments_parent_shape_chk',
      sql`(parent_id is null and parent_depth is null and depth = 0)
       or (parent_id is not null and parent_depth = 0 and depth = 1)`,
    ),
    check('feed_comments_target_chk', sql`num_nonnulls(post_id, story_id) = 1`),
```

Nothing there mentions the target, so a `depth = 1` row whose parent is a **story** comment is legal. And `[VERIFIED: packages/modules/feed/db/schema.ts:349-351]`:

```
    uniqueIndex('feed_likes_comment_uq')
      .on(t.userId, t.commentId)
      .where(sql`comment_id is not null`),
```

— uniqueness only; nothing forbids liking a story comment.

**The mechanism.** A stored **generated** discriminator makes the target visible to a referential check:

```sql
alter table public.feed_comments
  add column target_kind text
  generated always as (case when post_id is not null then 'post' else 'story' end) stored;

alter table public.feed_comments add column parent_target_kind text;

alter table public.feed_comments
  add constraint feed_comments_id_depth_kind_uq unique (id, depth, target_kind),
  add constraint feed_comments_id_kind_uq       unique (id, target_kind);

alter table public.feed_comments
  add constraint feed_comments_parent_fk
  foreign key (parent_id, parent_depth, parent_target_kind)
  references public.feed_comments (id, depth, target_kind) on delete cascade;

alter table public.feed_comments
  add constraint feed_comments_parent_shape_chk check (
    (parent_id is null and parent_depth is null and parent_target_kind is null and depth = 0)
    or (parent_id is not null and parent_depth is not null and parent_depth = 0
        and parent_target_kind is not null and parent_target_kind = 'post' and depth = 1)
  );

alter table public.feed_likes add column comment_target_kind text;
alter table public.feed_likes
  add constraint feed_likes_comment_kind_chk check (
    (comment_id is null and comment_target_kind is null)
    or (comment_id is not null and comment_target_kind is not null and comment_target_kind = 'post')
  ),
  add constraint feed_likes_comment_fk
  foreign key (comment_id, comment_target_kind)
  references public.feed_comments (id, target_kind) on delete cascade;
```

**Falsification run this session against this project's Postgres 17.6** (`docker exec supabase_db_rede-social`, port 54322), first in a throwaway schema and then as a **dry-run migration on the real `feed_comments` / `feed_likes` with their 20 existing rows, rolled back**:

| Probe | Expected | Observed |
|---|---|---|
| A — reply to a **post** comment (positive control) | succeed | `INSERT 0 1` |
| B — reply to a **story** comment, honest `parent_target_kind='story'` | refuse | `ERROR: new row for relation "c" violates check constraint "c_parent_shape_chk"` |
| C — reply to a **story** comment, lying `parent_target_kind='post'` | refuse | `ERROR: insert or update on table "c" violates foreign key constraint "c_parent_fk"` — `Key (parent_id, parent_depth, parent_target_kind)=(2222…, 0, post) is not present in table "c"` |
| D — reply to a **reply** (the Phase 4 rule, must still hold) | refuse | `ERROR: … violates check constraint "c_parent_shape_chk"` |
| E — story comment claiming `depth = 1` with a null parent | refuse | `ERROR: … violates check constraint "c_parent_shape_chk"` |
| F — like a **post** comment (positive control) | succeed | `INSERT 0 1` |
| G — like a **story** comment, honest kind | refuse | `ERROR: … violates check constraint "c_likes_comment_kind_chk"` |
| H — like a **story** comment, lying kind | refuse | `ERROR: … violates foreign key constraint "c_likes_comment_fk"` |
| I — like the **story itself** (positive control, STORY-05 first half) | succeed | `INSERT 0 1` |
| Migration dry-run on real tables | applies + data survives | `UPDATE 7` backfill on comments, `UPDATE 2` on likes, then `post_comments = 20, replies = 7`; the Pitfall-1 probe that inserts today now `ERROR: … feed_comments_parent_shape_chk` |

`[VERIFIED: local Postgres 17.6 probe, this session]`

**Why not a trigger.** The same reason `feed_comments_parent_fk` and `feed_post_media_kind_fk` exist: a `before insert` trigger that reads the parent row is a read-then-write with no lock, and two concurrent inserts could both observe a legal parent. A foreign key is enforced by an index and cannot race. `[CITED: packages/modules/feed/db/schema.ts:206-224 docblock]`

**API mapping.** The service maps 23503 and 23514 to `400 VALIDATION_FAILED`. Phase 5 adds two new machine codes to that closed vocabulary so the web can switch on them exhaustively — recommend `{ comment: 'story_comment_no_reply' }` and `{ like: 'story_comment_not_likeable' }`. Keep `reply_depth_exceeded` for the Phase 4 case; a single code for two different refusals would make the pt-BR copy wrong for one of them.

**Drizzle expression.** `generatedAlwaysAs` exists on the pg column builder (see §Standard Stack). If `drizzle-kit generate` emits the generated column, the 3-column `unique` and the composite FKs cleanly, keep them in `db/schema.ts`; if any of them needs hand-editing, move **only that constraint** to the `--custom` migration and leave a comment in `schema.ts` saying where it lives — SCHEMA-CONVENTIONS §(h).4 expects exactly that split.

### Pattern 3: The merged feed needs a THIRD index — D-73's claim is falsified

Phase 4 built two indexes `[VERIFIED: packages/modules/feed/db/schema.ts:95-108]`:

```
    index('feed_posts_tenant_community_created_idx').on(
      t.tenantId,
      t.communityId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('feed_posts_tenant_created_idx')
      .on(t.tenantId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`community_id is null`),
```

D-73 says the merged feed "is served by the index Phase 4 already built for exactly this moment". **It is not.** With a 500-post fixture (half tenant-wide, half across five communities) and `analyze`, run this session:

| Query | Plan observed |
|---|---|
| A — `where tenant_id = $1 and deleted_at is null order by created_at desc, id desc limit 10` (the D-73 merged feed) | `Limit → Sort → Seq Scan on feed_posts` |
| B — the same plus `and community_id is null` (today's V1 / D-74 fallback) | `Limit → Index Scan using feed_posts_tenant_created_idx` |
| C — the same plus `and community_id = '…'` (a community page) | `Limit → Index Scan using feed_posts_tenant_community_created_idx` |
| D — the same plus `and (community_id is null or community_id in (…,…))` (the naive archive filter) | `Limit → Sort → Seq Scan on feed_posts` |
| A2 — A, after adding `(tenant_id, created_at desc nulls first, id desc nulls first)` | `Limit → Index Scan using feed_posts_tenant_created_all_idx` |

`[VERIFIED: local Postgres 17.6 EXPLAIN probe, this session]`

The reason is the one Phase 4's own docblock gives for the partial index: a column that is neither pinned by equality nor dropped from the key cannot be skipped, so the composite index can serve C but can deliver the ordering for neither A nor D.

**Action for the planner:** add, in `packages/modules/feed/db/schema.ts`,

```ts
// D-73: the MERGED feed has no predicate on community_id, so neither Phase 4 index can deliver
// `order by created_at desc, id desc`. Verified: without this index the plan is Seq Scan + Sort.
index('feed_posts_tenant_created_all_idx').on(
  t.tenantId,
  t.createdAt.desc().nullsFirst(),
  t.id.desc().nullsFirst(),
),
```

All three indexes are justified and must coexist: `_all_` for the merged feed (D-73), the partial `_tenant_created_` for the module-off fallback (D-74), and the composite for a single community page (COMM-03). The `EXPLAIN` acceptance block in `supabase/tests/090-feed.sql` should gain a fourth plan assertion for the merged feed, or the index can be dropped by a future refactor without anything going red.

**Keep the `.desc().nullsFirst()` idiom.** It is the repo convention and the 090-feed.sql assertion depends on it. (A side observation from the probe: on PG 17.6 a `DESC NULLS LAST` index was also chosen here, because both columns are `NOT NULL` — do not read that as licence to drop `.nullsFirst()`; the convention costs nothing and the assertion is written against it.)

### Pattern 4: `communities` — counters and the ordering column D-76 actually needs

```ts
export const communities = pgTable('communities', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id), // stored, never surfaced (D-67)
  name: text().notNull(),
  slug: text().notNull(),                       // for a stable, shareable URL
  description: text().notNull().default(''),
  coverAssetId: uuid('cover_asset_id').references(() => mediaAssets.id), // NULLABLE — D-69
  status: text().notNull().default('active'),   // 'active' | 'archived'  — SCHEMA-CONVENTIONS §(d).1
  postCount: integer('post_count').notNull().default(0),          // TRIGGER-OWNED
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(), // TRIGGER-OWNED
  createdAt: …, updatedAt: …, deletedAt: …,
});
```

**`last_activity_at` is the whole reason D-76's ordering is pageable.** "Most recent post activity" as an aggregate (`max(feed_posts.created_at)`) cannot be keyset-paged: a cursor comparison against an aggregate has no index to ride and forces a group-then-sort of every community on every page. Denormalising it into a trigger-owned column puts it back in the same family as `like_count` and `comment_count` — `[CITED: supabase/migrations/20260922162449_feed_counters.sql:17-21]` "WHY THE COUNTERS LIVE IN TRIGGERS AT ALL: … An application-side `update … set like_count = like_count + 1` is a second statement that must also succeed; the day it does not, the counter drifts."

**It must be `NOT NULL`, defaulting to the community's creation time.** `order by last_activity_at desc` is `desc NULLS FIRST` in SQL, so a nullable column would float every post-less community to the top of the list — the opposite of "most recent activity". Seeding it with `now()` at insert means a brand-new community sorts by when it was created, which is the right answer, and lets the index keep the repo's `.desc().nullsFirst()` idiom unchanged:

```ts
index('communities_tenant_activity_idx').on(
  t.tenantId, t.lastActivityAt.desc().nullsFirst(), t.id.desc().nullsFirst(),
).where(sql`status = 'active' and deleted_at is null`),
uniqueIndex('communities_tenant_slug_uq').on(t.tenantId, t.slug),
tenantIsolationPolicy('communities_tenant_isolation'),
```

The cursor's `n` is the row's own `last_activity_at`, read back from the projection — the `listFeed` rule restated.

**Trigger:** one function on `feed_posts` `after insert` / `after update of deleted_at` / `after delete`, moving `post_count` and setting `last_activity_at = greatest(last_activity_at, new.created_at)` when `new.community_id is not null`. Mirror the Phase 4 function's posture exactly: `language plpgsql set search_path = ''`, fully-qualified names, **not** `security definer` (it runs on the writer's own tenant rows under a policy the writer already satisfies), and **no `greatest(0, …)` clamp** on the count so a pgTAP reconciliation assertion can surface drift instead of hiding it.

**`community_members`** is born unused (COMM-02) and still gets everything a real table gets — `tenant_id`, `unique (tenant_id, community_id, user_id)`, `role text` with a CHECK, `status`, `.enableRLS()`, `tenantIsolationPolicy(...)` and a case in `020-tenant-isolation.sql`. That is not ceremony: `010-rls-coverage.sql` is catalogue-driven and will fail on a policy-less table the moment it exists, and V2-CONT-02 is supposed to be a policy change, which is only true if the policy is already there.

### Pattern 5: `stories` — the expiry predicate, and ordering by the column you range on

```ts
export const stories = pgTable('stories', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').notNull().references(() => users.id),  // generic (FEED-08)
  mediaAssetId: uuid('media_asset_id').notNull().references(() => mediaAssets.id),
  mediaKind: text('media_kind').notNull(),        // 'image' | 'video' — CHECK
  caption: text().notNull().default(''),          // plain text, render-time linkify (D-54)
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
    .default(sql`now() + interval '24 hours'`),   // STORY-03, the TTL is a DB fact
  likeCount: integer('like_count').notNull().default(0),      // TRIGGER-OWNED
  commentCount: integer('comment_count').notNull().default(0),// TRIGGER-OWNED
  createdAt: …, deletedAt: …,
});
```

**`expires_at` cannot be a generated column.** Probed this session:

```
create table g1 (published_at timestamptz not null default now(),
  expires_at timestamptz generated always as (published_at + interval '24 hours') stored);
ERROR:  generation expression is not immutable
```

`[VERIFIED: local Postgres 17.6 probe, this session]` — `timestamptz + interval` is STABLE, not IMMUTABLE, so it is rejected. A **column default** may be volatile, and `now()` is the transaction timestamp, so `published_at` and `expires_at` are derived from the same instant. Pair it with `check (expires_at > published_at)` so a hand-written row cannot invert the window.

**The strip must order by `expires_at`, not `published_at`.** Probed on a 5,000-row fixture with index `(tenant_id, expires_at desc nulls first, id desc nulls first) where deleted_at is null`:

| Query | Plan observed |
|---|---|
| `where tenant_id and deleted_at is null and expires_at > now() order by expires_at desc, id desc` | `Index Only Scan using s_tenant_expires_idx` — `Index Cond: (tenant_id = … AND expires_at > now())` |
| same but `order by published_at desc, id desc` | `Sort → Bitmap Heap Scan → Bitmap Index Scan` |
| admin history: `where tenant_id and deleted_at is null order by expires_at desc, id desc` (no range) | `Index Only Scan using s_tenant_expires_idx` |

`[VERIFIED: local Postgres 17.6 EXPLAIN probe, this session]`

With a fixed 24 h TTL the two orderings are identical in meaning, so ordering by `expires_at` costs nothing and buys the plan. **One index serves both the strip and D-84's admin history** — the history simply drops the range predicate. The cursor's `n` is `expires_at`.

**"No cron" is satisfied structurally:** there is no job, no sweeper and no status transition. A story leaves the strip because `now()` moved, and the row is untouched — which is exactly what STORY-03 asks for and what makes D-84's history screen possible with no extra state.

### Pattern 6: `story_community_pins` — the pin row *is* the expiry override

```ts
export const storyCommunityPins = pgTable('story_community_pins', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  communityId: uuid('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  pinnedByUserId: uuid('pinned_by_user_id').notNull().references(() => users.id),
  pinnedAt: timestamp('pinned_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('story_community_pins_uq').on(t.storyId, t.communityId),   // unpin = DELETE, re-pin idempotent
  index('story_community_pins_tenant_community_idx')
    .on(t.tenantId, t.communityId, t.pinnedAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
  tenantIsolationPolicy('story_community_pins_tenant_isolation'),
]);
```

The community page's circle row is then a join, and the expiry override is the **absence of a range predicate on that path** rather than a second column on `stories`:

```sql
select s.id, s.media_asset_id, s.expires_at, s.expires_at > now() as is_active
  from public.story_community_pins p
  join public.stories s on s.id = p.story_id and s.tenant_id = p.tenant_id
 where p.tenant_id = $1 and p.community_id = $2 and s.deleted_at is null
 order by p.pinned_at desc, p.id desc
 limit 20;
```

**Recommended answers to the three discretion sub-questions** (record these as decisions; each is cheap to reverse):

- **The community row shows pinned stories only** — active *and* pinned would mean a story appears in the strip on `/inicio` and again on every community page, and the row is called "Destaques". A pin is an editorial act; the strip is a broadcast.
- **A pinned expired story stays likeable and commentable.** The interaction routes key on `stories.id`, never on `expires_at`, so making expiry a write gate would mean a second predicate in two more places and a member seeing a like button that 400s. If the admin wants it closed, they unpin.
- **A pinned expired story's circle is visually identical to an active one** (D-79 already banned ring states). `is_active` is projected anyway because the viewer needs it for the "expirou" case mid-view.

**Unpin is a hard `DELETE`**, deliberately, and is the one place this phase departs from the soft-delete convention: a pin carries no authored content and no moderation evidence, the unique index is the idempotency arbiter, and a soft-deleted pin would need `deleted_at is null` threaded through the join. Note this explicitly in the schema docblock so a reviewer does not "fix" it.

### Pattern 7: Archive — keep the posts, gate the writes (the discretion call)

CONTEXT.md constrains this: archive "must be expressible as a predicate on the same feed query, not as a second query path". Probe D above shows that an `IN`-list / `NOT IN`-list over community ids is **`Seq Scan` + `Sort`** — so "archived communities' posts leave the feed" can only be done with a **denormalised flag on `feed_posts`** kept in sync by a trigger on `communities`, plus a fourth partial index. That is a table-wide `UPDATE` every time an admin archives a community, a fourth index to maintain, and a new class of drift.

**Recommendation — archive is a *write* gate and a *list* gate, not a feed gate:**

| Aspect | Behaviour |
|---|---|
| `communities.status` | `'active' \| 'archived'` with a CHECK (SCHEMA-CONVENTIONS §(d).1 prefers `status` over a timestamp) |
| Main feed (D-73) | **Unchanged.** An archived community's existing posts stay, strictly chronological. Nothing members already saw and liked disappears. |
| `/comunidades` list | Archived communities are excluded — the partial index `where status = 'active' and deleted_at is null` already carries the predicate |
| Community page by direct link | **Still opens**, read-only, with an "Arquivada" `StatusPill`; D-71's post label still navigates there. A 404 would break every share link in the feed |
| Posting into it | Refused: `403` / `400 VALIDATION_FAILED { community: 'archived' }`; the D-70 FAB is not rendered |
| Pinned stories on it | Still render on the (read-only) page. The pins are untouched |
| Reversible | Yes — `PATCH /v1/communities/{id}` back to `active`. Archive is not deletion; a destructive variant is not in COMM-01 |

This satisfies the constraint in the strongest possible sense: the feed query **has no archive predicate at all**, so there is exactly one ordering expression and one index, and no cursor is ever invalidated by an archive.

### Pattern 8: Media — Phase 3 already built the story path

`[VERIFIED: packages/contracts/src/media.ts:32-33]`:

```
export const MEDIA_PURPOSES = ['avatar', 'post', 'cover', 'story', 'attachment'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
```

`[VERIFIED: packages/contracts/src/media.ts:59-65]`:

```
export const PURPOSE_WIDTHS: Record<MediaPurpose, readonly number[]> = {
  avatar: [128, 320],
  post: [320, 640, 1080, 1600],
  cover: [640, 1080, 1600],
  story: [640, 1080],
  attachment: [],
};
```

`[VERIFIED: packages/contracts/src/media.ts:81-95]`:

```
export const MEDIA_LIMITS: Record<MediaKind, Partial<Record<MediaPurpose, MediaLimit>>> = {
  image: {
    avatar: { mimes: IMAGE_MIMES, maxBytes: 8 * 1024 * 1024 },
    post: { mimes: IMAGE_MIMES, maxBytes: 15 * 1024 * 1024 },
    cover: { mimes: IMAGE_MIMES, maxBytes: 15 * 1024 * 1024 },
    story: { mimes: IMAGE_MIMES, maxBytes: 15 * 1024 * 1024 },
  },
  video: {
    post: { mimes: VIDEO_MIMES, maxBytes: 500 * 1024 * 1024, maxDurationSeconds: 300 },
    story: { mimes: VIDEO_MIMES, maxBytes: 500 * 1024 * 1024, maxDurationSeconds: 60 },
  },
  file: {
    attachment: { mimes: ['application/pdf'], maxBytes: 25 * 1024 * 1024 },
  },
};
```

**STORY-01's "~60 s" and COMM-01's cover ladder are already in the contract.** Phase 5 writes no media code. What it must do is:

1. Send `purpose: 'story'` (image or video) and `purpose: 'cover'` (community art) at `POST /v1/media/uploads`. The server re-validates against the same table.
2. Handle the **asynchronous** duration refusal. `[VERIFIED: packages/core/server/media/video/event-job.ts:110-117]`:
   ```
     const limit = limitFor('video', row.purpose as MediaPurpose);
     const cap = limit.maxDurationSeconds;
     const duration = event.durationSeconds;

     // Mux enforces no duration at ingest, so a video is only measurable once ready (R-02). Strictly
     // `>`: a video exactly at the cap is accepted.
     if (cap !== undefined && duration !== null && duration > cap) {
   ```
   The asset flips to `status: 'rejected'`, `failure_reason: 'duration_too_long'` and the provider asset is deleted. The story publish screen must therefore surface a rejected state **after** the "processando" state, not only a pre-upload one — the pick-time gate in `useSignedUpload` is UX, never authorization.
3. Decide what a story row does when its asset is rejected. **Recommendation:** create the `stories` row only at `complete`/`ready` for the Storage branch, and for the Mux branch create it immediately with the asset in `processing` so the admin sees it in D-84's history — then let the strip's read filter on `media_assets.status = 'ready'`. A story that will never play must not be in the strip, and a story that vanished with no explanation must not be the admin's only feedback.

### Pattern 9: The story viewer — the reels pager, with the axis flipped

The prototype's `reels/page.tsx` is the gesture model D-66 points at. What is directly reusable, with line references:

| Mechanism | Prototype | Reuse in the viewer |
|---|---|---|
| `const LIMIAR = 60;` — drag threshold | `[VERIFIED: reference/frontend-design/app/(app)/reels/page.tsx:34]` — `const LIMIAR = 60;` | Same number, for swipe-down-to-dismiss |
| Dominant-axis lock | `[VERIFIED: …reels/page.tsx:91-98]` — `if (Math.abs(dy) > Math.abs(dx)) { … } else if (dx < -LIMIAR) { … }` | **Flipped:** horizontal = previous/next story, vertical = dismiss. A gesture still never does both |
| Pager transform + rubber band | `[VERIFIED: …reels/page.tsx:124-130]` — `transform: \`translateY(calc(${-i * 100}% + ${arrasto.ativo ? arrasto.dy * 0.35 : 0}px))\`` and `transition: … "transform 0.42s cubic-bezier(0.2, 0.715, 0.205, 0.99)"` | `translateX` for the story sequence; keep `0.35` and the easing verbatim so the motion matches the app |
| Pre-mounted neighbours | `[VERIFIED: …reels/page.tsx:138-139]` — `{/* vizinhos ficam montados para não piscar na troca */}` `{Math.abs(k - i) <= 1 && (` | Keep. It is also the pre-buffer for the next story's image/HLS manifest |
| Progress ticks | `[VERIFIED: …reels/page.tsx:253-268]` — a column of `<span>`s with `height: k === i ? 16 : 6` | **Replaced**, not reused: stories need *filling* segmented bars across the top, not static side ticks. The ticks prove the pattern of "one element per item driven by `i`"; the fill is new |
| Status-bar ink override | `[VERIFIED: …reels/page.tsx:50-56]` — `root.style.setProperty("--statusbar-ink", "#ffffff")` with cleanup | Keep verbatim; a white-on-media status bar is the same need |
| `position: fixed inset-0` + `touchAction: 'none'` | `[VERIFIED: …reels/page.tsx:111,119]` | Keep. `touchAction: 'none'` is what stops the browser stealing the drag |
| `BottomSheet` for comments | `[VERIFIED: …reels/page.tsx:273-277]` | Replaced by the real `CommentSheet` in its flat variant (D-82) |

**The timing model (recommendation, to be pinned by the D-33 review):**

- Image duration: `STORY_DURATION_MS = 5000` `[VERIFIED: reference/frontend-design/lib/constants.ts:6-7]` — `export const STORY_DURATION_MS = 5000;` / `export const STORY_EXPIRY_HOURS = 24;`. Both constants are the design team's own numbers and are unused in the prototype; port them into `@tria/module-stories/contracts` so the viewer and the schema cite one source.
- Video duration: the asset's own `duration_seconds`, driven by the player's `timeupdate`, **not** a fixed timer — a fixed timer desynchronises the moment the network stalls.
- **One `requestAnimationFrame` clock, not a CSS animation.** A rAF/elapsed-time loop is what makes pause, resume and skip interruptible mid-fill; a CSS `animation` has to be restarted or hacked with `animation-play-state` and cannot be scrubbed. `[CITED: dev.to "I Rebuilt Instagram Stories' Segmented Progress Bars"]` — LOW confidence as a source, but it agrees with the mechanism and there is no tenable alternative here.
- Tap zones: left third = previous, right two-thirds = next (a larger "next" target matches the dominant gesture). Hold anywhere = `pointerdown` pauses the clock and the video, `pointerup` resumes.
- End of sequence: **close the viewer**, do not loop. Looping a single-publisher strip traps the member.
- A story that expires **mid-view** keeps playing to the end of its own segment and is simply absent from the next strip read. Removing it under the member's finger is the worse failure.
- Mute default: **muted** (it is also what makes autoplay legal on iOS — see Pitfall 6), with the prototype's mute toggle in the same top-right position.

**`prefers-reduced-motion`:** the auto-advance clock is content pacing, not decoration, so it stays; the *transform transition* should collapse to an instant swap. UI-SPEC §Motion & Accessibility already carries this rule for Phases 2–4.

### Pattern 10: Domain events — the module teaches the kernel

`EventMap` is the declaration-merging extension point `[VERIFIED: packages/contracts/src/events.ts:11-14]`:

```
// biome-ignore lint/suspicious/noEmptyInterface: extension point — modules declaration-merge into it
export interface EventMap {}
```

Each module declares its own payloads from its `contracts` entry point and lists handlers in `module.ts`; `apps/api/src/modules/registry.ts` subscribes them at import time. Phase 4's payload discipline is **ids and flags only — never a caption, never a comment body** (T-04-05 / T-04-19), and Phase 5 must hold it: a story caption and a community description are member-visible content and must not reach a log line.

Recommended event set, with payloads carrying what a Phase 7 notification row needs without a re-read:

| Event | Payload |
|---|---|
| `community.created` / `community.updated` / `community.archived` | `{ tenantId, communityId, actorUserId }` |
| `story.published` | `{ tenantId, storyId, authorUserId, mediaKind, expiresAt }` |
| `story.liked` / `story.unliked` | `{ tenantId, storyId, storyAuthorUserId, userId }` |
| `story.commented` | `{ tenantId, storyId, storyAuthorUserId, commentId, authorUserId }` |
| `story.pinned` / `story.unpinned` | `{ tenantId, storyId, communityId, actorUserId }` |

`storyAuthorUserId` is on the interaction payloads deliberately: NOTIF-01 notifies the *author*, and without it Phase 7 would re-read `stories` inside its subscriber.

### Pattern 11: Permissions — `requirePermission`, never `requireRole`

The established rule (04-01, and the reason FEED-08 works) is that "only the admin may X" is a **permission value**, composed once in `apps/api/src/modules/registry.ts`'s `permissionsFor(role, enabled, settings)` and read by both the route guard and `GET /v1/me/bootstrap`. Phase 5 declares:

```ts
// @tria/module-communities/contracts
export const COMMUNITY_PERMISSIONS = { manage: 'communities.community.manage' } as const;
// manifest: defaultRolePermissions: { admin_tenant: [COMMUNITY_PERMISSIONS.manage] }

// @tria/module-stories/contracts
export const STORY_PERMISSIONS = {
  publish: 'stories.story.publish',
  manage:  'stories.story.manage',   // delete + pin/unpin (D-84)
} as const;
// manifest: defaultRolePermissions: { admin_tenant: [publish, manage] }
```

Liking and commenting on a story are **member** actions and need no module permission beyond `requireModule('stories')` — exactly as post likes/comments do. V2 member stories are then a `tenant_modules['stories'].settings` flip composed in `permissionsFor`, with no route edit and no migration — the FEED-08 shape, reused.

**D-70/COMM-04's write is two checks, not one:** `requirePermission('feed.post.create')` (it is a post) *plus* a service-level check that the target community exists in this tenant and is `active`. The second is not a permission; it is validation, and it answers `400 VALIDATION_FAILED { community: 'archived' }` / a bare `404` for an unknown id (the D-23 existence-oracle rule).

### Anti-Patterns to Avoid

- **A `before insert` trigger for STORY-05.** Read-then-write with no lock; two concurrent inserts can both pass. Use the composite FKs (Pattern 2).
- **A CHECK whose branch can evaluate to `NULL`.** It passes. See Pitfall 1.
- **A second `stories` column for "pinned".** The pin is a many-to-many fact; a boolean would have to be kept in sync with the join, and STORY-04 says "one or more communities".
- **Filtering the merged feed by an `IN`-list of community ids.** Verified `Seq Scan` + `Sort`. See Pattern 7.
- **Ordering the community list by `max(feed_posts.created_at)`.** Not keyset-pageable. Denormalise into a trigger-owned column.
- **`order by published_at` on a query that ranges on `expires_at`.** Verified `Sort`. Order by the column you range on.
- **A cron/sweeper to expire stories.** Roadmap- and conventions-locked against.
- **A separate `/story/[id]` page as the comment surface.** D-82 rejects it: it breaks the auto-advance sequence the viewer exists for.
- **`@tria/module-stories` importing `@tria/module-feed/server/*`.** MOD-02 violation; the boundary lint and `packages/boundary-fixture` will fail. Contracts only.
- **A second data-fetch path for "load more".** `InfiniteScroll` + a server action, exactly as the feed does.
- **Hard-coding `admin_tenant` in a route.** `requirePermission`, always.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Cursor pagination for the community list and story comments | A second cursor encoder | `packages/core/server/paging.ts` `encodeCursor`/`decodeCursor` | Its docblock says "Do not write a second envelope"; `decodeCursor` is **total** — a tampered cursor degrades to page 1 rather than 500ing on a shared link |
| Infinite scroll sentinel | An `IntersectionObserver` in the module | `@tria/ui` `InfiniteScroll` + `useInfiniteScroll` | Ported in Phase 4 **explicitly so Phase 5's community list could reuse it**; it already reads the observer root from `ScrollContainerContext`, which is the part that is easy to get wrong inside a padded scrollport |
| Story comments UI | A second comment list | `@tria/module-feed/ui` `CommentSheet` + `CommentsList` with a `flat` prop (D-82) | Two lists drift the first time a label or an optimistic update changes |
| Like button and double-tap heart | A story-specific like control | `LikeButton` + `@tria/ui` `DoubleTapHeart` | Already carry the optimistic-count and failed-like-toast behaviour |
| Signed uploads, TUS, Mux direct upload, "processando" | A story-specific upload path | `apps/web/components/media/useSignedUpload` | 03-04/03-07 own both branches including the provider branch that skips `complete` |
| Video playback with signed tokens | A `<video>` + hls.js | `apps/web/components/media/VideoPlayer` / `<MuxPlayer>` | Per-request playback tokens (D-44) must never be cached; the existing component already mints and refuses correctly |
| Image variants for covers/thumbnails | A resize in the API | `GET /v1/media/{assetId}/{variant}` + `PURPOSE_WIDTHS` | MEDIA-01/TENANT-04: a payload never carries a signed Storage URL |
| Counters (`post_count`, `like_count`, `comment_count`) | Application-side `+ 1` | A `plpgsql` trigger, `search_path = ''`, not `security definer` | The Phase 4 counters migration states the reasoning; an app-side increment is a second statement that can fail |
| "One reply level", "no reply to a story comment", "no like on a story comment" | Service-layer `if` checks | Composite FKs + CHECKs | The roadmap says the DB must refuse; an app check passes its own tests while the constraint is missing |
| Tenant isolation on the four new tables | A `where tenant_id` in each query only | `tenantIsolationPolicy('<table>_tenant_isolation')` + the explicit predicate + the lane | Three layers, and `010-rls-coverage.sql` fails the build on a missing policy |
| Story progress bars | A CSS `animation` per segment | One rAF clock driving `width` | Pause/resume/skip are unscrubbable on a CSS animation |

**Key insight:** every "new" capability in Phase 5 is an existing capability pointed at a new row type. The single genuinely new thing is the declarative STORY-05 constraint pair — and that too is a copy, of `feed_comments_parent_fk`'s technique, extended by one column.

---

## Runtime State Inventory

> Phase 5 is not a rename, but it **migrates existing rows and adds constraints to live tables**, so the same five questions are worth answering explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `feed_comments` (20 rows local) and `feed_likes` gain `target_kind` (generated — computed automatically) and `parent_target_kind` / `comment_target_kind` (**must be backfilled**: `update … set parent_target_kind = 'post' where parent_id is not null`, `update … set comment_target_kind = 'post' where comment_id is not null`). Verified in the dry-run: `UPDATE 7` and `UPDATE 2` respectively, after which the new constraints validate cleanly | **Data migration** inside the same migration file, ordered *before* the constraints are added. Adding a stored generated column rewrites the table — acceptable at pilot volume, noted for the record |
| Live service config | None. No n8n/Datadog/Cloudflare equivalent exists in this project. Supabase `config.toml` needs no change: the `media` and `branding` buckets already exist and no new bucket is introduced (story media lands in `media`, community covers in `media`) | None — verified by `ls supabase/` and the absence of any new bucket in the media contract |
| OS-registered state | None — verified: no scheduler, launchd or pm2 registration in this repo | None |
| Secrets / env vars | None new. Mux, Supabase and VAPID keys are unchanged; no new provider is introduced | None |
| Build artifacts / installed packages | Two **new workspace packages** (`@tria/module-communities`, `@tria/module-stories`) require `pnpm install` so the workspace links resolve, and `apps/api` + `apps/web` gain `workspace:*` dependencies on them. `turbo.json` task graph picks them up automatically via the `packages/*` glob; `apps/api/drizzle.config.ts` already globs `packages/modules/*/db/schema.ts` | `pnpm install` after the package skeletons land, before the first `pnpm db:generate` |

**One more, specific to this phase:** `scripts/seed.ts` must be extended in **both** demo tenants with identical-looking content — communities with and without covers, active and expired stories, at least one pinned expired story, story likes and flat story comments — or the isolation suite, the expiry predicate test and the pinned-survives-expiry test have nothing to assert against, and the Playwright specs have no fixture.

---

## Common Pitfalls

### Pitfall 1: A CHECK constraint that evaluates to `NULL` is **satisfied** — and Phase 4 has one

**What goes wrong:** SQL's three-valued logic means a CHECK passes unless it evaluates to `false`. `feed_comments_parent_shape_chk`'s second branch is `(parent_id is not null and parent_depth = 0 and depth = 1)`. With `parent_depth` null that branch is `true AND NULL AND true = NULL`, so the whole check is `false OR NULL = NULL` → **passes**. And because a composite FK uses MATCH SIMPLE, `feed_comments_parent_fk` is **not enforced at all** when any of its columns is null.

**Verified against the real table this session** (rolled back):

```
insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth)
select tenant_id, post_id, author_user_id, 'PROBE …', 1, id, null from root;
 → INSERT 0 1     (id fe0cb51d-…, depth 1, parent_id 0d000000-…-c3, parent_depth NULL)
```

The API never writes that shape `[VERIFIED: packages/modules/feed/server/service.ts:1172-1176]` — "`parent_depth` is the LITERAL 0, not `c.depth`" — so this is a defense-in-depth gap, not a live bug. But FEED-05 says "enforced by a DB constraint", and a row like that would be a depth-1 reply whose parent was never checked to exist, to be in this tenant, or to be a root.

**How to avoid:** add an explicit `is not null` guard to every equality inside a multi-branch CHECK. Verified: the fixed form returns `false` for the same inputs, and the probe above now fails with `ERROR: … violates check constraint "feed_comments_parent_shape_chk"`. Phase 5 rewrites this constraint anyway; closing the hole is three extra conjuncts.

**Warning signs:** any CHECK of the shape `(a is null and …) or (a is not null and b = <lit>)` where `b` is nullable.

### Pitfall 2: `feed_likes_comment_kind_chk` written the naive way has the same hole

The first version probed this session — `(comment_id is null and comment_target_kind is null) or (comment_id is not null and comment_target_kind = 'post')` — **accepted** a row with `comment_id` set and `comment_target_kind` null (`INSERT 0 1`), and MATCH SIMPLE then skipped the FK entirely. The story comment was liked. The corrected form adds `comment_target_kind is not null` and refuses it. **The two constraints must be written together and probed together**; the FK alone is not sufficient, because a null discriminator disables it.

### Pitfall 3: D-73's index claim, taken at face value, ships a sequential scan

Covered in Pattern 3. The symptom in production would be invisible at pilot volume and catastrophic at a few thousand posts. The defence is a fourth `EXPLAIN` assertion in the pgTAP file, built on its own volume fixture with `analyze` (the 090-feed.sql technique), not a benchmark.

### Pitfall 4: Keyset-paging an aggregate

`order by max(feed_posts.created_at) desc` over a `group by communities.id` cannot use an index for the cursor comparison and must materialise every community before it can answer page 1. Symptom: fine with five communities, visibly slow at sixty — exactly the case D-76 says the list "simply cannot break" on. The trigger-owned `last_activity_at` column is the fix (Pattern 4).

### Pitfall 5: The ~60 s story limit is enforced **after** the upload, asynchronously

Mux does not enforce duration at ingest; the worker measures it on the `ready` event and flips the asset to `rejected`/`duration_too_long`, deleting the provider asset. A publish screen that only validates before upload will show "processando" and then, silently, nothing. The flow must render a terminal rejected state with pt-BR copy from the existing `MEDIA_ISSUES` vocabulary, and D-84's history must be able to show it. The Storage (image) branch is synchronous by contrast — two different shapes in one screen.

### Pitfall 6: iOS will not autoplay story video unless it is `muted` **and** `playsinline`

iOS Safari autoplays only muted video, and `playsinline` is what stops playback from taking over the screen in fullscreen; even then autoplay is not guaranteed (Low Power Mode blocks it), so the UI must detect that playback did not start and show a play affordance. `[CITED: webkit.org/blog/6784/new-video-policies-for-ios/ and developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay]` The existing `VideoPlayer` already passes `playsInline` `[VERIFIED: apps/web/components/media/VideoPlayer.tsx:212-224]`; the viewer must additionally start **muted** (which D-79's sibling decision — mute default — already implies) and treat "did not start" as a state, not an impossibility. This is a real product consequence: the whole point of a story is that it plays by itself.

### Pitfall 7: `DoubleTapHeart` and tap-to-navigate are the same gesture

A tap on the right advances the story; a double-tap likes it. Without a disambiguation delay the first tap of a double-tap advances before the second arrives, and the member both skips the story and fails to like it. Either (a) hold the advance for the double-tap window (~250–300 ms, which is perceptible), or (b) **make the like affordance an explicit button in the overlay and keep double-tap out of the viewer entirely**. Recommend (b) and record it as a decision: the feed already teaches double-tap on a card that does not navigate, and the viewer's overlay has room for a heart. Whichever is chosen, it must be settled in the D-33 UI-SPEC, not discovered in code review.

### Pitfall 8: Two comment orderings, two indexes

D-83 puts story comments oldest→newest while D-62 puts post root comments newest→oldest. The existing `feed_comments_tenant_post_root_idx` is `DESC` and partial on `parent_id is null`; a story's list needs its own **ascending** index `(tenant_id, story_id, created_at, id) where parent_id is null`. Reusing the DESC index for an ASC order produces a backward scan that cannot be keyset-paged with the existing cursor comparison (`<` vs `>`), and the paging service must flip the comparison operator for this one list. One index, one direction, one comparison — write them in the same commit.

### Pitfall 9: `deleted_at` is deliberately **not** in the RLS policies

Phase 4 kept `deleted_at is null` out of `tenantIsolationPolicy` so Phase 8 moderation can see removed rows through the tenant lane. Every new read in Phase 5 must therefore carry the filter itself — `stories`, `communities`, and the pin join through `stories`. A missing filter shows deleted content; it does not fail a test that only checks tenant isolation.

### Pitfall 10: The counter trigger and the soft delete disagree

The Phase 4 comment counter fires on `update of deleted_at` and branches on the *transition*, because a soft delete is an UPDATE. The new story counters must do the same, and the community `post_count` must follow `feed_posts.deleted_at` as well as inserts and deletes — otherwise an archived-then-restored or soft-deleted post leaves a phantom in COMM-03's count forever.

### Pitfall 11: N+1 on the community list and the strip

The feed's CI query budget (`pg_stat_statements` `sum(calls)` delta) is the precedent. The community list must hydrate cover asset + counts in **one** statement per page, and the strip must hydrate media + `viewer_liked` in one. Extend `apps/api/tests/integration/feed-query-budget.test.ts` (or add a sibling) with a budget for `/v1/communities` and `/v1/stories` — with a **floor as well as a ceiling**, the correction B-WR-06 already made once, so an empty measurement cannot pass at zero.

### Pitfall 12: The prototype's imports do not exist here

`reference/frontend-design` uses `framer-motion`, `@/lib/mock/*` and plain `<img>`. The repo standardised on `motion` 13.3.0, real API payloads and the media broker. Port the *behaviour and the numbers* (`LIMIAR = 60`, `0.35`, the easing curve, `STORY_DURATION_MS`), never the imports. `scripts/check-ui-literals.sh` will additionally fail on any ported hex literal or pt-BR string.

---

## Code Examples

### 1. The STORY-05 constraint pair (the `--custom` migration)

```sql
-- The discriminator: STORED GENERATED, so no application code can lie about it and no trigger is
-- needed to keep it true. Verified: a stored generated column may be part of a UNIQUE constraint and
-- may be the REFERENCED side of a composite foreign key (Postgres 17.6).
alter table public.feed_comments
  add column target_kind text
  generated always as (case when post_id is not null then 'post' else 'story' end) stored;

alter table public.feed_comments add column parent_target_kind text;
update public.feed_comments set parent_target_kind = 'post' where parent_id is not null;

alter table public.feed_comments
  drop constraint feed_comments_parent_fk,
  drop constraint feed_comments_parent_shape_chk;

alter table public.feed_comments
  add constraint feed_comments_id_depth_kind_uq unique (id, depth, target_kind),
  add constraint feed_comments_id_kind_uq       unique (id, target_kind);

-- A reply may only name an (id, depth, target_kind) triple that EXISTS, and the shape check below
-- pins the only legal triple to (parent, 0, 'post'). A story comment is therefore unreachable as a
-- parent: there is no legal value of parent_target_kind that would find it.
alter table public.feed_comments
  add constraint feed_comments_parent_fk
  foreign key (parent_id, parent_depth, parent_target_kind)
  references public.feed_comments (id, depth, target_kind) on delete cascade;

-- EVERY equality is guarded by an `is not null`. Without the guards the branch evaluates to NULL for
-- a null column, and a CHECK that is NULL is SATISFIED — verified, see PITFALL 1.
alter table public.feed_comments
  add constraint feed_comments_parent_shape_chk check (
    (parent_id is null and parent_depth is null and parent_target_kind is null and depth = 0)
    or (parent_id is not null
        and parent_depth is not null and parent_depth = 0
        and parent_target_kind is not null and parent_target_kind = 'post'
        and depth = 1)
  );

-- The like half. Same technique, two columns instead of three.
alter table public.feed_likes add column comment_target_kind text;
update public.feed_likes set comment_target_kind = 'post' where comment_id is not null;

alter table public.feed_likes
  add constraint feed_likes_comment_kind_chk check (
    (comment_id is null and comment_target_kind is null)
    or (comment_id is not null and comment_target_kind is not null and comment_target_kind = 'post')
  ),
  add constraint feed_likes_comment_fk
  foreign key (comment_id, comment_target_kind)
  references public.feed_comments (id, target_kind) on delete cascade;
```

### 2. The pgTAP negative tests, each with its positive control (SCHEMA-CONVENTIONS §(j))

```sql
-- STORY-05: a reply to a story comment is refused by the DATABASE, both honestly and while lying.
select throws_ok(
  $$insert into public.feed_comments (tenant_id, story_id, author_user_id, body, depth,
                                      parent_id, parent_depth, parent_target_kind)
    values (tests.tenant_a(), tests.story_a(), tests.member_a(), 'x', 1,
            tests.story_comment_a(), 0, 'story')$$,
  '23514', null, 'a reply to a story comment is refused by the shape CHECK');

select throws_ok(
  $$insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth,
                                      parent_id, parent_depth, parent_target_kind)
    values (tests.tenant_a(), tests.post_a(), tests.member_a(), 'x', 1,
            tests.story_comment_a(), 0, 'post')$$,
  '23503', null, 'lying about the parent kind is refused by the composite FK');

-- POSITIVE CONTROL in the same test: a reply to a POST comment still works, so a constraint that
-- refused everything could not pass this file.
select lives_ok(
  $$insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth,
                                      parent_id, parent_depth, parent_target_kind)
    values (tests.tenant_a(), tests.post_a(), tests.member_a(), 'ok', 1,
            tests.post_comment_a(), 0, 'post')$$,
  'a reply to a post comment is still accepted');

-- STORY-05 second half.
select throws_ok(
  $$insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
    values (tests.tenant_a(), tests.member_a(), tests.story_comment_a(), 'story')$$,
  '23514', null, 'a like on a story comment is refused');
select lives_ok(
  $$insert into public.feed_likes (tenant_id, user_id, story_id)
    values (tests.tenant_a(), tests.member_a(), tests.story_a())$$,
  'a like on the STORY itself is accepted (STORY-05 first half)');
```

### 3. The expiry predicate under a clock the test controls

```sql
-- STORY-03 without sleeping: publish one story in the past and one now, then assert the strip
-- predicate. `now()` inside a transaction is the transaction timestamp, so this is deterministic.
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind,
                            published_at, expires_at)
values (tests.uuid('e1'), tests.tenant_a(), tests.admin_a(), tests.asset_a(), 'image',
        now() - interval '25 hours', now() - interval '1 hour'),   -- expired
       (tests.uuid('a1'), tests.tenant_a(), tests.admin_a(), tests.asset_a(), 'image',
        now() - interval '1 hour',   now() + interval '23 hours'); -- active

select results_eq(
  $$select id from public.stories
     where tenant_id = tests.tenant_a() and deleted_at is null and expires_at > now()
     order by expires_at desc, id desc$$,
  $$values (tests.uuid('a1'))$$,
  'the strip shows only the active story — and the expired ROW is retained');

select isnt_empty(
  $$select 1 from public.stories where id = tests.uuid('e1')$$,
  'STORY-03: the expired story is hidden, never deleted');

-- STORY-04: pinning the EXPIRED story makes it visible on the community page anyway.
insert into public.story_community_pins (tenant_id, story_id, community_id, pinned_by_user_id)
values (tests.tenant_a(), tests.uuid('e1'), tests.community_a(), tests.admin_a());

select results_eq(
  $$select s.id from public.story_community_pins p
      join public.stories s on s.id = p.story_id and s.tenant_id = p.tenant_id
     where p.tenant_id = tests.tenant_a() and p.community_id = tests.community_a()
       and s.deleted_at is null
     order by p.pinned_at desc$$,
  $$values (tests.uuid('e1'))$$,
  'STORY-04: a pinned story outlives its expiry on the community page');
```

### 4. The merged-feed predicate and its module-flag fallback (D-73 / D-74)

```ts
// packages/modules/feed/server/service.ts — ONE query, ONE ordering expression, TWO predicates.
// `communitiesEnabled` comes from the request context's module flags, never from a second route.
const communityPredicate = communitiesEnabled
  ? sql``                                  // D-73: no filter — every member sees every community
  : sql`and p.community_id is null`;       // D-74: the Phase 4 partial index, unchanged

const rows = await withTenantTx(ctx, (tx) =>
  tx.execute<FeedRow>(sql`
    ${postProjection(ctx.userId)}
     where p.deleted_at is null
       ${communityPredicate}
       and (
         ${afterAt}::timestamptz is null
         or (p.created_at, p.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
       )
     order by p.created_at desc, p.id desc
     limit ${limit + 1}`),
);
```

`postProjection` gains the community summary (`c.id`, `c.name`, `c.slug`) through a `left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id` so D-71's label costs no extra statement — the query-budget test is what keeps that honest.

### 5. The `EXPLAIN` acceptance assertion for the new index (pgTAP)

```sql
-- The 090-feed.sql technique: build a volume fixture inside THIS transaction, `analyze`, capture the
-- plan into a temp table with `execute … into` (EXPLAIN cannot be a subquery), then assert on it.
do $$
declare v_plan text;
begin
  execute
    'explain (format json) select p.id, p.created_at from public.feed_posts p
      where p.tenant_id = ''…'' and p.deleted_at is null
      order by p.created_at desc, p.id desc limit 10' into v_plan;
  insert into feed_plans values ('merged_feed', v_plan);
end $$;

select ok(
  (select plan from feed_plans where name = 'merged_feed') like '%feed_posts_tenant_created_all_idx%',
  'D-73: the merged feed is served by an index scan, not a sequential scan + sort');
```

### 6. The story viewer's rAF clock (the shape, not the finished component)

```tsx
// One clock for the whole sequence. `paused` is driven by pointerdown/up AND by the comment sheet
// (D-82), so "hold to pause" and "the sheet is open" are the same mechanism rather than two.
useEffect(() => {
  if (paused || !current) return;
  const durationMs = current.mediaKind === 'video'
    ? (current.durationSeconds ?? 0) * 1000
    : STORY_DURATION_MS;                       // 5000 — the design team's own constant
  let raf = 0;
  let start = performance.now() - elapsedRef.current;
  const tick = (t: number) => {
    const elapsed = t - start;
    elapsedRef.current = elapsed;
    setProgress(Math.min(1, elapsed / durationMs));
    if (elapsed >= durationMs) { advance(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}, [paused, current, advance]);
```

A CSS `animation` cannot be scrubbed back to `elapsedRef.current` on resume, which is why the clock is in JS.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Polymorphic `target_type` + `target_id` for shared behaviours (SCHEMA-CONVENTIONS §(e).1's sketch) | Nullable typed FK columns + `num_nonnulls` CHECK + partial unique indexes (§(e).3) | Phase 4 (`feed_likes`, `feed_comments`) | Referential integrity survives a delete; the counter triggers have something to cascade from. Phase 5 extends the same table rather than adding `story_likes` |
| Business rules enforced by `before insert` triggers | Composite foreign keys + CHECKs — a rule with no read-then-write window | Phase 4 (`feed_comments_parent_fk`, `feed_post_media_kind_fk`) | Phase 5's STORY-05 joins that family; a **stored generated column** is the new ingredient that makes the target visible to the constraint |
| Offset pagination | Keyset cursors on the ordered expression the index carries | Phase 3 (`paging.ts`) | Stable under concurrent writes; the whole reason D-76's ordering must be a column |
| Scheduled cleanup of ephemeral content | A `where` predicate on `expires_at` | Roadmap / SCHEMA-CONVENTIONS §(d).3 | No job, no worker, no drift; the record is retained for D-84's history for free |
| `framer-motion` (prototype) | `motion` 13.3.0 | Phase 2 | Port the animation, never the import |
| Client data-cache library for infinite lists | Server-action pagination + `InfiniteScroll` | Phase 4 (04-06) | Revisited in Phase 7 for realtime, not here |

**Deprecated/outdated for this phase:**
- The prototype's `CommunityTopic` model (title + Discussão/Trend/Exclusivo/Vídeo chip) — retired by D-51; there is one post model.
- The prototype's `VerifiedBadge` and `CommentRow` — on PROTOTYPE.md §11's do-not-port list.
- The prototype's community activity badge and member count — dropped by D-75.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `drizzle-kit generate` 0.31.10 emits the stored generated column, the 3-column `unique` and the 3-column composite FK cleanly, so `db/schema.ts` stays the source of truth | Pattern 2 | Low — the fallback is documented (move that constraint to the `--custom` migration). Phase 4 hit the same fork and kept both halves working. Verify by running `pnpm db:generate` in the first schema task and reading the SQL |
| A2 | Adding a stored generated column to `feed_comments` (table rewrite) is acceptable at pilot volume | Runtime State Inventory | Low at 20 rows locally / pilot scale; would need `ALTER … ADD COLUMN` staging at millions of rows. Note it in the migration header |
| A3 | Archive keeps an archived community's posts in the main feed (the Pattern 7 recommendation) | Pattern 7 | Medium — it is a product judgement inside Claude's discretion, chosen because the alternative forces a denormalised flag and a fourth index. If the user disagrees, the cost is a trigger + column + index, not a redesign |
| A4 | The community circle row shows **pinned only**, and a pinned expired story stays likeable/commentable | Pattern 6 | Low — both are one predicate each to flip, and both were explicitly left to Claude |
| A5 | Double-tap-to-like is **removed** from the story viewer in favour of an explicit heart button | Pitfall 7 | Medium — it is a UX call the design team should confirm in the D-33 review; shipping both gestures on one surface is the failure mode |
| A6 | `STORY_DURATION_MS = 5000` is the right image duration | Pattern 9 | Low — it is the design team's own constant, verified in `lib/constants.ts`, but it was never exercised in the prototype |
| A7 | The stories strip registers at `ModuleHomeSlot.order` **below** 10 so it sits above the feed on `/inicio` | Recommended Project Structure | Low — one number; but it interacts with the D-02 profile nudge, so the UI-SPEC should state the final order of all three home elements |
| A8 | No Phase 5 work needs pg-boss | Standard Stack | Low — nothing in the requirements is asynchronous except the Mux duration check, which already has its job |
| A9 | Story comments need their own ascending index and a flipped cursor comparison | Pitfall 8 | Low — mechanically forced by D-83; the risk is only that it is forgotten and the list silently sorts in memory |

---

## Open Questions (RESOLVED)

All four were settled by their own recommendation and acted on during the executed phase
(05-01…05-08). None of them bears on either FAILED truth of `05-VERIFICATION.md`; the resolutions
below are recorded so this section cannot be read as outstanding research.

1. **What exactly does "archive" mean to the pilot tenant?**
   - What we know: COMM-01 says "create, edit and archive"; CONTEXT.md leaves the semantics to Claude with one hard constraint (one feed query, one predicate).
   - What's unclear: whether the product owner expects an archived community's posts to disappear from the feed.
   - Recommendation: ship Pattern 7 (posts stay, list hides, page read-only, writes refused, reversible) and put it in the UAT script as an explicit question. It is the only variant that costs zero index and zero denormalisation, and every alternative is additive later.
   - **RESOLVED — shipped as recommended (05-04).** Pattern 7 is the implemented semantics: the write gate, the list gate and the absence of an archive predicate in `listFeed`. The product-owner question survives as 05-04's archive prohibition, carried `unverified` / `flagged` in `05-VERIFICATION.md` and routed to the human pack by 05-12.

2. **Do the five prototype-less surfaces need one UI-SPEC or two?**
   - What we know: D-33 requires a UI-SPEC + static mockup approved with the design team before a prototype-less screen is coded; D-66 names five surfaces across two modules.
   - What's unclear: whether `/gsd-ui-phase` should produce one `05-UI-SPEC.md` covering both modules or one per module.
   - Recommendation: **one** `05-UI-SPEC.md`. The strip, the viewer and the publish flow share a visual language with the pin flow that lives inside the story history, and the community form is the only outlier; splitting it would duplicate the Copywriting Contract.
   - **RESOLVED — shipped as recommended.** A single `.planning/phases/05-communities-stories/05-UI-SPEC.md` covers both modules; it is the file the phase's UI-SPEC lift accounting reports 101 of 101 state considerations against.

3. **Does the design team accept the "Destaques" circles becoming interactive?**
   - What we know: D-68 answers PROTOTYPE.md open question 1 with "yes", and the CONTEXT explicitly says the design team should be *told*.
   - What's unclear: nothing blocking — but the prototype's circles are 64 px with a 2 px neutral border, and an interactive circle usually wants a larger hit target and a pressed state.
   - Recommendation: carry it as a line item in the D-33 review rather than a code decision.
   - **RESOLVED — carried as recommended, not made a code decision.** The Destaques circles shipped interactive per D-68 (`apps/web/app/(app)/comunidades/[communityId]/page.tsx` hands them the same `onOpen` the home strip uses); the hit-target and pressed-state question stays a D-33 review line item and is not a research gap.

4. **Should `/comunidades/[communityId]` be slug-based or id-based?**
   - What we know: the prototype uses `[communityId]`; Phase 4's share target is `/post/[id]` (D-56).
   - What's unclear: whether a readable community URL matters for the pilot.
   - Recommendation: **id-based route, slug stored and unique per tenant**, matching D-56's precedent and keeping a slug-based redirect trivially addable. Do not spend a decision on it.
   - **RESOLVED — shipped as recommended.** The route is `apps/web/app/(app)/comunidades/[communityId]/`, with the slug stored and unique per tenant (the slug-retry loop in the communities service). A slug-based redirect stays trivially addable.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js | Everything | ✓ | v24.14.0 | — |
| pnpm | Monorepo | ✓ | 12.4.1 | — |
| Docker | Local Supabase stack | ✓ | running | — |
| Supabase CLI | Migrations, `supabase test db` | ✓ | 2.117.0 | — |
| Local Postgres (Supabase) | pgTAP, integration tests, the probes in this doc | ✓ | PostgreSQL 17.6, container `supabase_db_rede-social` healthy on `127.0.0.1:54322` | — |
| `psql` | Migration review, probes | ✓ | 18.3 (client) | — |
| Supabase Auth / Storage / Realtime containers | Integration + e2e | ✓ | all `Up … (healthy)` | — |
| Mux account / credentials | STORY-01 video path | — (not probed; the `fake` provider exists for local, `MEDIA_PROVIDERS = ['supabase','mux','fake']`) | — | The `fake` VideoProvider (03-06) covers local + CI; a real Mux run is part of the deferred cloud work |
| Playwright browsers | e2e | ✓ (used by Phase 4's suites) | 1.63.0 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** real Mux credentials — the `fake` provider is the documented local/CI path, consistent with the project-wide "cloud work deferred to the end" posture.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (unit + integration), pgTAP via `supabase test db` (CLI 2.117.0), Playwright 1.63.0 (e2e) |
| Config file | per-package `vitest.config.ts`; `apps/web/playwright.config.ts` + `playwright.pwa.config.ts`; `supabase/tests/*.sql` |
| Quick run command | `pnpm --filter @tria/module-communities test && pnpm --filter @tria/module-stories test` (new packages) / `pnpm --filter @tria/api test` |
| Full suite command | `pnpm verify` (the local exit gate; `ci.yml` mirrors it step for step) |
| Estimated runtime | Phase 4 baseline ~21m51s (unit 512, pgTAP 191→195, integration 373, e2e 328); Phase 5 adds ~2 pgTAP files' worth and 3–4 specs |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMM-01 | Create / edit / archive a community; archived is refused for writes, still readable by link, absent from the list | integration | `npx vitest run tests/integration/communities.test.ts` (apps/api) | ❌ Wave 0 |
| COMM-01 | Cover optional → brand-gradient fallback renders | e2e | `comunidades.spec.ts` | ❌ Wave 0 |
| COMM-02 | Every member sees every community; `community_members` exists with RLS + policy and a cross-tenant case | pgTAP | `pnpm supabase test db` (`110-communities-stories.sql`, `020-tenant-isolation.sql`) | ❌ Wave 0 |
| COMM-03 | List shows cover/name/description/post count; keyset pages; ordering by `last_activity_at` is index-served | integration + pgTAP | `npx vitest run tests/integration/communities.test.ts` · `pnpm supabase test db` (EXPLAIN block) | ❌ Wave 0 |
| COMM-03 | Community page shows its posts **and** its pinned stories | e2e | `comunidades.spec.ts` | ❌ Wave 0 |
| COMM-04 | Posting into a community from its page; the post appears in both the community and the merged feed | integration + e2e | `npx vitest run tests/integration/communities.test.ts` · `comunidades.spec.ts` | ❌ Wave 0 |
| D-73 / FEED-02 | Merged feed is **index-served** (not Seq Scan + Sort) and strictly chronological across both sources | pgTAP + integration | `pnpm supabase test db` (`090-feed.sql` new plan assertion) · `feed.test.ts` | ⚠️ extend `090-feed.sql` |
| D-74 | Turning `communities` off reverts the predicate; posts survive; re-enabling restores | integration | `npx vitest run tests/integration/communities.test.ts` (module-flag witness, both directions) | ❌ Wave 0 |
| STORY-01 | Publish image and video stories with optional caption; `purpose: 'story'`; >60 s video ends `rejected`/`duration_too_long` | integration | `npx vitest run tests/integration/stories.test.ts` · existing `mux-webhook.test.ts` pattern | ❌ Wave 0 |
| STORY-02 | Strip renders active stories newest-first; viewer advances, tap-navigates, holds-to-pause; comment sheet pauses it | e2e (mobile project) | `stories.spec.ts` | ❌ Wave 0 |
| STORY-02 | Progress clock unit behaviour (pause/resume/skip preserves elapsed) | unit | `pnpm --filter @tria/module-stories test` (`story-clock.test.ts`) | ❌ Wave 0 |
| STORY-03 | Active/expired split under a controlled clock; the expired **row is retained** | pgTAP | `pnpm supabase test db` (`110-communities-stories.sql`) | ❌ Wave 0 |
| STORY-04 | Pin/unpin; a pinned expired story still renders on the community page; unpin removes it | pgTAP + integration | `pnpm supabase test db` · `npx vitest run tests/integration/stories.test.ts` | ❌ Wave 0 |
| STORY-05 | Reply to a story comment and like of a story comment refused by the **DB** (honest + lying), with positive controls | pgTAP | `pnpm supabase test db` (`110-communities-stories.sql`) | ❌ Wave 0 |
| STORY-05 | The same two refusals at the **API**, as stable machine codes | integration | `npx vitest run tests/integration/stories.test.ts` | ❌ Wave 0 |
| Pitfall 1 | The 3-valued CHECK hole is closed: `depth = 1` with `parent_depth` null is refused | pgTAP | `pnpm supabase test db` (`090-feed.sql` or `110-…`) | ❌ Wave 0 |
| TENANT-05 | Cross-tenant: `communities`, `community_members`, `stories`, `story_community_pins` each see own rows and **zero** of tenant B, with identical-looking content | pgTAP + integration | `pnpm supabase test db` (`020-tenant-isolation.sql`) · `npx vitest run tests/integration/isolation.test.ts` | ⚠️ extend both |
| MOD-03 | New domain events typed, emitted after commit, once, none on rollback | unit | `pnpm --filter @tria/module-stories test` (`events.test.ts`) | ❌ Wave 0 |
| MOD-04 | Two modules mount/unmount by flag; a disabled module's routes 404 | integration | `npx vitest run tests/integration/isolation.test.ts` | ⚠️ extend |
| Query budget | `/v1/communities` and `/v1/stories` each execute ≤ N statements per page, with a **floor** as well as a ceiling | integration | `npx vitest run tests/integration/feed-query-budget.test.ts` (extended) | ⚠️ extend |
| UI-01/UI-04 | Five prototype-less surfaces approved through the D-33 UI-SPEC + mockup | manual | — | manual-only |
| ADMIN-04 | Every admin creation flow usable from a phone | e2e (mobile viewport) | `comunidades.spec.ts` · `stories.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm --filter @tria/module-communities test && pnpm --filter @tria/module-stories test && pnpm --filter @tria/api test` (T1, ≤ 60 s)
- **Per wave merge:** `pnpm lint && pnpm turbo typecheck test && pnpm supabase test db && pnpm test:integration` (T2, ≤ 5 min per task when filtered)
- **Phase gate:** `pnpm verify` green before `/gsd-verify-work` (T3, run once, ≤ 25 min)

Phase 5 inherits Phase 4's **tiered** ceiling for the same reason: the strip, the viewer's tap/hold/advance gestures and the comment sheet pausing playback are only observable in a browser, so a targeted Playwright spec is the *primary* signal for them, not a slow substitute. Order every task's `<automated>` chain T1 → T2 so `&&` short-circuits on the cheapest gate that can fail; `pnpm verify` appears only in the final plan's last task.

### Wave 0 Gaps

- [ ] `packages/modules/communities/{vitest.config.ts,package.json test script}` — new package has no runner
- [ ] `packages/modules/stories/{vitest.config.ts,package.json test script}` — new package has no runner
- [ ] `packages/modules/stories/tests/story-clock.test.ts` — the rAF progress clock's pause/resume/skip contract, with an injected clock (no timers in the assertion)
- [ ] `packages/modules/stories/tests/events.test.ts` — after-commit emission, once-only, none-on-rollback (the `@tria/module-feed/tests/events.test.ts` copy)
- [ ] `apps/api/tests/integration/communities.test.ts` — CRUD, archive semantics, COMM-04 write path, the D-74 module-flag witness in **both** directions
- [ ] `apps/api/tests/integration/stories.test.ts` — publish (image + video), expiry visibility, pin/unpin, story like/comment, and the two STORY-05 API refusals by machine code
- [ ] `supabase/tests/110-communities-stories.sql` — STORY-05 negatives + positive controls, the Pitfall-1 probe, the controlled-clock expiry pair, the pinned-survives-expiry case, counter reconciliation for `post_count` / `last_activity_at` / story counters, and an `EXPLAIN` block for the community list ordering
- [ ] `supabase/tests/020-tenant-isolation.sql` — a case per new table, identical-looking content in both tenants, positive control in the same test
- [ ] `supabase/tests/090-feed.sql` — a fourth plan assertion for the **merged feed** index (D-73), on its own volume fixture
- [ ] `apps/api/tests/integration/isolation.test.ts` — cross-tenant 404 for a community id, a story id and a pin; `403 TENANT_HOST_MISMATCH` on the new routes
- [ ] `apps/api/tests/integration/feed-query-budget.test.ts` — budgets for `/v1/communities` and `/v1/stories`, each with ceiling **and** floor
- [ ] `apps/web/e2e/comunidades.spec.ts` — tab → list → page → post path, cover-less gradient fallback, admin FAB pre-fills `/criar`, archived read-only state
- [ ] `apps/web/e2e/stories.spec.ts` — mobile project: strip order, viewer advance/tap/hold, comment sheet pauses, admin "+" circle invisible to members, "Seus stories" pin flow. Set `serviceWorkers: 'block'` on any spec that intercepts GET (03-05 precedent)
- [ ] `apps/web/e2e/phase5-smoke.spec.ts` — the per-phase two-direction module-flag witness for `communities` and `stories`
- [ ] `scripts/seed.ts` — communities with and without covers, active + expired stories, ≥1 pinned expired story, story likes and flat story comments, in **both** demo tenants with identical-looking content

---

## Security Domain

### Applicable ASVS Categories (level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (inherited) | `requireAuth` + Supabase JWKS verification, unchanged |
| V3 Session Management | no (inherited) | HttpOnly cookies via the Next BFF, unchanged |
| V4 Access Control | **yes** | `requireModule` (404, never 403, so a member cannot tell "not allowed" from "not here") → `requirePermission('communities.community.manage'` / `'stories.story.publish'` / `'stories.story.manage'`) → explicit `tenant_id` predicate → RLS `tenantIsolationPolicy` on all four new tables. Cross-tenant ids answer a **bare 404 with no `details`** (the D-23 existence-oracle rule) |
| V5 Input Validation | **yes** | Zod 4 `.strict()` schemas in each module's `contracts/index.ts`; caption/description/name length caps measured in UTF-16 code units at both ends (the `FEED_MAX_CAPTION` precedent); cursors validated by `decodeCursor` before anything reaches SQL |
| V6 Cryptography | no | No new secret, no new signing. Mux playback tokens are minted per request by the existing broker and must never be cached, persisted or logged |
| V7 Error Handling & Logging | **yes** | Log the **shape** only — ids, counts, flags. A story caption, a comment body and a community description never reach a log line, an error `details` payload or an OpenAPI example (T-04-05 / T-04-19) |
| V12 Files & Resources | **yes** | Bytes never transit Cloud Run; `MEDIA_LIMITS` mimes + byte caps + the async duration cap; HEIC refused by `REFUSED_IMAGE_MIMES`; objects stay in the private `media` bucket behind `/v1/media/{assetId}/{variant}` |
| V13 API & Web Service | **yes** | OpenAPI from the same Zod schemas; a closed machine-code vocabulary for every refusal |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| A story or community id from tenant B returns content | Information disclosure | Three layers (permission → explicit predicate → RLS) + a cross-tenant case per table in `020` and in `isolation.test.ts`, each with its positive control |
| Enumerating story/community ids to learn what exists | Information disclosure | One bare `404` with **no `details`** for unknown / other-tenant / soft-deleted alike |
| A member likes or replies to a story comment by calling the API directly | Tampering / elevation | **The database refuses it** (Pattern 2); the API's 400 is a translation, not the control |
| A member pins a story, archives a community or deletes a story | Elevation of privilege | `requirePermission`, never a client-side check; the affordance's absence is UX only |
| A crafted cursor reaching SQL | Injection | `decodeCursor` is total and schema-validated; a bad cursor degrades to page 1 |
| `?limit=100000` on the community list or the strip | DoS | Server-side clamp on every list (the `FEED_MAX_PAGE_SIZE` precedent) |
| A caption/description rendered as HTML | Stored XSS | D-54: plain text, render-time linkify in JSX, never `dangerouslySetInnerHTML` |
| A community cover or story image pointing at another tenant's asset | Information disclosure | The asset id must be validated as belonging to this tenant at write time; the broker re-checks at read time |
| A Mux playback token cached in a page payload | Information disclosure | `Cache-Control: no-store` on the playback route; tokens are per-request (D-44) and must not be embedded in the strip payload — the viewer mints on open |
| A story that expires while an admin is composing a pin | Race / consistency | The pin is a row; expiry is a predicate on the *read*. There is no window to lose |

---

## Sources

### Primary (HIGH confidence)

- **This project's local Postgres 17.6** (`supabase_db_rede-social`, `127.0.0.1:54322`) — all constraint probes (A–J), the migration dry-run against the real `feed_comments`/`feed_likes`, the three-valued-CHECK falsification, the generated-column immutability refusal, and every `EXPLAIN` plan in Patterns 3 and 5. Each probe ran inside a transaction and was rolled back.
- `packages/modules/feed/db/schema.ts` — the three Phase 4 slots, the two indexes, the existing CHECKs and the composite-FK technique
- `packages/contracts/src/media.ts` — `MEDIA_PURPOSES`, `PURPOSE_WIDTHS`, `MEDIA_LIMITS` (the `story` and `cover` entries)
- `packages/contracts/src/modules.ts` — `TOGGLEABLE_MODULES`, `REAL_TENANT_DEFAULT_MODULES`
- `packages/contracts/src/events.ts` — the `EventMap` declaration-merging extension point
- `packages/core/server/modules/manifest.ts` — `ModuleNav`, `ModuleHomeSlot`, `ModuleManifest`, `defineModule`
- `packages/core/server/paging.ts` — the one cursor envelope
- `packages/core/server/media/video/event-job.ts` — the asynchronous duration cap
- `packages/core/docs/SCHEMA-CONVENTIONS.md` — §(a) tenancy, §(c) authorship, §(d) lifecycle (incl. §(d).3 "a predicate, not a cron"), §(e) shared behaviours, §(h) migrations, §(j) the test gate, §(k) the new-module checklist
- `supabase/migrations/20260922162449_feed_counters.sql` — the trigger posture (no `security definer`, `search_path = ''`, no clamp)
- `apps/api/src/modules/registry.ts` — `MODULE_REGISTRY`, `permissionsFor`, `setPermissionResolver`
- `apps/web/lib/registry.tsx` — the web composition point for home slots
- `packages/ui/src/index.ts`, `packages/ui/src/layout/InfiniteScroll.tsx` — the ported primitives and their props
- `apps/web/package.json`, `packages/modules/feed/node_modules/drizzle-orm/**` — installed versions and the `generatedAlwaysAs` signature
- `reference/frontend-design/app/(app)/reels/page.tsx`, `.../community/page.tsx`, `.../community/[communityId]/page.tsx`, `lib/constants.ts` — the gesture model, the card layout, the Destaques row, `STORY_DURATION_MS` / `STORY_EXPIRY_HOURS`
- `.planning/phases/04-feed/04-RESEARCH.md`, `04-VALIDATION.md` — the structural model and the tiered sampling contract

### Secondary (MEDIUM confidence)

- [WebKit — New `<video>` Policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/) and [MDN — Autoplay guide for media and Web Audio APIs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) — muted + `playsinline` are both required; autoplay is never guaranteed on iPhone

### Tertiary (LOW confidence)

- [dev.to — "I Rebuilt Instagram Stories' Segmented Progress Bars"](https://dev.to/dev48v/i-rebuilt-instagram-stories-segmented-progress-bars-4bil) — a single rAF loop tracking elapsed vs per-story duration; left/right tap zones; `pointerdown` pauses and `pointerup` resumes. Community source, corroborated only by its own reasoning; used for the *mechanism*, not for any number. The numbers (5000 ms, 60 px, 0.35) all come from the prototype.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — zero new dependencies; every version read from a `package.json` or a `node_modules` manifest in this session
- Schema & constraints (STORY-05, expiry, pins): **HIGH** — falsified against this project's Postgres 17.6, including a migration dry-run on real rows, with positive controls
- Index / query plans (D-73, the strip): **HIGH** — `EXPLAIN` on volume fixtures with `analyze`, both the failing and the fixed plan captured
- Architecture / module layout: **HIGH** — the registry, manifest and composition points were read, not assumed
- Prototype port surface: **HIGH** — every cited line was read from `reference/frontend-design` this session
- Story-viewer timing & gesture model: **MEDIUM** — the numbers are the design team's own constants and the gesture mechanics are the prototype's, but the composition is prototype-less and gated by D-33
- Archive semantics: **MEDIUM** — a reasoned recommendation inside Claude's discretion, constrained by a verified plan finding
- Pitfalls: **HIGH** for 1–5 and 8–10 (in-repo or probed); **MEDIUM** for 6–7 (cited / UX judgement)

**Research date:** 2026-09-23
**Valid until:** 2026-10-23 (30 days — the stack is pinned and this phase adds nothing to it; the in-repo findings are valid until the files change)
