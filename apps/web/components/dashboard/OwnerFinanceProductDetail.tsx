import { formatBrl } from '@rede-social/contracts/money';
import type {
  OwnerFinanceProductReady,
  OwnerFinanceReady,
} from '@rede-social/module-dashboard/contracts';
import {
  BarList,
  type BarRow,
  CountUp,
  KpiCard,
  KpiGrid,
  PRIVACY_FLOOR,
  RISE,
  SURFACE,
} from '@rede-social/module-dashboard/ui';
import { buttonClasses, Card, cn } from '@rede-social/ui';
import { CalendarX, ShoppingCart, Undo2, Users, Wallet } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getOwnerFinanceProduct } from '@/lib/dashboard';
import { contentTabView, ownerContentHref } from '@/lib/owner-content-view';
import { financeBackHref, financeRetryHref, type OwnerFinanceView } from '@/lib/owner-finance-view';
import { BackLink } from './BackLink';
import { ComingSoonBlock } from './ComingSoon';
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
import { OwnerAreaState } from './OwnerAreaState';
import type { FinanceScreenProps } from './OwnerFinance';
import {
  flooredMoneyFigure,
  flooredMoneyLine,
  WeeklyChart,
  WeeklyLegend,
} from './OwnerFinanceOverview';
import { FinanceEmpty, ProductName, RowsCard } from './OwnerFinanceProducts';
import { SPAN_ALL, SPAN_HALF } from './ownerGrid';
import { PanelSection } from './PanelSection';

const KEY = 'tenantOwner.finance';

type ProductView = OwnerFinanceView & { productId: string };

/** The product as the detail reads it: the card, and how long it has gone unsold when stalled. */
interface ProductParts {
  t: DashboardT;
  detail: OwnerFinanceProductReady;
  /** The days since the last paid order when the product is stalled ("Parado"); else null. */
  stalledDays: number | null;
}

/**
 * (1) Números: orders and buyers against the 30 days before, and the cancellations floored as text
 * (D-462); the revenue is the weekly chart's card.
 */
function Numbers({ t, detail }: ProductParts) {
  const key = `${KEY}.detail.numbers`;
  const { current, previous } = detail.product;
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
          value={formatCount(current.orders)}
          delta={delta(current.orders, previous.orders)}
        />
        <KpiCard
          icon={Users}
          label={t(`${key}.buyers`)}
          value={formatCount(current.buyers)}
          delta={delta(current.buyers, previous.buyers)}
        />
        <KpiCard
          icon={Undo2}
          label={t(`${key}.revoked`)}
          {...flooredMoneyFigure(t, detail.revoked)}
        />
      </KpiGrid>
    </PanelSection>
  );
}

/**
 * (3) Compradores por faixa (PD-14, UI-D-470): the window's orders by the buyer's band of today, the
 * bands under the floor merged by the API (`mergeBandsBelowFloor`) and labelled by `bandGroupLabel`;
 * a floored group is its floor text (no value, rate or fill, sorted last), a group of 0 "nenhum
 * pedido". Then the product's buyers on the store's own screen (D-461).
 */
function BuyersByBand({ t, detail }: ProductParts) {
  const key = `${KEY}.detail.bands`;
  const rows: BarRow[] = detail.byBand.map((group) => {
    const id = group.bands.join('-');
    const label = bandGroupLabel(t, group.bands);
    const highlight = group.bands.includes('superfan') || group.bands.includes('engaged');
    if (group.sales.belowFloor) {
      return { id, label, floored: true, display: t(`${key}.floor`, { floor: PRIVACY_FLOOR }) };
    }
    if (group.sales.orders === 0) {
      return { id, label, value: 0, display: t(`${key}.orders`, { count: 0 }) };
    }
    return {
      id,
      label,
      value: group.sales.cents,
      display: formatBrlCompact(group.sales.cents),
      rate: t(`${key}.orders`, { count: group.sales.orders }),
      highlight,
    };
  });
  return (
    <PanelSection title={t(`${key}.title`)}>
      <div data-finance-product-bands className="flex min-w-0 flex-col gap-3 @4xl:flex-1">
        {detail.product.current.orders === 0 ? (
          <FinanceEmpty id="product-bands" text={t(`${key}.empty`)} />
        ) : (
          <BarList
            stacked
            className="@4xl:flex @4xl:flex-1 @4xl:flex-col @4xl:justify-center"
            rows={rows}
          />
        )}
        <a
          data-finance-buyers-link
          href={`/loja/${detail.product.productId}/compradores`}
          className={cn(buttonClasses({ variant: 'outline', size: 'sm' }), 'self-start')}
        >
          {t(`${KEY}.detail.buyers`)}
        </a>
      </div>
    </PanelSection>
  );
}

/**
 * (5) Compras depois de uma publicação (PR-6: an association, never a cause): the publications a
 * buyer liked or commented up to 7 days before an order of this product, each floored (D-462) and
 * opening its detail in Conteúdo; one outside the window's publications is named as such. Absent
 * with `feed` off (the API sends no `posts`).
 */
function SoldAfter({
  t,
  detail,
  postTitles,
}: ProductParts & { postTitles: ReadonlyMap<string, string> }) {
  const posts = detail.posts;
  if (!posts) return null;
  const key = `${KEY}.detail.posts`;
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_HALF}>
      <div data-finance-product-posts className="flex min-w-0 flex-col gap-3">
        {posts.length === 0 ? (
          <FinanceEmpty id="product-posts" text={t(`${key}.empty`)} />
        ) : (
          <RowsCard
            rows={posts.map((post) => ({
              id: post.postId,
              title: postTitles.get(post.postId) ?? t('tenantOwner.finance.overview.app.olderPost'),
              ...flooredMoneyLine(t, post.sales),
              href: ownerContentHref({ ...contentTabView('posts'), postId: post.postId }),
            }))}
          />
        )}
      </div>
    </PanelSection>
  );
}

/**
 * The product's header across the area: its 16:7 cover (beside the name from 56rem), the live name
 * with "Parado", the store price and, for a stalled product, how long it has gone unsold.
 */
function Header({ t, detail, stalledDays }: ProductParts) {
  const { product } = detail;
  return (
    <Card className={cn(SURFACE, RISE, SPAN_ALL, 'flex flex-col @4xl:flex-row')}>
      <div className="@4xl:w-80 @4xl:shrink-0">
        <CoverThumb t={t} kind="order" seed={product.productId} variant="banner" />
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2 p-4 [overflow-wrap:anywhere] @4xl:px-6">
        <ProductName t={t} name={product.name} stalled={stalledDays !== null} as="h3" />
        <span className="text-sm font-medium text-text-secondary">
          <CountUp
            value={t(`${KEY}.products.priceLine`, { value: formatBrl(product.priceCents) })}
          />
        </span>
        {stalledDays === null ? null : (
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-text">
            <CalendarX aria-hidden size={14} className="shrink-0 text-warning" />
            <CountUp value={t(`${KEY}.detail.numbers.unsold`, { days: stalledDays })} />
          </p>
        )}
      </div>
    </Card>
  );
}

export interface OwnerFinanceProductDetailViewProps {
  t: DashboardT;
  view: ProductView;
  /** The area answer: whether the product is stalled, and for how long. */
  answer: Pick<OwnerFinanceReady, 'attention'>;
  /** The ready `GET …/finance/products/{productId}` answer. */
  detail: OwnerFinanceProductReady;
  postTitles: ReadonlyMap<string, string>;
}

/**
 * A product opened from its card or from Visão geral (D-08, 08.7-10): "Voltar" to where it opened,
 * the header, the revenue beside its weeks with Números, Compradores por faixa with the store's
 * buyers screen, "Ofertas" as an "Em breve" block (D-455: there is no offer table) and the
 * publications its sales came after. On the area's grid: the header across it, the cards paired.
 */
export function OwnerFinanceProductDetailView({
  t,
  view,
  answer,
  detail,
  postTitles,
}: OwnerFinanceProductDetailViewProps) {
  const back = financeBackHref(view);
  if (back === null) throw new Error('a product detail with no way back');
  const { product } = detail;
  const stalled = answer.attention.stalled.find((row) => row.productId === product.productId);
  const parts: ProductParts = { t, detail, stalledDays: stalled?.days ?? null };
  const change = changeDelta(product.current.cents, product.previous.cents);
  return (
    <>
      <div className={SPAN_ALL}>
        <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      </div>
      <Header {...parts} />

      <PanelSection title={t(`${KEY}.detail.weekly`)} className={SPAN_HALF}>
        <KpiCard
          icon={Wallet}
          label={t(`${KEY}.detail.numbers.revenue`)}
          value={formatBrlWhole(product.current.cents)}
          delta={change ? kpiDelta(t, change) : undefined}
          chartPlacement="side"
          chart={
            <WeeklyChart
              t={t}
              label={t(`${KEY}.detail.weeklyChart`, { product: product.name })}
              current={detail.weekly.current}
              previous={detail.weekly.previous}
            />
          }
          footer={<WeeklyLegend t={t} />}
        />
      </PanelSection>

      <Numbers {...parts} />

      <BuyersByBand {...parts} />

      <div className="flex min-w-0 flex-col">
        <ComingSoonBlock
          title={t(`${KEY}.offers.title`)}
          label={t('report.comingSoon.value')}
          note={t('report.comingSoon.block')}
        />
      </div>

      <SoldAfter {...parts} postTitles={postTitles} />
    </>
  );
}

export interface OwnerFinanceProductDetailProps extends FinanceScreenProps {
  view: ProductView;
  /** The level above (Produtos, or Visão geral): a product the API does not know falls back to it. */
  fallback: ReactNode;
}

/**
 * The product detail read from `GET …/finance/products/{productId}` (08.7-09), streamed in its own
 * `Suspense` by the caller (UI-D-482): an unknown, other-tenant or post-build id (the API's bare 404)
 * falls back to the level above (D-06); a failed read is the detail's error card (UI-D-479).
 */
export async function OwnerFinanceProductDetail({
  t,
  view,
  answer,
  postTitles,
  fallback,
}: OwnerFinanceProductDetailProps): Promise<ReactNode> {
  const read = await getOwnerFinanceProduct(view.productId);
  if (read.status === 'redirect') redirect(read.path);
  if (read.status === 'notFound') return fallback;
  if (read.status === 'error') {
    return <OwnerAreaState kind="error" body="detail" retryHref={financeRetryHref(view)} />;
  }
  if (read.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  return (
    <OwnerFinanceProductDetailView
      t={t}
      view={view}
      answer={answer}
      detail={read.answer}
      postTitles={postTitles}
    />
  );
}
