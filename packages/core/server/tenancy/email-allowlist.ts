import { and, eq, sql } from 'drizzle-orm';
import { emailAllowlist } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';

/**
 * Quick 261018-owq: is `email` listed `liberado` on the global allowlist (`public.email_allowlist`)?
 * The normalisation happens in SQL (`lower(btrim())`), so it has exactly the semantics of the table
 * CHECK and of the two Auth hooks; JavaScript lowercasing differs for some non-ASCII input. Run it in
 * the admin lane (`withAdminTx`): the table has zero policies, so no tenant lane can read it.
 *
 * GoTrue's `auth.admin.createUser` never fires `before_user_created`, so the API calls this before it
 * creates an identity (`signupMember`) or accepts a first admin (`createTenant`).
 */
export async function isEmailAllowed(tx: Tx, email: string): Promise<boolean> {
  const rows = await tx
    .select({ email: emailAllowlist.email })
    .from(emailAllowlist)
    .where(
      and(
        eq(emailAllowlist.email, sql`lower(btrim(${email}))`),
        eq(emailAllowlist.status, 'liberado'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
