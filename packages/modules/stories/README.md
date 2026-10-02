# @rede-social/module-stories

The tenant's 24-hour stories (STORY-01..05) and their highlights. The admin publishes an image or
video story that members see in the Início circle row until `expires_at`; expiry is a predicate, not
a job. Members mark stories seen, like them and comment on them (comments live in the feed's comment
table with a story triple). The author removes their own comment; a moderator with
`moderation.manage` removes anyone's, and that path writes the kernel moderation-log row in the same
transaction. Highlights keep chosen stories past their expiry, placed on Início or on a community.

## Contracts

| Subpath | What it holds |
|---|---|
| `./module` | `storiesModule`, the manifest |
| `./contracts` | Zod schemas and constants shared with the web app |
| `./server` | `storiesRoutes` and the main service functions |
| `./ui` | `StoriesStrip`, `StoryCircle`, `StoryMonogram`, `StoryViewer`, `StoryProgressBars`, `StoryHistoryRow`, `useStoryClock`, `HighlightSheet`, `HighlightEditSheet`, `HighlightManageList`, `HighlightMembershipList`, `HighlightStoryThumb`, `HighlightTitleStep` |
| `./db` | Drizzle tables `stories`, `storyViews`, `storyHighlights`, `storyHighlightItems` with their RLS policies |

Main contract names (`./contracts`): `publishStorySchema`, `storyQuerySchema`, `storySummarySchema`,
`storyPageSchema`, `markStoriesSeenSchema`, `storyLikeResultSchema`, `createStoryCommentSchema`,
`storyCommentsQuerySchema`, `storyCommentSchema`, `storyCommentPageSchema`,
`createStoryHighlightSchema`, `updateHighlightSchema`, `reorderHighlightsSchema`,
`highlightListQuerySchema`, `highlightListSchema`, `highlightSummarySchema`,
`highlightDetailSchema`, `highlightMembershipResultSchema`, `highlightCoverSchema`,
`storyHighlightIdsSchema`, the permission names `STORY_PERMISSIONS` (`stories.story.publish`,
`stories.story.manage`), the refusal vocabularies `STORY_ISSUES`, `STORY_COMMENT_ISSUES`,
`STORY_HIGHLIGHT_ISSUES`, and `STORIES_NOTIFICATION_KINDS`.

Main server names (`./server`): `storiesRoutes`, `listActiveStories`, `listOwnStories`, `getStory`,
`publishStory`, `deleteStory`. Comment, like, view and highlight handlers are reached through the
routes only.

## Events emitted

- `story.published`: `tenantId`, `storyId`, `authorUserId`, `mediaKind`, `expiresAt`
- `story.deleted`: `tenantId`, `storyId`, `authorUserId`, `actorUserId`
- `story.liked` and `story.unliked`: `tenantId`, `storyId`, `storyAuthorUserId`, `actorUserId`
- `story.commented`: `tenantId`, `storyId`, `commentId`, `storyAuthorUserId`, `actorUserId`
- `story.comment_deleted`: `tenantId`, `storyId`, `commentId`, `actorUserId`
- `highlight.created`: `tenantId`, `highlightId`, `communityId`, `actorUserId`
- `highlight.updated`: `tenantId`, `highlightId`, `actorUserId`
- `highlight.reordered`: `tenantId`, `communityId`, `actorUserId`
- `highlight.deleted`: `tenantId`, `highlightId`, `communityId`, `actorUserId`
- `story.highlighted` and `story.unhighlighted`: `tenantId`, `storyId`, `highlightId`, `actorUserId`

## Events consumed

- Manifest subscriptions (log the shape only): `story.published`, `story.deleted`, `story.liked`,
  `story.unliked`, `story.commented`, `story.comment_deleted`, `highlight.created`,
  `highlight.updated`, `highlight.reordered`, `highlight.deleted`, `story.highlighted`,
  `story.unhighlighted`.
- Notification sources (handed to the notifications module through the kernel seam):
  `story.published`, `story.commented`.
- Notification retractions: `story.deleted`, `story.comment_deleted`.

## Flag key

`stories` in `tenant_modules`. No `requires`.

## Kernel dependencies

- `@rede-social/core/db/rls`
- `@rede-social/core/db/schema`
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/events/bus`
- `@rede-social/core/server/http/api-error`
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

- No nav entry: the publish door is the strip's own circle, not a tab.
- Home slot at order 5: the stories circle row at the top of Início (`/inicio`).

## Jobs

- Jobs: none (expiry is the `expires_at` predicate).
- Sweep functions: none.

## Reuse

The worked example lives in `packages/reuse-fixture`. A host app must provide: a request id and a
per-request logger, `flushEventsAfterHandler`, an `onError` rendering `errorEnvelope`,
`setPermissionResolver` with the kernel grants plus `defaultRolePermissions` (`admin_tenant`:
`stories.story.publish`, `stories.story.manage`), the manifest's `events` subscribed on the bus, and
`.route('/v1/stories', storiesRoutes)`. The routes carry their own `requireAuth`,
`requireModule('stories')` and `requirePermission` chain. Story comments are rows of the feed's
comment table and highlights may name a community, so copying stories alone also needs those tables
(or the migrations adjusted).
