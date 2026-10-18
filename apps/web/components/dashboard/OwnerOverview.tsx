import { formatBrl } from '@rede-social/contracts/money';
import type { OwnerOverviewReady } from '@rede-social/module-dashboard/contracts';
import { tenantOwnerPanel } from '@rede-social/module-dashboard/fixtures';
import {
  attendancePercent,
  bandTotal,
  Collapsible,
  CountUp,
  engagedPercent,
  interactedCount,
  KpiCard,
  KpiGrid,
  LIFT,
  LineChart,
  perItem,
  RISE,
  SURFACE,
  sumOf,
  ToneLabel,
} from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import {
  Activity,
  ArrowUpRight,
  CalendarCheck2,
  Flame,
  Heart,
  LayoutDashboard,
  MessageCircleMore,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { freshnessText } from '@/lib/dashboard-view';
import { OWNER_ADMIN_HREF, type OwnerPanelTenant } from '@/lib/owner-panel';
import { CardLink } from './CardLink';
import { changeDelta, formatCount, formatPercent, kpiDelta } from './format';
import { LegendStroke } from './LegendStroke';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';
import { SnapshotFreshness } from './SnapshotFreshness';

/** The account and the admin's panel share a row: one cell each at two columns, half at four. */
const PAIR = '@min-[100rem]:col-span-2';

export interface OwnerOverviewProps {
  tenant: OwnerPanelTenant;
  /** The ready snapshot answer of `GET /v1/dashboard/owner/overview` (08.7-01). */
  overview: OwnerOverviewReady;
  /** `bootstrap.tenant.timezone`: the freshness line's time and dates are the tenant's. */
  timeZone: string;
  /** The render's clock, read once by the caller. */
  nowMs: number;
}

/**
 * Level 4, "Visão geral", on the member report's look: one number from each area (members, engaged,
 * interactions per post, event attendance, the month's sales, conversations waiting), each an icon,
 * a label and a value with its change in a chip; then the 12-week trend against the 12 weeks before
 * (dashed) in a wide card beside the base's "interagiu" count, its legend in the card's footer; then
 * the account, closed, and "Ver operação do dia" as a card that opens Configurações (the app has no
 * client admin panel, `OWNER_ADMIN_HREF`). The account's plan and team are the sample's; its domain
 * is the tenant's real host. Every percent and per-post figure is computed from the raw counts.
 *
 * 08.7-01 (D-464, INSIGHT-07): the freshness line comes first, and the members card reads the REAL
 * snapshot — the tenant's active members at the end of the snapshot day, with its change against
 * the base 30 days before as the shipped `changeDelta` chip (none when there was no base). The other
 * cards keep the sample until their area plans wire them (planning decision 8).
 */
export async function OwnerOverview({ tenant, overview, timeZone, nowMs }: OwnerOverviewProps) {
  const t = await getTranslations('dashboard');
  const freshness = freshnessText(overview.snapshot, timeZone, nowMs);
  const membersDelta = changeDelta(overview.members.count, overview.members.previous);
  const { kpis, weeklyInteracting, account, engagement, byCommunity, events, support } =
    tenantOwnerPanel;
  const posts = sumOf(byCommunity, (row) => row.posts);
  const interactions = sumOf(byCommunity, (row) => row.interactions);

  return (
    <>
      <SnapshotFreshness text={t(`report.freshness.${freshness.key}`, { ...freshness.values })} />
      <KpiGrid className={cn(SPAN_ALL, '@4xl:grid-cols-3 @min-[100rem]:grid-cols-6')}>
        <KpiCard
          icon={Users}
          label={t('tenantOwner.kpi.members')}
          value={formatCount(overview.members.count)}
          delta={membersDelta ? kpiDelta(t, membersDelta) : undefined}
        />
        <KpiCard
          icon={Flame}
          label={t('tenantOwner.kpi.engaged')}
          value={formatPercent(engagedPercent(engagement))}
          delta={kpiDelta(t, kpis.engaged.delta)}
        />
        <KpiCard
          icon={Heart}
          label={t('tenantOwner.kpi.perPost')}
          value={formatCount(perItem(interactions, posts))}
        />
        <KpiCard
          icon={CalendarCheck2}
          label={t('tenantOwner.kpi.attendance')}
          value={formatPercent(attendancePercent(events.past))}
          delta={kpiDelta(t, kpis.eventAttendance.delta)}
        />
        <KpiCard
          icon={ShoppingBag}
          label={t('tenantOwner.kpi.orderValue')}
          value={formatBrl(kpis.orderValue.cents)}
          delta={kpiDelta(t, kpis.orderValue.delta)}
        />
        <KpiCard
          icon={MessageCircleMore}
          label={t('tenantOwner.kpi.awaiting')}
          value={formatCount(support.awaiting.count)}
        />
      </KpiGrid>

      <PanelSection title={t('tenantOwner.weekly.title')} className={SPAN_ALL}>
        <KpiCard
          icon={Activity}
          label={t('tenantAdmin.kpi.interacting')}
          value={formatCount(interactedCount(engagement))}
          unit={t('member.activity.presence.attendanceOf', {
            total: formatCount(bandTotal(engagement)),
          })}
          chartPlacement="side"
          chart={
            <LineChart
              series={weeklyInteracting.current}
              previous={weeklyInteracting.previous}
              xLabels={weeklyInteracting.current.map((_, i) =>
                (i + 1) % 4 === 0 ? t('tenantOwner.weekly.week', { week: i + 1 }) : '',
              )}
              yStep={50}
              formatValue={formatCount}
              ariaLabel={t('tenantOwner.weekly.label')}
              height={150}
            />
          }
          footer={
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-text-secondary">
              <li className="flex items-center gap-1.5">
                <LegendStroke dashed={false} />
                {t('tenantOwner.weekly.current')}
              </li>
              <li className="flex items-center gap-1.5">
                <LegendStroke dashed />
                {t('tenantOwner.weekly.previous')}
              </li>
            </ul>
          }
        />
      </PanelSection>

      <div className={cn('grid', PAIR)}>
        <Collapsible
          title={t('tenantOwner.account.title')}
          summary={
            <span className="inline-flex flex-wrap items-center gap-2">
              {t('tenantOwner.account.plan', { plan: t(`plans.${account.plan}`) })}
              <ToneLabel tone={tenant.domainVerified ? 'success' : 'warning'}>
                {t(
                  `tenantOwner.account.domainStatus.${tenant.domainVerified ? 'verified' : 'pending'}`,
                )}
              </ToneLabel>
            </span>
          }
        >
          <ul className="flex flex-col gap-1.5 text-xs text-text-secondary [overflow-wrap:anywhere]">
            <li>{t('tenantOwner.account.domain', { domain: tenant.domain })}</li>
            <li>
              <CountUp
                value={t('tenantOwner.account.team', {
                  admins: formatCount(account.admins),
                  staff: formatCount(account.staff),
                })}
              />
            </li>
            <li>{t('tenantOwner.account.billing')}</li>
          </ul>
        </Collapsible>
      </div>

      <CardLink href={OWNER_ADMIN_HREF} className={PAIR}>
        <Card className={cn(SURFACE, RISE, LIFT, 'flex items-center gap-2.5 p-4')}>
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors duration-300 group-hover/link:bg-brand group-hover/link:text-on-brand motion-reduce:transition-none"
          >
            <LayoutDashboard size={16} strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1 text-sm font-bold text-text">
            {t('tenantOwner.adminLink')}
          </span>
          <ArrowUpRight
            aria-hidden
            size={16}
            className="shrink-0 text-text-tertiary transition-[color,transform] duration-300 ease-out group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-brand motion-reduce:transition-none"
          />
        </Card>
      </CardLink>
    </>
  );
}
