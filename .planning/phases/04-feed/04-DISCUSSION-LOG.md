# Phase 4: Feed - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-22
**Phase:** 04-feed
**Areas offered:** Post anatomy, Feed placement, Comments and replies, Links and embeds
**Areas discussed:** Post anatomy, Feed placement, Comments and replies
**Area declined:** Links and embeds (MEDIA-04) — left to Claude's discretion

---

## Post anatomy

### Does a post have a title and a type chip?

| Option | Description | Selected |
|--------|-------------|----------|
| No title, no chip | One model: caption text + media, as the prototype's `PostCard` already is. Closes PROTOTYPE.md open question 2 with "drop titles/types". Same card serves feed and Phase 5 communities. | ✓ |
| Optional title on every post | Nullable `title` column; composer shows an optional field; card renders it bold above the text. Phase 5 community posts get it without new schema. | |
| Title + type chip | Title plus a per-post category chip (Discussão / Aviso / Exclusivo), as the prototype does in communities. Adds visual hierarchy and later filtering. | |

**User's choice:** No title, no chip
**Notes:** This is the V1 answer to PROTOTYPE.md open question 2 and should be taken back to the design team, together with open question 3 (the composer designs).

### Who is shown as the post author?

| Option | Description | Selected |
|--------|-------------|----------|
| The community (brand) | Tenant logo + display name in the header, like an institutional page. `author_user_id` still stored but not displayed. Reinforces the Core Value and hides who the admin is. | |
| The person (admin) | Admin's photo + name, linking to their profile. More personal; V2 member posting looks identical. Reveals who administers the community. | ✓ |
| Brand + discreet byline | Tenant header plus "por Fulano" in smaller text. Both readings, at the cost of a denser card. | |

**User's choice:** The person (admin)
**Notes:** Flagged during the discussion that this makes staff profiles reachable from feed content — D-47 already permits it (staff hidden from the directory, profile openable by direct link) — and that it does not conflict with D-45, which banned a role *badge*, not authorship.

### What media can coexist in one post?

| Option | Description | Selected |
|--------|-------------|----------|
| Gallery OR video, + attachments | Either an image carousel or one video, never both, plus optional link/embed and files. Keeps `PostImage` intact; avoids a `<mux-player>` inside a swipe carousel. | ✓ |
| Everything mixed freely | Images, video, link and attachments in any mix, admin-ordered. Maximum editorial freedom; heterogeneous carousel with per-slide autoplay and a reordering composer. | |
| One media kind per post | Each post is images, or video, or link, or file. Simplest, but contradicts FEED-01's "any combination". | |

**User's choice:** Gallery OR video, + link/attachments

### How does post text behave?

| Option | Description | Selected |
|--------|-------------|----------|
| Plain text + clickable links | Newlines preserved, URLs auto-linked at render time (not stored as HTML). No bold, no markdown, no mentions. Keeps `PostCaption`'s "… mais" and removes the XSS surface. | ✓ |
| Light rich text | Bold, italic, lists, linked text via an editor. Good for long structured announcements; needs a new editor component, server sanitisation and a storage format Phases 5 and 7 inherit. | |
| Plain text, no autolink | Newlines only; a pasted URL stays text. Most predictable, worst for a link the admin pastes without an embed. | |

**User's choice:** Plain text + clickable links

**Continuation:** Moved to the next area. Numeric limits, drafts and the video "processando" state in the composer were explicitly left to Claude.

---

## Feed placement

### Where does the member see the feed?

| Option | Description | Selected |
|--------|-------------|----------|
| Home slot on `/inicio` | The feed module registers a widget through the D-42 home-slot mechanism; the post list is the main content of the home. No new tab; the nav budget stays for Comunidades, Eventos, Perfil. | ✓ |
| Own `/feed` tab | Feed gets its own route and tab; `/inicio` becomes a shortcuts/highlights home. Clean separation, but consumes a BottomNav slot D-40 already tightens. | |
| `/inicio` is the feed, `/feed` redirects | Same visual result as the first option plus a redirect route for old links — of which there are none in an unlaunched product. | |

**User's choice:** Home slot on `/inicio`
**Notes:** Amends D-40, which had pencilled `feed` as an "Início" tab.

### What screen does a post deep link open?

| Option | Description | Selected |
|--------|-------------|----------|
| Own `/post/[id]` page | Dedicated route as in the prototype: full `PostCard` + inline comments, sticky back header, server-rendered. Natural share target, and the Phase 7 notification destination. | ✓ |
| Modal over the feed | Link opens `/inicio` with the post in an intercepted-route overlay. Keeps feed context; needs parallel routes and still has to handle "arrived straight from the link". | |
| Anchor in the feed | Link scrolls the feed to the post. No new screen, but with keyset pagination an old post may be many pages away. | |

**User's choice:** Own `/post/[id]` page

### How does the admin reach the composer?

| Option | Description | Selected |
|--------|-------------|----------|
| FAB on `/inicio` + `/criar` route | Admin-only floating button over the feed, navigating to a full-screen composer. Full screen fits multi-image pick, upload waiting, link preview and PDF attach; `/post/[id]/editar` reuses the form. | ✓ |
| Bottom sheet over the feed | FAB opens a sheet using the already-ported `BottomSheet`. Lighter, keeps context; fights the mobile keyboard and can be dismissed mid-upload. | |
| Admin nav tab | A "Publicar" nav item visible only to `admin_tenant`. Always at hand, but consumes nav budget and makes navigation shape-shift by role. | |

**User's choice:** FAB on `/inicio` + `/criar` route
**Notes:** Both screens are prototype-less and go through the D-33 UI-SPEC + mockup review before being coded.

### How does the feed load?

| Option | Description | Selected |
|--------|-------------|----------|
| Infinite scroll + pull-to-refresh | What roadmap criterion 2 names and what the prototype already implements (`InfiniteScroll` sentinel + `useInfiniteScroll`); its hardcoded `#app-scroll` IO root becomes a prop. | ✓ |
| "Carregar mais" button | Explicit pagination, like the Phase 3 member directory. More predictable and testable, but contradicts criterion 2. | |

**User's choice:** Infinite scroll + pull-to-refresh

**Continuation:** Moved to the next area. Page size, empty states and skeletons left to Claude.

---

## Comments and replies

### Where do comments appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Sheet in the feed, inline on the post | Both, as the prototype does: `CommentSheet` from the card, the same list inline on `/post/[id]`. One list implementation, two containers. Matches criterion 2's "ported PostCard / CommentSheet interactions". | ✓ |
| Only on the post page | The comment icon navigates to `/post/[id]`. One surface, less state, easier offline — but throws away the fastest interaction in the app and the sheet already built. | |
| Only the sheet | Comments always in a sheet, even on the post page. Fully consistent, but a shared link to a busy post opens with no comments visible. | |

**User's choice:** Sheet in the feed, inline on the post

### How do one-level replies behave in the list?

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsed: "Ver N respostas" | Root shows the count; replies load on tap — the toggle `CommentItem` already has. Keeps the list readable and the page's query count bounded (criterion 4). | ✓ |
| Always expanded | Replies indented under the parent, all at once. More readable at a glance; a 40-reply comment dominates the screen and root pagination becomes unpredictable. | |
| First 2 + "ver mais" | Previews two replies per root. Middle ground, but needs a lateral join — the most expensive of the three for the query budget. | |

**User's choice:** Collapsed: "Ver N respostas"

### Can the author delete their own comment?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, delete own | Soft delete on the same `deleted_at` column Phase 8's MODER-01 moderates with — same route, one more permission. Baseline social-network expectation. | ✓ |
| Nothing in V1 | Published comments are permanent until Phase 8 moderation. Less surface now; a typo stays up for the whole pilot. | |
| Delete and edit own | Also edit, with an "editado" marker, symmetric with FEED-03. Adds edit history and the question of replies to a changed comment — neither in the V1 requirements. | |

**User's choice:** Yes, delete own (no comment editing in V1)

### In what order do comments appear?

| Option | Description | Selected |
|--------|-------------|----------|
| Oldest first | Conversation reads top-down; a new comment lands at the bottom where the fixed `CommentInput` is. Ascending keyset by `created_at`. | |
| Newest first | Latest comment on top, like the post feed. Whoever opens sees what is new. Breaks thread reading and pushes a just-sent comment away from the input. | ✓ |
| Most liked first | Engagement ordering with date tiebreak. Unstable under keyset pagination — needs a much more expensive cursor. | |

**User's choice:** Newest first

### And inside a thread, when the member taps "Ver N respostas"?

| Option | Description | Selected |
|--------|-------------|----------|
| Replies chronological | Newest root on top, but replies old→new inside each root. The Instagram/YouTube behaviour: the list ranks threads, each thread reads forward. Two cursor directions over two distinct queries. | ✓ |
| Replies also newest first | One direction everywhere, one cursor, nothing to explain in review — but a 6-reply thread reads backwards. | |

**User's choice:** Replies chronological
**Notes:** This follow-up was raised because "newest first" on roots created a direct consequence for reply ordering.

---

## Claude's Discretion

- **Links, embeds and attachments (MEDIA-04)** — the whole area, declined for discussion: synchronous unfurl at create time versus a worker job, the failure/timeout rendering, whether the admin can override a resolved preview, YouTube/Vimeo as sandboxed iframe versus thumbnail, the SSRF guard, the `link_previews` cache, and how a PDF renders in the card.
- **Edit and soft delete (FEED-03)** — what "editado" covers, whether media can be swapped, whether an edit window exists, and what a soft-deleted post leaves behind (comments, share link, media assets).
- **Numeric limits** — images per post, caption length, attachment count, video duration, anchored to the Phase 3 `MEDIA_LIMITS`.
- **Domain events** — names, payload shapes and the test subscriber (MOD-03, criterion 4), declared through the `EventMap` extension point.
- **FEED-08 posting policy shape** — column on `tenants`, `tenant_modules` setting, or permission row; must make V2 member posting a value change.
- **Likes and comments schema** — nullable FKs + partial unique indexes versus separate tables, the reserved `story_id` slot, trigger-maintained counters, like-toggle idempotency, and whether "quem curtiu" exists at all.
- **Feed query shape** — ordering expression and index, page size, and how the bounded-query-count check is expressed in CI.
- **UI leftovers** — empty states, skeletons, whether the D-02 profile nudge stays above a populated feed, desktop composition under D-39, and the share implementation (`navigator.share` + copy fallback).
- **Module layout** — `@tria/module-feed` against the example template, and the removal of `@tria/module-example` (D-19) with its registry key, seed rows and boundary-lint fixture.
- **Test strategy** — isolation suite extension, reply-depth negative test, cross-tenant deep-link 404, and mobile Playwright coverage for double-tap, sheet, infinite scroll and pull-to-refresh.

## Deferred Ideas

- Member mentions (@) in posts and comments — V2, alongside member posting.
- Rich text / markdown in posts.
- Post type chips and filtering by type.
- Editing a comment after posting.
- Sorting comments by likes ("mais relevantes").
- "Quem curtiu" lists.
- Bookmark/save on posts (the prototype's `onSave` / `useBookmark` — do not port).
- Mixing video into an image carousel.
- Feed as its own tab / `/feed` route — re-openable in Phase 5 or 6 if the home slot gets crowded.
- Pinned community posts (V2-CONT-03) and community-scoped feeds — Phase 5.
- Scheduled publishing and drafts.
