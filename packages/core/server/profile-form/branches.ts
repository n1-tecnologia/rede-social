import type { AdminBranch, CreateBranchBody } from '@rede-social/contracts/profile-form';
import { sql } from 'drizzle-orm';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import { ApiError } from '../http/api-error';
import {
  type AdminCtx,
  adminLock,
  attempt,
  hasSqlState,
  requireModuleOn,
  textArray,
} from './admin';
import {
  type BranchCheck,
  type BranchRuleBranch,
  type BranchRuleQuestion,
  checkBranch,
} from './branch-rules';
import { readLayout } from './layout-store';
import { guardIssueOf } from './lock-rules';

/**
 * The branches of the profile form, the admin's write side (Phase 12.2 plan 08, D-640, D-641, D-642, D-644,
 * D-646, D-651, D-653; PFORM-43, PFORM-44, PFORM-45, PFORM-48, PFORM-49). Pure tenant lane, like `steps.ts`:
 * every statement runs in the caller's transaction under the `admin_tenant` policies of
 * `profile_form_branches`, with an explicit `tenant_id` predicate beside them (layer 2). The routes pass only
 * `ctx` and the validated body; the tenant comes from `ctx.tenantId`, never from the body or a path.
 *
 * EVERY WRITE starts the way every builder write starts: `adminLock` (the per-tenant advisory lock, so two
 * admins' writes, the branch count and the depth never interleave, T-12.2-07), then the LIVE module check,
 * then the locked reads in the canonical order (steps, the questions, then the branches `created_at, id`),
 * then the pure rule of `branch-rules.ts`, then the write. The SQL guards (PF006, PF008, PF009) are the
 * backstop of a race: a SQLSTATE one of them raises maps through `guardIssueOf` to the SAME coded 409 the
 * pure rule answers, never a 500.
 *
 * THE NAME STAYS ON THE ADMIN SIDE (D-642, T-12.2-03): `name` is selected only here, for the admin routes.
 * NOTHING HERE READS AN ANSWER VALUE: the answers table is read for `count(*)` and for the ids of the branches
 * that hold at least one, nothing else (D-593). NOTHING HERE LOGS a name or a title.
 */

type BranchRow = {
  id: string;
  opener_question_id: string;
  open_values: string[];
  name: string | null;
  revision: number | string;
  archived_at: string | Date | null;
  question_count: number | string;
  answer_count: number | string;
};

/** One stored branch as the builder reads it: counts are aggregates, no answer is read. */
export const toAdminBranch = (row: BranchRow): AdminBranch => ({
  id: row.id,
  openerQuestionId: row.opener_question_id,
  values: [...row.open_values],
  name: row.name,
  revision: Number(row.revision),
  archivedAt: row.archived_at === null ? null : new Date(row.archived_at).toISOString(),
  questionCount: Number(row.question_count),
  answerCount: Number(row.answer_count),
});

/**
 * Every branch of the tenant, active and archived, in the canonical order `created_at, id`. `questionCount` is
 * the number of ACTIVE questions of an active branch and of ALL the questions of an archived one (the block
 * that would come back); `answerCount` is the number of answers to the branch's questions, active and
 * archived. Both are aggregates: no answer value is selected (D-593).
 */
export async function readBranches(tx: Tx, tenantId: string): Promise<AdminBranch[]> {
  const rows = await tx.execute<BranchRow>(sql`
    select b.id::text as id, b.opener_question_id::text as opener_question_id, b.open_values, b.name,
           b.revision, b.archived_at,
           (select count(*)::int
              from public.profile_form_questions q
             where q.tenant_id = b.tenant_id and q.branch_id = b.id
               and (b.archived_at is not null or q.archived_at is null)) as question_count,
           (select count(*)::int
              from public.profile_form_answers a
              join public.profile_form_questions q
                on q.tenant_id = a.tenant_id and q.id = a.question_id
             where a.tenant_id = b.tenant_id and q.branch_id = b.id) as answer_count
      from public.profile_form_branches b
     where b.tenant_id = ${tenantId}::uuid
     order by b.created_at, b.id`);
  return rows.map(toAdminBranch);
}

/** One branch of the tenant as the builder reads it, or null: another tenant's id is the same null. */
export async function readBranch(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<AdminBranch | null> {
  return (await readBranches(tx, tenantId)).find((branch) => branch.id === id) ?? null;
}

type FactQuestionRow = {
  id: string;
  type: string;
  title: string;
  archived: boolean;
  show_on_profile: boolean;
  options: { id: string }[];
  branch_id: string | null;
};

type FactBranchRow = {
  id: string;
  opener_question_id: string;
  open_values: string[];
  name: string | null;
  archived: boolean;
};

export type RuleFacts = { questions: BranchRuleQuestion[]; branches: BranchRuleBranch[] };

/**
 * The facts the pure rules judge over: EVERY question of the tenant (active and archived, in the canonical
 * order `position, created_at, id`, not locked: the caller holds `adminLock` and, where a write can change
 * places, took the active rows with `readLayout(tx, tenantId, true)` first) and EVERY branch (`created_at, id`,
 * `for update` when asked, so the branch rows are the last locks of the canonical order).
 */
export async function readRuleFacts(
  tx: Tx,
  tenantId: string,
  lockBranches: boolean,
): Promise<RuleFacts> {
  const questions = await tx.execute<FactQuestionRow>(sql`
    select q.id::text as id, q.type, q.title, q.archived_at is not null as archived,
           q.show_on_profile, q.options, q.branch_id::text as branch_id
      from public.profile_form_questions q
     where q.tenant_id = ${tenantId}::uuid
     order by q."position", q.created_at, q.id`);
  const branches = await tx.execute<FactBranchRow>(
    lockBranches
      ? sql`
        select b.id::text as id, b.opener_question_id::text as opener_question_id, b.open_values, b.name,
               b.archived_at is not null as archived
          from public.profile_form_branches b
         where b.tenant_id = ${tenantId}::uuid
         order by b.created_at, b.id
           for update`
      : sql`
        select b.id::text as id, b.opener_question_id::text as opener_question_id, b.open_values, b.name,
               b.archived_at is not null as archived
          from public.profile_form_branches b
         where b.tenant_id = ${tenantId}::uuid
         order by b.created_at, b.id`,
  );
  return {
    questions: questions.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      archived: row.archived,
      showOnProfile: row.show_on_profile,
      options: row.options.map((option) => ({ id: option.id })),
      branchId: row.branch_id,
    })),
    branches: branches.map((row) => ({
      id: row.id,
      openerQuestionId: row.opener_question_id,
      values: [...row.open_values],
      archived: row.archived,
      name: row.name,
    })),
  };
}

/**
 * The pure rule's refusal as the coded 409: the issue in `details.profileForm`, with the entity it names
 * (`questionId`, `openerId`, `branchId`, the `titles` of a privacy refusal, the `dependents` of a
 * `has_dependents`). Nothing is written, the caller's transaction rolls back.
 */
export function refuseBranch(check: BranchCheck): void {
  if (check.ok) return;
  throw new ApiError(409, 'CONFLICT', {
    profileForm: check.issue,
    ...(check.questionId !== undefined ? { questionId: check.questionId } : {}),
    ...(check.openerId !== undefined ? { openerId: check.openerId } : {}),
    ...(check.branchId !== undefined ? { branchId: check.branchId } : {}),
    ...(check.titles !== undefined ? { titles: check.titles } : {}),
    ...(check.dependents !== undefined ? { dependents: check.dependents } : {}),
  });
}

/**
 * A write the SQL guards can still refuse in a race that got past the service (PF006, PF008, PF009, PF010) or a
 * key that no longer holds (23503, a foreign or vanished opener): the same coded 409 as the pure rules, never a
 * 500. Runs in a SAVEPOINT so the transaction stays usable while the error is classified.
 */
export async function guardedBranchWrite<T>(tx: Tx, run: () => Promise<T>): Promise<T> {
  const out = await attempt(tx, run);
  if ('value' in out) return out.value;
  const issue = guardIssueOf(out.error);
  if (issue === 'has_dependents') {
    throw new ApiError(409, 'CONFLICT', { profileForm: 'has_dependents', dependents: [] });
  }
  if (issue !== null) throw new ApiError(409, 'CONFLICT', { profileForm: issue });
  if (hasSqlState(out.error, '23503')) {
    throw new ApiError(409, 'CONFLICT', { profileForm: 'condition_invalid' });
  }
  throw out.error;
}

/**
 * `POST /v1/profile_form/branches` (PFORM-43, D-640, D-651): a new, EMPTY branch from its opener (the builder
 * creates the branch first and then fills it, UI-D-671). The body is already validated (1 to 20 unique values,
 * the name trimmed and at most 60 code points, `null` when blank). The server decides the rest: `revision` 1,
 * no question, `created_at` the instant the lock was won, so the new branch reads AFTER the opener's others.
 *
 *   - 404 `MODULE_DISABLED` when the module is off (live read);
 *   - 409 `condition_invalid` for an opener that is not an ACTIVE question of this tenant (a foreign and a
 *     missing id answer the same, T-12.2-01), of a type that cannot open, or values that are not its tokens;
 *   - 409 `branch_depth` for a third level deeper than `PROFILE_FORM_LIMITS.branchDepth`;
 *   - 409 `branch_limit` for the 16th ACTIVE branch (counted under the advisory lock, so two simultaneous
 *     creates at 14 end with exactly 15).
 */
export async function createBranch(ctx: AdminCtx, body: CreateBranchBody): Promise<AdminBranch> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const { layout } = await readLayout(tx, ctx.tenantId);
    const facts = await readRuleFacts(tx, ctx.tenantId, true);
    refuseBranch(
      checkBranch({
        questions: facts.questions,
        branches: facts.branches,
        layout,
        openerId: body.openerQuestionId.toLowerCase(),
        values: body.values,
        creating: true,
      }),
    );

    const created = await guardedBranchWrite(tx, async () => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into public.profile_form_branches
          (tenant_id, opener_question_id, open_values, name, revision, created_at, updated_at)
        values (${ctx.tenantId}::uuid, ${body.openerQuestionId.toLowerCase()}::uuid,
                ${textArray(body.values)}, ${body.name}, 1, clock_timestamp(), clock_timestamp())
        returning id::text as id`);
      if (!row) throw new Error('createBranch: the insert returned no row');
      return row.id;
    });
    const branch = await readBranch(tx, ctx.tenantId, created);
    if (!branch) throw new Error('createBranch: the new branch is not readable');
    return branch;
  });
}
