# Phase 9: Rede Social - Follow, Member Posts and Explorar - Research

**Researched:** 2026-10-19
**Domain:** Multi-tenant authorization (visibility gate over member-authored content), follow graph, keyset feed query, module-conditional permissions, bounded member media, moderation log extension
**Confidence:** HIGH on the codebase mapping and the architecture (every seam was read this session); MEDIUM on query-plan behaviour (to be measured in Wave 0, not assumed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Decision numbers continue after 08.7's D-465. UI decisions in this phase's UI-SPEC continue after UI-D-490.

#### Carried forward (locked before this discussion, do not re-open)
- **D-45 [informational] (Phase 3):** another member's profile shows photo, display name and bio only, enforced by `memberProfileSchema.strict()` in `packages/contracts/src/profiles.ts`. Roadmap criterion 5 reverses it only while `social` is on and only for members (D-467 keeps it for staff).
- **261016-jsq [informational] (quick):** `GET /v1/members` is staff-only; `GET /v1/members/{id}` (the profile opened by a name) stays open to members. D-466 reopens the list for members under `social`.
- **D-117 / D-118 [informational] (05.3):** the first Reels lane "Todos" holds every video Reels can show; lanes after it are communities. D-480 keeps that meaning.
- **D-124 [informational] (05.3, reversed 2026-10-09):** one tap on a feed video opens `ReelsOverlay` over the feed at that video, with a return arrow to the same place.
- **D-419 [informational] (08.5):** the BottomNav holds five tabs; a module that needs a sixth makes another yield to the TopBar. D-479 avoids a new tab.
- **D-23 / TENANT-04 [informational]:** a post that is unknown, another tenant's or removed answers one bare 404 with no distinguishing code.
- **T-04-54 [informational] (Phase 4):** edit and delete of a post are decided by `author_user_id = ctx.userId` in the statement, not by a role. This already makes them author-only for members.
- **D-462 [informational] (08.7):** named lists of people are never open to everyone; precedent for D-468.
- **D-121 [informational] (05.3):** a module that builds on another (`reels` on `feed`) contributes nothing while the base is off. `social` follows the same rule.

#### Following and finding people
- **D-466:** `/membros` reopens to role `member`, only while `social` is on for the caller's tenant. `GET /v1/members` (with or without `?q=`, `cursor`, `limit`) then accepts `member`; with `social` off it stays staff-only (403 `FORBIDDEN`) exactly as in 261016-jsq. The page reuses `MembersList` (search by name, 25 per page). Explorar carries an "Encontrar pessoas" entry to it, and the empty state of criterion 4 points to it. PROF-03 and criterion 4 of the roadmap are reworded at planning (08.7's deferred note).
- **D-467:** the follow graph is member to member only. `admin_tenant` and `support_tenant` are outside it: no Seguir button and no counts on their profile (D-45 holds for them), they follow no one, they cannot be followed, and the member-facing directory lists members only. The API refuses a follow whose follower or target is not a live `member` of the tenant, and a self-follow.
- **D-468:** counts are public, lists are private. Any member sees the follower and following counts on any member's profile (criterion 5). Only the owner opens their own "Seguidores" and "Seguindo" lists, and unfollows from "Seguindo". There is no route that takes another member's id for a list; the user comes from the session, as in D-463. Opening lists to everyone later is easy, closing them is not, so they start private.
- **D-469:** a member post opened by someone who is not allowed to see it is a locked answer, not a 404. The caller is not the author, does not follow the author and is not holder of `moderation.manage`. The API returns the author's display name and avatar only; caption, media, counts and comments never leave the server. The web shows a "Siga para ver" screen with the Seguir button, and following opens the post. Likes, comment reads and comment writes on that post follow the same gate. An unknown id, another tenant's id, a removed post, a blocked author's post (D-484) and `social` off (D-483) stay the bare 404.
- **D-470:** the Seguir/Seguindo button appears on the member profile (next to the counts), on the "Siga para ver" screen and on each row of `/membros` (the prototype's `UserListItem`). It does not appear in comment rows, post headers or the Reels rail: posts in Explorar and member videos in Reels already come from followed people.

#### Own posts and the composer
- **D-471:** a member's own posts appear in their own Explorar, mixed with the followed people's by `(created_at, id)`, newest first. There is no "Minhas publicações" list and no profile feed. Edit and delete come from the card's `PostMenu`. The author's own videos also appear in Reels "Todos" (D-480).
- **D-472:** a member publishes from Explorar only. `ComposeFab` shows in Explorar for role `member` while `social` is on, and the member lands on top of Explorar after publishing. Início keeps the button for `admin_tenant` only, so nobody publishes from Início a post that Início would not show.
- **D-473:** a member post carries a caption, photos, at most one video (only where the tenant allows it) and a link with its usual preview. It carries no attachment (PDF) and no community: the post is born with `community_id` null. The API refuses `attachments` and `communityId` from a member with a validation code, not only through a hidden control. Phase 10 decides who publishes into a community.
- **D-474:** member media limits live in `tenant_modules['social'].settings` and are edited per tenant by `super_admin` in the platform panel, the seam `postingPolicy` used. Defaults: photos 5 MB each and 4 per post; video off; when `super_admin` turns video on, 60 s and 100 MB. The limits apply to new uploads only: lowering one or turning video off removes and hides nothing already published. There is no per-member quota (daily posts or storage) in this phase; the general API rate limit applies and a quota is revisited if the pilot shows abuse.

#### Safety net until Phase 11
- **D-475:** removal of member posts is pulled forward from MODER-04, posts only. A holder of `moderation.manage` (today `admin_tenant` only) sees in Explorar every live member post of the tenant without following anyone, and soft-deletes any of them (`deleted_at`, `deleted_by`) with a `moderation_log` entry in the same transaction, the author not told, the same shape as MODER-01's comment removal. The reports queue, member stories, communities and "block author from a report" stay in Phase 11. MODER-04 is split in REQUIREMENTS.md at planning. `support_tenant` does not hold `moderation.manage`, so it gets neither the staff Explorar nor the removal.
- **D-476:** a member's post notifies nobody. `post.published` for a member-authored post produces no intent, so the all-members broadcast (`feed.post`, `feed.reel`) stays admin-only and no new post kind is added. Phase 11 decides whether followers are told, together with "started following you" (Phase 11 criterion 3 is answered "nobody" until then).
- **D-477:** the author of a member post is told when someone comments on it. A new kind `feed.post_commented` goes through the Phase 7 fan-out on channels `['in_app','push']`, for first-level comments only, on member-authored posts only, the commenter excluded. A like does not notify (grouping is V2-NOTIF-02). It is retracted on comment or post deletion by the existing keep-and-mark path. Admin posts keep today's behaviour. — **Reversibility:** costly — notification kinds are stored strings, and producers and consumers grow around them (as D-448).
- **D-478:** terms, rules and privacy are a go-live item, not a code gate. `DEPLOY.md` gets a "turning on `social`" item (review of the platform terms, the tenant rules and the privacy policy for third-party content and liability), and the platform panel asks `super_admin` to confirm when turning `social` on, pointing to that item. Members see no re-acceptance screen; the admin edits the tenant rules (AUTH-04). Pending, not code: the legal wording. Flag it to the user before `social` is turned on for any tenant.

#### Navigation
- **D-479:** Explorar is a chip beside Início. Início and Explorar are two chips on the same area (the `?aba=` pattern of `/cursos`, `HubTabs` and `tabs.ts`), shown while `social` is on to role `member` and to holders of `moderation.manage`. The BottomNav and TopBar do not change. Explorar opens clean: chip row, feed, empty states. It has no welcome block and no stories strip (Phase 10 adds the member story row). With `social` off there are no chips and Início is exactly today's. Whether Explorar is `/inicio?aba=explorar` or its own route is the planner's call, as long as links from notices and shares stay stable.

#### Reels
- **D-480:** member videos join "Todos" by date. "Todos" keeps its D-117 meaning: admin videos, the videos of people the viewer follows and the viewer's own, newest first on the `(created_at, id)` cursor. There is no new lane. A member video has no community, so it appears in "Todos" only and shows no community chip. Likes and comments are the feed's own (criterion 7). Holders of `moderation.manage` see the member videos in Explorar, not in Reels.
- **D-481:** tapping a video in Explorar opens `ReelsOverlay` at that video, with the return arrow to the same place in Explorar, as in Início (D-124). The queue is "Todos", which now includes the followed videos, so the tapped video is always in it.

#### Roles and on/off
- **D-482:** only `member` takes part. `member` publishes, follows and is followed. `admin_tenant` keeps publishing through today's path into Início, and a second `admin_tenant` is the organization's voice too. `support_tenant` gets no member composer. `permissionsFor` in `apps/api/src/modules/registry.ts` stops reading `feed.settings.postingPolicy`: `feed.post.create` for `member` comes from `social` being on, and the flag is removed or ignored. `social` requires `feed`, joins `TOGGLEABLE_MODULES` and the `tenant_modules_key_chk` constraint, and is off by default for new and existing tenants. — **Reversibility:** costly — the new key lands in a check constraint through a migration, in the API and web registries and in the registry test lists; folding it back needs a second migration (as D-121).
- **D-483:** off hides everything, on brings it back. With `social` off the Explorar chip, the member composer, the follow routes, the profile counts (the profile is D-45's again), `/membros` for members, and every member post, member video, post link and comment thread on a member post answer the bare 404. A saved link or an old notice that points to a member post opens the usual not-found. Nothing is deleted; posts and follows return when `social` is turned on again. Início and admin videos in Reels are untouched.
- **D-484:** a member the admin blocked disappears until unblocked. While `memberships.blocked_at` is set (or the membership is soft-deleted), that member's posts and videos leave Explorar, Reels and the post link (bare 404), and the member leaves the directory, the follower and following counts and the lists. Nothing is deleted; unblocking restores everything, followers included.

### Claude's Discretion
Each item has a stated default. The planner may refine it but should not reverse it without asking.

**Follow model**
- Following is one-directional, instant and needs no approval. Follow and unfollow are idempotent; one row per (tenant, follower, followee); a follow is read by the tenant's RLS only.
- The follow table, its indexes and its RLS are the planner's, under the usual rules: `tenant_id` first in every index, RLS on, pgTAP cross-tenant negatives, and every new route in the two-tenant isolation inventory.

**Profile with `social` on**
- Another member's profile shows the Seguir/Seguindo button and the two counts "Seguidores" and "Seguindo". No post count (there is no profile feed) and no "Mensagem" (Phase 11). The own profile (`/perfil`) shows the two counts as links to the private lists.
- The base `memberProfileSchema` stays `.strict()`; the social fields come from a separate variant, so the contract test that feeds it a `role` key still fails.

**Explorar content and states**
- Explorar lists live posts with `community_id` null authored by followed members and by the viewer, newest first, keyset on `(created_at, id)`, with the feed's like, comment and share. Admin posts are not in it (they live in Início). For a holder of `moderation.manage` it lists every live member post.
- Two empty states, copy decided in the UI-SPEC: the viewer follows nobody and has no post (points to "Encontrar pessoas" on `/membros`, criterion 4), and the viewer follows people who have not posted yet.
- The query reuses `postProjection` and `feedPage` with one more predicate and must keep `FEED_LIST_STATEMENT_BUDGET = 1`. The follow join versus a fan-out table is a research item (roadmap). The same visibility gate (D-469) applies to the post page, likes and comments.
- "Início shows only `admin_tenant` posts" is decided from the author's role at read time through the memberships join the projection already has, unless research finds a reason to stamp it.

**Media enforcement**
- Photo size and count are checked at the upload intent and at publish. A video's duration is only known after upload, so the enforcement point (Mux asset-ready check versus client metadata) is a research item; a video over the limit must not publish.
- A member whose tenant has video off does not see the video control at all.

**Roles and rollout**
- The seed enables `social` on at least one tenant so the two-tenant isolation suite and the e2e can exercise it; the real tenant stays off.
- The Admin badge on a post (`apps/web/lib/feed-view.tsx`, today dropped when `postingPolicy` is `members`) follows `social` instead.

### Deferred Ideas (OUT OF SCOPE)
- **Follower notices** (a member's post notifying followers, "started following you"), **direct messages** ("Enviar mensagem" on the profile), **member-to-member blocking**, **reports and the reports queue**, and the rest of MODER-04 (member stories, communities): Phase 11.
- **Member stories and member-created communities**, and creator-only publishing in a community: Phase 10. Explorar's story row arrives with it.
- **Per-member quotas** (daily posts or stored MB): revisit if the pilot shows abuse or the 1 GB of Supabase Free is near (D-474).
- **Open follower/following lists** (visible to everyone, or to staff): declined for now (D-468).
- **A "Minhas publicações" list or any profile feed**: declined (D-471; user decision 2026-09-25 stands).
- **A "Seguindo" Reels lane** and a "Pessoas" search inside Explorar: declined in favour of mixing into "Todos" (D-480) and reopening `/membros` (D-466).
- **A re-acceptance screen for terms and rules** when `social` is turned on: declined for a go-live item (D-478); revisit with the legal review.
- **PDF attachments from members**: admin only for now (D-473).
- **Like notices on a member post, and grouped notices**: V2-NOTIF-02 (D-477).
- **A "new posts" dot on the Explorar chip**: not in this phase.
- **Staff browsing followers or lists** (like the admin-only named lists of D-462): not in this phase.
- **Requirement and roadmap rewording at planning:** PROF-03 (members browse the directory only with `social` on), roadmap criterion 4 (the directory pointer), MODER-04 (split: posts in Phase 9, the rest in Phase 11), Phase 11 criterion 3 (follower notices answered "nobody until then"), and the new SOCIAL-*/FOLLOW-*/EXPL-* requirements.
</user_constraints>

<phase_requirements>
## Phase Requirements

The roadmap lists the IDs as "TBD (new SOCIAL-*, FOLLOW-*, EXPL-*); promotes V2-CONT-01". These are the **draft statements** for REQUIREMENTS.md (append a `### Rede Social` block after `### Tenant Insights`, flip V2-CONT-01 to "promoted to Phase 9 (done)", and split MODER-04). "SC" is the ROADMAP § Phase 9 success criterion number; "D-" is a CONTEXT decision. The spec-less probe should trace plans against these sentences.

| ID | Draft requirement text | SC | CONTEXT | Research support |
|----|------------------------|----|---------|------------------|
| SOCIAL-01 | A `social` feature module (package `@rede-social/module-social`, a registry entry in both apps, key appended LAST to `TOGGLEABLE_MODULES`, `requires: ['feed']`) is turned on or off per tenant by `super_admin`; it is off for existing tenants (no backfill row), off by default for new ones (absent from `REAL_TENANT_DEFAULT_MODULES`), and the platform panel asks for a confirmation pointing to the DEPLOY.md "turning on `social`" item when enabling it. While it is off, or while `feed` is off, it contributes no bootstrap entry, no permission and no route (`404 MODULE_DISABLED`). | 1 | D-478, D-482, D-121 | Pattern 1; Pitfall 12; Environment: `requireModule` does not enforce `requires` |
| SOCIAL-02 | The composed permission set is the single switch for member authoring: with `social` effective, role `member` holds `feed.post.create`, `feed.post.manage` and `social.participate`; `feed.settings.postingPolicy` is no longer read (FEED-08 superseded). The organization-voice surfaces (Início composer, community composer, Reels empty-state CTA, `/criar` community picker and attachments) stay admin-only: `support_tenant` holds none of it. | 1, 3 | D-472, D-482 | Pattern 5; Pitfall 1 |
| SOCIAL-03 | A member post carries a caption, up to the tenant's photo count, at most one video (only when the tenant allows it) and a link with its usual preview. The API refuses `attachmentAssetIds` and `communityId` from a member with a validation code, the post is born with `community_id` null and `visibility = 'followers'`, and edit/delete are author-only (`author_user_id = ctx.userId` in the statement). | 3 | D-471, D-473, T-04-54 | Pattern 3 |
| SOCIAL-04 | Início (`GET /v1/feed` with no scope), a community's page and the Reels lanes list only organization-voice posts (`visibility = 'tenant'`, authored by `admin_tenant`); a member post is never in them, even for a viewer who follows its author. Reels "Todos" additionally lists the videos of the viewer's followees and the viewer's own. | 3, 7 | D-480, Discretion | Pattern 2; Pitfall 3 |
| SOCIAL-05 | Member media limits (photo bytes, photos per post, video on/off, video seconds and bytes) live in `tenant_modules['social'].settings`, are edited per tenant by `super_admin` from the platform panel, default to 5 MiB / 4 / off / 60 s / 100 MiB, are capped by the admin limits, are enforced at the upload intent, at `complete` and at publish (a member post's video must be `ready`, so its duration was judged), and apply to new uploads only. | 6 | D-474 | Pattern 4; Pitfall 9, 10 |
| SOCIAL-06 | A member post, its likes, its comment reads and writes and its video playback are readable only by its author, by the author's followers and by a holder of `moderation.manage`. For a `member` caller who is none of those the post read answers `403 FORBIDDEN { access: 'follow_required', author }` (display name, avatar and membership id only) and the like/comment routes answer `403 FORBIDDEN { access: 'follow_required' }`; every other miss (unknown, other tenant, removed, blocked author, `social` off) is the bare 404. The gate is enforced in the statement AND by a restrictive RLS policy. | 3, 5 | D-469, D-483, D-484 | Pattern 2, 6 |
| SOCIAL-07 | A holder of `moderation.manage` sees every live member post in Explorar and soft-deletes any of them (`deleted_at`, `deleted_by_user_id`) with a `moderation_log` row (`action = 'post_removed'`, `subject_type = 'feed_post'`) written in the same transaction; the author is not told; an admin post stays author-only. MODER-04 is split: member posts here, member stories, communities and "block author" in Phase 11. | 3 | D-475 | Pattern 7 |
| SOCIAL-08 | A member post produces no notification intent. A first-level comment on a member-authored post notifies the post's author (kind `feed.post_commented`, channels `in_app` + `push`, commenter excluded, retracted on comment or post deletion); a like notifies nobody; admin posts keep today's fan-out. | 3 | D-476, D-477 | Pattern 8 |
| SOCIAL-09 | While a member's membership is blocked or soft-deleted, their posts and videos leave Explorar, Reels and the post link, and they leave the directory, the counts and the lists; unblocking restores all of it, followers included. Turning `social` off hides every member post, video, link and thread and deletes nothing; turning it on restores them. | 1, 3 | D-483, D-484 | Pattern 2; Pitfall 8 |
| SOCIAL-10 | The two-tenant isolation suite covers every new route (inventory entry, case, wrong-host 403), the new table (pgTAP policy blocks and the 010/020/160 lists), the gate truth table, the follower/non-follower/staff/moderator matrix and the shared identity; migrations are expand-only and ship before the API; `pnpm db:generate` prints "No schema changes"; the module README carries the MOD-05 headings; `docs/DEPLOY.md` carries the release order and the "turning on `social`" item; the seed enables `social` on one tenant. | 2 | D-478 | Validation Architecture |
| FOLLOW-01 | With `social` on, a `member` follows and unfollows another member of the same tenant (one-directional, instant, no approval, idempotent, one row per `(tenant, follower, followee)`); `PUT`/`DELETE /v1/social/follows/{membershipId}` answer the current `{ following, followerCount }` and a repeat is never a 409. | 2 | Discretion | Pattern 1 |
| FOLLOW-02 | The follow graph is member to member only: the API refuses a self-follow (`400 VALIDATION_FAILED`), a follower that is not a live `member` (`403 FORBIDDEN`) and a target that is unknown, of another tenant, staff, blocked or removed (the bare 404); following never crosses tenants (RLS + composite checks + pgTAP negatives). | 2 | D-467 | Pattern 1; Security |
| FOLLOW-03 | Follower and following counts are readable by every member on any member's profile; the lists are private: `GET /v1/social/me/followers` and `/me/following` read the session's own rows, there is no route that takes another member's id for a list, and the owner unfollows from "Seguindo". Blocked and removed members are absent from counts and lists. | 5 | D-468, D-484 | Pattern 1 |
| FOLLOW-04 | With `social` on, another member's profile shows the Seguir/Seguindo button and the two counts, from a social variant (`GET /v1/social/members/{membershipId}`); the base `memberProfileSchema` stays `.strict()` and unchanged; a staff profile, the caller's own profile and every profile with `social` off are exactly D-45's. | 5 | D-45, D-467, D-470 | Pattern 1 |
| FOLLOW-05 | The Seguir/Seguindo control appears on the member profile, on the "Siga para ver" screen and on each `/membros` row, and nowhere else (not in comment rows, post headers or the Reels rail). | 5 | D-470 | Architecture (web) |
| FOLLOW-06 | `/membros` and `GET /v1/members` open to role `member` only while `social` is effective for the caller's tenant (staff always); with `social` off a member keeps getting `403 FORBIDDEN` before the query is validated; a member sees members only (never staff) and never a blocked or removed one. PROF-03 is reworded accordingly. | 4, 5 | D-466 | Pitfall 13 |
| EXPL-01 | Explorar is a second chip beside Início on `/inicio` (`?aba=explorar`), shown while `social` is effective to a `member` and to a holder of `moderation.manage`; the BottomNav and TopBar do not change; Explorar opens with the chip row, the feed and the empty states only (no stories strip, no welcome block); with `social` off there are no chips and Início is exactly today's. | 1, 4 | D-479 | Architecture (web) |
| EXPL-02 | Explorar lists live posts with `community_id` null, `visibility = 'followers'`, authored by the viewer's followees (live, not blocked) and by the viewer, newest first on the `(created_at, id)` keyset, in ONE statement (`FEED_LIST_STATEMENT_BUDGET = 1`), served by a named partial index (no Seq Scan on a volume fixture); admin posts are not in it. | 3, 4 | D-471 | Pattern 2; Wave 0 spike |
| EXPL-03 | Explorar posts carry the feed's like, comment thread and share; edit and delete come from the card's `PostMenu` (author: own; moderator: moderation removal); there is no personal or profile feed and no "Minhas publicações". | 3, 4 | D-471 | Pattern 3, 7 |
| EXPL-04 | Explorar has two empty states: the viewer follows nobody and has no post (points to "Encontrar pessoas" on `/membros`), and the viewer follows people who have not posted yet. | 4 | D-466 | Architecture (web) |
| EXPL-05 | `ComposeFab` and the `/criar` member composer (caption, photos, one video where allowed, link; no PDF, no community) show for a `member` in Explorar only, and publishing lands the member on top of Explorar. | 3 | D-472, D-473 | Pitfall 1 |
| EXPL-06 | Reels "Todos" (`GET /v1/feed?media=video`) lists admin videos, the videos of the viewer's followees and the viewer's own, newest first; a member video has no lane and no community chip; its like and comment are the same rows Explorar shows; tapping a video in Explorar opens `ReelsOverlay` at it; a moderator sees member videos in Explorar, not in Reels. | 7 | D-480, D-481 | Pattern 2 |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives extracted from `.claude/CLAUDE.md` and `apps/web/AGENTS.md` that the plans must satisfy (same authority as locked decisions):

- **Zero leakage between tenants is the core value.** RLS + defense in depth on every new table and policy; a pgTAP cross-tenant negative test for each; the API never uses `service_role`/`postgres` for tenant queries (`api_user` + `set local role authenticated` per transaction, via `withTenantTx`).
- **Modules are self-contained packages** depending only on the kernel and on other modules' *published contracts*; `pnpm boundaries` must stay green; no module-to-module package import (so social cannot import feed, nor the reverse).
- **All business logic goes through the API.** The browser never talks to Supabase for data; Realtime stays read-only signals (unchanged here).
- **Migrations:** schema and policies live in Drizzle TS; `drizzle-kit generate` emits reviewable SQL applied by the Supabase CLI; hand-written SQL (definers, seam bodies, constraints) goes in `--custom` migrations; never run `drizzle-kit migrate` and `supabase db push` together; expand-only, applied before the API.
- **DB driver:** `postgres` via the Supavisor transaction pooler with `prepare: false`.
- **pt-BR UI, all strings centralised** in the host's next-intl catalog; module packages ship no language (`bash scripts/check-ui-literals.sh`).
- **Design:** UI follows the prototype in `reference/frontend-design/` (ported into module packages, not refactored in place); prototype-less surfaces (Explorar chip and empty states, "Siga para ver", private lists, member composer, platform `social` settings) go through the sketch gate and a UI-SPEC before UI tasks.
- **Next.js 16 conventions:** `proxy.ts` not `middleware.ts`, async `params`/`searchParams`/`cookies()`, Biome (no ESLint/`next lint`), no `localStorage` tokens, `redirect()`/`notFound()` outside try/catch. `apps/web/AGENTS.md` says this is not the Next.js of training data: read the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing web code.
- **Media:** uploads never pass through the API (signed direct upload); Supabase Free limits (no transforms, 50 MB per file, 1 GB storage) apply; video via Mux direct upload.
- **No Redis/Memorystore in V1**; jobs on pg-boss; fan-out through the Phase 7 notification seams.
- **GSD workflow enforcement:** file-changing work starts from a GSD command; this research is written under `/gsd-plan-phase`. Project memory adds: no Claude co-author trailer in commits (public repo), execution is sequential, and `docs/DEPLOY.md` carries each phase's release order.

## Suggested decomposition (for the planner; adjust freely)

1. **Wave 0 — spike and scaffolding:** plan-measurement spike (rolled-back scratch DB); `social` seeded on rede-lab; `withSocialEnabled` helper; new pgTAP/integration/e2e file skeletons.
2. **Wave 1 — vocabulary and seams (no behaviour change with `social` off):** key appended to `TOGGLEABLE_MODULES` + CHECK; kernel seam stubs + `packages/core/db/social-gate.ts`; kernel member-media seam; module package skeleton; `ACCESS_REFUSALS`/moderation vocabulary widened; registry `permissionsFor` branch swap with its test rewrite.
3. **Wave 2 — schema:** `feed_posts.visibility` + `deleted_by_user_id` + indexes + `feed_posts_social_gate` + insert policy; `social_follows` + policies; hand-SQL seam bodies, `app.social_counts`, `app.feed_social_locked_author`, `app.media_asset_hidden` re-body; pgTAP 200/201.
4. **Wave 3 — API:** follow routes and profile variant; feed audiences (Início, Reels, Explorar), `getPost` locked branch, `assertPostInteractive`; member authoring rules + media seam + duration snapshot; moderator removal + log; notification source changes; `GET /v1/members` gate; platform settings route.
5. **Wave 4 — web (after the UI-SPEC gate):** chips and Explorar, composer variant and surface gating, locked screen, profile counts/button, `/membros` + lists, notification renderer, platform panel (settings form + confirm), Admin-badge swap.
6. **Wave 5 — exit gate:** isolation sweep and inventory, e2e, module README, `docs/DEPLOY.md` release order + "turning on `social`" item, REQUIREMENTS/ROADMAP rewording (PROF-03, criterion 4, MODER-04 split, Phase 11 criterion 3, new IDs), `pnpm verify`.

## Summary

Phase 9 is an authorization-and-query phase, not a new-library phase: no external package is installed. The hard part is that member posts become the first feed content whose visibility depends on **who is asking** (author, follower, moderator, staff, other tenant), while every existing read path (Início, Reels, community page, post page, likes, comments, media playback, notification fan-out, owner dashboard) assumes "every post of the tenant is readable by every member". The codebase already contains the exact precedent for this class of problem: the 08.2 community gate (kernel seam stubs + module-provided bodies + restrictive RLS policies on `feed_posts`, `feed_comments`, `feed_likes` + a definer for the locked-link answer + `app.media_asset_hidden` for video playback). Phase 9 should reuse that shape end to end rather than invent a second one.

Three findings change the plan relative to CONTEXT's defaults and need the planner's attention. (1) **Stamp the audience on the post** (`feed_posts.visibility`, `'tenant'` | `'followers'`, written by the service from the author's role) instead of deciding it from the author's role at read time: a role change (ADMIN-02 can promote and demote) would otherwise retroactively move old posts between Início and follower-only, and a stamped column is what lets RLS, partial indexes and pgTAP plan assertions stay cheap and provable. CONTEXT allowed this ("unless research finds a reason to stamp it"). (2) **The permission model needs no new mechanism**: `permissionsFor` already unions only *effective* modules, so replacing the `postingPolicy` branch with an `effective.has('social')` branch is the whole change; the real work is that four existing web/API surfaces gate "post as the organization" on `feed.post.create`, which members will now hold. (3) **Two premises in CONTEXT do not hold in the code**: D-474 says "the general API rate limit applies" but no rate limiter exists in `apps/api/src`; and the shared tenant media pools (800 MiB of files, 3 hours of feed video) are consumed by member uploads and can lock the admin out. Both are surfaced as open questions with a recommended default.

The Explorar query should be the **pull model** (join/filter live follow edges at read time, no fan-out table): the pilot's tenants are small, the pull model makes D-483/D-484 ("nothing deleted, returns when turned back on") free, and a fan-out table would need six invalidation paths (follow backfill, unfollow, delete, moderator removal, block/unblock, social toggle). A Wave 0 plan-measurement spike on a volume fixture picks between a simple `author = any(followed)` predicate over a covering partial index and a bounded top-N-per-followee `LATERAL` form, exactly as 05-RESEARCH measured the merged feed.

**Primary recommendation:** Build a `social` module (follow table + routes + settings) on the 08.2 gate pattern: a kernel seam (`app.social_enabled()`, `app.social_visible_author_ids()`) given bodies by the social migration, a stamped `feed_posts.visibility` with a restrictive `feed_posts_social_gate` policy, one shared SQL visibility fragment used by every feed read, a definer for the "Siga para ver" answer, and a replaced `postingPolicy` branch in `permissionsFor`; leave Início/Reels/Explorar as three predicates over the existing `feedPage`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Follow / unfollow, counts, own lists | API / Backend (`/v1/social/*`) | Database (RLS own-row policies, definer for counts) | Business logic and tenant scoping go through the Hono API; lists are private so RLS is own-row only and other members' counts come from a tenant-pinned definer |
| Who may read a member post (author / follower / moderator) | Database (restrictive RLS on `feed_posts` + definers) | API (the exact rule in the statement) | Core value is zero leakage: RLS is the backstop for a route that forgot a guard, the statement is the precise rule (support and moderator nuances RLS cannot express) |
| Explorar / Início / Reels audience split | API (`feedPage` predicates) | Database (partial indexes) | One projection, one ordering expression (D-73); the audience is a `where` fragment, never a second query path |
| Member authoring permission | API (`permissionsFor`, one composition point) | Browser (reads the same `bootstrap.permissions`) | UI and API cannot disagree (FEED-08 principle) |
| Member media limits | API (kernel media broker via a kernel seam) | Platform panel (super_admin edits settings), Browser (pick-time UX only) | Limits are authorization-adjacent and billing-relevant; the browser copy is UX, never authority |
| Video duration enforcement | API worker (Mux ready-event job) | Browser (pre-check only) | Duration is only measurable once the provider reports `ready` (`event-job.ts`) |
| Moderator removal + audit | API (same-transaction `recordModerationAction`) | Database (CHECK vocabulary, append-only log) | A removal without its log row must be impossible |
| Comment notice to author | Worker (notification source reads feed tables) | API (emits the existing `comment.created` event) | Fan-out never runs inside the producing request |
| Explorar chip, locked screen, profile counts, composer variant | Frontend Server (RSC pages, server actions) | Browser (client islands: follow toggle, feed surface) | Pages are server-rendered from the bootstrap; actions call the API |
| `social` on/off and settings | Platform panel (super_admin) | Database (`tenant_modules` row + CHECK) | Existing module-toggle seam; settings editing is NEW (the panel exposes only `{key, enabled}` today) |

## Standard Stack

### Core

No new third-party library. Everything below is already pinned in the repo [VERIFIED: CLAUDE.md Recommended Stack; package.json files read this session].

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono + `@hono/zod-openapi` | 4.13.7 / 1.6.3 | `/v1/social/*` routes with OpenAPI | Same router shape as every module (`createRoute` + `.openapi`) |
| Zod | 4.6.2 | Settings, follow and profile-variant contracts (`.strict()`) | Single schema language, shared with the web |
| Drizzle ORM / drizzle-kit | 0.45.2 / 0.31.10 | `social_follows` schema + policies; generated migrations | Policies live next to the table; `pnpm db:generate` must print "No schema changes" |
| postgres.js via `withTenantTx` | 3.4.9 | Tenant lane (`set local role authenticated` + claims) | Existing lane; raw `sql` for the projection |
| Vitest / pgTAP / Playwright | 5.0.0 / `supabase test db` / 1.63.0 | Unit, RLS, e2e | Existing infrastructure |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@rede-social/module-feed/contracts` | workspace | `feedPostSchema`, `feedQuerySchema`, `FEED_PERMISSIONS` (web and API import it; **social must not**) | Extend additively (`scope`, `removal`, `access`) |
| `@rede-social/contracts/access` | workspace | `ACCESS_REFUSALS` vocabulary (append `follow_required` LAST) | The locked answer |
| `@rede-social/core/server/moderation/log` | workspace | `recordModerationAction` | Moderator post removal |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pull model (live follow edges at read time) | Fan-out table `explorar_items(recipient, post)` | Write amplification (followers x posts) and six invalidation paths; breaks "nothing deleted, returns when on" for free. Only worth it above tens of thousands of followers per author [ASSUMED] |
| Stamped `visibility` column | Author role at read time (CONTEXT default) | Read-time role retroactively re-audiences old posts on a role change and cannot be a partial-index predicate; stamping costs one expand-only column |
| Kernel seam (stubs + bodies) for the follow graph | Feed policy referencing `public.social_follows` directly | Feed would depend on a module's table (MOD-02/MOD-05); the 08.2 precedent exists precisely to avoid this |
| Registry branch replacing `postingPolicy` | `defaultRolePermissions.member` on the social manifest | The latter would need social to name feed's permission strings (module-to-module import is denied by turbo boundaries); the branch lives in the app tier that already imports both |

**Installation:** none. A new workspace package `packages/modules/social` is added with the same dependency pins as `packages/modules/courses/package.json` [VERIFIED: file read this session] and `workspace:*` entries in `apps/api/package.json` and `apps/web/package.json` (the courses module is wired the same way [VERIFIED: grep]).

**Version verification:** not applicable (no new package). Local toolchain observed: Node v24.14.0, pnpm 12.4.1, Supabase CLI 2.118.0 (`package.json` pins `supabase` 2.117.0; the global binary is newer) [VERIFIED: shell probe 2026-10-19].

## Package Legitimacy Audit

> This phase installs **no external packages**. The only new package is the in-repo workspace package `@rede-social/module-social`.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@rede-social/module-social` | workspace (private) | new | n/a | this repo | n/a (not published) | Approved: dependency list copied from `module-courses` |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                      member (browser, PWA)                    moderator (admin_tenant)
                               |                                         |
              /inicio  chip: Início | Explorar  (?aba=explorar)  /post/[id]  /membros  /perfil/seguidores
                               |  (RSC pages + server actions, BFF cookies)
                               v
     +-------------------------------- Hono API (Cloud Run) --------------------------------+
     | requireAuth -> requireModule('feed') -> requireModule('social') -> permission guard   |
     |                                                                                       |
     | GET /v1/feed                -> listFeed: ONE statement, three audiences               |
     |    (no scope)    Início     : visibility='tenant'                                     |
     |    media=video   Reels Todos: visibility='tenant' OR author = ANY(visible_authors)    |
     |    scope=explorar           : visibility='followers' AND (author=ANY(visible) OR mod) |
     | GET  /v1/feed/posts/{id}    -> getPost: row | RLS-miss -> definer -> locked | 404     |
     | like/comment routes         -> assertPostInteractive (same fragment) -> 403|404       |
     | POST/PATCH/DELETE posts     -> member rules (no attachments/community, limits),       |
     |                                moderator branch + recordModerationAction              |
     | PUT/DELETE /v1/social/follows/{membershipId}, GET /v1/social/me/*, .../members/{id}   |
     | GET /v1/members  (role gate becomes social-conditional)                               |
     | POST /v1/media/uploads -> kernel seam: member limits / member video                   |
     +----------+------------------------------+--------------------------+------------------+
                |                              |                          |
                v                              v                          v
   +---------------------------+   +-------------------------+   +--------------------------+
   | Postgres (Supabase)       |   | pg-boss worker          |   | Mux (video)              |
   | feed_posts.visibility     |   | notifications source:   |   | ready event -> duration  |
   | social_follows (own-row   |   |  post.published member  |   | cap (snapshot at start)  |
   |  RLS), restrictive policy |   |   -> []                 |   | member video must be     |
   |  feed_posts_social_gate,  |   |  comment.created root   |   | `ready` before publish   |
   |  app.social_* seam fns,   |   |   on member post ->     |   +--------------------------+
   |  moderation_log widened   |   |   feed.post_commented   |
   +---------------------------+   +-------------------------+
                ^
                | Realtime Broadcast: unchanged (bell only)
```

Entry points are the web pages and the API routes above; the decision points are the three audience predicates and the locked-vs-404 branch; external boundaries are Mux (duration) and the worker (notices).

### Recommended Project Structure

```
packages/modules/social/
├── module.ts            # key 'social', requires ['feed'], routes, defaultRolePermissions.member = ['social.participate']
├── contracts/index.ts   # socialSettingsSchema (+defaults), follow/summary/list schemas, SOCIAL_PERMISSIONS, vocab
├── db/schema.ts         # socialFollows + policies (own-row select, member-only insert, own delete)
├── server/{routes,service,index}.ts
├── ui/                  # props-only: FollowButton, FollowCounts, FollowListRow, LockedPost ("Siga para ver")
├── tests/
└── README.md            # MOD-05 headings

packages/core/db/social-gate.ts                      # kernel seam constants (community-gate.ts twin)
packages/core/server/media/member-policy.ts          # kernel seam: setMemberMediaPolicy / memberMediaPolicyFor
supabase/migrations/
├── *_social_gate_seam.sql            # kernel stubs (hand SQL): app.social_enabled(), app.social_visible_author_ids()
├── *_social_module.sql               # GENERATED: key CHECK widened, social_follows, feed_posts.visibility + deleted_by_user_id,
│                                     #   indexes, feed_posts_social_gate policy, moderation_log CHECKs
└── *_social_functions.sql            # hand SQL: seam bodies, app.social_counts, app.feed_social_locked_author,
                                      #   app.media_asset_hidden (feed body re-created), grants
supabase/tests/200-social.sql, 201-feed-social-gate.sql
apps/api/tests/integration/social.test.ts, feed-social.test.ts, social-media.test.ts
```

### Pattern 1: A module that requires another, with routes (the `requires` trap)

**What:** `social` owns routes and `requires: ['feed']`. `effectiveKeys` drops it from the bootstrap and from `permissionsFor` while `feed` is off, but `requireModule('social')` only asks the flags cache for `social` [VERIFIED: `packages/core/server/modules/require-module.ts` reads `moduleFlags.isEnabled(ctx, key)` and nothing else]. The registry docblock states the consequence verbatim: *"A future module with BOTH routes and `requires` must also teach `requireModule` this rule"* [VERIFIED: apps/api/src/modules/registry.ts:129-133].

**When to use:** every `/v1/social/*` route.

**Example:**
```typescript
// Source: packages/modules/feed/server/routes.ts:92 (the shape) + registry.ts docblock (the rule)
const social = new OpenAPIHono<AppEnv>({ defaultHook });
// Both flags: social's own AND the one it requires. Same 404 MODULE_DISABLED for either.
social.use('*', requireAuth, requireModule('feed'), requireModule('social'));
```
Follow routes additionally take `requireRole('member')` (D-467) AFTER the module guards (ROLE-06 order: auth, module, role). The counts read for another member's profile is member-only too (staff profiles keep D-45).

### Pattern 2: One visibility fragment, three audiences, two enforcement layers (the core of the phase)

**What:** the 08.2 gate, restated for authors.

- **Seam (kernel, stubs):** `app.social_enabled() boolean` (stub `false`) and `app.social_visible_author_ids() uuid[]` (stub `'{}'`), declared by a kernel migration that sorts BEFORE the policy that calls them (the `*_community_gate_seam.sql` reason: `CREATE POLICY` must resolve the function when it runs) [VERIFIED: supabase/migrations/20261008171502_community_gate_seam.sql]. The social migration replaces the bodies with `create or replace`, same signatures, same OIDs.
- **Bodies (social migration):** `social_enabled()` reads the tenant's `tenant_modules` row (`module_key = 'social' and enabled`) pinned to `app.tenant_id()` — a SQL read, **not** the 30-second flags cache [VERIFIED: `MODULE_FLAGS_TTL_MS = 30_000`], so turning `social` off hides member posts immediately on every instance. `social_visible_author_ids()` returns `'{}'` unless `social_enabled()` and `app.tenant_role() = 'member'`, else the caller's own user id plus the `followee_user_id` of the caller's `social_follows` rows (own rows, one index range scan, **no membership probes** here — author liveness is applied per returned row, see below).
- **RLS (feed schema, generated by drizzle-kit):** a RESTRICTIVE select policy so it ANDs with `feed_posts_tenant_isolation` and `feed_posts_community_gate`:
  ```
  visibility = 'tenant'
  or app.tenant_role() in ('admin_tenant', 'support_tenant')
  or author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))
  ```
  The staff-by-claim exemption mirrors the store seam (`when app.tenant_role() in ('admin_tenant', 'support_tenant') then '{}'::uuid[]` [VERIFIED: 20261008171645_store_functions.sql]) and, decisively, keeps every system lane working: the notifications worker runs as `role: 'support_tenant'` with `NOTIFICATIONS_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'` [VERIFIED: packages/modules/notifications/server/system-context.ts:7,22] and the owner dashboard builds under `dashboardSystemCtx` [VERIFIED: snapshot-job.ts:40]. **Consequence the planner must test explicitly:** RLS does not protect member posts from a real `support_tenant` user, so the service-level fragment below is the only gate for support; add API tests (Explorar, post read, like, comment list, replies, thread) with a support session.
  Comments and likes need **no new policy**: `feed_comments_community_gate` and `feed_likes_community_gate` already test post visibility through an inner `exists (select 1 from public.feed_posts p …)` that runs under the caller's RLS [VERIFIED: packages/modules/feed/db/schema.ts:465-473, 568-578], so a post hidden by the new policy hides its comments and refuses likes (42501) automatically.
- **Service (exact rule), one shared fragment** appended by every read: `listFeed` (all three audiences), `getPost`, `assertPostInteractive`, and the notification resolvers. `postProjection` already joins `memberships ms`, so author liveness costs nothing:
  ```
  (p.visibility = 'tenant'
   or ( (select app.social_enabled())
        and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
        and ( p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))
              or <canModerate> ) ))
  ```
  `<canModerate>` is a boolean the ROUTE computes from `permissionsForRequest` before the service opens its transaction (the comment-removal rule, T-08-08) and passes as an option; it is `true` only for the Explorar scope and for `getPost`, **never** for Início/Reels (D-480). The liveness predicate encodes D-484 using the same folding the rest of the kernel uses (`status = 'blocked' or blocked_at is not null` is blocked [VERIFIED: packages/core/server/tenancy/member-admin.ts:29-30,64]; the directory's live predicate is `m.role = 'member' and m.status = 'active' and m.deleted_at is null` [VERIFIED: packages/core/server/profiles/service.ts:362]).
- **Three audiences over `feedPage` (still ONE statement each):**
  - Início, no `scope`/`media`: `p.visibility = 'tenant'` (+ today's `NOT_LOCKED` / `community_id is null`). **Without this predicate RLS alone would put followed members' posts into Início** because the policy admits them.
  - Reels "Todos" (`media=video`, no `communityId`): the shared fragment with `canModerate = false`.
  - Explorar (`scope=explorar`): `p.visibility = 'followers' and p.community_id is null` + the shared fragment (`canModerate` for the moderator branch).
- **Stamp at write:** `visibility = ctx.role === 'member' ? 'followers' : 'tenant'`, never from the body; plus a RESTRICTIVE insert policy so a member claim cannot insert `'tenant'` (the `feed_likes_community_gate` insert-check precedent).

**When to use:** all feed reads. **Index consequences** (Pitfall 4): the existing partial indexes serve Início only if their predicate also carries `visibility = 'tenant'`.

### Pattern 3: One authoring path, role-conditional rules

`createPost`/`updatePost` get a `memberRules(ctx, policy, wanted)` step run when `ctx.role === 'member'`: refuse `attachmentAssetIds` and `communityId` with new closed-vocabulary codes (add to `FEED_MEDIA_ISSUES` / `FEED_COMMUNITY_ISSUES`, which `routes.ts`'s `defaultHook` lifts into `details.media` / `details.community` by set membership [VERIFIED: routes.ts:64-90]), cap image count and require a **`ready`** video. Today `validateAssets` accepts a video that is still `processing` [VERIFIED: service.ts:700-701 `asset?.status === 'ready' || (item.kind === 'video' && asset?.status === 'processing')`]; for a member the status must be strictly `ready`, which is also the answer to "where is video duration enforced" (Pattern 4).

### Pattern 4: Member media limits through a kernel seam, duration judged by the ready job

The enforcement points already exist; they only need a member-aware limit:

- `startUpload` hard-codes `if (body.kind === 'video' && ctx.role !== 'admin_tenant') throw new ApiError(403, 'FORBIDDEN');` [VERIFIED: packages/core/server/media/service.ts:387-389]. Replace with: members may start a `post`-purpose video only when the seam says so; every other member video (`story`, `lesson`) stays 403.
- `completeUpload` re-judges bytes against the static `limitFor(kind, purpose)` [VERIFIED: service.ts:623, 656]; it must apply the same member cap (otherwise a member declares 1 MB and uploads 15 MB; the signed URL carries no size).
- Duration: `applyReady` compares the provider's duration with `limit.maxDurationSeconds` and sets `status: 'rejected', failureReason: DURATION_TOO_LONG` after deleting the provider asset [VERIFIED: packages/core/server/media/video/event-job.ts:109-134]; its comment says Mux "enforces no duration at ingest, so a video is only measurable once ready". So: **snapshot the effective cap on the asset at `start`** (an expand-only nullable `media_assets.duration_cap_seconds`, read by `applyReady` as `coalesce(row cap, limit cap)`). That also implements D-474's "limits apply to new uploads only" literally. Client-side `HTMLVideoElement.duration` is a UX pre-check only (it can be spoofed).
- The kernel cannot import the social settings schema (MOD-02). Add a kernel seam in the `setPermissionResolver` pattern: `setMemberMediaPolicy((ctx) => MemberMediaPolicy | null)` registered by `apps/api/src/modules/registry.ts`, which composes `effectiveKeys` + the social settings (`safeParse` with defaults). Feed's `createPost` (image count) and the media broker both call the kernel function.

### Pattern 5: The permission model needs one branch, not a new mechanism

`permissionsFor` already computes the set from `effectiveKeys(enabled)` so "a disabled module contributes nothing" [VERIFIED: registry.ts:197-221]. Replace the `postingPolicy` block (registry.ts:212-218) with:
```typescript
// Source: replaces apps/api/src/modules/registry.ts:212-218
if (effective.has('social') && role === 'member') {
  permissions.add(FEED_PERMISSIONS.create);
  permissions.add(FEED_PERMISSIONS.manage); // own posts only: the statement carries author_user_id (T-04-54)
}
```
and give the social manifest `defaultRolePermissions: { member: ['social.participate'] }` (its own string, no feed import). `social.participate` is the permission the follow routes and the `GET /v1/members` member branch check, so the web reads the same composed value. Remove `feedSettingsSchema`/`FEED_POSTING_POLICIES` or keep them parsed-and-ignored (D-482 allows either); removing is cleaner but touches `registry.test.ts` 6b, `feed.test.ts` case 7, `feed-view.test.ts` and the two ROADMAP/README mentions.

### Pattern 6: The locked answer is a definer, like `app.feed_locked_post_community`

On a `getPost` RLS/predicate miss, ask `app.feed_social_locked_author(p_post uuid)` (tenant-pinned SECURITY DEFINER, `search_path = ''`, revoke from public, grant to `authenticated`, answering one fact): the author's user id **only** for a live post of this tenant with `visibility = 'followers'`, `app.social_enabled()`, an active unblocked author, a caller that is a `member` and is neither the author nor a follower. Every other miss (including a `support_tenant` caller, see Open Questions) is null, which stays the bare 404. The route then reads the author's `display_name` / `avatar_asset_id` / membership id through the same lane and throws `ApiError(403, 'FORBIDDEN', { access: 'follow_required', author })`. Like/comment routes throw `{ access: 'follow_required' }` without the author. **Append `'follow_required'` to `ACCESS_REFUSALS` LAST**: the web reads `ACCESS_REFUSALS[0]` as the community-locked code [VERIFIED: apps/web/app/(app)/inicio/feed-actions.ts:60 `const COMMUNITY_LOCKED: CommunityLockedCode = ACCESS_REFUSALS[0];`]. Also extend `app.media_asset_hidden` (feed body) so a video attached only to member posts the caller cannot see is hidden from `playbackTokens` [VERIFIED: service.ts:861-864 asks `mediaAssetHidden(assetId)`]; an asset attached to no post yet (the composer's own preview) stays visible by the function's first `exists`.

### Pattern 7: Moderator removal reuses the comment-removal shape

`softDeletePost` gains `opts: { canModerate }`: `update feed_posts set deleted_at = now(), deleted_by_user_id = me where id = $id and deleted_at is null and (author_user_id = me or (canModerate and visibility = 'followers')) returning author_user_id, caption`. The `visibility = 'followers'` limit preserves T-04-54 for admin posts (a second admin still cannot remove a colleague's post). When the actor is not the author, `recordModerationAction(tx, ctx, { action: 'post_removed', targetUserId, subjectType: 'feed_post', subjectId, excerptSource: caption, reason: null })` runs in the same transaction, then the existing `post.deleted` event emits (its retraction blanks every notice about the post). Required vocabulary widening (all five, one release): `MODERATION_ACTIONS` and `MODERATION_SUBJECT_TYPES` [VERIFIED: packages/contracts/src/moderation.ts:23-32], the two CHECKs `moderation_log_action_chk` / `moderation_log_subject_chk` whose second rewrites `(action = 'comment_removed') = (…subject…)` to cover both actions [VERIFIED: packages/core/db/schema/moderation-log.ts:76-90], the `ModerationEntry` union in `log.ts`, `moderation-view.ts` (chip + sentence key) with `ModerationLogRow.tsx` and the catalog. `feed_posts` has **no `deleted_by` column** today (comments do); add `deleted_by_user_id uuid` (nullable, no FK, for the same reason as the log: a deleted account must not block the evidence). Widening a CHECK is DDL and does not touch the immutability triggers (row/truncate only) [VERIFIED: 20261002123245_moderation_log_immutable.sql].

### Pattern 8: `feed.post_commented` rides the existing sources

In `feedNotificationSources`: `post.published` resolver adds `p.visibility` to its select and returns `[]` unless `'tenant'` (D-476); `resolveCommentCreated` today returns `[]` for a root comment [VERIFIED: notifications.ts:276 `if (payload.parentCommentId === null) return [];`] — add the root branch: read the live comment + live post with `for share of c, p` (the B-WR-01 lock rule), require `p.visibility = 'followers'`, `app.social_enabled()`, an active author, commenter != author; intent `{ kind: 'feed.post_commented', audience: { type: 'users', userIds: [author] }, excludeUserIds: [actor], dedupeKey: 'feed.post_commented:{commentId}', subject: { type: 'post', id }, object: { type: 'comment', id }, channels: ['in_app','push'], push: {…url: '/post/{id}?comentario={commentId}'…} }`. Because subject is the post and object is the comment, the existing retractions (`post.deleted` on subject, `comment.deleted` on object) already match [VERIFIED: notifications.ts:372-381]. Touchpoints: `FEED_NOTIFICATION_KINDS` (append), `notification-copy.ts` push copy, `apps/web/lib/notification-renderers.tsx` (glyph, sentence, `commentHref`), `notifications.json` `kinds.postCommented`, `messages.test.ts` key lists, `notification-sources.test.ts`. `notifications.kind` is free text ("a new kind is a row value, never a migration") [VERIFIED: modules/notifications/db/schema.ts:57].

### Anti-Patterns to Avoid
- **Relying on RLS alone for Início/Reels.** RLS admits followed members' posts, so Início needs its own `visibility = 'tenant'` predicate.
- **Reading `moduleFlags` (30 s cache) to decide whether a member post is hidden.** Use the SQL gate; the cache is fine for permissions/UI.
- **A second query path for Explorar** (own projection in the social module): feed's `postProjection` is private to feed and a copy would drift; Explorar is a `scope` of the feed endpoint (the Reels precedent, `media=video`).
- **Importing `@rede-social/module-feed` from social (or the reverse).** `turbo boundaries` denies module-to-module edges; share through `@rede-social/contracts` and the kernel seams.
- **Inserting `follow_required` before `community_locked`** in `ACCESS_REFUSALS`.
- **A member-visible list route that takes a member id** (D-468).
- **Counting followers with a denormalised counter** that block/unblock/removal would have to repair.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Who may read this row" backstop | Per-route `if` checks only | Restrictive RLS policy + kernel seam (08.2 pattern) | A forgotten guard must still fail closed; comments/likes inherit for free |
| Keyset paging | Offset or a new cursor | `feedPage` + `encodeCursor`/`decodeCursor` on `(created_at, id)` | Total order, tampered cursors degrade to page 1 |
| Idempotent follow | Read-then-insert | `insert … on conflict (tenant_id, follower_user_id, followee_user_id) do nothing` + unique index as arbiter | Same technique as `feed_likes_post_uq`; no race window |
| Moderation audit | A new log table | `recordModerationAction` + widened CHECKs | Append-only by construction; same-transaction atomicity |
| Notification fan-out | Calling push from the request | `notificationSources` + keep-and-mark retractions | Idempotent on `(event_id, user_id)`, never in the producing request |
| Tenant-scoped module settings | New columns on `tenants` | `tenant_modules.settings` jsonb with a tolerant `safeParse` schema | Convention (D-16); defaults on a malformed blob, never throws on a request path |
| Duration limit | Client-measured duration | Mux ready-event job (`applyReady`) with a snapshotted cap | The only authoritative moment the duration is known |
| Chips | A new tab component | `HubTabs` + a `tabs.ts` registry, `?aba=` | Existing pattern (server decides the active key, client wrapper pushes the href) |
| Share/deep links | New URL scheme | `/post/{id}` (FEED-07) | The locked screen turns a shared link into a follow |
| Locked-content copy | Strings in the module | Host pt-BR catalog + `scripts/check-ui-literals.sh` | Modules ship no language |

**Key insight:** every piece of this phase already has a twin in the 08.2 store gate, the 08-01 comment moderation or the 05.3 Reels filter. The risk is not inventing; it is touching all the places the twin touched (policies, definer, media gate, notification resolvers, web composition) and missing one.

## Runtime State Inventory

> Not a rename/refactor phase. The one migration-flavoured item is the removal of `postingPolicy`; inventory for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `tenant_modules.settings.postingPolicy` may exist on any tenant's `feed` row (tests set/unset it; production tenant is admin-only [ASSUMED: user statement in CONTEXT/STATE that the real tenant is admin-only]); existing `feed_posts` rows have no `visibility` | Expand-only column with `default 'tenant'` backfills every row; leave a stray `postingPolicy` key in place (ignored, harmless) |
| Live service config | None — module toggles are rows in `tenant_modules` (database, not an external UI) | None |
| OS-registered state | None | None |
| Secrets/env vars | None new | None |
| Build artifacts | `apps/api/dist` bundles (gitignored); Drizzle snapshot JSON under `supabase/migrations/meta/` regenerates | `pnpm db:generate` after each schema plan must print "No schema changes" |

## Common Pitfalls

### Pitfall 1: `feed.post.create` no longer means "organization voice"
**What goes wrong:** members hold `feed.post.create` under `social`, so every surface that gates on that string shows a composer to members: the Início FAB (`apps/web/lib/registry.tsx:236`), the community page `canPost` (`comunidades/[communityId]/page.tsx:467`), the Reels empty-state CTA (`registry.tsx:423`), `/criar` (community picker and PDF attachments, `criar/page.tsx:45`). D-472/D-473 forbid all four.
**Why:** D-482 locks "`feed.post.create` for `member` comes from `social` being on".
**How to avoid:** the organization-voice surfaces gate on `feed.post.create` **and** `content.publish` (kernel permission, `admin_tenant` only [VERIFIED: require-role.ts:19]; grep found no production reference other than that list and tests, so it carries no other meaning). The member composer entry gates on `social.participate`. `/criar` renders the member variant (no picker, no attachments, limits from the bootstrap settings) for a holder of `social.participate` without `content.publish`.
**Warning signs:** a member session sees "Criar publicação" in Início, a community or the empty Reels state.

### Pitfall 2: The RLS staff exemption is a deliberate hole for `support_tenant`
**What goes wrong:** a support user can read a member post, its comments and likes by id if only RLS stands guard.
**Why:** system lanes use the `support_tenant` claim (notifications worker, dashboard); exempting by claim is the seam precedent.
**How to avoid:** the service fragment excludes support in every statement (they are not author, follower or moderator); add one integration test per route with a support session; document the residual (comment-id routes `likeComment`/`unlikeComment`/replies/thread rely on RLS for post visibility and are reachable by a support user who somehow holds a comment id). The stricter alternative is exempting the zero-user sentinel and `admin_tenant` instead, at the cost of enumerating every system lane's ctx.

### Pitfall 3: Início must exclude followed posts explicitly
See Pattern 2. A pgTAP/integration case: member A follows B; B's member post is **absent** from A's Início and **present** in A's Explorar and Reels "Todos".

### Pitfall 4: Indexes and name-pinned EXPLAIN tests
Início, the `community_id is null` fallback and Reels read through `feed_posts_tenant_created_all_idx`, `feed_posts_tenant_created_idx (where community_id is null)` and `feed_posts_tenant_video_created_idx (where media_kind = 'video')` [VERIFIED: packages/modules/feed/db/schema.ts:118-177]. With member posts in the same table, an unfiltered index walk discards them (the exact problem 05.3 solved for video). Create visibility-partial siblings (`where visibility = 'tenant'`, and the community-null variant) and an Explorar index; drop the old ones in a later release (expand-contract). `090-feed.sql` and `130-reels.sql` pin plans by index **name** [VERIFIED: grep of both files]; update them in the same plan that renames. Literals only (`visibility = 'tenant'`), never bound parameters, or the planner cannot prove a partial predicate (the `READY_VIDEO_POST` lesson in service.ts:271-281).

### Pitfall 5: Existing tests encode the old model
`feed.test.ts` case 7 flips `postingPolicy` and expects a member author [VERIFIED: apps/api/tests/integration/feed.test.ts:287-328]; `registry.test.ts` 6b, 446-456 and 470-480 use `postingPolicy` in generous-settings matrices; `feed-view.test.ts` tests the Admin badge via `postingPolicy`; the e2e `comunidades.spec.ts` asserts "a member holds no `feed.post.create`". Keep rede-demo `social` OFF in the seed so the latter stay valid, and rewrite the former around `social`.

### Pitfall 6: `members.test.ts`/`/membros` redirects
`GET /v1/members` uses `const staffOnly = requireRole('admin_tenant', 'support_tenant');` [VERIFIED: apps/api/src/routes/members.ts:53]; the web has the same rule in `canBrowseMemberDirectory` (used by `membros/page.tsx:58`, `membros/actions.ts:59`, `[membershipId]/not-found.tsx:39`, `memberProfileExit`). All of them become `social`-aware from the bootstrap (`bootstrap.modules.some(m => m.key === 'social')`) and the API from `permissionsFor` (`social.participate`).

### Pitfall 7: Strict contract schemas break across the deploy window
`feedPostSchema` and `feedPageSchema` are `.strict()` and the web parses with them; new fields (`removal`, `scope` echo, `access: 'follow_required'`) must be `.optional()` so an older web never meets an unknown key (the 08.2 Pitfall 10 rule, stated in `feedPostSchema.access`'s docblock). Query schema `feedQuerySchema` is `.strict()`: add `scope: z.enum(['explorar']).optional()` and refuse `scope` + `communityId`.

### Pitfall 8: Flag-cache staleness vs D-483
Permissions and the bootstrap flip within 30 s per instance after the toggle; the SQL gate flips immediately. Expect a window where an author still sees the composer but the API's write gate is `requirePermission` (permissions from the cache) while reads are already hidden. Acceptable; test the read gate with the toggle, not the composer.

### Pitfall 9: Member uploads can exhaust the organization's pools
`MEDIA_TENANT_BYTES_CEILING = 800 * 1024 * 1024` (files) and `MEDIA_TENANT_VIDEO_SECONDS_CEILING = 3 * 60 * 60` (feed and story video) are per tenant [VERIFIED: packages/core/server/media/limits.ts:36,41]. At 60 s per member video, 180 videos exhaust the 3 hours and the admin's next reel gets `413 quota_exceeded`. See Open Question 2.

### Pitfall 10: No API rate limiter exists
`grep` over `apps/api/src` finds none (`apps/api/src/http` holds `logger`, `openapi`, `request-id`). D-474 relies on one. Follow/unfollow spam, post spam and `POST /v1/media/uploads` spam are unthrottled. See Open Question 1.

### Pitfall 11: Explorar and the moderator in Reels
A moderator's Explorar includes member videos that Reels "Todos" excludes; tapping one opens the overlay on a video not in the queue. `loadReel(postId)` already covers "its feed page's cursor did not find it" [VERIFIED: apps/web/lib/reels.ts:150-162]; keep that path and test it with a moderator session.

### Pitfall 12: `requires` is not enforced by `requireModule`
See Pattern 1. Without `requireModule('feed')` beside `requireModule('social')`, feed-off + social-on answers follow routes.

### Pitfall 13: The directory page reaches several files
`membros/page.tsx`, `membros/actions.ts` (load-more), `[membershipId]/page.tsx` (back link and now counts/button), `not-found.tsx`, `member-directory.ts`, plus `MembersList` rows needing per-row follow state (a batched `POST /v1/social/follows/state` with `membershipIds` ≤ 50 beats N calls). The "Membros" row left `/perfil` on 2026-10-12; the entry is "Encontrar pessoas" in Explorar (D-466), not a `/perfil` row.

### Pitfall 14: Dashboard counts member posts
The owner dashboard reads `feed_posts` in at least ten places (`content.ts:117,319`, `content-lists.ts:233,298`, `finance.ts:356`, `member-lists.ts:372,431,461,522` [VERIFIED: grep] and the `*_dashboard_*_functions.sql` definers). With `social` on, member posts enter "Conteúdo" ("every publication of the window", INSIGHT-10). See Open Question 3.

### Pitfall 15: Seeding `social` on rede-demo breaks the old suite
Enable it on **rede-lab** (3 members + admin + support, `modules: ['feed', 'events', 'reels']` [VERIFIED: scripts/seed.ts:200]) and add a `withSocialEnabled` helper beside `withStoreEnabled` [VERIFIED: apps/api/tests/integration/setup.ts:623] for the both-tenants-on isolation cases. rede-demo stays "exactly today's product".

### Pitfall 16: `GET /v1/members/{id}` must stay D-45
Do not add counts or a button to that route or to `memberProfileSchema` (the contract test feeds it a `role` key and must still fail). Note the roadmap's `profiles.ts:150` reference has drifted: the schema is now at line 159 [VERIFIED: grep].

## Code Examples

### Kernel seam stubs (declared before the policy that calls them)
```sql
-- Source: shape of supabase/migrations/20261008171502_community_gate_seam.sql
create or replace function app.social_enabled() returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;
revoke all on function app.social_enabled() from public;
grant execute on function app.social_enabled() to authenticated;

create or replace function app.social_visible_author_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$ select '{}'::uuid[] $$;
revoke all on function app.social_visible_author_ids() from public;
grant execute on function app.social_visible_author_ids() to authenticated;
```

### Seam bodies (social migration, hand SQL)
```sql
-- Source: pattern of 20261008171645_store_functions.sql (tenant pin, fail closed, same signature)
create or replace function app.social_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_modules tm
                  where tm.tenant_id = app.tenant_id() and tm.module_key = 'social' and tm.enabled)
$$;

create or replace function app.social_visible_author_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when app.tenant_role() = 'member' and app.social_enabled() then
      array_append(
        coalesce((select array_agg(f.followee_user_id)
                    from public.social_follows f
                   where f.tenant_id = app.tenant_id() and f.follower_user_id = app.user_id()),
                 '{}'::uuid[]),
        app.user_id())
    else '{}'::uuid[]
  end
$$;
```

### Drizzle policy (feed schema)
```typescript
// Source: shape of feed_posts_community_gate in packages/modules/feed/db/schema.ts:192-197
pgPolicy('feed_posts_social_gate', {
  as: 'restrictive',
  for: 'select',
  to: authenticatedRole,
  using: sql`visibility = 'tenant'
    or app.tenant_role() in ('admin_tenant', 'support_tenant')
    or author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))`,
}),
```

### `social_follows` (design; tenant_id first in every index)
```typescript
// Source: design; conventions from feedLikes (unique arbiter) and courseLiveReminders (own-row policies)
// columns: id, tenantId -> tenants on delete cascade, followerUserId/followeeUserId -> users on delete cascade, createdAt
// unique (tenant_id, follower_user_id, followee_user_id)        -- idempotency arbiter + "my followees" scan
// index  (tenant_id, followee_user_id, created_at desc, id desc) -- my followers list, counts
// check  follower_user_id <> followee_user_id
// select : tenant_id = app.tenant_id() and (follower_user_id = app.user_id() or followee_user_id = app.user_id())
// insert : tenant_id = app.tenant_id() and follower_user_id = app.user_id() and app.tenant_role() = 'member'
//          and app.social_enabled() and exists(live member membership of followee in this tenant)
// delete : tenant_id = app.tenant_id() and follower_user_id = app.user_id()      -- no update policy
// revoke update, truncate from authenticated (TRUNCATE is not seen by RLS)
```
Counts for another member come from a tenant-pinned definer `app.social_counts(p_membership uuid)` that joins `memberships` to exclude blocked/removed people (D-484), returns two ints, and answers null for a non-member target.

### Tolerant settings schema (module contracts)
```typescript
// Source: pattern of feedSettingsSchema (packages/modules/feed/contracts/index.ts:576-578)
// Caps come from the admin limits: MEDIA_LIMITS.image.post.maxBytes (15 MiB), FEED_MAX_IMAGES (10),
// MEDIA_LIMITS.video.post (500 MiB, 300 s) — a super_admin value can never exceed them.
export const socialSettingsSchema = z.object({
  media: z.object({
    photoMaxBytes: z.number().int().min(1).max(15 * 1024 * 1024).default(5 * 1024 * 1024),
    photosPerPost: z.number().int().min(1).max(10).default(4),
    video: z.object({
      enabled: z.boolean().default(false),
      maxDurationSeconds: z.number().int().min(5).max(300).default(60),
      maxBytes: z.number().int().min(1).max(500 * 1024 * 1024).default(100 * 1024 * 1024),
    }).default({ enabled: false, maxDurationSeconds: 60, maxBytes: 100 * 1024 * 1024 }),
  }).default({ photoMaxBytes: 5 * 1024 * 1024, photosPerPost: 4, video: { enabled: false, maxDurationSeconds: 60, maxBytes: 100 * 1024 * 1024 } }),
});
// Write with `settings = settings || $patch` (jsonb merge), never replace the blob.
```

### Locked answer
```typescript
// Source: shape of getPost's community_locked branch, packages/modules/feed/server/service.ts:624-629
if (found.socialLockedAuthor !== null) {
  throw new ApiError(403, 'FORBIDDEN', { access: 'follow_required', author: found.socialLockedAuthor });
}
throw new ApiError(404, 'NOT_FOUND');
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `feed.settings.postingPolicy` flips member posting | `social` module effective => member permissions | This phase (D-482) | One switch; `postingPolicy` ignored |
| Every feed post readable by every tenant member | Audience stamped per post, gated by RLS + service | This phase | Each feed read gains an audience predicate |
| Member video forbidden in the media broker | Member `post` video allowed by tenant settings | This phase | Kernel seam + duration snapshot |
| Directory staff-only (261016-jsq) | Members browse while `social` is on | This phase (D-466) | Role gate becomes composed-permission based |
| Moderation log covers comments, blocks, roles | Also posts | This phase (D-475) | CHECK widening, five touchpoints |

**Deprecated/outdated:** `FEED_POSTING_POLICIES` / `feedSettingsSchema.postingPolicy` (remove or leave parsed-and-ignored); the Admin-badge rule in `postAuthorAdminLabel` (now follows `social`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The pull model stays within budget for pilot-sized tenants (hundreds to low thousands of members); a fan-out table is only warranted far above that | Summary, Alternatives | A very large tenant needs the lateral per-followee form or a later fan-out; mitigated by the Wave 0 volume-fixture spike |
| A2 | A btree filters a non-leading key column inside the index scan (avoiding heap fetches for non-matching tuples), so a partial index with a trailing `author_user_id` makes `author = any(set)` cheap | Wave 0 spike | If not, use the lateral top-N per followee form (bounded by followees x page size) |
| A3 | The real production tenant has no member-authored posts and no `postingPolicy: members` | Runtime State Inventory | If it has, those posts keep `visibility='tenant'` (default) and stay in Início; harmless but surprising |
| A4 | Count queries over a popular member's followers (thousands of rows with a membership join) are acceptable live | Pattern 1 / Code Examples | A hot profile is slow; cache or denormalise later |
| A5 | `pg_stat_statements` counts only top-level statements, so the definer calls inside the Explorar statement do not raise the feed-table budget | Validation | If nested statements were counted the budget test would fail loudly, not silently |
| A6 | A support user holding a comment id could reach a member post's comment through comment-id routes (RLS exempts staff claims) | Pitfall 2 | Residual low-probability exposure; closed only by the sentinel alternative |
| A7 | Hiding a blocked author's posts also from the admin's Explorar (D-484 literal) is the intent | Open Question 5 | An admin cannot moderate a blocked member's old posts until unblocking |

## Open Questions

1. **D-474's premise "the general API rate limit applies" is false.** No limiter exists in `apps/api/src`.
   - What we know: media starts have only the soft tenant ceilings; follows and posts have nothing.
   - What's unclear: whether the user knows, and whether the pilot tolerates it.
   - Recommendation: do not build a limiter in this phase (D-474 declines quotas); tell the user, record it in DEPLOY.md "turning on `social`", and make the first mitigation (Cloud Armor / Cloud Run level, or a per-member hourly post count check) a named follow-up.

2. **Shared media pools.** Member photos and videos spend the same per-tenant 800 MiB and 3 h budgets as the admin.
   - Recommendation: give member-owned assets their own sub-budget (sum filtered by owner role `member` via `memberships`, or an `owner_role` stamp on `media_assets`), e.g. at most half of each ceiling, so a member flood cannot block the admin. Needs the user's number; default to half.

3. **Does the owner dashboard's "Conteúdo" include member posts?**
   - Recommendation: no; filter `visibility = 'tenant'` in the content builders and lists (snapshot SQL changes, no shape change), keeping INSIGHT-10's meaning "the organization's publications"; member likes/comments on any post still count as member activity.

4. **A `support_tenant` caller opening a member post link.** D-469 only describes members.
   - Recommendation: bare 404 for non-member roles without `moderation.manage` (they cannot follow, D-467, so a "Siga para ver" screen would be a dead end).

5. **Admin and a blocked author's posts.** D-484 says the posts "leave Explorar, Reels and the post link" for everyone; D-475 gives the admin every live member post.
   - Recommendation: apply D-484 literally (hidden for the admin too) — unblock to moderate; flag so the user can reverse.

6. **Stamp vs read-time role** (the one deviation from CONTEXT's default).
   - Recommendation: stamp `feed_posts.visibility` (reasons in Summary). CONTEXT permits it explicitly; the planner should still list it in the plan's decisions for the user to see.

7. **Staff viewing counts.** D-467 is explicit for staff *profiles*, silent about a staff *viewer* of a member profile.
   - Recommendation: the social profile read and counts are `member`-only; staff see D-45's profile.

8. **Author edit/delete while `social` is off** answers 403 (permission gone) rather than the bare 404 of D-483.
   - Recommendation: accept (the caller is the author; nothing about existence leaks).

9. **Explorar as `/inicio?aba=explorar` vs `/explorar`.** Planner's call per D-479.
   - Recommendation: `?aba=explorar`; the BottomNav keeps Início active (nav matches the path), and the chip row reuses `HubTabs`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Everything | yes | v24.14.0 | — |
| pnpm | Monorepo | yes | 12.4.1 | — |
| Supabase CLI | pgTAP, local stack, migrations | yes | 2.118.0 (repo pins 2.117.0) | — |
| Docker | Local Supabase stack | yes | Client 29.3.1 | — |
| Local Postgres (Supabase) | pgTAP, integration, EXPLAIN spike | yes (port 54322 accepting connections) | — | **Shared stack: do not run `pnpm db:reset` or the integration suites while researching; the Wave 0 spike must run on a scratch database or a rolled-back transaction** |
| Mux (real) | Real video duration | not needed locally | — | `VIDEO_PROVIDER=fake` (integration command from prior phases) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** real Mux for duration rejection — the fake provider exercises the same `applyReady` path.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (unit, per package), API integration (Vitest against the local stack), pgTAP via `supabase test db`, Playwright 1.63.0 (e2e) |
| Config file | `packages/modules/<pkg>/vitest.config.ts`; `apps/api` (`test` = `vitest run tests/unit`, `test:integration` = `vitest run tests/integration`); `apps/web` (`test`, `e2e`) |
| Quick run command | `pnpm --filter @rede-social/module-social test` (new); `pnpm --filter @rede-social/api test` |
| Full suite command | `pnpm db:generate 2>&1 \| grep -q "No schema changes" && pnpm db:reset && pnpm db:seed && pnpm supabase test db` then `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts`; `pnpm boundaries`; `bash scripts/check-ui-literals.sh`; `pnpm verify` at the exit gate |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SOCIAL-01 | key in `TOGGLEABLE_MODULES`, CHECK widened, off by default, `requires`, both-flag 404 | unit + pgTAP + integration | `pnpm --filter @rede-social/api test` (registry.test.ts extended); `modules.test.ts` | partly (extend) / ❌ Wave 0 |
| SOCIAL-02 | `permissionsFor` matrix (member under social/without/feed off; support; admin) | unit | `pnpm --filter @rede-social/api test` (registry.test.ts 6b rewritten) | ✅ extend |
| SOCIAL-03 | member create refuses attachments/communityId, stamps `followers`, edit/delete author-only | integration | `tests/integration/feed-social.test.ts` | ❌ Wave 0 |
| SOCIAL-04 | Início excludes followed posts; Reels Todos includes followed + own, excludes unfollowed | integration + pgTAP EXPLAIN | `feed-social.test.ts`; `supabase/tests/201-feed-social-gate.sql` | ❌ Wave 0 |
| SOCIAL-05 | limits at start/complete/publish, video off 403, duration reject, snapshot | integration (fake provider) | `VIDEO_PROVIDER=fake … social-media.test.ts` | ❌ Wave 0 |
| SOCIAL-06 | gate truth table: author / follower / non-follower / staff / moderator / other tenant / social off / blocked; locked body carries no caption/media/counts | pgTAP + integration | `201-feed-social-gate.sql`; `feed-social.test.ts` | ❌ Wave 0 |
| SOCIAL-07 | moderator removal + log row atomic, admin post still author-only, author not told | integration + unit (moderation-view) | `feed-social.test.ts`; `moderation-log.test.ts` extended | ❌ / ✅ extend |
| SOCIAL-08 | no intent for member post; `feed.post_commented` audience, retraction | unit + integration | `packages/modules/feed/tests/notification-sources.test.ts` extended; `notifications.test.ts` | ✅ extend |
| SOCIAL-09 | blocked/removed disappear and return; social off/on | integration | `feed-social.test.ts` | ❌ Wave 0 |
| SOCIAL-10 | route inventory, 010/020/160 lists, `db:generate` clean, README, DEPLOY | unit + pgTAP | `tests/unit/isolation-inventory.test.ts`; `010-rls-coverage.sql`, `020-tenant-isolation.sql`, `160-shared-identity.sql` | ✅ extend |
| FOLLOW-01..04 | idempotent follow, refusals, counts public/lists private, profile variant, D-45 contract test still fails with a `role` key | integration + pgTAP + unit | `tests/integration/social.test.ts`; `200-social.sql`; `packages/contracts/tests` | ❌ Wave 0 |
| FOLLOW-05/06 | button placement, directory gate | unit (web) + integration | `apps/web` Vitest; `members.test.ts` extended | ✅ extend |
| EXPL-01..06 | chips, Explorar list/empty states, composer entry, Reels mix, overlay from Explorar | unit (web) + e2e + `feed-query-budget.test.ts` | `apps/web/e2e/social.spec.ts`; budget test extended with an Explorar case at `FEED_LIST_STATEMENT_BUDGET = 1` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the touched package's Vitest (`pnpm --filter @rede-social/<pkg> test`) plus typecheck/lint of that package.
- **Per wave merge:** `pnpm supabase test db` (after `db:generate` is clean, reset and seed), `pnpm boundaries`, `bash scripts/check-ui-literals.sh`, and the phase's integration files (concurrency 4 post-merge gate per project memory).
- **Phase gate:** full suite green before `/gsd-verify-work` (pgTAP before integration: residue trips pgTAP 154 per project memory).

### Wave 0 Gaps
- [ ] Measured plan spike on a volume fixture (rolled-back, scratch DB): Início, Reels Todos, member Explorar (50 followees), moderator Explorar; decide `= any(set)` vs lateral per-followee; result recorded in the plan
- [ ] `supabase/tests/200-social.sql` — `social_follows` policies (own-row select, member-only insert, own delete, no update, cross-tenant negatives, shared identity)
- [ ] `supabase/tests/201-feed-social-gate.sql` — gate truth table + `feed_posts_social_gate` + comments/likes inheritance + EXPLAIN pins by index name
- [ ] `apps/api/tests/integration/social.test.ts`, `feed-social.test.ts`, `social-media.test.ts`; `withSocialEnabled` helper in `setup.ts`
- [ ] `apps/web/e2e/social.spec.ts`; seed `social` on rede-lab and two extra follow fixtures
- [ ] Update `090-feed.sql` / `130-reels.sql` index-name pins; `isolation-inventory.ts` entries; `010`/`020`/`160` lists; `feed.test.ts` case 7 and `registry.test.ts` 6b rewrite

## Security Domain

> `security_enforcement` is enabled (`workflow.security_enforcement: true`, `security_asvs_level: 1` in `.planning/config.json` [VERIFIED: file read this session]).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | Supabase Auth via BFF |
| V3 Session Management | no (unchanged) | HttpOnly cookies; blocked member cut off per request by `requireAuth` |
| V4 Access Control | **yes — primary** | Restrictive RLS + service predicate; permission guards from the composed set; bare 404 vocabulary; locked answer limited to author name/avatar |
| V5 Input Validation | yes | Zod `.strict()` schemas for follow, settings, `scope`; closed refusal vocabularies; member refusals as validation codes |
| V6 Cryptography | no | none new |
| V8 Data Protection / Privacy | yes | Lists private, counts public (D-468); locked answer discloses only author identity; no caption/body in logs (T-04-05/T-04-19 rule) |
| V13 API | yes | OpenAPI routes, route inventory entry per route, wrong-host 403 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Reading a non-followed member's post, comments or likes by id | Information disclosure | Restrictive RLS on `feed_posts` (comments/likes inherit) + service fragment + `media_asset_hidden` for video |
| Cross-tenant follow or post read | Information disclosure / Tampering | `tenant_id = app.tenant_id()` in every policy and definer, target liveness checked in the same tenant, bare 404 for foreign ids |
| Enumerating members through follow routes | Information disclosure | One bare 404 for unknown/other-tenant/staff/blocked targets; no list route takes a member id |
| Member forging `visibility = 'tenant'` or a community post | Elevation of privilege | Stamp from `ctx.role` in the service + restrictive insert policy + validation codes for `communityId`/attachments |
| Member bypassing media caps (declare small, upload large; long video) | Tampering / DoS (billing) | Cap re-applied at `complete`; duration judged by the ready job with a start-time snapshot; ready-only video at publish |
| Moderator removing an admin's post | Elevation of privilege | Removal limited to `visibility = 'followers'`; T-04-54 predicate kept |
| SSRF through member-supplied link previews | Tampering | Existing `assertAllowedUrl` + `guardedAgent` socket guard in the unfurl worker; more people can now submit URLs, so keep `feed-unfurl.test.ts` and `unfurl-guard.test.ts` in the phase gate |
| Follow/post/upload spam | Denial of service | No rate limiter exists (Open Question 1); document and monitor |
| Stored XSS in captions/display names | Tampering | Plain-text captions, React escaping, `linkify` scheme restriction (unchanged) |
| Removed/blocked member's content resurfacing | Information disclosure | Liveness predicate on the joined membership in every read; pgTAP/integration restore test |

## Sources

### Primary (HIGH confidence)
- In-repo files read this session (cited inline with paths and lines): `packages/modules/feed/{module.ts, server/service.ts, server/routes.ts, server/notifications.ts, server/notification-copy.ts, db/schema.ts, contracts/index.ts}`, `apps/api/src/modules/registry.ts`, `apps/api/src/routes/members.ts`, `apps/api/src/app.ts`, `packages/core/server/{rbac/require-role.ts, rbac/permissions.ts, modules/require-module.ts, modules/flags-cache.ts, modules/manifest.ts, moderation/log.ts, media/service.ts, media/limits.ts, media/video/event-job.ts, platform/modules.ts, profiles/service.ts}`, `packages/core/db/{community-gate.ts, course-gate.ts, rls.ts, tenant-tx.ts, schema/tenant-modules.ts, schema/memberships.ts, schema/moderation-log.ts}`, `packages/contracts/src/{modules.ts, access.ts, media.ts, moderation.ts, profiles.ts, platform.ts}`, `packages/modules/{reels/module.ts, notifications/server/system-context.ts, courses/package.json + README}`, migrations `20261008171502_community_gate_seam.sql`, `20261008171520_feed_community_sample.sql`, `20261008174609_feed_gate_lookups.sql`, `20261008175334_feed_community_gate_policies.sql`, `20261008171645_store_functions.sql`, `20260926184147_reels_module.sql`, `20261002123245_moderation_log_immutable.sql`, web files (`lib/registry.tsx`, `lib/feed.ts`, `lib/reels.ts`, `lib/member-directory.ts`, `lib/feed-view.tsx`, `lib/notification-renderers.tsx`, `app/(app)/{inicio,membros,criar,cursos}/…`, `components/reels/ReelsOverlay.tsx`), `apps/api/tests/{isolation-inventory.ts, integration/feed-query-budget.test.ts, integration/feed.test.ts, unit/registry.test.ts}`, `scripts/seed.ts`, `docs/DEPLOY.md` headings, `.planning/{REQUIREMENTS.md, ROADMAP.md, STATE.md, config.json}`, phase 09 CONTEXT and DISCUSSION-LOG, `reference/frontend-design/components/profile/{FollowButton, ProfileStats, UserListItem}.tsx`.

### Secondary (MEDIUM confidence)
- None used (no external research was needed; the phase installs no package and touches no third-party API).

### Tertiary (LOW confidence)
- Query-plan behaviour claims (A1, A2, A4, A5) are reasoning, not measurement; Wave 0 turns them into measurements.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; every library already pinned and in use.
- Architecture: HIGH — each recommendation maps to a read seam with a working twin (08.2 gate, 08-01 moderation, 05.3 Reels filter); the deviations (stamp, two Início predicates, member media seam) are justified against read code.
- Pitfalls: HIGH for the enumerated code touchpoints (grep-verified); MEDIUM for performance pitfalls (to be measured).

**Reconciled 2026-10-19:** CONTEXT's Admin-badge line was amended to the stamped audience (UI-D-509), which is already finding (1) of this research; no finding here changed.

**Research date:** 2026-10-19
**Valid until:** 2026-11-18 (stable, in-repo; re-check `registry.ts`, `feed/server/service.ts` and the media broker if another phase lands first; note HEAD moved to 66824bdc "move the member area from /cursos to /area-membros" during this session — it does not affect these findings, but `HubTabs`/`tabs.ts` references should be re-read at planning time)

*Reconciled 2026-10-19 with CONTEXT.md after a bullet-format-only change (two carried-forward bullets re-tagged so the decision-coverage gate parses them); no decision changed.*
