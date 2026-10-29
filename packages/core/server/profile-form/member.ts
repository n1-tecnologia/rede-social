import type { ProfileFormBootstrap } from '@rede-social/contracts/profile-form';
import { and, eq, sql } from 'drizzle-orm';
import { tenantModules } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';

/**
 * The member side of the profile form that the kernel owns (Phase 12-05). Pure tenant lane: every
 * statement runs in the caller's own transaction under RLS, and nothing here writes.
 *
 * The module key is a literal on purpose: the kernel never imports a module package. Plan 06 extends
 * this file with the member's read of the form.
 */
const MODULE_KEY = 'profile_form';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/**
 * Whether the tenant's `profile_form` module is on RIGHT NOW: a live read of the `tenant_modules` row in
 * the given transaction, never the 30-second flags cache. The gate (`app.profile_form_missing`) reads the
 * same row live, so a bootstrap built from this answer and a gate that refuses cannot disagree (RESEARCH
 * Pitfall 1: a member would otherwise ping-pong between a refusal and an empty form). A missing row reads
 * as off.
 */
export async function liveModuleOn(tx: Tx, ctx: Pick<Ctx, 'tenantId'>): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: tenantModules.enabled })
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, ctx.tenantId), eq(tenantModules.moduleKey, MODULE_KEY)))
    .limit(1);
  return row?.enabled === true;
}

/**
 * `GET /v1/me/bootstrap`'s `profileForm` block (PFORM-12, D-584, D-585, D-586): `undefined` when the role is
 * not `member` or the module is off; otherwise
 *   - `pendingRequired`: `app.profile_form_missing_self()`, the SAME SQL rule the gate runs;
 *   - `newOptional`: the ACTIVE OPTIONAL questions listed after the member's "Agora não" instant (all of
 *     them while it is null) that she has not answered.
 * Counts only: no question title or value is read, and nothing is logged.
 */
export async function bootstrapBlock(tx: Tx, ctx: Ctx): Promise<ProfileFormBootstrap | undefined> {
  if (ctx.role !== 'member') return undefined;
  if (!(await liveModuleOn(tx, ctx))) return undefined;

  const pending = await tx.execute<{ missing: number | string }>(
    sql`select app.profile_form_missing_self() as missing`,
  );
  const fresh = await tx.execute<{ fresh: number | string }>(sql`
    select count(*)::int as fresh
      from public.profile_form_questions q
     where q.tenant_id = ${ctx.tenantId}::uuid
       and q.archived_at is null
       and q.required = false
       and q.listed_at > coalesce(
             (select p.profile_form_notice_dismissed_at
                from public.member_profiles p
                join public.memberships m on m.id = p.membership_id
               where m.tenant_id = ${ctx.tenantId}::uuid
                 and m.user_id = ${ctx.userId}::uuid
                 and m.deleted_at is null
               limit 1),
             '-infinity'::timestamptz)
       and not exists (
             select 1
               from public.profile_form_answers a
               join public.memberships m on m.id = a.membership_id
              where a.tenant_id = q.tenant_id
                and a.question_id = q.id
                and m.tenant_id = ${ctx.tenantId}::uuid
                and m.user_id = ${ctx.userId}::uuid
                and m.deleted_at is null)`);

  const pendingRequired = Number(pending[0]?.missing ?? 0);
  const newOptional = Number(fresh[0]?.fresh ?? 0);
  if (!Number.isInteger(pendingRequired) || pendingRequired < 0) {
    throw new Error('profile_form_missing_self returned an unexpected count');
  }
  if (!Number.isInteger(newOptional) || newOptional < 0) {
    throw new Error('profile form optional count is unexpected');
  }
  return { pendingRequired, newOptional };
}
