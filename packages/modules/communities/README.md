# @rede-social/module-communities

The tenant's communities (COMM-01..04): named containers that the admin creates, edits, archives, reactivates and deletes,
listed newest-active first with a keyset over the trigger-owned `last_activity_at`. Feed posts and
story highlights carry a community id; those modules own their references, this one never imports
them.

## Contracts

| Subpath | What it holds |
|---|---|
| `./module` | `communitiesModule`, the manifest |
| `./contracts` | Zod schemas and constants shared with the web app |
| `./server` | `communitiesRoutes` and the service functions |
| `./ui` | `CommunityCard`, `CommunityCover`, `CommunityHeader`, `CommunityPickerSheet` |
| `./db` | Drizzle tables `communities`, `communityMembers` with their RLS policies |

Main contract names (`./contracts`): `communityQuerySchema`, `communitySummarySchema`,
`communityPageSchema`, `createCommunitySchema`, `updateCommunitySchema`, the permission names
`COMMUNITY_PERMISSIONS` (`communities.community.manage`), `COMMUNITY_STATUSES`,
`COMMUNITY_MEMBER_ROLES` and the refusal vocabulary `COMMUNITY_ISSUES` (`name_required`,
`archived`, `cover_invalid`, `order_stale`, `not_archived`, `unlock_active`), with
`COMMUNITY_UNLOCK_NAMES_MAX` and `communityUnlockRefusalSchema` for the delete's refusal.

Main server names (`./server`): `communitiesRoutes`, `listCommunities`, `getCommunity`,
`createCommunity`, `updateCommunity`, `deleteCommunity`, `slugify`.

**Phase 10 (member communities, D-706..D-711).** A community has a `kind`: `organization` (the admin's, the only kind
that exists before this phase and the default of every row) or `member` (created by a member of a tenant that has the
`social` module on). The owner rule is the creator and nobody else: only the creator edits, archives, reactivates and
posts in a member community; an admin or a support session is never its owner, and only the moderator
(`moderation.manage`) archives or removes it, with a moderation log row. The permissions are `communities.community.create`
and `communities.community.manage_own`, composed by the kernel for role `member` only while `social` and this module are
effective (`permissionsFor` stays pure). The per-member limit is a kernel seam (`memberCommunityPolicyFor` reads the social
settings, `communities.maxPerMember`, default 3, and the create and the reactivation count under an advisory lock; the
refusal is `limit_reached`). A member community is hidden from every read while its creator has no live membership
(blocked or departed). The creator projection: `createdBy` is `{ membershipId, displayName, avatarUrl }` for a member
community and `null` for an organization one, and the creator's user id is never selected; `viewer` carries the
viewer's flags and `viewer.actions` (the Escopo seam, constant false until the per-product scope exists); `memberQuota`
is the caller's own `{ ownedActive, limit }` or null. Reordering (`PUT /v1/communities/order`) names the ORGANIZATION
set only; a member community has the fixed position 1000000.

## Events emitted

- `community.created`: `tenantId`, `communityId`, `actorUserId`
- `community.updated`: `tenantId`, `communityId`, `actorUserId`
- `community.archived`: `tenantId`, `communityId`, `actorUserId`

Deleting a community emits nothing: it is a silent soft delete of an archived community.

## Events consumed

- Manifest subscriptions (log the shape only): `community.created`, `community.updated`,
  `community.archived`.
- Notification sources and retractions: none.

## Flag key

`communities` in `tenant_modules`. No `requires`.

## Kernel dependencies

- `@rede-social/core/db/rls`
- `@rede-social/core/db/schema`
- `@rede-social/core/db/social-gate` (10-03: `SOCIAL_ENABLED`, the SQL `app.social_enabled()` term of the member insert
  gates in the schema's policies)
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/communities/member-policy` (10-05: `memberCommunityPolicyFor`, the kernel seam that
  tells the module how many active communities one member may own; the app registry fills it from the social
  settings, so this module never imports the social package)
- `@rede-social/core/server/events/bus`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/moderation/log` (10-05: `recordModerationAction`, the moderator's archive or removal of a
  member community, in the same transaction as the write)
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/paging`
- `@rede-social/core/server/rbac/permissions`
- `@rede-social/core/server/safety/limits` (10-05: `communityCreateLimiter`, the per-member creation ceiling)
- `@rede-social/core/ui`

## Navigation

- Tab "Comunidades": placement `tab`, href `/comunidades`, icon `users`, order 20.
- Home slots: none.

## Jobs

- Jobs: none.
- Sweep functions: none.

## Reuse

The worked example lives in `packages/reuse-fixture`. A host app must provide: a request id and a
per-request logger, `flushEventsAfterHandler`, an `onError` rendering `errorEnvelope`,
`setPermissionResolver` with the kernel grants plus `defaultRolePermissions` (`admin_tenant`:
`communities.community.manage`), the manifest's `events` subscribed on the bus, and
`.route('/v1/communities', communitiesRoutes)`. The routes carry their own `requireAuth`,
`requireModule('communities')` and `requirePermission` chain. Copy the module's tables with the
kernel's; nothing here points at another module's tables.
