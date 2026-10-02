# Phase 8: Moderation, Tenant Admin Panel & Pilot Hardening - Context

**Gathered:** 2026-10-01
**Status:** Ready for planning

<domain>
## Phase Boundary

`admin_tenant` runs their community from a phone, inside the same app:
- removes any comment or reply (MODER-01);
- blocks and unblocks members (MODER-02);
- reads an append-only moderation log (MODER-03);
- edits branding with a live preview (ADMIN-01);
- lists and searches members and changes their roles (ADMIN-02);
- edits the community rules (ADMIN-03);
- uses every creation flow from a phone (ADMIN-04).

Every module also ships a README with its public interface, and an automated test proves that one module can be reused (MOD-05).

The phase closes with the pilot go-live gate:
- the full two-tenant isolation suite across endpoints, storage and Realtime topics;
- a pt-BR catalog audit with zero UI literals;
- a real-device PWA and push pass on iPhone and Android;
- the security hardening chosen below.

Out of scope:
- moderating member posts, stories and communities (MODER-04) and the reports queue (MODER-05), which belong to Phase 11;
- multi-membership identity, which belongs to 08.1, the next phase.

</domain>

<decisions>
## Implementation Decisions

Decision numbers start at D-330. Phase 7 used D-220..D-240 and 08.1 used D-301..D-319, because 08.1 was planned before this phase.

### Carried forward (locked before this discussion — do not re-open)
- **Block enforcement exists.**
  - `memberships.status='blocked'` plus `blocked_at` is checked on every request, and the member's next request gets the "acesso suspenso" screen (Phase 1, 01-05).
  - Phase 7 has blocking drop Realtime access through RLS, delete push subscriptions and exclude the member from fan-out.
  - Phase 8 builds the **admin action** that sets and clears the block, plus the log. It does not rebuild enforcement.
- **Blocks are per membership.** This is D-304 in 08.1. Write the block action against the membership row, never the identity, so 08.1 needs no rework.
- **Comment soft delete.**
  - `deleted_at` is deliberately outside the RLS policies (`packages/modules/feed/db/schema.ts:29,310`), so moderation can see removed rows through the tenant lane.
  - `comment.deleted` and `story.comment_deleted` already retract the related notifications.
  - Today `canDelete` is author-only (`packages/modules/feed/server/service.ts:1250`).
- **Rules on the tenant.** `tenants.rules_text` and `rules_version` hold them, and consent records point at a rules version (Phase 2, D-03).
- **Branding components.** The kernel `BrandPreview` (`packages/core/ui/BrandPreview.tsx`) is meant to be reused by Phase 8 unchanged (STATE, 02-14). The platform `BrandingForm` and `ContrastFeedback` already implement the super_admin editor.
- **Authorization** goes through `requirePermission(...)` and `defaultRolePermissions` (`packages/core/server/rbac/`).
- **No string literals in the UI.** Every string lives in the pt-BR catalog (PWA-03).

### Blocking & roles
- **D-330: Blocking does not touch content.**
  - A blocked member's existing comments stay visible.
  - The admin removes specific comments one by one through MODER-01 if they want to.
  - Unblocking restores access exactly as it was.
  - No mass delete and no hide-while-blocked.
- **D-331: The block reason is optional and internal.**
  - The block (and unblock) sheet has an optional reason field.
  - The reason is written only to the moderation log.
  - The blocked person sees only the existing generic "acesso suspenso" screen, never the reason.
- **D-332: An admin can act on anyone except themselves and the last active admin.**
  - `admin_tenant` can block, unblock or change the role (`member` / `support_tenant` / `admin_tenant`) of any membership in the tenant, other admins included.
  - Two guards are enforced in the API, not just hidden in the UI:
    - an admin can never block or demote **themselves**;
    - the tenant can never be left without at least one **active** `admin_tenant`.
  - The `super_admin` remains the escape hatch.
  - Role changes take effect on the member's next request. Membership is resolved per request, so nothing waits for token refresh.
- **D-333: Staff keep a read-only view of a blocked member's support thread.**
  - The thread stays in the staff inbox with a "Membro bloqueado" label, and the composer is disabled.
  - After unblock, the thread becomes writable again.
  - This settles the open item from Phase 7's Claude's Discretion.

### Comment removal & moderation log
- **D-334: A removed comment disappears with its replies.**
  - It looks exactly like an author deleting their own comment: no tombstone, replies cascade and counts drop.
  - The row is soft-deleted with a new `deleted_by` (the acting membership/user).
  - The related notifications are retracted through the existing events.
- **D-335: Removal is silent.**
  - The author gets no notification, which follows the V1 silence rule (D-214).
  - There is no new notification kind.
- **D-336: Every comment surface is in scope.**
  - Feed posts, community posts, reels (which are feed posts), and the flat story comments in the stories module.
  - Each owning module exposes its own admin-delete path. The moderation module never reaches into another module's tables (MOD-02).
- **D-337: The log is a chronological list with a snapshot of the removed text.**
  - Each row shows the action, actor, target member, timestamp and optional reason.
  - A comment-removal row also stores an **excerpt of the removed text, captured at deletion time**, so the admin can see what was removed.
  - The screen has a filter by action type and infinite scroll, using the shared keyset envelope and `InfiniteScroll`.
  - The log is append-only: no update or delete through any lane.
  - **Reversibility:** costly. Append-only is enforced in DB policy and grants, and the log is the audit record.
- **D-338: Moderation belongs to `admin_tenant` only.**
  - It is guarded by a new permission (for example `moderation.manage`) that `defaultRolePermissions` grants to `admin_tenant`.
  - `support_tenant` cannot remove comments, block or read the log.
  - Because it is a permission rather than a role check, it can be granted to support later without code changes.

### Admin panel on mobile
- **D-339: The panel grows out of Configurações → Administração.**
  - Add rows to the existing admin group (`apps/web/app/(app)/configuracoes/page.tsx:165`): **Marca**, **Membros**, **Regras da comunidade** and **Moderação** (the log), beside Mídia and Stories.
  - Each row opens a full screen.
  - There is no separate /admin hub and no BottomNav tab.
  - Members never see the group, which keeps the existing absent-from-DOM rule.
- **D-340: Actions are reachable both in context and from the panel.**
  - The comment "⋯" menu shows "Remover" to holders of the moderation permission on **any** comment, not only their own.
  - The member profile (`/membros/[membershipId]`) gets an admin action sheet: change role, block and unblock.
  - The **Membros** admin screen lists every membership, with search and a status filter (ativos / bloqueados / convidados).
    - It includes blocked members, which the public directory and profile pages hide today.
    - It is the only place where a blocked member can be found and unblocked.
- **D-341: Saving the rules bumps `rules_version` and applies to new sign-ups only.**
  - New sign-ups and joins consent to the new version.
  - Existing members' consent rows keep pointing at the version they accepted.
  - There is no "as regras mudaram" re-acceptance wall.
  - **Reversibility:** reversible. A re-acceptance gate can be added later because consents are already versioned.
- **D-342: The branding editor is the platform one, reused.**
  - The same `BrandingForm`, `ContrastFeedback` and `BrandPreview` run on a tenant-lane route, behind an admin permission.
  - It has the same fields: logo, primary and secondary colors, favicon and display name.
  - It has the same derived-asset pipeline (icons, favicon, manifest) and the same `updateTag` cache invalidation.
  - Whichever save comes last wins between super_admin and admin_tenant.
- **D-343: UI-SPEC only, with no sketch gate.**
  - The admin screens are built from existing primitives: settings rows, list rows, action sheets and the platform branding form.
  - A UI-SPEC records copy, states and layouts. There is no `/gsd-sketch` approval checkpoint, which mirrors 08.1's D-319.

### Go-live gate & hardening
- **D-344: The gate is split.**
  - Phase 8 runs the full go-live gate and closes:
    - the isolation suite across every endpoint, storage URL and Realtime topic;
    - the i18n audit;
    - the real-device PWA and push pass;
    - the MOD-05 reuse proof.
  - 08.1's exit gate then re-runs the isolation suite plus its shared-identity fixture and a short real-device smoke. **That is where the MVP is declared closed.**
  - The planner reconciles the ROADMAP wording of Phase 8 SC 4 and 08.1.
- **D-345: The real-device pass runs on production with a dedicated QA tenant.**
  - Create a `qa` tenant on production, separate from the real tenants (socializando, igor-alves-teste, reine).
  - The developer runs **one consolidated checklist** on an iPhone and an Android phone. It covers:
    - this phase's admin flows: creation flows, branding, members, moderation and rules;
    - PWA install and push;
    - every real-device row deferred from earlier phases: Phase 2, 4, 05.2, 05.3 (WINDOWS #48-#51, REELS-06), and Phase 7 UAT rows 1-17 plus the blocked-member-with-an-open-socket check.
  - Rows that cannot be run stay `blocked`, never recorded as passed.
  - The qa tenant is created with the existing provisioning tooling.
- **D-346: Only the security hardening is in scope.**
  - Lock CORS to the production origins.
  - Ship a real Content Security Policy. This unblocks inline YouTube and Vimeo embeds, which Phase 4 deferred until a CSP existed.
  - Close Phase 2's review items IN-01..IN-07 (`.planning/phases/02-tenant-shell-branding-platform-panel/02-REVIEW.md`).
    - IN-01 and IN-02 touch the invite identity checks that 08.1's D-314 rewrites. Fix them in a way that 08.1 can keep, or record them as superseded by 08.1, with a reason.
  - Sentry and log fields, EXPLAIN on a 10k-row seed, Cloud Run config in git, the backup and rollback rehearsal, and the a11y pass are **out** (see Deferred).
- **D-347: MOD-05 proof.**
  - Every module package (chat, communities, events, feed, notifications, reels, stories, and the new moderation module) gets a `README.md` with:
    - contracts;
    - emitted and consumed events;
    - flag key;
    - kernel dependencies;
    - navigation entries.
  - An **automated, CI-runnable reuse fixture** (for example `packages/reuse-fixture`) mounts one module on a minimal app that provides only the kernel contracts. It proves the module builds, mounts and serves without the other modules.
- **D-348: Inherited test debt blocks the gate.**
  - One hardening plan triages each item as a flake or a real bug, then fixes it or quarantines it with a written reason:
    - WINDOWS #64 (feed double-tap like on desktop), #65 (the `next typegen` / build race in turbo), #69 (phase52-smoke on mobile), #70 (stories Escape on mobile) and #71 (phase2-smoke Marca on desktop);
    - the never-run `e2e:pwa`.
  - The same plan brings the CI `checks` job under its 60-minute timeout.
  - The gate requires one green `pnpm verify` and one CI run that finishes.
- **D-349: The LGPD legal review is a sign-off row, not code.**
  - The gate report carries an "LGPD legal review" row that the developer marks done, or accepted as a risk, with a date.
  - Phase 8 builds nothing for it. Data export and deletion stay in V2-PROF-02.

### Claude's Discretion
- **Moderation module shape.**
  - Does moderation live in a new `packages/modules/moderation` package (log table, log routes, Membros admin screen), or does the log live in the kernel? It must satisfy MOD-02.
  - How do the feed and stories modules call it to append a log row in the same transaction: through a published contract or a domain event plus a synchronous writer?
  - Atomicity matters: a removal without its log row must be impossible.
- **Should role changes also go in the log?** MODER-03 lists only delete, block and unblock. Logging `role_changed` as well is recommended, because it is cheap and useful. The planner decides and records the choice.
- **Confirm dialogs and undo.** A confirmation sheet before remove and block is expected, but there is no undo for a comment removal. An admin "restore" is not in scope.
- **Who sees what in the Membros admin list.** Invited (pending) memberships are shown. Whether resending or cancelling an invite moves here from the platform panel is the planner's call, as long as it adds no new capability.
- **The rules editor format.** Plain text with preserved line breaks, matching how `/cadastro` renders it today, unless the existing renderer already supports more.
- **Desktop layout of the admin screens.** The rail layout uses a content column, following the settings pattern.
- **Isolation suite breadth.** Build an inventory of every route, every storage bucket and path, and every Realtime topic. Every entry gets a cross-tenant negative test. Fail the gate when a route has no isolation test, for example a route-inventory assertion.
- **i18n audit method.** A scripted check for UI string literals (for example Biome or a grep rule over `.tsx` JSX text and string props) that runs in CI.
- **The `qa` tenant's lifecycle.** Whether it stays on production after the gate, or is disabled.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` §"Phase 8" — goal, the 4 success criteria, and the hardening Notes. The Notes items not chosen in D-346 are deferred.
- `.planning/ROADMAP.md` §"Phase 08.1" — the next phase. Its gate placement is reconciled by D-344.
- `.planning/REQUIREMENTS.md` — MODER-01..03, ADMIN-01..04, MOD-05. MODER-04/05 are Phase 11 and out of scope.
- `.planning/PROJECT.md` — the core value (zero leakage) and the constraints.

### Prior decisions that bind this phase
- `.planning/phases/07-notifications-web-push-chat/07-CONTEXT.md` — the blocked-member Realtime and push behaviour, D-223 (admin answers support), D-225 (shared staff thread) and D-214 silence.
- `.planning/phases/08.1-multi-tenant-identity/08.1-CONTEXT.md` — D-304 (blocks per tenant and membership), D-307 (host-selected membership), D-314 (invite rewrite, relevant to IN-01/IN-02), and "Go-live gate placement".
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-CONTEXT.md` — D-03 (rules on the tenant, versioned consents) and the branding pipeline.
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-UI-SPEC.md` — the settings row and shell contracts, and the branding editor UI the admin screens reuse.
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-REVIEW.md` §IN-01..IN-07 — the hardening items for D-346.
- `.planning/research/PROTOTYPE.md` — the port rules. The admin screens have no prototype (D-343).
- `packages/core/docs/SCHEMA-CONVENTIONS.md` — the conventions for the new log table (tenant_id, RLS, append-only).

### Gate inputs
- `.planning/WINDOWS.md` — rows #64, #65, #69, #70 and #71 (D-348), plus the deferred real-device rows (#48-#51 and others).
- `.planning/phases/07-notifications-web-push-chat/07-UAT.md` — real-device rows 1-17 and the blocked-socket check that move into D-345's checklist.
- `.planning/phases/07-notifications-web-push-chat/deferred-items.md` — details of the inherited e2e reds.
- `docs/phase-07-device-test-plan.md` — the existing real-device test plan to fold into the consolidated checklist.
- `docs/DEPLOY.md` — the production deploy path. Production is live, migrations go through `supabase db push`, and the deploy is by hand while CI `checks` times out.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/ui/BrandPreview.tsx`, `apps/web/components/platform/BrandingForm.tsx` and `apps/web/components/platform/ContrastFeedback.tsx` make up the branding editor. Reuse them as-is (D-342).
- `apps/web/app/(platform)/plataforma/tenants/[id]/marca/{page,actions}.tsx` is the super_admin branding route and the template for the tenant-lane version.
- `apps/web/app/(app)/configuracoes/page.tsx` already has the admin group (`isTenantAdmin`), with `Row` and `Group` primitives where the new rows go (D-339).
- `apps/web/app/(app)/membros/` (`MembersList`, `[membershipId]`, `actions.ts`) and `apps/api/src/routes/members.ts` are the directory and profile. The admin sheet and the admin list extend them (D-340).
- `packages/modules/feed/server/service.ts` (`deleteComment` around line 1596, `canDelete` at 1250) is the existing author delete, to extend with an admin path and `deleted_by` (D-334, D-336).
- `packages/core/server/paging.ts` and `InfiniteScroll` from `@rede-social/ui` are the keyset list used for the log and the Membros admin list.
- `packages/core/server/rbac/{permissions,require-role}.ts` hold `requirePermission` and `defaultRolePermissions`, where the new moderation, branding and members permissions go (D-338).
- `packages/core/server/events/bus.ts` is the in-process bus with flush-after-commit.

### Established Patterns
- Admin-only UI is **absent from the DOM** for other roles, and admin routes answer `notFound()` rather than 403 (settings page comment at line 117).
- `deleted_at is null` lives in the queries, never in RLS policies, so moderation reads removed rows through the tenant lane.
- Membership writes (role, status) are admin-lane only. The `memberships` policy comment forbids a broad `FOR ALL` policy, so add a narrow guarded path.
- Modules never import another module's internals (MOD-02, enforced by lint). Cross-module effects go through contracts and events.
- Copy comes from the pt-BR catalog. Notification text is rendered from `kind` plus a payload.

### Integration Points
- The block and role actions write `memberships` (status, blocked_at, role). The auth middleware's per-request `blocked_at` check and Phase 7's Realtime RLS and push cleanup handle the rest.
- The chat staff inbox and thread (`apps/web/app/(app)/suporte/`, `packages/modules/chat/`) render the blocked label and the read-only composer (D-333).
- The rules save bumps `rules_version`. `/cadastro` and the join flow read the current version, and `consent_records` reference it.
- Branding saves go through the existing derived-asset pipeline and the per-tenant manifest route `app/m/[tenantSlug]/manifest.webmanifest`.

</code_context>

<specifics>
## Specific Ideas

- The admin removes comments through the same "⋯" menu an author uses today ("Remover"). Admins should feel no new place to learn.
- The Membros admin list's status filter (ativos / bloqueados / convidados) is the only way back to a blocked member.
- The real-device checklist is one document covering everything deferred since Phase 2, run once on production by the developer with a phone in each hand.
- Production is live (Vercel `rede-social-woad.vercel.app`, Cloud Run sa-east, 3 tenants). Every Phase 8 migration must be safe to apply before the new API is deployed (expand, then contract).

</specifics>

<deferred>
## Deferred Ideas

- **Observability:** Sentry on web, API and worker, plus `tenant_id`/`request_id` on every log line. Not chosen for Phase 8 (D-346), so it is a post-pilot hardening backlog item.
- **Performance:** EXPLAIN on feed, notification and chat queries with a 10k-row seed. Post-pilot backlog.
- **Ops:** Cloud Run config in git (`min-instances=1`, CPU boost, timeouts), the backup and rollback rehearsal, and the a11y pass. Post-pilot backlog.
- **Rules re-acceptance wall:** members must accept new rules on next open. Rejected for now (D-341); consents are already versioned, so it can be added later.
- **Notifying the author when a comment is removed.** Rejected (D-335).
- **Hiding or mass-deleting a blocked member's content.** Rejected (D-330).
- **Support staff moderating.** Not granted by default (D-338); it is a permission grant away.
- **An admin "restore" for removed comments.** Not in scope.
- **MODER-04 and MODER-05** (member content moderation, the reports queue). Already in Phase 11.
- **Data export and deletion (LGPD Art. 18).** Already V2-PROF-02.

</deferred>

---

*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Context gathered: 2026-10-01*
