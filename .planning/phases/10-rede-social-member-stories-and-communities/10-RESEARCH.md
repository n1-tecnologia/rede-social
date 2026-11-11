# Phase 10: Rede Social - Member Stories and Communities - Research

**Researched:** 2026-11-10
**Domain:** Creator-scoped publishing seam over an existing Hono + Drizzle + Supabase-RLS multi-tenant monorepo (communities, stories, feed, social, moderation log, member media seam)
**Confidence:** HIGH on where the seams are and what breaks (every claim below was read in the repo this session); MEDIUM on three design choices flagged in the Assumptions Log (they need one line from Igor before they become locked)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Decision numbers continue after 12.3's D-700. UI decisions in this phase's UI-SPEC continue after UI-D-696.

**Carried forward (locked before this discussion, do not re-open)**
- **D-466..D-484 [informational] (Phase 9):** the `social` module, the follow graph (member to member only, D-467), the member's posts visible only to followers, the staff Explorar and the post removal with a log row (D-475), `permissionsFor` granting member authoring from `social` being effective (D-482), off hides everything and on brings it back (D-483), a blocked member's content leaves every list (D-484). Every one of these keeps holding.
- **D-469 [informational] (Phase 9):** a followers-only item opened by someone who may not see it is a locked answer for a post. This phase does NOT add a locked screen for stories or communities (see D-705, D-701).
- **D-472 [informational] (Phase 9):** Início is the organization's voice and the member composer lives in Explorar only; the `ComposeFab` of Explorar stays for posts (D-714).
- **D-473, D-474 [informational] (Phase 9):** a member post carries a caption, photos, at most one video (where the tenant allows it) and a link, no attachment, no community; the limits live in `tenant_modules['social'].settings`, edited by `super_admin`. D-709 replaces only the "no community" half.
- **D-616 [informational] (Phase 13, NATIVE-31/NATIVE-33):** the member block (`member_blocks`) and its content filter are kernel, not gated by `social`; the report slice for posts and comments is delivered there. This phase does not plan them again.
- **D-89 [informational] (Phase 5/05.1):** the archived-communities list is a manager read; the web and the API both refuse a caller without the permission.
- **D-23 [informational]:** an unknown, other-tenant or removed id answers one bare 404 with no distinguishing code.
- **T-05-03, T-05-25 [informational]:** community and story write guards are PERMISSIONS (`communities.community.manage`, `stories.story.manage`, `stories.story.publish`), never a role comparison.
- **D-121 [informational] (05.3):** a module that builds on another contributes nothing while the base is off.

**Who sees what a member creates**
- **D-701:** a member-created community is listed and opened by the **whole tenant**, exactly like an organization community: cover, name, description, posts and highlights are readable by every member, who may like and comment. COMM-02 stands ("every tenant member sees every community that is not locked"). There is no "Siga para ver" screen for communities. The store lock (STORE-11) never applies to a member community because a member cannot link products to it (D-713).
- **D-702:** the posts a creator publishes in their community appear **only on that community's page** (and its own Reels lane, see Claude's Discretion). They are not in Início (SOCIAL-04 keeps Início organization-voice only, which today includes the merged feed's community posts, D-73, so the merged feed must exclude posts of member communities) and not in Explorar (D-471's predicate `community_id is null` stays).
- **D-703:** a member-created community shows **"Criada por Fulano"** in its header and on its card in the list; the name opens that member's profile (where the Seguir button is). Organization communities carry no such label. This projects the creator for the first time (D-67 kept `created_by_user_id` for audit only): only the display name, avatar asset id and membership id leave the server, never the user id.
- **D-704:** a member's active story shows **only in the Explorar row** (one circle per author). There is no ring on the profile, the `/membros` list, post headers, comments or any other avatar. Opening these later is easy; closing is not (D-468's stance).
- **D-705:** a member story is readable only by its author, the author's followers and holders of `moderation.manage`; the story read, its likes and its comments follow the same gate. For anyone else the story read answers the bare 404 (stories have no shared link to turn into a "Siga para ver" screen).

**The creator rule**
- **D-706:** the **owner rule**, stated per community kind: a community created by `admin_tenant` (the organization's voice) accepts posts, stories and highlights from **any `admin_tenant`**, as today (D-482: a second admin is the organization's voice too); a community created by a member accepts them **only from that creator**. Nobody else publishes: the API answers `403 FORBIDDEN`, the web shows no publish control, and others still like and comment. This **refines roadmap criterion 3** ("only the creator, for admin and member communities alike") because the literal reading would lock a second admin out of the first admin's communities in every tenant that has more than one admin (user decision 2026-11-10). — **Reversibility:** costly — the rule lands in the post, story and highlight write seams, in RLS and in the permission composition; tightening it to the literal reading later changes who can publish in existing communities.
- **D-707:** a member's authoring permissions for communities come from the composed permission set like D-482: with `social` effective, role `member` holds the permission to **create** a community and to **manage and publish in the ones they own**; the ownership test is `created_by_user_id = ctx.userId` in the statement (as T-04-54 does for posts), never a role comparison. `admin_tenant` keeps `communities.community.manage` over every community.
- **D-708:** when the creator of a member community is **blocked by the admin or leaves the tenant** (`memberships.blocked_at` set or the membership soft-deleted), the community, its posts, its highlights and its stories **leave every list and answer the bare 404**, nothing is deleted, and unblocking brings it all back, as D-484 does for posts. There is no transfer of ownership.
- **D-709:** a creator publishes in their community the **same post a member publishes** (D-473): caption, photos, at most one video where the tenant allows it, and a link with its preview; **no PDF**, under the same `social` media limits. The post is born inside the community (`community_id` set). The API's `member_no_community` refusal is replaced by the owner rule of D-706 for member authors; a member still cannot publish in a community they do not own, and still cannot attach a PDF anywhere.

**Creating and moderating**
- **D-710:** each member may own a limited number of communities, **default 3**, stored in `tenant_modules['social'].settings` beside the media limits (D-474), edited per tenant by `super_admin` in the platform panel's `social` form. Archived and removed communities do not count. Over the limit, the API refuses with a validation code and the web shows a notice, not only a hidden button.
- **D-711:** the admin **keeps moderation** over what members create, and the log row ships **in this phase**: a holder of `moderation.manage` soft-deletes any member story and archives or removes any member-created community, and each action writes a `moderation_log` row in the same transaction (the shape of D-475; the author is not told). MODER-04 is split again at planning: posts were SOCIAL-07 (Phase 9), stories and communities are delivered here, and Phase 11 keeps the reports queue and "block author". Today `deleteStory` and the community writes already accept any admin without an author predicate; the change is that a **member** may only touch their own, while the admin keeps every row and now leaves a trace. — **Reversibility:** costly — the moderation log's action/subject vocabulary is stored strings (and may sit behind a check constraint), so the new values land in a migration and in every reader of the log.
- **D-712:** in the Comunidades list, **organization communities come first in the admin's order** (`position`, then activity), and **member communities follow, newest activity first**. A member cannot reorder anything and a new member community never jumps above the organization's. `PUT /v1/communities/order` stays admin-only and covers organization communities only.
- **D-713:** a creator can do with their own community **everything the admin does with theirs**: edit name, description and cover, archive, reactivate, delete an archived one (PEND-01..14's rule) and curate its highlights (05.2). They **cannot link store products** to it (that field is absent from their form) and **cannot reorder** the list. The create and edit form is 05.1's `CommunityForm` without the products field. The creator reads their own archived communities (the D-89 archived read, scoped to their own rows).

**Member stories**
- **D-714:** a member publishes a story from **their own circle, the first circle of the Explorar row**, shown with a "+" when they have no active story (the Instagram model). That opens the member version of the publish screen. The Explorar `ComposeFab` stays for posts only; there is no second entry point.
- **D-715:** a member story carries a photo or a video and an optional caption, lives **24 hours**, and uses the **same limits as a member post**: photo bytes from `social.media`, video only when `super_admin` turned member video on, with its seconds and bytes limit. No new limits block in the platform panel. A member whose tenant has video off does not see the video control.
- **D-716:** a creator may save one of their own stories in a **highlight of their own community**. A story saved there is readable by **everyone who sees the community**, including after the 24 hours, because saving it is the act of publishing it in that community. The publish and highlight screens say so before confirming ("Todos os membros verão este story na comunidade").
- **D-717:** a holder of `moderation.manage` sees **every member's active story in the Explorar row** without following anyone (the admin is outside the follow graph, D-467), one circle per member, and deletes any of them from the story menu (D-711). Início's circle is untouched.

**Module switch**
- **D-718:** with `social` off, every **write** that a member holds only because of `social` stops (create a community, edit/archive/delete one's own, publish a post, a story or a highlight in it): the member permissions leave the composed set, so the guards answer 403, as D-482 does for posts. **Reads of communities stay**: existing member communities, their posts and their highlights remain readable by everyone who sees communities (roadmap criterion 4). Member **stories** leave the Explorar row (Explorar itself is gone while `social` is off, D-483) but a story already saved in a community highlight stays. Nothing is deleted; turning `social` on again restores the writes. The admin's moderation of D-711 keeps working while `social` is off.

### Claude's Discretion
Each item has a stated default. The planner may refine it but should not reverse it without asking.

**Rules of the seam**
- Whether a community is an "organization" or a "member" community is **stamped at creation** from the creator's role at that moment (the way Phase 9 stamped `visibility` instead of reading the role at read time), so a later promotion or demotion of the creator does not move the community between kinds. Research may find a reason to derive it at read time instead.
- Reels: a video posted in a member community appears in **that community's lane** for everyone who sees the community; "Todos" keeps D-480's meaning (the organization's videos plus the followed people's and the viewer's own posts with no community) and does not list member-community videos.
- Likes and comments on a member story work like on an organization story (STORY-05: story comments cannot be liked or replied to), for the readers D-705 allows.
- Two communities with the same name stay legal (distinct slugs), as today. A creator whose community the admin removes or archives is **not told**.
- Nobody is notified of a new member story or community (Phase 11 decides).
- The blocker's content filter of NATIVE-33 (Phase 13, `member_blocks`) covers the new content kinds too: a member the viewer blocked disappears from the Explorar story row and their communities leave the viewer's lists. This follows the intent of D-616; verify against the Phase 13 plans already executed.

**Explorar row**
- Order: own circle first, then unseen circles before seen ones, then by recency, reusing 05.2's grouped viewer and its seen state (HIGHLIGHT-06). The row is cursor-bounded for the moderator, who can see many circles.

**Media and storage**
- The member media seam (D-474, SOCIAL-05: `setPermissionResolver`, member-owned uploads draw from half of each tenant ceiling) today knows the `post` purpose; it extends to the **story** and **community cover** purposes with the same ceilings.

**Rollout**
- The seed keeps `social` on for the isolation tenant and adds one member community and one member story for the suites. The real tenant stays off. `docs/DEPLOY.md`'s "Ativar a Rede social" item (D-478) gains a line on member stories and communities.
- Every new route joins the two-tenant isolation inventory with a positive control, every new policy gets pgTAP negatives (owner, non-owner member, follower, non-follower, moderator, support, system lane, other tenant), and migrations are expand-only and ship before the API, as in Phase 9.

### Deferred Ideas (OUT OF SCOPE)
- **Follower notices for member stories and communities** ("Fulano published a story", "new community"), "started following you", direct messages and the block's effects on messaging: Phase 11.
- **A story ring on the profile, `/membros` rows, post headers or any avatar:** declined for now (D-704).
- **A "De membros" section in the Comunidades list:** declined in favour of one list ordered by D-712; revisit if the list grows.
- **Transferring a community to another owner** when the creator is blocked or leaves: declined (D-708).
- **Private or opt-in communities** using `community_members`, and member communities with store products: V2.
- **PDF attachments from members, anywhere:** admin only (D-473, D-709).
- **A separate limits block for member stories in the platform panel:** declined, stories reuse the post limits (D-715).
- **Showing member-community posts in Explorar for followers of the creator:** declined (D-702); revisit with the Phase 11 notice rules.
- **Requirement and roadmap rewording at planning:** roadmap criterion 3 (D-706, any admin for organization communities), MODER-04 (stories and communities delivered here, "block author" stays in Phase 11), Phase 11's criterion 4 and Executar list (the removal and log of member stories and communities move to Phase 10), and the new requirement ids for this phase.
</user_constraints>

## Project Constraints (from CLAUDE.md)

Directives extracted from `/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/CLAUDE.md` that bind this phase (same authority as locked decisions):

- **Multi-tenant from day one, zero leakage between tenants** (core value). `tenant_id` + RLS on every table as defense in depth; production tenants are physically separate Supabase projects (Phase 09.2/09.4), local/CI/homolog share one project. Every migration must therefore run unchanged on a per-tenant project.
- **All business logic goes through the Hono API** (Node/TypeScript on Cloud Run). The browser talks to Supabase only for Auth and read-only Realtime Broadcast. No new browser-to-Supabase data path.
- **Modularity (MOD-01..05):** each feature is a self-contained package depending only on the kernel and other modules' *published contracts*. A module may not import another module's package (`turbo boundaries` denies it). Cross-module reads are raw SQL by table name or a kernel seam.
- **Design:** UI follows the design team's prototype; prototype-less surfaces go through the sketch gate (D-33/D-365) and the approved `10-UI-SPEC.md`. Module UI packages are props-only; every pt-BR word lives in the host catalogs (`scripts/check-ui-literals.sh`).
- **Schema must anticipate V2 without rewriting core tables**; migrations are expand-only, applied by the Supabase CLI (drizzle-kit only *generates*; never run both appliers). Runtime DB role is `api_user` (`NOBYPASSRLS`), never `service_role`/`postgres` for tenant queries.
- **Tests:** Vitest 5, pgTAP via `supabase test db` ("every policy gets a cross-tenant negative test"), Playwright on mobile viewports. Biome for lint (no ESLint). pt-BR UI.
- **GSD workflow:** file edits go through a GSD command; this research writes only into the phase directory.
- **Memory-derived working rules (not CLAUDE.md, but binding on the plan):** never run `pnpm db:reset` without Igor's word; `pnpm test:integration -- x` does not filter (use `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>`); run pgTAP before integration (residue trips pgTAP 154); Turbo needs `--concurrency=4`; no Claude co-author trailers; no parallel phase worktrees.

<phase_requirements>
## Phase Requirements

There are no real requirement IDs yet (ROADMAP: "TBD; promotes V2-CONT-02 and lifts the member-created stories exclusion"). The table below is a **DRAFT** for the planner to write into `REQUIREMENTS.md` and the ROADMAP `**Requirements**:` line. Prefix convention follows Phase 9's topic prefixes (`SOCIAL-`, `FOLLOW-`, `EXPL-`; verified free: `grep -c "MSTORY\|MCOMM\|MPUB" REQUIREMENTS.md` printed `0`). One row per testable behavior; every decision D-701..D-718 is reachable from at least one row. MODER-04 is currently `[x]` in REQUIREMENTS.md line 130 and must be re-split by the planner (stories and communities become MSTORY-10 / MCOMM-10; "block author" stays Phase 11).

| ID | Draft text (testable behavior) | Decisions | Research support |
|----|-------------------------------|-----------|------------------|
| MCOMM-01 | With `social` and `communities` effective, a member creates a community (name, description, optional cover). The row is stamped `kind = 'member'` and `created_by_user_id` from the session, never from the body; the body schema stays `.strict()`; an organization community is stamped `'organization'`. | D-707, Discretion (stamp) | R1, R5, Pitfall 2 |
| MCOMM-02 | A member community is listed and opened by every live member of the tenant exactly like an organization community (no locked screen, no store lock); like and comment stay open to everyone. | D-701 | R1, R4 |
| MCOMM-03 | The Comunidades list returns organization communities first (admin `position`, then activity), then member communities newest activity first; a new member community never precedes an organization one; `PUT /v1/communities/order` covers organization communities only (a member id in the body is `order_stale`). | D-712 | R1 (sentinel position), Pitfall 3 |
| MCOMM-04 | A member community projects `createdBy { membershipId, displayName, avatarAssetId }` and never a user id; an organization community projects no creator. | D-703 | Pattern 4, Pitfall 7 |
| MCOMM-05 | Each member may own at most N active communities (default 3, range 0..20) read from `tenant_modules['social'].settings`; archived and removed do not count; over the limit the API answers `400 VALIDATION_FAILED { community: 'limit_reached' }`; the count is enforced under a per-member advisory lock; `super_admin` edits N in the platform panel; `0` means members cannot create. | D-710 | R7, Pitfall 5 |
| MCOMM-06 | The creator edits, archives, reactivates, deletes an archived community and curates its highlights; cannot link store products, cannot reorder; reads their own archived communities (`status=archived` scoped to own rows). Another member on the same ids gets `403 FORBIDDEN`. | D-713, D-89 | R2, R5 |
| MCOMM-07 | When a member community's creator is blocked or removed, the community, its posts, highlights and stories leave every list and answer the bare 404 (the moderator included); unblocking restores them; nothing is deleted. | D-708 | R5 (hidden-ids definer), Pattern 3 |
| MCOMM-08 | A post in a member community appears on that community's page only; it is absent from Início, Explorar and Reels "Todos" for every viewer (follower, creator, moderator included). | D-702, Discretion (Reels) | R4, Pitfall 1 |
| MCOMM-09 | Reels lists member communities' lanes after the organization's, in list order; each lane lists only that community's ready videos. | D-702, Discretion | Pitfall 3 |
| MCOMM-10 | A holder of `moderation.manage` archives or removes any member community; each action writes a `moderation_log` row (`community_archived`, `community_removed`, subject `community`) in the same transaction; the creator is not told; works while `social` is off. | D-711, D-718 | R6 |
| MPUB-01 | The owner rule: an organization community accepts posts, stories and highlights from any `admin_tenant`; a member community only from its creator; anyone else gets `403 FORBIDDEN` from the API and no publish control in the web; like and comment stay intact. | D-706 | R2, Pattern 1 |
| MPUB-02 | With `social` (and the owning module) effective, role `member` is composed `communities.community.create`, `communities.community.manage_own` and `stories.story.publish`; ownership is tested in the statement (`created_by_user_id = ctx.userId`), never by role; `admin_tenant` keeps `communities.community.manage`. | D-707 | R2 |
| MPUB-03 | A creator publishes in their own community the member post (caption, photos, at most one video where allowed, link; no PDF) under the `social` media limits; the post is born with `community_id` set and audience `'community'`; `member_no_community` no longer exists for owners; a non-owner member naming a community gets `403 FORBIDDEN`. | D-709 | R4, Pitfall 1 |
| MPUB-04 | The member lane is bounded by RLS: restrictive insert/update/delete gates on `communities`, `stories`, `story_highlights`, `story_highlight_items` and the new `feed_posts` branch refuse (42501) a forged kind, owner, audience or a non-owner write, with `social` read from SQL (`app.social_enabled()`), not the 30 s flags cache. | D-706, D-707, D-718 | R5, Pitfall 4 |
| MPUB-05 | With `social` off: member writes answer `403`, member communities, their posts and highlights stay readable, member stories leave Explorar while a story saved in a community highlight stays, the moderator's actions keep working, and turning `social` on restores everything with no data change. | D-718 | R5, R8 |
| MPUB-06 | The admin's community picker (`/criar`), story destination groups and "Destacar" catalog list organization communities only; an admin cannot publish or curate in a member community (403). | D-706, UI-D-718 | R2, Pitfall 3 |
| MPUB-07 | The isolation suite and pgTAP cover every new or changed route and policy (owner, non-owner, follower, non-follower, moderator, support, system lane, other tenant); migrations are expand-only and ship before the API; `pnpm db:generate` prints "No schema changes"; `docs/DEPLOY.md` "Ativar a Rede social" gains member stories and communities; the seed adds one member community and one member story. | Discretion (Rollout) | Validation Architecture |
| MSTORY-01 | A member publishes a story (photo, or video where the tenant allows it, plus an optional caption) lasting 24 h under the member post limits; a member video must be `ready` before publish; the story is stamped `visibility = 'followers'` from the role, never from the body. | D-714, D-715 | R3, R8 |
| MSTORY-02 | Início's strip, its grouped circle and Início highlights list organization stories only; a member story is never in them. `GET /v1/stories` without a scope answers organization stories only. | D-704, D-714 | R3, Pitfall 1 |
| MSTORY-03 | Explorar shows one circle per author: the member's own first ("+" when none), then unseen before seen, then recency; a member sees their followees; a moderator sees every member (cursor-paged, 20 per page, no follow state, no own circle); the circles open 05.2's grouped viewer with its seen state. | D-714, D-717, Discretion (order) | Pattern 5, Pitfall 6 |
| MSTORY-04 | A member story, its likes and its comments are readable only by the author, the author's live followers, holders of `moderation.manage` and (D-716) anyone who sees a community whose highlight holds it; everyone else gets the bare 404; the gate is in the statement and in a restrictive RLS policy. | D-705, D-716 | R3, Pitfall 4 |
| MSTORY-05 | Likes and comments on a member story behave as on an organization story for allowed readers; no notification is produced when a member story is published (the `story.published` fan-out skips non-organization stories); the author still gets the existing comment notice. | Discretion (likes, notices) | Pitfall 8 |
| MSTORY-06 | A creator saves one of their *own* stories in a highlight of their *own* community (a member cannot add another person's story); the story is readable by everyone who sees the community, also after 24 h; the screens say so before confirming. | D-716 | R2, Pitfall 9 |
| MSTORY-07 | The member media seam covers purposes `story` and `cover`: photo cap from `social.media`, member video only for `post` and `story` and only when enabled, member-owned assets only (`owner_user_id = caller`), the member video-minutes sub-budget counts story videos. | Discretion (media) | R8, Pitfall 10 |
| MSTORY-08 | A blocked or removed author's stories leave Explorar and answer 404; a story author the viewer blocked (`member_blocks`) is absent from the viewer's row and a community whose creator the viewer blocked is absent from the viewer's lists. | D-708, Discretion (NATIVE-33) | R5 |
| MSTORY-09 | A member deletes their own story; a holder of `moderation.manage` soft-deletes any member story with a `moderation_log` row (`story_removed`, subject `story`) in the same transaction; deleting an organization story is unchanged (no log row); the author is not told. | D-711, D-717 | R6 |
</phase_requirements>

## Summary

The phase is **a permission-seam change plus two stamped columns, one widened post audience and a handful of read gates**, not new infrastructure. Every seam the CONTEXT names exists and the code even says so: `resolveHighlightPlace` carries the comment "Phase 10's creator-scoped publishing extends THIS function with its creator branch" (`packages/modules/stories/server/service.ts:1198-1199`), `createPost` refuses a community with `memberRules` (`feed/server/service.ts:938`), `permissionsFor` already composes member authoring from `social` (`apps/api/src/modules/registry.ts:230-233`), `recordModerationAction` writes the log row in the caller's transaction (`packages/core/server/moderation/log.ts`). What Phase 10 adds is: (1) a stamped `communities.kind`, (2) a stamped `stories.visibility` mirroring Phase 9's stamped `feed_posts.visibility`, (3) a third post audience `'community'`, (4) member-lane RLS gates on tables that today carry only a tenant-isolation policy, (5) a hidden-creator definer for D-708, (6) widened moderation-log vocabularies, and (7) a story-authors read for the Explorar row.

The riskiest finding is **leakage by omission**, because every current merged read assumes "a story/community post is the organization's voice". Concretely: `GET /v1/stories` is tenant-wide (Início would show member stories), `story.published` notifies every member (a member story would blast the tenant), Reels "Todos" lets a followed author's *community* video through `memberPostVisible`, the feed's Início predicate is safe only because it uses the literal `visibility = 'tenant'`, story likes/comments have no story gate in RLS at all, the wire audience `'followers'` drives the "Administrador" badge (a creator's community post would wear it), the admin's highlight catalog lists every community, and `app.community_post_stats()` is a *non-definer* trigger that updates `communities` as the member lane (it will break silently if a member UPDATE policy is too tight). Each of these has a named fix and a required negative test below.

**Primary recommendation:** stamp, don't derive. Add `communities.kind` and `stories.visibility` (both default to today's behaviour, so existing rows and the old API keep working), add a third `feed_posts.visibility = 'community'`, compose three member permissions in `permissionsFor`, put the owner rule in `resolveHighlightPlace` + `resolveCommunityTarget` + statement predicates, back every one with a *restrictive* RLS policy that reads `app.social_enabled()` from SQL, and ship all schema changes as expand-only migrations before the API, with pgTAP negatives for owner / non-owner / follower / non-follower / moderator / support / system lane / other tenant.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Owner rule (who may publish in a community) | API / Backend (service seams `resolveCommunityTarget`, `resolveHighlightPlace`, statement predicates) | Database (restrictive RLS insert/update gates) | D-706/D-707: guard is a permission + ownership predicate in the statement; RLS is the backstop that fails closed. The web only hides controls (UX, never the gate). |
| Community kind, creator liveness (D-708) | Database (stamped column, hidden-ids definer, restrictive select policies) | API (explicit predicates in list/detail) | Blocked/removed creators must disappear from every read path including raw joins; only RLS covers LEFT JOINs and ids-only routes. |
| Member story audience (D-705) | Database (stamped `stories.visibility`, restrictive select gate) | API (`scope`/author queries, explicit predicates) | Same split Phase 9 chose for posts (`feed_posts_social_gate` + `memberPostVisible`). |
| Explorar story row (one circle per author) | API (`GET /v1/stories/authors`, lazy per-author group read) | Frontend Server (RSC composition in `ExplorarBody`/`lib/registry.tsx`), Browser (`StoriesSurface` viewer, seen state) | Paging by author must be server-side (moderator sees many); the viewer is client state over server-composed circles (existing 05.2 split). |
| Per-member community limit | API (count under advisory lock in the create transaction) | Database (none; setting is JSON) / Kernel seam (policy lookup) | The number lives in `tenant_modules['social'].settings`; the communities module cannot import the social contracts (MOD-02), so a kernel seam like `setMemberMediaPolicy` carries it. |
| Moderation of member content + log row | API (service calls `recordModerationAction(tx, …)`) | Database (CHECK vocabularies, immutability trigger) | A removal without its log row must be impossible: same transaction, rolled back together. |
| Member media (story, cover) | API / kernel media broker (`startUpload`) | Browser (pick-time UX gate), Worker (ready/duration job) | Limits enforced at start, at complete, by the ready job and at publish; the UI hint is UX only. |
| Module switch (`social` off) | API (permission composition; SQL `app.social_enabled()` in RLS) | Frontend (absent controls) | The flags cache is 30 s; RLS reads the row, so a stale instance cannot write after the switch (42501 mapped to 403). |
| Notifications / realtime / push for member content | Worker (module notification sources) | — | Phase 11 owns notices; this phase must only make sure nothing fans out. |

## Standard Stack

### Core

No new dependency. Everything below is already installed and pinned by CLAUDE.md; this phase adds code, columns, policies and routes only. `10-UI-SPEC.md` independently states "Phase 10 adds **no dependency**".

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono + `@hono/zod-openapi` | 4.13.7 / 1.6.3 (CLAUDE.md) | New/changed routes in the communities, stories, feed modules | Existing route pattern (`createRoute` + `requirePermission` literals + `defaultHook` lifting issue codes) |
| Zod 4 | 4.6.2 | `.strict()` request schemas, `details.<module>` machine codes | Existing; `.strict()` is the mass-assignment defense (verified: `createCommunitySchema` and `updateCommunitySchema` are `.strict()`, `communities/contracts/index.ts`) |
| Drizzle ORM + drizzle-kit | 0.45.2 / 0.31.10 | Schema + policy TS, `pnpm db:generate` must print "No schema changes" | Existing; hand-written SQL for definers/constraints goes in `--custom` migrations |
| `postgres` via Supavisor | 3.4.9 | `withTenantTx` lane (`set local role authenticated`, claims via `set_config`) | Existing; verified `packages/core/db/tenant-tx.ts` |
| pgTAP via `supabase test db` | CLI 2.117.0 | RLS negatives, definer truth tables, EXPLAIN index pins | Existing; next free file numbers are 230+ (last is `229-profile-form-professional-id.sql`) |
| Vitest 5 / Testing Library / Playwright | 5.0.0 / 16.3.3 / 1.63.0 | Unit, API integration, web, e2e | Existing |
| `pino` via `moduleLogger` | 10.3.1 | Ids-only structured logs (a name/caption never reaches a log line, T-05-06/T-05-29) | Existing |

### Supporting

| Library / seam | Purpose | When to Use |
|----------------|---------|-------------|
| `recordModerationAction(tx, ctx, entry)` (`packages/core/server/moderation/log.ts`) | Log row in the action's transaction | Every moderator story/community action |
| `createAttemptLimiter` (`packages/core/server/accounts/rate-limit.ts`, used by `reportLimiter`) | In-process abuse ceiling per `user:{tenant}:{user}` key | Member create-community / publish-story spam (no general API rate limiter exists) |
| `moduleFlags` (`@rede-social/core/server/modules/flags-cache`) | `isEnabled(ctx,'social')`, `flags(ctx).settings` | Read **before** opening `withTenantTx` (one pooled connection per request rule) |
| Kernel seams `@rede-social/core/db/social-gate` (`SOCIAL_ENABLED`, `SOCIAL_VISIBLE_AUTHOR_IDS`, `SOCIAL_STAFF_EXEMPT`, `socialCanReadFor`) and `community-gate` | Social audience + community gates reusable by stories without importing `social` or `feed` | Stories gate and Explorar row |
| `pg_advisory_xact_lock(hashtextextended(...))` | Serialize the per-member community count (precedent: `core/server/profile-form/admin.ts:88`, `payments/gate.ts:30`) | `createCommunity` limit check |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Stamped `communities.kind` | Derive kind from the creator's *current* role at read time | Rejected: ADMIN-02 promote/demote would move communities between lists (the exact reason Phase 9 stamped `visibility`, `feed/db/schema.ts:124-135`). No reason to derive was found. |
| Third post audience `'community'` | Reuse `visibility = 'tenant'` for member-community posts | Rejected: `'tenant'` posts notify every member (`feed/server/notifications.ts:149` `if (row.visibility !== 'tenant') return []`), wear no member mark and enter Início through the literal. `'followers'` is rejected too: the DB CHECK forbids a community on it. |
| Sentinel `position` for member communities (R1) | New `kind`-leading list index + cursor shape | The sentinel keeps the list statement, its index, its keyset cursor and pgTAP 110's EXPLAIN pins unchanged. The alternative is cleaner semantically and costs a new partial index, a new cursor shape and re-pinned plans. Flagged A1. |
| New member-only community permissions | Grant members `communities.community.manage` (the `feed.post.manage` precedent) | Rejected: `manage` is the admin superpower the web reads for reorder, archived read and store form (`CommunitiesList.tsx:40`, `comunidades/page.tsx:27`); handing it to members flips each of those sites. `social.participate` already shows the "member-only by construction" pattern (`social/contracts/index.ts` docblock). |

**Installation:** none (`# no packages to install`).

**Version verification:** not applicable, no package is added. Runtime facts probed this session: Node `v24.14.0`, pnpm `12.4.1`, Docker CLI `29.3.1` present (daemon/stack state not probed).

## Package Legitimacy Audit

No external package is installed by this phase, so the gate (`gsd_run query package-legitimacy check`) was not run: there is nothing to check. `10-UI-SPEC.md` Registry Safety records the same ("Phase 10 installs no external package").

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 Member browser / PWA                       Next.js (BFF, RSC, server actions)                 Hono API on Cloud Run (/v1/*)
 ──────────────────                         ─────────────────────────────────                 ─────────────────────────────
 Explorar row  ──────────────►  ExplorarBody (RSC) ─► loadStoryAuthors ─────────────────►  GET /v1/stories/authors        (NEW, paged by author)
   own circle "+" ► /stories/publicar        StoriesSurface (client viewer, seen state)       GET /v1/stories/authors/{membershipId} (NEW, lazy group)
   StoryComposer  ──────────────────────────►  server action ───────────────────────────►  POST /v1/stories ─► publishStory
                                                                                              ├ member branch: memberMediaPolicy → asset owner → stamp visibility='followers'
                                                                                              └ destination? ─► resolveHighlightPlace(owner rule)   ◄── the seam
 /comunidades/nova ──────────────────────────►  server action ───────────────────────────►  POST /v1/communities ─► createCommunity
                                                                                              └ permission(create) → limit (advisory lock) → stamp kind → insert
 Community page (creator) ───────────────────►  server action ───────────────────────────►  POST /v1/feed/posts {communityId} ─► createPost
                                                                                              └ resolveCommunityTarget(owner rule) → stamp visibility='community'
 Admin: archive / delete community, delete story ► server action ─────────────────────────►  PATCH|DELETE community · DELETE story
                                                                                              └ moderator branch + recordModerationAction(tx) (same transaction)
                                         every statement:  withTenantTx ─► set_config(claims) + set local role authenticated
                                                                                │
                                          Postgres (per-tenant project in production; shared locally)
                                          tenant isolation  ∧  RESTRICTIVE gates:
                                          communities: kind/owner insert+update gate · creator-live select gate
                                          stories: visibility insert gate · audience select gate (+ highlight branch)
                                          feed_posts: 'community' insert branch · social gate · hidden-community gate
                                          moderation_log: widened CHECK vocabularies (append-only trigger untouched)

 pg-boss worker ◄── events: story.published (source must skip non-organization stories) · post.published (already skips visibility<>'tenant')
```

### Recommended Project Structure (files this phase touches)

```
supabase/migrations/            # expand-only, applied by the ledgered migrateAll BEFORE the API/worker
  *_member_communities.sql      # generated: communities.kind (+CHECK, owner index), stories.visibility (+CHECK, partial indexes),
                                #   feed_posts visibility CHECKs widened, restrictive policies
  *_member_communities_functions.sql   # custom: app.member_community_hidden_ids(), story highlight-readable helper
  *_moderation_member_content.sql      # custom: moderation_log CHECKs widened (09-07 shape)
supabase/tests/230+ .sql        # new pgTAP; extend 110, 112, 120, 154, 201 pins where noted
packages/core/                  # kernel: member-policy seam for communities, moderation log entry union, db/schema moderation-log CHECK mirror
packages/contracts/src/moderation.ts          # MODERATION_ACTIONS / MODERATION_SUBJECT_TYPES appended
packages/modules/communities/   # kind, createdBy projection, viewer flags, limit, owner predicates, reorder = organization only
packages/modules/stories/       # visibility stamp, authors read, member publish/delete/highlight branches, notification source guard
packages/modules/feed/          # 'community' audience, createPost owner branch, memberPostVisible literal, badge/audience wire value
packages/modules/social/        # socialSettingsSchema + patch/answer: communities.maxPerMember
apps/api/src/modules/registry.ts# permissionsFor member composition (+ unit pins), member media policy seam stays
apps/api/tests/                 # isolation-inventory.ts entries, integration files, unit registry pins
apps/web/                       # Explorar row, composer/forms, community page flags, pickers, moderation log row kinds, platform sheet
docs/DEPLOY.md                  # "Ativar a Rede social" + release section (databases → API+worker together → web last)
```

### Pattern 1: The owner seam (the heart of the phase)

**What:** one rule, three entrances. "May this caller publish in this community?" is decided in the *service*, in the same transaction as the write, from the stamped kind and `created_by_user_id`, and re-stated by a restrictive RLS insert gate.

| Caller | Organization community (`kind='organization'`) | Member community (`kind='member'`) |
|--------|-----------------------------------------------|-------------------------------------|
| `admin_tenant` | publish / curate: yes (any admin, D-706) | publish / curate: **403** (moderation only: archive, delete, edit) |
| creator (`role = member`, `created_by_user_id = ctx.userId`) | n/a | yes, with the member limits |
| any other member | 403 | 403 |
| `support_tenant` | 403 | 403 |

Where it lands (all verified this session):

- **Posts:** `resolveCommunityTarget` (`feed/server/service.ts:1158-1174`) today answers 404 for a miss and `400 {community:'archived'}`; add the kind/owner read to its `select` (`select c.status, c.kind, c.created_by_user_id`) and the branch. `memberRules` line 938 `if (input.communityId !== null) throw refuse('member_no_community');` is *removed for members*, and the post's audience is derived from the target community's kind (not from the role): `'community'` for a member community, `'tenant'` for an organization community, `'followers'` when `communityId` is null and the caller is a member. Order: unknown → 404, kind/owner → 403, archived → 400 (a non-owner learns nothing: the community is visible to the whole tenant).
- **Highlights and story destinations:** `resolveHighlightPlace` (`stories/server/service.ts:1202-1234`) is *the* seam its own docblock names. Its `select c.status, (c.id = any (…)) as locked from communities c` gains `c.kind, c.created_by_user_id`; for intents `curate`/`takedown` it throws 403 unless (admin role and `kind='organization'`) or (`created_by_user_id = ctx.userId`). It also needs the *role* (the function takes `ctx`, which carries `ctx.role`, so no new parameter is needed beyond the already-read permission flags). Every route that writes a highlight calls it through `resolveHighlight`, so no route learns what a place is.
- **Community writes:** `updateCommunity` / `deleteCommunity` have **no author predicate today** (verified: `communities/server/service.ts:699-704`, `938-944` select by tenant + id only). Add the owner predicate for non-admin callers in the same locking read (`for update`), answering 403 for a visible-but-not-owned row and 404 for a miss.
- **Route guards:** the literals `requirePermission('communities.community.manage')` become `requirePermission('communities.community.manage', 'communities.community.manage_own')` (`requirePermission` already accepts "ANY of the named permissions", `core/server/rbac/permissions.ts`). `POST /` uses `('communities.community.manage', 'communities.community.create')`. Keep the literals spelled out (reviewers grep for them, T-05-18).
- **Highlight/story-delete guards:** the manage-only story routes carry `requirePermission('stories.story.manage')`: `GET /highlights/catalog`, `PUT /highlights/order`, create, add item, update, delete, remove item, `GET /{storyId}/highlights`, `GET /mine` and `DELETE /{storyId}` (verified `stories/server/routes.ts:135,199,214,257,286,317,344,363,463,611`); their docblock already says "Phase 10's creator-scoped curation swaps these guards for an in-handler check". The reads `GET /highlights?scope=all`, `GET /highlights/{id}` compute `curator` from `stories.story.manage` (`routes.ts:631-651`): for the creator of a member community `curator` must become *place-dependent* (true when the caller owns that place), computed in the service, not the route.

**Anti-pattern to avoid:** comparing `ctx.role === 'member'` in a module to decide *whether the owner rule applies*. The rule keys on the **community's kind and creator**, with the caller's *permissions* deciding which guard they pass; the one role read that stays is the existing stamped-audience write (`ctx.role === 'member' ? 'followers' : 'tenant'`, `feed/server/service.ts:1250`), which is itself backed by an RLS insert gate.

### Pattern 2: Stamp, then gate (kind, visibility, audience)

Phase 9's template, reused three times:

| Stamp | Values | Written from | Read gate (restrictive RLS + service predicate) | Write gate (restrictive insert) |
|-------|--------|--------------|------------------------------------------------|---------------------------------|
| `communities.kind` (new) | `'organization'` (default) `'member'` | creator's role at creation | `communities_member_hidden_gate` (Pattern 3) | member lane: `kind='member' and created_by_user_id = app.user_id() and app.social_enabled()`; non-member lane: `kind='organization'` |
| `stories.visibility` (new) | `'tenant'` (default) `'followers'` | creator's role at publish | `stories_audience_gate` (below) | member lane: `visibility='followers' and app.social_enabled()`; non-member: `'tenant'` |
| `feed_posts.visibility` (widened) | `'tenant'` `'followers'` **`'community'`** | target community's kind (member community), else role | `feed_posts_social_gate` widened | member lane: add `visibility='community' and community_id is not null and exists(owned member community) and app.social_enabled()` |

**Verified current constraint text to be widened** (`packages/modules/feed/db/schema.ts:245-249`):
`check('feed_posts_visibility_chk', sql\`${t.visibility} in ('tenant','followers')\`)` and
`check('feed_posts_visibility_shape_chk', sql\`${t.visibility} = 'tenant' or ${t.communityId} is null\`)`. New shape: `visibility = 'tenant' or (visibility = 'followers' and community_id is null) or (visibility = 'community' and community_id is not null)`. Existing rows satisfy it (all are `'tenant'` or `'followers'`-with-null-community), so the CHECK swap is expand-only exactly as 09-07 widened `moderation_log` (precedent file `20261019225153_moderation_post_removed.sql`: drop and re-add wider, no rows touched).

**The story audience gate** (policy and service form written side by side, like `feed_posts_social_gate` and `memberPostVisible`): a story row is readable when
`visibility = 'tenant'`
**or** `(app.social_enabled() and (SOCIAL_STAFF_EXEMPT or author_user_id = any (SOCIAL_VISIBLE_AUTHOR_IDS)))`
**or** `(the story sits in a highlight whose community is open to the caller)`.
The third branch is D-716 and the one that is easy to forget: without it, RLS would hide a highlight-saved member story from the non-followers who are meant to see it, because `getHighlight` reads `stories` through the same RLS (`stories/server/service.ts:1706-1715`). It must also hold while `social` is off (D-718: "a story already saved in a community highlight stays"), and it must require the *author* to be a live member (D-708: the story of a blocked creator answers 404 even from a highlight). `SOCIAL_VISIBLE_AUTHOR_IDS` already excludes blocked/removed followees (`20261019204737_social_functions.sql`), so branch 2 needs no extra liveness; branch 3 does. Measure branch 3 (A10).

### Pattern 3: Hidden-creator definer (D-708), the 09.3 shape

`app.community_deleted_ids()` + `feed_posts_deleted_community_gate` (`20261026213756_community_soft_delete_gate.sql`, `feed/db/schema.ts:276-281`) is the exact template: a SECURITY DEFINER, `search_path=''`, tenant-pinned ids-only function read once per statement as an InitPlan through `coalesce((select …), '{}'::uuid[])` (the `<> all (subquery)` form fails: Pitfall 1 of 08.2, verified in `core/db/community-gate.ts` docblock).

Add `app.member_community_hidden_ids()` returning the ids of `kind = 'member'` communities whose creator has no live membership (`status='active'`, `blocked_at is null`, `deleted_at is null`). Policies (restrictive, select): on `communities` (`kind = 'organization' or id <> all (…)`) and on `feed_posts` (`community_id is null or community_id <> all (…)`). Do **not** fold this into `community_deleted_ids()`: pgTAP `112-community-soft-delete.sql` pins that function's meaning ("the ids of this tenant's communities whose `deleted_at` is set"), and a LEFT JOIN from a post onto a hidden community would otherwise still return the post. Comments and likes need no policy of their own: their gates already test the post through an inner `exists (select 1 from feed_posts)` (`feed/db/schema.ts:622-630`, `739-749`).

Stories of a hidden creator are covered because (a) a member story's own gate requires a live author and (b) community highlight reads resolve the community through `resolveHighlightPlace` under the new `communities` select gate (404).

### Pattern 4: Creator projection (D-703) without the user id

`communitySummarySchema` is `.strict()` and documents "There is deliberately no owner/author field (D-67)" (`communities/contracts/index.ts:181-195`). Add, for member communities only, `kind` and `createdBy: { membershipId, displayName, avatarAssetId } | null`, resolved in the *same statement* by two LEFT JOINs (`memberships` pinned `am.tenant_id = c.tenant_id`, `member_profiles` on `membership_id`) exactly as `storyProjection` joins the author's avatar (`stories/server/service.ts:189-196`, `am.status = 'active' and am.deleted_at is null`). Also add the per-viewer flags the UI-SPEC wants (`viewer: { isOwner, canPublish, canEdit, canCurate }`), computed server-side so the host never compares a role or an id. For the list read add the caller's `{ ownedActive, limit }` (UI-D-706).

The story wire has the same issue and it already exists: `storySummarySchema.authorUserId: z.uuid()` is sent to every reader (`stories/contracts/index.ts:146`) though `apps/web` never reads it (grep found no use). For member stories **do not send another member's user id** (A7): add `author { membershipId, displayName, avatarUrl }` and make `authorUserId` nullable (null unless the caller is the author). The file's own note says a *required* new key breaks the previous web and the reverse deploy order is unsafe: deploy the web first for this one change, or keep `authorUserId` and null it only for member stories.

### Pattern 5: The Explorar story row (one circle per author)

`GET /v1/stories` pages *stories*; a row of circles pages *authors*, and the moderator's "every member with a live story" can be large. Recommended (planner discretion, flagged A10):

- `GET /v1/stories/authors?cursor&limit` → `{ items: [{ membershipId, displayName, avatarUrl, storyCount, latestExpiresAt, hasUnseen }], nextCursor }`. Scope is decided by the caller's *permissions* (route reads `permissionsForRequest`): a `member` gets self + live followees (kernel seam `SOCIAL_VISIBLE_AUTHOR_IDS`), a holder of `moderation.manage` gets every live member with a live story; `404 MODULE_DISABLED` while `social` is off (the `feedPage` Explorar precedent, `feed/server/service.ts:516`, `moduleFlags.isEnabled(ctx,'social')`). Cursor `(max(expires_at), author)` over the kernel envelope (`decodeCursor`/`encodeCursor`, total decoders).
- `GET /v1/stories/authors/{membershipId}` → that author's live stories, oldest first, lazily loaded when the circle opens (the highlight-group pattern: `StoryGroupView.items: null` then `loadHighlightItemsAction`).
- Order: own circle first, then unseen before seen, then recency. `viewer_seen` already rides the story projection (`story_views_uq` index-only scan with a **constant** tenant predicate, `stories/server/service.ts:179-188`): keep that form or the plan degrades to a Seq Scan (pgTAP `120-story-highlights.sql` pins it).
- Likely index: `(tenant_id, author_user_id, expires_at desc) where deleted_at is null and visibility = 'followers'`. Decide by measurement on a volume fixture (the 09-03 spike method: `09-03-SPIKE.md`, `CHOSEN_FORM`), and keep the statement budget test (`feed-query-budget.test.ts`) honest: the row is one statement per page.
- `GET /v1/stories` (Início) gains the literal `and s.visibility = 'tenant'`; `scope` is never a client-visible way to widen it. `GET /v1/stories/mine` is guarded by `stories.story.manage` and returns *the tenant's* stories, not the caller's (`stories/server/service.ts:300-312` docblock): "Seus stories" for a member needs an author-scoped variant (`author_user_id = ctx.userId`), and the admin's `/mine` must not start listing members' stories unless that is wanted (it is the moderator's door per D-717 only through Explorar).

### Pattern 6: Moderation in the same transaction (D-711)

`recordModerationAction(tx, ctx, entry)` is the only writer and it throws when either party lacks a membership of `ctx.tenantId`, rolling the caller back. Required changes (all grep-confirmed sites):

| Site | Change |
|------|--------|
| `supabase/migrations` (new, 09-07 shape) | Drop and re-add `moderation_log_action_chk` (currently `('comment_removed','member_blocked','member_unblocked','role_changed','post_removed','profile_form_exported')`, `20261029232606_profile_form_tables.sql:63`) and `moderation_log_subject_chk` (`20261019225153_moderation_post_removed.sql`) wider: actions `+ story_removed, community_archived, community_removed`; subject types `+ story, community`, each bound to its actions. |
| `packages/core/db/schema/moderation-log.ts` | mirror both CHECKs (else `pnpm db:generate` shows a diff) |
| `packages/contracts/src/moderation.ts:41,55` | append to `MODERATION_ACTIONS` and `MODERATION_SUBJECT_TYPES` (values are appended, never inserted) |
| `packages/core/server/moderation/log.ts` | extend the `ModerationEntry` union and the `removal` branch (`entry.action === 'comment_removed' \|\| entry.action === 'post_removed'` becomes a set); `excerptSource` = story caption / community name |
| `apps/web/lib/moderation-view.ts`, `apps/web/components/admin/ModerationLogRow.tsx` (+ tests) | exhaustive maps: three new kinds in the existing row geometry (UI-D-714) |
| dashboard moderation counts | 09 advisory (d) says they ignore `post_removed`; the new kinds make the same gap wider (decide: count or ignore, record) |
| `packages/core/server/safety/reports.ts` | references `post_removed` for the report-resolve path; Phase 11 owns new report subjects, but re-check that a `remove_content` resolution cannot be asked for a story/community subject |

Story deletion: `deleteStory` updates by tenant + id only (verified `stories/server/service.ts:564-573`) behind `stories.story.manage`. Target shape: route guard any-of(`stories.story.manage`, `stories.story.publish`); the route computes `canModerate` from `permissionsForRequest` (the story-comment precedent `canModerateComments`, `routes.ts:713`); the service locks the row `for update`, and the predicate is `author_user_id = ctx.userId` **or** (`canModerate` and the story is a member story) **or** (`canManage` and the story is an organization story). When the actor is not the author **and** the story is a member story, call `recordModerationAction({ action: 'story_removed', targetUserId: author, subjectType: 'story', subjectId, excerptSource: caption })`. Deleting an *organization* story keeps today's behavior (no log row): do not log what Phase 8 never logged.

Community archive/removal: `updateCommunity` already detects the transition into `archived` (`archivedNow`, `communities/server/service.ts:771`); write `community_archived` there when the actor is not the creator and `kind = 'member'`. `deleteCommunity` writes `community_removed` under the same condition. Soft deletes, nothing cascades (D-556): comments/likes/highlights/posts stay in rows and leave every read.

### Pattern 7: The per-member limit seam (D-710)

`communities` may not import `@rede-social/module-social` (MOD-02), and the kernel media broker already solved the same inversion with `setMemberMediaPolicy` filled by the app tier (`apps/api/src/modules/registry.ts:308-313`). Add the sibling: kernel `memberCommunityPolicyFor(ctx): Promise<{ maxActive: number } | null>` (null when `social` is not effective), filled in `registry.ts` from `socialSettingsSchema` (new field `communities.maxPerMember`, int 0..20, default 3, inside the existing `.prefault({})` chain so stored blobs without the key parse to the default; also add it to `socialSettingsPatchSchema` and `socialSettingsAnswerSchema`, both `.strict()` today, `social/contracts/index.ts`, and to `SOCIAL_SETTINGS_DEFAULTS`). Read the policy **before** `withTenantTx` (the "one connection per request" rule). Inside the create transaction: `select pg_advisory_xact_lock(hashtextextended('communities:own:' || tenant || ':' || user, 0))`, then `select count(*) … where kind='member' and created_by_user_id = me and status='active' and deleted_at is null`, refuse `400 { community: 'limit_reached' }` (append to `COMMUNITY_ISSUES`, which the route `defaultHook` and the web switch on exhaustively). The limit is a counter on *create*; lowering it never removes anything, and **reactivating** an archived community can exceed the cap unless the same check runs on `status: 'active'` writes (decide; recommended: run it).

### Anti-Patterns to Avoid

- **Trusting the hidden control.** The web hides publish controls; the API and RLS are the control (UI-D-710 says the same). Every UI-hidden action needs the 403 test.
- **Deriving the audience from the viewer's role at read time.** The 09-03 reasoning holds: stamp at write.
- **A restrictive `UPDATE` policy that filters silently.** An UPDATE whose USING does not match affects zero rows *without an error* (the 09-14 reasoning for `feed_posts_member_update_guard`, `feed/db/schema.ts:315-322` docblock). The community counters trigger runs as the invoker (see Pitfall 4).
- **Reading `moduleFlags` inside `withTenantTx`.** A cache miss opens a second pooled connection (`max: 5`); the repo reads flags first (`readPlaceGate`, `stories/server/service.ts:1157-1169`).
- **Importing a sibling module.** Stories reads communities/feed tables through raw SQL by name and the kernel seams (`LOCKED_COMMUNITY_IDS`, `SOCIAL_*`); `turbo boundaries` denies package imports.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Moderation trace | An event subscriber or a second log table | `recordModerationAction(tx, ctx, entry)` in the action's transaction | The bus flushes after commit and never rethrows; only the same-transaction write makes "removal without log" impossible (writer docblock). |
| Hidden-by-owner state | A per-route `where creator_live` in each service | Definer ids-only function + restrictive policies (09.3 template) + explicit predicate in list/detail | Only RLS covers LEFT JOINs and id-only routes (comment-id routes, likes). |
| Pagination | New cursor formats | `decodeCursor`/`encodeCursor`/`keysetComparison` (`@rede-social/core/server/paging`), total decoders | Tampered cursors degrade to page 1; `n` carries extra keys (`{position}~{instant}`) because there is one envelope. |
| Block filter | A new blocks join | `app.is_blocked_by_viewer(author)` (invoker, viewer predicate) as `NOT_BLOCKED_AUTHOR` does (`feed/server/service.ts:360`) | The member_blocks select policy shows a lane only its own rows; the blocked member sees nothing different. |
| Story audience | A follow-graph join in stories | Kernel seams `SOCIAL_ENABLED`, `SOCIAL_VISIBLE_AUTHOR_IDS`, `SOCIAL_STAFF_EXEMPT` (`core/db/social-gate.ts`) | The kernel names the gate, the social module gives it a body (`20261019204645_social_gate_seam.sql`). |
| Rate limiting | A new limiter class | `createAttemptLimiter` + `safetyLimiterKey`-style key (`core/server/safety/limits.ts`) | Per-process hard stop already used for reports/blocks; every attempt counts. |
| Concurrency on the limit | Read-then-insert | `pg_advisory_xact_lock` in the create transaction | A member tenant lane cannot `for update` another table's rows; precedent at `core/server/profile-form/admin.ts:88`. |
| Story viewer, seen state, strip | A second viewer | `StoriesStrip`, `StoryCircle`, `StoryViewerHost`, `StoriesSurface` (05.2) with `items: null` lazy groups | UI-SPEC reuses them; the seen buffer and share are already solved. |
| Upload validation | Re-checking mime/size in the module | The kernel broker (`startUpload`/`complete`/ready job) with the member policy seam | One enforcement point; the module only checks asset ownership and purpose at publish. |

**Key insight:** every hard problem here (audience gates, hidden-by-owner, moderation trace, member media, paging) already has a Phase 5/8/9/13 solution. The work is applying each solution to a *new kind of row* and finding every place that silently assumed "all communities and stories are the organization's".

## Existing Data and Rollout State

This is not a rename phase (Runtime State Inventory omitted by rule), but the migrations touch populated tables, so the state is stated explicitly:

| Category | Finding | Action |
|----------|---------|--------|
| Existing communities | All pre-existing rows were created by an admin (`createCommunity` was manage-only) | `kind` default `'organization'` covers them with no backfill; `position` stays |
| Existing stories | All pre-existing stories are organization stories | `visibility` default `'tenant'` covers them |
| Existing posts | `'tenant'` / `'followers'` only | CHECK widening is satisfied by all rows |
| Per-tenant projects | Production tenants are separate Supabase projects (09.2/09.4); the `migrateAll` ledgered fan-out applies every `supabase/migrations` file to each | Expand-only + hand-written SQL must be idempotent-safe under the ledger; test with `pnpm db:two` (applies the whole tenant set to a second empty database) and `pnpm db:migrate-all -- --dry-run` |
| Real tenant | `social` is off in production (Phase 9 advisories still gate enabling it) | No behavior change for any tenant until `super_admin` turns `social` on |
| Secrets/env/jobs | None added | Nothing to seed in production; the *local seed* gains one member community and one member story |

## Common Pitfalls

### Pitfall 1: Member-community content leaking into a merged read
**What goes wrong:** a creator's community post or video appears in Início, Explorar or Reels "Todos".
**Why it happens:** the sites assume `community_id is not null ⇒ organization voice`. Verified: Início is safe only because it carries the literal `p.visibility = 'tenant'` (`feed/server/service.ts:574-576`); Explorar is safe because of `p.visibility = 'followers' and p.community_id is null` (line 520); **Reels "Todos" is NOT**: it uses `memberPostVisible(false)`, whose non-moderator branch is `p.visibility = 'tenant' or (… p.author_user_id = any (SOCIAL_VISIBLE_AUTHOR_IDS))` (lines 397-398), so a followed creator's `'community'` video passes through the second clause. Likewise `listVideoCommunities` lists any community with a ready video (it is meant to; it only needs the ordering fix).
**How to avoid:** change the second branch to `(p.visibility = 'followers' and …)`; add `visibility <> 'community'` negative tests for Início, Explorar (follower and moderator) and Reels "Todos"; pin the partial indexes by name again (`feed_posts_tenant_org_created_idx` where `visibility='tenant'`, `feed_posts_tenant_followers_created_idx`, `feed_posts_tenant_video_created_idx`).
**Warning signs:** a pgTAP/integration case where a follower of the creator sees the community video in Reels "Todos".

### Pitfall 2: Stamping from the body (mass assignment)
**What goes wrong:** a member creates an `'organization'` community, or posts `visibility: 'tenant'`, or sets `created_by_user_id`.
**How to avoid:** `kind`, `visibility`, `created_by_user_id`, `position` are never in a request schema (both create/update schemas are `.strict()`); the service writes them from `ctx`/the target row; the RLS insert gate refuses a mismatch (42501), so a forged claim cannot widen it. Add a pgTAP case per forged column and an API case that a body with `kind` is `400 VALIDATION_FAILED`.

### Pitfall 3: Order, reorder, pickers and catalogs that now see member communities
**What goes wrong:** (a) `reorderCommunities` locks and renumbers *every* active community (`communities/server/service.ts:857-864`), so a member community would be pulled into the admin's permutation (and `order_stale` would fire for an admin who never saw it) and its sentinel position destroyed; (b) the admin's community picker in `/criar`, the story destination groups and `GET /v1/stories/highlights/catalog` (`listHighlightCatalog`, lines 2109-2142: "each ACTIVE community's") list member communities the admin may not publish in; (c) Reels lanes use `c.position asc` so member lanes sort last only if the sentinel holds.
**How to avoid:** add `and c.kind = 'organization'` to the reorder lock, comparison and update; filter the catalog and pickers by kind or by the per-item `viewer.canPublish` flag; assert the member community keeps `position = 1000000` after an admin reorder. Recommended sentinel: `COMMUNITY_MEMBER_POSITION = 1_000_000` with `check (kind = 'organization' or position = 1000000)`; reorder writes `1..n` with `n ≤ COMMUNITY_MAX_ORDER = 200` so the two ranges cannot collide. A reactivated organization community keeps its old position (existing behavior).

### Pitfall 4: RLS that is right in a test and wrong in the product
**What goes wrong:** (a) `app.community_post_stats()` is **not** `security definer` (verified `20260923204828_communities_counters.sql:51`: `language plpgsql set search_path = ''`, grants to `authenticated`), so when a creator inserts a post into their community the trigger UPDATEs `communities` *as the member lane*. A member UPDATE policy that is too tight turns `post_count` into silent drift; one that checks `app.social_enabled()` in WITH CHECK blocks the counter while `social` is off. (b) The flags cache is 30 s but RLS reads the row: a stale instance lets a member through the permission guard and the insert policy raises 42501; **map 42501 to 403 for member callers only** (precedent `feed/server/service.ts:1277`, `if (isMember && isInsufficientPrivilege(error)) throw new ApiError(403, 'FORBIDDEN')`). (c) A stories select gate without the highlight branch hides D-716 content from non-followers.
**How to avoid:** member UPDATE policy: USING `app.tenant_role() <> 'member' or created_by_user_id = app.user_id()`; WITH CHECK `app.tenant_role() <> 'member' or (kind = 'member' and created_by_user_id = app.user_id())` (no `social_enabled()` in the check, since the service/permission already stops writes and moderation counters must not fail); extend pgTAP 110's counter reconciliation to include a member-lane insert and soft-delete into a member community; restrictive `DELETE` policy on `communities` denying the member role (the service never hard-deletes).
**Warning signs:** `communities.post_count` not moving after a creator posts; reconciliation assertion in `110-communities-stories.sql` failing.

### Pitfall 5: The limit race and the reactivation loophole
**What goes wrong:** two concurrent creates both pass a count of 2; or a member archives to free a slot, creates another, then reactivates the first and holds N+1; or loops create/archive to spam.
**How to avoid:** advisory lock + count in the create transaction (Pattern 7); re-run the check when a `status: 'active'` write reactivates a member community; add a `createAttemptLimiter` ceiling for create/publish (A6: suggested 10 community creations and 30 story publishes per member per hour, per process, like `reportLimiter`). Integration test with `Promise.all` of N+1 creates.

### Pitfall 6: Explorar row cost and the statement budget
**What goes wrong:** a moderator tenant with thousands of member stories pages stories instead of authors, or the per-story `viewer_seen` subplan degrades to a Seq Scan, or the strip is no longer one statement.
**How to avoid:** Pattern 5; EXPLAIN pins in pgTAP on a volume fixture; `feed-query-budget.test.ts` extended with the authors read; keep the constant `v.tenant_id = ${ctx.tenantId}` form.

### Pitfall 7: Projecting the creator or author too widely
**What goes wrong:** `created_by_user_id` or `authorUserId` reaches the client; the creator's profile link works for a blocked creator; `Criada por` is rendered with a stale name.
**How to avoid:** project `membershipId`, display name, avatar asset only, from a live membership join; absent when the creator is not live (the row is hidden anyway). Contract tests assert the exact key set (`.strict()`).

### Pitfall 8: Notifications that fan out a member story to the whole tenant
**What goes wrong:** `story.published` → `resolveStoryPublished` builds `audience: { type: 'members' }` for *any* story (`stories/server/notifications.ts:55-103`): a member story would notify every member and push to every device. A member-community post is already safe (`if (row.visibility !== 'tenant') return []`, `feed/server/notifications.ts:149`; `resolvePostCommented` returns `[]` unless `visibility === 'followers'`, line 342, so comments on community posts notify nobody; recorded as A4).
**How to avoid:** add `s.visibility = 'tenant'` to the source's select so a non-organization story yields `[]`; unit test in `stories/tests/notification-sources.test.ts`; integration test that publishing as a member creates zero `notifications` rows. `story.commented` (author notice) is unchanged and acceptable.

### Pitfall 9: Highlights as a back door (IDOR)
**What goes wrong:** `insertHighlightItem` and `addStoryToHighlight` select the story by id and tenant only (`stories/server/service.ts:1546-1556`, `1592-1598`), so a member who owns a community could add *another member's or the admin's* story to their highlight and thereby publish it to the whole tenant (D-716 makes saving an act of publishing).
**How to avoid:** for non-admin callers add `s.author_user_id = ctx.userId` to both statements (in the SELECT, so a foreign story writes zero rows and answers the bare 404); likewise `resolveChosenCover` / cover assets. Negative test: member A adds member B's story to A's highlight → 404 and no `story_highlight_items` row.

### Pitfall 10: Media seam covers `post` only
**What goes wrong:** verified in `core/server/media/service.ts`: member video is refused unless `body.purpose === 'post'` (lines 442-447), the member photo cap applies only to `post` (467-470), and the member video-minutes sub-budget counts only `purpose = 'post'` (`member-share.ts` `memberPostSecondsUsed`, `eq(mediaAssets.purpose, 'post')`). A member can *already* start `story`/`cover` **images** at the admin 15 MiB cap (bounded only by the half-ceiling byte share). So member stories would bypass the member caps and the minutes share, and `publishStory`/`resolveCoverAsset` check purpose and tenant but **not owner** (`stories/server/service.ts:459-471`, `communities/server/service.ts:512-523`), so a member could attach someone else's asset.
**How to avoid:** extend the three media sites to `purpose in ('post','story')` for video and `('post','story','cover')` for the image cap; the story video duration cap is the lower of the member policy and `MEDIA_LIMITS.video.story.maxDurationSeconds` (60; the `social` limits cap at the `post` limit of 300 s, A9); add `memberOwnerId` asset validation to `publishStory` and the cover resolvers (the feed already has it: `validateAssets(tx, wanted, isMember ? ctx.userId : undefined)`); a member video must be `ready` before publish (SOCIAL-05 rule, UI-D-703).

### Pitfall 11: Wire audience drives the "Administrador" badge
**What goes wrong:** `toPost` emits `audience: 'followers'` only for member posts (`feed/server/service.ts:305`) and the web draws the badge as `post.audience === 'followers' ? null : tf('post.adminBadge')` (`apps/web/lib/feed-view.tsx:266`). A `'community'` post has no `audience` key, so a member's community post would be badged as the administrator's. `FEED_AUDIENCES = ['tenant', 'followers']` (`feed/contracts/index.ts:56`), `PostCard.audience?: 'tenant' | 'followers'`, `FeedList.tsx:498` and `PostDetail.tsx:211` (`memberPost: post.audience === 'followers'`, the menu wording) all need the third value.
**How to avoid:** widen `FEED_AUDIENCES`, emit `audience` for `'community'`, badge only when `audience` is absent *and* the post is an organization post; add a card test.

### Pitfall 12: Web surfaces keyed on `stories.story.publish`
**What goes wrong:** giving members `stories.story.publish` (the permission the publish route evaluates) makes Início draw the admin's "+ Seu story" circle for a member: `lib/registry.tsx:688` `canPublish: bootstrap.permissions.includes('stories.story.publish')`, also `stories/publicar/page.tsx`, `comunidades/[communityId]/page.tsx:312` (gate "publish AND manage"), `StoryComposer.tsx:110-126`. Phase 9 met the same with `feed.post.create` and tightened the *organization-voice surfaces* with `content.publish` (SOCIAL-02).
**How to avoid:** the same fix: Início and organization surfaces require `content.publish`; member surfaces key on `social.participate`; unit tests on `lib/registry` and the pages for a member with the permission set composed.

## Code Examples

Proposals derived from the verified patterns above (no external docs involved; each shape mirrors the cited repo precedent). The planner owns exact names.

### Permission composition (extends `permissionsFor`, `registry.ts:225-233`)

```ts
// D-707, D-718. Member-only BY CONSTRUCTION, like social.participate: pin it in registry.test.ts (case 16's twin).
if (effective.has('social') && role === 'member') {
  permissions.add(FEED_PERMISSIONS.create);
  permissions.add(FEED_PERMISSIONS.manage);
  if (effective.has('communities')) {
    permissions.add('communities.community.create');
    permissions.add('communities.community.manage_own'); // ownership is tested in the statement, not here
  }
  if (effective.has('stories')) permissions.add('stories.story.publish');
}
```

### The owner branch of the one place-resolution seam (`stories/server/service.ts:1217-1233`)

```ts
const rows = await tx.execute<{ status: string; locked: boolean; kind: string; owner: string }>(sql`
  select c.status, (c.id = any (${LOCKED_COMMUNITY_IDS})) as locked, c.kind, c.created_by_user_id as owner
    from communities c
   where c.id = ${communityId}::uuid and c.tenant_id = ${ctx.tenantId}::uuid and c.deleted_at is null
   ${lock}`);
const community = rows[0];
if (!community) throw new ApiError(404, 'NOT_FOUND');
if (intent !== 'read') {
  const mayWrite = community.kind === 'organization'
    ? ctx.role === 'admin_tenant'            // any admin, D-706; a permission flag from the route is equally fine
    : community.owner === ctx.userId;        // the creator only
  if (!mayWrite && !(intent === 'takedown' && gate.canModerate)) throw new ApiError(403, 'FORBIDDEN');
}
```
(Prefer passing the already-computed permission flags in `gate` over reading `ctx.role` here, to honor T-05-03; the snippet shows the shape.)

### Hidden-creator definer and gates (09.3 template, `20261026213756_community_soft_delete_gate.sql`)

```sql
create or replace function app.member_community_hidden_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}'::uuid[])
    from public.communities c
   where c.tenant_id = app.tenant_id()
     and c.kind = 'member'
     and not exists (select 1 from public.memberships m
                      where m.tenant_id = c.tenant_id and m.user_id = c.created_by_user_id
                        and m.status = 'active' and m.blocked_at is null and m.deleted_at is null)
$$;
revoke all on function app.member_community_hidden_ids() from public;
grant execute on function app.member_community_hidden_ids() to authenticated;

create policy communities_member_hidden_gate on public.communities as restrictive for select to authenticated
  using (kind = 'organization' or id <> all (coalesce((select app.member_community_hidden_ids()), '{}'::uuid[])));
create policy feed_posts_member_hidden_community_gate on public.feed_posts as restrictive for select to authenticated
  using (community_id is null or community_id <> all (coalesce((select app.member_community_hidden_ids()), '{}'::uuid[])));
```
(No single-row pick clause: pgTAP 040 pins the set of `app` functions that use one.)

### Moderation vocabulary widening (09-07 shape)

```sql
ALTER TABLE "moderation_log" DROP CONSTRAINT "moderation_log_action_chk";
ALTER TABLE "moderation_log" DROP CONSTRAINT "moderation_log_subject_chk";
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_action_chk" CHECK ("moderation_log"."action" in
  ('comment_removed','member_blocked','member_unblocked','role_changed','post_removed','profile_form_exported',
   'story_removed','community_archived','community_removed'));
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_subject_chk" CHECK (
  (("moderation_log"."action" in ('comment_removed','post_removed','story_removed','community_archived','community_removed'))
     = ("moderation_log"."subject_type" is not null and "moderation_log"."subject_id" is not null))
  and ("moderation_log"."subject_type" is null or "moderation_log"."subject_type" in ('post_comment','story_comment','feed_post','story','community'))
  and (coalesce("moderation_log"."subject_type" = 'feed_post', false) = ("moderation_log"."action" = 'post_removed'))
  and (coalesce("moderation_log"."subject_type" = 'story', false) = ("moderation_log"."action" = 'story_removed'))
  and (coalesce("moderation_log"."subject_type" = 'community', false) = ("moderation_log"."action" in ('community_archived','community_removed'))));
```

### Member insert/update gates for `communities` (drizzle `pgPolicy`, `feed/db/schema.ts:309-314` shape)

```ts
pgPolicy('communities_kind_insert_gate', { as: 'restrictive', for: 'insert', to: authenticatedRole,
  withCheck: sql`(app.tenant_role() = 'member' and kind = 'member' and created_by_user_id = app.user_id() and position = 1000000 and ${SOCIAL_ENABLED})
              or (app.tenant_role() <> 'member' and kind = 'organization')` }),
pgPolicy('communities_member_update_gate', { as: 'restrictive', for: 'update', to: authenticatedRole,
  using: sql`app.tenant_role() <> 'member' or created_by_user_id = app.user_id()`,
  withCheck: sql`app.tenant_role() <> 'member' or (kind = 'member' and created_by_user_id = app.user_id())` }),
pgPolicy('communities_member_delete_gate', { as: 'restrictive', for: 'delete', to: authenticatedRole,
  using: sql`app.tenant_role() <> 'member'` }),
```
(A null role makes the predicates null, which denies: fail closed, the 09-14 posture.)

## The `social` Switch and the Per-Tenant Project (criterion 4)

How "stops new, stays readable" maps to code (D-718). The composed permission set is the single switch, SQL `app.social_enabled()` is the instant backstop:

| Surface | `social` ON | `social` OFF | Mechanism |
|---------|------------|--------------|-----------|
| Create / edit / archive / delete own community, publish post/story/highlight in it | allowed for the owner | `403 FORBIDDEN` (permission leaves the composed set after the flags cache window; RLS insert gates refuse with 42501 → mapped to 403 in the same window) | `permissionsFor` (`registry.ts`), `app.social_enabled()` in the insert gates |
| Read a member community, its posts, its highlights, like/comment on them | allowed | **unchanged** (no `social` predicate on these reads) | `listCommunities`/`getCommunity`/`listCommunityFeed` carry no social predicate; the `'community'` branch of `feed_posts_social_gate` must not require `social_enabled()` |
| Member stories in Explorar | visible per D-705 | gone (`GET /v1/stories/authors` is `404 MODULE_DISABLED`; the member-story select gate's branch 2 needs `social_enabled()`) | like `feedPage`'s `scope=explorar` |
| A story saved in a community highlight | readable by everyone who sees the community | **still readable** | gate branch 3 (highlight) has no `social` term |
| Moderator archive/delete/story delete | works | **works** (D-718) | guards use `moderation.manage` (kernel, no flag) and the admin role, not the member permissions |
| Reels lanes of member communities | listed | still listed (reads stay) | `listVideoCommunities` unchanged |

Two implementation traps: (1) the flags cache is 30 s (`moduleFlags`), so an instance may still compose the permission after the switch; this is exactly why Phase 9 added `app.social_enabled()` to its insert gate and mapped 42501 to 403 for members only. (2) A tenant with `social` on but `communities` or `stories` off: route chains `requireModule(...)` answer `404 MODULE_DISABLED` first; compose the member permissions only when the owning module is effective (see the `permissionsFor` example) so the web never reads a permission that has no route behind it.

**Per-tenant project implications.** Every migration here runs once per Supabase project through the ledgered `migrateAll` (docs/DEPLOY.md: "databases before API and worker", then "the web LAST", lines ~3248-3262). So: (a) all SQL must be valid on a *fresh* project and on an existing one (no data step; defaults cover rows); (b) hand-written definers/policies must reference only objects that exist in the tenant migration set (the control-plane "central" set is separate: `pnpm db:generate:central`); (c) no cross-project call. Prove it with `pnpm db:two` (applies the whole tenant set to an empty second database) and `pnpm db:migrate-all -- --dry-run` before release. The `authorUserId` contract change (A7) is the one item that changes the release order (web first).

## Web Sites That Assume "the organization's voice" (verified by grep)

The planner needs this list; each is a place where member authoring would silently misbehave:

| Site | Assumption | Needed change |
|------|-----------|---------------|
| `apps/web/lib/registry.tsx:688` | `canPublish: bootstrap.permissions.includes('stories.story.publish')` draws the admin "+ Seu story" in Início | also require `content.publish` (SOCIAL-02 precedent) |
| `apps/web/lib/registry.tsx:660-690` (`storiesHome`) | `loadStories({ limit })` tenant-wide, `curates` from `stories.story.manage` | Início reads organization stories only (API default); no behavior change for admins |
| `apps/web/lib/feed-view.tsx:261-266`, `FeedList.tsx:498`, `PostDetail.tsx:211`, `PostCard.tsx:95-99`, `PostMenu.tsx:74` | `audience === 'followers'` decides badge and menu wording | third value `'community'` (Pitfall 11) |
| `apps/web/app/(app)/comunidades/page.tsx:27,46`, `CommunitiesList.tsx:40,124` | `canManage` = reorder + archived read + create entry | switch to per-item/viewer flags and the new permissions; reorder list = organization only |
| `apps/web/app/(app)/comunidades/[communityId]/page.tsx:85,312`, `destaques/page.tsx`, `editar` | publish needs `feed.post.create` + `content.publish`; manage circle needs publish AND manage | read the API's `viewer` flags (UI-D-710) |
| `apps/web/app/(app)/criar/page.tsx:35`, `ComposerForm.tsx` | member composer has no community | `?comunidade={id}` for the owner; silent fallback for a foreign id (UI-D-710) |
| `apps/web/app/(app)/stories/publicar/*`, `meus/page.tsx`, `destaques/page.tsx`, `components/stories/StoryViewerHost.tsx:115,212` | `stories.story.manage` gates curation, history, "Destacar" | member mode (own stories, own communities) |
| `apps/web/app/(app)/inicio/ExplorarBody.tsx` | "no stories strip" today | add the row between chips and feed (UI-D-697) |
| `apps/web/components/platform/SocialLimitsSheet.tsx`, `lib/social-settings.ts`, `plataforma/tenants/[id]/modulos/actions.ts` | media-only limits | add `communities.maxPerMember` (re-parsed with the API's strict patch schema) |
| `apps/web/lib/moderation-view.ts`, `components/admin/ModerationLogRow.tsx` | exhaustive action/subject maps | three new kinds |

## Phase 9 Dependencies and Open Advisories That Touch This Phase

Read from `09-VERIFICATION.md` and the Phase 9 closure memory: Phase 9 is closed by Igor's word (UAT 5/5, four unproven), `/gsd-secure-phase 9` never ran (no `09-SECURITY.md`), and five advisories "gate enabling `social` on a real tenant". Phase 10 can ship and be tested without resolving them but **must not make them worse**, and two of them sit in code this phase edits:

| Advisory | Touches Phase 10? | Recommendation |
|----------|-------------------|----------------|
| `feed_posts_member_update_guard` is a four-column deny-list (author could clear `deleted_at`) | **Yes**: Phase 10 adds a third audience and member-community posts in the same table | Switch the guard to an allow-list of the author's editable columns in the same migration that widens the CHECKs, and add the pgTAP case (also forbids changing `visibility`/`community_id`) |
| `resolveCommentLiked` lacks the `socialCanReadFor` probe | Adjacent: comment-liked on a `'community'` post has no audience probe | Keep notices off for community posts (A4); fix the probe if Phase 11 turns notices on |
| Byte share widened to all purposes lets one member exhaust half the ceiling until the 24 h sweeper | **Yes**: member stories and covers add more uploads to that share | Accept (documented) or add a per-member pending cap; record in DEPLOY |
| Mux asset deleted before the conditional update (`event-job.ts`) | Adjacent (video jobs) | Not in scope; leave |
| DEPLOY.md grep wording ("renamed") | No | Leave |
| D-478 legal wording (terms, rules, privacy for third-party content) | **Yes**: members now also create *communities* | The "Ativar a Rede social" item gains member stories and communities (CONTEXT Rollout); wording itself stays Igor's |
| No API rate limiter (Phase 9 flagged) | **Yes**: create-community / publish-story spam | Use `createAttemptLimiter` (A6) |
| Dashboard "Conteúdo" counts member posts while `social` is on (Phase 9 Open Question 3) | **Yes**: `dashboard/server/content.ts:136,322` count `public.stories`; `activity.ts:108`, `members.ts:118`, `finance.ts:386` read `public.communities` | Decide before enabling `social`: count or exclude member stories/communities in the owner dashboard; at minimum record it |
| `MODER-04` flipped `[x]` by the Phase 9 close | **Yes** | Planner re-splits (REQUIREMENTS line 130) |

## State of the Art

| Old approach (this repo) | New approach (Phase 10) | When | Impact |
|--------------------------|-------------------------|------|--------|
| One tenant-wide strip, admin-only story authorship; stories carry no audience | Stamped `stories.visibility` + authors read for Explorar | Phase 10 | `GET /v1/stories` must scope; notifications must skip non-organization stories |
| A community is the organization's container; `created_by_user_id` stored never projected (D-67) | Stamped `kind`; the creator projected for member communities only | Phase 10 | Contract gains `kind`, `createdBy`, `viewer` flags (additive; `.strict()` consumers updated together) |
| Post audience `'tenant'|'followers'`; a followers post has no community (DB CHECK) | Third audience `'community'` | Phase 10 | CHECKs, insert gate, social gate, wire enum, badge, menu wording |
| Member media seam knows `post` only | Extends to `story` and `cover` | Phase 10 | broker, member-share, ready job duration cap |

**Deprecated/outdated within this phase's code:** the `member_no_community` refusal for owners (kept in `FEED_MEMBER_ISSUES` for non-owners' history only if the code is retained; the owner rule answers `403 FORBIDDEN`). The docblock "V1's single publisher makes the two sets identical" on `listOwnStories` stops being true. `communitySummarySchema`'s "no owner field" paragraph must be rewritten, not just extended.

## Assumptions Log

| # | Claim / recommendation | Section | Risk if wrong |
|---|------------------------|---------|---------------|
| A1 | Member communities sort after organization ones by giving them a sentinel `position = 1_000_000` (CHECK-backed) and leaving the list statement, index and cursor unchanged | Pitfall 3, Standard Stack alternatives | If Igor/planner prefers a clean `kind`-leading order, the cost is a new partial index, a new cursor shape and re-pinned EXPLAIN assertions in pgTAP 110/111 |
| A2 | New member-only permission keys `communities.community.create` and `communities.community.manage_own` (names planner-adjustable), plus reusing `stories.story.publish` for members with `content.publish` tightening on org surfaces | Pattern 1, Code Examples | Reusing `communities.community.manage` instead would flip reorder/archived/store sites; UI-SPEC text says members hold "the composed `stories.story.publish`" (consistent) but is silent on community permission names |
| A3 | A holder of `moderation.manage` may remove an *individual* post inside a member community (extend `softDeletePostInTx`'s moderator branch from `visibility = 'followers'` to include `'community'`, author live) | Open Questions | D-711 lists only stories and communities. Without it, a Phase 13 report of a member-community post resolved as `remove_content` would hit `removeReportedContentInTx` → `softDeletePostInTx` and answer 404, and the only remedy for one bad post is archiving the whole community |
| A4 | No notification for comments/likes on `'community'` posts (current resolvers return `[]` unless `visibility === 'followers'`/`'tenant'`); Phase 11 decides | Pitfall 8 | A creator is not told someone commented on their community post; if wanted, branch `resolvePostCommented` on `'community'` and skip the follow probe |
| A5 | Member story *video playback* should be gated like post video (`app.media_asset_hidden` gains a story branch); photo variants stay the accepted id-capability residual (A6 of Phase 9) | Open Questions | If skipped, a tenant member holding a followers-only story's asset id can mint a playback token. The id only reaches readers, same exposure class as member photos (accepted by Igor 2026-10-20) |
| A6 | Abuse ceilings via `createAttemptLimiter`: ~10 community creates and ~30 story publishes per member per hour (per process) | Pitfall 5, Security | Numbers are mine, not user-decided; too low frustrates, too high allows spam |
| A7 | Do not send another member's `authorUserId` on member stories; add `author { membershipId, displayName, avatarUrl }` and null `authorUserId` for non-authors (web deployed first) | Pattern 4 | If kept, user ids of members leak to followers (D-703's stance extended); changing it later is a contract break |
| A8 | An admin editing a member community's name/description/cover is allowed (UI-D-714 b) and is **not** logged (D-711 logs only archive and removal) | Pattern 6 | An admin can rewrite a member's text with no trace; alternative: log `community_updated` or restrict admins to archive/delete |
| A9 | Story video duration cap for members = min(`social` seconds, `MEDIA_LIMITS.video.story.maxDurationSeconds` = 60) although `social` allows up to 300 s | Pitfall 10 | D-715 says "same limits as a member post"; a literal reading lets a member story run 300 s, longer than any admin story |
| A10 | Branch 3 of the story gate (highlight lookup) and the authors read need measured plans (volume fixture) before the shape is final | Pattern 2, Pattern 5 | A per-row `exists` in a policy can degrade the strip like the correlated `story_views` form did (Seq Scan) |
| A11 | Member UPDATE policy on `communities` carries no `app.social_enabled()` term so the non-definer counter trigger and moderator-adjacent paths never fail; the service/permission stops member edits | Pitfall 4 | A member could edit their own community inside the 30 s cache window after `social` is turned off |
| A12 | Viewer-blocked creators (`member_blocks`) hide a member community from lists **and** the by-id read (bare 404), mirroring `getPost`'s `app.is_blocked_by_viewer` check (`feed/server/service.ts:809`) | Pattern 3 | UI-D-717 says "by omission only" in lists; an unrestricted by-id read leaves the page reachable |

## Open Questions

1. **Who archived a member community?** (UI-SPEC OQ-3)
   - Known: the data does not record it, so a creator can reactivate a community the moderator archived; both look identical to the creator.
   - Unclear: whether that matters. Fixing it needs an "archived by moderation" mark (a column, plus a reactivate refusal and copy).
   - Recommendation: accept for this phase (UI default), record as a known limit in the module README and DEPLOY; the moderator's remedy is delete.

2. **Per-post moderation inside a member community** (A3). Recommend extending the moderator branch and adding the pgTAP/integration case; needs one line from Igor because D-711 enumerates only stories and communities.

3. **Story video playback gating** (A5) and **owner dashboard counts** (Phase 9 OQ-3): decide before enabling `social`; neither blocks the phase.

4. **UI-SPEC open questions OQ-1..OQ-7 and the sketch gate (proposed sketch 020)** are Igor's to answer and approve; UI tasks wait for the sketch (D-33/D-365). API consequences found here: OQ-1 (community "+" circle → same publish screen with a pre-selected destination) needs no new endpoint (a member's `publishStory` with `highlightId`/`newHighlight` for an owned community goes through the owner seam); OQ-4 is Pitfall 11 (the badge); OQ-3 is question 1.

5. **Roadmap/requirements rewording at planning** (CONTEXT Deferred): criterion 3 (D-706), MODER-04 split, Phase 11 criterion 4, the new ids above. The ROADMAP `**Requirements**:` line for Phase 10 is "TBD".

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v24.14.0 | — |
| pnpm | monorepo scripts | ✓ | 12.4.1 | — |
| Docker CLI | local Supabase stack (pgTAP, integration, e2e) | ✓ (CLI 29.3.1; daemon not probed) | 29.3.1 | none: pgTAP/integration/e2e need the stack |
| Local Supabase stack running | `pnpm supabase test db`, integration suite, seed | not probed (do not start/reset without Igor) | — | unit suites (`vitest` per package) need no stack |
| Playwright browsers / web dev server | e2e | not probed | 1.63.0 pinned | component tests |
| Disk | Docker + `.next` caches | ✓ 26 GiB free at probe (87% used); memory notes record ENOSPC hangs at ~3 GiB | — | rm `.turbo/cache`, `apps/web/.next` when no dev server runs; run e2e behind a disk watchdog |

**Missing dependencies with no fallback:** none identified; stack state must be confirmed by the executor.
**Missing dependencies with fallback:** n/a.

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`. `security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: "high"`, `api_coverage_gate: true`.

### Test Framework

| Property | Value |
|----------|-------|
| Frameworks | Vitest 5.0.0 (unit per package + API integration), pgTAP via `supabase test db`, Playwright 1.63.0 (mobile viewports) |
| Config files | `packages/modules/<pkg>/vitest.config.ts`, `packages/core/vitest.config.ts`, `apps/api` (`test` = `vitest run tests/unit`, `test:integration` = `vitest run tests/integration`), `apps/web` (`vitest`, `playwright`) |
| Quick run (per package) | `pnpm --filter @rede-social/module-communities test` · `…module-stories test` · `…module-feed test` · `…module-social test` · `pnpm --filter @rede-social/core test` · `pnpm --filter @rede-social/api test` (unit: includes `registry.test.ts` and `isolation-inventory.test.ts`) · `pnpm --filter @rede-social/web test` |
| Static gates | `pnpm db:generate 2>&1 \| grep -q "No schema changes"` · `bash scripts/check-ui-literals.sh` · `pnpm boundaries` · `pnpm lint` |
| pgTAP (BEFORE integration) | `pnpm db:reset && pnpm db:seed && pnpm supabase test db` (**the reset only with Igor's word**) |
| One integration file | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts` (`pnpm test:integration -- x` does **not** filter) |
| e2e | `pnpm --filter @rede-social/web exec playwright test stories.spec.ts social.spec.ts comunidades.spec.ts social-platform.spec.ts` (existing specs; helpers `social-admin.ts`, `admin.ts`, `fixtures.ts`) |
| Regression gate | `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` (unbounded runs exhaust memory); exit gate `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` |

Known quirks (project memory): run pgTAP before integration (residue trips `154-moderation-log.sql`); `db:reset` needs `pnpm db:seed` after or `isolation.test.ts` aborts ("tenant rede-demo is not seeded"); use `bash scripts/supabase.sh` (the root `supabase` script already does); local manual UAT drifts seed-pinned tests; `isolation-inventory.test.ts` (unit, no DB) fails the moment a mounted route has no inventory entry, so it is the first red a new route produces.

### Phase Requirements → Test Map

| Req | Behavior | Test type | Automated command / file | File exists? |
|-----|----------|-----------|--------------------------|--------------|
| MCOMM-01, MPUB-02 | kind stamped from role, never body; permission composition member-only | unit + integration + pgTAP | `registry.test.ts` (new case beside 16), `communities.test.ts`, `230-member-communities.sql` | ❌ Wave 0 (extend existing) |
| MCOMM-02, MCOMM-08 | whole tenant reads; community post in no Início/Explorar/Reels Todos | integration | `feed-social.test.ts` (new "10 community audience" block), `reels.test.ts` | ✅ extend |
| MCOMM-03, MCOMM-09 | order org-first, sentinel kept after admin reorder; reorder = org only; lanes order | integration + pgTAP EXPLAIN | `communities.test.ts`, `order.test.ts` (module unit), `110`/`111` (plan pins unchanged) | ✅ extend |
| MCOMM-04 | `createdBy` key set exact, no user id | unit (contract) + integration | `packages/modules/communities/tests/contracts.test.ts`, `communities.test.ts` | ✅ extend |
| MCOMM-05 | limit incl. archived freed, `Promise.all` race, reactivation, 0 | integration | `member-communities.test.ts` | ❌ Wave 0 |
| MCOMM-06, MPUB-01 | creator everything / other member 403 / admin cannot publish in member community / admin can in organization | integration | `member-communities.test.ts`, `stories.test.ts` | ❌ / ✅ |
| MCOMM-07, MSTORY-08 | blocked/removed creator → bare 404 everywhere, restore on unblock; viewer-blocked | pgTAP + integration | `230-…sql` (definer truth table), `member-communities.test.ts`, `reports-blocks.test.ts` | ❌ Wave 0 |
| MCOMM-10, MSTORY-09 | moderation actions + log row same tx, rollback on log failure, works with social off | integration + pgTAP | `moderation-member-content.test.ts`, `154-moderation-log.sql` (extend), `packages/core/tests/moderation-log.test.ts` | ❌ / ✅ |
| MPUB-03 | owner posts with limits, `'community'` stamped, non-owner 403, PDF refused | integration | `feed-social.test.ts`, `feed-media.test.ts` | ✅ extend |
| MPUB-04 | forged kind/visibility/owner → 42501; each policy negative | pgTAP | `230`, `231`, `201-feed-social-gate.sql` (extend) | ❌ Wave 0 |
| MPUB-05 | social off/on matrix incl. 30 s cache window 42501→403 | integration | `social-module.test.ts`, `member-communities.test.ts` | ✅ extend |
| MPUB-06 | admin pickers/catalog exclude member communities | integration | `stories.test.ts` (catalog), `communities.test.ts` | ✅ extend |
| MPUB-07 | inventory entries + sweep with positive control + wrong-host 403; no schema diff; expand-only | unit + integration + static | `isolation-inventory.test.ts`, `isolation.test.ts` ("phase 10 sweep"), `pnpm db:generate` | ✅ extend |
| MSTORY-01, MSTORY-07 | member story limits, video ready, owner asset, minutes share incl. story | integration | `social-media.test.ts`, `media.test.ts` | ✅ extend |
| MSTORY-02 | `GET /v1/stories` org-only; Início highlights unchanged | integration | `stories.test.ts` | ✅ extend |
| MSTORY-03 | authors read: member vs moderator scope, order, paging, statement budget | integration + pgTAP EXPLAIN | `member-stories.test.ts`, `feed-query-budget.test.ts`, `231-member-stories.sql` | ❌ Wave 0 |
| MSTORY-04 | gate truth table (author, follower, non-follower, moderator, support, system lane, other tenant, highlight branch, social off) on read/like/comment | pgTAP + integration | `231-member-stories.sql`, `member-stories.test.ts` | ❌ Wave 0 |
| MSTORY-05 | zero notifications on member publish; comment notice unchanged | unit + integration | `stories/tests/notification-sources.test.ts`, `notifications.test.ts` | ✅ extend |
| MSTORY-06 | own story into own highlight only; foreign story 404; readable by all after 24 h | integration + pgTAP (`120` clock control) | `member-stories.test.ts`, `120-story-highlights.sql` | ✅ / ❌ |
| UI: row, own circle, forms, notices, flags | web behavior | unit + e2e (mobile) | `StoriesSurface.test.tsx`, `CommunitiesList.test.tsx`, `CommunityForm.test.tsx`, `SocialLimitsSheet.test.tsx`, `stories.spec.ts`, `social.spec.ts`, `comunidades.spec.ts` | ✅ extend |

### Sampling Rate
- **Per task commit:** the touched package's Vitest + typecheck/lint of that package; `pnpm boundaries` when an import changed; `bash scripts/check-ui-literals.sh` for web.
- **Per wave merge:** `pnpm db:generate` prints "No schema changes", then (with Igor's consent for the reset) `pnpm db:reset && pnpm db:seed && pnpm supabase test db`, then the wave's integration files one at a time.
- **Phase gate:** `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify` green; `COVERAGE.md` one-liner (no third-party API: only the phase's own Postgres, Hono API, definers and existing Storage/Mux/pg-boss paths, ≤ 200 characters: the api-coverage gate rejected 233 characters in Phase 9).

### Wave 0 Gaps
- [ ] `supabase/tests/230-member-communities.sql` — kind CHECK, sentinel CHECK, insert/update/delete gates (forged kind/owner/position, non-owner, other tenant, null role, social off), hidden-creator definer truth table (live, blocked, removed, unblocked restores), counter reconciliation with a member-lane insert/soft-delete, order EXPLAIN unchanged, `moderation_log` widened CHECKs
- [ ] `supabase/tests/231-member-stories.sql` — story audience gate truth table incl. highlight branch under a controlled clock, insert gate, EXPLAIN for the authors read on a volume fixture
- [ ] `supabase/tests/232-feed-community-audience.sql` — the `'community'` audience: CHECKs, insert branch (owner vs non-owner vs admin vs support), social gate with `social` off, partial index pins by name, `feed_posts_member_update_guard` allow-list case
- [ ] `apps/api/tests/integration/member-communities.test.ts`, `member-stories.test.ts`, `moderation-member-content.test.ts`
- [ ] Extend `isolation-inventory.ts` (new routes: `GET /v1/stories/authors`, `GET /v1/stories/authors/:membershipId`, member `mine` variant; changed guards keep their keys) and `isolation.test.ts` "phase 10 sweep"
- [ ] Extend `registry.test.ts` (member permission pins, off-by-default, requires), `feed-query-budget.test.ts`
- [ ] Seed: `scripts/seed.ts` adds one member community + one member story for the isolation tenant (`social` on there; the real tenant stays off)
- [ ] Framework install: none

## Security Domain

`security_enforcement` is enabled (ASVS L1, block on high). Phase 10 opens authoring to an untrusted role, so access control dominates.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | existing Supabase Auth + `requireAuth` |
| V3 Session Management | no (unchanged) | existing BFF cookies |
| V4 Access Control | **yes (primary)** | permission guards + ownership predicate in the statement + restrictive RLS gates + bare-404 posture (D-23); never a hidden-control-only rule |
| V5 Input Validation | **yes** | Zod `.strict()` schemas, closed machine-code vocabularies in `details.<module>`; caption/name/description are plain text rendered by React (no `dangerouslySetInnerHTML`); names/captions never reach logs |
| V7 Error Handling and Logging | yes | ids-only pino lines (`moduleLogger`), moderation log carries the capped excerpt only via permission-guarded routes |
| V8 Data Protection | yes | `created_by_user_id` / `authorUserId` never projected to other members (Pattern 4, A7); story media id-capability residual recorded |
| V12 Files and Resources | **yes** | kernel broker limits (mime allow-list, size, HEIC refusal, signed direct upload), member sub-budget, asset-ownership checks at publish |
| V13 API | yes | rate ceilings (A6), tenant-pinned definers, expand-only migrations |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Authz bypass: member publishes/edits in a community they do not own (IDOR by community id) | Elevation | owner seam in the service + restrictive insert/update RLS; 403 for visible-not-owned, bare 404 for unknown/other tenant; pgTAP negatives per lane |
| Mass assignment of `kind`, `created_by_user_id`, `visibility`, `position` | Tampering | not in any request schema (`.strict()`), written from `ctx`/target row, RLS insert gate refuses mismatch |
| Cross-tenant id (community, story, asset, highlight) | Info disclosure / Tampering | explicit `tenant_id` predicate + RLS + definers pinned `tenant_id = app.tenant_id()`; one bare 404; isolation inventory with positive control |
| Member adds someone else's story/asset to their community (publishes another person's content) | Tampering | `author_user_id = ctx.userId` / `owner_user_id = ctx.userId` in the SELECT of the insert (Pitfall 9, 10) |
| Followers-only story or member-community content leaking via merged reads, notifications, push, Reels, counts | Info disclosure | Pitfalls 1, 8, 11; negative tests per surface |
| Stored XSS in names, descriptions, captions, display names | Tampering | React text rendering, no HTML storage; link auto-detect at render (existing); contract length caps (`COMMUNITY_MAX_NAME` 80, `COMMUNITY_MAX_DESCRIPTION` 280) |
| Upload abuse (oversize, wrong type, storage exhaustion, video minutes) | DoS | broker caps + member half-ceiling share (extended to story video minutes) + attempt limiter |
| Creation spam / create-archive loops / limit race | DoS | advisory-locked count, reactivation check, limiter |
| Existence oracle (403 vs 404 differences) | Info disclosure | 404 for anything the tenant lane cannot see; 403 only for a community the caller can already see (COMM-02) |
| Admin abuse of power over member content with no trace | Repudiation | same-transaction `moderation_log` rows (immutable by trigger); A8 flags unlogged edits |
| Stale permission after `social` off (30 s cache) | Elevation | `app.social_enabled()` in RLS insert gates; 42501 → 403 for members only |

## Sources

### Primary (HIGH confidence): files read this session (`[VERIFIED: repo]`)
- `.planning/phases/10-.../10-CONTEXT.md`, `10-DISCUSSION-LOG.md`, `10-UI-SPEC.md` (all UI-D-697..720, OQ-1..OQ-7, Wave 0 sketch gate); `.planning/ROADMAP.md` Phase 10/11 sections; `.planning/REQUIREMENTS.md` (MODER-04, SOCIAL-01..10, EXPL, FOLLOW); `.planning/config.json`; `.claude/CLAUDE.md`
- `packages/modules/communities/{module.ts, db/schema.ts, contracts/index.ts, server/routes.ts, server/service.ts}`
- `packages/modules/stories/{module.ts, db/schema.ts, contracts/index.ts, server/routes.ts, server/service.ts (1-630, 1130-1770, 2100-2188), server/notifications.ts}`
- `packages/modules/feed/{db/schema.ts (56-330, 596-760), server/service.ts (320-800, 896-970, 1140-1330, 1560-1665), server/notifications.ts, contracts/index.ts (audience, member issues)}`
- `packages/modules/social/contracts/index.ts`; `apps/api/src/modules/registry.ts`; `packages/core/server/rbac/{permissions.ts, require-role.ts}`; `packages/core/server/moderation/log.ts`; `packages/contracts/src/moderation.ts`; `packages/core/server/safety/{blocks.ts, limits.ts}`; `packages/core/server/media/{service.ts, member-policy.ts, member-share.ts}`; `packages/contracts/src/media.ts`; `packages/core/db/{tenant-tx.ts, community-gate.ts}`
- Migrations: `20260923204828_communities_counters.sql`, `20260923171503_communities.sql`, `20261002121805_moderation_log.sql`, `20261019225153_moderation_post_removed.sql`, `20261029232606_profile_form_tables.sql`, `20261019204645_social_gate_seam.sql`, `20261019204737_social_functions.sql`, `20261020123859_social_can_read_for.sql`, `20261020123217_social_audience_revocation.sql`, `20261026213756_community_soft_delete_gate.sql`, `20261105152916_reports_blocks_functions.sql`
- Web: `apps/web/lib/registry.tsx`, `apps/web/app/(app)/inicio/ExplorarBody.tsx`, `apps/web/components/stories/StoriesSurface.tsx`, grep of permission/audience sites; `apps/web/e2e/` spec list
- Tests/docs: `apps/api/tests/isolation-inventory.ts`, pgTAP `200-social.sql`, `110-communities-stories.sql` headers, `.planning/phases/09-.../{09-VALIDATION.md, 09-VERIFICATION.md, COVERAGE.md}`, `docs/DEPLOY.md` (order and "Ativar a Rede social"), `package.json` scripts, project memory notes

### Secondary (MEDIUM/HIGH, official docs)
- PostgreSQL `CREATE POLICY` — https://www.postgresql.org/docs/current/sql-createpolicy.html (fetched this session: restrictive policies combine with AND; an UPDATE row failing `USING` is silently skipped, no error; a failing `WITH CHECK` aborts the command with an error) `[CITED]`

### Tertiary (LOW)
- none. No web research was needed: no library is added and every behavior asserted is in the repo.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no change (nothing installed).
- Seams and leak sites: HIGH, each cited with file and line from a Read this session.
- Design recommendations (R1-R8, Patterns 2-7): MEDIUM-HIGH; the choices that can still move are the assumptions A1, A2, A3, A7, A8.
- Performance of the story gate branch 3 and the authors read: MEDIUM until measured (A10).
- Pitfalls: HIGH for the ones tied to read code (1, 4, 8, 9, 10, 11, 12), MEDIUM for the abuse-ceiling numbers (A6).

**Research date:** 2026-11-10
**Valid until:** 2026-12-10 for the seams (the repo moves quickly: Phase 12.2/12.3/13 plans touch feed/media/moderation; re-grep `feed_posts_visibility_chk`, `moderation_log_*_chk` and `permissionsFor` before planning if those phases land first). The CONTEXT.md is dated 2026-11-10; any later edit of it flags this file as drifted (project memory: context-drift uses commit times).


<!-- Reconciled 2026-11-10 with CONTEXT.md: only the bullet format of the carried-forward D-466 and D-473 changed, no decision text. -->
