# @rede-social/module-social

The tenant's social layer (Phase 9, SOCIAL-01..10, FOLLOW-01..06, EXPL-01..06): a one-directional
follow graph between members and member posts shown in Explorar. Turning the module on for a tenant
is the ONE switch that makes its members authors (D-482); with it off, or with `feed` off, the
product is exactly what it was before. This README describes what exists at plan 09-01: the switch
and its permission. The follow graph, the directory branch, Explorar and the moderation path arrive
in the following plans, which rewrite these sections for the finished module.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `socialModule`, the manifest |
| `./contracts` | `SOCIAL_MODULE_KEY` and `SOCIAL_PERMISSIONS` (`social.participate`) |

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

- `@rede-social/core/server/modules/manifest`

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
both enabled. The module needs the `feed` module to be mounted; it has no routes of its own yet.
