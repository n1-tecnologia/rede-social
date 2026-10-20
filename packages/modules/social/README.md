# @rede-social/module-social

The tenant's social layer (Phase 9, SOCIAL-01..10, FOLLOW-01..06, EXPL-01..06): a one-directional
follow graph between members, member posts that only the author's followers read in Explorar, and the
per-tenant limits that bound what members upload. Turning the module on for a tenant is the ONE switch
that makes its members authors (D-482); with it off, or with `feed` off, the product is exactly what
it was before and every member post is hidden at the database without being deleted (D-483).

This README describes the finished module. The module itself owns the follow graph (the
`social_follows` table, the six `/v1/social` routes, the counts definer, the directory gate), the
`social.participate` permission, the settings contract and the props-only follow and locked-post UI.
The rest of the phase lives where the data lives, by the modular rule (MOD-02): the stamped audience,
Explorar, the locked answer, the interaction gate, member media validation and the comment notice are
the feed module's and the kernel's, reading this module's two database functions through the kernel
seam below; the web hosts the chip row, the composer and the screens.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `socialModule`, the manifest |
| `./contracts` | `SOCIAL_MODULE_KEY`, `SOCIAL_PERMISSIONS` (`social.participate`), `SOCIAL_FOLLOW_ISSUES`, `followResultSchema`, the list, batch state and social profile schemas, and the member media settings: `socialSettingsSchema` (tolerant read), `socialSettingsPatchSchema` (strict), `socialSettingsAnswerSchema`, `SOCIAL_SETTINGS_DEFAULTS` and the four caps taken from the admin limits |
| `./server` | `socialRoutes` (`PUT` and `DELETE /v1/social/follows/{membershipId}`, `POST /v1/social/follows/state`, `GET /v1/social/me/followers`, `GET /v1/social/me/following`, `GET /v1/social/members/{membershipId}`) and the service functions behind them |
| `./db` | `socialFollows`, the follow table with its own-row policies |
| `./ui` | `FollowButton`, `FollowCounts`, `FollowListRow`, `LockedPost`: props-only Seguir / Seguindo button, counts row and person row (09-10) and the "Siga para ver" card (09-11); no words, no route, no fetch, the host owns the optimistic state, the refresh and the actions |

The follow graph is member to member only (D-467). Counts are public and lists are private (D-468):
the RLS select policy shows a lane only the rows it is a party to, and another member's counts come
from the tenant-pinned definer `app.social_counts`, which returns two integers and never a row. There
is deliberately no route that takes a member id for a list; the lists read the session's own rows.

**The social-gate seam.** The kernel owns the names `app.social_enabled()` and
`app.social_visible_author_ids()` (`packages/core/db/social-gate.ts`, declared as stubs by a kernel
migration) and this module gives them their bodies in its `*_social_functions.sql`. The feed's
restrictive policy on `feed_posts`, its services, the media-hidden function, the notifications worker
and the dashboard ask THAT seam and never import this package, so a member post is readable only
while `social` is on and only by its author, the author's live followers, the tenant admin and the
system lanes (SOCIAL-06, D-483, D-484). The seam also has an explicit-user form,
`app.social_can_read_for(user, author)`, for the notifications worker, which runs as the system lane
and so cannot use the claims-based function: it answers about another user only to the system lane
and about the caller otherwise, so it is not a way to ask who follows whom (D-468).

**The member media settings.** The tenant's member limits (photos per post and size, whether video is
allowed and its seconds and size) live in `tenant_modules['social'].settings` and are read and written
only through the `super_admin`'s platform routes (`GET` and `PUT
/v1/platform/tenants/{id}/modules/social/settings`), validated by the schemas of `./contracts`
(D-474). The upload broker reads them through the kernel's member media policy seam, which the host
app fills while `social` is effective.

The member authoring permissions `feed.post.create` and `feed.post.manage` are composed for role
`member` by the app-tier registry (`permissionsFor` in `apps/api/src/modules/registry.ts`) while
`social` is effective, because naming a feed permission here would be a module-to-module edge
(MOD-02). `social.participate` is member-only by construction: the routes authorise by the
permission, the database by the member role.

## Events emitted

None. A follow and a member post notify nobody (D-476); the one notice of the phase, the author's
comment notice, is a notification source of the feed module.

## Events consumed

- Manifest subscriptions: none.
- Notification sources: none.
- Notification retractions: none.

## Flag key

`social` in `tenant_modules`. Requires `feed` (D-121): while `feed` is off the module contributes no
bootstrap entry and no permission. Off by default: not in `REAL_TENANT_DEFAULT_MODULES`, and no
migration backfills a row (a missing row reads as disabled, SOCIAL-01). The platform panel turns it on
only through a confirmation that points at the "Ativar a Rede social" go-live item of `docs/DEPLOY.md`
(D-478).

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

The list above is the imports of this package: `withTenantTx` (every read and write in the caller's
tenant lane), `paging` (the keyset cursor of the two private lists), `requireAuth`, `requireModule`
and `requirePermission` (the route guards), and the `social-gate` constants the follow policies and
the seam bodies share. The member media policy seam (`packages/core/server/media/member-policy.ts`)
is a kernel contract this package does not import: the host fills it.

## Navigation

- None. The module adds no tab and no top-bar entry (D-479); the Explorar chip lives in the web.

## Jobs

- None.
- Sweep functions: none.

## Reuse

The worked example of mounting a module lives in `packages/reuse-fixture` (it mounts the events
module; this module mounts the same way). A host app must provide: `setPermissionResolver` with the
kernel grants plus `defaultRolePermissions` (`member`: `social.participate`); the registry branch that
grants `feed.post.create` and `feed.post.manage` to role `member` while `social` and `feed` are both
enabled; and the member media policy, filled from this module's settings blob only while `social` is
effective. The module needs the `feed` module to be mounted, and the database needs the kernel's
gate seam migration before this module's functions. Its router chains BOTH `requireModule('feed')`
and `requireModule('social')`, because `requires` is enforced by the permission composition and the
bootstrap, not by `requireModule`.

## Known limits

Two limits of the audience gate are known, accepted by the user on 2026-10-20 and recorded here and in
the "Ativar a Rede social" item of `docs/DEPLOY.md`. They are ACCEPTED residuals, not fixed behavior.
The video gate itself is closed for removed posts: a followers-only video whose post was soft-deleted
(by a moderator or by its author) stays closed for the follower, the stranger and the author, and only
the admin keeps it while `social` is on.

- **Member photo variants and `original` are id capabilities (assumption A6).**
  - *What:* the width variants and the original of a member `post` photo are served by id to anyone in
    the tenant who holds the id, even after the post is removed or the viewer stops following the
    author. The audience gate is not applied to the image route.
  - *Why accepted:* a member outside the audience never learns a photo id, because the post, thread,
    list and Reels reads are gated and the id appears only in payloads the person was allowed to load;
    gating the variants would add a read to every image render and weaken CDN caching.
  - *What would reopen it:* a route or payload that exposes a member photo id outside the audience; a
    tenant requirement that revocation reach photos already seen; or moving member photos to
    per-request signed URLs or signed image transforms.
- **A playback token minted before a takedown stays valid until its own expiry (EP-60).**
  - *What:* the gate closes NEW mints only. A token the provider already signed for someone who could
    watch the video keeps working until it expires, and no token lives under the two-hour floor.
  - *Why accepted:* only a person who already saw the video holds such a token, and only the provider
    could revoke it.
  - *What would reopen it:* a requirement that a takedown end playback at once for viewers already
    playing, or a provider that can revoke a signed token.
