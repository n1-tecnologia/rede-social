import type { RequestContext } from '@rede-social/core/server/auth/context';
import { DASHBOARD_SYSTEM_USER_ID } from '../contracts/index';

/**
 * The worker's tenant lane for one dashboard build (`dashboard.snapshot-build`, 08.7-01 planning
 * decision 6). `tenantId` comes from the job payload and is DATA, not authority (T-08.7-04): the
 * builder pins every statement to the lane's own `app.tenant_id()` and refuses a day that is not
 * complete.
 *
 * **The zero user is the guard.** `app.dashboard_build_snapshot` refuses every lane whose `sub` claim
 * is not `DASHBOARD_SYSTEM_USER_ID` (42501), so no request lane — whatever its role — can build or
 * overwrite a snapshot. The claim role is irrelevant to the definer; `support_tenant` follows the
 * courses precedent (`coursesSystemCtx`): a staff claim that answers no member and owns no row.
 * The dashboard cannot import another module's system context (MOD-02), so it owns its own.
 *
 * A fresh `events` array per call: the build emits nothing today.
 */
export function dashboardSystemCtx(tenantId: string): RequestContext {
  return {
    userId: DASHBOARD_SYSTEM_USER_ID,
    tenantId,
    role: 'support_tenant',
    requestId: 'job:dashboard',
    events: [],
  };
}
