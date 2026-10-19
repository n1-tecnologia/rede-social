import type {
  FinanceSummary,
  FlooredMoney,
  OwnerFinanceReady,
} from '@rede-social/module-dashboard/contracts';
import {
  ActionCard,
  BarList,
  type BarRow,
  CountUp,
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
import { contentTabView, ownerContentHref } from '@/lib/owner-content-view';
import {
  type FinanceNumber,
  financeAttentionAnchor,
  financeNumberAnchor,
  financeProductAnchor,
  financeTabView,
  ownerFinanceHref,
} from '@/lib/owner-finance-view';
import type { OwnerPanelFlags } from '@/lib/owner-panel';
import { CardLink } from './CardLink';
import { ComingSoonPill } from './ComingSoon';
import {
  bandGroupLabel,
  changeDelta,
  type DashboardT,
  formatBrlCompact,
  formatBrlWhole,
  formatCount,
  formatPercent,
  kpiDelta,
} from './format';
import { LegendStroke } from './LegendStroke';
import {
  FinanceEmpty,
  type FinanceRow,
  FooterLine,
  LinkArrow,
  RowsCard,
} from './OwnerFinanceProducts';
import { SPAN_ALL, SPAN_HALF } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

const KEY = 'tenantOwner.finance.overview';
const OVERVIEW = financeTabView('overview');

/** The share of the window's revenue that came from add-ons, 0-100. */
export function secondaryShare(
  answer: Pick<OwnerFinanceReady, 'totals' | 'secondary'>,
  at: 'current' | 'previous',
): number {
  return percentOf(answer.secondary[at].cents, answer.totals[at].cents);
}

/** Revenue per member since the community opened, in cents. */
export function lifetimePerMember(summary: Pick<FinanceSummary, 'base' | 'lifetimeCents'>): number {
  return summary.base > 0 ? summary.lifetimeCents / summary.base : 0;
}

/** "N pedidos" (the orders of a figure; "nenhum pedido" for 0). */
function ordersText(t: DashboardT, count: number): string {
  return t('tenantOwner.finance.detail.bands.orders', { count });
}

/** The shipped floor text of an order group, "menos de 5 pedidos" (UI-D-470). */
export function ordersFloor(t: DashboardT): string {
  return t(`${KEY}.sources.floor`, { floor: PRIVACY_FLOOR });
}

/**
 * A money group as a card's value (D-462, UI-D-470): floored, the floor text alone — no value, no
 * orders, no count-up; else the whole reais with its orders beside it (0 is "R$ 0 nenhum pedido").
 */
export function flooredMoneyFigure(
  t: DashboardT,
  sales: FlooredMoney,
): { value: ReactNode; unit?: string } {
  if (sales.belowFloor) return { value: <span data-floored>{ordersFloor(t)}</span> };
  return { value: formatBrlWhole(sales.cents), unit: ordersText(t, sales.orders) };
}

/** A money group as a row's line: "N pedidos · R$ X", or the floor text (UI-D-470). */
export function flooredMoneyLine(
  t: DashboardT,
  sales: FlooredMoney,
): Pick<FinanceRow, 'line' | 'floored'> {
  if (sales.belowFloor) return { line: ordersFloor(t), floored: true };
  return {
    line: t(`${KEY}.app.value`, { count: sales.orders, value: formatBrlWhole(sales.cents) }),
  };
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

/** The KPI chip of a raw current against its raw previous (`changeDelta`), or none. */
function deltaOf(t: DashboardT, current: number, previous: number, higherIsGood = true) {
  const change = changeDelta(current, previous, higherIsGood);
  return change ? kpiDelta(t, change) : undefined;
}

/**
 * (1) Números (D-07): the window's total with its orders, then the numbers each against the 30 days
 * before (the four that open their lists, the two that add up since the community opened) and the
 * cancellations, floored as text. Primary and secondary revenue are the weekly charts' cards.
 */
function Numbers({ t, answer }: { t: DashboardT; answer: OwnerFinanceReady }) {
  const now = answer.summary.current;
  const before = answer.summary.previous;
  const totals = answer.totals;
  const key = `${KEY}.numbers`;
  const seeList = t('tenantOwner.seeList');
  const share = secondaryShare(answer, 'current');
  const days = now.timeToSecondDays === null ? null : Math.round(now.timeToSecondDays);
  const daysBefore = before.timeToSecondDays === null ? null : Math.round(before.timeToSecondDays);
  const linked: { number: FinanceNumber; icon: LucideIcon; value: string; delta?: KpiDelta }[] = [
    {
      number: 'share',
      icon: ChartPie,
      value: formatPercent(share),
      delta: shareDelta(t, share, secondaryShare(answer, 'previous')),
    },
    {
      number: 'rebought',
      icon: Repeat,
      value: formatCount(now.rebought),
      // The D-30 group under the floor travels with no number (WR-06): no change chip then.
      delta: before.rebought.belowFloor
        ? undefined
        : deltaOf(t, now.rebought, before.rebought.value),
    },
    {
      number: 'timeToSecond',
      icon: Hourglass,
      value: days === null ? t(`${key}.noSecond`) : t(`${key}.days`, { count: days }),
      delta: days === null || daysBefore === null ? undefined : deltaOf(t, days, daysBefore, false),
    },
    {
      number: 'lifetime',
      icon: Gem,
      value: formatBrlWhole(lifetimePerMember(now)),
      delta: deltaOf(t, lifetimePerMember(now), lifetimePerMember(before)),
    },
  ];
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_ALL}>
      <KpiGrid className="@4xl:grid-cols-3 @min-[100rem]:grid-cols-6">
        <div data-finance-total className="grid">
          <KpiCard
            icon={Wallet}
            label={t(`${key}.hero.label`)}
            value={formatBrlWhole(totals.current.cents)}
            delta={deltaOf(t, totals.current.cents, totals.previous.cents)}
            footer={<FooterLine icon={ShoppingBag} text={ordersText(t, totals.current.orders)} />}
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
          {...flooredMoneyFigure(t, answer.revoked.current)}
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
 * (2) Receita por semana: primary and secondary revenue, each a wide card with its window beside its
 * 12 weeks against the 12 before; each opens its list. One under the other from 56rem, side by side
 * from 100rem.
 */
function Weekly({ t, answer }: { t: DashboardT; answer: OwnerFinanceReady }) {
  const rows = [
    { number: 'primary', icon: DoorOpen },
    { number: 'secondary', icon: PackagePlus },
  ] as const;
  return (
    <PanelSection title={t(`${KEY}.weekly.title`)} className={SPAN_ALL}>
      <div data-dash-stagger className="grid gap-3 @min-[100rem]:grid-cols-2">
        {rows.map(({ number, icon }) => (
          <NumberLink key={number} number={number}>
            <KpiCard
              icon={icon}
              label={t(`${KEY}.numbers.${number}`)}
              value={formatBrlWhole(answer[number].current.cents)}
              delta={deltaOf(t, answer[number].current.cents, answer[number].previous.cents)}
              linked={t('tenantOwner.seeList')}
              chartPlacement="side"
              chart={
                <WeeklyChart
                  t={t}
                  label={t(`${KEY}.weekly.${number}`)}
                  current={answer.weekly[number].current}
                  previous={answer.weekly[number].previous}
                />
              }
              footer={<WeeklyLegend t={t} />}
            />
          </NumberLink>
        ))}
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
 * An attention row with no data source yet (UI-D-466 b, the line form): its label and the neutral
 * "Em breve" pill in place of its figures; it opens nothing (D-455, D-465).
 */
function ComingSoonRow({ id, label, pill }: { id: string; label: string; pill: string }) {
  return (
    <Card
      data-finance-attention={id}
      className={cn(SURFACE, RISE, 'flex items-center justify-between gap-2 p-3 @3xl:p-4')}
    >
      <span className="min-w-0 text-sm font-bold leading-snug text-text [overflow-wrap:anywhere]">
        {label}
      </span>
      <ComingSoonPill label={pill} className="shrink-0" />
    </Card>
  );
}

/**
 * (3) Precisa de atenção (D-07): the VIP payers fading (with a VIP, UI-D-490; the push fragment
 * dropped with `notifications` off, UI-D-489 d) and each product unsold for over 60 days, each a card
 * that opens what it names; "Nada precisa de atenção." when neither has a row (UI-D-481). Then the
 * accesses ending in 7 days and the full events with a waiting list, as "Em breve" lines (D-465,
 * D-455). Two by two from 56rem.
 */
function Attention({
  t,
  answer,
  flags,
}: {
  t: DashboardT;
  answer: OwnerFinanceReady;
  flags: OwnerPanelFlags;
}) {
  const key = `${KEY}.attention`;
  const { vip } = answer;
  const fading = vip ? vip.fading.atRisk + vip.fading.inactive : 0;
  const pill = t('report.comingSoon.value');
  const cards: ReactNode[] = [];
  if (vip && fading > 0) {
    const values = { atRisk: vip.fading.atRisk, inactive: vip.fading.inactive };
    cards.push(
      <AttentionCard
        key="vip"
        id={financeAttentionAnchor('vipFading')}
        href={ownerFinanceHref({ ...OVERVIEW, attention: 'vipFading' })}
        title={t(`${key}.vipFading`, { count: fading, community: vip.communityName })}
        detail={
          <CountUp
            value={
              flags.notifications
                ? t(`${key}.vipFadingNote`, { ...values, push: vip.fading.withPush })
                : t(`${key}.vipFadingNoteNoPush`, values)
            }
          />
        }
      />,
    );
  }
  for (const row of answer.attention.stalled) {
    cards.push(
      <AttentionCard
        key={row.productId}
        id={financeProductAnchor(row.productId)}
        href={ownerFinanceHref({ ...OVERVIEW, productId: row.productId })}
        title={t(`${key}.stalled`, { product: row.name, days: row.days })}
      />,
    );
  }
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      <div data-dash-stagger className="grid gap-3 @4xl:flex-1 @4xl:grid-cols-2">
        {cards.length === 0 ? (
          <div className="@4xl:col-span-2">
            <FinanceEmpty id="attention" text={t(`${key}.empty`)} />
          </div>
        ) : (
          cards
        )}
        <ComingSoonRow id="expiring" label={t(`${key}.expiring`)} pill={pill} />
        <ComingSoonRow id="fullEvents" label={t(`${key}.fullEvents`)} pill={pill} />
      </div>
    </PanelSection>
  );
}

/** A small gray label over one column of a section (the "Por produto" of the sources). */
function ColumnLabel({ children }: { children: string }) {
  return <p className="text-xs font-bold text-text-secondary">{children}</p>;
}

/**
 * (4) De onde vem a receita: by product (the store leader highlighted) and by today's band, side by
 * side from 56rem. The bands come merged by the API so no band of 1-4 buyers stands beside the total
 * (C-1), labelled by `bandGroupLabel`; a floored group (a whole base under 5) is a floored row (no
 * value, rate or fill, sorted last); a group of 0 reads "nenhum pedido" (UI-D-470: zero is not floored). A window with no order is one
 * sentence (UI-D-481).
 */
function Sources({ t, answer }: { t: DashboardT; answer: OwnerFinanceReady }) {
  const key = `${KEY}.sources`;
  const total = answer.totals.current;
  const products = answer.byProduct.filter(
    (product) => product.status === 'active' || product.current.orders > 0,
  );
  const rate = (orders: number, cents: number) =>
    t(`${key}.rate`, { count: orders, percent: formatPercent(percentOf(cents, total.cents)) });
  const bandRows: BarRow[] = answer.byBand.map(({ bands, sales }) => {
    const id = bands.join('-');
    const label = bandGroupLabel(t, bands);
    const highlight = bands.includes('superfan') || bands.includes('engaged');
    if (sales.belowFloor) return { id, label, floored: true, display: ordersFloor(t) };
    if (sales.orders === 0) return { id, label, value: 0, display: t(`${key}.noOrders`) };
    return {
      id,
      label,
      value: sales.cents,
      display: formatBrlCompact(sales.cents),
      rate: rate(sales.orders, sales.cents),
      highlight,
    };
  });
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      {total.orders === 0 ? (
        <FinanceEmpty id="sources" text={t(`${key}.empty`)} />
      ) : (
        <div data-dash-stagger className="grid gap-3 @4xl:flex-1 @4xl:grid-cols-2">
          <div data-finance-sources="product" className="flex min-w-0 flex-col gap-2">
            <ColumnLabel>{t(`${key}.byProduct`)}</ColumnLabel>
            <BarList
              stacked
              className="@4xl:flex @4xl:flex-1 @4xl:flex-col @4xl:justify-center"
              rows={products.map((product, i) => ({
                id: product.productId,
                label: product.name,
                value: product.current.cents,
                display: formatBrlCompact(product.current.cents),
                rate:
                  product.current.orders === 0
                    ? t(`${key}.noOrders`)
                    : rate(product.current.orders, product.current.cents),
                highlight: i === 0 && product.current.cents > 0,
              }))}
            />
          </div>
          <div data-finance-sources="band" className="flex min-w-0 flex-col gap-2">
            <ColumnLabel>{t(`${key}.byBand`)}</ColumnLabel>
            <BarList
              stacked
              className="@4xl:flex @4xl:flex-1 @4xl:flex-col @4xl:justify-center"
              rows={bandRows}
            />
          </div>
        </div>
      )}
    </PanelSection>
  );
}

/**
 * (5) O que só o app sabe (PR-6: an association, never a cause): the orders paid up to 7 days after
 * the buyer liked or commented a publication (each publication opening its detail in Conteúdo; one
 * outside the window's publications is named as such) or checked in at an event, each group floored
 * (D-462), in the API's order (most orders first, floored ones last); a total the API withheld (null:
 * it would give a floored row back by subtraction, C-1) leaves only its label; then the exclusive community's
 * revenue next to who holds it (UI-D-490). A block whose module is off is absent (`feed`, `events`,
 * the VIP); with none left the section is.
 */
function AppKnows({
  t,
  answer,
  postTitles,
}: {
  t: DashboardT;
  answer: OwnerFinanceReady;
  postTitles: ReadonlyMap<string, string>;
}) {
  const key = `${KEY}.app`;
  const { contentSales, eventSales, vip } = answer;
  if (!contentSales && !eventSales && !vip) return null;
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      <div
        data-finance-app
        data-dash-stagger
        className="grid gap-3 @4xl:grid-cols-2 @4xl:items-start"
      >
        {contentSales ? (
          <div className="flex min-w-0 flex-col gap-3">
            {contentSales.total ? (
              <KpiCard
                icon={Newspaper}
                label={t(`${key}.content`)}
                {...flooredMoneyFigure(t, contentSales.total)}
              />
            ) : (
              <ColumnLabel>{t(`${key}.content`)}</ColumnLabel>
            )}
            {contentSales.posts.length > 0 ? (
              <RowsCard
                rows={contentSales.posts.map((post) => ({
                  id: post.postId,
                  title: postTitles.get(post.postId) ?? t(`${key}.olderPost`),
                  ...flooredMoneyLine(t, post.sales),
                  href: ownerContentHref({ ...contentTabView('posts'), postId: post.postId }),
                }))}
              />
            ) : null}
          </div>
        ) : null}
        {eventSales || vip ? (
          <div className="flex min-w-0 flex-col gap-3">
            {eventSales ? (
              <>
                {eventSales.total ? (
                  <KpiCard
                    icon={CalendarCheck}
                    label={t(`${key}.events`)}
                    {...flooredMoneyFigure(t, eventSales.total)}
                  />
                ) : (
                  <ColumnLabel>{t(`${key}.events`)}</ColumnLabel>
                )}
                {eventSales.events.length > 0 ? (
                  <RowsCard
                    rows={eventSales.events.map((event) => ({
                      id: event.eventId,
                      title: event.title,
                      ...flooredMoneyLine(t, event.sales),
                    }))}
                  />
                ) : null}
              </>
            ) : null}
            {vip ? (
              <KpiCard
                icon={Crown}
                label={t(`${key}.vip`, { community: vip.communityName })}
                value={formatBrlWhole(vip.revenueCents)}
                footer={
                  <FooterLine icon={Users} text={t(`${key}.vipHolders`, { count: vip.holders })} />
                }
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </PanelSection>
  );
}

/**
 * (6) Next steps from the numbers above, every action disabled with the "Em breve" pill (UI-D-478,
 * PR-4: no outreach from the panel): offer the exclusive community to who entered by the most common
 * entry product and win back its fading payers (both with a VIP, UI-D-490), and remind who has an
 * expiring access — its title kept, its detail the tile note: no access expiry is recorded (D-465).
 */
function NextSteps({
  t,
  answer,
  flags,
}: {
  t: DashboardT;
  answer: OwnerFinanceReady;
  flags: OwnerPanelFlags;
}) {
  const key = `${KEY}.next`;
  const pill = t('report.comingSoon.value');
  const { vip } = answer;
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      <div
        data-dash-stagger
        className="grid gap-3 @4xl:grid-cols-3 @min-[100rem]:grid-cols-1 @min-[100rem]:content-start"
      >
        {vip?.entryProductName ? (
          <div data-finance-next="vip" className="grid">
            <ActionCard
              icon={Crown}
              title={t(`${key}.vip.title`, {
                community: vip.communityName,
                product: vip.entryProductName,
              })}
              detail={t(`${key}.vip.detail`, {
                count: vip.prospects.belowFloor
                  ? t('belowFloor', { floor: PRIVACY_FLOOR })
                  : vip.prospects.value,
                community: vip.communityName,
                product: vip.entryProductName,
              })}
              action={
                <DisabledAction variant="outline" pill={pill}>
                  {t(`${key}.vip.action`)}
                </DisabledAction>
              }
            />
          </div>
        ) : null}
        {vip ? (
          <div data-finance-next="fading" className="grid">
            <ActionCard
              icon={HeartHandshake}
              title={t(`${key}.fading.title`)}
              detail={t(
                flags.notifications ? `${key}.fading.detail` : `${key}.fading.detailNoPush`,
                {
                  count: vip.fading.atRisk + vip.fading.inactive,
                  community: vip.communityName,
                  push: vip.fading.withPush,
                },
              )}
              action={
                <DisabledAction variant="outline" pill={pill}>
                  {t(`${key}.fading.action`)}
                </DisabledAction>
              }
            />
          </div>
        ) : null}
        <div data-finance-next="expiring" className="grid">
          <ActionCard
            icon={BellRing}
            title={t(`${key}.expiring.title`)}
            detail={t('report.comingSoon.note')}
            action={
              <DisabledAction variant="outline" pill={pill}>
                {t(`${key}.expiring.action`)}
              </DisabledAction>
            }
          />
        </div>
      </div>
    </PanelSection>
  );
}

export interface OwnerFinanceOverviewProps {
  t: DashboardT;
  /** The ready `GET /v1/dashboard/owner/finance` answer. */
  answer: OwnerFinanceReady;
  /** The panel's module flags: the push fragments follow `notifications` (UI-D-489 d). */
  flags: OwnerPanelFlags;
  /** The live captions of the window's publications (Conteúdo's answer), by post id. */
  postTitles: ReadonlyMap<string, string>;
}

/**
 * Financeiro › Visão geral on the snapshot (D-07, 08.7-10), on the area's grid: Números and Receita
 * por semana across it, then Precisa de atenção beside De onde vem a receita and O que só o app sabe
 * beside Próximos passos (one under the other below 100rem). Nothing here names a member: the names
 * are one step down, in the lists.
 */
export function OwnerFinanceOverview({ t, answer, flags, postTitles }: OwnerFinanceOverviewProps) {
  return (
    <>
      <Numbers t={t} answer={answer} />
      <Weekly t={t} answer={answer} />
      <Attention t={t} answer={answer} flags={flags} />
      <Sources t={t} answer={answer} />
      <AppKnows t={t} answer={answer} postTitles={postTitles} />
      <NextSteps t={t} answer={answer} flags={flags} />
    </>
  );
}
