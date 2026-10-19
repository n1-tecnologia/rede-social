import type { OwnerFinanceBuyersReady } from '@rede-social/module-dashboard/contracts';
import type { DashboardT } from '@/components/dashboard/format';
import type { MemberRowView } from './owner-list-view';

/** Inert until 08.7-10 Task 2's GREEN: the buyers' member cards. */
export function financeBuyerRowViews(
  _t: DashboardT,
  _page: OwnerFinanceBuyersReady,
  _ctx: { timeZone: string; nowMs: number },
): MemberRowView[] {
  return [];
}
