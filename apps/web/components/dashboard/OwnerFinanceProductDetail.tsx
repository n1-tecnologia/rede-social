import { formatBrl } from '@rede-social/contracts/money';
import {
  type EngagementBand,
  type FinanceOffer,
  type FinanceProductDetail,
  financeProductOffers,
  ownerContentItem,
  ownerFinanceProductDetail,
  ownerFinanceWindow,
} from '@rede-social/module-dashboard/fixtures';
import {
  BarList,
  CountUp,
  ENGAGEMENT_BAND_ORDER,
  isBelowPrivacyFloor,
  KpiCard,
  KpiGrid,
  LIFT,
  mergeBandsBelowFloor,
  PRIVACY_FLOOR,
  RISE,
  SURFACE,
} from '@rede-social/module-dashboard/ui';
import { Card, cn, StatusPill } from '@rede-social/ui';
import { CalendarX, ShoppingCart, Undo2, Users, Wallet } from 'lucide-react';
import { contentTabView, ownerContentHref } from '@/lib/owner-content-view';
import {
  financeBackHref,
  financeOfferAnchor,
  type OwnerFinanceView,
  ownerFinanceHref,
} from '@/lib/owner-finance-view';
import { BackLink } from './BackLink';
import { CardLink } from './CardLink';
import { CoverThumb } from './CoverThumb';
import {
  bandGroupLabel,
  changeDelta,
  type DashboardT,
  formatBrlCompact,
  formatBrlWhole,
  formatCount,
  kpiDelta,
} from './format';
import { revokedFigure, WeeklyChart, WeeklyLegend } from './OwnerFinanceOverview';
import { LinkArrow, ProductName, productCoverKind, RowsCard } from './OwnerFinanceProducts';
import { SPAN_ALL, SPAN_HALF } from './ownerGrid';
import { PanelSection } from './PanelSection';

const KEY = 'tenantOwner.finance';

/** A section's empty state, on the section's surface. */
function EmptyCard({ children }: { children: string }) {
  return <Card className={cn(SURFACE, RISE, 'p-4 text-sm text-text-secondary')}>{children}</Card>;
}

/**
 * One offer as a card (D-08): the composition, Entrada or Adicional, the price and the month's orders
 * and value. With orders the whole card opens its buyers and lifts on hover; without, it says so and
 * goes nowhere.
 */
function OfferCard({
  t,
  offer,
  href,
  orders,
  cents,
}: {
  t: DashboardT;
  offer: FinanceOffer;
  href: string | null;
  orders: number;
  cents: number;
}) {
  const card = (
    <Card
      className={cn(
        SURFACE,
        RISE,
        href !== null && LIFT,
        'flex items-start gap-3 p-3 [overflow-wrap:anywhere] @3xl:p-4',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-sm font-bold leading-snug text-text">{offer.composition}</span>
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill tone={offer.kind === 'entry' ? 'brand' : 'neutral'}>
            {t(`${KEY}.offers.${offer.kind}`)}
          </StatusPill>
          <span className="text-sm font-extrabold tracking-tight text-text tabular-nums">
            <CountUp value={formatBrl(offer.priceCents)} />
          </span>
        </span>
        <span className="text-xs font-medium text-text-secondary">
          {orders === 0 ? (
            t(`${KEY}.offers.none`)
          ) : (
            <CountUp
              value={t(`${KEY}.detail.posts.value`, {
                count: orders,
                value: formatBrlWhole(cents),
              })}
            />
          )}
        </span>
      </span>
      {href !== null ? (
        <>
          <LinkArrow />
          <span className="sr-only">{t('tenantOwner.seeList')}</span>
        </>
      ) : null}
    </Card>
  );
  return href === null ? card : <CardLink href={href}>{card}</CardLink>;
}

/**
 * (1) Números: orders and buyers against the 30 days before, and the cancellations (D-05); the
 * revenue is the weekly chart's card.
 */
function Numbers({ t, product }: { t: DashboardT; product: FinanceProductDetail }) {
  const key = `${KEY}.detail.numbers`;
  const delta = (now: number, before: number) => {
    const change = changeDelta(now, before);
    return change ? kpiDelta(t, change) : undefined;
  };
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      <KpiGrid className="@4xl:flex-1 @4xl:grid-cols-3">
        <KpiCard
          icon={ShoppingCart}
          label={t(`${key}.orders`)}
          value={formatCount(product.month.orders)}
          delta={delta(product.month.orders, product.before.orders)}
        />
        <KpiCard
          icon={Users}
          label={t(`${key}.buyers`)}
          value={formatCount(product.month.buyers)}
          delta={delta(product.month.buyers, product.before.buyers)}
        />
        <KpiCard icon={Undo2} label={t(`${key}.revoked`)} {...revokedFigure(t, product.revoked)} />
      </KpiGrid>
    </PanelSection>
  );
}

/**
 * (3) Compradores por faixa (PD-14): the month's orders by the buyer's band of today, the bands
 * under 5 orders merged with a neighbour (C-1), so no small band is read nor deduced from the total;
 * a value only from 5 orders on (D-06).
 */
function BuyersByBand({ t, product }: { t: DashboardT; product: FinanceProductDetail }) {
  const key = `${KEY}.detail.bands`;
  const counts = Object.fromEntries(
    ENGAGEMENT_BAND_ORDER.map((band) => [band, product.byBand[band].orders]),
  ) as Record<EngagementBand, number>;
  const groups = mergeBandsBelowFloor({ counts, newActivated: 0 });
  return (
    <PanelSection title={t(`${key}.title`)}>
      {product.month.orders === 0 ? (
        <EmptyCard>{t(`${key}.empty`)}</EmptyCard>
      ) : (
        <BarList
          stacked
          className="@4xl:flex @4xl:flex-1 @4xl:flex-col @4xl:justify-center"
          rows={groups.map((group) => {
            const cents = group.bands.reduce((sum, band) => sum + product.byBand[band].cents, 0);
            const floored = isBelowPrivacyFloor(group.count);
            return {
              id: group.bands.join('-'),
              // A band with no order adds nothing to the row's name.
              label: bandGroupLabel(
                t,
                group.bands.filter((band) => counts[band] > 0),
              ),
              value: floored ? 0 : cents,
              display: floored
                ? t(`${key}.floor`, { floor: PRIVACY_FLOOR })
                : formatBrlCompact(cents),
              rate: floored ? undefined : t(`${key}.orders`, { count: group.count }),
              highlight: group.bands.includes('superfan') || group.bands.includes('engaged'),
            };
          })}
        />
      )}
    </PanelSection>
  );
}

/** (5) Publicações que venderam: each opens its detail in Conteúdo. */
function SoldBy({ t, product }: { t: DashboardT; product: FinanceProductDetail }) {
  const key = `${KEY}.detail.posts`;
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      {product.posts.length === 0 ? (
        <EmptyCard>{t(`${key}.empty`)}</EmptyCard>
      ) : (
        <RowsCard
          rows={product.posts.map((post) => ({
            id: post.postId,
            title: ownerContentItem(post.postId).excerpt,
            line: isBelowPrivacyFloor(post.orders)
              ? t(`${key}.floor`, { floor: PRIVACY_FLOOR })
              : t(`${key}.value`, { count: post.orders, value: formatBrlWhole(post.cents) }),
            href: ownerContentHref({ ...contentTabView('posts'), postId: post.postId }),
          }))}
        />
      )}
    </PanelSection>
  );
}

/**
 * The product's header across the area: its 16:7 cover (beside the name from 56rem), the name with
 * "Parado", the store price and, for a product with no sale in the month, how long it has been.
 */
function Header({ t, product }: { t: DashboardT; product: FinanceProductDetail }) {
  const unsold = product.month.orders === 0 ? product.lastSaleDaysAgo : null;
  return (
    <Card className={cn(SURFACE, RISE, SPAN_ALL, 'flex flex-col @4xl:flex-row')}>
      <div className="@4xl:w-80 @4xl:shrink-0">
        <CoverThumb t={t} kind={productCoverKind(product.id)} seed={product.id} variant="banner" />
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2 p-4 [overflow-wrap:anywhere] @4xl:px-6">
        <ProductName t={t} product={product} as="h3" />
        <span className="text-sm font-medium text-text-secondary">
          <CountUp
            value={t(`${KEY}.products.priceLine`, { value: formatBrl(product.priceCents) })}
          />
        </span>
        {unsold === null ? null : (
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-text">
            <CalendarX aria-hidden size={14} className="shrink-0 text-warning" />
            <CountUp value={t(`${KEY}.detail.numbers.unsold`, { days: unsold })} />
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * A product opened from its card or from Visão geral (D-08): "Voltar" to where it opened, the header
 * (cover, name, "Parado", the store price), then the revenue beside its weeks with Números, then
 * Compradores por faixa, the offers (the entry first, each opening the month's buyers) and the
 * publications that sold it. On the area's grid: the header and the chart across it below 100rem,
 * the cards paired.
 */
export function OwnerFinanceProductDetail({ t, view }: { t: DashboardT; view: OwnerFinanceView }) {
  const back = financeBackHref(view);
  if (!view.productId || back === null) throw new Error('a product detail with no product');
  const product = ownerFinanceProductDetail(view.productId);
  const { byOffer } = ownerFinanceWindow(0, 29);
  const change = changeDelta(product.month.cents, product.before.cents);

  return (
    <>
      <div className={SPAN_ALL}>
        <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      </div>
      <Header t={t} product={product} />

      <PanelSection title={t(`${KEY}.detail.weekly`)} className={SPAN_HALF}>
        <KpiCard
          icon={Wallet}
          label={t(`${KEY}.detail.numbers.revenue`)}
          value={formatBrlWhole(product.month.cents)}
          delta={change ? kpiDelta(t, change) : undefined}
          chartPlacement="side"
          chart={
            <WeeklyChart
              t={t}
              label={t(`${KEY}.detail.weeklyChart`, { product: product.name })}
              current={product.weekly.current}
              previous={product.weekly.previous}
            />
          }
          footer={<WeeklyLegend t={t} />}
        />
      </PanelSection>

      <Numbers t={t} product={product} />

      <BuyersByBand t={t} product={product} />

      <PanelSection title={t(`${KEY}.offers.title`)}>
        <ul data-dash-stagger className="flex flex-col gap-3 @4xl:flex-1">
          {financeProductOffers(product.id).map((offer) => {
            const { orders, cents } = byOffer[offer.id];
            return (
              <li key={offer.id} id={financeOfferAnchor(offer.id)} className="grid scroll-mt-20">
                <OfferCard
                  t={t}
                  offer={offer}
                  orders={orders}
                  cents={cents}
                  href={orders === 0 ? null : ownerFinanceHref({ ...view, offerId: offer.id })}
                />
              </li>
            );
          })}
        </ul>
      </PanelSection>

      <SoldBy t={t} product={product} />
    </>
  );
}
