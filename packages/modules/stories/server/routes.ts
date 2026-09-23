import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { requireModule } from '@tria/core/server/modules/require-module';
import { requirePermission } from '@tria/core/server/rbac/permissions';
import {
  publishStorySchema,
  STORY_ISSUE_SET,
  storyPageSchema,
  storyQuerySchema,
  storySummarySchema,
} from '../contracts/index';
import { deleteStory, getStory, listActiveStories, listOwnStories, publishStory } from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/stories', storiesRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order extended by one, and it matters: `requireAuth` (401 without a session)
 * -> `requireModule` (404 when the tenant does not have stories — never 403, so a member cannot tell
 * "not allowed" from "not here") -> `requirePermission` on the write and admin routes (403).
 *
 * The write guards are PERMISSIONS, never `requireRole` (T-05-25): a role comparison would hard-code
 * V1's "only the admin publishes" into the route, and granting the permission to another role later
 * would then still need a code change. The literals are spelled out at each call site rather than
 * read from `STORY_PERMISSIONS`, because those strings are the one thing a reviewer greps for when
 * asking "what guards publishing a story?" — an indirection here is the kind that hides a change.
 */

/**
 * The refusals `publishStorySchema`'s refinement raises, lifted to `details.story`. The refinement
 * carries the MACHINE CODE as its issue `message` (there is nowhere else on a Zod issue to put one),
 * so the web switches on the same closed vocabulary the service uses when it refuses the same shape
 * — one code per rule, whichever layer caught it.
 */
const stories = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const story = result.error.issues
        .map((issue) => issue.message)
        .find((message) => STORY_ISSUE_SET.has(message));
      if (story) throw new ApiError(400, 'VALIDATION_FAILED', { story });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

stories.use('*', requireAuth, requireModule('stories'));

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: storyQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of the tenant's ACTIVE stories, newest first (D-78: one item per story, never per publisher). A story is absent because `expires_at` passed, because it was removed, or because its media asset is not `ready` — the row is never deleted for any of those reasons. A tenant with nothing live answers an empty `items` and a null `nextCursor`, never a 404.",
      content: { 'application/json': { schema: storyPageSchema } },
    },
  },
});

/**
 * D-84's admin history: the SAME page shape, with the expiry range and the readiness filter dropped,
 * so a `processing` or `rejected` story is visible to the person who published it (Pitfall 5).
 *
 * Declared BEFORE `/{storyId}` so the literal segment wins the match: `mine` is not a uuid, so the
 * param route would 400 on it rather than falling through.
 */
const listOwnRoute = createRoute({
  method: 'get',
  path: '/mine',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: { query: storyQuerySchema },
  responses: {
    200: {
      description:
        'Every story of the tenant, expired ones included, newest window first. `isActive` says which are still in the strip; `mediaStatus` / `mediaFailureReason` carry the Phase 3 processing and refusal state.',
      content: { 'application/json': { schema: storyPageSchema } },
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
  },
});

/** The story id every story-scoped route takes; a miss is a bare 404 (D-23). */
const storyIdParam = z.object({ storyId: z.uuid() });

const getStoryRoute = createRoute({
  method: 'get',
  path: '/{storyId}',
  request: { params: storyIdParam },
  responses: {
    200: {
      description:
        'One story, ACTIVE OR NOT — the viewer opens an expired story from the history and 05-08 pins one to a community. The strip is what filters; this read never does.',
      content: { 'application/json': { schema: storySummarySchema } },
    },
    404: {
      description:
        'No story with that id is visible to this tenant — unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const publishStoryRoute = createRoute({
  method: 'post',
  path: '/',
  // The literal, not `STORY_PERMISSIONS.publish` — see the chain note above.
  middleware: [requirePermission('stories.story.publish')] as const,
  request: {
    body: { content: { 'application/json': { schema: publishStorySchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The published story, in the same shape the list returns. `expires_at` is 24 h after `published_at` and comes from the COLUMN DEFAULT — no client value can lengthen it. A video whose asset is still `processing` publishes successfully and simply stays out of the strip until it is ready.',
      content: { 'application/json': { schema: storySummarySchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.story` carrying exactly one machine code: `media_required` (a story with no media has nothing to show) or `media_invalid` (an asset of this tenant whose purpose is not `story`, or whose kind does not match).',
    },
    403: { description: 'The caller does not hold `stories.story.publish` in this tenant' },
    404: {
      description:
        'The media asset is unknown, another tenant’s, or removed. One bare code, no details (T-05-26).',
    },
  },
});

const deleteStoryRoute = createRoute({
  method: 'delete',
  path: '/{storyId}',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: { params: storyIdParam },
  responses: {
    204: {
      description:
        'The story is SOFT-deleted: the row stays, so the likes and comments members left on it survive and Phase 8 moderation can still read it.',
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
    404: {
      description:
        'No story with that id is visible to this tenant — unknown, another tenant’s, or already removed. One bare code, no details (D-23).',
    },
  },
});

export const storiesRoutes = stories
  .openapi(listOwnRoute, async (c) =>
    c.json(await listOwnStories(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(listRoute, async (c) =>
    c.json(await listActiveStories(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(getStoryRoute, async (c) => {
    const { storyId } = c.req.valid('param');
    return c.json(await getStory(c.get('ctx'), storyId), 200);
  })
  .openapi(publishStoryRoute, async (c) =>
    c.json(await publishStory(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(deleteStoryRoute, async (c) => {
    const { storyId } = c.req.valid('param');
    await deleteStory(c.get('ctx'), storyId);
    return c.body(null, 204);
  });
