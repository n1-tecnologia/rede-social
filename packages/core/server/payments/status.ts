import type { SubscriptionStatus } from '@rede-social/contracts/payments';
import { eq } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenants } from '../../db/schema';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { accessCheckoutUrl } from '../tenancy/access';

/**
 * `GET /v1/me/subscription` (09.1-10, D-497, UI-D-521): what the "Assinatura pendente" screen needs, and
 * nothing else: the tenant's display name and the stored `https:` checkout link of the session's tenant.
 * Both come from `ctx.tenantId` (the membership of record from `requireAuth`), never from input, so the
 * answer cannot name another community (D-302). The link has ONE reader, `accessCheckoutUrl`: it is null
 * unless the gate is on, and the web never takes a link from a URL (UI-D-532).
 *
 * Admin lane because the tenant name and the products are read for a CUT member too, and `payment_products`
 * has an `admin_tenant` policy only; the explicit `tenant_id` predicates are the isolation.
 */
export async function getSubscriptionStatus(ctx: RequestContext): Promise<SubscriptionStatus> {
  return withAdminTx({ tenantId: ctx.tenantId }, async (tx) => {
    const [tenant] = await tx
      .select({ displayName: tenants.displayName })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    if (!tenant) throw new ApiError(404, 'NOT_FOUND');
    return {
      tenantName: tenant.displayName,
      checkoutUrl: await accessCheckoutUrl(tx, ctx.tenantId),
    };
  });
}
