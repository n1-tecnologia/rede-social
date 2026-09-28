import type { ModuleKey } from '@rede-social/contracts';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../auth/context';
import { ApiError } from '../http/api-error';
import { moduleFlags } from './flags-cache';

/**
 * ROLE-06: a route of a module the tenant does not have answers **404 `MODULE_DISABLED`**, never 403 —
 * a member must not be able to tell "you may not" from "there is nothing here" (threat T-06-02).
 * A missing `tenant_modules` row and `enabled = false` are the same answer.
 *
 * Mount order is fixed and enforced: `requireAuth` -> `requireModule` -> `requireRole`. Without a
 * `ctx` (i.e. mounted before `requireAuth`) this throws 401, so an unauthenticated request to a
 * disabled module's route gets 401 and never learns the module's state.
 */
export const requireModule = (key: ModuleKey) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const ctx = c.get('ctx');
    if (!ctx) throw new ApiError(401, 'UNAUTHENTICATED');
    if (!(await moduleFlags.isEnabled(ctx, key))) throw new ApiError(404, 'MODULE_DISABLED');
    await next();
  });
