import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { requireModule } from '@tria/core/server/modules/require-module';
import { requireRole } from '@tria/core/server/rbac/require-role';
import { createExampleItemSchema, exampleItemSchema, exampleItemsSchema } from '../contracts/index';
import { createItem, getItem, listItems } from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/example', exampleRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order and it matters: `requireAuth` (401 without a session) ->
 * `requireModule` (404 when the tenant does not have the module — never 403, so a member cannot
 * tell "not allowed" from "not here") -> `requireRole` on the write route only (403).
 */
const example = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

example.use('*', requireAuth, requireModule('example'));

const listRoute = createRoute({
  method: 'get',
  path: '/items',
  responses: {
    200: {
      description: "The tenant's example items, newest first",
      content: { 'application/json': { schema: exampleItemsSchema } },
    },
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/items/{id}',
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: 'One example item',
      content: { 'application/json': { schema: exampleItemSchema } },
    },
    404: { description: 'No item with that id is visible to this tenant' },
  },
});

const createItemRoute = createRoute({
  method: 'post',
  path: '/items',
  // V1: only the tenant's admin writes (ROLE-06). V2 member posting is this line plus a flag.
  middleware: [requireRole('admin_tenant')] as const,
  request: {
    body: { content: { 'application/json': { schema: createExampleItemSchema } }, required: true },
  },
  responses: {
    201: {
      description: 'The created item',
      content: { 'application/json': { schema: exampleItemSchema } },
    },
    403: { description: 'Members may not create items' },
  },
});

export const exampleRoutes = example
  .openapi(listRoute, async (c) => c.json({ items: await listItems(c.get('ctx')) }, 200))
  .openapi(getRoute, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await getItem(c.get('ctx'), id), 200);
  })
  .openapi(createItemRoute, async (c) => {
    const item = await createItem(c.get('ctx'), c.req.valid('json'));
    return c.json(item, 201);
  });
