# @rede-social/module-communities

The tenant's communities (COMM-01..04): named containers that the admin creates, edits and archives,
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
`COMMUNITY_MEMBER_ROLES` and the refusal vocabulary `COMMUNITY_ISSUES`.

Main server names (`./server`): `communitiesRoutes`, `listCommunities`, `getCommunity`,
`createCommunity`, `updateCommunity`, `slugify`.

## Events emitted

- `community.created`: `tenantId`, `communityId`, `actorUserId`
- `community.updated`: `tenantId`, `communityId`, `actorUserId`
- `community.archived`: `tenantId`, `communityId`, `actorUserId`

## Events consumed

- Manifest subscriptions (log the shape only): `community.created`, `community.updated`,
  `community.archived`.
- Notification sources and retractions: none.

## Flag key

`communities` in `tenant_modules`. No `requires`.

## Kernel dependencies

- `@rede-social/core/db/rls`
- `@rede-social/core/db/schema`
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/events/bus`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/paging`
- `@rede-social/core/server/rbac/permissions`
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
