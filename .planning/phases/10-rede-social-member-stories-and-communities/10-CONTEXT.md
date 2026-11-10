# Phase 10: Rede Social - Member Stories and Communities - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

With the toggleable module **"Rede social"** (key `social`, Phase 9) on, members also publish stories and create their own communities, and a community accepts publications only from its owner: the creator for a member-created community, any `admin_tenant` for an organization community. The four roadmap success criteria (`.planning/ROADMAP.md` § Phase 10) stay locked as written, except where D-706 refines the wording of criterion 3.

What the phase delivers:

- **Member stories.** A member publishes a story from their own circle, the first circle of the Explorar row. Início's grouped circle stays the organization's voice (admin only). Explorar gets a story row, one circle per author, built on 05.2's grouped viewer; a member's story is read by the author, the author's followers and holders of `moderation.manage`.
- **Member-created communities.** A member creates a community (name, description, cover) and curates its highlights (05.2). It is listed for the whole tenant, below the organization's communities, labelled "Criada por Fulano". Only the creator publishes in it.
- **The creator-scoped publishing seam** (the heart of the phase): posts, stories and highlights in a community are allowed only to its owner; everyone else sees and interacts (like, comment) but gets no publish control and a 403 from the API.
- **The module switch.** Turning `social` off stops new member stories and communities; existing member communities stay readable.
- **The minimum moderation that cannot wait for Phase 11** (pulled forward, as D-475 did for posts): the admin deletes any member story and archives or removes any member community, each action written to the moderation log.

Out of this phase (other phases own them):

- Direct messages, member-to-member blocking effects on messaging/follow/profile button, the reports queue, report subjects `story_comment`/`community`/`direct_message`, "block author" and the follower notices ("started following you", "new message"): Phase 11.
- Any notice for a new member story or a new member community (nobody is told, as D-476 for posts): Phase 11 decides.
- A profile feed or a story ring on avatars outside Explorar: declined here.
- Private/opt-in communities that use the `community_members` table, and linking store products to a member community: V2 / admin only.

</domain>

<decisions>
## Implementation Decisions

Decision numbers continue after 12.3's D-700. UI decisions in this phase's UI-SPEC continue after UI-D-696.

### Carried forward (locked before this discussion, do not re-open)
- **D-466..D-484 [informational] (Phase 9):** the `social` module, the follow graph (member to member only, D-467), the member's posts visible only to followers, the staff Explorar and the post removal with a log row (D-475), `permissionsFor` granting member authoring from `social` being effective (D-482), off hides everything and on brings it back (D-483), a blocked member's content leaves every list (D-484). Every one of these keeps holding.
- **D-469 [informational] (Phase 9):** a followers-only item opened by someone who may not see it is a locked answer for a post. This phase does NOT add a locked screen for stories or communities (see D-705, D-701).
- **D-472 [informational] (Phase 9):** Início is the organization's voice and the member composer lives in Explorar only; the `ComposeFab` of Explorar stays for posts (D-714).
- **D-473, D-474 [informational] (Phase 9):** a member post carries a caption, photos, at most one video (where the tenant allows it) and a link, no attachment, no community; the limits live in `tenant_modules['social'].settings`, edited by `super_admin`. D-709 replaces only the "no community" half.
- **D-616 [informational] (Phase 13, NATIVE-31/NATIVE-33):** the member block (`member_blocks`) and its content filter are kernel, not gated by `social`; the report slice for posts and comments is delivered there. This phase does not plan them again.
- **D-89 [informational] (Phase 5/05.1):** the archived-communities list is a manager read; the web and the API both refuse a caller without the permission.
- **D-23 [informational]:** an unknown, other-tenant or removed id answers one bare 404 with no distinguishing code.
- **T-05-03, T-05-25 [informational]:** community and story write guards are PERMISSIONS (`communities.community.manage`, `stories.story.manage`, `stories.story.publish`), never a role comparison.
- **D-121 [informational] (05.3):** a module that builds on another contributes nothing while the base is off.

### Who sees what a member creates
- **D-701:** a member-created community is listed and opened by the **whole tenant**, exactly like an organization community: cover, name, description, posts and highlights are readable by every member, who may like and comment. COMM-02 stands ("every tenant member sees every community that is not locked"). There is no "Siga para ver" screen for communities. The store lock (STORE-11) never applies to a member community because a member cannot link products to it (D-713).
- **D-702:** the posts a creator publishes in their community appear **only on that community's page** (and its own Reels lane, see Claude's Discretion). They are not in Início (SOCIAL-04 keeps Início organization-voice only, which today includes the merged feed's community posts, D-73, so the merged feed must exclude posts of member communities) and not in Explorar (D-471's predicate `community_id is null` stays).
- **D-703:** a member-created community shows **"Criada por Fulano"** in its header and on its card in the list; the name opens that member's profile (where the Seguir button is). Organization communities carry no such label. This projects the creator for the first time (D-67 kept `created_by_user_id` for audit only): only the display name, avatar asset id and membership id leave the server, never the user id.
- **D-704:** a member's active story shows **only in the Explorar row** (one circle per author). There is no ring on the profile, the `/membros` list, post headers, comments or any other avatar. Opening these later is easy; closing is not (D-468's stance).
- **D-705:** a member story is readable only by its author, the author's followers and holders of `moderation.manage`; the story read, its likes and its comments follow the same gate. For anyone else the story read answers the bare 404 (stories have no shared link to turn into a "Siga para ver" screen).

### The creator rule
- **D-706:** the **owner rule**, stated per community kind: a community created by `admin_tenant` (the organization's voice) accepts posts, stories and highlights from **any `admin_tenant`**, as today (D-482: a second admin is the organization's voice too); a community created by a member accepts them **only from that creator**. Nobody else publishes: the API answers `403 FORBIDDEN`, the web shows no publish control, and others still like and comment. This **refines roadmap criterion 3** ("only the creator, for admin and member communities alike") because the literal reading would lock a second admin out of the first admin's communities in every tenant that has more than one admin (user decision 2026-11-10). — **Reversibility:** costly — the rule lands in the post, story and highlight write seams, in RLS and in the permission composition; tightening it to the literal reading later changes who can publish in existing communities.
- **D-707:** a member's authoring permissions for communities come from the composed permission set like D-482: with `social` effective, role `member` holds the permission to **create** a community and to **manage and publish in the ones they own**; the ownership test is `created_by_user_id = ctx.userId` in the statement (as T-04-54 does for posts), never a role comparison. `admin_tenant` keeps `communities.community.manage` over every community.
- **D-708:** when the creator of a member community is **blocked by the admin or leaves the tenant** (`memberships.blocked_at` set or the membership soft-deleted), the community, its posts, its highlights and its stories **leave every list and answer the bare 404**, nothing is deleted, and unblocking brings it all back, as D-484 does for posts. There is no transfer of ownership.
- **D-709:** a creator publishes in their community the **same post a member publishes** (D-473): caption, photos, at most one video where the tenant allows it, and a link with its preview; **no PDF**, under the same `social` media limits. The post is born inside the community (`community_id` set). The API's `member_no_community` refusal is replaced by the owner rule of D-706 for member authors; a member still cannot publish in a community they do not own, and still cannot attach a PDF anywhere.

### Creating and moderating
- **D-710:** each member may own a limited number of communities, **default 3**, stored in `tenant_modules['social'].settings` beside the media limits (D-474), edited per tenant by `super_admin` in the platform panel's `social` form. Archived and removed communities do not count. Over the limit, the API refuses with a validation code and the web shows a notice, not only a hidden button.
- **D-711:** the admin **keeps moderation** over what members create, and the log row ships **in this phase**: a holder of `moderation.manage` soft-deletes any member story and archives or removes any member-created community, and each action writes a `moderation_log` row in the same transaction (the shape of D-475; the author is not told). MODER-04 is split again at planning: posts were SOCIAL-07 (Phase 9), stories and communities are delivered here, and Phase 11 keeps the reports queue and "block author". Today `deleteStory` and the community writes already accept any admin without an author predicate; the change is that a **member** may only touch their own, while the admin keeps every row and now leaves a trace. — **Reversibility:** costly — the moderation log's action/subject vocabulary is stored strings (and may sit behind a check constraint), so the new values land in a migration and in every reader of the log.
- **D-712:** in the Comunidades list, **organization communities come first in the admin's order** (`position`, then activity), and **member communities follow, newest activity first**. A member cannot reorder anything and a new member community never jumps above the organization's. `PUT /v1/communities/order` stays admin-only and covers organization communities only.
- **D-713:** a creator can do with their own community **everything the admin does with theirs**: edit name, description and cover, archive, reactivate, delete an archived one (PEND-01..14's rule) and curate its highlights (05.2). They **cannot link store products** to it (that field is absent from their form) and **cannot reorder** the list. The create and edit form is 05.1's `CommunityForm` without the products field. The creator reads their own archived communities (the D-89 archived read, scoped to their own rows).

### Member stories
- **D-714:** a member publishes a story from **their own circle, the first circle of the Explorar row**, shown with a "+" when they have no active story (the Instagram model). That opens the member version of the publish screen. The Explorar `ComposeFab` stays for posts only; there is no second entry point.
- **D-715:** a member story carries a photo or a video and an optional caption, lives **24 hours**, and uses the **same limits as a member post**: photo bytes from `social.media`, video only when `super_admin` turned member video on, with its seconds and bytes limit. No new limits block in the platform panel. A member whose tenant has video off does not see the video control.
- **D-716:** a creator may save one of their own stories in a **highlight of their own community**. A story saved there is readable by **everyone who sees the community**, including after the 24 hours, because saving it is the act of publishing it in that community. The publish and highlight screens say so before confirming ("Todos os membros verão este story na comunidade").
- **D-717:** a holder of `moderation.manage` sees **every member's active story in the Explorar row** without following anyone (the admin is outside the follow graph, D-467), one circle per member, and deletes any of them from the story menu (D-711). Início's circle is untouched.

### Module switch
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

### Folded Todos
None. `todo.match-phase` found no pending todos for Phase 10.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` § Phase 10 (goal, four locked criteria, the open question this discussion answered), § Phase 11 (what is NOT here: DMs, block effects, the reports queue, MODER-04's remainder, follower notices), § Phase 13 (NATIVE-31/NATIVE-33, the report and block slice already delivered).
- `.planning/REQUIREMENTS.md`: COMM-01..04, STORY-01..05, HIGHLIGHT-01..06, SOCIAL-01..10 (the module, permissions, member media, the moderation path, isolation suite), FOLLOW-01..06, EXPL-01..06, MODER-04 (to be split again), CHAT-07 and NATIVE-33 (the blocker's filter), V2-CONT-02 (promoted here). New requirement ids for this phase are written at planning.
- `.planning/PROJECT.md`: core value (zero leakage between tenants), MOD-01..05, the Key Decisions table.

### Prior decisions that constrain this phase
- `.planning/phases/09-rede-social-follow-member-posts-and-explorar/09-CONTEXT.md` and `09-UI-SPEC.md`: D-466..D-484, UI-D-491..UI-D-512 (the `social` module, Explorar, the member composer, the safety net, off/on and blocked-member rules).
- `.planning/phases/05-communities-stories/05-CONTEXT.md`: the communities and stories modules, D-67 (creator never projected), D-76 (list order), the permission-not-role guards (T-05-03, T-05-25).
- `.planning/phases/05.1-community-authoring-entry-points/05.1-CONTEXT.md` and `05.1-UI-SPEC.md`: the community form and composer entry points to reuse, D-89 (archived list).
- `.planning/phases/05.2-story-highlights/05.2-CONTEXT.md` and `05.2-UI-SPEC.md`: highlights as the story's place, the grouped viewer and seen state, UI-D-59..UI-D-80.
- `.planning/phases/05.3-reels/05.3-CONTEXT.md`: D-117..D-132 (Reels lanes per community, "Todos").
- `.planning/phases/08-moderation-tenant-admin-panel-pilot-hardening/08-CONTEXT.md`: `moderation.manage`, the moderation log, tenant-level block.
- `.planning/phases/13-app-nativo-ios-e-android-por-tenant-white-label/13-CONTEXT.md`: D-616 and the `member_blocks` / `content_reports` kernel slice.

### Code this phase extends
- `packages/modules/communities/` (`module.ts`, `contracts/index.ts`, `db/schema.ts`, `server/routes.ts`, `server/service.ts`, `ui/`): `createCommunity`, `updateCommunity`, `deleteCommunity`, the list order, the archived read, `communities.community.manage`.
- `packages/modules/stories/` (`module.ts`, `contracts/index.ts`, `db/schema.ts`, `server/routes.ts`, `server/service.ts`, `ui/`): `publishStorySchema`, `deleteStory`, the highlight routes, `stories.story.manage` / `stories.story.publish`, the strip and the grouped viewer.
- `packages/modules/feed/server/service.ts` and `server/routes.ts`: `createPost` (the `member_no_community` refusal), `feedPage` and the merged-feed predicates (`NOT_LOCKED`, Início, Explorar, `memberPostVisible`), `listCommunityFeed`.
- `packages/modules/social/` (`contracts/index.ts` `socialSettingsSchema`, `server/`): the settings seam where the per-member community limit lands.
- `apps/api/src/modules/registry.ts` (`permissionsFor`, the member media seam) and `packages/core/server/rbac/require-role.ts`.
- `packages/core/server/moderation/log.ts` (`recordModerationAction`), `packages/contracts/src/moderation.ts`, `packages/core/server/safety/blocks.ts` and `packages/core/db/schema/member-blocks.ts`.
- `apps/web/app/(app)/comunidades/` (`CommunitiesList.tsx`, `CommunityForm.tsx`, `nova/`, `[communityId]/`), `apps/web/app/(app)/stories/` (`publicar/`, `meus/`, `destaques/`), `apps/web/app/(app)/inicio/ExplorarBody.tsx`, `apps/web/lib/registry.tsx`.
- `apps/api/tests/integration/isolation.test.ts` and the isolation inventory: every new route joins it; `supabase/tests/` for the pgTAP negatives.
- `docs/DEPLOY.md` ("Ativar a Rede social").

### Design
- `.planning/sketches/MANIFEST.md`: the D-33/D-365 review record. Prototype-less surfaces here (the Explorar story row with the member's own "+" circle, the member's create-community entry and form, the "Criada por Fulano" label, the member publish and highlight screens with the visibility notice, the platform panel's community limit) go through the sketch gate and a UI-SPEC before UI tasks.
- `reference/frontend-design/` and `.planning/research/PROTOTYPE.md`: porting rules.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`CommunityForm` / `nova/` / `CommunitiesList`** (`apps/web/app/(app)/comunidades/`): the create and edit form and the list; the member version is the same form without the products field.
- **`createCommunity` / `updateCommunity` / `deleteCommunity`** (`packages/modules/communities/server/service.ts`): the writes; they carry no author predicate today (the guard is the manage permission), so the owner predicate is a new seam.
- **05.2's grouped story viewer, `StoriesStrip`, `StoryCircle`, the seen state**: the Explorar row is one more consumer; the strip query today is tenant-wide.
- **`publishStorySchema`** (`communityId` or `newHighlight` destination) and the highlight routes: a story's "place" is decided by highlights (Início, or one community), never stored on the story.
- **`recordModerationAction`**: the log write D-475 used for post removal; story removal and community archive/removal use the same shape.
- **The `social` settings seam** (`socialSettingsSchema`, `tenant_modules['social'].settings`) and the platform panel's `social` form: where the community limit lands.
- **`permissionsFor` and the member media seam** in `apps/api/src/modules/registry.ts`: where member authoring for communities and stories is composed, and where the media purposes extend.

### Established Patterns
- Write guards are permissions, not roles; ownership predicates live in the statement (`author_user_id = ctx.userId`, T-04-54).
- `communities.created_by_user_id` is NOT NULL, so every existing community has an owner (the admin who created it); `communities.position` defaults to 0 and a new community lands first, which D-712 must override for member communities.
- `stories` have no place column; `story_highlights.community_id` null means Início. `community_id` on highlights has no drizzle `.references()` (module boundary, MOD-02) but a real hand-written foreign key.
- Business reads go through the Hono API with RLS and the `api_user` role; a gate that depends on another row (follow, role, block, owner) is a definer or a join with explicit tenant checks; every new route joins the two-tenant isolation inventory and every new policy gets pgTAP negatives.
- Module packages ship no language: every label comes from the host's pt-BR catalog; `scripts/check-ui-literals.sh` enforces it.
- Expand-only migrations applied before the API; hand-written SQL for definers and constraints.

### Integration Points
- **Início's merged feed (D-73)** includes community posts through `NOT_LOCKED`; it must exclude posts of member-created communities (D-702), or a member's community post would leak into the organization's voice.
- **`createPost`**: the `member_no_community` refusal becomes the owner rule; the post's stamped audience for a member-community post is the community's, not `followers`.
- **The Comunidades list ordering** (`position asc, last_activity_at desc`): member communities sort after every organization community (D-712).
- **`deleteStory` and the community writes**: gain the member-owner predicate and the moderation log row for admin actions on member content (D-711).
- **Explorar** (`apps/web/app/(app)/inicio/ExplorarBody.tsx`): gains the story row with the member's own "+" circle and, for a moderator, every member's circle.
- **The platform panel's `social` form**: gains the per-member community limit.
- **NATIVE-33's filter** (`packages/core/server/safety/blocks.ts`): extend to member stories and communities.
- **Phase 13 is paused at plan 14**: its web-side plans (the report and block screens, plan 13-20) were moved into Phase 11; Phase 10 must not touch the native shell.

</code_context>

<specifics>
## Specific Ideas

- The organization's voice stays where it is: Início, its grouped circle and its communities are untouched; a member's content lives in Explorar and in the member's own community pages (D-702, D-704).
- "A community is the open space the creator chose to open": that is why a member community is visible to everyone while a member post stays followers-only (D-701). Saving a story in a highlight is the same act (D-716), and the screen says so.
- The member's story circle is the first in the row with a "+", like Instagram (D-714), and no avatar in the app gains a ring (D-704).
- Phase 10 can ship and be tested alone: the admin's removal path exists with its log (D-711), so the module can be left off until Phase 11 closes and Igor decides when to turn it on for the first tenant.

</specifics>

<deferred>
## Deferred Ideas

- **Follower notices for member stories and communities** ("Fulano published a story", "new community"), "started following you", direct messages and the block's effects on messaging: Phase 11.
- **A story ring on the profile, `/membros` rows, post headers or any avatar:** declined for now (D-704).
- **A "De membros" section in the Comunidades list:** declined in favour of one list ordered by D-712; revisit if the list grows.
- **Transferring a community to another owner** when the creator is blocked or leaves: declined (D-708).
- **Private or opt-in communities** using `community_members`, and member communities with store products: V2.
- **PDF attachments from members, anywhere:** admin only (D-473, D-709).
- **A separate limits block for member stories in the platform panel:** declined, stories reuse the post limits (D-715).
- **Showing member-community posts in Explorar for followers of the creator:** declined (D-702); revisit with the Phase 11 notice rules.
- **Requirement and roadmap rewording at planning:** roadmap criterion 3 (D-706, any admin for organization communities), MODER-04 (stories and communities delivered here, "block author" stays in Phase 11), Phase 11's criterion 4 and Executar list (the removal and log of member stories and communities move to Phase 10), and the new requirement ids for this phase.

</deferred>

---

*Phase: 10-rede-social-member-stories-and-communities*
*Context gathered: 2026-11-10*
