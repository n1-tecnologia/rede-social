import { formatBrl } from '@rede-social/contracts/money';
import {
  FINANCE_STALLED_DAYS,
  type FinanceProductSummary,
  ownerFinanceProduct,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
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
import { ownerWaitlistHref } from '@/lib/owner-band-scope';
import {
  financeProductAnchor,
  financeTabView,
  type OwnerFinanceView,
  ownerFinanceHref,
} from '@/lib/owner-finance-view';
import { EventCard, eventRevenue } from './BandScopeCards';
import { CardLink } from './CardLink';
import { type CoverKind, CoverThumb } from './CoverThumb';
import {
  changeDelta,
  type DashboardT,
  formatBrlCompact,
  formatCount,
  formatDayMonth,
  kpiDelta,
} from './format';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

const KEY = 'tenantOwner.finance.products';

/** Every store product's card numbers, best revenue of the month first. */
export function financeProducts(): FinanceProductSummary[] {
  return tenantOwnerPanel.store.products
    .map((row) => ownerFinanceProduct(row.id))
    .sort((a, b) => b.month.cents - a.month.cents || a.name.localeCompare(b.name));
}

/** Each store product's cover icon (quick 261014-ia8 F-7); an unknown product reads as an order. */
const PRODUCT_COVER: Readonly<Record<string, CoverKind>> = {
  s1: 'mentoring',
  s2: 'community',
  s3: 'ebook',
  s4: 'recorded',
};

export function productCoverKind(id: string): CoverKind {
  return PRODUCT_COVER[id] ?? 'order';
}

/** Stalled: no paid order for over 60 days (PD-9). */
export function isStalled(product: FinanceProductSummary): boolean {
  return product.lastSaleDaysAgo === null || product.lastSaleDaysAgo > FINANCE_STALLED_DAYS;
}

/** A card grid that pairs from 56rem and puts four side by side from 100rem; its cards rise in turn. */
export const CARD_GRID = 'grid gap-3 @4xl:grid-cols-2 @min-[100rem]:grid-cols-4';

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
export function ProductChange({ t, product }: { t: DashboardT; product: FinanceProductSummary }) {
  const delta = changeDelta(product.month.cents, product.before.cents);
  if (delta) return <DeltaChip delta={kpiDelta(t, delta)} />;
  return (
    <span className="text-xs text-text-secondary">
      {t(product.month.cents === 0 ? `${KEY}.noSales` : `${KEY}.newSales`)}
    </span>
  );
}

/** The product's name (the detail's heading), with the "Parado" pill when it stalled. */
export function ProductName({
  t,
  product,
  as: Name = 'span',
}: {
  t: DashboardT;
  product: FinanceProductSummary;
  as?: 'span' | 'h3';
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Name className="text-xl font-bold leading-tight text-text">{product.name}</Name>
      {isStalled(product) ? <StatusPill tone="warning">{t(`${KEY}.stalled`)}</StatusPill> : null}
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
                  <CountUp value={row.line} />
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
                <div className={ROW}>{body}</div>
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
 * One product as a card (D-08, PD-9): a low cover band with the product's icon and tone (quick
 * 261014-ia8 F-7), the name, four columns split by thin lines (the store price, the month's sales as
 * an entry and as an add-on, the revenue), the change against the 30 days before in a chip and the
 * linked card's arrow: the whole card opens the product and lifts on hover.
 */
function ProductCard({
  t,
  product,
  href,
}: {
  t: DashboardT;
  product: FinanceProductSummary;
  href: string;
}) {
  return (
    <CardLink href={href} className="h-full">
      <Card className={cn(SURFACE, RISE, LIFT, 'flex flex-col')}>
        <CoverThumb t={t} kind={productCoverKind(product.id)} seed={product.id} variant="strip" />
        {/* A container: the four columns become two rows of two when the card is narrower than
            20rem (a 360 px phone), so "R$ 4,1 mil" never gets cut. */}
        <div className="@container flex flex-1 flex-col gap-3 p-4 [overflow-wrap:anywhere]">
          <ProductName t={t} product={product} />
          <dl className="grid grid-cols-2 gap-y-3 border-t border-border pt-3 @xs:grid-cols-[repeat(4,minmax(max-content,1fr))] @xs:gap-y-0">
            {[
              { label: t(`${KEY}.price`), value: formatBrl(product.priceCents) },
              { label: t(`${KEY}.entry`), value: formatCount(product.month.entry) },
              { label: t(`${KEY}.addon`), value: formatCount(product.month.addon) },
              { label: t(`${KEY}.revenue`), value: formatBrlCompact(product.month.cents) },
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
            <ProductChange t={t} product={product} />
            <LinkArrow />
            <span className="sr-only">{t('tenantOwner.seeDetail')}</span>
          </span>
        </div>
      </Card>
    </CardLink>
  );
}

/** The paid events: the next ones soonest first, then the past ones most recent first (PD-12). */
function paidEvents() {
  const { upcoming, past } = tenantOwnerPanel.events;
  const paid = (event: { ticketCents: { value: number } }) => event.ticketCents.value > 0;
  return {
    events: [
      ...upcoming.filter(paid).sort((a, b) => a.date.localeCompare(b.date)),
      ...past.filter(paid).sort((a, b) => b.date.localeCompare(a.date)),
    ],
    upcomingIds: new Set(upcoming.map((event) => event.id)),
  };
}

/** The people waiting for a seat of a full event, or null when it is not full or nobody waits. */
function waitingFor(event: { id: string; confirmed: number; capacity: number | null }) {
  const row = tenantOwnerPanel.events.waitlist.value.find((entry) => entry.eventId === event.id);
  const full = event.capacity !== null && event.confirmed >= event.capacity;
  return full && row && row.waiting > 0 ? row.waiting : null;
}

/**
 * Eventos pagos (D-04, PD-12): the events with a ticket, each as the events' card under a low cover
 * of its format (quick 261014-ia8 F-7): date, registrations and revenue, the ticket on the gray line.
 * A full event with people waiting says so and opens its waiting list in Eventos (quick 261014-ia8
 * F-1); the others open nothing. Their revenue is never part of the store's total.
 */
function PaidEvents({ t }: { t: DashboardT }) {
  const { events, upcomingIds } = paidEvents();
  const key = 'tenantOwner.finance.events';
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_ALL}>
      <ul data-dash-stagger className={CARD_GRID}>
        {events.map((event) => {
          // Only an event still to come has people waiting; a past one says when it happened.
          const upcoming = upcomingIds.has(event.id);
          const waiting = upcoming ? waitingFor(event) : null;
          return (
            <li key={event.id} id={`evento-${event.id}`} className="grid min-w-0 scroll-mt-20">
              <EventCard
                t={t}
                id={event.id}
                href={waiting === null ? null : ownerWaitlistHref(event.id)}
                status={
                  waiting !== null
                    ? t(`${key}.full`, { count: waiting })
                    : upcoming
                      ? undefined
                      : t(`${key}.happened`, { date: formatDayMonth(event.date) })
                }
                cover={<CoverThumb t={t} kind={event.format} seed={event.id} variant="strip" />}
                detail={t(`${key}.ticket`, { value: formatBrl(event.ticketCents.value) })}
                cells={[
                  { label: t(`${key}.date`), value: formatDayMonth(event.date) },
                  { label: t(`${key}.confirmed`), value: formatCount(event.confirmed) },
                  { label: t(`${key}.revenue`), value: eventRevenue(t, event) },
                ]}
              >
                {waiting === null ? null : (
                  <span className="flex items-center justify-between gap-2 text-sm font-bold text-brand">
                    {t(`${key}.seeWaitlist`)}
                    <ChevronRight aria-hidden size={18} className="shrink-0" />
                  </span>
                )}
              </EventCard>
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
}

/**
 * Produtos (D-08): the store's products by the month's revenue, each opening its detail, then the
 * paid events. Both read across the area, their cards paired from 56rem and four in a row from 100rem.
 */
export function OwnerFinanceProducts({ t }: { t: DashboardT; view: OwnerFinanceView }) {
  const products = financeProducts();
  return (
    <>
      <PanelSection title={t(`${KEY}.title`)} className={SPAN_ALL}>
        <ul data-dash-stagger className={CARD_GRID}>
          {products.map((product) => (
            <li
              key={product.id}
              id={financeProductAnchor(product.id)}
              className="grid min-w-0 scroll-mt-20"
            >
              <ProductCard
                t={t}
                product={product}
                href={ownerFinanceHref({ ...financeTabView('products'), productId: product.id })}
              />
            </li>
          ))}
        </ul>
      </PanelSection>
      <PaidEvents t={t} />
    </>
  );
}
