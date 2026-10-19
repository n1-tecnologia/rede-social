import { formatBrl } from '@rede-social/contracts/money';
import type {
  FinanceTotals,
  OwnerFinanceProductSummary,
  OwnerFinanceReady,
} from '@rede-social/module-dashboard/contracts';
import { CountUp, type KpiDelta, LIFT, RISE, SURFACE } from '@rede-social/module-dashboard/ui';
import { Card, cn, StatusPill } from '@rede-social/ui';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronRight,
  type LucideIcon,
  Minus,
} from 'lucide-react';
import { financeProductAnchor, financeTabView, ownerFinanceHref } from '@/lib/owner-finance-view';
import { CardLink } from './CardLink';
import { ComingSoonBlock } from './ComingSoon';
import { CoverThumb } from './CoverThumb';
import { changeDelta, type DashboardT, formatBrlCompact, formatCount, kpiDelta } from './format';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

const KEY = 'tenantOwner.finance.products';

/** A card grid that pairs from 56rem and puts four side by side from 100rem; its cards rise in turn. */
export const CARD_GRID = 'grid gap-3 @4xl:grid-cols-2 @min-[100rem]:grid-cols-4';

/** The products the answer names as stalled ("Parado": no paid order for over 60 days). */
export function stalledProductIds(answer: Pick<OwnerFinanceReady, 'attention'>): Set<string> {
  return new Set(answer.attention.stalled.map((row) => row.productId));
}

/** One block's empty sentence, inside its card (UI-D-481). */
export function FinanceEmpty({ id, text }: { id: string; text: string }) {
  return (
    <Card className={cn(SURFACE, RISE, 'p-4')}>
      <p data-owner-empty={id} className="text-xs font-normal text-text-secondary">
        {text}
      </p>
    </Card>
  );
}

const ARROW = { up: ArrowUp, down: ArrowDown, flat: Minus } as const;

const TONE_CHIP = {
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  neutral: 'bg-bg-tertiary text-text-secondary',
} as const;

/**
 * A change as the KPI cards draw it: a compact chip (arrow + amount), the whole comparison in its
 * tooltip and for screen readers, with the sentiment.
 */
export function DeltaChip({ delta }: { delta: KpiDelta }) {
  const Arrow = ARROW[delta.direction];
  return (
    <span
      title={delta.text}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums',
        TONE_CHIP[delta.tone],
      )}
    >
      <Arrow aria-hidden size={12} strokeWidth={2.6} className="shrink-0" />
      <span aria-hidden>{delta.amount ?? delta.text}</span>
      <span className="sr-only">{delta.text}</span>
      {delta.sentiment ? <span className="sr-only">{delta.sentiment}</span> : null}
    </span>
  );
}

/** The revenue against the 30 days before; a product that sold in neither says so, with no chip. */
export function ProductChange({
  t,
  current,
  previous,
}: {
  t: DashboardT;
  current: Pick<FinanceTotals, 'cents'>;
  previous: Pick<FinanceTotals, 'cents'>;
}) {
  const delta = changeDelta(current.cents, previous.cents);
  if (delta) return <DeltaChip delta={kpiDelta(t, delta)} />;
  return (
    <span className="text-xs text-text-secondary">
      {t(current.cents === 0 ? `${KEY}.noSales` : `${KEY}.newSales`)}
    </span>
  );
}

/** The product's live name (the detail's heading), with the "Parado" pill when it stalled. */
export function ProductName({
  t,
  name,
  stalled,
  as: Name = 'span',
}: {
  t: DashboardT;
  name: string;
  stalled: boolean;
  as?: 'span' | 'h3';
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Name className="text-xl font-bold leading-tight text-text">{name}</Name>
      {stalled ? <StatusPill tone="warning">{t(`${KEY}.stalled`)}</StatusPill> : null}
    </span>
  );
}

/** A linked card's corner arrow, as the KPI cards': it turns brand and nudges on hover. */
export function LinkArrow() {
  return (
    <ArrowUpRight
      aria-hidden
      size={16}
      className="shrink-0 text-text-tertiary transition-[color,transform] duration-300 ease-out group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-brand motion-reduce:transition-none"
    />
  );
}

/** A card's last line: a small brand icon and a short figure that counts up (the member's "Pico"). */
export function FooterLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-text-secondary">
      <Icon aria-hidden size={14} className="shrink-0 text-brand" />
      <CountUp value={text} />
    </p>
  );
}

/** One row of a list card: a title, a line of figures, an optional value on the right. */
export interface FinanceRow {
  id: string;
  title: string;
  line: string;
  aside?: string;
  /** The whole row opens this; none: a plain row. */
  href?: string;
  /** The row's id, so a "Voltar" can land on it. */
  anchor?: string;
  /** A floored line (UI-D-470): plain text, never counting up. */
  floored?: boolean;
}

const ROW = 'flex items-center gap-3 px-3 py-2.5 @3xl:px-4';

/** A list in one surface, the member lists' rows: each a title over its figures, linked or not. */
export function RowsCard({ rows }: { rows: readonly FinanceRow[] }) {
  return (
    <Card className={cn(SURFACE, RISE)}>
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const body = (
            <>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                <span className="line-clamp-2 text-sm font-semibold text-text">{row.title}</span>
                <span className="text-xs font-medium text-text-secondary">
                  {row.floored ? row.line : <CountUp value={row.line} />}
                </span>
              </span>
              {row.aside ? (
                <span className="shrink-0 text-xs font-bold tabular-nums text-text">
                  {row.aside}
                </span>
              ) : null}
              {row.href ? (
                <ChevronRight aria-hidden size={16} className="shrink-0 text-brand" />
              ) : null}
            </>
          );
          return (
            <li key={row.id}>
              {row.href ? (
                <a
                  id={row.anchor}
                  href={row.href}
                  className={cn(
                    ROW,
                    'scroll-mt-20 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
                  )}
                >
                  {body}
                </a>
              ) : (
                <div id={row.anchor} className={cn(ROW, row.anchor && 'scroll-mt-20')}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** One column of a card: the small gray label, then the bold value, counting up. */
function ValueCell({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col justify-between gap-0.5', className)}>
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="text-lg font-extrabold tracking-tight text-text tabular-nums [overflow-wrap:normal]">
        <CountUp value={value} />
      </dd>
    </div>
  );
}

/** Thin lines between the columns: between each pair in two rows, between all four in one. */
const CELL_EDGES = [
  'pr-2',
  'border-l border-border px-2 @xs:pr-2',
  'pr-2 @xs:border-l @xs:border-border @xs:px-2',
  'border-l border-border px-2 @xs:pr-0',
] as const;

/**
 * One product as a card (D-08, PD-9): a low cover band (the store's order icon, its tone seeded by
 * the product), the live name, four columns split by thin lines (the store price, the window's sales
 * as an entry and as an add-on, the revenue), the change against the 30 days before in a chip and the
 * linked card's arrow: the whole card opens the product and lifts on hover.
 */
function ProductCard({
  t,
  product,
  stalled,
  href,
}: {
  t: DashboardT;
  product: OwnerFinanceProductSummary;
  stalled: boolean;
  href: string;
}) {
  return (
    <CardLink href={href} className="h-full">
      <Card className={cn(SURFACE, RISE, LIFT, 'flex flex-col')}>
        <CoverThumb t={t} kind="order" seed={product.productId} variant="strip" />
        {/* A container: the four columns become two rows of two when the card is narrower than
            20rem (a 360 px phone), so "R$ 4,1 mil" never gets cut. */}
        <div className="@container flex flex-1 flex-col gap-3 p-4 [overflow-wrap:anywhere]">
          <ProductName t={t} name={product.name} stalled={stalled} />
          <dl className="grid grid-cols-2 gap-y-3 border-t border-border pt-3 @xs:grid-cols-[repeat(4,minmax(max-content,1fr))] @xs:gap-y-0">
            {[
              { label: t(`${KEY}.price`), value: formatBrl(product.priceCents) },
              { label: t(`${KEY}.entry`), value: formatCount(product.current.entry) },
              { label: t(`${KEY}.addon`), value: formatCount(product.current.addon) },
              { label: t(`${KEY}.revenue`), value: formatBrlCompact(product.current.cents) },
            ].map((cell, i) => (
              <ValueCell
                key={cell.label}
                label={cell.label}
                value={cell.value}
                className={CELL_EDGES[i] ?? ''}
              />
            ))}
          </dl>
          <span className="mt-auto flex items-center justify-between gap-2">
            <ProductChange t={t} current={product.current} previous={product.previous} />
            <LinkArrow />
            <span className="sr-only">{t('tenantOwner.seeDetail')}</span>
          </span>
        </div>
      </Card>
    </CardLink>
  );
}

/**
 * Produtos (D-08, 08.7-10): the store's products by the window's revenue (the API's order: cents
 * desc, then the live name), each opening its detail, then "Eventos pagos" as an "Em breve" block
 * (D-455: no event ticket is sold yet). A store with no product says so in one sentence (UI-D-481).
 */
export function OwnerFinanceProducts({
  t,
  answer,
}: {
  t: DashboardT;
  answer: Pick<OwnerFinanceReady, 'byProduct' | 'attention'>;
}) {
  const stalled = stalledProductIds(answer);
  return (
    <>
      <PanelSection title={t(`${KEY}.title`)} className={SPAN_ALL}>
        {answer.byProduct.length === 0 ? (
          <FinanceEmpty id="products" text={t(`${KEY}.empty`)} />
        ) : (
          <ul data-dash-stagger data-finance-products className={CARD_GRID}>
            {answer.byProduct.map((product) => (
              <li
                key={product.productId}
                id={financeProductAnchor(product.productId)}
                className="grid min-w-0 scroll-mt-20"
              >
                <ProductCard
                  t={t}
                  product={product}
                  stalled={stalled.has(product.productId)}
                  href={ownerFinanceHref({
                    ...financeTabView('products'),
                    productId: product.productId,
                  })}
                />
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      <div className={SPAN_ALL}>
        <ComingSoonBlock
          title={t('tenantOwner.finance.events.title')}
          label={t('report.comingSoon.value')}
          note={t('report.comingSoon.block')}
        />
      </div>
    </>
  );
}
