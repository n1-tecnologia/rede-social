import {
  memberBranchSchema,
  type PublicAnswers,
  type StaffAnswers,
} from '@rede-social/contracts/profile-form';
import { sql } from 'drizzle-orm';
import { memberships } from '../../db/schema';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { membershipOfRecord } from '../tenancy/membership-scope';
import { liveModuleOn } from './member';

/**
 * The READING side of the privacy promise (Phase 12-07, D-593, PFORM-18, PFORM-19): what one member sees of
 * another member's answers, and what the staff see of any member's.
 *
 *   - a member viewer gets ONLY the answers to questions the admin flagged `show_on_profile` that are not
 *     archived (`publicAnswersOf`), as `{ kind: 'member', answers }`;
 *   - `admin_tenant` and `support_tenant` get EVERY answer of the target, archived questions included, with
 *     the flags the staff need (`staffAnswersOf`), as `{ kind: 'staff', answers }`.
 *
 * Both functions return `null` for EVERY miss and the route turns that into ONE bare 404 (D-23): an unknown
 * membership, another tenant's membership, a blocked, invited or soft-deleted target, a staff target (staff
 * are never asked, D-584), the caller's own membership on the member path, and a module that is off. Nothing
 * here tells those apart, so the route cannot be used to probe which memberships exist (T-12-18).
 *
 * THREE LAYERS (T-12-17). Layer 3 is RLS: the `profile_form_answers_public_select` policy lets a member see
 * only public answers and the staff policy lets the staff see all of the tenant's. Layer 2 is stated here
 * beside it: `tenant_id` and the target membership in every statement, and `show_on_profile and archived_at
 * is null` spelled out in the member query instead of trusting the policy alone. Layer 1 is the host-selected
 * tenant of record in `requireAuth`.
 *
 * NOTHING HERE LOGS. A value is member content (T-12-15); the route logs ids only.
 */

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

type Option = { id: string; label: string };

type PublicRow = {
  question_id: string;
  title: string;
  type: PublicAnswers['answers'][number]['type'];
  options: Option[];
  value: PublicAnswers['answers'][number]['value'];
};

type StaffRow = {
  question_id: string;
  title: string;
  type: StaffAnswers['answers'][number]['type'];
  options: Option[];
  value: StaffAnswers['answers'][number]['value'];
  answered: boolean;
  required: boolean;
  show_on_profile: boolean;
  position: number;
  archived_at: string | Date | null;
  branch_id: string | null;
};

/** A branch as the staff payload needs it: the opener and the opening values, never the name. */
type BranchRow = { id: string; opener_question_id: string; open_values: string[] };

/**
 * The target membership, or `null`: a `member`-role, `active`, not-deleted membership of THIS tenant. The
 * state filter lives in SQL, so a blocked, invited, removed, staff or foreign membership takes the very same
 * branch as an id that never existed.
 */
async function targetOf(tx: Tx, ctx: Ctx, targetMembershipId: string): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`
    select m.id::text as id
      from public.memberships m
     where m.id = ${targetMembershipId}::uuid
       and m.tenant_id = ${ctx.tenantId}::uuid
       and m.role = 'member'
       and m.status = 'active'
       and m.deleted_at is null
     limit 1`);
  return row?.id ?? null;
}

/** The caller's own membership id, for the "not yourself" rule of the member path. */
async function ownMembershipId(tx: Tx, ctx: Ctx): Promise<string | null> {
  const [row] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(membershipOfRecord(ctx))
    .limit(1);
  return row?.id ?? null;
}

/**
 * `{ kind: 'member', answers }` for the viewer who is a member (PFORM-18, D-593), or `null`.
 *
 * Only answered rows of questions that are `show_on_profile` and not archived are returned, in the admin's
 * order. Each row carries `questionId`, `title`, `type`, `options` and `value` and nothing else: no e-mail,
 * no membership id, no flag, no staff-only marker.
 */
export async function publicAnswersOf(
  ctx: Ctx,
  targetMembershipId: string,
): Promise<PublicAnswers | null> {
  return withTenantTx(ctx, async (tx) => {
    if (!(await liveModuleOn(tx, ctx))) return null;
    const own = await ownMembershipId(tx, ctx);
    if (own === null || own === targetMembershipId) return null;
    const target = await targetOf(tx, ctx, targetMembershipId);
    if (target === null) return null;
    const rows = await tx.execute<PublicRow>(sql`
      select q.id::text as question_id, q.title, q.type, q.options, a.value
        from public.profile_form_answers a
        join public.profile_form_questions q
          on q.tenant_id = a.tenant_id and q.id = a.question_id
       where a.tenant_id = ${ctx.tenantId}::uuid
         and a.membership_id = ${target}::uuid
         and q.show_on_profile
         and q.archived_at is null
       order by q.position, q.created_at, q.id`);
    return {
      kind: 'member',
      answers: rows.map((row) => ({
        questionId: row.question_id,
        title: row.title,
        type: row.type,
        options: row.options.map((option) => ({ id: option.id, label: option.label })),
        value: row.value,
      })),
    };
  });
}

const iso = (value: string | Date | null): string | null =>
  value === null ? null : new Date(value).toISOString();

/**
 * `{ kind: 'staff', answers, branches }` for `admin_tenant` and `support_tenant` (PFORM-19), or `null`.
 *
 * Every ACTIVE question is listed (`answered: false` and `value: null` when the member has not answered),
 * plus every ARCHIVED question the target answered. Active questions come first in the admin's order, then
 * the archived ones by `archived_at` descending then id, so two requests return the same sequence.
 */
export async function staffAnswersOf(
  ctx: Ctx,
  targetMembershipId: string,
): Promise<StaffAnswers | null> {
  if (ctx.role !== 'admin_tenant' && ctx.role !== 'support_tenant') return null;
  return withTenantTx(ctx, async (tx) => {
    if (!(await liveModuleOn(tx, ctx))) return null;
    const target = await targetOf(tx, ctx, targetMembershipId);
    if (target === null) return null;
    const rows = await tx.execute<StaffRow>(sql`
      select q.id::text as question_id, q.title, q.type, q.options, a.value,
             (a.id is not null) as answered, q.required, q.show_on_profile,
             q.position, q.archived_at, q.branch_id::text as branch_id
        from public.profile_form_questions q
        left join public.profile_form_answers a
          on a.tenant_id = q.tenant_id
         and a.question_id = q.id
         and a.membership_id = ${target}::uuid
       where q.tenant_id = ${ctx.tenantId}::uuid
         and (q.archived_at is null or a.id is not null)
       order by (q.archived_at is not null),
                case when q.archived_at is null then q.position end,
                case when q.archived_at is null then q.created_at end,
                q.archived_at desc nulls last,
                q.id`);
    // Every branch of the tenant, active and archived (the staff view lists archived rows), without the name
    // (T-12.2-03): a member's own opener rows plus these tell the view which questions "Não se aplica".
    const branches = await tx.execute<BranchRow>(sql`
      select b.id::text as id, b.opener_question_id::text as opener_question_id, b.open_values
        from public.profile_form_branches b
       where b.tenant_id = ${ctx.tenantId}::uuid
       order by b.created_at, b.id`);
    return {
      kind: 'staff',
      answers: rows.map((row) => ({
        questionId: row.question_id,
        title: row.title,
        type: row.type,
        options: row.options.map((option) => ({ id: option.id, label: option.label })),
        value: row.answered ? row.value : null,
        answered: row.answered,
        required: row.required,
        showOnProfile: row.show_on_profile,
        position: row.position,
        archivedAt: iso(row.archived_at),
        // 12.2 (D-641): the branch only, never an answer value; the opener's own row supplies the value.
        branchId: row.branch_id,
      })),
      branches: branches.map((branch) =>
        memberBranchSchema.parse({
          id: branch.id,
          openerQuestionId: branch.opener_question_id,
          values: branch.open_values,
        }),
      ),
    };
  });
}
