import { formatBrl } from '@rede-social/contracts/money';
import type { OwnerOverviewReady } from '@rede-social/module-dashboard/contracts';
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
import type { ReactNode } from 'react';
import { freshnessText } from '@/lib/dashboard-view';
import { OWNER_ADMIN_HREF, type OwnerPanelFlags, type OwnerPanelTenant } from '@/lib/owner-panel';
import { CardLink } from './CardLink';
import { changeDelta, formatCount, formatPercent, kpiDelta, pointsDelta } from './format';
import { LegendStroke } from './LegendStroke';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';
import { SnapshotFreshness } from './SnapshotFreshness';

/** The account and the admin's panel share a row: one cell each at two columns, half at four. */
const PAIR = '@min-[100rem]:col-span-2';

/** Where "Conversas aguardando resposta" opens (D-461, UI-D-476): the support inbox. */
const SUPPORT_INBOX_HREF = '/suporte';

/**
 * The KPI row's columns for n cards (UI-D-472), as static classes: 2 on a phone (the shipped
 * `KpiGrid`), at `@4xl` n when n ≤ 3, 2 when n = 4 and 3 when n ≥ 5, and n at `@min-[100rem]`. No
 * empty track is left.
 */
const KPI_COLUMNS: Readonly<Record<number, string>> = {
  2: '@4xl:grid-cols-2 @min-[100rem]:grid-cols-2',
  3: '@4xl:grid-cols-3 @min-[100rem]:grid-cols-3',
  4: '@4xl:grid-cols-2 @min-[100rem]:grid-cols-4',
  5: '@4xl:grid-cols-3 @min-[100rem]:grid-cols-5',
  6: '@4xl:grid-cols-3 @min-[100rem]:grid-cols-6',
};

/** The weekly trend's axis step, from the real counts (a pilot tenant counts in units, not 50s). */
function weeklyStep(values: readonly number[]): number {
  const top = Math.max(0, ...values);
  if (top <= 10) return 5;
  if (top <= 50) return 10;
  if (top <= 200) return 50;
  return 100;
}

/** A window's attendance as the shipped rule reads it: presences ÷ (confirmed + walk-ins). */
function attendanceOf(window: { confirmed: number; present: number; walkIns: number }) {
  return {
    percent: attendancePercent([
      { checkIns: window.present, confirmed: window.confirmed + window.walkIns },
    ]),
    base: window.confirmed + window.walkIns,
  };
}

export interface OwnerOverviewProps {
  tenant: OwnerPanelTenant;
  /** The ready snapshot answer of `GET /v1/dashboard/owner/overview` (08.7-01, 08.7-12). */
  overview: OwnerOverviewReady;
  /** The panel's module flags (D-460): a card of a module that is off is dropped (UI-D-472). */
  flags: OwnerPanelFlags;
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
 * client admin panel, `OWNER_ADMIN_HREF`). Every percent and per-post figure is computed from the
 * raw counts.
 *
 * 08.7-12 (D-459, D-460, D-461, UI-D-472, INSIGHT-07): every card is the tenant's own, from the
 * snapshot answer, after the freshness line. A module that is off drops its card ("Comparecimento
 * em eventos" with `events`, "Vendas do mês" with `store`, "Conversas aguardando resposta" with
 * `chat`) and the row reflows on its column rule; the waiting card opens the support inbox. The
 * account's plan and team are read live by the API, its domain is the tenant's host, and billing
 * stays the shipped "Cobrança: em breve". No sample value remains.
 */
export async function OwnerOverview({
  tenant,
  overview,
  flags,
  timeZone,
  nowMs,
}: OwnerOverviewProps) {
  const t = await getTranslations('dashboard');
  const freshness = freshnessText(overview.snapshot, timeZone, nowMs);
  const { engagement, previousEngagement, weeklyInteracting, account } = overview;
  const membersDelta = changeDelta(overview.members.count, overview.members.previous);
  const engagedDelta =
    bandTotal(previousEngagement) > 0
      ? pointsDelta(engagedPercent(engagement), engagedPercent(previousEngagement))
      : null;

  const cards: ReactNode[] = [
    <KpiCard
      key="members"
      icon={Users}
      label={t('tenantOwner.kpi.members')}
      value={formatCount(overview.members.count)}
      delta={membersDelta ? kpiDelta(t, membersDelta) : undefined}
    />,
    <KpiCard
      key="engaged"
      icon={Flame}
      label={t('tenantOwner.kpi.engaged')}
      value={formatPercent(engagedPercent(engagement))}
      delta={engagedDelta ? kpiDelta(t, engagedDelta) : undefined}
    />,
  ];
  if (overview.perPost) {
    const { posts, interactions, previousPosts, previousInteractions } = overview.perPost;
    const perPostDelta =
      posts > 0 && previousPosts > 0
        ? changeDelta(interactions / posts, previousInteractions / previousPosts)
        : null;
    cards.push(
      <KpiCard
        key="perPost"
        icon={Heart}
        label={t('tenantOwner.kpi.perPost')}
        value={formatCount(perItem(interactions, posts))}
        delta={perPostDelta ? kpiDelta(t, perPostDelta) : undefined}
      />,
    );
  }
  if (flags.events && overview.attendance) {
    const now = attendanceOf(overview.attendance.current);
    const before = attendanceOf(overview.attendance.previous);
    const attendanceDelta =
      now.base > 0 && before.base > 0 ? pointsDelta(now.percent, before.percent) : null;
    cards.push(
      <KpiCard
        key="attendance"
        icon={CalendarCheck2}
        label={t('tenantOwner.kpi.attendance')}
        value={formatPercent(now.percent)}
        delta={attendanceDelta ? kpiDelta(t, attendanceDelta) : undefined}
      />,
    );
  }
  if (flags.store && overview.orderValue) {
    const salesDelta = changeDelta(overview.orderValue.current, overview.orderValue.previous);
    cards.push(
      <KpiCard
        key="orderValue"
        icon={ShoppingBag}
        label={t('tenantOwner.kpi.orderValue')}
        value={formatBrl(overview.orderValue.current)}
        delta={salesDelta ? kpiDelta(t, salesDelta) : undefined}
      />,
    );
  }
  if (flags.chat && overview.awaiting) {
    cards.push(
      <CardLink key="awaiting" href={SUPPORT_INBOX_HREF}>
        <KpiCard
          icon={MessageCircleMore}
          label={t('tenantOwner.kpi.awaiting')}
          value={formatCount(overview.awaiting.count)}
          linked={t('tenantOwner.queue.open')}
        />
      </CardLink>,
    );
  }

  return (
    <>
      <SnapshotFreshness text={t(`report.freshness.${freshness.key}`, { ...freshness.values })} />
      <KpiGrid className={cn(SPAN_ALL, KPI_COLUMNS[cards.length])}>{cards}</KpiGrid>

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
              yStep={weeklyStep([...weeklyInteracting.current, ...weeklyInteracting.previous])}
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
              {t('tenantOwner.account.plan', {
                plan: t.has(`plans.${account.plan}`) ? t(`plans.${account.plan}`) : account.plan,
              })}
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
