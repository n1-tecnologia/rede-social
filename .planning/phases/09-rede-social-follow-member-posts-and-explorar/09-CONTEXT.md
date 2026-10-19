# Phase 9: Rede Social - Follow, Member Posts and Explorar - Context

**Gathered:** 2026-10-19
**Status:** Ready for planning

<domain>
## Phase Boundary

A tenant can open up member authoring. With the new toggleable module **"Rede social"** (key `social`) on, members follow each other and publish feed posts, and a new **Explorar** view shows only the posts of the people a member follows. Início stays the organization's voice (posts by `admin_tenant` only).

What the phase delivers, on top of the seven roadmap criteria (which stay locked as written in `.planning/ROADMAP.md` § Phase 9):

- The `social` module: off by default, toggled per tenant by `super_admin`, superseding the feed's `settings.postingPolicy` flag (FEED-08).
- A one-directional follow graph between members, with counts on the member profile and private own lists.
- Member feed posts (text, photos, video where the tenant allows it, link), shown only in the Explorar of the author's followers (and in the author's own).
- Explorar as a chip beside Início, with the same likes, comments and share as the feed.
- Member videos in Reels "Todos", for followers only.
- Bounded member media (limits set per tenant by `super_admin`).
- The minimum safety net that cannot wait for Phase 11: the admin sees and removes member posts, and a member post no longer notifies the whole tenant.

Out of this phase (other phases own them):
- Member stories and member-created communities, and the rule that only a community's creator publishes in it (Phase 10).
- Direct messages ("Enviar mensagem"), member-to-member blocking, reports and the reports queue, removal of member stories and communities, and the "started following you" notice (Phase 11).
- Any personal or profile feed (explicitly out of scope, user decision 2026-09-25).

</domain>

<decisions>
## Implementation Decisions

Decision numbers continue after 08.7's D-465. UI decisions in this phase's UI-SPEC continue after UI-D-490.

### Carried forward (locked before this discussion, do not re-open)
- **D-45 [informational] (Phase 3):** another member's profile shows photo, display name and bio only, enforced by `memberProfileSchema.strict()` in `packages/contracts/src/profiles.ts`. Roadmap criterion 5 reverses it only while `social` is on and only for members (D-467 keeps it for staff).
- **261016-jsq [informational] (quick):** `GET /v1/members` is staff-only; `GET /v1/members/{id}` (the profile opened by a name) stays open to members. D-466 reopens the list for members under `social`.
- **D-117 / D-118 [informational] (05.3):** the first Reels lane "Todos" holds every video Reels can show; lanes after it are communities. D-480 keeps that meaning.
- **D-124 [informational] (05.3, reversed 2026-10-09):** one tap on a feed video opens `ReelsOverlay` over the feed at that video, with a return arrow to the same place.
- **D-419 [informational] (08.5):** the BottomNav holds five tabs; a module that needs a sixth makes another yield to the TopBar. D-479 avoids a new tab.
- **D-23 / TENANT-04 [informational]:** a post that is unknown, another tenant's or removed answers one bare 404 with no distinguishing code.
- **T-04-54 [informational] (Phase 4):** edit and delete of a post are decided by `author_user_id = ctx.userId` in the statement, not by a role. This already makes them author-only for members.
- **D-462 [informational] (08.7):** named lists of people are never open to everyone; precedent for D-468.
- **D-121 [informational] (05.3):** a module that builds on another (`reels` on `feed`) contributes nothing while the base is off. `social` follows the same rule.

### Following and finding people
- **D-466:** `/membros` reopens to role `member`, only while `social` is on for the caller's tenant. `GET /v1/members` (with or without `?q=`, `cursor`, `limit`) then accepts `member`; with `social` off it stays staff-only (403 `FORBIDDEN`) exactly as in 261016-jsq. The page reuses `MembersList` (search by name, 25 per page). Explorar carries an "Encontrar pessoas" entry to it, and the empty state of criterion 4 points to it. PROF-03 and criterion 4 of the roadmap are reworded at planning (08.7's deferred note).
- **D-467:** the follow graph is member to member only. `admin_tenant` and `support_tenant` are outside it: no Seguir button and no counts on their profile (D-45 holds for them), they follow no one, they cannot be followed, and the member-facing directory lists members only. The API refuses a follow whose follower or target is not a live `member` of the tenant, and a self-follow.
- **D-468:** counts are public, lists are private. Any member sees the follower and following counts on any member's profile (criterion 5). Only the owner opens their own "Seguidores" and "Seguindo" lists, and unfollows from "Seguindo". There is no route that takes another member's id for a list; the user comes from the session, as in D-463. Opening lists to everyone later is easy, closing them is not, so they start private.
- **D-469:** a member post opened by someone who is not allowed to see it is a locked answer, not a 404. The caller is not the author, does not follow the author and is not holder of `moderation.manage`. The API returns the author's display name and avatar only; caption, media, counts and comments never leave the server. The web shows a "Siga para ver" screen with the Seguir button, and following opens the post. Likes, comment reads and comment writes on that post follow the same gate. An unknown id, another tenant's id, a removed post, a blocked author's post (D-484) and `social` off (D-483) stay the bare 404.
- **D-470:** the Seguir/Seguindo button appears on the member profile (next to the counts), on the "Siga para ver" screen and on each row of `/membros` (the prototype's `UserListItem`). It does not appear in comment rows, post headers or the Reels rail: posts in Explorar and member videos in Reels already come from followed people.

### Own posts and the composer
- **D-471:** a member's own posts appear in their own Explorar, mixed with the followed people's by `(created_at, id)`, newest first. There is no "Minhas publicações" list and no profile feed. Edit and delete come from the card's `PostMenu`. The author's own videos also appear in Reels "Todos" (D-480).
- **D-472:** a member publishes from Explorar only. `ComposeFab` shows in Explorar for role `member` while `social` is on, and the member lands on top of Explorar after publishing. Início keeps the button for `admin_tenant` only, so nobody publishes from Início a post that Início would not show.
- **D-473:** a member post carries a caption, photos, at most one video (only where the tenant allows it) and a link with its usual preview. It carries no attachment (PDF) and no community: the post is born with `community_id` null. The API refuses `attachments` and `communityId` from a member with a validation code, not only through a hidden control. Phase 10 decides who publishes into a community.
- **D-474:** member media limits live in `tenant_modules['social'].settings` and are edited per tenant by `super_admin` in the platform panel, the seam `postingPolicy` used. Defaults: photos 5 MB each and 4 per post; video off; when `super_admin` turns video on, 60 s and 100 MB. The limits apply to new uploads only: lowering one or turning video off removes and hides nothing already published. There is no per-member quota (daily posts or storage) in this phase; the general API rate limit applies and a quota is revisited if the pilot shows abuse.

### Safety net until Phase 11
- **D-475:** removal of member posts is pulled forward from MODER-04, posts only. A holder of `moderation.manage` (today `admin_tenant` only) sees in Explorar every live member post of the tenant without following anyone, and soft-deletes any of them (`deleted_at`, `deleted_by`) with a `moderation_log` entry in the same transaction, the author not told, the same shape as MODER-01's comment removal. The reports queue, member stories, communities and "block author from a report" stay in Phase 11. MODER-04 is split in REQUIREMENTS.md at planning. `support_tenant` does not hold `moderation.manage`, so it gets neither the staff Explorar nor the removal.
- **D-476:** a member's post notifies nobody. `post.published` for a member-authored post produces no intent, so the all-members broadcast (`feed.post`, `feed.reel`) stays admin-only and no new post kind is added. Phase 11 decides whether followers are told, together with "started following you" (Phase 11 criterion 3 is answered "nobody" until then).
- **D-477:** the author of a member post is told when someone comments on it. A new kind `feed.post_commented` goes through the Phase 7 fan-out on channels `['in_app','push']`, for first-level comments only, on member-authored posts only, the commenter excluded. A like does not notify (grouping is V2-NOTIF-02). It is retracted on comment or post deletion by the existing keep-and-mark path. Admin posts keep today's behaviour. — **Reversibility:** costly — notification kinds are stored strings, and producers and consumers grow around them (as D-448).
- **D-478:** terms, rules and privacy are a go-live item, not a code gate. `DEPLOY.md` gets a "turning on `social`" item (review of the platform terms, the tenant rules and the privacy policy for third-party content and liability), and the platform panel asks `super_admin` to confirm when turning `social` on, pointing to that item. Members see no re-acceptance screen; the admin edits the tenant rules (AUTH-04). Pending, not code: the legal wording. Flag it to the user before `social` is turned on for any tenant.

### Navigation
- **D-479:** Explorar is a chip beside Início. Início and Explorar are two chips on the same area (the `?aba=` pattern of `/cursos`, `HubTabs` and `tabs.ts`), shown while `social` is on to role `member` and to holders of `moderation.manage`. The BottomNav and TopBar do not change. Explorar opens clean: chip row, feed, empty states. It has no welcome block and no stories strip (Phase 10 adds the member story row). With `social` off there are no chips and Início is exactly today's. Whether Explorar is `/inicio?aba=explorar` or its own route is the planner's call, as long as links from notices and shares stay stable.

### Reels
- **D-480:** member videos join "Todos" by date. "Todos" keeps its D-117 meaning: admin videos, the videos of people the viewer follows and the viewer's own, newest first on the `(created_at, id)` cursor. There is no new lane. A member video has no community, so it appears in "Todos" only and shows no community chip. Likes and comments are the feed's own (criterion 7). Holders of `moderation.manage` see the member videos in Explorar, not in Reels.
- **D-481:** tapping a video in Explorar opens `ReelsOverlay` at that video, with the return arrow to the same place in Explorar, as in Início (D-124). The queue is "Todos", which now includes the followed videos, so the tapped video is always in it.

### Roles and on/off
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

### Folded Todos
None. `todo.match-phase` found no pending todos for Phase 9.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` § Phase 9: the goal, the seven locked success criteria, the UI hint, the research note. Also § Phase 10 and § Phase 11 for what is NOT here (member stories/communities; DMs, member block, reports, MODER-04 rest, follower notices).
- `.planning/REQUIREMENTS.md`: PROF-01..03 (profile and directory, to reword), FEED-01..08 (FEED-08 generic authorship), V2-CONT-01 (promoted here), MODER-01..05 (MODER-04 to be split), AUTH-04 (consents), NOTIF-01..04 (fan-out and channels), CHAT-06/07 (Phase 11, context only). The new SOCIAL-*, FOLLOW-*, EXPL-* requirements are written at planning.
- `.planning/PROJECT.md`: core value (zero leakage between tenants), MOD-01..05, the Key Decisions table.
- `docs/pendencias-backend.md` item 7: why `/membros` became staff-only and what the API enforces.

### Prior decisions that constrain this phase
- `.planning/phases/05.3-reels/05.3-CONTEXT.md`: D-117..D-132 (lanes, `reels` module, `ReelsOverlay`, rail, visibility), D-121 (module depends on `feed`).
- `.planning/phases/08.7-dados-reais-do-perfil/08.7-CONTEXT.md`: D-462 (privacy stance), D-463 (own-rows-from-session pattern), and its deferred note on PROF-03 and criterion 4.
- `.planning/phases/08.6-area-de-membros/08.6-CONTEXT.md` and `.planning/phases/08.5-liberacao-de-cursos-e-lives-para-o-membro/08.5-CONTEXT.md`: D-419 (tab budget, `yieldsTabTo`), D-435 (chips pattern with `?aba=`), D-448..D-454 (notification kinds, retraction, `notificationSources`).
- `.planning/phases/04-feed/04-CONTEXT.md` and `04-UI-SPEC.md`: D-51..D-62 (one post model, comments, share), the card, composer and comment-sheet contracts.
- `.planning/phases/03-media-pipeline-member-profiles/03-CONTEXT.md`: D-43..D-52 (media, profiles, directory, D-45).
- `.planning/phases/08-moderation-tenant-admin-panel-pilot-hardening/08-CONTEXT.md`: MODER-01..03, the moderation log, `moderation.manage`, tenant-level block.

### Prototype (screens and rules)
- `reference/frontend-design/components/profile/FollowButton.tsx`, `ProfileStats.tsx`, `ProfileHeader.tsx`, `UserListItem.tsx` and `reference/frontend-design/app/(app)/profile/{followers,following}/page.tsx`: the Seguir button, counts and list rows to port. `reference/frontend-design/app/(app)/explore/page.tsx` is NOT the model: Explorar here is a following-only feed, not search/trending.
- `.planning/research/PROTOTYPE.md`: porting rules; the follow graph was out of scope until the 2026-09-25 pull-in.

### Code this phase extends
- `packages/modules/feed/module.ts`, `contracts/index.ts` (`feedSettingsSchema`, `FEED_POSTING_POLICIES`, `FEED_NOTIFICATION_KINDS`, `FEED_MAX_IMAGES`), `server/service.ts` (`postProjection`, `feedPage`, `createPost`, `updatePost`, `deletePost`), `server/routes.ts`, `server/notifications.ts` (`postAudience`, `feedNotificationSources`, `feedNotificationRetractions`), `db/schema.ts`.
- `apps/api/src/modules/registry.ts` (`permissionsFor`, `setPermissionResolver`) and `packages/core/server/rbac/require-role.ts` (`KERNEL_ROLE_PERMISSIONS`, `moderation.manage`).
- `packages/core/server/modules/manifest.ts`, `packages/core/db/schema/tenant-modules.ts` and `packages/contracts/src/modules.ts` (`TOGGLEABLE_MODULES`, the source of `tenant_modules_key_chk`).
- `packages/core/server/moderation/log.ts` (`recordModerationAction`) and `packages/contracts/src/moderation.ts`.
- `packages/contracts/src/profiles.ts` (`memberProfileSchema`), `packages/contracts/src/media.ts` (`MEDIA_LIMITS`).
- `apps/web/app/(app)/membros/` (`MembersList.tsx`, `page.tsx`, `[membershipId]/page.tsx`), `apps/web/lib/member-directory.ts`, `apps/web/lib/profile.ts`.
- `apps/web/app/(app)/inicio/page.tsx`, `apps/web/app/(app)/cursos/tabs.ts` and `HubTabs.tsx` (the chip pattern), `apps/web/app/(app)/criar/` (`ComposerForm.tsx`, `actions.ts`, `page.tsx`), `apps/web/app/(app)/post/[postId]/` and `apps/web/components/feed/PostDetail.tsx`.
- `packages/modules/feed/ui/` (`ComposeFab.tsx`, `PostMenu.tsx`, `PostHeader.tsx`, `FeedList.tsx`, `CommentsList.tsx`), `packages/modules/reels/` (`module.ts`, `ui/`), `apps/web/components/reels/ReelsHost.tsx`.
- `apps/web/lib/feed-view.tsx` (Admin badge, `postingPolicy`) and `apps/web/lib/registry.tsx`.
- `packages/core/ui/nav.ts`: `buildNav`, to confirm the chip needs no nav change.
- `apps/api/tests/integration/isolation.test.ts` and the isolation inventory: every new route joins it.

### Design
- `.planning/sketches/MANIFEST.md`: the D-33/D-365 review record. Prototype-less surfaces here (Explorar chip and empty states, "Siga para ver", the private lists, the member composer inside Explorar, the platform panel's `social` settings) go through the sketch gate and a UI-SPEC before UI tasks.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`postProjection` / `feedPage`** (`packages/modules/feed/server/service.ts`): one statement per page with author, likes, media and community joined, keyset on `(created_at, id)`. Explorar is one more predicate over it. Reels already filters it with `media=video`.
- **`MembersList` and `/membros`**: search by name and pagination exist; the change is who may call `GET /v1/members` and which rows a member sees (members only, not blocked).
- **`HubTabs` / `tabs.ts` and `?aba=`**: the chip row pattern already used by `/cursos` for the member and the manager.
- **`ComposeFab`, `ComposerForm`, `PostMenu`**: the composer entry, the form and the author menu; the author-only predicates already exist in `updatePost`/`deletePost`.
- **`ReelsOverlay` and the reels host**: the overlay opened from a feed video; the queue is the Reels "Todos" list.
- **`recordModerationAction`**: the moderation log write used by MODER-01's comment removal; the post removal of D-475 uses the same shape.
- **`notificationSources` / `notificationRetractions`**: the declared fan-out and keep-and-mark seams; `feed.comment_replied` is the closest pattern for `feed.post_commented`.
- **`TOGGLEABLE_MODULES` and the registries**: how `reels` and `courses` were added as module keys, including the check-constraint migration and default-on/off per tenant.
- **`MEDIA_LIMITS`**: today's admin limits (image 15 MB, video 500 MB / 300 s, attachment 50 MB, 10 images, 5 attachments) that the member limits sit under.

### Established Patterns
- Business reads go through the Hono API with RLS and the `api_user` role; a member-visible gate that depends on another row (follow, role, block) is a definer or a join with explicit tenant and role checks. Every new route joins the isolation inventory and every new policy gets pgTAP negatives.
- A module that needs another contributes nothing while the base is off (D-121); module flags gate UI and API alike and a disabled module's routes answer 404 (ROLE-06).
- Module packages ship no language: every label arrives from the host's pt-BR catalog; `scripts/check-ui-literals.sh` enforces it.
- Expand-only migrations applied before the API; hand-written SQL for definers and constraints.

### Integration Points
- `permissionsFor` and the bootstrap `permissions`: `feed.post.create` for `member` becomes `social`-conditional; the web composer reads the same value, so UI and API cannot disagree.
- `/inicio`: gains the chip row only while `social` is on; Explorar renders inside the same area.
- `GET /v1/members`: the role gate becomes `social`-conditional (D-466).
- The post read path (`/post/[postId]`, likes, comments) gains the D-469 visibility gate for member-authored posts.
- `post.published` fan-out: member-authored posts produce no intent (D-476).
- The platform panel's tenant modules screen: the `social` toggle, the limits form and the confirmation of D-478.

</code_context>

<specifics>
## Specific Ideas

- The user wants Início to stay "the organization's voice": a member's post never shows there, and a member never publishes from there (D-472).
- "Siga para ver" is meant to turn a shared link into a way to discover and follow someone, while keeping the post closed (D-469), the same shop-window idea the locked communities use.
- The privacy stance matches the recent decisions (staff-only directory on 2026-10-16, "menos de 5" in the owner panel): open less first, because opening later is cheap and closing is not (D-468).
- The composer for members is deliberately smaller than the admin's: no PDF, no community, video off by default (D-473, D-474).

</specifics>

<deferred>
## Deferred Ideas

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

</deferred>

---

*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Context gathered: 2026-10-19*
