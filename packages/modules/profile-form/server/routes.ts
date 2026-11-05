import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import {
  archiveQuestion,
  createQuestion,
  deleteQuestion,
  getImpact,
  getSummary,
  listArchived,
  listQuestions,
  reactivateQuestion,
  reorderQuestions,
  replaceQuestion,
  updateQuestion,
} from '@rede-social/core/server/profile-form/admin';
import { exportAnswers } from '@rede-social/core/server/profile-form/export';
import { createStep, deleteStep, renameStep } from '@rede-social/core/server/profile-form/steps';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  adminQuestionListSchema,
  adminQuestionSchema,
  adminStepSchema,
  archivedQuestionListSchema,
  archivedQuestionSchema,
  createQuestionBodySchema,
  createStepBodySchema,
  deleteStepResultSchema,
  impactQuerySchema,
  impactResultSchema,
  PROFILE_FORM_ISSUE_SET,
  profileFormSummarySchema,
  reorderBodySchema,
  replaceQuestionBodySchema,
  updateQuestionBodySchema,
  updateStepBodySchema,
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
 * No route here returns an individual member's answer EXCEPT `GET /export` (D-595): the one logged, no-store,
 * attachment response through which personal data leaves the app. Everything else returns counts (D-593, PFORM-23).
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
      // A reorder list that is not exactly the set of active ids (empty, a repeat, a non-uuid) is a mismatch
      // of the SET, the same answer as a list that names a missing or foreign id: 409, not a 400.
      if (issue === 'order_mismatch') {
        throw new ApiError(409, 'CONFLICT', { profileForm: 'order_mismatch' });
      }
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
        'The ACTIVE questions in the order members see them (`position`), each with its `stepId`, `answerCount` and, for every option, its own `answerCount`, plus `activeCount` and `limit` (30), and the tenant’s `steps` (`id`, `title`, `position`, `revision`, `questionCount` of ACTIVE questions; `position, created_at, id` order) with `stepLimit` (10). Aggregates only: no individual answer is ever part of the answer. A tenant with no question and no step answers `{ questions: [], activeCount: 0, limit: 30, steps: [], stepLimit: 10 }`; a read never creates the default step.',
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
        'Creates a question at the end of the named step (`stepId`; default: the last step, the default step being created when the form has none): the positions of the whole form are renumbered 1..n, `revision` is 1, every option gets a server-generated id. Title (1 to 120) and help text (at most 300) are trimmed and measured in code points; a choice type needs 2 to 20 distinct options. The body never carries an id, a position or a revision.',
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

const questionParamSchema = z.object({ id: z.uuid() });

const updateQuestionRoute = createRoute({
  method: 'patch',
  path: '/questions/{id}',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: {
    params: questionParamSchema,
    body: { content: { 'application/json': { schema: updateQuestionBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The edited question. `revision` (the one the caller read) is required and is the optimistic lock; every other key is optional and only the keys sent change. Title, help text and `required` are always free. Once the question has answers the TYPE, every option that has answers (not removable, not relabelled; options may be added and reordered), switching "Outro" off while an "Outro" answer exists, narrowing a number or date limit, and private-to-public are locked. A body that changes nothing answers 200 and does NOT bump the revision. `stepId` moves the question to the END of that step (the same step is a no-op) and bumps the revision once, with or without other edits.',
      content: { 'application/json': { schema: adminQuestionSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.profileForm` (`required`, `too_long`, `invalid`, `out_of_range`, `limit_reached`, `other_not_allowed`, `unknown_option`, `unknown_step`): the merged question is one a create would refuse. Nothing is written.',
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the question is unknown or another tenant’s. One bare `NOT_FOUND`, no details.',
    },
    409: {
      description:
        '`CONFLICT` with `details.profileForm`: `stale_revision` (the stored revision moved on), `already_archived` (read-only until reactivated) or the D-587 lock that was hit: `type_locked`, `option_locked`, `other_locked`, `visibility_locked`, `limits_locked`, or `condition_order` (a move that would put an opener at or after a question it opens). Nothing is written.',
    },
  },
});

const reorderRoute = createRoute({
  method: 'put',
  path: '/order',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: reorderBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'Stores the new order of the WHOLE form and answers the refreshed list. Two bodies for one release: the legacy `{ ids }` (the whole active list, first to last) is accepted only while the tenant has exactly ONE step, and the layout `{ steps: [{ id, questionIds }] }` names every step and every active question exactly once, in order, so a question can change step. The stored `position` is the order members see; it is renumbered 1..n in one statement. A question that changes step has its `revision` bumped, a step that changes place too; a pure reorder inside a step changes no revision. A list of one is accepted when the tenant has one active question.',
      content: { 'application/json': { schema: adminQuestionListSchema } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
    409: {
      description:
        '`CONFLICT` with `details.profileForm`: `order_mismatch` (the ids are not exactly the set of active questions and steps of this tenant: one missing, an extra one, a repeat, an archived one, another tenant’s, an empty list, or the legacy `{ ids }` body on a form with several steps; nothing changes and the body never says which) or `condition_order` with `questionId` and `openerId` (the order would put an opener at or after a question it opens, or a step above the step that holds an opener of one of its questions; nothing changes).',
    },
  },
});

const stepParamSchema = z.object({ id: z.uuid() });

const createStepRoute = createRoute({
  method: 'post',
  path: '/steps',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: createStepBodySchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'Creates an empty step at the END: `position` is the step count plus one, `revision` is 1. The title is trimmed and measured in code points (1 to 60). A tenant has at most 10 steps.',
      content: { 'application/json': { schema: adminStepSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.profileForm`: `required` (an empty or whitespace-only title), `too_long` (more than 60 characters) or `invalid`. Nothing is written.',
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
    409: {
      description:
        '`CONFLICT` with `details.profileForm: limit_reached`: the tenant already has 10 steps. Nothing is written.',
    },
  },
});

const renameStepRoute = createRoute({
  method: 'patch',
  path: '/steps/{id}',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: {
    params: stepParamSchema,
    body: { content: { 'application/json': { schema: updateStepBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The renamed step. `revision` (the one the caller read) is the optimistic lock and is bumped by one on success.',
      content: { 'application/json': { schema: adminStepSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.profileForm`: `required`, `too_long` or `invalid`. Nothing is written.',
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the step is unknown or another tenant’s. One bare `NOT_FOUND`, no details.',
    },
    409: {
      description:
        '`CONFLICT` with `details.profileForm: stale_revision`: the stored revision moved on. Nothing is written.',
    },
  },
});

const deleteStepRoute = createRoute({
  method: 'delete',
  path: '/steps/{id}',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: { params: stepParamSchema },
  responses: {
    200: {
      description:
        'Deletes a step that holds no ACTIVE question. Its ARCHIVED questions (and their answers) move to the first remaining step in the same transaction and the remaining steps are renumbered 1..n. No question and no answer is deleted.',
      content: { 'application/json': { schema: deleteStepResultSchema } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the step is unknown, already deleted or another tenant’s.',
    },
    409: {
      description:
        '`CONFLICT` with `details.profileForm`: `step_not_empty` (an ACTIVE question is inside) or `last_step` (the tenant’s only step). Nothing changes.',
    },
  },
});

const archivedListRoute = createRoute({
  method: 'get',
  path: '/archived',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  responses: {
    200: {
      description:
        'The ARCHIVED questions, newest archive first (then id), each with `archivedAt`, `required` and its exact `answerCount` (also per option). Archived questions keep every answer. A tenant with none answers `{ questions: [] }`. Aggregates only.',
      content: { 'application/json': { schema: archivedQuestionListSchema } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
  },
});

const archiveRoute = createRoute({
  method: 'post',
  path: '/questions/{id}/archive',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: { params: questionParamSchema },
  responses: {
    200: {
      description:
        'Archives the question: it leaves the form and stops being asked, every answer stays. Archiving the last required question releases every held member. Idempotent: an already archived question answers 200 with `archivedAt` unchanged.',
      content: { 'application/json': { schema: archivedQuestionSchema } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the question is unknown or another tenant’s. One bare `NOT_FOUND`.',
    },
  },
});

const reactivateRoute = createRoute({
  method: 'post',
  path: '/questions/{id}/reactivate',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: { params: questionParamSchema },
  responses: {
    200: {
      description:
        'Puts an archived question back at the END of the active list (`position` last + 1). A required one holds again every member who lacks its answer. Idempotent: an active question answers 200 unchanged.',
      content: { 'application/json': { schema: adminQuestionSchema } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the question is unknown or another tenant’s.',
    },
    409: {
      description:
        '`CONFLICT` with `details.profileForm: limit_reached`: the tenant already has 30 active questions. Nothing changes.',
    },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/questions/{id}',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: { params: questionParamSchema },
  responses: {
    200: {
      description: 'Deletes a question nobody ever answered. A second delete is the bare 404.',
      content: { 'application/json': { schema: z.object({ deleted: z.literal(true) }) } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise the question is unknown, already deleted or another tenant’s.',
    },
    409: {
      description:
        '`CONFLICT` with `details.profileForm: has_answers`: at least one answer exists, so the question can only be archived. Nothing is deleted.',
    },
  },
});

const replaceRoute = createRoute({
  method: 'post',
  path: '/questions/replace',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: {
    body: {
      content: { 'application/json': { schema: replaceQuestionBodySchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description:
        'Creates the new question and archives the one named by `replaces` in ONE transaction. The new question takes the old one’s position; the old one keeps its answers. Allowed at 30 active questions (the count does not grow).',
      content: { 'application/json': { schema: adminQuestionSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.profileForm`: the new question is one a create would refuse.',
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise `replaces` is unknown or another tenant’s.',
    },
    409: {
      description:
        '`CONFLICT` with `details.profileForm: already_archived`: the question to replace is not active. Nothing is created.',
    },
  },
});

const summaryRoute = createRoute({
  method: 'get',
  path: '/summary',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  responses: {
    200: {
      description:
        '`{ total, complete, hasRequired }` over the tenant’s active `member` memberships (staff, blocked and invited are in no number): `complete` is the members with an answer to every active required question. Counts only.',
      content: { 'application/json': { schema: profileFormSummarySchema } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
  },
});

const impactRoute = createRoute({
  method: 'get',
  path: '/impact',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: { query: impactQuerySchema },
  responses: {
    200: {
      description:
        '`{ members }`: how many members a change (`create_required`, `make_required`, `reactivate`, `replace`) would ask to answer if applied now. `make_required` and `reactivate` need `questionId`. A count only.',
      content: { 'application/json': { schema: impactResultSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: an unknown `change`, or a `questionId` missing where it is needed.',
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise `questionId` is unknown or another tenant’s.',
    },
  },
});

const exportRoute = createRoute({
  method: 'get',
  path: '/export',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  responses: {
    200: {
      description:
        'The answers of every `member`-role membership (active and blocked; not invited, staff or deleted) as a CSV attachment `respostas-perfil-AAAA-MM-DD.csv` (date in the tenant time zone), `Cache-Control: no-store`: UTF-8 with a byte-order mark, `;` delimiter, CRLF line ends, one row per member (name, e-mail, then one column per question: active ones in the admin order, then archived ones by `archived_at`), numbers with a comma decimal. Every cell that would start a spreadsheet formula (`=`, `+`, `-`, `@`, tab, CR, LF, full-width forms) is prefixed with a quote, header cells included. EXACTLY ONE `profile_form_exported` moderation-log row is committed BEFORE the first byte. Streamed in pages of 500 members.',
      content: { 'text/csv': { schema: z.string() } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
  },
});

export const profileFormRoutes = profileForm
  .openapi(listRoute, async (c) => c.json(await listQuestions(c.get('ctx')), 200))
  .openapi(createQuestionRoute, async (c) =>
    c.json(await createQuestion(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(updateQuestionRoute, async (c) =>
    c.json(await updateQuestion(c.get('ctx'), c.req.valid('param').id, c.req.valid('json')), 200),
  )
  .openapi(reorderRoute, async (c) =>
    c.json(await reorderQuestions(c.get('ctx'), c.req.valid('json')), 200),
  )
  .openapi(createStepRoute, async (c) =>
    c.json(await createStep(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(renameStepRoute, async (c) =>
    c.json(await renameStep(c.get('ctx'), c.req.valid('param').id, c.req.valid('json')), 200),
  )
  .openapi(deleteStepRoute, async (c) =>
    c.json(await deleteStep(c.get('ctx'), c.req.valid('param').id), 200),
  )
  .openapi(archivedListRoute, async (c) => c.json(await listArchived(c.get('ctx')), 200))
  .openapi(archiveRoute, async (c) =>
    c.json(await archiveQuestion(c.get('ctx'), c.req.valid('param').id), 200),
  )
  .openapi(reactivateRoute, async (c) =>
    c.json(await reactivateQuestion(c.get('ctx'), c.req.valid('param').id), 200),
  )
  .openapi(deleteRoute, async (c) =>
    c.json(await deleteQuestion(c.get('ctx'), c.req.valid('param').id), 200),
  )
  .openapi(replaceRoute, async (c) =>
    c.json(await replaceQuestion(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(summaryRoute, async (c) => c.json(await getSummary(c.get('ctx')), 200))
  .openapi(impactRoute, async (c) =>
    c.json(await getImpact(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(exportRoute, async (c) => {
    // The audit row is awaited INSIDE `exportAnswers`, before the stream (and so the response) exists.
    const { fileName, body } = await exportAnswers(c.get('ctx'));
    return c.body(body, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    });
  });
