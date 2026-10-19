# @rede-social/module-social

The tenant's social layer (Phase 9, SOCIAL-01..10, FOLLOW-01..06, EXPL-01..06): a one-directional
follow graph between members and member posts shown in Explorar. Turning the module on for a tenant
is the ONE switch that makes its members authors (D-482); with it off, or with `feed` off, the
product is exactly what it was before. This README describes what exists at plan 09-02: the switch,
its permission and the follow graph (the `social_follows` table, the six `/v1/social` routes, the
counts definer and the member branch of the directory gate). Explorar and the moderation path arrive
in the following plans, which rewrite these sections for the finished module.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `socialModule`, the manifest |
| `./contracts` | `SOCIAL_MODULE_KEY`, `SOCIAL_PERMISSIONS` (`social.participate`), `SOCIAL_FOLLOW_ISSUES`, `followResultSchema`, the list, batch state and social profile schemas |
| `./server` | `socialRoutes` (`PUT` and `DELETE /v1/social/follows/{membershipId}`, `POST /v1/social/follows/state`, `GET /v1/social/me/followers`, `GET /v1/social/me/following`, `GET /v1/social/members/{membershipId}`) and the service functions behind them |
| `./db` | `socialFollows`, the follow table with its own-row policies |

The follow graph is member to member only (D-467). Counts are public and lists are private (D-468):
the RLS select policy shows a lane only the rows it is a party to, and another member's counts come
from the tenant-pinned definer `app.social_counts`, which returns two integers and never a row. There
is deliberately no route that takes a member id for a list; the lists read the session's own rows. The
kernel seam `app.social_enabled()` and `app.social_visible_author_ids()` (declared as stubs by a kernel
migration, given bodies by this module's `*_social_functions.sql`) is what the feed will read.

The member authoring permissions `feed.post.create` and `feed.post.manage` are composed for role
`member` by the app-tier registry (`permissionsFor` in `apps/api/src/modules/registry.ts`) while
`social` is effective, because naming a feed permission here would be a module-to-module edge
(MOD-02). `social.participate` is member-only by construction: the routes authorise by the
permission, the database by the member role.

## Events emitted

None.

## Events consumed

- Manifest subscriptions: none.
- Notification sources: none.
- Notification retractions: none.

## Flag key

`social` in `tenant_modules`. Requires `feed` (D-121): while `feed` is off the module contributes no
bootstrap entry and no permission. Off by default: not in `REAL_TENANT_DEFAULT_MODULES`, and no
migration backfills a row (a missing row reads as disabled, SOCIAL-01).

## Kernel dependencies

- `@rede-social/core/db/schema`
- `@rede-social/core/db/social-gate`
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/paging`
- `@rede-social/core/server/rbac/permissions`

## Navigation

- None. The module adds no tab and no top-bar entry (D-479); the Explorar chip lives in the web.

## Jobs

- None.
- Sweep functions: none.

## Reuse

The worked example of mounting a module lives in `packages/reuse-fixture` (it mounts the events
module; this module mounts the same way). A host app must provide: `setPermissionResolver` with the
kernel grants plus `defaultRolePermissions` (`member`: `social.participate`) and the registry branch
that grants `feed.post.create` and `feed.post.manage` to role `member` while `social` and `feed` are
both enabled. The module needs the `feed` module to be mounted. Its router chains BOTH
`requireModule('feed')` and `requireModule('social')`, because `requires` is enforced by the
permission composition and the bootstrap, not by `requireModule`.
