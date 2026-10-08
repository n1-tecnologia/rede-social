# @rede-social/module-feed

The tenant's feed (FEED-01..08): posts with text, images, video and attachments, link previews
unfurled by a job, likes, two-level comments and comment likes, keyset paging for the home feed and
for a community's feed. Who may post is a tenant setting (`postingPolicy`), not a route rule. A
comment can be removed by its author or, with `moderation.manage`, by a moderator; the moderator
path writes its kernel moderation-log row inside the same transaction as the removal.

## Contracts

| Subpath | What it holds |
|---|---|
| `./module` | `feedModule`, the manifest |
| `./contracts` | Zod schemas and constants shared with the web app |
| `./server` | `feedRoutes`, the service functions, `feedUnfurlJob`, `feedNotificationSources` |
| `./ui` | `PostCard`, `FeedList`, `PostHeader`, `PostMedia`, `PostCaption`, `PostActions`, `PostMenu`, `LinkPreviewCard`, `LikeButton`, `CommentSheet`, `CommentsList`, `CommentItem`, `CommentInput`, `ComposeFab` and their skeletons |
| `./db` | Drizzle tables `feedPosts`, `feedPostMedia`, `feedComments`, `feedLikes`, `feedLinkPreviews` with their RLS policies |

Main contract names (`./contracts`): `feedQuerySchema`, `feedPostSchema`, `feedPageSchema`,
`createPostSchema`, `updatePostSchema`, `postMediaSchema`, `postCommunitySchema`,
`linkPreviewSchema`, `postLinkPreviewPatchSchema`, `videoCommunitiesSchema`, `feedSettingsSchema`,
`commentsQuerySchema`, `repliesQuerySchema`, `createCommentSchema`, `commentSchema`,
`commentPageSchema`, `commentThreadSchema`, `likeResultSchema`, the permission names
`FEED_PERMISSIONS` (`feed.post.create`, `feed.post.manage`), `FEED_POSTING_POLICIES`,
`FEED_UNFURL_QUEUE` and `FEED_NOTIFICATION_KINDS`.

Main server names (`./server`): `feedRoutes`, `listFeed`, `listCommunityFeed`, `getPost`,
`createPost`, `updatePost`, `softDeletePost`, `setPostLinkPreview`, `likePost`, `unlikePost`,
`listComments`, `listReplies`, `createComment`, `deleteComment`, `likeComment`, `unlikeComment`,
`feedUnfurlJob`, `feedNotificationSources`.

## Events emitted

- `post.published`: `tenantId`, `postId`, `authorUserId`, `communityId`, `hasMedia`, `occurredAt`
- `post.edited`: `tenantId`, `postId`, `authorUserId`, `actorUserId`, `occurredAt`
- `post.deleted`: `tenantId`, `postId`, `authorUserId`, `actorUserId`, `occurredAt`
- `post.liked` and `post.unliked`: `tenantId`, `postId`, `postAuthorUserId`, `actorUserId`
- `comment.created`: `tenantId`, `postId`, `commentId`, `parentCommentId`, `postAuthorUserId`,
  `parentAuthorUserId`, `actorUserId`
- `comment.deleted`: `tenantId`, `commentId`, `actorUserId`
- `comment.liked` and `comment.unliked`: `tenantId`, `commentId`, `commentAuthorUserId`,
  `actorUserId`

## Events consumed

- Manifest subscriptions (log the shape only): `post.published`, `post.edited`, `post.deleted`,
  `post.liked`, `post.unliked`, `comment.created`, `comment.deleted`, `comment.liked`,
  `comment.unliked`.
- Notification sources (handed to the notifications module through the kernel seam):
  `post.published`, `comment.created`, `comment.liked`.
- Notification retractions: `post.deleted`, `comment.deleted`.

## Flag key

`feed` in `tenant_modules`. No `requires`. Settings: `postingPolicy` (`admins_only` by default,
`members` grants `feed.post.create` to members), read through `feedSettingsSchema`.

## Kernel dependencies

- `@rede-social/core/db/community-gate` (08.2: `LOCKED_COMMUNITY_IDS`, the kernel gate seam behind
  the restrictive `feed_posts_community_gate` policy and the community page's sample-only read)
- `@rede-social/core/db/rls`
- `@rede-social/core/db/schema`
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/events/bus`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/jobs/boss`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/moderation/log`
- `@rede-social/core/server/modules/flags-cache`
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/notifications/source`
- `@rede-social/core/server/paging`
- `@rede-social/core/server/rbac/permissions`
- `@rede-social/core/ui`

## Navigation

- No nav entry: the feed is the Início page itself (href `/inicio`).
- Home slot at order 10: the feed list, after the stories row (5) and the next-event card (7).

## Jobs

- `feed.unfurl-link` (`feedUnfurlJob`): runs in the worker, fetches the link-preview metadata with
  the SSRF-guarded client and fills the `feed_link_previews` row `createPost` created.
- Sweep functions: none.

## Reuse

The worked example lives in `packages/reuse-fixture`. A host app must provide: a request id and a
per-request logger, `flushEventsAfterHandler`, an `onError` rendering `errorEnvelope`,
`setPermissionResolver` with the kernel grants plus `defaultRolePermissions` (`admin_tenant`:
`feed.post.create`, `feed.post.manage`) and the `postingPolicy` branch, the manifest's `events`
subscribed on the bus, its job names registered with `registerJobQueues`, and
`.route('/v1/feed', feedRoutes)`. The routes carry their own `requireAuth`, `requireModule('feed')`
and `requirePermission` chain. Unlike events, the feed's tables have hand-written foreign keys into
the communities and stories tables, so copying it alone also needs those tables (or the migrations
adjusted).
