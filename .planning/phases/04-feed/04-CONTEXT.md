# Phase 4: Feed - Context

**Gathered:** 2026-09-22
**Status:** Ready for planning

> Decision numbering continues from Phase 3 (D-01..D-24 in `01-CONTEXT.md`, D-25..D-42 in `02-CONTEXT.md`, D-43..D-50 reserved by `03-CONTEXT.md`, of which D-43..D-47 are used) because code comments already cite those ids; this phase owns **D-51..D-65**.

<domain>
## Phase Boundary

Phase 4 turns the branded shell into a working community: the `admin_tenant` publishes rich posts from a phone, and members consume and interact with them in the feed. It is also the phase that **fixes the content conventions every later module copies** — the shape of likes and comments, one-level replies, keyset-paginated lists, after-commit domain events, and internal share deep links.

- **Composer (FEED-01, MEDIA-04):** an `admin_tenant` creates a post with text plus media — multiple images as a swipeable carousel, one video played through the Mux HLS player, a link preview or YouTube/Vimeo embed unfurled server-side with an SSRF guard and cached on the post, and file attachments (PDF and similar). The composer is the first prototype-less screen of this phase and goes through the D-33 UI-SPEC + mockup review.
- **Feed (FEED-02, UI-02):** members see the tenant's posts newest first, cursor-paginated with infinite scroll and pull-to-refresh, using the ported `PostCard` interactions. Posts without a community plus posts from communities the member can see (the community half lands in Phase 5; the `community_id` column and the predicate are born here).
- **Interactions (FEED-04, FEED-05, FEED-06):** like/unlike a post (idempotent toggle, including double-tap) with a trigger-maintained count; comment; reply exactly one level deep (a deeper reply is rejected by a DB constraint); like/unlike comments and replies.
- **Edit and delete (FEED-03):** the admin edits a post (shown as "editado") and soft-deletes it.
- **Share (FEED-07):** the native share sheet (copy link on desktop) hands out an internal deep link; opening it while logged out routes through login and lands on the post; a member of another tenant gets 404.
- **Conventions (MOD-03, FEED-08):** post, like and comment actions emit typed domain events on the kernel bus after commit; posts/communities/stories carry a generic `author_user_id` and a per-tenant posting policy so V2 member posting is a permission flip; feed pages execute a bounded number of queries (no N+1, keyset cursors) checked in CI.
- **Module hygiene (MOD-01/MOD-02, D-19):** `@rede-social/module-feed` is the first real feature module, and the throwaway `@rede-social/module-example` is removed in this phase.

Out of this phase: communities themselves and story pinning (Phase 5 — this phase only reserves `community_id` on posts, a `story_id` slot on comments and nullable-FK likes); events (Phase 6); notifications generated from these domain events, Web Push and support chat (Phase 7); admin moderation of other people's comments, blocking and the admin panel (Phase 8, MODER-01/MODER-02).

</domain>

<decisions>
## Implementation Decisions

### Post anatomy

- **D-51:** A post has **no title and no type chip**. There is one post model — author, caption text, media, optional `community_id` — and one `PostCard` renders it in the feed, on the post page and (Phase 5) inside a community. This **answers PROTOTYPE.md open question 2 with "drop titles and type chips"**: the prototype's second model (`CommunityTopic` with `title` + Discussão/Trend/Exclusivo/Vídeo chip) is not ported, and the design team should be told so. — **Reversibility:** reversible — a nullable `title` column plus one branch in the card and the composer is additive. The type chip is the expensive half (a per-tenant vocabulary and a brand-derived chip color), which is why it is rejected now rather than deferred into the schema.
- **D-52:** The post is attributed to **the person**, not to the brand: `PostHeader` shows the publishing admin's profile photo and display name, linking to their profile (`PROF-02`). The generic `author_user_id` column (FEED-08) is what is displayed, so V2 member posting changes nothing visually. This does **not** conflict with D-45, which banned a *role badge* on profiles, not authorship. Consequence to plan for: staff profiles become reachable from feed content — D-47 already allows exactly that (staff are hidden from the member directory but their profile opens by direct link). — **Reversibility:** reversible — switching to a brand byline is a change in one header component; the column already holds the right value either way.
- **D-53:** A post carries **either an image gallery or one video — never both** — plus optionally one link preview/embed and file attachments. This keeps the prototype's `PostImage` (snap carousel with dots, wrapped in `DoubleTapHeart`) essentially intact and avoids a `<mux-player>` sitting inside a swipe carousel, with per-slide autoplay and pause rules. It still satisfies FEED-01's "any combination" in the sense that matters: an announcement can carry photos *and* a PDF *and* a link. — **Reversibility:** costly — the rule lives as a DB check constraint, a composer rule and a `PostMedia` renderer branch; relaxing it later needs no data migration but changes every one of those consumers plus the carousel's playback model.
- **D-54:** Post text is **plain text with clickable links**: newlines preserved, URLs auto-linked **at render time** (never stored as HTML), no bold/italic, no markdown, no mentions. Keeps the prototype's `PostCaption` "... mais" truncation and removes the rich-text sanitisation surface entirely. — **Reversibility:** reversible — storage stays plain text, so a future rich-text format arrives as a new column plus a format discriminator rather than a migration of existing rows.

### Feed placement and entry points

- **D-55:** The feed is a **home slot on `/inicio`**, not a new navigation tab: `@rede-social/module-feed` registers a widget through the D-42 home-slot mechanism, and the post list is the main content of the home, below the branded greeting and the D-02 profile nudge. When a tenant has `feed` disabled, `/inicio` still renders the remaining widgets. **Amends D-40**, which had pencilled `feed` → an "Início" tab: the feed contributes a home slot, and the BottomNav/rail keeps its budget for Comunidades (Phase 5), Eventos (Phase 6) and the kernel's Perfil. — **Reversibility:** costly — Phases 5 and 6 plan their nav entries against this tab budget, and the registry manifest's `nav` vs `home` distinction is what they copy.
- **D-56:** The post detail lives at a **dedicated `/post/[id]` route** on the tenant's own domain (the prototype's `app/(app)/post/[postId]` shape): the full `PostCard` plus the comment list inline, under a sticky back header, server-rendered. It is the **FEED-07 share target** — the logged-out visitor is routed through login and lands here — and it is the destination Phase 7's notifications will point at. Cross-tenant access answers 404 (roadmap-locked). — **Reversibility:** costly — once the pilot tenant's members start sharing links, the URL shape is effectively permanent; this is the D-01 lesson applied to content URLs.
- **D-57:** The admin reaches the composer through an **`admin_tenant`-only floating action button over the feed on `/inicio`, navigating to a full-screen `/criar` route**; the edit flow (FEED-03) reuses the same form at `/post/[id]/editar`. Full screen rather than a bottom sheet because picking several images, waiting on an upload, seeing a link preview resolve and attaching a PDF do not fit a sheet with the mobile keyboard up — and because a long video upload must not live in a layer the admin can dismiss by accident. Both screens are prototype-less and go through the **D-33 UI-SPEC + mockup approval before being coded**.
- **D-58:** The feed loads with **infinite scroll plus pull-to-refresh**, exactly as roadmap criterion 2 states and as the prototype already implements (`feed/InfiniteScroll.tsx` + `hooks/useInfiniteScroll.ts`, whose IntersectionObserver root is hardcoded to `#app-scroll` and becomes a prop during the port). Paging rides the keyset cursor convention in `packages/core/server/paging.ts` — the sentinel fetches the next page, pull-to-refresh re-reads the first one.

### Comments and replies

- **D-59:** Comments have **two surfaces backed by one implementation**: tapping the comment icon on a card in the feed opens the ported `CommentSheet` (BottomSheet) without leaving the list, and `/post/[id]` renders the same list inline beneath the post. One list component, two containers — this is the behaviour roadmap criterion 2 names ("the prototype's ported PostCard / CommentSheet interactions").
- **D-60:** Replies are **collapsed behind "Ver N respostas"** — the toggle the prototype's `CommentItem` already has — and load as a **separate paginated query per root comment**. This keeps the list readable on a phone and keeps the page's query count bounded, which criterion 4 measures in CI. The prototype's unbounded recursion is capped at one level during the port (no reply affordance is rendered on a reply), matching the DB constraint FEED-05 requires.
- **D-61:** A member can **soft-delete their own comment or reply**, using the same `deleted_at` column Phase 8's MODER-01 will moderate with — the same route, with one more permission. **Comments are not editable in V1** (FEED-03's edit affordance covers posts only), so there is no comment edit history and no question of a reply that outlives the meaning of its parent.
- **D-62:** Comment ordering is **root comments newest-first, replies within a root oldest→newest**. The list reads as a ranking of threads, each thread reads as a conversation — the Instagram/YouTube behaviour. Two cursor directions over two distinct queries; both use the keyset envelope from `packages/core/server/paging.ts`, whose `n` must be the same ordered expression each index is built on.

### Claude's Discretion

Everything below was explicitly left to Claude or was not selected for discussion. Decide it during research/planning, record the choice, and pin the behaviour with tests — do not re-ask the user.

**Link previews, embeds and attachments (MEDIA-04) — the area the user chose not to discuss**
- Whether the unfurl runs synchronously at create time so the admin sees the preview before publishing, or as a pg-boss worker job that fills the preview in afterwards. The roadmap says "unfurled server-side at create time"; the composer UX (does the admin wait? can they publish while it resolves?) is the open part.
- What the post renders when the unfurl fails, times out or the target has no OG tags — a bare link, a generic card, or nothing — and whether the admin can remove or override a resolved preview.
- YouTube/Vimeo via oEmbed as a sandboxed iframe versus a thumbnail that opens externally; CSP implications either way (PROTOTYPE.md already flags the events map iframe as needing a CSP review).
- The SSRF guard itself (deny private ranges, redirect limit, timeout), the `link_previews` cache keyed by URL hash per tenant, and where the cached fields live relative to the post row.
- Attachment rendering: filename + size + type affordance, signed download through the Phase 3 media route, and what a PDF looks like in the card.

**Edit and soft delete (FEED-03)**
- What "editado" covers — any change, or only the text — whether media can be swapped after publishing, whether an edit window exists, and whether the marker shows a timestamp.
- What a soft-deleted post leaves behind: its comments, its share link (404 versus a "post removido" screen — note D-56 already commits the cross-tenant case to 404, so the two screens must be distinguishable in code but need not be to the user), and its media assets relative to the Phase 3 sweeper.

**Schema and conventions**
- Numeric limits: how many images per post, maximum caption length, how many attachments, and maximum video duration — anchored to the per-kind limits `MEDIA_LIMITS` already enforces from Phase 3, and cheap to tighten in Phase 8 hardening. Phase 5 will need a story-length rule on the same mechanism.
- Domain event names and payload shapes (`post.published`, `post.liked`, `comment.created`, ...) declared through the `EventMap` declaration-merging extension point in `packages/contracts/src/events.ts`, plus the test subscriber criterion 4 requires. Phase 7 builds the notification center on exactly these, so favour payloads that carry what a notification row needs without a re-read.
- The FEED-08 per-tenant **posting policy** shape: a column on `tenants`, a setting on the `tenant_modules` row, or a permission row. Whatever is chosen, V2 member posting must be a value change, not a migration — and the guard must sit in one place both the API and the composer's visibility read.
- Whether `feed.likes` uses nullable FKs plus partial unique indexes for the post/comment/story targets (the roadmap's note) or separate tables, and where the `story_id` slot on `feed.comments` sits so Phase 5 reuses the tables without a rewrite. Counters are trigger-maintained (roadmap-locked).
- Keyset ordering expression for the feed itself and its matching index, the page size, and how the bounded-query-count check is expressed in CI (the roadmap names `EXPLAIN`, a query count and the depth trigger as the acceptance checks).
- Idempotency of the like toggle under double-tap and under a retried request, and whether "quem curtiu" lists exist at all in V1 (they are not in the requirements).

**UI and module layout**
- Empty states and skeletons for the feed, the comment list and the composer; what `/inicio` shows a member of a brand-new tenant with no posts; whether the D-02 profile nudge stays above the feed once the feed has content.
- Desktop composition under D-39 (left rail + centred column): the feed column width, where the FAB goes on desktop, and whether the composer is a full page there too.
- Share implementation: `navigator.share` with a copy-link fallback, the exact link shape, and the pt-BR copy of the toast.
- `@rede-social/module-feed` package layout against the `@rede-social/module-example` template, and the removal of `@rede-social/module-example` (D-19) — including the seventh registry key, its seed rows, and any boundary-lint fixture that depends on it.
- Test strategy: extending the two-tenant pgTAP + API isolation suite with posts, comments and likes; the reply-depth constraint's negative test; the cross-tenant deep-link 404; and Playwright coverage on a mobile viewport for double-tap like, the comment sheet, infinite scroll and pull-to-refresh.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 4: Feed" — goal, the four success criteria, the notes on `feed.comments` reserving a `story_id` slot, `feed.likes` nullable FKs + partial unique indexes, trigger-maintained counters, and the statement that the admin composer is the first prototype-less screen under the Phase 2 UI-SPEC pattern
- `.planning/ROADMAP.md` §Overview "Cross-cutting rules carried by every phase" — the two-tenant isolation suite as the exit gate, the schema conventions doc, the module package + registry rules, the design-language rule, the pt-BR catalog rule, and the Supabase Free-plan constraint
- `.planning/REQUIREMENTS.md` — FEED-01..FEED-08, MEDIA-04, MOD-03, UI-02 (exact wording); UI-04 for the prototype-less review gate; V2-CONT-01 (member posting is a policy flip on FEED-08) and V2-CONT-03 (pinned community posts) for what the schema must not preclude
- `.planning/PROJECT.md` §Constraints, §Key Decisions, §Out of Scope — one admin publishes all V1 content, plain "like" only, share = internal deep link requiring login, comments allow one reply level on posts, frontend never hits Supabase for data, V2-safe schema

### Prior decisions this phase builds on
- `.planning/phases/01-foundation-kernel-tenancy-auth-ci-cd/01-CONTEXT.md` — D-09 (stable machine error codes in the envelope), D-16/D-17 (`feed` is a toggleable module, on by default), D-18 (`@rede-social/*` layout; worker is the same image with `ROLE=worker`), **D-19** (`@rede-social/module-example` is removed in *this* phase when feed replaces it)
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-CONTEXT.md` — **D-33** (UI-SPEC + static mockup approved with the design team before prototype-less screens are coded — the composer and the edit screen), **D-40** (nav tabs and TopBar slots; amended by D-55 here), **D-42** (`/inicio` is a kernel page with module home slots; it already said the `/feed` question is the Phase 4 planner's call), D-39 (desktop rail + centred column, `--safe-*` scroll contract), D-41 (light/dark tokens)
- `.planning/phases/03-media-pipeline-member-profiles/03-CONTEXT.md` — D-43/D-44 (Mux with a **signed** playback policy; short-lived per-request playback JWT), D-45 (no role badge on profiles — authorship in D-52 is a different thing), **D-47** (staff are hidden from the directory but their profile opens by direct link, which is what D-52 relies on)
- `.planning/STATE.md` §Accumulated Context → Decisions — especially `03-01` (media object keys are a pure function of tenant/asset/variant; `GET /v1/media/{id}/{variant}` does zero DB reads), `03-03` (**the keyset convention this phase inherits**: opaque base64url `{v,n,id}`, ordered by the expression the index carries, over-fetch `limit+1`, clamp `limit` server-side), `03-04` (the Next BFF route handler at `app/v1/media/[assetId]` — an `<img>` cannot carry the HttpOnly session; image failure read on mount as well as `onError`), `03-06`/`03-07` (the `VideoProvider` seam, `<mux-player>` `tokens` is a property-only path, provider-owned uploads skip `complete`), `03-08` (the media sweeper's re-arm pattern; every isolation case asserts its positive control)

### Architecture, schema and pitfalls
- `packages/core/docs/SCHEMA-CONVENTIONS.md` — `tenant_id` first in every index, RLS on every table, admin-lane-only writes, soft-delete columns, generic `author_user_id`, nullable-FK targets
- `.planning/research/PITFALLS.md` §Pitfall 1 (service role kills RLS), §Pitfall 9 (V2-safe schema conventions) — and the N+1 / query-budget concern criterion 4 turns into a CI check
- `.planning/research/STACK.md` §Stack Pattern 2 (Hono module layout, per-request tenant lane), §Stack Pattern 3 (migrations via drizzle-kit → Supabase CLI, `api_user` role), §Stack Pattern 4 (link previews via `open-graph-scraper` with an SSRF guard, oEmbed for YouTube/Vimeo, attachments through signed download URLs)
- `.planning/research/ARCHITECTURE.md` §Pattern 1 (two lanes) and §Recommended Project Structure
- `.claude/CLAUDE.md` §Technology Stack (`open-graph-scraper` 6.12.0, `@tanstack/react-query` 5.102.8, `pg-boss` 12.31.0) and §"What NOT to Use" — no `@supabase/supabase-js` in the browser for data, no uploads through Cloud Run

### Code the phase extends
- `packages/core/server/paging.ts` — the ONE keyset cursor encoder; its own docblock names this phase as the inheritor. Do not write a second envelope.
- `packages/contracts/src/events.ts` — the `EventMap` declaration-merging extension point the feed's domain events plug into; `packages/core/server/events/bus.ts` is the after-commit dispatch
- `packages/modules/example/` — the module template (`module.ts`, `contracts/`, `db/schema.ts`, `server/{routes,service,jobs}.ts`, `ui/`) that `@rede-social/module-feed` copies, and the package this phase deletes (D-19)
- `packages/core/server/modules/manifest.ts` — `ModuleNav` (`placement`) and `ModuleHomeSlot` (`order`); D-55 uses the `home` array, not `nav`

### Design (the design team's prototype is the visual source of truth)
- `reference/frontend-design/components/feed/` — `PostCard.tsx`, `PostHeader.tsx` (the "…" menu is where FEED-03 edit/delete and FEED-07 "Copiar link" plug in), `PostImage.tsx` (carousel + `DoubleTapHeart`, extended to a `PostMedia` handling video/embeds/attachments), `PostActions.tsx`, `LikeButton.tsx`, `PostCaption.tsx` ("… mais" truncation), `InfiniteScroll.tsx`
- `reference/frontend-design/components/comments/` — `CommentSheet.tsx`, `CommentsList.tsx`, `CommentItem.tsx` (recursion capped at one level; drop the `lib/mock/users` gender read), `CommentInput.tsx`
- `reference/frontend-design/components/create/` — `CaptionInput.tsx` and `ImagePicker.tsx` are stubs, not a composer; `LocationPicker.tsx` and `TagPeople.tsx` are not V1
- `.planning/research/PROTOTYPE.md` §4 rows `/feed` and `/post/[postId]`, §5 `components/feed/` + `components/comments/` port notes, §9 port plan and risk 2 (the `--safe-*` scroll contract), §10 **open question 2** (answered here by D-51) and open question 3 (the admin composer designs D-57 needs), §11 "do not port" list
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-UI-SPEC.md` + `.planning/sketches/MANIFEST.md` — the D-33 design language and review pattern the composer follows

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/server/paging.ts` — `encodeCursor` / `decodeCursor` and the total-function posture (a tampered or stale cursor degrades to "first page", never a 500). The feed, the comment list and the reply list all ride it. Its docblock already states the convention Phase 4 inherits.
- `packages/core/server/events/bus.ts` + `packages/contracts/src/events.ts` — the domain event bus with after-commit dispatch on `RequestContext.events`; `EventMap` is empty on purpose so `DomainEventName` is `never` until a module declares its payloads. `@rede-social/module-feed` is the first real declarer (MOD-03, criterion 4).
- `packages/modules/example/` — the full module shape to copy: `module.ts` manifest, `contracts/index.ts` (declaration merging), `db/schema.ts` (tenant_id + RLS), `server/routes.ts` behind `requireModule`, `server/jobs.ts`, `ui/`.
- `packages/core/server/modules/manifest.ts` — `ModuleNav` with `placement` (`tab` | TopBar slot) and `ModuleHomeSlot` with `order`; `apps/web/app/(app)/inicio/page.tsx` already renders `HomeSlots` from `homeSlotsFor()`, so D-55's widget has a socket waiting for it.
- `apps/web/app/v1/media/[assetId]/` + `GET /v1/media/{id}/{variant}` — the media delivery path every post image and every avatar in the feed goes through; the API URL is stable and permanently cacheable, the 302 to a freshly signed URL carries the tenant check. No new image-URL mechanism is needed.
- `packages/core/server/media` (`VideoProvider` seam, `mux.ts`, `video/wire.ts`) and the Mux player wiring from 03-07 — post video reuses the broker end to end, including the `processando` state and the property-only `tokens` path on `<mux-player>`.
- `apps/web/components/platform/LogoUpload.tsx` → `useSignedUpload` (request signed URL → `PUT`/TUS → `complete`, with the provider-owned branch that skips `complete` for Mux) and `FileDropZone` — the composer's upload layer, already generalised in Phase 3.
- `packages/core/server/tenancy` → `membershipOfRecord` — the one where-clause for the caller's membership; every feed read, like and comment write scopes through it.
- `packages/core/server/jobs/boss.ts` (`enqueueInTx`, `registerJobQueues`) — the pg-boss pattern any unfurl job follows, with the kernel-before-module registration order.
- `apps/web/lib/profile.ts` `getMembers` / `loadMoreMembersAction` — the existing "one fetch implementation shared by the page and the load-more action" pattern (03-05); the feed's infinite scroll should not grow a second fetch path.
- `apps/web/e2e/*` + `playwright.config.ts` — two-tenant fixtures (`rede-demo.localhost`, `rede-lab.localhost`), mobile (iPhone 14) + desktop projects, per-run hosts for throwaway tenants, and `serviceWorkers: 'block'` where GET interception is needed.

### Established Patterns
- **Three-layer tenant scoping**: JWT/membership check → explicit `tenant_id` predicate → RLS under `authenticated` inside a per-request transaction. Cross-tenant reads live only in `packages/core/server/platform/*` behind `withAdminTx`, confined by Biome.
- **Every API refusal is a stable machine code** in the envelope (D-09), mapped to a redirect or a toast on the web. The cross-tenant post 404 and any "post removido" answer follow it.
- **Nothing heavy runs in the request path** (02-13): the request validates and enqueues; unfurling, resizing and provider round trips happen in the worker.
- **Migrations**: Drizzle schema → `drizzle-kit generate` → `supabase/migrations` → Supabase CLI applies. `tenant_id` first in indexes; every new table gets RLS plus a policy, and `supabase/tests/010` asserts it.
- **Isolation tests assert their positive control in the same test** (03-08) so a globally broken route cannot make a negative pass vacuously.
- **pt-BR catalog only** — no string literals in UI, enforced by `scripts/check-ui-literals.sh` after `turbo lint`.
- `pnpm verify` is the local exit gate and `ci.yml` mirrors it step for step (Phase 3 baseline: ~20m, unit 385 / pgTAP 128 / integration 313 / e2e 271).

### Integration Points
- `packages/modules/feed/` (new) → `db/schema.ts` with `posts`, `comments`, `likes` (+ the reserved `story_id` / `community_id` slots), `server/routes.ts` behind `requireModule('feed')`, `contracts/index.ts` declaring the `EventMap` entries, `ui/` with the ported `PostCard` family and the home-slot widget.
- `packages/core/db/schema/index.ts`, `supabase/migrations/*`, `supabase/tests/*` → new tables, the one-level reply constraint, counter triggers, RLS policies and the extended two-tenant isolation plan.
- `apps/api/src/routes/` → the feed module mounted under the tenant lane; `apps/api/src/worker.ts` → any unfurl job registered after the kernel queues.
- `apps/web/app/(app)/inicio/page.tsx` → the feed home slot lands next to `ProfileNudgeCard` and `HomeSlots`; new routes `app/(app)/post/[postId]/`, `app/(app)/criar/`, `app/(app)/post/[postId]/editar/`.
- `apps/web/messages/pt-BR/` → a `feed` namespace in the catalog.
- `packages/modules/example/` → deleted (D-19), together with its registry key, its seed rows and any boundary-lint fixture that points at it (`packages/boundary-fixture`).
- `scripts/seed.ts` → seeded posts with each media shape (gallery, video, link, attachment) plus comments, replies and likes, so the feed, the isolation suite and the query-budget check have something to assert against.

</code_context>

<specifics>
## Specific Ideas

- The post is attributed to the **person** who published it, not to the organisation — the admin's photo and name in the card header, linking to their profile. The community's identity is already everywhere else in the shell.
- One post model, no titles, no category chips: the design team's `CommunityTopic` concept does not survive. This is the V1 answer to PROTOTYPE.md open question 2 and should go back to the design team with the open question 3 composer request.
- A post shows either photos or a video, never both — the carousel stays a carousel.
- Comments open as a sheet over the feed and read inline on the post page: the two surfaces the prototype already drew.
- Threads are collapsed ("Ver N respostas") and a member can delete what they wrote.
- Newest comment on top, but inside a thread the conversation runs forward in time.

</specifics>

<deferred>
## Deferred Ideas

- **Member mentions (@) in post text and comments** — rejected for V1 by D-54; would need a member picker in the composer, a storage format for the mention span, and a notification type (Phase 7). Revisit in V2 alongside member posting.
- **Rich text / markdown in posts** — rejected by D-54. If long-form announcements become a pilot need, it arrives as a format discriminator, not as a rewrite of existing rows.
- **Post type chips and filtering by type** — rejected by D-51; the per-tenant vocabulary is the expensive part.
- **Editing a comment after posting** — rejected by D-61; delete-and-repost is the V1 answer.
- **Sorting comments by likes ("mais relevantes")** — rejected by D-62 because the ordering is unstable under keyset pagination; it would need a snapshot-based cursor.
- **"Quem curtiu" lists** — not in the requirements; plain counts only (PROJECT.md "plain like only").
- **Bookmark/save on posts** — the prototype's `PostActions` accepts `onSave` and `useBookmark` exists, but there is no requirement and no button; do not port.
- **Mixing video into an image carousel** — deferred by D-53; revisit only if the pilot admin actually asks.
- **Feed as its own tab / `/feed` route** — deferred by D-55; if Phase 5 or 6 finds the home slot crowded, the nav decision is re-opened there, not here.
- **Pinned posts in a community (V2-CONT-03)** and community-scoped feeds — Phase 5; this phase only reserves `community_id`.
- **Scheduled publishing and drafts** — not in the V1 requirements; the composer publishes immediately.

</deferred>

---

*Phase: 04-feed*
*Context gathered: 2026-09-22*
