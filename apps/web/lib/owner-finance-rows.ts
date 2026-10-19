import { formatBrl } from '@rede-social/contracts/money';
import type {
  OwnerFinanceBuyerRow,
  OwnerFinanceBuyersReady,
} from '@rede-social/module-dashboard/contracts';
import {
  bandLabel,
  type DashboardT,
  formatBrlWhole,
  initials,
  momentText,
} from '@/components/dashboard/format';
import { financeMemberAnchor, financeViewOfList, ownerFinanceHref } from './owner-finance-view';
import {
  lastActiveText,
  localMoment,
  type MemberCardLine,
  type MemberRowView,
} from './owner-list-view';

/*
 * The member cards of Financeiro's buyers lists (08.7-10, D-461, D-462): the server's first page and
 * every page the "Ver todos" island appends are built here, finished (UI-D-477). A row names the
 * member (admin only: named lists are not floored) and the list's own figures — when and for how
 * much — never which product (the API's rows carry none). Each card opens the panel's member detail.
 */

/** A buyers list's first page on its screen (the rest continues in place, UI-D-477). */
export const FINANCE_FIRST_PAGE = 10;

const LISTS = 'tenantOwner.finance.lists';

/** "hoje às 09:12", "ontem", "há 8 dias": a row's instant as the panels say it. */
function whenOf(t: DashboardT, at: string | null, timeZone: string, nowMs: number): string {
  if (at === null) return t('tenantOwner.bandMembers.neverActive');
  return momentText(t, localMoment(at, timeZone, nowMs));
}

/** The line under the name: the list's own figures (the API's `at`, `orders`, `cents`, days). */
function leadOf(
  t: DashboardT,
  page: OwnerFinanceBuyersReady,
  row: OwnerFinanceBuyerRow,
  ctx: { timeZone: string; nowMs: number },
): string {
  const when = whenOf(t, row.at, ctx.timeZone, ctx.nowMs);
  switch (page.list) {
    case 'primary':
      return t(`${LISTS}.primary.lead`, { when, value: formatBrl(row.cents) });
    case 'secondary':
      return t(`${LISTS}.secondary.lead`, {
        count: row.orders,
        value: formatBrlWhole(row.cents),
        when,
      });
    case 'rebought':
      return t(`${LISTS}.rebought.lead`, { when });
    case 'time-to-second':
      return t(`${LISTS}.timeToSecond.lead`, { days: row.secondAfterDays ?? 0 });
    case 'band':
      return t(`${LISTS}.band.lead`, { count: row.orders, value: formatBrlWhole(row.cents), when });
    case 'never':
      return t(`${LISTS}.never.lead`, { when, value: formatBrl(row.cents) });
    default:
      // lifetime, vip-fading (every paid order) and product.
      return t(`${LISTS}.lifetime.lead`, { value: formatBrlWhole(row.cents) });
  }
}

/** The card's labeled lines: today's band (lists across bands) and, for the VIP, the last activity. */
function linesOf(
  t: DashboardT,
  page: OwnerFinanceBuyersReady,
  row: OwnerFinanceBuyerRow,
  ctx: { timeZone: string; nowMs: number },
): MemberCardLine[] {
  const lines: MemberCardLine[] = [];
  if (page.list !== 'band' && page.list !== 'never' && row.band !== null) {
    lines.push({ label: t('tenantOwner.bandMembers.band'), value: bandLabel(t, row.band) });
  }
  if (page.list === 'vip-fading') {
    lines.push({
      label: t('tenantOwner.bandMembers.lastActive'),
      value: lastActiveText(t, row.at, ctx.timeZone, ctx.nowMs),
    });
  }
  return lines;
}

/**
 * One page of a buyers list as member cards: the name, the list's figures, the band; the card opens
 * `&membro=<membershipId>` under the list's own view and carries the anchor its "Voltar" lands on.
 * A list the panel does not show (`product`: the store's own screen) has no card.
 */
export function financeBuyerRowViews(
  t: DashboardT,
  page: OwnerFinanceBuyersReady,
  ctx: { timeZone: string; nowMs: number },
): MemberRowView[] {
  const view = financeViewOfList(page.list, page.band);
  if (view === null) return [];
  return page.rows.map((row) => ({
    type: 'member',
    id: row.membershipId,
    href: ownerFinanceHref({ ...view, memberId: row.membershipId }),
    name: row.displayName,
    initials: initials(row.displayName),
    lead: leadOf(t, page, row, ctx),
    lines: linesOf(t, page, row, ctx),
    anchor: financeMemberAnchor(row.membershipId),
  }));
}
