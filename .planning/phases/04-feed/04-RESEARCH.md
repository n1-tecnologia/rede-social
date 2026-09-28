# Phase 4: Feed - Research

**Researched:** 2026-09-22
**Domain:** Tenant-scoped social feed (posts, media composition, likes, one-level comments, keyset paging, domain events, share deep links) on the existing Hono + Drizzle + Next 16 kernel
**Confidence:** HIGH for in-repo patterns and the SSRF/unfurl mechanics (falsified in this session); MEDIUM for the composer UX shape (prototype-less, D-33 gate); LOW for nothing that blocks planning

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

> Decision numbering continues from Phase 3 (D-01..D-24 in `01-CONTEXT.md`, D-25..D-42 in `02-CONTEXT.md`, D-43..D-50 reserved by `03-CONTEXT.md`, of which D-43..D-47 are used) because code comments already cite those ids; this phase owns **D-51..D-65**.

**Post anatomy**

- **D-51:** A post has **no title and no type chip**. There is one post model — author, caption text, media, optional `community_id` — and one `PostCard` renders it in the feed, on the post page and (Phase 5) inside a community. This **answers PROTOTYPE.md open question 2 with "drop titles and type chips"**: the prototype's second model (`CommunityTopic` with `title` + Discussão/Trend/Exclusivo/Vídeo chip) is not ported, and the design team should be told so. — **Reversibility:** reversible — a nullable `title` column plus one branch in the card and the composer is additive. The type chip is the expensive half (a per-tenant vocabulary and a brand-derived chip color), which is why it is rejected now rather than deferred into the schema.
- **D-52:** The post is attributed to **the person**, not to the brand: `PostHeader` shows the publishing admin's profile photo and display name, linking to their profile (`PROF-02`). The generic `author_user_id` column (FEED-08) is what is displayed, so V2 member posting changes nothing visually. This does **not** conflict with D-45, which banned a *role badge* on profiles, not authorship. Consequence to plan for: staff profiles become reachable from feed content — D-47 already allows exactly that (staff are hidden from the member directory but their profile opens by direct link). — **Reversibility:** reversible — switching to a brand byline is a change in one header component; the column already holds the right value either way.
- **D-53:** A post carries **either an image gallery or one video — never both** — plus optionally one link preview/embed and file attachments. This keeps the prototype's `PostImage` (snap carousel with dots, wrapped in `DoubleTapHeart`) essentially intact and avoids a `<mux-player>` sitting inside a swipe carousel, with per-slide autoplay and pause rules. It still satisfies FEED-01's "any combination" in the sense that matters: an announcement can carry photos *and* a PDF *and* a link. — **Reversibility:** costly — the rule lives as a DB check constraint, a composer rule and a `PostMedia` renderer branch; relaxing it later needs no data migration but changes every one of those consumers plus the carousel's playback model.
- **D-54:** Post text is **plain text with clickable links**: newlines preserved, URLs auto-linked **at render time** (never stored as HTML), no bold/italic, no markdown, no mentions. Keeps the prototype's `PostCaption` "... mais" truncation and removes the rich-text sanitisation surface entirely. — **Reversibility:** reversible — storage stays plain text, so a future rich-text format arrives as a new column plus a format discriminator rather than a migration of existing rows.

**Feed placement and entry points**

- **D-55:** The feed is a **home slot on `/inicio`**, not a new navigation tab: `@rede-social/module-feed` registers a widget through the D-42 home-slot mechanism, and the post list is the main content of the home, below the branded greeting and the D-02 profile nudge. When a tenant has `feed` disabled, `/inicio` still renders the remaining widgets. **Amends D-40**, which had pencilled `feed` → an "Início" tab: the feed contributes a home slot, and the BottomNav/rail keeps its budget for Comunidades (Phase 5), Eventos (Phase 6) and the kernel's Perfil. — **Reversibility:** costly — Phases 5 and 6 plan their nav entries against this tab budget, and the registry manifest's `nav` vs `home` distinction is what they copy.
- **D-56:** The post detail lives at a **dedicated `/post/[id]` route** on the tenant's own domain (the prototype's `app/(app)/post/[postId]` shape): the full `PostCard` plus the comment list inline, under a sticky back header, server-rendered. It is the **FEED-07 share target** — the logged-out visitor is routed through login and lands here — and it is the destination Phase 7's notifications will point at. Cross-tenant access answers 404 (roadmap-locked). — **Reversibility:** costly — once the pilot tenant's members start sharing links, the URL shape is effectively permanent; this is the D-01 lesson applied to content URLs.
- **D-57:** The admin reaches the composer through an **`admin_tenant`-only floating action button over the feed on `/inicio`, navigating to a full-screen `/criar` route**; the edit flow (FEED-03) reuses the same form at `/post/[id]/editar`. Full screen rather than a bottom sheet because picking several images, waiting on an upload, seeing a link preview resolve and attaching a PDF do not fit a sheet with the mobile keyboard up — and because a long video upload must not live in a layer the admin can dismiss by accident. Both screens are prototype-less and go through the **D-33 UI-SPEC + mockup approval before being coded**.
- **D-58:** The feed loads with **infinite scroll plus pull-to-refresh**, exactly as roadmap criterion 2 states and as the prototype already implements (`feed/InfiniteScroll.tsx` + `hooks/useInfiniteScroll.ts`, whose IntersectionObserver root is hardcoded to `#app-scroll` and becomes a prop during the port). Paging rides the keyset cursor convention in `packages/core/server/paging.ts` — the sentinel fetches the next page, pull-to-refresh re-reads the first one.

**Comments and replies**

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

### Deferred Ideas (OUT OF SCOPE)

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
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (REQUIREMENTS.md, verbatim) | Research Support |
|----|-------------|------------------|
| FEED-01 | "`admin_tenant` can create a post with text and any combination of: multiple images (carousel with swipe on mobile), one video, link previews / YouTube-Vimeo embeds (unfurled server-side at create time), and file attachments (PDF and similar)" | §Media composition (reuses the Phase 3 broker end-to-end, zero new upload code); §Unfurl pipeline; D-53 narrows "any combination" to gallery XOR video |
| FEED-02 | "A post may optionally be scoped to a community; the main feed shows posts without community plus posts from communities the member can see, newest first, with cursor pagination" | §Keyset paging (verified DESC row-value idiom + index shape); `community_id` nullable FK born here, predicate `community_id is null` in V1 |
| FEED-03 | "`admin_tenant` can edit (marked \"editado\") and soft-delete their own posts" | §Soft delete & edit recommendation; `deleted_at` + `edited_at` per SCHEMA-CONVENTIONS (d).2 |
| FEED-04 | "Member can like/unlike a post (idempotent toggle) and see the like count" | §Idempotent like toggle (`on conflict do nothing` + `delete returning`); §Trigger-maintained counters |
| FEED-05 | "Member can comment on a post and reply to a comment; replies are limited to one level (enforced by a DB constraint)" | §Pattern 4 — **declarative** one-level constraint (composite self-FK), verified against this project's Postgres this session |
| FEED-06 | "Member can like/unlike comments and replies" | §Likes table shape (nullable FK targets + partial unique indexes) |
| FEED-07 | "Member can share a post via the native share sheet (or copy link on desktop) using an internal deep link; opening the link requires login and lands on the post if it belongs to the user's tenant (otherwise 404)" | §Share & deep link; the existing `(app)` layout + `requireBootstrap()` redirect path already does "log in then land"; RLS makes the cross-tenant case a bare 404 with no oracle |
| FEED-08 | "Posts, communities and stories carry a generic `author_id` and per-tenant posting policy so V2 member posting is a permission change, not a schema change" | §Posting policy — `tenant_modules.settings` is the documented home; `permissionsFor()` is the one place that composes it |
| MEDIA-04 | "Link unfurling runs server-side with an SSRF guard and caches title/description/image on the post" | §Unfurl pipeline + §SSRF guard (verified: connector-level pinning, IP-literal bypass, `maxResponseSize`) |
| MOD-03 | "Modules communicate through domain events (e.g. `post.liked`, `event.rsvp`) consumed by other modules … so a module can be removed or replaced without touching the others" | §Domain events — `EventMap` declaration merging + `emit` after commit; `@rede-social/module-feed` is the first real declarer |
| UI-02 | "Feature screens are ported into their module package as each vertical phase is built, replacing mock data with API calls and keeping the prototype's interactions (double-tap like, comment sheet, infinite scroll, pull-to-refresh, swipe)" | §Prototype port map — which primitives already exist in `@rede-social/ui` and which are still missing |
</phase_requirements>

---

## Summary

Phase 4 is almost entirely a **composition** phase, not a discovery phase. Every hard mechanism it needs already exists in the tree and is documented in its own source: the keyset cursor envelope (`packages/core/server/paging.ts`), the after-commit domain-event bus (`packages/core/server/events/bus.ts`), the module package contract (`packages/modules/example/*`, which is also the package this phase deletes under D-19), the three-layer tenant scoping (`withTenantTx` + `tenantIsolationPolicy` + `membershipOfRecord`), the media broker with signed direct-to-Storage uploads and the Mux video seam, the `/v1/media/{assetId}/{variant}` delivery path the web BFF already proxies, and the `@rede-social/ui` primitives (`BottomSheet`, `PullToRefresh`, `ScrollContainerContext`, `Avatar`, `EmptyState`, `Skeleton`, `Toast`). The correct posture for the planner is *copy the established pattern, do not invent a second one* — the repo's own docblocks say so in several places ("Do not write a second envelope").

Three areas genuinely need research output rather than imitation, and all three are resolved below with verified evidence:

1. **The one-level reply constraint.** FEED-05 says "enforced by a DB constraint", and the obvious implementation is a `before insert` trigger. A purely **declarative** solution exists and was verified against this project's local Postgres this session: a `depth smallint` column, a redundant `parent_depth` column, a `unique (id, depth)` and a composite self-referencing foreign key `(parent_id, parent_depth) -> (id, depth)`. A reply-to-a-reply fails with a foreign-key violation and a lie about `parent_depth` fails on a CHECK — no trigger, no race, no `security definer` function.

2. **The SSRF-safe unfurl.** `open-graph-scraper@6.12.0` calls `undici.fetch` directly and spreads the caller's `fetchOptions` into it, so an `undici.Agent` with a custom **connector** is honoured — and each redirect hop re-enters that connector. Verified in this session: a `lookup`-only guard is **silently bypassed by an IP-literal host** (`http://127.0.0.1:…` never calls `lookup` at all), so the guard must be a connector function that checks `net.isIP(opts.hostname)` against a `net.BlockList` *and* delegates to `buildConnector({ lookup })` for DNS names. `Agent({ maxResponseSize })` is the body cap and does fire through `fetch`.

3. **The CI query budget.** `pg_stat_statements` 1.11 is already installed and preloaded in the local Supabase Postgres, with normalised statement text — so "a feed page executes ≤ N statements against the feed tables" is expressible as a `sum(calls)` delta filtered by query text, with no production code change and no new dependency.

**Primary recommendation:** build `@rede-social/module-feed` as a byte-for-byte structural copy of `@rede-social/module-example` (manifest → contracts → db/schema → server/{routes,service,jobs} → ui), with **one** hydrated feed query per page (post + author + counts + `viewer_liked` in a single statement), likes as one `feed_likes` table with nullable target FKs and partial unique indexes, comments as one `feed_comments` table with the declarative depth constraint and a reserved `story_id` slot, the unfurl as a **worker job** behind a connector-pinned undici Agent, and the posting policy as `tenant_modules.settings.postingPolicy` composed into `permissionsFor()` so the API guard and the composer's visibility read the same value.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Feed list, post detail, comment/reply lists | API / Backend (Hono tenant lane) | Database (RLS) | Tenant authority is the membership of record; RLS is layer 3. The web never queries Supabase for data (CLAUDE.md "What NOT to Use"). |
| Post create / edit / soft-delete | API / Backend | Frontend Server (Next server action → `apiFetch`) | Role + posting-policy guard lives in the route; the web only renders the affordance. |
| Like toggle (incl. double-tap) | API / Backend | Browser (optimistic UI) | Idempotency is a DB uniqueness property; the browser may render optimistically but is never the arbiter. |
| Like/comment counters | Database (triggers) | — | Roadmap-locked: "Counters are trigger-maintained." A same-transaction trigger cannot drift. |
| One-level reply enforcement | Database (constraint) | API (400 mapping) | FEED-05 says "enforced by a DB constraint"; the API translates SQLSTATE 23503/23514 into `VALIDATION_FAILED`. |
| Link unfurl + SSRF guard | API worker (`ROLE=worker`, pg-boss) | API (enqueue only) | Established rule 02-13: "Nothing heavy runs in the request path." An outbound fetch to an attacker-named host is the textbook case. |
| Image bytes / video playback | CDN / Storage + Mux | API (signing, tenant check), Frontend Server (BFF proxy for `<img>`) | 03-01/03-04/03-07 already own this end to end; Phase 4 adds **zero** new media plumbing. |
| Post media rendering (carousel, HLS, attachment, embed) | Browser (client components) | — | Pure presentation; the module's `ui/` stays dumb and prop-driven (the `ExampleWidget` posture). |
| Infinite scroll sentinel / pull-to-refresh | Browser | Frontend Server (server action for the next page) | `PullToRefresh` + `ScrollContainerContext` already exist in `@rede-social/ui`; `InfiniteScroll` does not yet. |
| Share sheet / copy link | Browser (`navigator.share`) | Frontend Server (route `/post/[id]`) | Web Share API is browser-only; the link shape is a routing decision (D-56). |
| Domain event fan-out | API / Backend (in-process bus, after commit) | Worker (Phase 7 consumers) | `flushEventsAfterHandler` already runs after the handler's transaction. |
| Posting policy (FEED-08) | Database (`tenant_modules.settings`) | API (`permissionsFor`), Frontend (`bootstrap.permissions`) | One value, one composition point, two readers. |

---

## Project Constraints (from CLAUDE.md)

Actionable directives the plan must honour. These have the same authority as CONTEXT.md's locked decisions.

| Directive | Source | Consequence for Phase 4 |
|---|---|---|
| All business logic goes through the Node/TS API; the frontend talks to Supabase **only** for auth session and read-only Realtime | §Project Constraints | Feed/comments/likes are `apiFetch` calls; no `@supabase/supabase-js` in the browser |
| `@supabase/supabase-js` in the browser for data/storage is forbidden | §What NOT to Use | Post images go through `/v1/media/{assetId}/{variant}` (the existing BFF handler), never a signed Storage URL in a payload |
| Uploading files **through** Cloud Run is forbidden (32 MiB body cap) | §What NOT to Use | Composer uses `useSignedUpload` (signed PUT / TUS / Mux direct), unchanged from Phase 3 |
| `service_role` key / `postgres` role for tenant queries is forbidden | §What NOT to Use | Every feed read/write uses `withTenantTx`; `withAdminTx` is Biome-confined to `server/{tenancy,platform,media}` and is **not** available to `packages/modules/**` |
| Running `drizzle-kit migrate` **and** `supabase db push` is forbidden | §What NOT to Use | `pnpm db:generate` → review SQL → Supabase CLI applies |
| `prepare: true` on the transaction pooler is forbidden | §What NOT to Use | Already set: `postgres(env.DATABASE_URL, { prepare: false, max: 5 })` |
| Rich text/embeds rendered raw = stored XSS; render embeds via known providers only | §Security Mistakes (PITFALLS) | D-54 already bans rich text; embeds restricted to YouTube/Vimeo via oEmbed |
| Link-preview fetcher with no SSRF protection lets the API probe GCP metadata | §Security Mistakes (PITFALLS) | The connector-pinned Agent below is mandatory, not optional |
| pt-BR UI, all strings centralised | §Project Constraints, PWA-03 | New `apps/web/messages/pt-BR/feed.json` namespace; `scripts/check-ui-literals.sh` fails the build on a literal |
| Each feature is a self-contained package depending only on the kernel and other modules' **published contracts** | MOD-01/MOD-02 | `@rede-social/module-feed` may import `@rede-social/core/server/*`, `@rede-social/core/db/tenant-tx`, `@rede-social/contracts` — and nothing from another module's internals |
| `open-graph-scraper` 6.12.0, `pg-boss` 12.31.0, `@tanstack/react-query` 5.102.8 are the named stack entries | §Technology Stack | See §Standard Stack for what is actually needed (React Query is **not**, see the note) |

---

## Standard Stack

### Core — already installed, nothing to add

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hono` + `@hono/zod-openapi` | 4.13.7 / 1.6.3 | Feed module routes with the `requireAuth → requireModule → requireRole` chain | `[VERIFIED: apps/api/package.json]` — `"hono": "4.13.7"`, `"@hono/zod-openapi": "1.6.3"`. The `@rede-social/module-example` route file is the exact template. |
| `drizzle-orm` | 0.45.2 | Schema + RLS policies + queries | `[VERIFIED: apps/api/package.json]` — `"drizzle-orm": "0.45.2"`. `foreignKey` is exported from `drizzle-orm/pg-core` `[VERIFIED: node_modules/drizzle-orm/pg-core/foreign-keys.d.ts:39]` — `export declare function foreignKey<…>` — which is what the composite self-FK in Pattern 4 needs. |
| `drizzle-kit` | 0.31.10 | `pnpm db:generate` → `supabase/migrations` | `[VERIFIED: apps/api/package.json]` |
| `zod` | 4.6.2 | Contracts shared by API + web | `[VERIFIED: apps/api/package.json]` |
| `pg-boss` | 12.31.0 | The unfurl job queue | `[VERIFIED: apps/api/package.json]` — `"pg-boss": "12.31.0"` |
| `postgres` (postgres.js) | 3.4.9 | Driver, `prepare: false`, `max: 5` | `[VERIFIED: packages/core/db/client.ts]` — `export const sqlClient = postgres(env.DATABASE_URL, { prepare: false, max: 5 });` |
| `@rede-social/ui` primitives | workspace | `BottomSheet`, `PullToRefresh`, `Avatar`, `EmptyState`, `Skeleton`, `Toast`, `Textarea`, `FileDropZone`, `ConfirmDialog`, `Card`, `IconButton`, `PageHeader` | `[VERIFIED: packages/ui/src/index.ts]` — all of these appear in the barrel's export list |
| `lucide-react` | 1.46.0 | Heart / MessageCircle / Send / MoreHorizontal icons | `[VERIFIED: packages/core/package.json]` — `"lucide-react": "1.46.0"` |
| `motion` | (installed in `@rede-social/ui`) | Like pulse + double-tap heart spring | `[VERIFIED: packages/ui/node_modules/motion exists]`. The prototype uses `framer-motion`; the repo standardised on `motion` — port the animation, not the import. |

### Supporting — one new dependency, at most

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `open-graph-scraper` | 6.12.0 | OG/Twitter-card metadata extraction in the worker | `[VERIFIED: npm registry]` version 6.12.0, modified 2026-06-26, 225,094 weekly downloads, repo `github.com/jshemas/openGraphScraper`, no postinstall — and it is the package **named in CLAUDE.md §Technology Stack**, so it is an authoritative-source recommendation, not a search result. Pulls `cheerio`, `undici@^7`, `chardet`, `iconv-lite`. `engines: { node: '>=20.0.0' }`. |
| `undici` | (transitive, ^7) | The `Agent` + `buildConnector` used to pin the SSRF guard | Comes in with `open-graph-scraper`. It **must** be imported from the same `undici` instance OGS uses, so declare it as a direct dependency of the module package to avoid a duplicated copy in the pnpm store. |

### Deliberately NOT added

| Candidate | Why not |
|---|---|
| `@tanstack/react-query` (5.102.8, in CLAUDE.md's table) | The repo has never installed it. Phase 3 established the "one fetch implementation shared by the page and the load-more server action" pattern (`apps/web/lib/profile.ts` `getMembers` / `loadMoreMembersAction`) and D-42's home slots are server components. Introducing a client cache here is a second data-fetching paradigm for the first feature that needs infinite scroll — and the server-action pattern already handles it. **Recommend: defer React Query to Phase 7** (chat/notifications, where Realtime invalidation genuinely wants a cache). `[ASSUMED]` that the user is content with this — it is a discretion item under "UI and module layout" but it contradicts a CLAUDE.md table entry, so flag it in the plan rather than deciding silently. |
| `tus-js-client`, `@mux/upchunk`, `@mux/mux-player-react` | Already installed and wired (03-04, 03-07). The composer calls `useSignedUpload`; nothing new. |
| An SSRF library (`ssrf-req-filter`, `request-filtering-agent`) | `net.BlockList` (Node built-in) does the range math and `undici.buildConnector` does the pinning. Both verified below. The repo precedent is exactly this: 03-01 dropped `file-type` for a 5-byte magic check. |
| A markdown/sanitiser library | D-54 bans rich text; auto-linking plain text at render time is a regex + `<a>` in JSX, never `dangerouslySetInnerHTML`. |
| `lite-youtube-embed` | Only relevant if the embed is an iframe; see §Pattern 6 for the recommended thumbnail-first alternative. |

**Installation (the only package to add):**

```bash
pnpm --filter @rede-social/module-feed add open-graph-scraper@6.12.0 undici@7
```

**Version verification performed this session:**

```
$ npm view open-graph-scraper version time.modified dependencies engines
version = '6.12.0'
time.modified = '2026-06-26T01:11:04.003Z'
dependencies = { chardet: '^2.2.0', cheerio: '^1.2.0', 'iconv-lite': '^0.7.2', undici: '^7.28.0' }
engines = { node: '>=20.0.0' }
```

Node in this environment is `v24.14.0`; the repo pins `"engines": { "node": ">=24" }` `[VERIFIED: package.json]`. Compatible.

---

## Package Legitimacy Audit

Run this session via `gsd-tools query package-legitimacy check --ecosystem npm open-graph-scraper undici`.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `open-graph-scraper` | npm | published 2026-06-26 (6.12.0) | 225,094/wk | `github.com/jshemas/openGraphScraper` | **OK** | Approved — and named in CLAUDE.md §Technology Stack |
| `undici` | npm | latest published 2026-09-22 | 132,355,733/wk | `github.com/nodejs/undici` | **SUS** (`too-new`) | **Approved with note.** The `too-new` signal fires on the *latest* version's publish date (today); undici is the Node.js project's own HTTP client with 132M weekly downloads. **Pin `undici@7.29.1`** (the version resolved and exercised in this session's probes) rather than `^7`, so the install is not a same-day release. |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `undici` — the flag is a release-cadence artefact, not a supply-chain signal. Per the repo's precedent (02-02 and 03-06 each took one blocking human approval per phase), the plan should carry **one** `checkpoint:human-verify` covering both packages before the first install, with the text above as the evidence.

`npm view open-graph-scraper scripts.postinstall` → the legitimacy seam reports `"postinstall": null` for both packages. No install-time script.

---

## Architecture Patterns

### System Architecture Diagram

```
                       ┌──────────────────────────── BROWSER ────────────────────────────┐
  member taps ────────▶│ PostCard (client)  DoubleTapHeart ─▶ optimistic like            │
  admin taps FAB ─────▶│ /criar composer    useSignedUpload ─┐                           │
                       │ InfiniteScroll sentinel ─┐          │  bytes NEVER via API      │
                       │ PullToRefresh ───────────┤          │                           │
                       └──────────────────────────┼──────────┼───────────────────────────┘
                                                  │          │
                       ┌── NEXT (Vercel, server) ─▼──────────┼───────────────────────────┐
                       │ /inicio  (home slot)     server action loadMoreFeedAction       │
                       │ /post/[id]  (D-56 share target, server-rendered)                │
                       │ /criar, /post/[id]/editar                                       │
                       │ apiFetch: Bearer(session) + x-tenant-host  ──────────┐          │
                       │ /v1/media/[assetId]/[variant]  (BFF proxy for <img>) │          │
                       └──────────────────────────────────────────────────────┼──────────┘
                                                                              │          │
                       ┌── HONO API (Cloud Run, ROLE=api) ─────────────────────▼──────┐   │
                       │ requireAuth ─▶ requireModule('feed') ─▶ requireRole/policy  │   │
                       │   GET  /v1/feed?cursor=&limit=     ┐                        │   │
                       │   GET  /v1/feed/posts/{id}         │ ONE hydrated statement │   │
                       │   GET  …/{id}/comments?cursor=     │ per list (no N+1)      │   │
                       │   GET  …/comments/{id}/replies     ┘                        │   │
                       │   POST /v1/feed/posts              ─▶ withTenantTx ──┐      │   │
                       │   POST …/{id}/like  DELETE …/like  (idempotent)      │      │   │
                       │   POST …/{id}/comments  DELETE …/comments/{id}       │      │   │
                       │   PATCH/DELETE /v1/feed/posts/{id}                   │      │   │
                       │        │                                            │      │   │
                       │        └─ emit() collects ──▶ flushEventsAfterHandler│      │   │
                       └────────────────────────────────────┬─────────────────┼──────┘   │
                                                            │ after commit    │          │
                     ┌──────────────────────────────────────▼───┐             │          │
                     │ kernel event bus (in-process)            │             │          │
                     │  post.published / post.liked /           │             │          │
                     │  comment.created … ─▶ test subscriber    │             │          │
                     │  (Phase 7: notifications module)         │             │          │
                     └──────────────────────────────────────────┘             │          │
                                                                              │          │
   ┌── POSTGRES (Supabase) ────────────────────────────────────────────────────▼───┐      │
   │ set_config(request.jwt.claims) + SET LOCAL ROLE authenticated  (withTenantTx) │      │
   │ feed_posts ─ feed_post_media ─ feed_comments ─ feed_likes ─ feed_link_previews │      │
   │ RLS: tenant_id = app.tenant_id()   │ triggers: like_count / comment_count      │      │
   │ constraint: (parent_id,parent_depth) -> (id,depth)  = one reply level          │      │
   │ pgboss.job  ◀── enqueueInTx (same transaction as the post insert)              │      │
   └───────────────────────────────────┬───────────────────────────────────────────┘      │
                                       │                                                  │
   ┌── WORKER (Cloud Run, ROLE=worker) ▼──────────────────────────┐                        │
   │ feed.unfurl-link job                                         │                        │
   │   URL allow/deny ─▶ undici.Agent{ connect: guardedConnector } │                        │
   │   ─▶ open-graph-scraper ─▶ cache row ─▶ enqueue image copy?   │                        │
   │   every redirect hop re-enters the connector                 │                        │
   └──────────────────────────────────────────────────────────────┘                        │
                                                                                           │
   ┌── SUPABASE STORAGE (private `media`) + MUX ───────────────────────────────────────────┘
   │ <tenant_id>/media/<assetId>/{original,w320,w640,w1080,w1600}   │  HLS + signed playback
   └────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/modules/feed/                    # copy of packages/modules/example/ structure
├── package.json                          # name @rede-social/module-feed, same exports map
├── module.ts                             # defineModule({ key: 'feed', home: [{order}], routes, jobs, events, defaultRolePermissions })
├── contracts/index.ts                    # zod schemas + EventMap declaration merging + queue name consts
├── db/schema.ts                          # feed_posts, feed_post_media, feed_comments, feed_likes, feed_link_previews
├── server/
│   ├── index.ts                          # the ONLY surface apps/api imports
│   ├── routes.ts                         # requireAuth → requireModule('feed') → per-route guards
│   ├── service.ts                        # withTenantTx everywhere; emit() after commit
│   ├── unfurl/
│   │   ├── guard.ts                      # PURE: URL policy + net.BlockList + connector factory (unit-testable, no network)
│   │   └── job.ts                        # JobDefinition<UnfurlJob>
│   └── jobs.ts                           # re-export of the job definitions
└── ui/                                   # presentational only, strings as props
    ├── PostCard.tsx  PostHeader.tsx  PostMedia.tsx  PostActions.tsx
    ├── LikeButton.tsx  PostCaption.tsx  DoubleTapHeart.tsx
    ├── CommentSheet.tsx  CommentsList.tsx  CommentItem.tsx  CommentInput.tsx
    ├── FeedList.tsx (the home-slot widget)
    └── index.ts

packages/ui/src/                          # kernel-level additions (reused by Phase 5/6)
├── layout/InfiniteScroll.tsx             # sentinel + skeleton; root from useScrollContainer()
└── hooks/useInfiniteScroll.ts

apps/web/
├── app/(app)/post/[postId]/page.tsx      # D-56 share target
├── app/(app)/post/[postId]/editar/page.tsx
├── app/(app)/criar/page.tsx              # D-57 full-screen composer
├── lib/feed.ts                           # ONE fetch impl shared by page + load-more action (the lib/profile.ts pattern)
├── lib/registry.tsx                      # feed → home[0]; DELETE the example entry
└── messages/pt-BR/feed.json
```

### Pattern 1: Three-layer tenant scoping, unchanged

Every feed read and write is `withTenantTx(ctx, tx => …)`; the tenant is **never** a parameter.

```ts
// Source: packages/core/db/tenant-tx.ts (verbatim)
export async function withTenantTx<T>(
  ctx: Pick<RequestContext, 'userId' | 'tenantId' | 'role'>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({
      sub: ctx.userId, role: 'authenticated',
      tenant_id: ctx.tenantId, tenant_role: ctx.role,
    });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}
```

`[VERIFIED: packages/core/db/tenant-tx.ts]`. Layer 3 is `tenantIsolationPolicy` on every new table `[VERIFIED: packages/core/db/rls.ts]` — `using: sql\`tenant_id = app.tenant_id()\`` and `withCheck: sql\`tenant_id = app.tenant_id()\``, `for: 'all'`, `to: authenticatedRole`.

**Consequence for FEED-07's cross-tenant 404:** do not write a tenant comparison. The foreign post is *invisible* to the lane, the query returns nothing, and the handler throws a bare `404 NOT_FOUND`. This is the documented `getItem` posture `[VERIFIED: packages/modules/example/server/service.ts]` — "there is ONE code path for 'does not exist' and 'belongs to another tenant'". A soft-deleted post of the *own* tenant must therefore take a **distinguishable in-code branch** (row found, `deleted_at is not null`) if the discretion item chooses a "post removido" screen — but both may render the same thing to the user.

### Pattern 2: Keyset paging — copy the envelope, copy the DESC idiom

**What:** the repo has exactly one cursor encoder and its docblock names this phase as the inheritor.

```ts
// Source: packages/core/server/paging.ts (verbatim)
export const CURSOR_VERSION = 1;
const cursorSchema = z.object({ v: z.literal(CURSOR_VERSION), n: z.string(), id: z.uuid() });
export type KeysetCursor = { n: string; id: string };
```

**When to use:** the feed list, the root-comment list, the reply list — three cursors, one envelope.

**The DESC idiom to copy (feed + root comments):**

```ts
// Source: packages/core/server/media/service.ts (listAssets), verbatim predicate + ordering
afterAt
  ? sql`(${mediaAssets.createdAt}, ${mediaAssets.id}) < (${afterAt}::timestamptz, ${afterId}::uuid)`
  : undefined,
…
.orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
.limit(limit + 1)
…
const page = (rows as AssetRow[]).slice(0, limit);
const last = page[page.length - 1];
const nextCursor =
  rows.length > limit && last ? encodeCursor({ n: last.createdAt.toISOString(), id: last.id }) : null;
```

The ASC variant (replies, D-62) is the same with `>` and `asc()` — see `listMembers` in `packages/core/server/profiles/service.ts`, which uses `(expr, mp.id) > (${afterName}::text, ${afterId}::uuid)` with `order by …, mp.id`.

**Index shape (SCHEMA-CONVENTIONS (a).4 — `tenant_id` first, tie-breaker included):**

| Query | Index |
|---|---|
| main feed | `(tenant_id, community_id, created_at desc, id desc)` — `community_id` participates because FEED-02's predicate is `community_id is null` in V1 and `community_id in (…)` in Phase 5 |
| root comments of a post | `(tenant_id, post_id, created_at desc, id desc) where parent_id is null` |
| replies of a root comment | `(tenant_id, parent_id, created_at asc, id asc)` |
| a viewer's like on a target | covered by the partial unique indexes in Pattern 5 |

**Page size:** follow the established constant pair. `[VERIFIED: packages/contracts/src/profiles.ts:198-199]` — `export const MEMBERS_PAGE_SIZE = 25;` / `export const MEMBERS_MAX_PAGE_SIZE = 50;`, and `[VERIFIED: packages/contracts/src/media.ts:221-222]` — `export const MEDIA_LIST_PAGE_SIZE = 25;` / `export const MEDIA_LIST_MAX_PAGE_SIZE = 50;`. Recommend `FEED_PAGE_SIZE = 10` (a post card is far taller than a member row — 25 posts is ~10 screens of images) with `FEED_MAX_PAGE_SIZE = 25`, and `COMMENTS_PAGE_SIZE = 20` / `REPLIES_PAGE_SIZE = 10`. `[ASSUMED]` — the numbers are a UX judgement, the *shape* (`z.coerce.number().int().min(1).max(MAX).default(DEFAULT)`) is the verified convention.

### Pattern 3: One hydrated query per list (Pitfall 10, criterion 4)

**What:** post + author display name + avatar asset id + media rows + like count + comment count + `viewer_liked` come back in **one** statement.

**When to use:** always, for every list in this module. The repo already writes raw `sql` through `tx.execute<Row>(…)` for the shaped case (`listMembers`), so a lateral join is idiomatic here.

```sql
-- shape (the planner writes the real one against the final column names)
select p.id, p.created_at, p.caption, p.edited_at,
       mp.display_name, mp.avatar_asset_id,
       p.like_count, p.comment_count,
       (l.id is not null) as viewer_liked,
       coalesce(m.media, '[]'::json) as media,
       lp.url, lp.title, lp.description, lp.image_asset_id, lp.provider
  from feed_posts p
  join memberships ms   on ms.tenant_id = p.tenant_id and ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes l on l.post_id = p.id and l.user_id = app.user_id()
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join lateral (
    select json_agg(json_build_object('assetId', pm.media_asset_id, 'kind', pm.kind,
                                      'position', pm.position) order by pm.position) as media
      from feed_post_media pm where pm.post_id = p.id
  ) m on true
 where p.deleted_at is null
   and p.community_id is null                        -- Phase 5 widens this predicate
   and ( ${afterAt}::timestamptz is null
         or (p.created_at, p.id) < (${afterAt}::timestamptz, ${afterId}::uuid) )
 order by p.created_at desc, p.id desc
 limit ${limit + 1};
```

No `tenant_id` predicate is written: RLS supplies it, and writing it anyway is the pattern the repo rejects (`listAssets`'s comment: "The tenant predicate is RLS, never the cursor").

**The comment list is two queries, not N+1:** page of root comments (query 1) + the *first page of replies for the roots that have any* (query 2, a `where parent_id = any($1) and row_number() <= N` lateral). D-60's "Ver N respostas" then fetches page 2+ of one root as its own request. Budget: **feed page ≤ 1 statement; post page ≤ 3; a "ver respostas" tap = 1.**

### Pattern 4: One-level replies as a **declarative** constraint (no trigger)

**What:** FEED-05 requires DB enforcement. A composite self-referencing FK does it without a trigger.

```sql
depth         smallint not null default 0,
parent_id     uuid,
parent_depth  smallint,
constraint feed_comments_parent_shape_chk check (
  (parent_id is null     and parent_depth is null and depth = 0)
  or (parent_id is not null and parent_depth = 0  and depth = 1)
),
constraint feed_comments_id_depth_uq unique (id, depth),
constraint feed_comments_parent_fk
  foreign key (parent_id, parent_depth) references feed_comments (id, depth) on delete cascade
```

**Verified this session against this project's local Postgres** (`docker exec supabase_db_rede-social psql`), all three refusal paths, transaction rolled back:

```
--- now try a reply to a reply (must FAIL) ---
ERROR:  insert or update on table "c" violates foreign key constraint "c_parent_fk"
DETAIL:  Key (parent_id, parent_depth)=(33333333-…-333333333333, 0) is not present in table "c".

--- lying about parent_depth = 1 (must FAIL on the check) ---
ERROR:  new row for relation "c" violates check constraint "c_parent_shape_chk"
DETAIL:  Failing row contains (88a97788-…, 1, 33333333-…, 1).

--- depth=2 attempt (must FAIL on the check) ---
ERROR:  new row for relation "c" violates check constraint "c_parent_shape_chk"
DETAIL:  Failing row contains (8f1e0fba-…, 2, 33333333-…, 1).
```

**Why this over a `before insert` trigger:** a trigger that reads the parent row is a read-then-write with no lock, so two concurrent inserts can both observe `parent.parent_id is null`; the FK is enforced by the index and cannot race. It also needs no `security definer` function and no `search_path` hardening (contrast `app.ensure_member_profile()` in `20260921190227_member_profiles_search.sql`, which needs both).

**Drizzle expression:** `foreignKey({ columns: [t.parentId, t.parentDepth], foreignColumns: [t.id, t.depth], name: 'feed_comments_parent_fk' })` inside the table's extra-config callback, plus `unique('feed_comments_id_depth_uq').on(t.id, t.depth)` and `check(...)`. `foreignKey` is exported `[VERIFIED: node_modules/drizzle-orm/pg-core/foreign-keys.d.ts:39]`. **The self-reference must use the callback form** — `.references(() => table.col)` on a self-referencing column is the shape that trips TypeScript circularity and needs `AnyPgColumn`. `[ASSUMED]` that drizzle-kit emits this composite FK cleanly; if `pnpm db:generate` produces nothing or something wrong, the FK + unique go into a `--custom` migration beside the generated one, which is the precedent `20260921190227_member_profiles_search.sql` already sets for "what drizzle-kit cannot model".

**Anti-pattern to avoid:** relying on the *API* to check depth. The roadmap's acceptance check is the DB refusing it; a pgTAP negative case in `supabase/tests/` is the proof.

### Pattern 5: Likes — one table, nullable target FKs, partial unique indexes

The roadmap locks this shape, and it is the one place where SCHEMA-CONVENTIONS' two sub-rules point in different directions. Resolve it in favour of the roadmap:

- `[VERIFIED: packages/core/docs/SCHEMA-CONVENTIONS.md §(e).1]` — *"One table per behaviour, with a typed target — not one table per content type. Reactions: `reactions (tenant_id, user_id, target_type, target_id, kind)` with `unique (user_id, target_type, target_id)`; never `post_likes` + `comment_likes` + `story_likes`."*
- `[VERIFIED: packages/core/docs/SCHEMA-CONVENTIONS.md §(e).3]` — *"'Exactly one target' nullable-FK tables (a notification pointing at a post or a comment or an event) use nullable FKs plus a CHECK that exactly one is set, and partial unique indexes for the uniqueness rules that apply per target"*.

(e).1's `target_type/target_id` sketch cannot carry a foreign key at all, so a deleted post leaves orphan likes and the counter triggers have nothing to cascade from. (e).3's nullable-FK form keeps referential integrity **and** is what the roadmap note says. Recommended:

```
feed_likes(
  id, tenant_id, user_id,
  post_id    uuid references feed_posts(id)    on delete cascade,
  comment_id uuid references feed_comments(id) on delete cascade,
  story_id   uuid,                              -- reserved, FK added in Phase 5
  kind text not null default 'like',            -- V2-CONT-06 emoji reactions are new values
  created_at,
  check ( num_nonnulls(post_id, comment_id, story_id) = 1 )
)
unique index feed_likes_post_uq    on (user_id, post_id)    where post_id    is not null
unique index feed_likes_comment_uq on (user_id, comment_id) where comment_id is not null
unique index feed_likes_story_uq   on (user_id, story_id)   where story_id   is not null
index feed_likes_tenant_post_idx on (tenant_id, post_id)
```

The plan should record the (e).1 deviation in the migration's SQL comment so the next reviewer does not "fix" it back.

**Idempotent toggle (FEED-04, including double-tap and a retried request):** the uniqueness index is the arbiter, not the application.

```ts
// like:   insert … on conflict (user_id, post_id) where post_id is not null do nothing returning id
// unlike: delete from feed_likes where user_id = … and post_id = … returning id
// Both answer 200 with the CURRENT { liked, likeCount } read back in the same transaction.
```

A second identical like inserts zero rows, fires no trigger and changes no counter. **Do not** answer 409 on a repeat: the requirement says *idempotent toggle*, and a double-tap that 409s would break the prototype's `DoubleTapHeart`.

### Pattern 6: Media composition on the post — zero new plumbing

`[VERIFIED: packages/contracts/src/media.ts]` — the purposes and limits the composer must obey already exist:

```ts
export const MEDIA_KINDS = ['image', 'video', 'file'] as const;
export const MEDIA_PURPOSES = ['avatar', 'post', 'cover', 'story', 'attachment'] as const;
export const MEDIA_LIMITS: Record<MediaKind, Partial<Record<MediaPurpose, MediaLimit>>> = {
  image: {
    …
    post: { mimes: IMAGE_MIMES, maxBytes: 15 * 1024 * 1024 },
    …
  },
  video: {
    post: { mimes: VIDEO_MIMES, maxBytes: 500 * 1024 * 1024, maxDurationSeconds: 300 },
    …
  },
  file: {
    attachment: { mimes: ['application/pdf'], maxBytes: 25 * 1024 * 1024 },
  },
};
export const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;
export const PURPOSE_WIDTHS: Record<MediaPurpose, readonly number[]> = {
  …
  post: [320, 640, 1080, 1600],
  …
};
```

Consequences the planner can rely on without re-deciding:
- Images in a post upload with `purpose: 'post'` and get the 320/640/1080/1600 WebP ladder for free.
- A PDF uploads with `kind: 'file', purpose: 'attachment'` — 25 MiB cap, `application/pdf` only, magic-byte checked at `complete`.
- Video uploads with `kind: 'video', purpose: 'post'` — 300 s cap, goes through the `VideoProvider` seam; a provider-owned upload **skips `complete`** (03-07) and the card must render the `processando` state.
- The **per-post counts** (how many images, how many attachments) are *not* in `MEDIA_LIMITS` and are this phase's to add — recommend `FEED_MAX_IMAGES = 10`, `FEED_MAX_ATTACHMENTS = 5`, `FEED_MAX_CAPTION = 2200` (the prototype's `CaptionInput` counter is 2200). `[ASSUMED]` — cheap to tighten in Phase 8.
- **D-53's gallery-XOR-video rule is a DB check**, not just a composer rule: `check ( not (exists image rows and exists video row) )` is not expressible per-row, so put a `media_kind text` discriminator on `feed_posts` (`'none' | 'gallery' | 'video'`) with a check that `feed_post_media.kind` rows agree, or enforce it with a deferred constraint trigger. Recommend the discriminator column — it also gives `PostMedia` its render branch without counting rows.

**Rendering:** images use the existing `<MediaImage>` → `/v1/media/{assetId}/w640` BFF path (`apps/web/components/media/MediaImage.tsx`, `apps/web/app/v1/media/[assetId]/`); video uses `<VideoPlayer>` with the per-request playback tokens from `getPlaybackTokens()` (`apps/web/lib/media.ts`), **never cached or embedded in a payload** (D-44). Attachments get a short-TTL signed download from the API.

**Embeds (YouTube/Vimeo) — recommendation: thumbnail, not iframe.** `[VERIFIED: apps/web/next.config.ts]` — the config sets `headers()` only for `/serwist/:path*` and `/m/:slug/manifest.webmanifest`; there is **no Content-Security-Policy anywhere in the web app today**. Shipping a third-party iframe into a private community with no CSP means (a) the embed can navigate the top frame unless sandboxed correctly, (b) YouTube sets cookies inside a tenant's branded app, and (c) Phase 8 inherits a CSP that must now allow `frame-src https://www.youtube.com`. Render the oEmbed `thumbnail_url` + title as a link-preview card with a play badge that opens the video externally; it is one code path with the OG preview card, needs no CSP work, and PROTOTYPE.md already flags the events-map iframe as owing a CSP review. If the pilot admin insists on inline playback, that is a Phase 8 item behind a real CSP.

### Pattern 7: Domain events — the module teaches the kernel

```ts
// Source: packages/modules/example/contracts/index.ts (verbatim)
declare module '@rede-social/contracts' {
  interface EventMap {
    'example.item.created': ExampleItemCreated;
  }
}
```

```ts
// Source: packages/core/server/events/bus.ts (verbatim docblock)
//  1. **Collect, then flush after commit.** `emit` only appends to `ctx.events`; nothing is
//     delivered until `flush(ctx)` runs, which the response middleware calls once the handler —
//     and therefore its `withTenantTx` — has returned.
//  2. **A subscriber never breaks the request.**
```

`[VERIFIED: packages/contracts/src/events.ts]` — `EventMap` is empty on purpose and `DomainEventRecord` is `{ name, payload, tenantId, occurredAt }`. `@rede-social/module-feed` is the **first real declarer** (MOD-03, criterion 4).

**Recommended event set and payloads.** Phase 7 builds notification rows from these, so each payload carries everything a notification row needs without a re-read (PITFALLS §11's `event_id` idempotency point):

| Event | Payload |
|---|---|
| `post.published` | `{ tenantId, postId, authorUserId, communityId: string \| null, hasMedia: boolean, occurredAt }` |
| `post.edited` | `{ tenantId, postId, authorUserId }` |
| `post.deleted` | `{ tenantId, postId, authorUserId }` |
| `post.liked` / `post.unliked` | `{ tenantId, postId, postAuthorUserId, actorUserId }` — `postAuthorUserId` is the notification recipient, carried so Phase 7 never re-reads the post |
| `comment.created` | `{ tenantId, postId, commentId, parentCommentId: string \| null, postAuthorUserId, parentAuthorUserId: string \| null, actorUserId }` |
| `comment.deleted` | `{ tenantId, commentId, actorUserId }` |
| `comment.liked` / `comment.unliked` | `{ tenantId, commentId, commentAuthorUserId, actorUserId }` |

`[ASSUMED]` — names and shapes are an explicit discretion item; the *mechanism* is verified. Add a `feed.events-smoke` test subscriber registered through the manifest's `events` array (criterion 4 requires a subscriber receiving them), asserting every name fires exactly once per action and **zero times when the handler throws** (the `c.error` branch of `flushEventsAfterHandler`).

### Pattern 8: FEED-08 posting policy — one value, one composition point

`[VERIFIED: packages/core/db/schema/tenant-modules.ts]` — *"`settings` holds per-module knobs (e.g. `stories.ttlHours`) so no module ever adds a column to `tenants`."* The column is `settings: jsonb().$type<Record<string, unknown>>().notNull().default({})`.

`[VERIFIED: packages/core/server/modules/flags-cache.ts]` — the flags cache already loads settings alongside the enabled keys (`settings: Map<ModuleKey, Record<string, unknown>>`, `MODULE_FLAGS_TTL_MS = 30_000`), and `[VERIFIED: packages/contracts/src/bootstrap.ts]` — every bootstrap module entry already carries `settings: z.record(z.string(), z.unknown())`.

`[VERIFIED: packages/core/server/rbac/require-role.ts]`:

```ts
export const KERNEL_ROLE_PERMISSIONS: Record<TenantRole, string[]> = {
  admin_tenant: ['tenant.manage', 'members.manage', 'content.publish'],
  support_tenant: ['chat.support'],
  // V1: members consume. V2 member posting is a permission change here plus a flag, never a migration.
  member: [],
};
```

**Recommendation:** `tenant_modules['feed'].settings.postingPolicy: 'admins_only' | 'members'` (default `'admins_only'`), and extend `permissionsFor(role, enabled)` in `apps/api/src/modules/registry.ts` to also take the settings map so it can add `feed.post.create` for `member` when the policy is `'members'`. Then:
- the API route guard is `requirePermission('feed.post.create')` (or an explicit check against the composed set) — **not** `requireRole('admin_tenant')`, because that hard-codes V1 into the route;
- the composer's FAB visibility reads `bootstrap.permissions.includes('feed.post.create')` — the same value, never a role comparison in the web tier;
- V2 is `update tenant_modules set settings = settings || '{"postingPolicy":"members"}'` and nothing else.

This is the only way to satisfy "the guard must sit in one place both the API and the composer's visibility read" without a migration. Note the 30 s TTL: a policy flip takes effect within 30 s on each instance, same as a module flag; `moduleFlags.invalidate(tenantId)` makes it immediate locally.

### Pattern 9: Unfurl in the worker, behind a connector-pinned Agent

**Flow.** `POST /v1/feed/posts` extracts the first URL from the caption (or takes an explicit `linkUrl` field), validates it against the URL policy **synchronously** (cheap, no network), creates the post plus a `feed_link_previews` row in `status = 'pending'`, and `enqueueInTx(tx, FEED_UNFURL_QUEUE, { tenantId, previewId, url }, { singletonKey: previewId })` in the **same transaction** — the `createItem` pattern `[VERIFIED: packages/modules/example/server/service.ts]`. The worker resolves it; the card renders a compact "link" placeholder until then and the post is publishable immediately.

**Why a job and not a synchronous fetch:** the established rule (02-13) is "Nothing heavy runs in the request path: the request validates and enqueues". A synchronous unfurl puts an attacker-influenced remote host's latency inside a Cloud Run request and inside the admin's publish tap. The roadmap's "unfurled server-side at create time" is satisfied — the unfurl is *initiated* at create time and stored on the post, as opposed to being resolved at read time per viewer.

**Cache:** `feed_link_previews(id, tenant_id, url_hash, url, status, title, description, site_name, image_asset_id, provider, provider_video_id, fetched_at, failure_reason)` with `unique (tenant_id, url_hash)` (sha256 of the normalised URL). Per-tenant, so one tenant cannot learn what another shared. `feed_posts.link_preview_id` is a nullable FK, which lets the admin remove a resolved preview by nulling one column (a discretion item — recommend yes, it is one `PATCH` field).

**Failure rendering:** on `status = 'failed'` or a target with no OG tags, render the bare clickable URL and nothing else. Never render an empty card. `[ASSUMED]` — discretion item, but it is the only option that cannot look broken.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Opaque pagination cursor | A second base64 envelope in the feed module | `encodeCursor` / `decodeCursor` from `packages/core/server/paging.ts` | Its own docblock: *"The convention Phase 4's feed inherits"* and *"Do not write a second envelope"* (04-CONTEXT canonical refs). It is already TOTAL — a tampered cursor degrades to page 1, never a 500 |
| Private-IP range math for the SSRF guard | A regex or hand-written CIDR comparison | `net.BlockList` (`addSubnet(net, prefix, type)`, `check(address, type)`) | Built into Node; `[VERIFIED: node_modules/@types/node/net.d.ts:767-816]`. Handles IPv4-mapped IPv6 notation (`::ffff:123.123.123.123`) which hand-rolled checks reliably miss |
| Outbound HTTP pinning across redirects | Manual `redirect: 'manual'` loop re-validating each `Location` | `undici.Agent({ connect: <connector> })` handed to OGS via `fetchOptions.dispatcher` | Verified this session: **every hop re-enters the connector**, so redirect-to-private and DNS-rebinding are both covered by one guard |
| OG/Twitter/JSON-LD metadata parsing | A cheerio scraper of your own | `open-graph-scraper@6.12.0` | Charset detection (`chardet` + `iconv-lite`), OG/Twitter/Dublin-Core/JSON-LD fallbacks, favicon resolution — hundreds of edge cases, and it is the CLAUDE.md-named package |
| Response body size cap | Counting bytes off the stream | `undici.Agent({ maxResponseSize })` | Verified this session. OGS calls `response.arrayBuffer()` with **no cap of its own** and checks `content-type` *after* reading the whole body — the Agent is the only place a cap can live |
| Like/comment counters | `update … set like_count = like_count + 1` in application code | An `after insert/delete` trigger on `feed_likes` / `feed_comments` | Roadmap-locked, and PITFALLS §10(b): a counter updated outside the reaction's transaction drifts the moment one of the two fails |
| One-level reply enforcement | An application `if (parent.parentId) throw` | The composite self-FK in Pattern 4 | FEED-05 says "enforced by a DB constraint"; the application check is also racy |
| Signed upload / resumable upload / video ingest | Anything at all | `useSignedUpload` + `FileDropZone` (`apps/web/components/media/`) | 03-04/03-07 generalised these exactly so Phase 4 would not touch them. The provider-owned branch (skip `complete` for Mux) is already handled |
| Image URLs in the feed | A new signed-URL mechanism | `/v1/media/{assetId}/{variant}` via the Next BFF route handler | 03-01/03-04: the path is stable and permanently cacheable, the 302 carries the tenant check, and an `<img>` cannot carry the HttpOnly session |
| Pull-to-refresh, scroll-root discovery | Porting the prototype's `#app-scroll` lookup | `PullToRefresh` + `useScrollContainer()` from `@rede-social/ui` | `[VERIFIED: packages/ui/src/index.ts, packages/ui/src/layout/ScrollContainerContext.tsx]` — already ported and already solve the PROTOTYPE risk-2 "implicit global" |
| pt-BR strings in components | Literals in JSX | `apps/web/messages/pt-BR/feed.json` + props | `scripts/check-ui-literals.sh` fails `pnpm lint` on pt-BR JSX text (02-04) |
| Query counting for the CI budget | A bespoke instrumentation layer in production code | `pg_stat_statements` deltas in the integration suite | Already installed and preloaded locally; needs zero production code |

**Key insight:** in this repo the expensive mistake is not choosing a weak library — it is *writing a second implementation of something the kernel already owns*. Every one of Phase 3's recorded surprises (03-03's `likeEscape` re-derivation, 03-07's `tokens` property path, 03-01's key derivation) came from a boundary or a shape that already existed. The feed's entire novelty budget should go to the schema and the SSRF guard.

---

## Runtime State Inventory

> Included because this phase deletes a live module (D-19), which is a migration, not only a code edit.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | `public.example_items` rows (created by `scripts/seed.ts`, by `apps/api/tests/integration/example.test.ts`, and by the pgTAP fixtures). `public.tenant_modules` rows with `module_key = 'example'` — the seed enables it on the demo tenant: `[VERIFIED: scripts/seed.ts:126-128]` — *"D-17 all six + D-19: `example` (the throwaway module) is enabled HERE ONLY — never on a real"* / `modules: [...REAL_TENANT_DEFAULT_MODULES, 'example'],` | **Data migration:** `drop table public.example_items;` and `delete from public.tenant_modules where module_key = 'example';` in the same forward-only migration, before the CHECK narrows |
| **Schema constraint** | `tenant_modules_key_chk` is generated from `TOGGLEABLE_MODULES` `[VERIFIED: packages/core/db/schema/tenant-modules.ts]` — `check('tenant_modules_key_chk', sql\`${t.moduleKey} in (${moduleKeyList})\`)`. Removing `'example'` from `[VERIFIED: packages/contracts/src/modules.ts]` `TOGGLEABLE_MODULES = ['feed','communities','stories','events','chat','notifications','example']` **changes that constraint** | **Migration:** `pnpm db:generate` will emit a drop/add of the CHECK. It fails if any `'example'` row still exists — so the delete must come first, in the same file |
| **Live service config** | None — no external service knows about `example`. Verified: no occurrence outside `apps/`, `packages/`, `scripts/`, `supabase/` | None |
| **OS-registered state** | None — no cron, no scheduler. The `example.process` pg-boss **queue row** exists in `pgboss.queue` once a worker has booted | **Optional cleanup:** `delete from pgboss.queue where name = 'example.process'` (and its `pgboss.job` rows). Harmless if left, but the queue would be recreated by nothing and shows as an orphan |
| **Secrets/env vars** | None | None |
| **Build artifacts / installed packages** | `apps/api/package.json` and `apps/web/package.json` declare `@rede-social/module-example` as a workspace dependency; `packages/boundary-fixture` imports `@rede-social/module-example/server/service` deliberately as violation #2 `[VERIFIED: packages/boundary-fixture/src/index.ts]` — *"2. `@rede-social/module-example/server/service` — another module's INTERNALS, not its published entry point"* | **Code edits + `pnpm install`:** repoint the fixture at `@rede-social/module-feed/server/service` (the fixture must keep testing violation #2, so it needs *a* module to point at — the feed becomes that module) |

**Complete removal inventory** (source files only; `apps/web/.next/**` hits are build artefacts):

```
apps/api/package.json                          apps/web/lib/registry.tsx
apps/api/src/app.ts                            apps/web/messages/pt-BR/example.json      (delete)
apps/api/src/modules/registry.ts               apps/web/package.json
apps/api/tests/integration/example.test.ts     (delete)   packages/boundary-fixture/package.json
apps/api/tests/integration/isolation.test.ts   packages/boundary-fixture/src/index.ts
apps/api/tests/integration/modules.test.ts     packages/contracts/src/modules.ts
apps/api/tests/integration/platform-tenants.test.ts        packages/contracts/tests/platform.test.ts
apps/api/tests/unit/mounts.test.ts             packages/core/server/platform/modules.ts
apps/api/tests/unit/registry.test.ts           packages/core/server/platform/tenants.ts
apps/web/app/(app)/inicio/example-actions.ts   (delete)    packages/core/tests/app-shell.test.tsx
apps/web/e2e/admin.ts                          packages/core/tests/nav.test.ts
apps/web/e2e/example.spec.ts          (delete) packages/modules/example/**              (delete)
apps/web/e2e/phase2-smoke.spec.ts              scripts/seed.ts
apps/web/e2e/platform-domains.spec.ts          supabase/tests/010-rls-coverage.sql
apps/web/e2e/platform-tenants.spec.ts          supabase/tests/020-tenant-isolation.sql
                                               supabase/tests/030-lanes.sql
```

Two of these carry logic that must be *retargeted*, not deleted:
- `[VERIFIED: packages/core/server/platform/modules.ts:17,25]` — *"`example` is refused (D-19): a real tenant never gets the sample module, whatever the panel sends."* / `if (key === 'example') {`. With the key gone from `TOGGLEABLE_MODULES`, `z.enum(REAL_TENANT_DEFAULT_MODULES)` at the route already refuses it; the explicit branch becomes dead and its test must change.
- `[VERIFIED: packages/core/server/platform/tenants.ts:217]` — `enabled: key !== 'example' && wanted.has(key),`. Becomes just `wanted.has(key)`.
- `supabase/tests/020-tenant-isolation.sql` currently uses `example_items` as its worked isolation case (lines 29-30, 38, 104-134, 333-338) and `030-lanes.sql` uses it for the privilege-creep proof (lines 28, 39, 51, 62, 72). **Both need a feed table substituted in the same PR, or the gate loses coverage between the drop and the feed tables landing.** Sequence the plan so the feed schema lands *before* the example removal.

---

## Common Pitfalls

### Pitfall 1: A `lookup`-only SSRF guard is silently bypassed by an IP-literal URL

**What goes wrong:** the natural implementation — `new Agent({ connect: { lookup: guardedLookup } })` — blocks `http://localhost/` but happily fetches `http://127.0.0.1/` or `http://169.254.169.254/`, because `net.connect` only calls `lookup` for **hostnames**. The guard looks correct, has a passing test against `localhost`, and does not protect the metadata endpoint at all.

**Verified this session** (two runs, same Agent):

```
A hostname localhost BLOCKED: fetch failed | cause: blocked ::1
   lookup calls so far: ["localhost"]
B ip-literal 127.0.0.1: NOT BLOCKED 200 SECRET-B
   lookup calls so far: []
```

**How to avoid:** make the guard a **connector function**, not a `lookup` option — the connector receives `opts.hostname` for every hop including IP literals. Verified:

```
literal direct BLOCKED: fetch failed | cause: blocked literal 127.0.0.1
  connector saw: ["127.0.0.1"]
```

**Warning signs:** a guard test suite that only uses domain names; a `lookup` function with no `net.isIP` sibling.

### Pitfall 2: The unfurl response body has no size cap

**What goes wrong:** `open-graph-scraper` reads the whole body with `response.arrayBuffer()` and only *then* checks `content-type` — `[VERIFIED: open-graph-scraper@6.12.0 dist/esm/lib/request.js]`:

```js
const bodyArrayBuffer = await response.arrayBuffer();
const bodyText = Buffer.from(bodyArrayBuffer).toString('utf-8');
…
const contentType = response?.headers?.get('content-type')?.toLowerCase();
if (contentType && !contentType.includes('text/')) {
  throw new Error('Page must return a header content-type with text/');
}
```

A hostile URL serving a 2 GB stream with `content-type: text/html` exhausts the worker's memory before that check runs.

**How to avoid:** `new Agent({ maxResponseSize: 512 * 1024 })`. Verified this session:

```
CAPPED aborted: terminated | cause: Response content exceeded max size
```

Also set `connectTimeout`, `headersTimeout` and `bodyTimeout` on the Agent, and pass `timeout` to OGS (it becomes `AbortSignal.timeout((options.timeout ?? 10) * 1000)`).

**Warning signs:** a worker OOM that only reproduces on one tenant's post.

### Pitfall 3: N+1 in the feed — and a query budget that counts the wrong things

**What goes wrong (a):** post → author → media → like count → comment count → `viewer_liked` as six queries per post is 121 round trips for a 20-post page from Cloud Run to Supabase (PITFALLS §10).

**What goes wrong (b):** the CI budget check counts the tenant lane's own overhead and produces a number nobody can reason about. `[VERIFIED: local Supabase Postgres]` `pg_stat_statements.track_utility = on`, so `BEGIN`, `COMMIT` and `SET LOCAL ROLE authenticated` are all counted, and `withTenantTx` emits three of them plus the `select set_config(...)` on **every** request.

**How to avoid:** express the budget as a filtered sum, not a total. Verified this session that `pg_stat_statements_reset()` works as `postgres`, that statement text is normalised, and that repeated calls collapse into one row with `calls` incremented:

```
 did_reset
-----------
 t
                       query                       | calls | rows
---------------------------------------------------+-------+------
 select count(*) from public.tenants where id = $1  |     2 |    2
```

So the assertion is `select coalesce(sum(calls),0) from pg_stat_statements where query ~ 'feed_(posts|comments|likes|post_media|link_previews)'` — reset, issue one `GET /v1/feed?limit=10`, assert `<= 1`. Note `sum(calls)`, **not** `count(*)`: two executions of the same statement are one row.

**Warning signs:** a budget test that passes with a hard-coded "5" nobody can explain; `await` inside a `.map()` in the service.

### Pitfall 4: The `example` module's tables are the isolation suite's worked example

**What goes wrong:** deleting `@rede-social/module-example` before the feed tables exist leaves `020-tenant-isolation.sql` and `030-lanes.sql` with no table to prove anything against, and the "exit gate of every phase" silently gets weaker. `[VERIFIED: supabase/tests/020-tenant-isolation.sql]` references `public.example_items` on lines 38, 104, 110, 115, 120, 125, 134, 333, 338; `[VERIFIED: supabase/tests/030-lanes.sql]` on lines 28, 39, 51, 62, 72.

**How to avoid:** sequence the plan as *feed schema + its isolation cases land first*, *example removal second*, in that order, with the pgTAP substitution happening in the removal plan. And keep the 03-08 discipline `[VERIFIED: STATE.md]` — *"every new cross-tenant isolation case asserts its POSITIVE control in the same test (T-03-56), so a globally broken route cannot make the negative pass vacuously"*.

### Pitfall 5: The counter trigger and the soft delete disagree

**What goes wrong:** `comment_count` is maintained by an `after insert/delete` trigger, but D-61 soft-deletes comments (`deleted_at`), which is an `UPDATE` — so the count never goes down and every post shows a phantom comment. The same applies to a soft-deleted post whose likes remain.

**How to avoid:** the trigger must fire on `after insert or delete or update of deleted_at` and branch on the `deleted_at` transition, not only on row existence. Write the `where deleted_at is null` filter into the *read* queries **and** into the counter's definition, and add a reconciliation query in the pgTAP suite (`select count(*) … where deleted_at is null` equals the stored counter for every post in the fixture) — PITFALLS §10(b)'s "keep the source table authoritative so a nightly recount can repair drift".

**Warning signs:** "3 comentários" on a post with two visible comments.

### Pitfall 6: `deleted_at` filters missing from the RLS-shaped queries

**What goes wrong:** `tenantIsolationPolicy` is `for: 'all'` with `using: tenant_id = app.tenant_id()` — it says **nothing** about `deleted_at`. A soft-deleted post is still visible to the lane and will appear in any query that forgets the predicate.

**How to avoid:** every feed read filters `deleted_at is null` explicitly (SCHEMA-CONVENTIONS (d).2: *"every read filters `deleted_at is null`"*). Do **not** put it in the RLS policy — Phase 8's MODER-01 needs the admin to see what was removed.

### Pitfall 7: The prototype's `framer-motion` and mock imports

**What goes wrong:** the prototype components import `framer-motion`, `@/lib/mock/comments`, `@/lib/mock/users` (for a `gender` flag feeding `VerifiedBadge`), `@/hooks/useBookmark`, and `@/lib/utils`'s `cn`. Porting them verbatim drags four dead dependencies into the module package and breaks the boundary lint.

**How to avoid:** the port map is already written — `[VERIFIED: .planning/research/PROTOTYPE.md §5]` — *"Reads `lib/mock/users` for gender"* and *"`onSave` accepted but no button (bookmark removed)"*. Use `motion` (already in `@rede-social/ui`), drop `VerifiedBadge`, drop `useBookmark`, import `cn` from `@rede-social/ui`, and take every string as a prop.

### Pitfall 8: `InfiniteScroll` is the one prototype primitive that is **not** yet ported

`[VERIFIED: packages/ui/src/index.ts]` — the barrel exports `PullToRefresh`, `usePullToRefresh`, `ScrollContainerProvider`, `useScrollContainer`, `BottomSheet`, `Skeleton` … and **no** `InfiniteScroll` / `useInfiniteScroll`. The prototype's version hardcodes `document.getElementById("app-scroll")` as the IntersectionObserver root. Port it into `@rede-social/ui` (not into the feed module) taking the root from `useScrollContainer()`, because Phase 5's community post list and Phase 7's notification list need the identical thing.

### Pitfall 9: A second data-fetch path for "load more"

**What goes wrong:** the page server-renders the first feed page through one function and the client "load more" fetches through another; the two drift on page size, query encoding or the tenant header, and the seam only shows up as duplicate/missing posts.

**How to avoid:** the 03-05 rule, recorded in STATE.md — *"the member fetch has ONE implementation (`getMembers` in `lib/profile.ts`), shared by the page and `loadMoreMembersAction`, so the first page and the Carregar mais button cannot drift on page size or query encoding"*. `apps/web/lib/feed.ts` is the single implementation; the sentinel calls a server action that calls it.

---

## Code Examples

### 1. The SSRF-guarded fetch, handed to `open-graph-scraper`

```ts
// packages/modules/feed/server/unfurl/guard.ts
// PURE except for the connector factory: the URL policy and the BlockList are unit-testable with
// no network, the posture of packages/core/server/branding/upload.ts and .../paging.ts.
import dns from 'node:dns';
import net from 'node:net';
import { Agent, buildConnector } from 'undici';

export class BlockedTargetError extends Error {}

/** Everything a tenant's worker must never be able to reach. net.BlockList does the range math. */
function denyList(): net.BlockList {
  const b = new net.BlockList();
  // IPv4
  for (const [cidr, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16],            // ← GCP/AWS metadata lives here
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ] as const) b.addSubnet(cidr, prefix, 'ipv4');
  // IPv6
  for (const [cidr, prefix] of [
    ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10],
    ['::ffff:0:0', 96],             // IPv4-mapped — check() understands this notation
    ['64:ff9b::', 96], ['2001:db8::', 32],
  ] as const) b.addSubnet(cidr, prefix, 'ipv6');
  return b;
}

const BLOCKED = denyList();
const isBlocked = (address: string, family: number) =>
  BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4');

/** DNS names: resolve ALL addresses and refuse if ANY is blocked (Happy Eyeballs tries them all). */
const guardedLookup: net.LookupFunction = (hostname, options, cb) => {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err, []);
    for (const { address, family } of addrs) {
      if (isBlocked(address, family)) return cb(new BlockedTargetError(address), []);
    }
    const first = addrs[0];
    if (!first) return cb(new BlockedTargetError(hostname), []);
    cb(null, options.all ? addrs : first.address, first.family);
  });
};

/**
 * PITFALL 1: `connect: { lookup }` alone is NOT enough — net.connect never calls `lookup` for an
 * IP-literal host, so http://127.0.0.1/ walks straight through. The connector sees every hostname,
 * literal or not, on EVERY redirect hop.
 */
export function guardedAgent(): Agent {
  const base = buildConnector({ lookup: guardedLookup, timeout: 3_000 });
  const connector: buildConnector.connector = (opts, cb) => {
    const version = net.isIP(opts.hostname);            // 0 when it is a DNS name
    if (version && isBlocked(opts.hostname, version)) {
      return cb(new BlockedTargetError(opts.hostname), null);
    }
    return base(opts, cb);
  };
  return new Agent({
    connect: connector,
    maxResponseSize: 512 * 1024,   // PITFALL 2: OGS reads the whole body before checking content-type
    connectTimeout: 3_000,
    headersTimeout: 5_000,
    bodyTimeout: 5_000,
  });
}

/** Cheap synchronous policy, applied at create time before anything is enqueued. */
export function assertAllowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedTargetError(url.protocol);
  if (url.username || url.password) throw new BlockedTargetError('credentials');
  return url;
}
```

```ts
// packages/modules/feed/server/unfurl/job.ts — the worker half
import ogs from 'open-graph-scraper';
import { guardedAgent, assertAllowedUrl } from './guard';

const agent = guardedAgent();   // one Agent per process, pooled

export async function unfurl(rawUrl: string) {
  const url = assertAllowedUrl(rawUrl);
  const { error, result } = await ogs({
    url: url.toString(),
    timeout: 5,                                   // seconds → AbortSignal.timeout inside OGS
    onlyGetOpenGraphInfo: false,
    // VERIFIED: OGS calls undici.fetch and spreads fetchOptions into it, so the dispatcher is
    // honoured — and every redirect hop re-enters the connector above.
    fetchOptions: { dispatcher: agent, redirect: 'follow' },
  });
  if (error) return null;
  return {
    title: result.ogTitle ?? result.twitterTitle ?? null,
    description: result.ogDescription ?? result.twitterDescription ?? null,
    siteName: result.ogSiteName ?? null,
    imageUrl: result.ogImage?.[0]?.url ?? null,
  };
}
```

`[VERIFIED: open-graph-scraper@6.12.0 dist/esm/lib/request.js]` — `const undici_1 = require("undici"); … response = await (0, undici_1.fetch)(url ?? '', { signal: AbortSignal.timeout((options.timeout ?? 10) * 1000), ...options.fetchOptions, headers: { … } });`. The spread places `fetchOptions` **after** `signal`, so a caller may also override the abort signal.

### 2. The module manifest (copy of the example's shape)

```ts
// packages/modules/feed/module.ts
import { moduleLogger } from '@rede-social/core/server/logging';
import { defineModule } from '@rede-social/core/server/modules/manifest';
import { feedUnfurlJob } from './server/jobs';

const log = moduleLogger('module-feed');

export const feedModule = defineModule({
  key: 'feed',
  // D-55 AMENDS D-40: the feed is a HOME SLOT, not a nav tab. No `nav` key at all.
  home: [{ order: 10 }],
  routes: () => import('./server/routes').then((m) => m.feedRoutes),
  jobs: [feedUnfurlJob],
  events: [
    { event: 'post.published', handler: async (p) => { log.info({ event: 'post.published', ...p }, 'post published'); } },
    // … the criterion-4 test subscriber
  ],
  // Composed on top of KERNEL_ROLE_PERMISSIONS by permissionsFor(); revoked with the flag.
  // `member` gets feed.post.create only when settings.postingPolicy === 'members' (Pattern 8).
  defaultRolePermissions: { admin_tenant: ['feed.post.create', 'feed.post.manage'] },
});
```

`[VERIFIED: packages/core/server/modules/manifest.ts]` — `ModuleHomeSlot` is `{ order: number }` and `nav` is optional; `defineModule` throws for a key not in `TOGGLEABLE_MODULES`.

### 3. The idempotent like toggle (service shape)

```ts
// packages/modules/feed/server/service.ts
export async function likePost(ctx: RequestContext, postId: string) {
  const { liked, likeCount, authorUserId } = await withTenantTx(ctx, async (tx) => {
    // The uniqueness index is the arbiter: a double-tap inserts zero rows and fires no trigger.
    await tx.execute(sql`
      insert into feed_likes (tenant_id, user_id, post_id)
      select ${ctx.tenantId}::uuid, ${ctx.userId}::uuid, p.id
        from feed_posts p where p.id = ${postId}::uuid and p.deleted_at is null
      on conflict (user_id, post_id) where post_id is not null do nothing`);
    const [row] = await tx.execute<{ like_count: number; author_user_id: string }>(sql`
      select p.like_count, p.author_user_id from feed_posts p where p.id = ${postId}::uuid`);
    if (!row) throw new ApiError(404, 'NOT_FOUND');   // foreign tenant OR unknown id — one branch
    return { liked: true, likeCount: row.like_count, authorUserId: row.author_user_id };
  });

  emit(ctx, 'post.liked', { tenantId: ctx.tenantId, postId, postAuthorUserId: authorUserId, actorUserId: ctx.userId });
  return { liked, likeCount };
}
```

Follows `createItem`'s verified posture `[VERIFIED: packages/modules/example/server/service.ts]` — *"`emit` runs only after `withTenantTx` RESOLVES, and even then only queues the event"*.

### 4. The CI query budget (integration test)

```ts
// apps/api/tests/integration/feed-query-budget.test.ts (shape)
await admin`select pg_stat_statements_reset()`;
const res = await fetch(`${API}/v1/feed?limit=10`, { headers: authHeaders });
expect(res.status).toBe(200);
const [{ calls }] = await admin<{ calls: number }[]>`
  select coalesce(sum(calls), 0)::int as calls
    from pg_stat_statements
   where query ~ 'feed_(posts|comments|likes|post_media|link_previews)'`;
expect(calls).toBeLessThanOrEqual(1);   // ONE hydrated statement for a feed page
```

`[VERIFIED: local Supabase Postgres]` — `pg_stat_statements` version 1.11, present in `shared_preload_libraries`, `track = top`, `track_utility = on`, `max = 5000`. The suite already has a superuser `postgres` connection for fixtures (`apps/web/e2e/admin.ts` uses `postgres@3.4.9` directly for the same reason).

### 5. The `EXPLAIN` acceptance check (pgTAP)

```sql
-- supabase/tests/0xx-feed-plans.sql (shape)
-- The feed's keyset page must use the index, not a sort of the whole table.
select matches(
  (select plan from (
     select (json_array_elements(p::json->0->'Plan'->'Plans')->>'Node Type') as plan
       from (select current_setting('x') as p) s) q limit 1),
  'Index Scan',
  'the feed page is an index scan on feed_posts_tenant_community_created_idx'
);
```

The real form is `explain (format json) <the feed query>` captured into a temp table and asserted with `like '%Index Scan%'` and `not like '%Seq Scan on feed_posts%'`. Seed enough rows in the fixture that the planner would otherwise choose a sequential scan — with 3 rows it always will, and the test would prove nothing. `[ASSUMED]` — the exact pgTAP formulation; the *requirement* (roadmap names `EXPLAIN` as an acceptance check) is locked.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `OFFSET`/`page=2` pagination | Keyset cursors with composite indexes | Long-settled Postgres practice; this repo since 03-03 | Mandatory here — an insert-heavy feed duplicates and skips under offset |
| Counter column updated from application code | Same-transaction trigger, with the source table authoritative for reconciliation | Roadmap-locked for this project | No drift; hot-row contention is a non-issue at pilot scale |
| SSRF guard as a deny-list of hostnames / a regex on the URL | Connector-level pinning at the socket layer (`undici` connector + `net.BlockList`), covering redirects and rebinding in one place | undici 5+ exposed `connect`; `net.BlockList` since Node 15 | The only form that survives a redirect to an IP literal |
| Polymorphic `target_type` + `target_id` for reactions | Nullable target FKs + `num_nonnulls(...) = 1` CHECK + partial unique indexes | SCHEMA-CONVENTIONS (e).3 (and the roadmap note for this phase) | Keeps `on delete cascade` and lets the counter triggers work |
| `framer-motion` | `motion` (the renamed package) | 2024 rename | The prototype's imports are stale; `@rede-social/ui` already carries `motion` |
| `middleware.ts` | `proxy.ts` (Node runtime) | Next 16 | Already done in Phase 1 — do not reintroduce |

**Deprecated/outdated in the prototype (do not port):**
- `CommunityTopic` as a second post model — killed by D-51
- `useBookmark` / `PostActions.onSave` — no requirement (CONTEXT deferred list)
- `VerifiedBadge` + the `lib/mock/users` gender read — dropped by the PROTOTYPE port map
- `CommentPreview.tsx` — unused in the prototype and imports mocks directly
- Unbounded `CommentItem` recursion — capped at one level (D-60 + the DB constraint)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | React Query is deliberately **not** introduced in this phase, despite CLAUDE.md's stack table listing it | Standard Stack | Low. If the user wants it, the server-action load-more still works; adding a client cache later is additive. But it contradicts a CLAUDE.md table entry, so the plan should surface it as a one-line confirmation, not a silent choice |
| A2 | Page sizes `FEED_PAGE_SIZE = 10`, `COMMENTS_PAGE_SIZE = 20`, `REPLIES_PAGE_SIZE = 10` | Pattern 2 | Low. Pure UX tuning; the clamped-schema *shape* is verified convention |
| A3 | Per-post limits `FEED_MAX_IMAGES = 10`, `FEED_MAX_ATTACHMENTS = 5`, `FEED_MAX_CAPTION = 2200` | Pattern 6 | Low. Explicit discretion item; tightening in Phase 8 is cheap; loosening after posts exist is also cheap |
| A4 | drizzle-kit 0.31.10 emits the composite self-referencing FK + `unique (id, depth)` correctly | Pattern 4 | Medium. If it does not, the constraint moves to a `--custom` migration — a known, precedented fallback (`20260921190227_member_profiles_search.sql`), costing one extra file, not a redesign |
| A5 | The recommended domain-event names and payload shapes | Pattern 7 | Medium. Phase 7's notification module consumes them; getting a field wrong means a re-read there. Favour over-carrying (`postAuthorUserId`, `parentAuthorUserId`) |
| A6 | A thumbnail-that-opens-externally is the right V1 answer for YouTube/Vimeo, not a sandboxed iframe | Pattern 6 | Low-Medium. Verified that no CSP exists today, so the iframe route would ship an unguarded third-party frame. If the pilot admin demands inline playback it becomes a Phase 8 item behind a real CSP |
| A7 | The unfurl runs as a worker job (not synchronously in the create request) | Pattern 9 | Low. The roadmap's "at create time" is satisfied by "initiated at create time and cached on the post"; the composer UX (a pending placeholder) is the visible consequence and is a discretion item |
| A8 | A failed/empty unfurl renders the bare link, never an empty card | Pattern 9 | Low. Discretion item |
| A9 | `deleted_at` transitions must be handled inside the counter trigger | Pitfall 5 | Medium if missed — phantom counts are user-visible and the pgTAP reconciliation assertion is the cheap guard |
| A10 | `D-53`'s gallery-XOR-video rule needs a `media_kind` discriminator column to be a real check constraint | Pattern 6 | Low. The alternative (deferred constraint trigger) works too; the discriminator also serves the renderer |
| A11 | The exact pgTAP formulation of the `EXPLAIN` acceptance check | Code Examples §5 | Low. The check is required by the roadmap; the formulation is mechanical |
| A12 | `undici` should be a direct dependency of `@rede-social/module-feed` pinned at `7.29.1` so it is the same instance OGS uses | Standard Stack / Package Audit | Low-Medium. If pnpm resolves two copies, the `dispatcher` object would not be recognised by OGS's `fetch` and the guard would silently not apply — **add an assertion test that a blocked URL actually throws**, which turns this from an assumption into a test |

---

## Open Questions

1. **Does `apps/web` keep server-action pagination, or adopt React Query?**
   - What we know: CLAUDE.md's table names `@tanstack/react-query@5.102.8`; the repo has never installed it; Phase 3 established a server-action load-more pattern that works.
   - What's unclear: whether the user considers the CLAUDE.md table binding.
   - Recommendation: plan for the server-action pattern (A1) and raise it as a single confirmation line in the plan, alongside the package-legitimacy checkpoint.

2. **Where does the "editado" marker live, and what counts as an edit?**
   - What we know: FEED-03 requires the marker; `edited_at timestamptz` is the obvious column.
   - What's unclear: whether swapping media counts, and whether the marker shows a timestamp.
   - Recommendation: `edited_at` set on **any** persisted change including media, marker renders as a plain "editado" with no timestamp (matches the prototype's density). Pin it with a test so a later change is deliberate.

3. **Does a soft-deleted post's share link 404 or show "post removido"?**
   - What we know: D-56 commits the cross-tenant case to 404, and the two must be distinguishable *in code* (they take different branches) even if not to the user.
   - What's unclear: the product answer.
   - Recommendation: 404 for both, identical screen. It is one code path, matches D-23's "one indistinguishable screen for all misses" precedent recorded for `/membros/[id]` (03-05), and removes a whole class of "did this exist?" probes.

4. **How many statements is the real feed budget?**
   - What we know: the measurement mechanism is verified; the target for a *list* is 1.
   - What's unclear: the post-detail page's number once comments + first-page replies are included.
   - Recommendation: assert `<= 1` for `/v1/feed` and `<= 3` for `/v1/feed/posts/{id}` (post + root comments + first replies), and let the number be a named constant in the test so a future regression is a diff, not a mystery.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v24.14.0 | — |
| Local Supabase Postgres | migrations, pgTAP, integration tests | ✓ | container `supabase_db_rede-social`, port 54322 open | — |
| `pg_stat_statements` | the CI query budget | ✓ | 1.11, in `shared_preload_libraries`, `track=top`, `track_utility=on` | count in the app via postgres.js `debug` (`[VERIFIED: node_modules/postgres/types/index.d.ts:78]` — `debug: boolean \| ((connection: number, query: string, parameters: any[], paramTypes: any[]) => void)`) |
| `auto_explain` | optional plan logging | ✓ | preloaded, `log_min_duration = 10000` | plain `explain (format json)` in pgTAP |
| `pg_trgm`, `unaccent`, `citext`, `pgcrypto` | existing kernel features | ✓ | 1.6 / 1.1 / 1.6 / 1.3 | — |
| Supabase CLI | applying migrations | ✓ | 2.117.0 (`package.json` devDependency, `scripts/supabase.sh` prefers the pinned binary) | — |
| Playwright | mobile-viewport e2e | ✓ | 1.63.0, two-tenant fixtures + iPhone 14 project already in `apps/web/e2e` | — |
| Mux account | real HLS transcode for post video | ✗ | — | The `fake` VideoProvider (03-06) covers the whole broker path locally; **real transcode and real-device HLS playback stay KNOWN-BLOCKED on Phase 01.1**, recorded in `docs/DEPLOY.md`. Expect the same partial UAT Phase 3 closed with |
| Outbound internet from the worker | unfurl against real sites | ✓ (dev machine) | — | The unfurl tests must run against **local fixture servers**, not the public internet — the guard tests in this research did exactly that and are deterministic |

**Missing dependencies with no fallback:** none for planning.
**Missing dependencies with fallback:** Mux — a post with video is verifiable end-to-end locally through the `fake` provider; the two real-device lines are UAT items, not blockers.

---

## Validation Architecture

`workflow.nyquist_validation` is `true` `[VERIFIED: .planning/config.json]`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (unit + integration), Playwright 1.63.0 (e2e), pgTAP via `supabase test db` (Supabase CLI 2.117.0) |
| Config file | per-package `vitest.config.ts`; `apps/web/playwright.config.ts` + `playwright.pwa.config.ts`; `supabase/tests/*.sql` |
| Quick run command | `pnpm --filter @rede-social/module-feed test` (new package) / `pnpm --filter @rede-social/api test` |
| Full suite command | `pnpm verify` — `[VERIFIED: package.json]` `"verify": "pnpm lint && pnpm turbo typecheck build test && pnpm check:static-routes && pnpm boundaries && pnpm boundaries:negative && pnpm guard:lanes && pnpm supabase test db && pnpm test:integration && pnpm spike:supavisor && pnpm e2e && pnpm --filter @rede-social/web e2e:pwa"` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FEED-01 | admin composes a post with gallery / video / link / PDF | e2e (mobile) | `pnpm --filter @rede-social/web exec playwright test feed-composer.spec.ts` | ❌ Wave 0 |
| FEED-01 | gallery XOR video refused at the API and at the DB | integration + pgTAP | `pnpm test:integration`, `pnpm supabase test db` | ❌ Wave 0 |
| FEED-02 | keyset page is stable under concurrent inserts; no duplicates/skips | integration | `pnpm test:integration -t feed-paging` | ❌ Wave 0 |
| FEED-02 | feed page is an index scan, ≤ 1 statement | pgTAP (`EXPLAIN`) + integration (`pg_stat_statements`) | `pnpm supabase test db`, `pnpm test:integration -t query-budget` | ❌ Wave 0 |
| FEED-03 | edit marks `edited_at`; soft delete hides the post and decrements counts | integration | `pnpm test:integration -t feed-edit-delete` | ❌ Wave 0 |
| FEED-04 | double like is idempotent (one row, one count, one event) | unit (service) + integration | `pnpm --filter @rede-social/module-feed test` | ❌ Wave 0 |
| FEED-04 | double-tap on the card likes once | e2e (mobile, iPhone 14 project) | `pnpm --filter @rede-social/web exec playwright test feed.spec.ts` | ❌ Wave 0 |
| FEED-05 | reply-to-a-reply refused **by the database** | pgTAP negative | `pnpm supabase test db` | ❌ Wave 0 |
| FEED-05 | the API maps 23503/23514 to `400 VALIDATION_FAILED` | integration | `pnpm test:integration -t comment-depth` | ❌ Wave 0 |
| FEED-06 | like/unlike a comment and a reply | integration | `pnpm test:integration -t comment-likes` | ❌ Wave 0 |
| FEED-07 | logged-out deep link → login → lands on `/post/[id]`; other tenant → 404 | e2e + integration isolation | `playwright test feed-share.spec.ts`; `pnpm test:integration -t isolation` | ❌ Wave 0 |
| FEED-08 | flipping `settings.postingPolicy` to `members` lets a member post, with **no migration** | integration | `pnpm test:integration -t posting-policy` | ❌ Wave 0 |
| MEDIA-04 | unfurl refuses a private IP, an IP literal, and a redirect to a private target; caps the body | unit (local fixture servers, no internet) | `pnpm --filter @rede-social/module-feed test -t unfurl-guard` | ❌ Wave 0 |
| MEDIA-04 | preview cached per tenant, reused on a second post | integration | `pnpm test:integration -t unfurl-cache` | ❌ Wave 0 |
| MOD-03 | every action emits its event **after commit**, once; a failed handler emits **none** | unit (bus) + integration | `pnpm --filter @rede-social/module-feed test -t events` | ❌ Wave 0 |
| UI-02 | comment sheet, infinite scroll, pull-to-refresh on a mobile viewport | e2e | `playwright test feed.spec.ts` | ❌ Wave 0 |
| TENANT-05 (gate) | cross-tenant read/write blocked per new table, each with its positive control | pgTAP 020 + integration isolation | `pnpm supabase test db`, `pnpm test:integration` | ✅ extend `supabase/tests/020-tenant-isolation.sql`, `apps/api/tests/integration/isolation.test.ts` |
| D-19 | `@rede-social/module-example` gone; boundary fixture retargeted; `example` no longer a module key | boundaries + unit + pgTAP | `pnpm boundaries && pnpm boundaries:negative`, `pnpm supabase test db` | ✅ files exist, contents change |

### Sampling Rate

- **Per task commit:** `pnpm --filter @rede-social/module-feed test && pnpm --filter @rede-social/api test`
- **Per wave merge:** `pnpm lint && pnpm turbo typecheck test && pnpm supabase test db && pnpm test:integration`
- **Phase gate:** `pnpm verify` green before `/gsd-verify-work`. Phase 3 baseline for comparison `[VERIFIED: STATE.md]`: *"pnpm verify is GREEN at 20m26s (unit 385, pgTAP 128, integration 313, e2e 271 passed/41 skipped, PWA 45/3)"*.

### Wave 0 Gaps

- [ ] `packages/modules/feed/vitest.config.ts` + `package.json` test script — the new package has no test runner yet
- [ ] `packages/modules/feed/tests/unfurl-guard.test.ts` — needs local `node:http` fixture servers (the shape used in this research)
- [ ] `apps/api/tests/integration/feed.test.ts`, `feed-query-budget.test.ts` — new
- [ ] `supabase/tests/0xx-feed.sql` — reply-depth negative, counter reconciliation, `EXPLAIN` plan assertions
- [ ] `supabase/tests/020-tenant-isolation.sql` — substitute feed tables for `example_items`, keeping the positive control per case
- [ ] `supabase/tests/030-lanes.sql` — substitute a feed table for `example_items`
- [ ] `apps/web/e2e/feed.spec.ts`, `feed-composer.spec.ts`, `feed-share.spec.ts` — mobile project; set `serviceWorkers: 'block'` on any spec that intercepts GET (03-05)
- [ ] `apps/web/e2e/phase4-smoke.spec.ts` — the per-phase smoke, extending 02-16's feed-tab witness with a real feed slot
- [ ] `scripts/seed.ts` — seeded posts of each media shape plus comments, replies and likes, in **both** demo tenants with identical-looking content (SCHEMA-CONVENTIONS §(j): *"Both files seed identical-looking data in the two tenants … on purpose"*)

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: "high"` `[VERIFIED: .planning/config.json]`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (reused) | `requireAuth` verifies the JWT against JWKS with `jose` and re-reads the membership row every request (Phase 1). Feed adds no auth surface |
| V3 Session Management | no (reused) | HttpOnly cookies via the Next BFF; feed routes carry `Authorization: Bearer` from `apiFetch` |
| V4 Access Control | **yes** | `requireAuth → requireModule('feed') → requireRole/permission` in that order; **object-level** access is RLS (`tenant_id = app.tenant_id()`), never an application comparison. A foreign post is a bare `404 NOT_FOUND` with **no `details` payload** — the D-23/T-03-19 rule that a details key would reintroduce an existence oracle |
| V5 Input Validation | **yes** | Zod at every route (`defaultHook` → `400 VALIDATION_FAILED` with `issues[]`); the cursor is validated by `cursorSchema` before anything reaches SQL; caption stored as plain text and auto-linked **at render time** (D-54) so there is no stored-HTML sink; `limit` clamped server-side |
| V6 Cryptography | no (reused) | Playback tokens are minted per request by the Phase 3 broker and must never be cached, persisted or logged (D-44) |
| V7 Error Handling & Logging | **yes** | One envelope `{ error: { code, message, details?, requestId } }`; log the *shape* of an action, never its content (T-03-24's precedent: "the SHAPE of the search, never its text") — a post caption and a comment body must not reach a log line |
| V12 Files & Resources | **yes** | Uploads never transit Cloud Run; private bucket, tenant-prefixed keys, magic-byte check at `complete`, `application/pdf` only for attachments; PDFs served with a short-TTL signed URL |
| V13 API & Web Service | **yes** | Rate/abuse: a member can comment and like without limit in V1 — flag as Phase 8 hardening, not a Phase 4 blocker |
| V14 Configuration | **yes** | No CSP exists today; the embed decision (A6) avoids adding a third-party frame before one does |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| **SSRF via the link unfurler** (GCP metadata at `169.254.169.254`, internal Cloud Run URLs, Supabase internal hosts) | Information Disclosure / EoP | The connector-pinned Agent in Code Example 1. **Both** halves: `net.isIP` literal check *and* the guarded `lookup`. Redirects and DNS rebinding are covered because every hop re-enters the connector |
| **Unbounded unfurl response** (billion-laughs-by-bytes) | Denial of Service | `Agent({ maxResponseSize: 512 * 1024 })` + `connectTimeout`/`headersTimeout`/`bodyTimeout` + OGS `timeout: 5` |
| **IDOR on `/post/[id]`** — enumerable UUIDs | Information Disclosure | RLS makes the foreign row invisible; bare 404 with no details; every "by id" read runs in the tenant lane |
| **Existence oracle via distinguishable errors** | Information Disclosure | Unknown id, foreign tenant, soft-deleted, and blocked-author cases all take the **same** 404 branch |
| **Stored XSS via caption or comment** | Tampering | Plain text storage (D-54); React escapes by default; auto-linking builds `<a>` elements, never `dangerouslySetInnerHTML`; `rel="noopener noreferrer nofollow" target="_blank"` on every auto-linked URL |
| **`javascript:` / `data:` URL smuggled into a caption or a link preview** | Tampering | `assertAllowedUrl` restricts to `http:`/`https:` at both the unfurl entry and the render-time auto-linker |
| **Cross-tenant like/comment write** | Tampering | `with check (tenant_id = app.tenant_id())` on every new table's policy; `tenant_id` from `ctx`, never from the body (the `createItem` rule T-07-01) |
| **Counter tampering / drift as a correctness bug** | Tampering | Counters written only by triggers; no API path writes them; pgTAP reconciliation assertion |
| **A blocked member keeps posting until their token expires** | EoP | `requireAuth` re-reads the membership row every request (the flags cache deliberately does **not** cache membership status) |
| **Third-party iframe in a private community** | Information Disclosure | Avoided entirely by A6's thumbnail-first embed; revisit behind a CSP in Phase 8 |
| **Job payload treated as authority** | EoP | The unfurl job's `tenantId` is **data**: the handler re-enters the tenant lane with it and RLS decides (the T-07-03 rule the example job documents) |

---

## Sources

### Primary (HIGH confidence)

- **This repository, read in full this session:** `packages/core/server/paging.ts`, `packages/core/server/events/bus.ts`, `packages/core/server/modules/manifest.ts`, `packages/core/server/modules/flags-cache.ts`, `packages/core/server/modules/require-module.ts`, `packages/core/server/rbac/require-role.ts`, `packages/core/db/tenant-tx.ts`, `packages/core/db/rls.ts`, `packages/core/db/client.ts`, `packages/core/db/schema/tenant-modules.ts`, `packages/core/docs/SCHEMA-CONVENTIONS.md`, `packages/core/server/profiles/service.ts` (`listMembers`, `getMemberProfile`), `packages/core/server/profiles/search.ts`, `packages/core/server/media/service.ts` (`listAssets`), `packages/contracts/src/{events,errors,modules,bootstrap,media,profiles}.ts`, `packages/modules/example/**`, `packages/boundary-fixture/src/index.ts`, `packages/ui/src/index.ts`, `packages/ui/src/layout/{ScrollContainerContext,PullToRefresh}.tsx`, `apps/api/src/{app.ts,worker.ts,modules/registry.ts}`, `apps/web/lib/{api,registry,media,profile}.ts(x)`, `apps/web/app/(app)/inicio/page.tsx`, `apps/web/next.config.ts`, `supabase/migrations/2026091*_{auth_user_mirror,member_profiles_search}.sql`, `package.json` / `apps/api/package.json` / `packages/core/package.json`
- **Live probes against this project's local Postgres** (container `supabase_db_rede-social`): the composite self-FK one-level constraint (3 refusal paths), `pg_extension` / `pg_settings` inventory, `pg_stat_statements_reset()` + normalisation behaviour
- **Live probes against `undici@7.29.1` + `open-graph-scraper@6.12.0`** (isolated in `/tmp`): `lookup`-only guard bypass by IP literal, connector-level block across hops, `maxResponseSize` abort
- `open-graph-scraper@6.12.0` package contents (`dist/esm/lib/request.js`, `types/lib/types.d.ts`) — `undici.fetch`, `fetchOptions` spread, unbounded `arrayBuffer()`, `blacklist`/`timeout`/`urlValidatorSettings` options
- `undici@7.29.1` type definitions (`agent.d.ts`, `pool.d.ts`, `client.d.ts`, `connector.d.ts`) — `connect?: Partial<BuildOptions> | connector`, `maxResponseSize?: number`
- `@types/node@24.13.4` (`net.d.ts:20-30, 51-67, 767-827`) — `LookupFunction`, `TcpSocketConnectOpts.lookup`, `net.BlockList`
- `postgres@3.4.9` types (`index.d.ts:78`) — the `debug` hook
- `.planning/` project documents: `REQUIREMENTS.md`, `STATE.md`, `research/PITFALLS.md` (§9, §10, §11, Performance Traps, Security Mistakes), `research/PROTOTYPE.md` (§5, §6, §7), `research/STACK.md` (§4)
- `reference/frontend-design/components/{feed,comments,create}/*.tsx` — read in full

### Secondary (MEDIAN confidence)

- `gsd-tools query package-legitimacy check --ecosystem npm open-graph-scraper undici` — registry age, weekly downloads, repo URL, postinstall
- `npm view open-graph-scraper version time.modified dependencies engines`

### Tertiary (LOW confidence)

- None. No claim in this document rests on a web search.

---

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — every library except `open-graph-scraper` is already installed at a pinned version read from `package.json` this session; OGS is the CLAUDE.md-named package and was verified on the registry and by reading its shipped source
- **Architecture:** HIGH — every pattern is a named, quoted precedent in this repo, and the two genuinely new mechanisms (the declarative depth constraint, the connector-pinned Agent) were executed and their output pasted
- **Pitfalls:** HIGH for the three verified ones (IP-literal bypass, unbounded body, `track_utility` inflation of the budget); MEDIUM for the counter/soft-delete interaction and the drizzle-kit composite-FK emission, both logged as assumptions with cheap fallbacks
- **Security:** HIGH — ASVS L1 categories mapped against the actual route chain and RLS policies in the tree; the SSRF section is the falsified part

**Research date:** 2026-09-22
**Valid until:** 2026-10-22 (30 days). The in-repo findings do not expire; re-check `open-graph-scraper` and `undici` versions at install time, and re-run the guard probes if either major version changes.
