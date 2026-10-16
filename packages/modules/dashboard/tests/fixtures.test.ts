import { describe, expect, it } from 'vitest';
import { ownerFinanceWindow, tenantOwnerPanel } from '../fixtures';
import { bandTotal, interactedCount, percentOf } from '../ui/metrics';

/**
 * The client owner's sample panel (level 4) on its own. In the rede-social-dashboard preview these
 * numbers also agree with the platform levels and the client admin's panel; the app shows only this
 * panel, so the shared values are pinned here as literals.
 */

describe('tenantOwnerPanel engagement (level 4)', () => {
  const { engagement, kpis, channels, byFormat, movement, weeklyInteracting } = tenantOwnerPanel;

  it('sums the bands to the member KPI, and the novos to the new members', () => {
    expect(bandTotal(engagement)).toBe(kpis.members.count);
    expect(engagement.counts.new).toBe(kpis.members.newMembers);
  });

  it("counts the base's 471 'interagiu', 38% of the 1.240 members", () => {
    expect(interactedCount(engagement)).toBe(471);
    expect(Math.round(percentOf(interactedCount(engagement), bandTotal(engagement)))).toBe(38);
  });

  it("ends the weekly 'interagiram' chart on the last 7 days' 380", () => {
    expect(weeklyInteracting.current.at(-1)).toBe(380);
  });

  it('counts every order of the single ledger in exactly one band of today', () => {
    const { byBand, total } = ownerFinanceWindow(0, 29);
    const orders = Object.values(byBand).reduce((sum, row) => sum + row.orders, 0);
    expect(orders).toBe(total.orders);
    expect(orders).toBe(channels.find((row) => row.channel === 'orders')?.count);
    expect(orders).toBe(126);
  });

  it('splits the 61 posts of the last 30 days by format', () => {
    const posts = byFormat.reduce((sum, row) => sum + row.posts, 0);
    expect(posts).toBe(61);
  });

  it('keeps the shown flows within the up and down totals', () => {
    const rank = {
      inactive: 0,
      at_risk: 1,
      active: 2,
      occasional: 2,
      engaged: 3,
      superfan: 4,
      new: 2,
    };
    let down = 0;
    let up = 0;
    for (const flow of movement.flows) {
      if (rank[flow.to] < rank[flow.from]) down += flow.members;
      else if (rank[flow.to] > rank[flow.from]) up += flow.members;
    }
    expect(down).toBeLessThanOrEqual(movement.down);
    expect(up).toBeLessThanOrEqual(movement.up);
  });
});
