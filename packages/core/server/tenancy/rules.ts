import type { AdminRules } from '@rede-social/contracts';
import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';

const log = moduleLogger('tenant-rules');

/**
 * The tenant's community rules on the admin's side (ADMIN-03, D-341): the read behind the Regras
 * screen and the save that bumps the consent version.
 *
 * ADMIN LANE, ONE TENANT. `tenants` carries only a self-SELECT policy for the tenant lane (no tenant
 * write path by design), so both functions run in `withAdminTx`, where RLS is off. The explicit
 * `id = ${ctx.tenantId}` on every statement is therefore the only isolation (T-08-36): `ctx.tenantId`
 * is the caller's membership of record (`requireAuth`), never a value from the path, query or body.
 *
 * CHANGE-ONLY BUMP (D-341). The update matches only when the stored text differs from the new one
 * (an `is distinct from` predicate), so saving the text that is already stored writes nothing and keeps the version; any real change raises
 * `rules_version` by exactly one in the same statement (the row lock serialises two admins saving at
 * once, and each change gets its own number). The text arrives normalised by `rulesBodySchema` (LF
 * line breaks, trimmed), so a Windows paste of identical text is not a change.
 *
 * CONSENT EVIDENCE IS NEVER TOUCHED (T-08-37). Nothing here reads or writes the consent table: every
 * recorded consent keeps the version it was accepted at, and the new version applies only to the
 * next sign-up or join, which must present it (`signup.ts` answers `{ consents: 'stale' }` to an
 * older one). There is no re-acceptance wall (D-341, reversible).
 *
 * Logs carry ids, the version and `changed` — never the text.
 */

type RulesRow = { rules_text: string; rules_version: number };

function toAdminRules(row: RulesRow): AdminRules {
  return { rulesText: row.rules_text, rulesVersion: Number(row.rules_version) };
}

/** `GET /v1/admin/rules`: the caller's tenant's stored rules and the version in force. */
export async function getTenantRules(ctx: Pick<RequestContext, 'tenantId'>): Promise<AdminRules> {
  const row = await withAdminTx(async (tx) => {
    const rows = await tx.execute<RulesRow>(sql`
      select rules_text, rules_version from tenants where id = ${ctx.tenantId}::uuid`);
    return rows[0] ?? null;
  });
  if (!row) throw new ApiError(404, 'TENANT_NOT_FOUND');
  return toAdminRules(row);
}

/**
 * `PUT /v1/admin/rules`: stores `rulesText` (already normalised and validated) for the caller's
 * tenant and answers the rules in force afterwards. `changed` is false when the text was identical.
 */
export async function saveTenantRules(
  ctx: Pick<RequestContext, 'tenantId' | 'userId' | 'requestId'>,
  rulesText: string,
): Promise<AdminRules & { changed: boolean }> {
  const result = await withAdminTx(async (tx) => {
    const updated = await tx.execute<RulesRow>(sql`
      update tenants
         set rules_text = ${rulesText},
             rules_version = rules_version + 1,
             updated_at = now()
       where id = ${ctx.tenantId}::uuid
         and rules_text is distinct from ${rulesText}
      returning rules_text, rules_version`);
    const bumped = updated[0];
    if (bumped) return { row: bumped, changed: true };

    // Unchanged text (or no such tenant): nothing was written; answer what is in force.
    const current = await tx.execute<RulesRow>(sql`
      select rules_text, rules_version from tenants where id = ${ctx.tenantId}::uuid`);
    const row = current[0];
    return row ? { row, changed: false } : null;
  });
  if (!result) throw new ApiError(404, 'TENANT_NOT_FOUND');

  const rules = toAdminRules(result.row);
  log.info(
    {
      event: 'tenancy.rules.saved',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      rulesVersion: rules.rulesVersion,
      changed: result.changed,
    },
    result.changed ? 'tenant rules saved' : 'tenant rules unchanged',
  );
  return { ...rules, changed: result.changed };
}
