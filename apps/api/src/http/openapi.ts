import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import type { ZodError } from 'zod';

/**
 * The ONE validation-failure hook: every `@hono/zod-openapi` group answers a failed request
 * validation as 400 `VALIDATION_FAILED` with `details.issues[{ path, message }]`. Shared by the
 * tenant lane (`createOpenApiApp`) and the platform lane (`routes/platform/*`, which build their
 * own `OpenAPIHono<PlatformEnv>` because their environment carries `platformCtx`, not `ctx`).
 */
export const platformDefaultHook = (result: { success: boolean; error?: ZodError }): void => {
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_FAILED', {
      issues: (result.error?.issues ?? []).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
  }
};

/** Every tenant-lane route group is an `OpenAPIHono` whose validation failures become 400 `VALIDATION_FAILED`. */
export const createOpenApiApp = () => new OpenAPIHono<AppEnv>({ defaultHook: platformDefaultHook });
