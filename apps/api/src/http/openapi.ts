import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { ApiError } from '@tria/core/server/http/api-error';

/** Every route group is an `OpenAPIHono` whose validation failures become 400 `VALIDATION_FAILED`. */
export const createOpenApiApp = () =>
  new OpenAPIHono<AppEnv>({
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
