# Phase 8: Moderation, Tenant Admin Panel & Pilot Hardening - Research

**Researched:** 2026-10-01
**Domain:** Tenant-admin moderation (comment removal, member block/role), an append-only audit log, reuse of the platform branding editor on the tenant lane, the go-live gate (route/storage/topic isolation inventory, i18n literal audit, MOD-05 reuse proof), Content Security Policy under Next.js 16 `proxy.ts`
**Confidence:** HIGH for the codebase findings (read this session); MEDIUM for the CSP and third-party directives (official docs, not yet run in this app)

## Summary

This phase is mostly thin admin screens over columns and services that already exist. The research found four places where the existing code does **not** match what CONTEXT.md assumes, and the plan must close them:

1. **Replies do not cascade today.** `deleteComment` updates one row. When a root comment is deleted, its replies stay live and keep counting in `feed_posts.comment_count`. D-334 ("replies cascade and counts drop") needs new code on both the author path and the admin path, and a `comment.deleted` event for each cascaded reply. Without those events, the "X respondeu" notifications are not retracted.
2. **There is no `updateTag` / `'use cache'` anywhere in `apps/web`.** D-342's "same `updateTag` cache invalidation" does not exist. The platform branding pipeline uses three things: `revalidatePath` in the server action, `invalidateAllTenantHosts` in the API, and the 60 s web host-cache TTL. The authenticated shell reads branding from the per-request bootstrap, so the admin sees changes at once. The public login shell can stay stale for up to 60 s.
3. **D-333 (read-only staff view of a blocked member's thread) is already built.** Phase 7 shipped it in 07-10: the `InboxRow` blocked pill, the `ThreadPane` `readOnlyNotice`, and the 409 `member_blocked` refusal. Phase 8 only adds a test that runs through the new admin block action.
4. **The browser never calls the Cloud Run API.** `API_URL` is server-only (`apps/web/lib/api.ts`), and the API has no CORS middleware. "Lock CORS" therefore becomes a guard test plus documentation, not a new allow-list.

**Moderation belongs in the kernel, not a new module package.** `packages/core/docs/SCHEMA-CONVENTIONS.md` §(f).2 already lists moderation as a kernel capability that is always on and has no flag. `defineModule` also refuses any key outside `TOGGLEABLE_MODULES`. The log table, the append helper, the member-admin services and the log read route therefore live in `@rede-social/core`. Feed and stories call a kernel function inside their own `withTenantTx`, which makes the removal and its log row atomic without breaking MOD-02.

The domain-event bus is **not** an option for the log write. It flushes only after commit and swallows handler errors, so a removal without its log row would be possible. Membership writes stay in the admin lane, following the `accept-invite.ts` precedent, inside `packages/core/server/tenancy/`.

**Primary recommendation:**
- Put a kernel `moderation_log` table behind an insert-only policy, revoked UPDATE/DELETE/TRUNCATE grants, and a raising trigger.
- Give it one writer, `recordModerationAction(tx, …)`, called inside the same transaction as the action.
- Widen the two existing comment-delete routes, as Phases 4 and 5 planned.
- Add `/v1/admin/*` kernel routes for members, branding, rules and the log.
- Enforce the gate with machine checks: an `app.routes` inventory assertion, Biome `style/noJsxLiterals`, a README-vs-manifest check and a `packages/reuse-fixture` app.

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

Decision numbers start at D-330. Phase 7 used D-220..D-240 and 08.1 used D-301..D-319, because 08.1 was planned before this phase.

#### Carried forward (locked before this discussion — do not re-open)
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

#### Blocking & roles
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

#### Comment removal & moderation log
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

#### Admin panel on mobile
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

#### Go-live gate & hardening
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

### Deferred Ideas (OUT OF SCOPE)
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
</user_constraints>

**Two CONTEXT statements the planner must correct, with evidence:**
- D-342 "the same `updateTag` cache invalidation". There is no `updateTag`, `revalidateTag`, `cacheTag` or `'use cache'` in `apps/web` source. A grep this session found matches only in generated `.next/types/cache-life.d.ts`. The real invalidation is `revalidatePath(..., 'layout')` in the platform action plus `invalidateAllTenantHosts(tenantId)` in the API (`packages/core/server/platform/branding.ts:93`). The tenant-lane version must reuse exactly those. [VERIFIED: grep apps/web + read of `apps/web/app/(platform)/plataforma/tenants/[id]/marca/actions.ts`]
- D-347 "the new moderation module". This research recommends a kernel capability instead (see Architecture). The README then lives at `packages/core/server/moderation/README.md`. The planner records the choice under Claude's Discretion "Moderation module shape".

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MODER-01 | `admin_tenant` can delete any comment or reply in their tenant (soft-delete with `deleted_by`) | Widen `DELETE /v1/feed/comments/{id}` and `DELETE /v1/stories/{id}/comments/{id}` with a `moderation.manage` branch. Add a `deleted_by_user_id` column (SCHEMA-CONVENTIONS §(d).2 naming), the reply cascade (Pitfall 1), and the log row in the same tx (Pattern 1). |
| MODER-02 | Block a member: session revoked immediately, no login to the tenant, no re-register with same e-mail | Kernel `blockMember` sets `status='blocked'` + `blocked_at` (Pitfall 3). `requireAuth` already refuses on the next request. Sign-up already answers 409 `EMAIL_ALREADY_REGISTERED` for an existing e-mail. Open-socket residue is bounded by JWT expiry (Pitfall 6). Push subscriptions get an eager cleanup through a domain event. |
| MODER-03 | Append-only moderation log with actor, target, timestamp, optional reason, viewable by admin | Kernel `moderation_log` (Pattern 2) with insert-only RLS, revoked UPDATE/DELETE/TRUNCATE, a raising trigger and pgTAP proof. `GET /v1/admin/moderation-log` uses keyset paging (`packages/core/server/paging.ts`). |
| ADMIN-01 | Edit branding with live preview and contrast validation | Tenant-lane routes wrap the existing `packages/core/server/platform/branding.ts` services with `tenantId = ctx.tenantId`. Reuse `BrandingForm`/`BrandPreview` with tenant-lane server actions. Display name via `updateTenant` (Pattern 5). |
| ADMIN-02 | List and search members, change role, block/unblock | `GET /v1/admin/members?q&status&cursor`. A new kernel query (all statuses, all roles) next to `listMembers`. Role and block writes in `packages/core/server/tenancy/member-admin.ts` with the D-332 guards under row locks (Pattern 4). |
| ADMIN-03 | Edit community rules shown at sign-up | `PUT /v1/admin/rules` bumps `rules_version` only when the text changed (D-341). `/cadastro` and `/aceitar-convite` already read `rulesText`/`rulesVersion` through `getPublicTenant`. |
| ADMIN-04 | All admin creation flows usable from a phone | Existing flows. Verified by mobile-viewport e2e plus the D-345 real-device checklist. |
| MOD-05 | Module reusable by copying its package + kernel contracts, documented in README | A per-module README checked against the manifest (Pattern 8). A `packages/reuse-fixture` app tagged `app`, depending on core + contracts + `module-events` only (Pattern 9). |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Next.js App Router frontend on Vercel. Node/TypeScript API (Hono) on Cloud Run. **All business logic goes through the API.** There are two allowed browser-to-Supabase exceptions: Auth via `@supabase/ssr` in the Next server, and read-only Realtime Broadcast.
- **Modularity (MOD-01..05):** modules depend only on the kernel and on other modules' published contracts. This is enforced by `turbo boundaries`, Biome `noRestrictedImports` and the package `exports` maps.
- UI follows the prototype. The admin screens have no prototype, so they go through UI-SPEC only (D-343).
- **Supabase Free plan** for the pilot: Realtime quotas, a 50 MB file cap, no image transforms.
- **Multi-tenant RLS / defense in depth** on every table. `withAdminTx` is kernel-only (`packages/core/server/{tenancy,platform,media}` + `scripts/`).
- Schema must anticipate V2 without rewrites: blocks per membership, permissions not role checks.
- **pt-BR UI with zero literals** (PWA-03): everything comes from `apps/web/messages/pt-BR/*.json`.
- Biome is the linter (TS 7 has no JS compiler API, so no typescript-eslint). Vitest 5, Playwright 1.63 and pgTAP via `supabase test db`.
- Migrations: drizzle-kit `generate` writes to `supabase/migrations`, and the Supabase CLI applies them. **Never `drizzle-kit migrate`/`push`.** Hand-written SQL goes in `--custom` migrations.
- **Production is live (3 tenants).** Every migration must be expand-safe before the API deploy. The user runs `supabase db push` (auto mode blocks Claude from applying prod migrations).
- Commits carry **no `Co-Authored-By: Claude` trailer** (public repo rule, user memory).
- GSD workflow entry points before edits. Execution is sequential (no parallel phase worktrees, one local Supabase stack).
- Gates run with `TURBO_CACHE=local:r`, because `.turbo/cache` fills the disk. The disk was at 94% (12 GiB free) during this research.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Permission composition (`moderation.manage`, `members.manage`, `tenant.manage`) | API (kernel RBAC + app registry) | Web (reads `bootstrap.permissions` to render rows) | Single composition point (`permissionsFor`), so UI visibility can never disagree with the guard |
| Comment removal + reply cascade + log row | API (owning module service, tenant lane) | DB (count trigger, append-only log) | MOD-02: feed/stories own `feed_comments`; the kernel owns the log; one `withTenantTx` |
| Block / unblock / role change + guards | API (kernel `tenancy/member-admin.ts`, admin lane) | DB (row locks, CHECKs) | Membership writes are admin-lane only (memberships policy comment, WR-07) |
| Append-only enforcement | Database | — | Grants + RLS + trigger; app code cannot be the only guard of an audit record |
| Moderation log read | API (kernel route, tenant lane) | Web (InfiniteScroll screen) | Keyset envelope is kernel (`paging.ts`) |
| Branding edit | API (existing kernel `platform/branding.ts` services) | Worker (icon derivation job), Web (BrandingForm) | Services already take `tenantId` + actor; the lane only changes where `tenantId` comes from |
| Rules edit + version bump | API (kernel, admin lane on `tenants`) | Web (`/cadastro` reads it) | `tenants` has only `tenants_self_select` for the tenant lane |
| CSP + nonce | Frontend server (`apps/web/proxy.ts`) | Browser (enforcement) | Next.js extracts the nonce from the request CSP during SSR |
| CORS | API (no `cors()` middleware: server-to-server BFF only) | — | Browser never calls `API_URL` directly |
| Isolation inventory | API test tier (`app.routes`) | DB (pgTAP), Realtime (`realtime.test.ts`) | The route table is the source of truth for "every endpoint" |
| i18n audit | Tooling (Biome + `scripts/check-ui-literals.sh`) | CI | Runs in `pnpm lint` |
| Reuse proof | Tooling (`packages/reuse-fixture`, tag `app`) | CI | `turbo boundaries` validates its dependency set |

## Standard Stack

No new external packages are needed. Everything below is already installed and pinned.

### Core (already in the repo)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono / @hono/zod-openapi | 4.13.7 / 1.6.3 | New `/v1/admin/*` routes; `app.routes` inventory | Existing API framework; `app.routes` enumerates every mounted method+path [VERIFIED: probe this session, 106 non-`ALL` entries] |
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 | `moderation_log` schema + policies, `deleted_by_user_id` column | Schema-as-source-of-truth convention (SCHEMA-CONVENTIONS §(h)) |
| @biomejs/biome | 2.5.13 | `style/noJsxLiterals` for the i18n audit | Built-in rule since v2.2.4 [CITED: biomejs.dev/linter/rules/no-jsx-literals]; probe run this session |
| next | 16.3.4 | `proxy.ts` nonce CSP | Official nonce pattern [CITED: nextjs.org/docs/app/guides/content-security-policy] |
| vitest / @playwright/test / pgTAP | 5.0.0 / 1.63.0 / CLI 2.117.0 | Unit, e2e, DB tests | Existing gate |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next-intl | 4.14.4 | Optional compile-time key checking via `AppConfig.Messages` | Only if the planner wants key-existence checks at `tsc` time (see i18n pattern) [CITED: next-intl.dev/docs/workflows/typescript] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Kernel moderation capability | `packages/modules/moderation` | Would need a new `TOGGLEABLE_MODULES` key, a `tenant_modules_key_chk` widening and a flag. Turning it off would break comment-removal atomicity. It also contradicts SCHEMA-CONVENTIONS §(f).2. |
| Nonce CSP in `proxy.ts` | Static CSP with `'unsafe-inline'` in `next.config.ts` `headers()` | Weaker (inline script allowed). Only justified if nonce rendering breaks something. Every app route is already dynamic (`check-static-routes.sh`), so the nonce path costs nothing extra. |
| Nonce CSP | `experimental.sri` hash-based CSP | Experimental. It exists to keep static pages, and this app has none to keep. |
| Biome `noJsxLiterals` | Hand-rolled AST checker | TS 7 has no JS compiler API. A Babel/oxc parser would be a new dependency. |
| Hand-rolled YouTube/Vimeo click-to-play | `lite-youtube-embed` | New dependency for a 30-line swap-to-iframe. Hand-rolling is fine here because there is no complex edge case. |

**Installation:** none.

**Version verification:** no new package. Installed versions were confirmed this session: biome `2.5.13` (`biome --version`), node `v24.14.0`, pnpm `12.4.1`, Playwright `1.63.0`, Supabase CLI repo-pinned `2.117.0` (brew `2.118.0`).

## Package Legitimacy Audit

This phase installs **no external packages**. Every capability uses dependencies already in `pnpm-lock.yaml` (Hono, Drizzle, Biome, next-intl, Vitest, Playwright).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| — | — | — | — | — | — | No installs planned |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

If a plan later adds a dependency (for example `lite-youtube-embed`), it must run `gsd-tools query package-legitimacy check` and add a `checkpoint:human-verify` first.

## Architecture Patterns

### System Architecture Diagram

```
 Phone/desktop browser (tenant host)
   │  HTML nav                        │ server action / BFF route
   ▼                                  ▼
 proxy.ts ── host→shell, session refresh, NEW: nonce + CSP header (request + response)
   │
 Next server (RSC pages under (app)/configuracoes/{marca,membros,regras,moderacao},
   │          /membros/[id] admin sheet, comment "⋯ Remover")
   │  apiFetch(API_URL, Bearer + x-tenant-host)       [no browser→API: no CORS surface]
   ▼
 Hono API ─ requireAuth (membership per request) ─ requirePermission(...)
   ├─ /v1/feed/comments/:id  DELETE ──► feed service ─┐
   ├─ /v1/stories/:s/comments/:c DELETE ► stories svc ─┤ withTenantTx (ONE tx):
   │                                                   │  lock comment → soft-delete root (+ replies)
   │                                                   │  → recordModerationAction(tx) [kernel] → commit
   │                                                   └─► after commit: emit comment.deleted ×N
   │                                                        └► notifications retraction (worker/sink)
   ├─ /v1/admin/members (GET list/search/status)  ─► kernel tenant-lane read
   ├─ /v1/admin/members/:id/{block,unblock,role} ─► kernel tenancy/member-admin.ts
   │        withAdminTx: lock admins + target → guards (self / last admin) → update memberships
   │        → insert moderation_log → commit → emit membership.blocked → push cleanup (best effort)
   ├─ /v1/admin/moderation-log (GET keyset) ─► kernel tenant-lane read (RLS select)
   ├─ /v1/admin/branding/*, PATCH /v1/admin/tenant ─► existing platform/branding.ts + updateTenant
   │        (tenantId = ctx.tenantId) → invalidateAllTenantHosts → worker derives icons
   └─ PUT /v1/admin/rules ─► admin lane: rules_text, rules_version+1 (only if changed)
   ▼
 Postgres (RLS): moderation_log [select + insert policy only; UPDATE/DELETE/TRUNCATE revoked + trigger]
                 feed_comments.deleted_by_user_id; memberships (status, blocked_at, role)
   ▲
 Realtime (private topics, RLS cached per connection until JWT refresh/expiry)
```

### Recommended Project Structure
```
packages/core/
├── db/schema/moderation-log.ts            # kernel table + policies (re-exported from schema/index.ts)
├── server/moderation/
│   ├── log.ts                             # recordModerationAction(tx, ctx, entry) — the ONE writer
│   ├── read.ts                            # listModerationLog(ctx, query) — keyset, tenant lane
│   └── README.md                          # MOD-05 doc for the kernel capability (D-347)
├── server/tenancy/member-admin.ts         # block/unblock/setRole (admin lane, guards, log)
└── server/tenancy/admin-members.ts        # listMembersForAdmin (tenant lane, all statuses)
packages/contracts/src/moderation.ts       # subpath export: action enum, schemas, admin member list
apps/api/src/routes/admin/{index,members,moderation,branding,tenant}.ts   # /v1/admin/*
apps/web/app/(app)/configuracoes/{marca,membros,regras,moderacao}/page.tsx (+ actions.ts)
packages/reuse-fixture/                    # tag "app": core + contracts + module-events only
packages/modules/*/README.md               # one per module, checked by scripts/check-module-readmes
```

### Pattern 1: Atomic removal + log row (published kernel function, not an event)
**What:** The owning module's service does everything in one `withTenantTx`. It locks the comment, soft-deletes it (and its replies), resolves the author's membership, and calls the kernel's `recordModerationAction(tx, …)`. Events are emitted after the transaction resolves.
**Why not a domain event:** `flush` runs after commit and never rethrows. Its own docblock says: "A subscriber can never observe a row that a rollback then erased" and "a subscriber never breaks the request". A log written from a handler could therefore be lost while the removal stands. [VERIFIED: packages/core/server/events/bus.ts:6-16, read this session]
**MOD-02:** a module may import the kernel (`turbo.json` `"module": { "dependencies": { "allow": ["kernel", "contracts", "tooling"] } }`) [VERIFIED: turbo.json, read this session]. The kernel never imports the module.
**Permission read before the tx:** call `permissionsForRequest(ctx)` **before** `withTenantTx`. On a flags-cache miss it opens its own tenant transaction, and pool `max: 5` makes two held connections a starvation hazard. The stories `readPlaceGate` comment documents the same rule.
```typescript
// packages/modules/feed/server/service.ts (shape; names other than the kernel ones are illustrative)
export async function deleteComment(ctx: RequestContext, commentId: string, opts: { canModerate: boolean }) {
  const removed = await withTenantTx(ctx, async (tx) => {
    const [c] = await tx.execute<{ id: string; author_user_id: string; body: string; parent_id: string | null }>(sql`
      select id, author_user_id, body, parent_id from feed_comments
       where id = ${commentId}::uuid and post_id is not null and deleted_at is null
       for update`);
    const isAuthor = c?.author_user_id === ctx.userId;
    if (!c || (!isAuthor && !opts.canModerate)) throw new ApiError(404, 'NOT_FOUND'); // one bare 404 (T-04-16)
    const ids = await tx.execute<{ id: string }>(sql`
      update feed_comments set deleted_at = now(), deleted_by_user_id = ${ctx.userId}::uuid
       where (id = ${commentId}::uuid or parent_id = ${commentId}::uuid) and deleted_at is null
      returning id`);                                   // cascade: replies of a root (D-334)
    if (!isAuthor) {
      await recordModerationAction(tx, ctx, {            // kernel, same tx → atomic
        action: 'comment_removed', targetUserId: c.author_user_id,
        subject: { type: 'comment', id: commentId }, excerpt: c.body, reason: null,
      });
    }
    return ids.map((r) => r.id);
  });
  for (const id of removed) emit(ctx, 'comment.deleted', { tenantId: ctx.tenantId, commentId: id, actorUserId: ctx.userId });
}
```
`canDelete` in `toComment` (service.ts:1250, `canDelete: row.author_user_id === viewerUserId,`) and in stories (service.ts:783, same expression) becomes `author || canModerate`. The contract field stays the same. Only the value widens, so `CommentItem`'s `comment.canDelete && onDelete` keeps working. [VERIFIED: grep + read this session]

### Pattern 2: The append-only kernel table
**What:** follow the `consent_records` precedent: RLS on, a select-only policy for the lane, writes elsewhere. Add an insert policy for the tenant lane (comment removals run there) and three more locks: grants, a trigger and pgTAP.
```typescript
// packages/core/db/schema/moderation-log.ts (shape)
export const moderationLog = pgTable('moderation_log', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),   // no cascade (audit outlives)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  action: text().notNull(),                       // CHECK in ('comment_removed','member_blocked','member_unblocked','role_changed')
  actorUserId: uuid('actor_user_id').notNull(),   // NO FK: a user deletion must not cascade into/past the audit
  actorMembershipId: uuid('actor_membership_id'),
  targetUserId: uuid('target_user_id').notNull(),
  targetMembershipId: uuid('target_membership_id'),
  subjectType: text('subject_type'), subjectId: uuid('subject_id'),   // comment / story-comment id
  reason: text(),                                 // CHECK char_length <= 500 (value: planner/UI-SPEC)
  excerpt: text(),                                // CHECK char_length <= 280 (snapshot at deletion)
  details: jsonb(),                               // role_changed: { from, to }
}, (t) => [
  index('moderation_log_tenant_created_idx').on(t.tenantId, t.createdAt.desc(), t.id.desc()),
  index('moderation_log_tenant_action_created_idx').on(t.tenantId, t.action, t.createdAt.desc(), t.id.desc()),
  pgPolicy('moderation_log_tenant_select', { for: 'select', to: authenticatedRole, using: sql`tenant_id = app.tenant_id()` }),
  pgPolicy('moderation_log_tenant_insert', { for: 'insert', to: authenticatedRole,
    withCheck: sql`tenant_id = app.tenant_id() and actor_user_id = app.user_id()` }),
]).enableRLS();
```
Hand-written `--custom` migration in the same change:
```sql
revoke update, delete, truncate on public.moderation_log from anon, authenticated, service_role, api_user;
create or replace function app.moderation_log_immutable() returns trigger
  language plpgsql set search_path = '' as $$
begin raise exception 'moderation_log is append-only' using errcode = '42501'; end $$;
create trigger moderation_log_no_update_delete before update or delete on public.moderation_log
  for each row execute function app.moderation_log_immutable();
create trigger moderation_log_no_truncate before truncate on public.moderation_log
  for each statement execute function app.moderation_log_immutable();
```
- The trigger is what stops the **admin lane** (`service_role` bypasses RLS) and even the owner. The revoke stops the grants Supabase's default privileges hand out on new `public` tables. [ASSUMED: Supabase default privileges grant ALL on new public tables to anon/authenticated/service_role. Verify against the local stack with `\dp public.moderation_log` before relying on the revoke.]
- **No FK on actor/target user ids.** `users` rows cascade-delete memberships and consents when an auth user is deleted (`memberships.ts:26`, `onDelete: 'cascade'`). An FK with cascade would hit the immutability trigger and block account deletion (V2-PROF-02). An FK without cascade would block it too.
- **Tenant lane vs admin lane writes:** in the tenant lane the insert policy pins `tenant_id` and `actor_user_id` to the claims. In the admin lane (`member-admin.ts`) the helper writes `ctx.tenantId` / `ctx.userId` explicitly, and those come from `requireAuth`. Both go through the same TS function `recordModerationAction`. The pgTAP 040 file asserts the policy shape: one select, one insert, zero `w`/`d`/`*`.

### Pattern 3: Permissions
`KERNEL_ROLE_PERMISSIONS` today: `admin_tenant: ['tenant.manage', 'members.manage', 'content.publish'],` `support_tenant: [],` `member: [],` [VERIFIED: packages/core/server/rbac/require-role.ts:14-19]. None of the three is used by a route yet. They are asserted by `apps/api/tests/unit/registry.test.ts:222-224` and `apps/api/tests/integration/modules.test.ts:248-249`.

Recommended mapping:
- Add `'moderation.manage'` to `admin_tenant` (D-338). Kernel, not a module manifest, because moderation has no flag.
- Comment removal, block, unblock and log read require `moderation.manage`.
- Role change and the admin member list require `members.manage`.
- Branding, display name and rules require `tenant.manage`.
- The registry unit test's exact permission array must gain `'moderation.manage'`.
- Web gating changes from `role === 'admin_tenant'` to `bootstrap.permissions.includes(...)` for the new rows, following the `canManageStories` pattern in `configuracoes/page.tsx`. Pages keep answering `notFound()`, never 403.

### Pattern 4: Member admin with the D-332 guards (admin lane, row locks)
```typescript
// packages/core/server/tenancy/member-admin.ts (shape) — withAdminTx is allowed in tenancy/** (biome.json:36-38)
await withAdminTx(async (tx) => {
  // 1. Lock every ACTIVE admin of the tenant + the target, in one statement (stable order → no deadlock).
  const admins = await tx.execute<{ id: string; user_id: string }>(sql`
    select id, user_id from memberships
     where tenant_id = ${ctx.tenantId}::uuid and role = 'admin_tenant' and status = 'active'
       and blocked_at is null and deleted_at is null
     order by id for update`);
  const [target] = await tx.execute(sql`select id, user_id, role, status, blocked_at from memberships
     where id = ${membershipId}::uuid and tenant_id = ${ctx.tenantId}::uuid and deleted_at is null for update`);
  if (!target) throw new ApiError(404, 'NOT_FOUND');                    // other tenant = bare 404
  if (target.user_id === ctx.userId) throw new ApiError(409, 'CONFLICT', { member: 'self' });
  const removesAnActiveAdmin = admins.some((a) => a.id === target.id);  // block or demote
  if (removesAnActiveAdmin && admins.length <= 1) throw new ApiError(409, 'CONFLICT', { member: 'last_admin' });
  // 2. write: block → status='blocked', blocked_at=now(); unblock → status='active', blocked_at=null
  // 3. recordModerationAction(tx, ctx, {...}) in the SAME tx
});
```
- **Every admin-lane statement must carry `tenant_id = ctx.tenantId`.** The admin lane bypasses RLS, so that predicate is the only isolation (Pitfall 5).
- Under READ COMMITTED, a second concurrent transaction waiting on `FOR UPDATE` re-checks the locked rows against the `WHERE` after the first commits. A just-demoted admin then drops out of its set, and the count stays correct. [ASSUMED: standard Postgres EvalPlanQual behaviour. Pin it with an integration test that fires two demotions concurrently.]
- Refusal codes follow the existing envelope (`ApiError(409, 'CONFLICT', details)`, as chat uses `{ chat: 'member_blocked' }`). The exact detail keys are the planner's and the UI-SPEC's call.
- **Invited memberships:** refuse block, unblock and role change with 409 (`{ member: 'not_active' }`). Blocking an invite and then unblocking it would set `status='active'` without consents being recorded. Cancelling invites stays in the platform panel and 08.1-06 (see Open Questions).
- **Eager push cleanup:** after commit, emit a kernel event (for example `membership.blocked { tenantId, userId }`, declared in `@rede-social/contracts/moderation`). The notifications manifest subscribes and calls `app.push_subscriptions_delete_dead(array[userId])` inside a tenant lane for that tenant. The function's own comment says "Phase 8's block action can call it eagerly with the blocked user's id." [VERIFIED: supabase/migrations/20260930180227_push_subscriptions_functions.sql:125-133]. It is best-effort; the existing lazy sweep stays the backstop.

### Pattern 5: Tenant-lane branding = the platform services with `ctx.tenantId`
- `setBrandingColors(tenantId, body, actor)`, `startBrandingUpload`, `completeBrandingUpload` and `removeIconOverride` all take `tenantId` plus a `PlatformActor` (`{ userId: string; logger?: Logger }`). `updateTenant(id, { displayName }, actor)` handles the display name. [VERIFIED: packages/core/server/platform/branding.ts, platform/tenants.ts:372-405, invites.ts:16-19]
- New API routes `/v1/admin/branding/{uploads,uploads/:uploadId/complete,colors,icon}` and `PATCH /v1/admin/tenant` sit behind `requireAuth` + `requirePermission('tenant.manage')`. They pass `ctx.tenantId`, **never a path or body tenant id**.
- `BrandingForm`'s actions take `(tenantId, …)` (`BrandingActions` in `apps/web/components/platform/BrandingForm.tsx:33`). The tenant-lane server actions keep that signature but **ignore** the argument, and the API path carries no id. On 401/403 they map through the tenant bootstrap error mapping, not `platformRedirectPath`.
- `BrandingForm` has **no display-name field**. It only shows the name in the preview (`displayName={view.displayName}`). ADMIN-01's display-name edit needs a small separate field and action, following the platform `PATCH` precedent. D-342 says "reused as-is", so do not edit the form component itself.
- Freshness: the authenticated shell reads branding from `GET /v1/me/bootstrap` per request (`apps/web/app/(app)/layout.tsx:86-120`), so changes show at once. The public login shell and the manifest go through the host cache (60 s TTL web, per-instance on API). Document "≤ 60 s on the login screen" in the UI-SPEC.

### Pattern 6: Isolation inventory (route-table assertion)
- **Routes:** `app.routes` from `apps/api/src/app.ts` is importable without a database. This session it listed **106** non-`ALL` method+path entries (117 unique including middleware `ALL` rows), with placeholder env values. [VERIFIED: probe `tsx` script, output pasted in research notes]
  - Add `apps/api/tests/unit/isolation-inventory.test.ts`. It builds the set `METHOD path` (skipping `ALL`) and asserts equality with a checked-in map `apps/api/tests/isolation-inventory.ts`. Each entry maps to an isolation case id (`'b12'`, `'phase7-sweep'`, …) or an explicit exemption with a reason (`/v1/health`, `/v1/openapi.json`, `/v1/public/*` host lookup, `/v1/hooks/*` signature-authenticated, `/v1/webhooks/*` HMAC, `/v1/platform/*` covered by `g/g2/p`).
  - A new route with no map entry fails the unit suite, which also runs in the fast `pnpm turbo test` step. A second assertion greps `isolation.test.ts` for every referenced case id, so a map entry cannot point at a deleted case.
- **Web route handlers:** 19 `route.ts` files (`apps/web/app/**/route.ts`, listed this session). Each proxies an API route or serves host-scoped assets (manifest, SW, ics). Inventory them from `.next/app-path-routes-manifest.json` (already read by `check-static-routes.sh`), with the same map-or-exempt rule.
- **Storage:** two buckets, `branding` (public, 2 MiB cap) and `media` (private, 50 MiB) [VERIFIED: supabase/migrations/20260917021738_branding_bucket.sql:24-28 `'branding', 'branding', true, 2097152`; 20260921182426_media_bucket.sql:33-37 `'media', 'media', false, 52428800`]. Keys are `<tenant_id>/…`.
  - Inventory every route that mints or serves a Storage URL: `POST /v1/media/uploads`, `…/complete`, `GET /v1/media/:assetId/:variant`, `GET /v1/media/:assetId/playback`, the platform branding uploads, and the new `/v1/admin/branding/uploads`. Each needs a cross-tenant 404 case with a positive control (T-03-56 rule).
  - pgTAP `060`/`070` already pin the bucket policies.
- **Realtime:** four topic kinds, from `REALTIME_TOPIC_PATTERN = '^tenant:[0-9a-f-]{36}:(all|support-inbox|user:[0-9a-f-]{36}|conv:[0-9a-f-]{36})$'` [VERIFIED: packages/contracts/src/realtime.ts:34-35]. `realtime.test.ts` covers in-tenant negatives. Add one live case that joins **tenant B's** `all`, `user:<B-user>`, `support-inbox` and `conv:<B-conv>` with a tenant-A session (each refused), with tenant A's own topic as the positive control.
- **New Phase 8 endpoints** each add the standard pair: another tenant's id → bare 404, and an A-session on B's host → 403 `TENANT_HOST_MISMATCH`. That covers lab membership block/role, lab comment removal, the log never listing lab rows, and branding/rules never touching lab's tenant row.

### Pattern 7: i18n literal audit
- **Add Biome `style/noJsxLiterals`** at `error` for non-test `.tsx` under `apps/web` and `packages/**/ui` (overrides that exclude `**/*.test.tsx`, `**/tests/**`, `**/e2e/**`). This session's probe found **8 non-test hits, all punctuation**: `/`, `·`, `—`, `(`, `)` in `EventForm.tsx:520`, `inicio/page.tsx:63-64`, `TenantTable.tsx:209`, `PostCard.tsx:246`, `PostHeader.tsx:106` and `Textarea.tsx:82`. Configure `allowedStrings` for those glyphs, or move them into the catalog. [VERIFIED: `biome lint --only=style/noJsxLiterals`, Biome 2.5.13]
  - The rule catches what the current line regex misses: non-diacritic words (`Salvar`) and multi-line JSX text.
- **Keep `scripts/check-ui-literals.sh`** and add a rule for user-facing attribute literals (`aria-label|placeholder|title|alt|label="…letters…"`). A grep this session found **zero** current hits, so it can go in at error immediately.
- **Optional, stronger:** next-intl `AppConfig.Messages` typing makes `t('missing.key')` a `tsc` error [CITED: next-intl.dev/docs/workflows/typescript]. The catalog is 27 JSON files merged at runtime (`apps/web/i18n/messages.ts`), and some keys are dynamic (`kinds.${kind}`). Treat this as a separate, deferrable improvement, not a gate requirement.
- **Audit report:** the gate records the three checks' output (Biome rule, extended script, catalog-shape check) as the "pt-BR catalog audit: zero UI literals" row.

### Pattern 8: Module READMEs that cannot drift
Each `packages/modules/<m>/README.md` has fixed headings: `## Contracts`, `## Events emitted`, `## Events consumed`, `## Flag key`, `## Kernel dependencies`, `## Navigation`, `## Jobs`. A script or unit test (`scripts/check-module-readmes.ts`, run in `pnpm lint`) imports each `module.ts` manifest and asserts:
- the README's flag key equals `manifest.key`;
- every `manifest.events[].event` and `notificationSources[].event` is listed under consumed;
- every literal `emit(ctx, '<name>'` in `server/**/*.ts` is listed under emitted;
- `nav.href` matches.

The kernel capability gets `packages/core/server/moderation/README.md` with the same headings minus the flag.

### Pattern 9: Reuse fixture
`packages/reuse-fixture` (`turbo.json` tag `app`) depends on **only** `@rede-social/core`, `@rede-social/contracts`, `@rede-social/module-events`, `hono` and `@hono/zod-openapi`.
- `src/app.ts` does three things:
  - calls `setPermissionResolver` with kernel permissions ∪ `eventsModule.defaultRolePermissions`;
  - subscribes the manifest's `events`;
  - mounts `.route('/v1/events', eventsRoutes)`.
- Tests:
  - `tsc --noEmit` passes, proving it builds without the other modules;
  - `app.routes` contains exactly the events routes;
  - `GET /v1/events` without a token → 401 `UNAUTHENTICATED`, needing no DB;
  - when `DATABASE_URL` is set (the CI integration step), a seeded rede-demo session → 200.
- `turbo boundaries` already validates its graph.
- **Why events:** its schema references only kernel tables (`tenants`, `users`, `media_assets`) [VERIFIED: packages/modules/events/db/schema.ts imports]. Feed has hand-written FKs to communities and stories tables, and reels `requires` feed.

### Pattern 10: Nonce CSP in this app's `proxy.ts`
Official shape: generate a nonce per request and set `Content-Security-Policy` and `x-nonce` on **both** the forwarded request headers and the response. Next extracts the nonce from the request CSP and stamps framework scripts. Every page must be dynamic, and PPR/Cache Components are incompatible. [CITED: nextjs.org/docs/app/guides/content-security-policy, v16.3.8]

This app fits: `cacheComponents` is **off** (`apps/web/next.config.ts`), and `scripts/check-static-routes.sh` already forbids static app routes (allow-list `/_*`, `/serwist/*`). [VERIFIED: read this session]

Recommended policy (production; assemble the origins from `env`):
```
default-src 'self';
script-src 'self' 'nonce-{N}' 'strict-dynamic';              (+ 'unsafe-eval' only when NODE_ENV=development)
style-src 'self' 'unsafe-inline';                            (NO nonce here — see Pitfall 8)
img-src 'self' data: blob: {SUPABASE_URL} https://*.mux.com https://*.litix.io;
media-src 'self' blob: {SUPABASE_URL} https://*.mux.com;
connect-src 'self' {SUPABASE_URL} {SUPABASE_WSS} https://*.mux.com https://*.litix.io https://storage.googleapis.com;
worker-src 'self' blob:;
frame-src https://www.youtube-nocookie.com https://player.vimeo.com;
font-src 'self';  object-src 'none';  base-uri 'self';  form-action 'self';  frame-ancestors 'none';
upgrade-insecure-requests;                                   (ONLY when the request is https — Pitfall 9)
```
- The Mux directives come from Mux's CSP doc: playback `*.mux.com` + `blob:` media/worker; Mux Data `*.litix.io`; UpChunk `storage.googleapis.com`. [CITED: mux.com/docs/core/content-security-policy]
- `{SUPABASE_URL}` covers signed PUT, TUS `/storage/v1/upload/resumable/sign` and public branding images. `{SUPABASE_WSS}` is the same host with `wss:` (or `ws:` locally) for Realtime.
- **Rollout:**
  - ship `Content-Security-Policy-Report-Only` first behind a server env switch (`CSP_MODE=report-only|enforce`);
  - add a Playwright helper that records `securitypolicyviolation` events across the smoke specs and asserts zero;
  - run the real-device checklist under Report-Only;
  - then flip to `enforce`.
- **Inline embeds:** a click-to-play swap in `LinkPreviewCard`.
  - Compute an `embedUrl` server-side from the stored provider + URL (strict id regex) as an additive contract field.
  - Render `<iframe src={embedUrl} sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" loading="lazy">`.
  - Leave out `allow-top-navigation`, which is the Phase 4 threat.
  - YouTube shows "Error 153" without a usable referrer. [CITED: simonwillison.net/2025/Dec/1/youtube-embed-153-error] The `youtube-nocookie` host is [ASSUMED] equivalent for embeds.

### Anti-Patterns to Avoid
- **Log append in a bus subscriber.** Post-commit and error-swallowing, so a removal could exist without its log row.
- **Moderation as a toggleable module.** Needs a flag the conventions forbid, and turning it off breaks atomicity.
- **Trusting a `tenantId` from the browser** in the tenant-lane branding actions. `BrandingForm` passes one, so ignore it.
- **`status`-only or `blocked_at`-only block writes.** Some readers check one column and some the other (Pitfall 3).
- **A broad tenant-lane `UPDATE` policy on `memberships`.** The schema comment forbids it, and 040 asserts zero write policies.
- **`'nonce-…'` in `style-src`.** It disables `'unsafe-inline'` and breaks every SSR `style=` attribute (Pitfall 8).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSX text literal detection | Regex/AST checker | Biome `style/noJsxLiterals` | Built in (2.5.13), AST-accurate, multi-line, already in `pnpm lint` |
| Keyset paging for log/members | New cursor format | `encodeCursor`/`decodeCursor`/`keysetComparison` in `packages/core/server/paging.ts` | One envelope repo-wide; tampered cursors degrade to page 1 |
| Branding upload/derive/contrast | Tenant-lane copies | `packages/core/server/platform/branding.ts` services | Already handle icon versions, worker derivation and contrast gate |
| Route inventory | Hand-maintained list | `app.routes` from the Hono app | The router is the truth; the map only annotates it |
| Nonce plumbing | Manual nonce on each `<script>` | Next's automatic extraction from the request CSP header | Next stamps framework scripts itself |
| Infinite list UI | New observer | `InfiniteScroll` from `@rede-social/ui` | Reads the shell's scroll container |
| Notification retraction for removed comments | New retraction logic | Emit existing `comment.deleted` / `story.comment_deleted` per removed id | `feedNotificationRetractions` already matches `{ on: 'object', type: 'comment', id }` |

**Key insight:** almost every Phase 8 capability already has a kernel or platform implementation that takes `tenantId` as a parameter. The work is choosing where `tenantId` comes from (`ctx`, never input) and proving it with the inventory.

## Runtime State Inventory

This is not a rename phase, but production is live, so the runtime state that changes is recorded here:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `feed_comments` replies whose root is already author-deleted stay live (counted in `comment_count`, readable through `/replies` by id) | Decision: a one-off DML migration soft-deletes orphaned replies of deleted roots (counts self-correct through `app.feed_comment_count()` on the `deleted_at` transition), or leave legacy rows. Data migration, not a code edit. |
| Live service config | Production Supabase project, Cloud Run api/worker, Vercel project; new `qa` tenant + its domain (D-345); CSP env switch on Vercel | Human steps: create the qa tenant through the platform panel, attach and verify its domain, set `CSP_MODE` on Vercel |
| OS-registered state | None — verified: no cron/launchd/OS registration in scope | None |
| Secrets/env vars | None renamed. A new non-secret `CSP_MODE` on Vercel | Add to the docs/DEPLOY.md env table |
| Build artifacts | None | None |

## Common Pitfalls

### Pitfall 1: Root-comment removal leaves its replies live
**What goes wrong:** the root disappears, but its replies keep counting in `comment_count`, and `listReplies(rootId)` still serves them. Notifications "X respondeu" about those replies stay in the bell.
**Why it happens:** `deleteComment` updates only `where id = ${commentId}` (service.ts:1596-1607). Nothing cascades `deleted_at`. The FK cascade is `on delete`, and soft delete is an update.
**How to avoid:** soft-delete `id = X or parent_id = X` in one statement with `returning id`, and emit one `comment.deleted` per returned id (`commentReplied` notifications use `object: { type: 'comment', id: row.comment_id }` for the **reply** id, notifications.ts:257-262). Apply it to the author path too, because D-334 says the two look identical.
**Warning signs:** pgTAP count reconciliation goes red; a notification still opens a removed thread.

### Pitfall 2: Moderator deleting their own comment logs a moderation action
**How to avoid:** log only when `actor ≠ author`. An admin removing their own comment is an author delete.

### Pitfall 3: Block writes only one of `status` / `blocked_at`
**What goes wrong:** `app.membership_for_user` reports blocked when `blocked_at is not null` (`case when m.blocked_at is not null then 'blocked' else m.status end`, migration 20260914171114:30). But `listMembers` (`profiles/service.ts:362`, `m.status = 'active'` with no `blocked_at`) and `getMemberProfile` (`:314`) check only `status`. A `blocked_at`-only block leaves the member listed in the directory. The integration tests (push, realtime, events-reminders) toggle `blocked_at` only.
**How to avoid:** block sets `status='blocked', blocked_at=now()`. Unblock sets `status='active', blocked_at=null`, and only from `blocked`. Refuse invited memberships.

### Pitfall 4: Two admins demoting each other at once
**How to avoid:** use the `FOR UPDATE` lock on the active-admin set plus the target (Pattern 4) and add a concurrent integration test. A plain `count(*)` without locks lets both commits pass.

### Pitfall 5: Admin-lane statement without `tenant_id = ctx.tenantId`
**What goes wrong:** `service_role` bypasses RLS. A membership id from tenant B would be blocked by a tenant-A admin.
**How to avoid:** put `tenant_id = ${ctx.tenantId}` in every `where` (or use `membershipOfRecord`-style helpers), and add an isolation case for each admin route.

### Pitfall 6: "Session revoked immediately" vs an open Realtime socket
**What goes wrong:** Realtime caches the channel authorization for the connection. A revoked user keeps receiving until the JWT expires or a new token is sent. [CITED: supabase.com/docs/guides/realtime/authorization]
**How to avoid:**
- Signals are ids-only, and every data read goes through the API, which refuses `MEMBERSHIP_BLOCKED` on the next request, so the exposure is bounded.
- `/api/realtime/token` does not check membership. A token refresh re-runs `app.realtime_topic_allowed`, which refuses blocked members.
- Optionally publish a `notifications.changed` signal on the blocked user's `user:` topic right after the block, so the client refetches and hits the 403 at once. Verify the client then navigates to `/acesso-suspenso`.
- This is the "blocked-member-with-an-open-socket" real-device row.

### Pitfall 7: Branding form remount while typing (WINDOWS #71)
**What goes wrong:** the phase2-smoke Marca case saw "Salvar alterações" re-render disabled after `#primary` was filled. `TenantBrandingPage` keys the form on `formKey(view)` (iconVersion, iconsReady, URLs, colours), and the form polls `actions.status` every 3 s while icons derive. [ASSUMED: a refreshed view while the derivation finishes remounts the form and drops the typed colour state.]
**Why it matters here:** the tenant-lane route reuses this exact form, so the flake becomes an ADMIN-01 bug. Triage it in the D-348 plan before building the tenant route on top.

### Pitfall 8: A nonce in `style-src` breaks every inline `style=`
**What goes wrong:** browsers ignore `'unsafe-inline'` when a nonce or hash is present. The app renders many SSR `style={…}` attributes: brand vars on `<html>`/`(app)/layout.tsx:120`, `(auth)/layout.tsx:41`, `BrandPreview`, `AppShell`, `BottomNav`, progress bars and more (34 files with `style={`).
**How to avoid:** use `style-src 'self' 'unsafe-inline'` with no nonce. Script injection is the threat CSP addresses here.

### Pitfall 9: `upgrade-insecure-requests` breaks local e2e
**What goes wrong:** dev and Playwright run on `http://*.localhost:3000`. `e2e:pwa` runs a **production** build over http, so a `NODE_ENV` gate is wrong.
**How to avoid:** include the directive only when `x-forwarded-proto` (or `request.nextUrl.protocol`) is `https`. Likewise build Supabase origins from `NEXT_PUBLIC_SUPABASE_URL` (`http://127.0.0.1:54321` locally, `ws:` for Realtime).

### Pitfall 10: CSP lost on proxy branches
**What goes wrong:** `proxy.ts` rebuilds `requestHeaders` and `response` inside `setAll` (cookie refresh) and returns rewrites and redirects (`/cadastro` rewrite, 308 primary host, 307 platform). If the CSP is only set once, refreshed-session responses ship without it.
**How to avoid:** set CSP and nonce inside `buildRequestHeaders` and on every returned response (wrap `withCookies`). Assert with an e2e that reads `response.headers()['content-security-policy']` on a refreshed-session navigation.
**Related:** the service worker script (`/serwist/sw.js`) passes through `proxy.ts`. The CSP on that response **becomes the SW's own policy**, so its `connect-src` must allow what the SW fetches (branding bucket, media routes).

### Pitfall 11: `form-action 'self'` and cross-origin redirects
Chrome applies `form-action` to redirects after a form submit. A no-JS form POST on an alias host is 308'd to the primary origin and would be blocked. Server actions use `fetch` when JS is loaded, so impact is limited. Keep a note in the UI-SPEC and do not add alias hosts to `form-action`.

### Pitfall 12: Integration test filtering and disk
`pnpm --filter @rede-social/api test:integration -- <name>` does **not** filter. Use `pnpm --filter @rede-social/api exec vitest run tests/integration/<file> -t "<name>"`. `.turbo/cache` fills the disk (94% used now), so run gates with `TURBO_CACHE=local:r`. Manual UAT rows in the local DB shift `stories.test.ts` counts, so ask before `pnpm db:reset`.

## Code Examples

### Proxy nonce + CSP (adapted to this proxy)
```typescript
// Source: nextjs.org/docs/app/guides/content-security-policy (v16.3.8), adapted
function cspFor(nonce: string, https: boolean): string {
  const supa = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  const ws = `${supa.protocol === 'https:' ? 'wss' : 'ws'}://${supa.host}`;
  const dev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supa.origin} https://*.mux.com https://*.litix.io`,
    `media-src 'self' blob: ${supa.origin} https://*.mux.com`,
    `connect-src 'self' ${supa.origin} ${ws} https://*.mux.com https://*.litix.io https://storage.googleapis.com`,
    "worker-src 'self' blob:",
    'frame-src https://www.youtube-nocookie.com https://player.vimeo.com',
    "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}
// in buildRequestHeaders(): h.set('x-nonce', nonce); h.set(CSP_HEADER, policy);
// on every returned NextResponse: res.headers.set(CSP_HEADER, policy)
// CSP_HEADER = CSP_MODE === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'
```

### CORS guard test (the "lock")
```typescript
// apps/api/tests/unit or integration: the API never answers CORS — the browser never calls it
const res = await app.request('/v1/health', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
expect(res.headers.get('access-control-allow-origin')).toBeNull();
const get = await app.request('/v1/health', { headers: { Origin: 'https://evil.example' } });
expect(get.headers.get('access-control-allow-origin')).toBeNull();
```

### Route inventory assertion
```typescript
// apps/api/tests/unit/isolation-inventory.test.ts (shape)
import { app } from '../../src/app';
import { INVENTORY } from '../isolation-inventory';
const live = new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`));
expect([...live].filter((k) => !(k in INVENTORY))).toEqual([]);      // every route classified
expect(Object.keys(INVENTORY).filter((k) => !live.has(k))).toEqual([]); // no stale entries
```

### Rules save with version bump only on change
```sql
update public.tenants
   set rules_text = $1, rules_version = rules_version + 1, updated_at = now()
 where id = $2 and rules_text is distinct from $1
returning rules_version;
```
`tenants.rules_text text not null default ''` and `rules_version integer not null default 1` [VERIFIED: packages/core/db/schema/tenants.ts:24-25]. Sign-up refuses a stale version with 400 `{ consents: 'stale' }` (signup.ts:146-149), so a member mid-sign-up during a save is re-asked. Existing behaviour, no change.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `middleware.ts` CSP examples | `proxy.ts` (Node runtime) nonce | Next 16 | This repo already uses `proxy.ts` |
| `react/jsx-no-literals` (ESLint) | Biome `style/noJsxLiterals` | Biome 2.2.4 | No ESLint needed (TS 7 safe) |
| YouTube iframe with no referrer policy | `referrerpolicy="strict-origin-when-cross-origin"` required | Late 2025 (Error 153) | Must be on every embed iframe |

**Deprecated/outdated:**
- The `IN-01`/`IN-02` fix suggestions in 02-REVIEW: superseded by 08.1-06, which removes `identityConflict`, `isOneTenantPerUserViolation` and `NIL_TENANT_ID` entirely and keeps an `already_accepted` refusal for an identity active in the inviting tenant. [VERIFIED: .planning/phases/08.1-multi-tenant-identity/08.1-06-PLAN.md:95,144,240] Record both as "superseded by 08.1-06" with that reason. Fix IN-03..IN-07 here; each is small and local (auth/confirm branch, resend reason map, `invites.at(-1)`, `LogoUpload` try/after, `tenant-host.test.ts` case independence).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Supabase default privileges grant ALL on new `public` tables to anon/authenticated/service_role, so an explicit revoke is needed | Pattern 2 | Without the revoke, the trigger still blocks writes (defence holds), but the grants assertion fails. Verify with `\dp`. |
| A2 | `FOR UPDATE` + READ COMMITTED re-check makes the last-admin guard race-safe | Pattern 4 | Two concurrent demotions could leave zero admins. Covered by a required concurrency test. |
| A3 | WINDOWS #71's root cause is the `formKey` remount during icon polling | Pitfall 7 | The tenant-lane Marca screen inherits an unknown flake. Triage first. |
| A4 | `youtube-nocookie.com` behaves like `youtube.com` for embeds under the CSP | Pattern 10 | Inline YouTube fails. Report-Only rollout catches it. |
| A5 | The Mux direct-upload PUT host is `storage.googleapis.com` (per Mux CSP doc); not visible in this repo's code | Pattern 10 | Video upload blocked under enforce. Report-Only + real-device pass catches it. |
| A6 | Log reason ≤ 500 chars and excerpt ≤ 280 chars are acceptable lengths | Pattern 2 | Copy/UI decision. Confirm in UI-SPEC. |
| A7 | Refusing block/role on `invited` memberships is acceptable under D-332 ("any membership") | Pattern 4 | If the user wants invites blockable, unblock must restore `invited`, not `active`. |
| A8 | The `qa` tenant can get a verified custom domain on production (the platform host is `rede-social-woad.vercel.app`; no wildcard subdomain exists) | Environment | The real-device pass cannot run on a tenant host. Needs a DNS name from the developer. |

## Open Questions

1. **Does the inline YouTube/Vimeo player ship in Phase 8, or only the CSP that permits it?**
   - What we know: D-346 says the CSP "unblocks" inline embeds. The `LinkPreviewCard` docblock calls inline playback "a Phase 8 item behind a real CSP".
   - Recommendation: ship the click-to-play iframe in the CSP plan (small, additive `embedUrl`). Planner confirms.
2. **Repair already-orphaned replies in production?**
   - Recommendation: yes. One guarded DML migration (`update feed_comments r set deleted_at = p.deleted_at … from feed_comments p where r.parent_id = p.id and p.deleted_at is not null and r.deleted_at is null`). It is expand-safe and the counts self-correct. The planner records it.
3. **Block/unblock permission:** `moderation.manage` (recommended, D-338 lists block as moderation) or `members.manage`?
   - Recommendation: `moderation.manage` for block/unblock/log/removal, and `members.manage` for role change and the list.
4. **Membros list and invites:** show `invited` rows read-only (no resend/cancel here). 08.1-06 rewrites the invite path, and moving the controls now would collide with it.
5. **qa tenant lifecycle:** keep it active until 08.1's real-device smoke closes the MVP (D-344), then suspend it through the platform status toggle (reversible). Never hard-delete it.
6. **CSP violation reporting:** Report-Only needs a sink to be useful in production. A tiny `/api/csp-report` route handler that `console.error`s into Vercel logs is enough. Is it in scope? Recommendation: yes, inside the CSP plan.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v24.14.0 | — |
| pnpm | workspace | ✓ | 12.4.1 | — |
| Docker | local Supabase stack | ✓ | server 29.3.1 | — |
| Supabase CLI | pgTAP, db reset, prod push | ✓ | repo 2.117.0 / brew 2.118.0 | Use brew CLI for prod pushes (repo binary hangs on keychain, user memory) |
| Playwright | e2e, CSP violation sweep | ✓ | 1.63.0 | — |
| gcloud / vercel CLIs | production deploy, qa tenant domain | ✓ | — | — |
| Disk space | turbo builds | ⚠ 12 GiB free (94% used) | — | `TURBO_CACHE=local:r`, `rm -rf .turbo/cache` |
| Real iPhone + Android phone | D-345 checklist | human | — | Rows stay `blocked`, never passed |
| DNS name for the `qa` tenant | D-345 | unknown | — | Ask the developer (A8) |

**Missing dependencies with no fallback:** real devices and a qa domain are human-provided. The planner adds `checkpoint:human-action` tasks.
**Missing dependencies with fallback:** disk pressure (cache flags).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (per package), Playwright 1.63.0 (`apps/web/playwright.config.ts`, `playwright.pwa.config.ts`), pgTAP via `supabase test db` |
| Config file | per-package `vitest.config.ts`; `apps/api` has `tests/unit` + `tests/integration` |
| Quick run command | `pnpm --filter @rede-social/api exec vitest run tests/unit` / `pnpm --filter @rede-social/core exec vitest run` |
| Full suite command | `TURBO_CACHE=local:r pnpm verify` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MODER-01 | Moderator removes any comment; replies cascade; counts drop; log row in same tx; member gets bare 404 on others' comments | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/moderation-comments.test.ts` | ❌ Wave 0 |
| MODER-01 | Story comment admin removal + `story.comment_deleted` retraction | integration | same file, `-t "story"` | ❌ Wave 0 |
| MODER-02 | Block → next request 403 `MEMBERSHIP_BLOCKED`; sign-up same e-mail 409; push subs deleted; self/last-admin guards; concurrent demotions | integration | `…vitest run tests/integration/member-admin.test.ts` | ❌ Wave 0 |
| MODER-03 | Log append-only: UPDATE/DELETE/TRUNCATE refused in every lane; policy shape; grants | pgTAP | `pnpm supabase test db` (new `160-moderation-log.sql`, extend `040`, `020`) | ❌ Wave 0 |
| MODER-03 | Log list keyset + action filter, admin only, support 403 | integration | `…vitest run tests/integration/moderation-log.test.ts` | ❌ Wave 0 |
| ADMIN-01 | Tenant-lane branding routes use `ctx.tenantId`; contrast gate; display name | integration + e2e | `…vitest run tests/integration/admin-branding.test.ts`; `pnpm --filter @rede-social/web exec playwright test admin-branding.spec.ts` | ❌ Wave 0 |
| ADMIN-02 | Admin list: all statuses, search, status filter; role change effective next request | integration + e2e | `…vitest run tests/integration/member-admin.test.ts`; `playwright test admin-members.spec.ts` | ❌ Wave 0 |
| ADMIN-03 | Rules save bumps version only on change; `/cadastro` shows new text; old consents untouched | integration + e2e | `…vitest run tests/integration/admin-rules.test.ts` | ❌ Wave 0 |
| ADMIN-04 | Creation flows at iPhone/Pixel viewports | e2e + manual real device | existing specs on `mobile-chromium` + D-345 checklist | ✅ (specs) / manual |
| MOD-05 | READMEs match manifests; reuse fixture builds, mounts, serves | unit + integration | `pnpm --filter @rede-social/reuse-fixture test`; `tsx scripts/check-module-readmes.ts` | ❌ Wave 0 |
| Gate | Every API route classified in the isolation inventory | unit | `pnpm --filter @rede-social/api exec vitest run tests/unit/isolation-inventory.test.ts` | ❌ Wave 0 |
| Gate | Cross-tenant Realtime topic joins refused (4 kinds) | integration | `…vitest run tests/integration/realtime.test.ts -t "cross-tenant"` | ❌ Wave 0 (new case) |
| Gate | Zero UI literals | lint | `pnpm lint` | partial (script exists; rule new) |
| Gate | CSP header present on every HTML response incl. refreshed session; zero violations in smoke | e2e | `playwright test csp.spec.ts` | ❌ Wave 0 |
| Gate | API emits no CORS headers | unit | `…vitest run tests/unit/cors.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the task's own vitest file plus `pnpm lint` (fast).
- **Per wave merge:** `pnpm supabase test db && pnpm --filter @rede-social/api exec vitest run tests/integration` (after a re-seed if needed).
- **Phase gate:** one green `TURBO_CACHE=local:r pnpm verify` plus one CI run that finishes (D-348), then the D-345 real-device checklist.

### Wave 0 Gaps
- [ ] `supabase/tests/160-moderation-log.sql`, plus additions to `020-tenant-isolation.sql` and `040-schema-conventions.sql` (policy shape, grants, trigger)
- [ ] `apps/api/tests/integration/{moderation-comments,member-admin,moderation-log,admin-branding,admin-rules}.test.ts`
- [ ] `apps/api/tests/unit/{isolation-inventory,cors}.test.ts` + `apps/api/tests/isolation-inventory.ts`
- [ ] `packages/reuse-fixture/` with its own `vitest.config.ts` (Vitest 5 does not walk up for config)
- [ ] `scripts/check-module-readmes.ts` wired into `pnpm lint`
- [ ] `apps/web/e2e/{csp,admin-branding,admin-members,moderation}.spec.ts` + a shared `securitypolicyviolation` collector fixture
- [ ] CI: split `checks` into jobs (static + unit; pgTAP + integration; e2e sharded with `--shard=i/n`, each with its own `supabase start` + seed; `e2e:pwa`). e2e alone took 49.8 min single-worker in the 07-15 gate (`deferred-items.md`), so a single job cannot fit 60 min.

## Security Domain

`security_enforcement: true`, ASVS level 1, block on high.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (block must stop access) | Existing `requireAuth` per-request membership check; no change to JWT handling |
| V3 Session Management | yes | Block effective on next request; Realtime residue bounded by JWT expiry (Pitfall 6) |
| V4 Access Control | yes (core of phase) | `requirePermission` (`moderation.manage`, `members.manage`, `tenant.manage`); `ctx.tenantId` only; admin-lane `tenant_id` predicate; self/last-admin guards; bare 404 cross-tenant |
| V5 Input Validation | yes | Zod contracts in `@rede-social/contracts/moderation` (reason ≤ N, role enum = `TENANT_ROLES`, rules text max, cursor via `decodeCursor`) |
| V6 Cryptography | no new crypto | Nonce from `crypto.randomUUID()` (official pattern) |
| V7 Error/Logging | yes | Append-only `moderation_log`; pino lines carry ids only, never comment bodies (T-04-19 rule) |
| V14 Configuration | yes | CSP, `frame-ancestors 'none'`, no CORS, sandboxed third-party frames |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tenant-A admin acts on tenant-B membership/comment | Elevation / Info disclosure | `ctx.tenantId` in every admin-lane `where`; RLS in tenant lane; inventory + isolation cases |
| Admin locks everyone out (self-demote, last admin) | Denial of service | API guards under row locks; super_admin escape hatch |
| Audit tampering | Repudiation / Tampering | Insert-only policy, revoked grants, raising trigger (covers service_role and owner); pgTAP proof |
| Forged log entry from the tenant lane | Spoofing | Insert policy pins `tenant_id` and `actor_user_id` to claims; only permission-guarded routes call the writer |
| Stored XSS via comment/excerpt/rules text | Tampering | React escaping only, no raw HTML (existing rule); CSP with nonce + `strict-dynamic` |
| Clickjacking of admin screens | Tampering | `frame-ancestors 'none'` |
| Third-party frame navigating top / setting cookies | Elevation | `sandbox` without `allow-top-navigation`; `frame-src` allow-list (2 hosts) |
| Membership probe through admin list/profile | Info disclosure | One bare 404 body for unknown/other-tenant/removed |
| Moderation reason/excerpt retention (LGPD) | Privacy | Admin-only read; flagged on the D-349 LGPD row (excerpt retention period is a legal question) |

## Sources

### Primary (HIGH confidence — read in this session)
- Codebase files read:
  - `packages/core/server/{events/bus.ts, rbac/*.ts, modules/manifest.ts, auth/require-auth.ts, tenancy/{membership,membership-scope,accept-invite,signup,public-tenant}.ts, profiles/service.ts, paging.ts, platform/{branding,tenants}.ts}`
  - `packages/core/db/{tenant-tx,admin-tx,rls}.ts`
  - `packages/core/db/schema/{memberships,consent-records}.ts`
  - `packages/core/docs/SCHEMA-CONVENTIONS.md`
  - `packages/modules/feed/{module.ts, db/schema.ts, server/service.ts, server/notifications.ts, ui/LinkPreviewCard.tsx}`
  - `packages/modules/stories/server/service.ts`
  - `packages/contracts/src/{modules,realtime}.ts`
  - `apps/api/src/{app.ts, modules/registry.ts, routes/members.ts, routes/platform/branding.ts}`
  - `apps/web/{proxy.ts, next.config.ts, lib/api.ts, app/(app)/configuracoes/page.tsx, app/(platform)/…/marca/*, app/api/realtime/token/route.ts}`
  - `biome.json`, `turbo.json`, `package.json`, `scripts/{check-ui-literals.sh, check-static-routes.sh}`, `.github/workflows/ci.yml`
  - migrations `app_helpers`, `membership_lookup_lifecycle`, `feed_counters`, `realtime_authorization`, `push_subscriptions_functions`, `*_bucket`
- Probes run:
  - `app.routes` enumeration (106 routes);
  - `biome lint --only=style/noJsxLiterals` (8 punctuation hits);
  - an attribute-literal grep (0 hits);
  - tool versions.
- Planning files read: 08-CONTEXT, 02-REVIEW IN-01..08, 08.1-CONTEXT, 08.1-06-PLAN, WINDOWS rows 48-71, 07 deferred-items.

### Secondary (MEDIUM — official docs fetched this session)
- https://nextjs.org/docs/app/guides/content-security-policy (v16.3.8) — nonce via proxy, dynamic-only, PPR incompatibility, dev `unsafe-eval`
- https://biomejs.dev/linter/rules/no-jsx-literals/ — rule group, options, version
- https://supabase.com/docs/guides/realtime/authorization — per-connection caching, refresh on new JWT
- https://www.mux.com/docs/core/content-security-policy — playback/data/upload directives
- https://next-intl.dev/docs/workflows/typescript — `AppConfig.Messages`

### Tertiary (LOW — web search)
- https://simonwillison.net/2025/Dec/1/youtube-embed-153-error/ and https://teamdynamix.umich.edu/TDClient/30/Portal/KB/Article/14491/Fixing-YouTube-Player-Error-153-with-Referrer-Policy-Settings — YouTube Error 153 / referrer policy

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. No new packages; all versions probed.
- Architecture (kernel moderation, atomic log, admin-lane guards, inventory): HIGH. Grounded in files read and probes.
- CSP directives: MEDIUM. Official docs, but not yet exercised against this app; mitigated by the Report-Only rollout.
- Pitfalls: HIGH for the code-derived ones (1, 3, 5, 8, 9, 10, 12); MEDIUM for 6; LOW for 7 (hypothesis).

**Research date:** 2026-10-01
**Valid until:** 2026-10-31 (stable codebase facts; re-check CSP third-party hosts at enforce time)
