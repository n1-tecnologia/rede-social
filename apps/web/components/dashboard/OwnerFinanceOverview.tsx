import {
  type FinanceSummary,
  ownerContentItem,
  ownerFinanceAttention,
  ownerFinanceContentSales,
  ownerFinanceEventSales,
  ownerFinanceProduct,
  ownerFinanceSummary,
  ownerFinanceVipProspects,
  ownerFinanceVipUsage,
  ownerFinanceWeekly,
  ownerFinanceWindow,
} from '@rede-social/module-dashboard/fixtures';
import {
  ActionCard,
  BarList,
  CountUp,
  ENGAGEMENT_BAND_ORDER,
  isBelowPrivacyFloor,
  KpiCard,
  type KpiDelta,
  KpiGrid,
  LIFT,
  LineChart,
  PRIVACY_FLOOR,
  percentOf,
  RISE,
  SURFACE,
} from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import {
  BellRing,
  CalendarCheck,
  ChartPie,
  Crown,
  DoorOpen,
  Gem,
  HeartHandshake,
  Hourglass,
  type LucideIcon,
  Newspaper,
  PackagePlus,
  Repeat,
  ShoppingBag,
  TriangleAlert,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ownerWaitlistHref } from '@/lib/owner-band-scope';
import { contentTabView, ownerContentHref } from '@/lib/owner-content-view';
import {
  type FinanceAttentionList,
  type FinanceNumber,
  financeAttentionAnchor,
  financeNumberAnchor,
  financeProductAnchor,
  financeTabView,
  ownerFinanceHref,
} from '@/lib/owner-finance-view';
import { CardLink } from './CardLink';
import {
  bandLabel,
  changeDelta,
  type DashboardT,
  formatBrlCompact,
  formatBrlWhole,
  formatCount,
  formatDayMonth,
  formatFloored,
  formatPercent,
  kpiDelta,
} from './format';
import { LegendStroke } from './LegendStroke';
import { FooterLine, financeProducts, LinkArrow, RowsCard } from './OwnerFinanceProducts';
import { SPAN_ALL, SPAN_HALF } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';
import { ownerEvent } from './sample-lookups';

const KEY = 'tenantOwner.finance.overview';
const OVERVIEW = financeTabView('overview');

/** The share of the month's revenue that came from add-ons, 0-100. */
export function secondaryShare(summary: FinanceSummary): number {
  return percentOf(summary.secondary.cents, summary.total.cents);
}

/** Revenue per member since the community opened, in cents. */
export function lifetimePerMember(summary: FinanceSummary): number {
  return summary.base > 0 ? summary.lifetimeCents / summary.base : 0;
}

/** "N pedidos" (the orders of a figure). */
function ordersText(t: DashboardT, count: number): string {
  return t('tenantOwner.finance.detail.bands.orders', { count });
}

/** A number that opens its list: the whole card is a plain link landing back on itself. */
function NumberLink({ number, children }: { number: FinanceNumber; children: ReactNode }) {
  return (
    <CardLink href={ownerFinanceHref({ ...OVERVIEW, number })} id={financeNumberAnchor(number)}>
      {children}
    </CardLink>
  );
}

/**
 * The share of add-ons against the 30 days before (quick 261014-ia8 F-10): the chip carries the
 * points, its tooltip "N pontos percentuais a mais/a menos que nos 30 dias antes" ("igual aos 30
 * dias antes" with no sentiment).
 */
function shareDelta(t: DashboardT, now: number, before: number): KpiDelta {
  const amount = Math.round(Math.abs(now - before));
  const key = `${KEY}.numbers.shareChange`;
  if (amount === 0) {
    return { text: t(`${key}.same`), amount: formatCount(0), direction: 'flat', tone: 'neutral' };
  }
  const up = now > before;
  return {
    text: t(up ? `${key}.more` : `${key}.less`, { count: amount }),
    amount: formatCount(amount),
    direction: up ? 'up' : 'down',
    tone: up ? 'success' : 'danger',
    sentiment: t(up ? 'sentiment.good' : 'sentiment.bad'),
  };
}

/**
 * The cancellations of a window (D-05) as a card's value: under 5 orders "menos de 5", no value
 * (D-06); else the value, its orders beside it.
 */
export function revokedFigure(
  t: DashboardT,
  revoked: { orders: number; cents: number },
): { value: string; unit?: string } {
  return isBelowPrivacyFloor(revoked.orders)
    ? { value: formatFloored(t, revoked.orders) }
    : { value: formatBrlWhole(revoked.cents), unit: ordersText(t, revoked.orders) };
}

/**
 * (1) Números (D-07): the month's total with its orders, then the numbers each against the 30 days
 * before (the four that open their lists, the two that add up since the community opened) and the
 * cancellations. Primary and secondary revenue are the weekly charts' cards.
 */
function Numbers({ t }: { t: DashboardT }) {
  const now = ownerFinanceSummary(0);
  const before = ownerFinanceSummary(30);
  const { revoked } = ownerFinanceWindow(0, 29);
  const key = `${KEY}.numbers`;
  const seeList = t('tenantOwner.seeList');
  const delta = (current: number, previous: number, higherIsGood = true) => {
    const change = changeDelta(current, previous, higherIsGood);
    return change ? kpiDelta(t, change) : undefined;
  };
  const linked: { number: FinanceNumber; icon: LucideIcon; value: string; delta?: KpiDelta }[] = [
    {
      number: 'share',
      icon: ChartPie,
      value: formatPercent(secondaryShare(now)),
      delta: shareDelta(t, secondaryShare(now), secondaryShare(before)),
    },
    {
      number: 'rebought',
      icon: Repeat,
      value: formatCount(now.rebought),
      delta: delta(now.rebought, before.rebought),
    },
    {
      number: 'timeToSecond',
      icon: Hourglass,
      value: t(`${key}.days`, { count: Math.round(now.timeToSecondDays) }),
      delta: delta(Math.round(now.timeToSecondDays), Math.round(before.timeToSecondDays), false),
    },
    {
      number: 'lifetime',
      icon: Gem,
      value: formatBrlWhole(lifetimePerMember(now)),
      delta: delta(lifetimePerMember(now), lifetimePerMember(before)),
    },
  ];
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_ALL}>
      <KpiGrid className="@4xl:grid-cols-3 @min-[100rem]:grid-cols-6">
        <div data-finance-total className="grid">
          <KpiCard
            icon={Wallet}
            label={t(`${key}.hero.label`)}
            value={formatBrlWhole(now.total.cents)}
            delta={delta(now.total.cents, before.total.cents)}
            footer={<FooterLine icon={ShoppingBag} text={ordersText(t, now.total.orders)} />}
          />
        </div>
        {linked.map((row) => (
          <NumberLink key={row.number} number={row.number}>
            <KpiCard
              icon={row.icon}
              label={t(`${key}.${row.number}`)}
              value={row.value}
              delta={row.delta}
              linked={seeList}
            />
          </NumberLink>
        ))}
        <KpiCard
          icon={Undo2}
          label={t('tenantOwner.finance.detail.numbers.revoked')}
          {...revokedFigure(t, revoked)}
        />
      </KpiGrid>
    </PanelSection>
  );
}

/**
 * The y axis in thousands of reais ("1,5 mil"): "R$ 1,5 mil" does not fit the chart's label
 * column, and the card's value already says the values are in reais.
 */
function axisReais(t: DashboardT, cents: number): string {
  if (cents === 0) return '0';
  return t(`${KEY}.weekly.thousands`, { value: THOUSANDS.format(cents / 100_000) });
}

const THOUSANDS = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/**
 * One weekly revenue chart: the last 12 weeks and the 12 before, dashed (PD-13), at the member
 * report's fixed height. `label` names it for screen readers.
 */
export function WeeklyChart({
  t,
  label,
  current,
  previous,
}: {
  t: DashboardT;
  label: string;
  current: readonly number[];
  previous: readonly number[];
}) {
  return (
    <LineChart
      series={current}
      previous={previous}
      xLabels={current.map((_, i) =>
        (i + 1) % 4 === 0 ? t('tenantOwner.weekly.week', { week: i + 1 }) : '',
      )}
      yStep={50000}
      formatValue={(cents) => axisReais(t, cents)}
      ariaLabel={t(`${KEY}.weekly.label`, { title: label })}
      height={150}
    />
  );
}

/** The two lines of a weekly chart, compact at the foot of its card. */
export function WeeklyLegend({ t }: { t: DashboardT }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-text-secondary">
      <li className="flex items-center gap-1.5">
        <LegendStroke dashed={false} />
        {t('tenantOwner.weekly.current')}
      </li>
      <li className="flex items-center gap-1.5">
        <LegendStroke dashed />
        {t('tenantOwner.weekly.previous')}
      </li>
    </ul>
  );
}

/**
 * (2) Receita por semana: primary and secondary revenue, each a wide card with its month beside its
 * 12 weeks against the 12 before (the member's "Tempo de uso"); each opens its list. One under the
 * other from 56rem, side by side from 100rem.
 */
function Weekly({ t }: { t: DashboardT }) {
  const weekly = ownerFinanceWeekly();
  const now = ownerFinanceSummary(0);
  const before = ownerFinanceSummary(30);
  const rows = [
    { number: 'primary', icon: DoorOpen },
    { number: 'secondary', icon: PackagePlus },
  ] as const;
  return (
    <PanelSection title={t(`${KEY}.weekly.title`)} className={SPAN_ALL}>
      <div data-dash-stagger className="grid gap-3 @min-[100rem]:grid-cols-2">
        {rows.map(({ number, icon }) => {
          const change = changeDelta(now[number].cents, before[number].cents);
          return (
            <NumberLink key={number} number={number}>
              <KpiCard
                icon={icon}
                label={t(`${KEY}.numbers.${number}`)}
                value={formatBrlWhole(now[number].cents)}
                delta={change ? kpiDelta(t, change) : undefined}
                linked={t('tenantOwner.seeList')}
                chartPlacement="side"
                chart={
                  <WeeklyChart
                    t={t}
                    label={t(`${KEY}.weekly.${number}`)}
                    current={weekly[number].current}
                    previous={weekly[number].previous}
                  />
                }
                footer={<WeeklyLegend t={t} />}
              />
            </NumberLink>
          );
        })}
      </div>
    </PanelSection>
  );
}

/** One alert as a card that opens what it names: the warning tile, the line, its figures. */
function AttentionCard({
  id,
  href,
  title,
  detail,
}: {
  id?: string;
  href: string;
  title: string;
  detail?: ReactNode;
}) {
  return (
    <CardLink href={href} id={id}>
      <Card className={cn(SURFACE, RISE, LIFT, 'flex items-start gap-2.5 p-3 @3xl:p-4')}>
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning"
        >
          <TriangleAlert size={16} strokeWidth={2.2} />
        </span>
        <span className="flex min-h-8 min-w-0 flex-1 flex-col justify-center gap-1 [overflow-wrap:anywhere]">
          <span className="text-sm font-bold leading-snug text-text">{title}</span>
          {detail ? (
            <span className="text-xs font-medium text-text-secondary">{detail}</span>
          ) : null}
        </span>
        <LinkArrow />
      </Card>
    </CardLink>
  );
}

/**
 * (3) Precisa de atenção (D-07), in a fixed order, each a card that opens what it names: the VIP
 * payers fading, the accesses ending in 7 days, the product unsold for 60 days, the full event with
 * a waiting list (its waiting list in Eventos, quick 261014-ia8 F-1). Two by two from 56rem.
 */
function Attention({ t }: { t: DashboardT }) {
  const { vipFading, expiring, stalled, fullEvents } = ownerFinanceAttention();
  const key = `${KEY}.attention`;
  const listHref = (list: FinanceAttentionList) =>
    ownerFinanceHref({ ...OVERVIEW, attention: list });
  const vipName = ownerFinanceProduct(expiring.value.productId).name;
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      <div data-dash-stagger className="grid gap-3 @4xl:flex-1 @4xl:grid-cols-2">
        <AttentionCard
          id={financeAttentionAnchor('vipFading')}
          href={listHref('vipFading')}
          title={t(`${key}.vipFading`, { count: vipFading.atRisk + vipFading.inactive })}
          detail={
            <CountUp
              value={t(`${key}.vipFadingNote`, {
                atRisk: vipFading.atRisk,
                inactive: vipFading.inactive,
                push: vipFading.withPush,
              })}
            />
          }
        />
        <AttentionCard
          id={financeAttentionAnchor('expiring')}
          href={listHref('expiring')}
          title={t(`${key}.expiring`, { count: expiring.value.count, product: vipName })}
        />
        {stalled.map((row) => (
          <AttentionCard
            key={row.productId}
            id={financeProductAnchor(row.productId)}
            href={ownerFinanceHref({ ...OVERVIEW, productId: row.productId })}
            title={t(`${key}.stalled`, {
              product: ownerFinanceProduct(row.productId).name,
              days: row.days,
            })}
          />
        ))}
        {fullEvents.value.map((row) => {
          const event = ownerEvent(row.eventId);
          return (
            <AttentionCard
              key={row.eventId}
              href={ownerWaitlistHref(row.eventId)}
              title={t(`${key}.fullEvent`, { event: event.name, count: row.waiting })}
              detail={t(`${key}.fullEventNote`, { date: formatDayMonth(event.date) })}
            />
          );
        })}
      </div>
    </PanelSection>
  );
}

/** A small gray label over one column of a section (the "Por produto" of the sources). */
function ColumnLabel({ children }: { children: string }) {
  return <p className="text-xs font-bold text-text-secondary">{children}</p>;
}

/**
 * (4) De onde vem a receita: by product (the leader highlighted) and by today's band (a band under 5
 * orders shows no value, D-06), side by side from 56rem. Em risco and inativos buy nothing in the
 * month by definition (PD-4), so they have no row.
 */
function Sources({ t }: { t: DashboardT }) {
  const month = ownerFinanceWindow(0, 29);
  const products = financeProducts();
  const key = `${KEY}.sources`;
  const bands = ENGAGEMENT_BAND_ORDER.filter((band) => month.byBand[band].orders > 0);
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      <div data-dash-stagger className="grid gap-3 @4xl:flex-1 @4xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <ColumnLabel>{t(`${key}.byProduct`)}</ColumnLabel>
          <BarList
            stacked
            className="@4xl:flex @4xl:flex-1 @4xl:flex-col @4xl:justify-center"
            rows={products.map((product, i) => ({
              id: product.id,
              label: product.name,
              value: product.month.cents,
              display: formatBrlCompact(product.month.cents),
              rate:
                product.month.orders === 0
                  ? t(`${key}.noOrders`)
                  : t(`${key}.rate`, {
                      count: product.month.orders,
                      percent: formatPercent(percentOf(product.month.cents, month.total.cents)),
                    }),
              highlight: i === 0,
            }))}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <ColumnLabel>{t(`${key}.byBand`)}</ColumnLabel>
          <BarList
            stacked
            className="@4xl:flex @4xl:flex-1 @4xl:flex-col @4xl:justify-center"
            rows={bands.map((band) => {
              const row = month.byBand[band];
              const floored = isBelowPrivacyFloor(row.orders);
              return {
                id: band,
                label: bandLabel(t, band),
                value: floored ? 0 : row.cents,
                display: floored
                  ? t(`${key}.floor`, { floor: PRIVACY_FLOOR })
                  : formatBrlCompact(row.cents),
                rate: floored
                  ? undefined
                  : t(`${key}.rate`, {
                      count: row.orders,
                      percent: formatPercent(percentOf(row.cents, month.total.cents)),
                    }),
                highlight: band === 'superfan' || band === 'engaged',
              };
            })}
          />
        </div>
      </div>
    </PanelSection>
  );
}

/** "N pedidos · R$ X", or under 5 orders "menos de 5 pedidos" with no value (D-06). */
function floored(t: DashboardT, orders: number, cents: number): string {
  return isBelowPrivacyFloor(orders)
    ? t(`${KEY}.app.floor`, { floor: PRIVACY_FLOOR })
    : t(`${KEY}.app.value`, { count: orders, value: formatBrlWhole(cents) });
}

/** A figure of the app as a card's value: the sum, its orders beside it; under 5 orders, no value. */
function appFigure(t: DashboardT, sales: { orders: number; cents: number }) {
  return isBelowPrivacyFloor(sales.orders)
    ? { value: t(`${KEY}.app.floor`, { floor: PRIVACY_FLOOR }) }
    : { value: formatBrlWhole(sales.cents), unit: ordersText(t, sales.orders) };
}

/**
 * (5) O que só o app sabe: the sales by members who interacted with a publication (each publication
 * opening its detail in Conteúdo) or went to an event up to 7 days before (distinct orders), and the
 * VIP's revenue next to its use (opening the VIP). Two columns from 56rem, each figure over its rows.
 */
function AppKnows({ t }: { t: DashboardT }) {
  const content = ownerFinanceContentSales();
  const events = ownerFinanceEventSales();
  const vip = ownerFinanceVipUsage();
  const key = `${KEY}.app`;
  // A publication opens in Conteúdo; its Voltar is Conteúdo's (the proposal accepted it).
  const contentHref = (postId: string) => ownerContentHref({ ...contentTabView('posts'), postId });
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      <div data-dash-stagger className="grid gap-3 @4xl:grid-cols-2 @4xl:items-start">
        <div className="flex min-w-0 flex-col gap-3">
          <KpiCard icon={Newspaper} label={t(`${key}.content`)} {...appFigure(t, content.total)} />
          <RowsCard
            rows={[...content.posts]
              .sort((a, b) => b.cents - a.cents)
              .map((post) => ({
                id: post.postId,
                title: ownerContentItem(post.postId).excerpt,
                line: floored(t, post.orders, post.cents),
                href: contentHref(post.postId),
              }))}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <KpiCard
            icon={CalendarCheck}
            label={t(`${key}.events`)}
            {...appFigure(t, events.total)}
          />
          <RowsCard
            rows={events.events.map((row) => {
              const event = ownerEvent(row.eventId);
              return {
                id: row.eventId,
                title: event.name,
                line: floored(t, row.orders, row.cents),
                aside: formatDayMonth(event.date),
              };
            })}
          />
          <CardLink
            id={financeProductAnchor('s2')}
            href={ownerFinanceHref({ ...OVERVIEW, productId: 's2' })}
          >
            <KpiCard
              icon={Crown}
              label={t(`${key}.vip`)}
              value={formatBrlWhole(vip.cents)}
              linked={t('tenantOwner.seeDetail')}
              footer={
                <FooterLine
                  icon={Users}
                  text={t(`${key}.vipActive`, {
                    active: formatCount(vip.activeWeek),
                    holders: formatCount(vip.holders),
                  })}
                />
              }
            />
          </CardLink>
        </div>
      </div>
    </PanelSection>
  );
}

/**
 * (6) Three next steps from the numbers above, with the panel's disabled buttons: three in a row
 * from 56rem, one under the other beside "O que só o app sabe" from 100rem.
 */
function NextSteps({ t }: { t: DashboardT }) {
  const { vipFading, expiring } = ownerFinanceAttention();
  const key = `${KEY}.next`;
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      <div
        data-dash-stagger
        className="grid gap-3 @4xl:grid-cols-3 @min-[100rem]:grid-cols-1 @min-[100rem]:content-start"
      >
        <ActionCard
          icon={Crown}
          title={t(`${key}.vip.title`)}
          detail={t(`${key}.vip.detail`, { count: ownerFinanceVipProspects() })}
          action={<DisabledAction variant="outline">{t(`${key}.vip.action`)}</DisabledAction>}
        />
        <ActionCard
          icon={HeartHandshake}
          title={t(`${key}.fading.title`)}
          detail={t(`${key}.fading.detail`, {
            count: vipFading.atRisk + vipFading.inactive,
            push: vipFading.withPush,
          })}
          action={<DisabledAction variant="outline">{t(`${key}.fading.action`)}</DisabledAction>}
        />
        <ActionCard
          icon={BellRing}
          title={t(`${key}.expiring.title`)}
          detail={t(`${key}.expiring.detail`, { count: expiring.value.count })}
          action={<DisabledAction variant="outline">{t(`${key}.expiring.action`)}</DisabledAction>}
        />
      </div>
    </PanelSection>
  );
}

/**
 * Financeiro › Visão geral (D-07), on the area's grid: Números and Receita por semana across it, then
 * Precisa de atenção beside De onde vem a receita and O que só o app sabe beside Próximos passos
 * (one under the other below 100rem). Nothing here names a member: the names are one step down, in
 * the lists.
 */
export function OwnerFinanceOverview({ t }: { t: DashboardT }) {
  return (
    <>
      <Numbers t={t} />
      <Weekly t={t} />
      <Attention t={t} />
      <Sources t={t} />
      <AppKnows t={t} />
      <NextSteps t={t} />
    </>
  );
}
