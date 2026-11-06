import {
  type AdminBranch,
  type CreateBranchBody,
  PROFILE_FORM_LIMITS,
  type UndoBranchResult,
  type UpdateBranchBody,
} from '@rede-social/contracts/profile-form';
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
  branchFactsOf,
  checkArchiveBranch,
  checkBranch,
  checkBranchEdit,
  checkReactivateBranch,
  subtreeOf,
} from './branch-rules';
import { flatten, normalizeToTree } from './layout';
import { assertLayoutOrder, readLayout, writeLayout } from './layout-store';
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

// ── Edit, undo, archive and reactivate (D-646, D-653; PFORM-48) ─────────────────────────────────────────────

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((token) => right.has(token));
};

/** `uuid[]` of a JSON array of ids, for an `id in (...)` list that is one bound parameter. */
const idList = (ids: readonly string[]) =>
  sql`(select e::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) e)`;

/** How many answers the questions of one branch hold, active and archived alike: a COUNT, never a value. */
async function answersOfBranch(tx: Tx, tenantId: string, branchId: string): Promise<number> {
  const [row] = await tx.execute<{ n: number | string }>(sql`
    select count(*)::int as n
      from public.profile_form_answers a
      join public.profile_form_questions q on q.tenant_id = a.tenant_id and q.id = a.question_id
     where a.tenant_id = ${tenantId}::uuid and q.branch_id = ${branchId}::uuid`);
  return Number(row?.n ?? 0);
}

/** The ids of the branches that hold at least one answered question (active or archived question). */
async function answeredBranchIds(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select distinct q.branch_id::text as id
      from public.profile_form_answers a
      join public.profile_form_questions q on q.tenant_id = a.tenant_id and q.id = a.question_id
     where a.tenant_id = ${tenantId}::uuid and q.branch_id is not null`);
  return rows.map((row) => row.id);
}

/**
 * `PATCH /v1/profile_form/branches/{id}` (PFORM-48, D-646): the opener, the opening values and the name of a
 * branch under the optimistic `revision`.
 *
 *   1. `adminLock`, the live module check, then the branch rows `FOR UPDATE`: no row (unknown, another
 *      tenant's) is the bare 404; an archived branch is 409 `already_archived` (read-only until it comes
 *      back); a `revision` that is not the stored one is 409 `stale_revision` and nothing changes;
 *   2. AFTER the row lock the answers of the branch's questions are COUNTED, so an answer that committed while
 *      this edit waited is seen (the member's save locks the branches `FOR SHARE`): with one, a different
 *      opener or a different SET of opening values is 409 `condition_locked` (the same members in another
 *      order are no change), while a name change always passes;
 *   3. a different opener or set then goes through the pure `checkBranch` over the tree the branch will have
 *      (`condition_invalid`, `condition_order`, `branch_depth`, `public_under_private`); the SQL guards are
 *      the backstop and map to the same codes;
 *   4. a body that changes nothing answers 200 and does NOT bump the revision; otherwise the revision and
 *      `updated_at` move in the same statement. A `null` name clears it.
 */
export async function updateBranch(
  ctx: AdminCtx,
  id: string,
  body: UpdateBranchBody,
): Promise<AdminBranch> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const { layout } = await readLayout(tx, ctx.tenantId);
    const facts = await readRuleFacts(tx, ctx.tenantId, true);
    const branch = facts.branches.find((candidate) => candidate.id === id);
    if (!branch) throw new ApiError(404, 'NOT_FOUND');
    const current = await readBranch(tx, ctx.tenantId, id);
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    if (branch.archived) throw new ApiError(409, 'CONFLICT', { profileForm: 'already_archived' });
    if (body.revision !== current.revision) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'stale_revision' });
    }

    const openerId = body.openerQuestionId?.toLowerCase();
    const openerChanged = openerId !== undefined && openerId !== branch.openerQuestionId;
    const valuesChanged = body.values !== undefined && !sameSet(body.values, branch.values);
    const nameChanged = body.name !== undefined && body.name !== branch.name;

    refuseBranch(
      checkBranchEdit({
        branch,
        ...(openerId !== undefined ? { openerId } : {}),
        ...(body.values !== undefined ? { values: body.values } : {}),
        answeredQuestions: await answersOfBranch(tx, ctx.tenantId, id),
      }),
    );

    const nextOpener = openerChanged
      ? (openerId ?? branch.openerQuestionId)
      : branch.openerQuestionId;
    const nextValues = valuesChanged ? (body.values ?? branch.values) : branch.values;
    if (openerChanged || valuesChanged) {
      refuseBranch(
        checkBranch({
          questions: facts.questions,
          branches: facts.branches,
          layout,
          openerId: nextOpener,
          values: nextValues,
          branchId: id,
        }),
      );
    }
    if (!openerChanged && !valuesChanged && !nameChanged) return current;

    const nextName = body.name !== undefined ? body.name : branch.name;
    await guardedBranchWrite(tx, () =>
      tx.execute(sql`
        update public.profile_form_branches
           set opener_question_id = ${nextOpener}::uuid, open_values = ${textArray(nextValues)},
               name = ${nextName}, revision = revision + 1, updated_at = now()
         where id = ${id}::uuid and tenant_id = ${ctx.tenantId}::uuid`),
    );
    const edited = await readBranch(tx, ctx.tenantId, id);
    if (!edited) throw new Error('updateBranch: the edited branch is not readable');
    return edited;
  });
}

/**
 * `POST /v1/profile_form/branches/{id}/undo` (D-653, "Desfazer ramo"): every question of the branch, active and
 * archived, leaves it (`branch_id` null) and the branch row is deleted, in this one transaction: the questions
 * FIRST and the branch after, because the key between them is checked at the end of each statement. The
 * questions stay in the form where they are and become visible to every member; a branch that hangs on an
 * opener inside this one keeps working; NO ANSWER is touched. The revision of each ACTIVE question moves (the
 * member's etag covers it). An unknown or another tenant's id is the bare 404; undoing an empty branch just
 * removes it.
 */
export async function undoBranch(ctx: AdminCtx, id: string): Promise<UndoBranchResult> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    // The active questions are locked in the canonical order first (a member's save takes them the same way),
    // then the branches: steps, questions, branches.
    await readLayout(tx, ctx.tenantId, true);
    const facts = await readRuleFacts(tx, ctx.tenantId, true);
    if (!facts.branches.some((candidate) => candidate.id === id)) {
      throw new ApiError(404, 'NOT_FOUND');
    }

    await guardedBranchWrite(tx, async () => {
      await tx.execute(sql`
        update public.profile_form_questions
           set branch_id = null,
               revision = case when archived_at is null then revision + 1 else revision end,
               updated_at = now()
         where tenant_id = ${ctx.tenantId}::uuid and branch_id = ${id}::uuid`);
      await tx.execute(sql`
        delete from public.profile_form_branches
         where id = ${id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
    });
    return { undone: true };
  });
}

/**
 * `POST /v1/profile_form/branches/{id}/archive` (D-653): the branch, every branch that hangs on an opener
 * inside it and every question of that subtree leave the form TOGETHER with ONE timestamp (the transaction's
 * `now()`, the identity of the block), the branches FIRST and the questions after (so the PF007 guard never
 * sees an active branch on an archived opener), and the form is renumbered `1..n` in one set-based write.
 * Every answer stays. Refused with `has_dependents`, naming the openers, when a question of the subtree opens
 * another active branch that has answers. Idempotent: an archived branch answers 200 unchanged. Unknown or
 * another tenant's id: the bare 404.
 */
export async function archiveBranch(ctx: AdminCtx, id: string): Promise<AdminBranch> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const read = await readLayout(tx, ctx.tenantId, true);
    const facts = await readRuleFacts(tx, ctx.tenantId, true);
    const branch = facts.branches.find((candidate) => candidate.id === id);
    if (!branch) throw new ApiError(404, 'NOT_FOUND');
    if (branch.archived) {
      const same = await readBranch(tx, ctx.tenantId, id);
      if (!same) throw new Error('archiveBranch: the branch is not readable');
      return same;
    }

    refuseBranch(
      checkArchiveBranch({
        questions: facts.questions,
        branches: facts.branches,
        branchId: id,
        answeredBranchIds: await answeredBranchIds(tx, ctx.tenantId),
      }),
    );

    const subtree = subtreeOf(facts.branches, facts.questions, id);
    const archivedQuestionIds = await guardedBranchWrite(tx, async () => {
      await tx.execute(sql`
        update public.profile_form_branches
           set archived_at = now(), revision = revision + 1, updated_at = now()
         where tenant_id = ${ctx.tenantId}::uuid and id in ${idList(subtree.branchIds)}
           and archived_at is null`);
      const rows = await tx.execute<{ id: string }>(sql`
        update public.profile_form_questions
           set archived_at = now(), revision = revision + 1, updated_at = now()
         where tenant_id = ${ctx.tenantId}::uuid and branch_id in ${idList(subtree.branchIds)}
           and archived_at is null
        returning id::text as id`);
      return rows.map((row) => row.id);
    });

    const gone = new Set(archivedQuestionIds);
    await writeLayout(
      tx,
      ctx.tenantId,
      read.layout.map((step) => ({
        stepId: step.stepId,
        questionIds: step.questionIds.filter((questionId) => !gone.has(questionId)),
      })),
    );
    const archived = await readBranch(tx, ctx.tenantId, id);
    if (!archived) throw new Error('archiveBranch: the archived branch is not readable');
    return archived;
  });
}

/**
 * `POST /v1/profile_form/branches/{id}/reactivate` (D-653): restores EXACTLY the rows whose `archived_at`
 * equals the branch's own stamp (the branch, the branches below it and their questions; a question archived
 * alone earlier stays archived), branches first and questions after, with `listed_at` now, and returns the
 * restored questions to the layout at the end of their own step in tree order. Refused while the opener is
 * archived (`condition_invalid` + `openerId`) or inside an archived branch (`branch_archived`), past 30 ACTIVE
 * questions (`limit_reached`) and past 15 ACTIVE branches (`branch_limit`); an empty branch needs no slot.
 * Idempotent: an active branch answers 200 unchanged. Unknown or another tenant's id: the bare 404.
 */
export async function reactivateBranch(ctx: AdminCtx, id: string): Promise<AdminBranch> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const read = await readLayout(tx, ctx.tenantId, true);
    const facts = await readRuleFacts(tx, ctx.tenantId, true);
    const branch = facts.branches.find((candidate) => candidate.id === id);
    if (!branch) throw new ApiError(404, 'NOT_FOUND');
    if (!branch.archived) {
      const same = await readBranch(tx, ctx.tenantId, id);
      if (!same) throw new Error('reactivateBranch: the branch is not readable');
      return same;
    }

    // The block is the rows archived with the branch's own stamp: compared in SQL, microsecond for microsecond.
    const subtree = subtreeOf(facts.branches, facts.questions, id);
    const restoredQuestions = await tx.execute<{ id: string; step_id: string }>(sql`
      select q.id::text as id, q.step_id::text as step_id
        from public.profile_form_questions q
       where q.tenant_id = ${ctx.tenantId}::uuid and q.branch_id in ${idList(subtree.branchIds)}
         and q.archived_at = (select b.archived_at from public.profile_form_branches b
                               where b.id = ${id}::uuid and b.tenant_id = ${ctx.tenantId}::uuid)
       order by q."position", q.created_at, q.id`);
    const restoredBranches = await tx.execute<{ id: string }>(sql`
      select b.id::text as id
        from public.profile_form_branches b
       where b.tenant_id = ${ctx.tenantId}::uuid and b.id in ${idList(subtree.branchIds)}
         and b.archived_at = (select s.archived_at from public.profile_form_branches s
                               where s.id = ${id}::uuid and s.tenant_id = ${ctx.tenantId}::uuid)`);
    const restoredQuestionIds = restoredQuestions.map((row) => row.id);
    const restoredBranchIds = restoredBranches.map((row) => row.id);

    refuseBranch(
      checkReactivateBranch({
        questions: facts.questions,
        branches: facts.branches,
        branchId: id,
        restoredQuestionIds,
      }),
    );
    if (
      flatten(read.layout).length + restoredQuestionIds.length >
      PROFILE_FORM_LIMITS.activeQuestions
    ) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'limit_reached' });
    }
    const activeBranches = facts.branches.filter((candidate) => !candidate.archived).length;
    if (activeBranches + restoredBranchIds.length > PROFILE_FORM_LIMITS.branches) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'branch_limit' });
    }

    await guardedBranchWrite(tx, async () => {
      await tx.execute(sql`
        update public.profile_form_branches
           set archived_at = null, revision = revision + 1, updated_at = now()
         where tenant_id = ${ctx.tenantId}::uuid and id in ${idList(restoredBranchIds)}`);
      if (restoredQuestionIds.length > 0) {
        await tx.execute(sql`
          update public.profile_form_questions
             set archived_at = null, listed_at = now(), revision = revision + 1, updated_at = now()
           where tenant_id = ${ctx.tenantId}::uuid and id in ${idList(restoredQuestionIds)}`);
      }
    });

    if (restoredQuestionIds.length > 0) {
      // Each restored question returns to the END of its own step (its stored step always exists: deleting a
      // step re-points its archived questions), then the whole layout is put in tree order and the order rule
      // is checked over the tree the form now has, before the one renumber.
      const awake = new Set(restoredQuestionIds);
      const awakeBranches = new Set(restoredBranchIds);
      const questionsNow = facts.questions.map((question) =>
        awake.has(question.id) ? { ...question, archived: false } : question,
      );
      const branchesNow = facts.branches.map((candidate) =>
        awakeBranches.has(candidate.id) ? { ...candidate, archived: false } : candidate,
      );
      const appended = read.layout.map((step) => ({
        stepId: step.stepId,
        questionIds: [
          ...step.questionIds,
          ...restoredQuestions.filter((row) => row.step_id === step.stepId).map((row) => row.id),
        ],
      }));
      if (flatten(appended).length !== flatten(read.layout).length + restoredQuestionIds.length) {
        throw new Error(
          'reactivateBranch: a restored question names a step the form does not have',
        );
      }
      const ordered = normalizeToTree(appended, questionsNow, branchesNow);
      assertLayoutOrder(ordered, branchFactsOf(questionsNow, branchesNow));
      await writeLayout(tx, ctx.tenantId, ordered);
    }
    const restored = await readBranch(tx, ctx.tenantId, id);
    if (!restored) throw new Error('reactivateBranch: the reactivated branch is not readable');
    return restored;
  });
}
