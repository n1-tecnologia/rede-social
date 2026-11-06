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
import {
  archiveBranch,
  createBranch,
  reactivateBranch,
  undoBranch,
  updateBranch,
} from '@rede-social/core/server/profile-form/branches';
import { exportAnswers } from '@rede-social/core/server/profile-form/export';
import { createStep, deleteStep, renameStep } from '@rede-social/core/server/profile-form/steps';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  adminBranchSchema,
  adminQuestionListSchema,
  adminQuestionSchema,
  adminStepSchema,
  archivedQuestionListSchema,
  archivedQuestionSchema,
  createBranchBodySchema,
  createQuestionBodySchema,
  createStepBodySchema,
  deleteStepResultSchema,
  impactQuerySchema,
  impactResultSchema,
  PROFILE_FORM_ISSUE_SET,
  profileFormSummarySchema,
  reorderBodySchema,
  replaceQuestionBodySchema,
  undoBranchResultSchema,
  updateBranchBodySchema,
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
        'Creates a question at the end of the named step (`stepId`; default: the last step, the default step being created when the form has none): the positions of the whole form are renumbered 1..n, `revision` is 1, every option gets a server-generated id. Title (1 to 120) and help text (at most 300) are trimmed and measured in code points; a choice type needs 2 to 20 distinct options. The body never carries an id, a position or a revision. `condition` (`{ questionId, values }`, or null/absent for an always-shown question) is accepted only through the condition rules: the opener must be an ACTIVE `dropdown`, `single_choice`, `multiple_choice` or `yes_no` question of this tenant that sits BEFORE the new one and has no condition itself, the values are option ids of the opener (`true`/`false` for yes/no; never "Outro"), and the new question must not be an opener.',
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
        '`CONFLICT` with `details.profileForm`: `limit_reached` (the tenant already has 30 active questions), `condition_invalid` (the opener is of another tenant, missing, archived, of a type that cannot open, itself conditional, the new question is an opener, a value is not an option of the opener, or the values are empty or repeated) or `condition_order` with `openerId` (the opener would sit at or after the new question). A foreign and a missing opener answer the same. Nothing is written.',
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
        'The edited question. `revision` (the one the caller read) is required and is the optimistic lock; every other key is optional and only the keys sent change. Title, help text and `required` are always free. Once the question has answers the TYPE, every option that has answers (not removable, not relabelled; options may be added and reordered), switching "Outro" off while an "Outro" answer exists, narrowing a number or date limit, and private-to-public are locked. `condition` follows the same rules as a create; `null` removes it (always allowed, no answer is discarded) and a question that already has answers cannot GAIN or CHANGE a condition. An opener cannot change type or lose an option an active dependent names. A body that changes nothing answers 200 and does NOT bump the revision. `stepId` moves the question to the END of that step (the same step is a no-op) and bumps the revision once, with or without other edits.',
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
        '`CONFLICT` with `details.profileForm`: `stale_revision` (the stored revision moved on), `already_archived` (read-only until reactivated) or the D-587 lock that was hit: `type_locked`, `option_locked`, `other_locked`, `visibility_locked`, `limits_locked`, `condition_locked` (the question has answers), `condition_invalid`, `condition_order` (an opener at or after a question it opens, with `openerId`), or `has_dependents` with `details.dependents` (`[{ id, title }]`: the active questions whose condition names this opener, only those naming a removed option for an option removal). Nothing is written.',
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

const createBranchRoute = createRoute({
  method: 'post',
  path: '/branches',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: createBranchBodySchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'Creates an EMPTY branch from its opener (`openerQuestionId`) and the answers that open it (`values`, 1 to 20 unique tokens: option ids of a choice opener, `true` / `false` of a yes/no one; ANY one opens the branch). The builder creates the branch first and fills it afterwards, so the branch holds no question: `questionCount` 0, `answerCount` 0, `revision` 1, `archivedAt` null. The optional `name` is trimmed, measured in code points (at most 60) and kept on the admin side only. The new branch reads after the opener’s other branches (`created_at, id`). The opener must be an ACTIVE `dropdown`, `single_choice`, `multiple_choice` or `yes_no` question of this tenant; the branch may hang inside another branch up to three levels. A tenant has at most 15 active branches.',
      content: { 'application/json': { schema: adminBranchSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.profileForm`: `condition_invalid` (an opener that is not a uuid, empty, repeated or more than 20 values), `too_long` (a name over 60 characters) or `invalid` (a control character in the name). Nothing is written.',
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: '`MODULE_DISABLED` when the module is off for this tenant' },
    409: {
      description:
        '`CONFLICT` with `details.profileForm`: `condition_invalid` (the opener is of another tenant, missing, archived, of a type that cannot open, or a value is not one of its tokens; a foreign and a missing opener answer the same), `branch_depth` (the branch would be a fourth level) or `branch_limit` (the tenant already has 15 active branches). Nothing is written.',
    },
  },
});

const branchParamSchema = z.object({ id: z.uuid() });

const NOT_FOUND_BRANCH =
  '`MODULE_DISABLED` when the module is off; otherwise the branch is unknown or another tenant’s. One bare `NOT_FOUND`, no details.';

const updateBranchRoute = createRoute({
  method: 'patch',
  path: '/branches/{id}',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: {
    params: branchParamSchema,
    body: { content: { 'application/json': { schema: updateBranchBodySchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The edited branch. `revision` (the one the caller read) is required and is the optimistic lock; every other key is optional and only the keys sent change: `openerQuestionId`, `values` (the same set in another order is no change) and `name` (`null` clears it; trimmed, at most 60 code points). A branch that has an answered question, active or archived, cannot change its opener or its opening set; a name change always passes. A body that changes nothing answers 200 and does NOT bump the revision; otherwise `revision` and `updated_at` move.',
      content: { 'application/json': { schema: adminBranchSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.profileForm`: `condition_invalid` (values empty, repeated or more than 20, an opener that is not a uuid), `too_long` or `invalid` (the name), or a missing `revision`. Nothing is written.',
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: NOT_FOUND_BRANCH },
    409: {
      description:
        '`CONFLICT` with `details.profileForm`: `stale_revision`, `already_archived` (read-only until it comes back), `condition_locked` (the branch has an answered question), `condition_invalid`, `condition_order` (the new opener at or after a question of the branch, with `openerId` and `questionId`), `branch_depth` or `public_under_private` (with `titles`). Nothing is written.',
    },
  },
});

const undoBranchRoute = createRoute({
  method: 'post',
  path: '/branches/{id}/undo',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: { params: branchParamSchema },
  responses: {
    200: {
      description:
        'Undoes the branch ("Desfazer ramo"): every question of it, active and archived, leaves the branch (`branch_id` null) and the branch row is deleted, in one transaction. The questions stay in the form where they are and become visible to every member; a branch that hangs on an opener inside it keeps working; no answer is touched. Undoing an empty branch just removes it.',
      content: { 'application/json': { schema: undoBranchResultSchema } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: NOT_FOUND_BRANCH },
  },
});

const archiveBranchRoute = createRoute({
  method: 'post',
  path: '/branches/{id}/archive',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: { params: branchParamSchema },
  responses: {
    200: {
      description:
        'Archives the branch AS A BLOCK: the branch, every branch that hangs on an opener inside it and every question of that subtree get the same `archived_at`, and the form is renumbered 1..n. Every answer stays. Idempotent: an archived branch answers 200 with `archivedAt` unchanged.',
      content: { 'application/json': { schema: adminBranchSchema } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: NOT_FOUND_BRANCH },
    409: {
      description:
        '`CONFLICT` with `details.profileForm: has_dependents` and `details.dependents` (`[{ id, title }]`, the OPENERS inside the block that open another active branch with answers). Nothing changes.',
    },
  },
});

const reactivateBranchRoute = createRoute({
  method: 'post',
  path: '/branches/{id}/reactivate',
  middleware: [requireModule('profile_form'), requirePermission('profile_form.manage')] as const,
  request: { params: branchParamSchema },
  responses: {
    200: {
      description:
        'Reactivates the branch AS A BLOCK: restores exactly the branches and questions archived with the branch’s own stamp (a question archived alone earlier stays archived), `listed_at` now, back at the end of their own step in tree order. Idempotent: an active branch answers 200 unchanged.',
      content: { 'application/json': { schema: adminBranchSchema } },
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: { description: NOT_FOUND_BRANCH },
    409: {
      description:
        '`CONFLICT` with `details.profileForm`: `condition_invalid` with `openerId` (the opener is archived: reactivate it first), `branch_archived` with `branchId` (the opener sits in an archived branch), `limit_reached` (past 30 active questions), `branch_limit` (past 15 active branches), `condition_order` or `public_under_private`. Nothing changes.',
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
    409: {
      description:
        '`CONFLICT` with `details.profileForm: has_dependents` and `details.dependents` (`[{ id, title }]`, the ACTIVE questions whose condition names this one): an opener with active dependents is not archived. Nothing changes.',
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
        '`CONFLICT` with `details.profileForm`: `limit_reached` (the tenant already has 30 active questions), or, for a conditional question, `condition_invalid` / `condition_order` with `openerId` (its opener is archived, no longer eligible, or sits after it). Nothing changes.',
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
        '`CONFLICT` with `details.profileForm`: `has_answers` (at least one answer exists, so the question can only be archived) or `has_dependents` with `details.dependents` (an opener with active dependents). Nothing is deleted.',
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
        '`CONFLICT` with `details.profileForm`: `already_archived` (the question to replace is not active), `has_dependents` with `details.dependents` (replacing archives the old question, which an opener with active dependents refuses), or `condition_invalid` / `condition_order` for the new question’s own `condition`. Nothing is created.',
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
        '`{ total, complete, hasRequired }` over the tenant’s active `member` memberships (staff, blocked and invited are in no number): `complete` is the members who owe no VISIBLE required question (a conditional required question is owed only by the members whose answer to its opener opens it). Counts only.',
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
        '`{ members }`: how many members a change (`create_required`, `make_required`, `reactivate`, `replace`, `remove_condition`) would ask to answer if applied now, counting only the members who SEE the question. `make_required`, `reactivate` and `remove_condition` need `questionId`. `create_required` and `replace` take the optional `conditionQuestionId` and `conditionValues` (comma-separated tokens) of the question to be created, and then count only the members whose answer to that opener overlaps the values. `remove_condition` counts the members who do not see the question today and lack an answer to it (0 for an unconditional, optional or archived question). A count only.',
      content: { 'application/json': { schema: impactResultSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED`: an unknown `change`, a `questionId` missing where it is needed, or only one of `conditionQuestionId` and `conditionValues`.',
    },
    403: { description: 'The caller does not hold `profile_form.manage` in this tenant' },
    404: {
      description:
        '`MODULE_DISABLED` when the module is off; otherwise `questionId` or `conditionQuestionId` is unknown, archived or another tenant’s (one bare `NOT_FOUND`).',
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
  .openapi(createBranchRoute, async (c) =>
    c.json(await createBranch(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(updateBranchRoute, async (c) =>
    c.json(await updateBranch(c.get('ctx'), c.req.valid('param').id, c.req.valid('json')), 200),
  )
  .openapi(undoBranchRoute, async (c) =>
    c.json(await undoBranch(c.get('ctx'), c.req.valid('param').id), 200),
  )
  .openapi(archiveBranchRoute, async (c) =>
    c.json(await archiveBranch(c.get('ctx'), c.req.valid('param').id), 200),
  )
  .openapi(reactivateBranchRoute, async (c) =>
    c.json(await reactivateBranch(c.get('ctx'), c.req.valid('param').id), 200),
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
