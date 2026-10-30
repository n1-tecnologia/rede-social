import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { createQuestion, listQuestions } from '@rede-social/core/server/profile-form/admin';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  adminQuestionListSchema,
  adminQuestionSchema,
  createQuestionBodySchema,
  PROFILE_FORM_ISSUE_SET,
} from '../contracts/index';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/profile_form', profileFormRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order: `requireAuth` (401) -> `requireModule('profile_form')` (404 `MODULE_DISABLED`
 * when the tenant does not have the module, a missing row included) -> `requirePermission('profile_form.manage')`
 * on every route (403; `admin_tenant` only by construction, see `module.ts`). The literal permission string stays
 * in each route definition: it is the one thing a reviewer greps for when asking "what guards this route?".
 *
 * The routes are thin: the kernel service (`@rede-social/core/server/profile-form/admin`) holds the writes, takes
 * the tenant ONLY from `ctx.tenantId`, and re-checks the live module row in its own transaction (the 30-second
 * flags cache is never the authority of a write).
 *
 * No route here ever returns an individual member's answer: only counts (D-593, PFORM-23).
 */

/**
 * A Zod issue whose `message` is a profile form machine code is lifted to `details.profileForm` (the payments
 * `defaultHook` precedent); anything else is the generic `details.issues` list.
 */
const profileForm = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const issue = result.error.issues
        .map((candidate) => candidate.message)
        .find((message) => PROFILE_FORM_ISSUE_SET.has(message));
      if (issue) throw new ApiError(400, 'VALIDATION_FAILED', { profileForm: issue });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((candidate) => ({
          path: candidate.path.map(String).join('.'),
          message: candidate.message,
        })),
      });
    }
  },
});

profileForm.use('*', requireAuth);

const listRoute = createRoute({
  method: 'get',
  path: '/questions',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  responses: {
    200: {
      description:
        'The ACTIVE questions in the order members see them (`position`), each with `answerCount` and, for every option, its own `answerCount`, plus `activeCount` and `limit` (30). Aggregates only: no individual answer is ever part of the answer. A tenant with no question answers `{ questions: [], activeCount: 0, limit: 30 }`.',
      content: { 'application/json': { schema: adminQuestionListSchema } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
  },
});

const createQuestionRoute = createRoute({
  method: 'post',
  path: '/questions',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: createQuestionBodySchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'Creates a question at the end of the list: `position` is the last active position plus one, `revision` is 1, every option gets a server-generated id. Title (1 to 120) and help text (at most 300) are trimmed and measured in code points; a choice type needs 2 to 20 distinct options. The body never carries an id, a position or a revision.',
      content: { 'application/json': { schema: adminQuestionSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.profileForm`: `required` (an empty or whitespace-only title or option), `too_long`, `invalid`, `out_of_range`, `limit_reached` (more than 20 options) or `other_not_allowed`. Nothing is written.',
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
    409: {
      description:
        '`CONFLICT` with `details.profileForm: limit_reached`: the tenant already has 30 active questions. Nothing is written.',
    },
  },
});

export const profileFormRoutes = profileForm
  .openapi(listRoute, async (c) => c.json(await listQuestions(c.get('ctx')), 200))
  .openapi(createQuestionRoute, async (c) =>
    c.json(await createQuestion(c.get('ctx'), c.req.valid('json')), 201),
  );
