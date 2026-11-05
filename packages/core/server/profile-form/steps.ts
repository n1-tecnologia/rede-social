import {
  type AdminStep,
  type CreateStepBody,
  type DeleteStepResult,
  PROFILE_FORM_DEFAULT_STEP_TITLE,
  PROFILE_FORM_LIMITS,
  type UpdateStepBody,
} from '@rede-social/contracts/profile-form';
import { sql } from 'drizzle-orm';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import { ApiError } from '../http/api-error';
import { type AdminCtx, adminLock, requireModuleOn } from './admin';

/**
 * The steps of the profile form (Phase 12.1 plan 08, D-627, D-633; PFORM-27, PFORM-28). Pure tenant lane,
 * like `admin.ts`: every statement runs in the caller's transaction under the `admin_tenant` policies of
 * `profile_form_steps`, with an explicit `tenant_id` predicate beside them (layer 2). The routes pass only
 * `ctx` and the validated body; the tenant comes from `ctx.tenantId`, never from the body or a path.
 *
 * EVERY WRITE starts the way every builder write starts: `adminLock` (the per-tenant advisory lock, so two
 * admins' writes and the step count never interleave, T-12.1-13), then the LIVE module check, then the row
 * lock `FOR UPDATE`.
 *
 * NOTHING HERE DELETES A QUESTION OR AN ANSWER. Deleting a step refuses while an ACTIVE question sits in it
 * and only re-points its ARCHIVED questions to a surviving step (the step foreign key is NO ACTION, so
 * leaving them behind would make the delete fail, and dropping them would lose the archive, D-588).
 *
 * NOTHING HERE LOGS a title.
 */

type StepRow = {
  id: string;
  title: string;
  position: number | string;
  revision: number | string;
  question_count: number | string;
};

const toAdminStep = (row: StepRow): AdminStep => ({
  id: row.id,
  title: row.title,
  position: Number(row.position),
  revision: Number(row.revision),
  questionCount: Number(row.question_count),
});

/**
 * The tenant's steps in the canonical order `position, created_at, id`. `questionCount` is the number of
 * ACTIVE questions in the step: an aggregate, no answer is read.
 */
export async function readSteps(tx: Tx, tenantId: string): Promise<AdminStep[]> {
  const rows = await tx.execute<StepRow>(sql`
    select s.id::text as id, s.title, s."position" as position, s.revision,
           (select count(*)::int
              from public.profile_form_questions q
             where q.tenant_id = s.tenant_id and q.step_id = s.id and q.archived_at is null) as question_count
      from public.profile_form_steps s
     where s.tenant_id = ${tenantId}::uuid
     order by s."position", s.created_at, s.id`);
  return rows.map(toAdminStep);
}

/**
 * The id of the tenant's first step, creating the default one (`PROFILE_FORM_DEFAULT_STEP_TITLE`, position 1)
 * when the tenant has none, so an empty form can receive its first question. The database trigger writes the
 * SAME title for a legacy insert that names no step. The caller holds `adminLock`.
 */
export async function ensureDefaultStep(tx: Tx, tenantId: string): Promise<string> {
  const [first] = await tx.execute<{ id: string }>(sql`
    select s.id::text as id
      from public.profile_form_steps s
     where s.tenant_id = ${tenantId}::uuid
     order by s."position", s.created_at, s.id
     limit 1`);
  if (first) return first.id;
  const [created] = await tx.execute<{ id: string }>(sql`
    insert into public.profile_form_steps (tenant_id, title, "position", revision)
    values (${tenantId}::uuid, ${PROFILE_FORM_DEFAULT_STEP_TITLE}, 1, 1)
    returning id::text as id`);
  if (!created) throw new Error('ensureDefaultStep: the insert returned no row');
  return created.id;
}

/** One step of the tenant as the builder shows it, or null: another tenant's id is the same null. */
async function readStep(tx: Tx, tenantId: string, id: string): Promise<AdminStep | null> {
  return (await readSteps(tx, tenantId)).find((step) => step.id === id) ?? null;
}

/** The step row locked `FOR UPDATE` by `(id, tenant)`, or null for an unknown or another tenant's id. */
async function lockStep(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<{ id: string; revision: number } | null> {
  const [row] = await tx.execute<{ id: string; revision: number | string }>(sql`
    select s.id::text as id, s.revision
      from public.profile_form_steps s
     where s.id = ${id}::uuid and s.tenant_id = ${tenantId}::uuid
       for update`);
  return row ? { id: row.id, revision: Number(row.revision) } : null;
}

async function stepCountOf(tx: Tx, tenantId: string): Promise<number> {
  const [counted] = await tx.execute<{ n: number | string }>(sql`
    select count(*)::int as n from public.profile_form_steps where tenant_id = ${tenantId}::uuid`);
  return Number(counted?.n ?? 0);
}

/**
 * `POST /v1/profile_form/steps` (PFORM-27, PFORM-28): a new, empty step at the END. The body is already
 * validated (title trimmed, 1 to 60 code points). The server decides the rest: `position` = count + 1,
 * `revision` 1.
 *
 *   - 404 `MODULE_DISABLED` when the module is off (live read);
 *   - 409 `limit_reached` at 10 steps (counted under the advisory lock, so two simultaneous creates at 9 end
 *     with exactly 10; the position CHECK of the table is the backstop).
 */
export async function createStep(ctx: AdminCtx, body: CreateStepBody): Promise<AdminStep> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const count = await stepCountOf(tx, ctx.tenantId);
    if (count >= PROFILE_FORM_LIMITS.steps) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'limit_reached' });
    }
    const [created] = await tx.execute<{ id: string }>(sql`
      insert into public.profile_form_steps (tenant_id, title, "position", revision)
      values (${ctx.tenantId}::uuid, ${body.title}, ${count + 1}::int, 1)
      returning id::text as id`);
    if (!created) throw new Error('createStep: the insert returned no row');
    const step = await readStep(tx, ctx.tenantId, created.id);
    if (!step) throw new Error('createStep: the new step is not readable');
    return step;
  });
}

/**
 * `PATCH /v1/profile_form/steps/{id}` (PFORM-27): renames a step under the optimistic `revision`. An unknown
 * or another tenant's id is the bare 404; a `revision` that is not the stored one is 409 `stale_revision` and
 * nothing changes; otherwise the title is stored and the revision is bumped by one.
 */
export async function renameStep(
  ctx: AdminCtx,
  id: string,
  body: UpdateStepBody,
): Promise<AdminStep> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const step = await lockStep(tx, ctx.tenantId, id);
    if (!step) throw new ApiError(404, 'NOT_FOUND');
    if (body.revision !== step.revision) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'stale_revision' });
    }
    await tx.execute(sql`
      update public.profile_form_steps
         set title = ${body.title}, revision = revision + 1, updated_at = now()
       where id = ${step.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
    const renamed = await readStep(tx, ctx.tenantId, step.id);
    if (!renamed) throw new Error('renameStep: the renamed step is not readable');
    return renamed;
  });
}

/** Whether the error, or anything in its cause chain, carries the given SQLSTATE. */
function hasSqlState(error: unknown, state: string): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (code === state) return true;
    current = cause;
  }
  return false;
}

/**
 * `DELETE /v1/profile_form/steps/{id}` (PFORM-27, PFORM-28): removes an EMPTY step.
 *
 *   - unknown or another tenant's id: the bare 404;
 *   - 409 `step_not_empty` while the step holds an ACTIVE question (nothing is moved or deleted);
 *   - 409 `last_step` for the tenant's only step;
 *   - otherwise, in this one transaction: the step's ARCHIVED questions are re-pointed to the first
 *     remaining step (`position, created_at, id`), the step is deleted, and the remaining steps are
 *     renumbered `1..n` in one set-based statement. A `23503` raised by the step foreign key (a question
 *     that slipped in) is the same `step_not_empty`.
 */
export async function deleteStep(ctx: AdminCtx, id: string): Promise<DeleteStepResult> {
  return withTenantTx(ctx, async (tx) => {
    await adminLock(tx, ctx.tenantId);
    await requireModuleOn(tx, ctx);

    const step = await lockStep(tx, ctx.tenantId, id);
    if (!step) throw new ApiError(404, 'NOT_FOUND');

    const [active] = await tx.execute<{ found: boolean }>(sql`
      select exists (
        select 1 from public.profile_form_questions q
         where q.tenant_id = ${ctx.tenantId}::uuid and q.step_id = ${step.id}::uuid
           and q.archived_at is null) as found`);
    if (active?.found === true) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'step_not_empty' });
    }
    if ((await stepCountOf(tx, ctx.tenantId)) <= 1) {
      throw new ApiError(409, 'CONFLICT', { profileForm: 'last_step' });
    }

    try {
      // A7: the step foreign key is NO ACTION. The archived questions keep their answers and move to the
      // first surviving step; no question and no answer is deleted.
      await tx.execute(sql`
        update public.profile_form_questions
           set step_id = (select s.id
                            from public.profile_form_steps s
                           where s.tenant_id = ${ctx.tenantId}::uuid and s.id <> ${step.id}::uuid
                           order by s."position", s.created_at, s.id
                           limit 1),
               updated_at = now()
         where tenant_id = ${ctx.tenantId}::uuid and step_id = ${step.id}::uuid`);
      await tx.execute(sql`
        delete from public.profile_form_steps
         where id = ${step.id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
    } catch (error) {
      if (hasSqlState(error, '23503')) {
        throw new ApiError(409, 'CONFLICT', { profileForm: 'step_not_empty' });
      }
      throw error;
    }

    // Contiguous positions 1..n in one statement (no gap, no repeat); `revision` is left alone.
    await tx.execute(sql`
      update public.profile_form_steps s
         set "position" = r.ord::int, updated_at = now()
        from (select id, row_number() over (order by "position", created_at, id) as ord
                from public.profile_form_steps
               where tenant_id = ${ctx.tenantId}::uuid) r
       where s.id = r.id and s.tenant_id = ${ctx.tenantId}::uuid and s."position" <> r.ord`);
    return { deleted: true };
  });
}
