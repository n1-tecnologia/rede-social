import type { FlooredMoney, OwnerFinanceReady } from '@rede-social/module-dashboard/contracts';
import {
  BarList,
  type BarRow,
  Collapsible,
  ENGAGEMENT_BAND_ORDER,
  PRIVACY_FLOOR,
  RISE,
  SURFACE,
} from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import { Footprints } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getOwnerFinanceBuyers } from '@/lib/dashboard';
import type { EngagementBand } from '@/lib/owner-band-scope';
import { FINANCE_FIRST_PAGE, financeBuyerRowViews } from '@/lib/owner-finance-rows';
import {
  financeNeverAnchor,
  financeTabView,
  type OwnerFinanceView,
  ownerFinanceHref,
} from '@/lib/owner-finance-view';
import type { MemberRowView } from '@/lib/owner-list-view';
import { bandGroupLabel, bandLabel, type DashboardT, formatBrlWhole } from './format';
import type { FinanceScreenProps } from './OwnerFinance';
import { NeverAction } from './OwnerFinancePeople';
import { FinanceEmpty, RowsCard } from './OwnerFinanceProducts';
import { OwnerListMore } from './OwnerListMore';
import { OwnerListRows } from './OwnerListRows';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

const KEY = 'tenantOwner.finance.buyers';

/** A cell beside its pair from 56rem, half the area (two of four cells) from 100rem. */
const WIDE_HALF = '@min-[100rem]:col-span-2';

/** The first page of one band's buyers, or a failed read (the band's own error line). */
export type FinanceBandList =
  | { status: 'ready'; rows: MemberRowView[]; total: number; nextCursor: string | null }
  | { status: 'error' };

/** Whether a band group bought in the window: a floored group did (1-4 buyers), a group of 0 did not. */
function groupBought(sales: FlooredMoney): boolean {
  return sales.belowFloor || sales.orders > 0;
}

/** Whether a band may hold buyers: its group (bands merged by the API, C-1) bought in the window. */
function boughtIn(answer: Pick<OwnerFinanceReady, 'byBand'>, band: EngagementBand): boolean {
  const group = answer.byBand.find((row) => row.bands.includes(band));
  return group !== undefined && groupBought(group.sales);
}

/** One band's buyers inside its open row: the member cards, "Ver todos" continuing in place. */
function BandBuyers({
  t,
  band,
  list,
}: {
  t: DashboardT;
  band: EngagementBand;
  list: FinanceBandList | undefined;
}) {
  if (!list || list.status === 'error') {
    return <p className="text-sm text-text-secondary">{t('report.errors.list')}</p>;
  }
  if (list.rows.length === 0) {
    return <p className="text-sm text-text-secondary">{t('tenantOwner.finance.lists.empty')}</p>;
  }
  const more = list.total - list.rows.length;
  return (
    <>
      <OwnerListRows rows={list.rows} layout="cards" />
      {list.nextCursor !== null ? (
        <OwnerListMore
          request={{ kind: 'finance-buyers', list: 'band', band }}
          cursor={list.nextCursor}
          layout="cards"
          more={more > 0 ? t('tenantOwner.finance.lists.band.more', { count: more }) : null}
          labels={{
            seeAll: t('tenantOwner.bandMembers.seeAll'),
            error: t('report.errors.more'),
            retry: t('report.errors.retry'),
          }}
        />
      ) : null}
    </>
  );
}

/**
 * (1) Receita por faixa (D-09): the window by the buyer's band of today, in the groups the API merged
 * so no band of 1-4 buyers stands beside the total (C-1, labelled by `bandGroupLabel`) — a floored
 * group is the floor text with no value (D-462, UI-D-470), a group of 0 a plain row that opens
 * nothing; opened, a group shows the buyers of each of its bands (named, admin only), each opening
 * the panel's member detail.
 */
function Bands({
  t,
  view,
  answer,
  lists,
}: {
  t: DashboardT;
  view: OwnerFinanceView;
  answer: OwnerFinanceReady;
  lists: Partial<Record<EngagementBand, FinanceBandList>>;
}) {
  return (
    <PanelSection title={t(`${KEY}.bands.title`)} className={SPAN_ALL}>
      <div data-dash-stagger className="grid gap-3 @4xl:grid-cols-2 @4xl:items-start">
        {answer.byBand.map(({ bands, sales }) => {
          const id = bands.join('-');
          const title = bandGroupLabel(t, bands);
          if (!groupBought(sales)) {
            return (
              <Card
                key={id}
                className={cn(SURFACE, RISE, 'flex flex-wrap items-center gap-x-2 gap-y-1 p-4')}
              >
                <span className="text-sm font-bold text-text">{title}</span>
                <span className="text-xs text-text-secondary">{t(`${KEY}.bands.none`)}</span>
              </Card>
            );
          }
          const summary = sales.belowFloor
            ? t(`${KEY}.bands.floor`, { floor: PRIVACY_FLOOR })
            : t(`${KEY}.bands.summary`, {
                value: formatBrlWhole(sales.cents),
                orders: sales.orders,
                buyers: sales.buyers,
              });
          // A merged group lists the bands that hold buyers; a single band keeps its own empty line.
          const shown =
            bands.length === 1
              ? bands
              : bands.filter((band) => {
                  const list = lists[band];
                  return list === undefined || list.status === 'error' || list.rows.length > 0;
                });
          return (
            <Collapsible
              key={id}
              open={view.band !== null && bands.includes(view.band)}
              title={title}
              summary={summary}
            >
              {(shown.length > 0 ? shown : bands.slice(0, 1)).map((band) => (
                <BandBuyers key={band} t={t} band={band} list={lists[band]} />
              ))}
            </Collapsible>
          );
        })}
      </div>
    </PanelSection>
  );
}

/**
 * (2) Escada de compra (PD-15): from the first paid product to the second, by the products' live
 * names; how many took each path and the average days. The paths under 5 people are summed into
 * "outros caminhos" by the API, itself floored when still under 5 (no value, rate or fill, last).
 * No row opens: who bought again is the overview's number. With no second purchase, one sentence.
 */
function Ladder({ t, answer }: { t: DashboardT; answer: OwnerFinanceReady }) {
  const { paths, others } = answer.ladder;
  const names = new Map(answer.byProduct.map((product) => [product.productId, product.name]));
  const nameOf = (id: string) => names.get(id) ?? t('tenantOwner.memberLists.removedProduct');
  const days = (value: number) => t(`${KEY}.ladder.days`, { count: Math.round(value) });
  // A step icon on each row stacks the bar list: a path's name is too long for a side column.
  const step = (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"
    >
      <Footprints size={16} strokeWidth={2.2} />
    </span>
  );
  const rows: BarRow[] = paths.map((path, i) => ({
    id: `${path.entryProductId}-${path.nextProductId}`,
    label: t(`${KEY}.ladder.path`, {
      from: nameOf(path.entryProductId),
      to: nameOf(path.nextProductId),
    }),
    value: path.people,
    display: t(`${KEY}.ladder.people`, { count: path.people }),
    rate: days(path.averageDays),
    highlight: i === 0,
    leading: step,
  }));
  if (others) {
    const label = t(`${KEY}.ladder.others`, { count: others.paths });
    rows.push(
      others.belowFloor
        ? {
            id: 'others',
            label,
            floored: true,
            display: t(`${KEY}.ladder.floor`, { floor: PRIVACY_FLOOR }),
            leading: step,
          }
        : {
            id: 'others',
            label,
            value: others.people,
            display: t(`${KEY}.ladder.people`, { count: others.people }),
            rate: days(others.averageDays),
            leading: step,
          },
    );
  }
  return (
    <PanelSection title={t(`${KEY}.ladder.title`)} className={WIDE_HALF}>
      {rows.length === 0 ? (
        <FinanceEmpty id="ladder" text={t(`${KEY}.ladder.empty`)} />
      ) : (
        <div data-finance-ladder>
          <BarList rows={rows} />
        </div>
      )}
    </PanelSection>
  );
}

/**
 * (3) Entraram e nunca compraram de novo (D-09), by band: a band of 1-4 reads "menos de 5", a band of
 * 0 "nenhum membro"; a band with someone opens its list. Then the suggested action, disabled with
 * the pill; its count only when no band is floored (a sum would reveal the floored ones).
 */
function NeverAgain({ t, answer }: { t: DashboardT; answer: OwnerFinanceReady }) {
  const never = answer.neverAgain;
  const floored = ENGAGEMENT_BAND_ORDER.some((band) => never[band].belowFloor);
  const total = floored
    ? null
    : ENGAGEMENT_BAND_ORDER.reduce((sum, band) => {
        const row = never[band];
        return sum + (row.belowFloor ? 0 : row.value);
      }, 0);
  return (
    <PanelSection title={t(`${KEY}.never.title`)} className={WIDE_HALF}>
      <div
        data-finance-never
        data-dash-stagger
        className="grid gap-3 @min-[100rem]:grid-cols-2 @min-[100rem]:items-start"
      >
        <RowsCard
          rows={ENGAGEMENT_BAND_ORDER.map((band) => {
            const row = never[band];
            const someone = row.belowFloor || row.value > 0;
            return {
              id: band,
              title: bandLabel(t, band),
              line: row.belowFloor
                ? t('belowFloor', { floor: PRIVACY_FLOOR })
                : t(`${KEY}.never.row`, { count: row.value }),
              floored: row.belowFloor,
              ...(someone
                ? {
                    anchor: financeNeverAnchor(band),
                    href: ownerFinanceHref({ ...financeTabView('buyers'), neverBand: band }),
                  }
                : {}),
            };
          })}
        />
        <NeverAction t={t} total={total} />
      </div>
    </PanelSection>
  );
}

export interface OwnerFinanceBuyersViewProps {
  t: DashboardT;
  view: OwnerFinanceView;
  answer: OwnerFinanceReady;
  /** The first page of each band that bought (read by the async wrapper). */
  lists: Partial<Record<EngagementBand, FinanceBandList>>;
}

/**
 * Financeiro › Quem compra (D-09, 08.7-10): revenue by band across the area (each band opening its
 * buyers), then the purchase ladder by product and who never bought again, paired.
 */
export function OwnerFinanceBuyersView({ t, view, answer, lists }: OwnerFinanceBuyersViewProps) {
  return (
    <>
      <Bands t={t} view={view} answer={answer} lists={lists} />
      <Ladder t={t} answer={answer} />
      <NeverAgain t={t} answer={answer} />
    </>
  );
}

/**
 * Quem compra on the API (08.7-10), streamed in its own `Suspense` by the caller: the first page of
 * every band that bought (a closed `<details>` opens without a request, so its list is already
 * there), read in parallel from `GET …/finance/buyers/band`; a failed band read is that band's own
 * error line, never the whole tab.
 */
export async function OwnerFinanceBuyers({
  t,
  view,
  answer,
  timeZone,
}: FinanceScreenProps): Promise<ReactNode> {
  const nowMs = Date.now();
  const lists: Partial<Record<EngagementBand, FinanceBandList>> = {};
  const refusals: string[] = [];
  await Promise.all(
    ENGAGEMENT_BAND_ORDER.filter((band) => boughtIn(answer, band)).map(async (band) => {
      const read = await getOwnerFinanceBuyers('band', { band, limit: FINANCE_FIRST_PAGE });
      if (read.status === 'redirect') {
        refusals.push(read.path);
        return;
      }
      if (read.status !== 'ok' || read.answer.state !== 'ready') {
        lists[band] = { status: 'error' };
        return;
      }
      lists[band] = {
        status: 'ready',
        rows: financeBuyerRowViews(t, read.answer, { timeZone, nowMs }),
        total: read.answer.total,
        nextCursor: read.answer.nextCursor,
      };
    }),
  );
  const [refusal] = refusals;
  if (refusal) redirect(refusal);
  return <OwnerFinanceBuyersView t={t} view={view} answer={answer} lists={lists} />;
}
