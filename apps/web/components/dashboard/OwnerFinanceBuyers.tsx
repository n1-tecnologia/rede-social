import {
  type EngagementBand,
  financeOffer,
  ownerFinanceBands,
  ownerFinanceNeverAgain,
  ownerFinancePaths,
  ownerFinanceProduct,
} from '@rede-social/module-dashboard/fixtures';
import {
  ActionCard,
  BarList,
  Collapsible,
  ENGAGEMENT_BAND_ORDER,
  isBelowPrivacyFloor,
  KpiCard,
  PRIVACY_FLOOR,
  percentOf,
  RISE,
  SURFACE,
} from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import { Crown, Footprints, Sparkles, Users } from 'lucide-react';
import {
  financeNeverAnchor,
  financeTabView,
  type OwnerFinanceView,
  ownerFinanceHref,
} from '@/lib/owner-finance-view';
import { BandSummary } from './BandMembers';
import {
  bandGroupLabel,
  bandLabel,
  type DashboardT,
  formatBrlWhole,
  formatCount,
  formatPercent,
} from './format';
import { BandBuyers } from './OwnerFinancePeople';
import { FooterLine, RowsCard } from './OwnerFinanceProducts';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

const KEY = 'tenantOwner.finance.buyers';
const ACTIVE: readonly EngagementBand[] = ['superfan', 'engaged'];

/** A cell beside its pair from 56rem, half the area (two of four cells) from 100rem. */
const WIDE_HALF = '@min-[100rem]:col-span-2';

/**
 * (1) Receita por faixa (D-09): how much superfãs and engajados bring, as a card (their share of the
 * month's revenue and of the members), then the six bands in order, each summing the month (under 5
 * orders, no value: D-06) with the band's mini bar; opened, its buyers. Em risco and inativos bought
 * nothing by definition (PD-4): their row opens nothing. Across the area: from 56rem the card on
 * the left, the rows two by two beside it.
 */
function Bands({ t, view }: { t: DashboardT; view: OwnerFinanceView }) {
  const bands = ownerFinanceBands();
  const total = ENGAGEMENT_BAND_ORDER.reduce((sum, band) => sum + bands[band].cents, 0);
  const members = ENGAGEMENT_BAND_ORDER.reduce((sum, band) => sum + bands[band].members, 0);
  const activeCents = ACTIVE.reduce((sum, band) => sum + bands[band].cents, 0);
  const activeMembers = ACTIVE.reduce((sum, band) => sum + bands[band].members, 0);
  return (
    <PanelSection title={t(`${KEY}.bands.title`)} className={SPAN_ALL}>
      <div data-dash-stagger className="grid gap-3 @4xl:grid-cols-3 @4xl:items-start">
        <KpiCard
          icon={Crown}
          label={bandGroupLabel(t, ACTIVE)}
          value={formatPercent(percentOf(activeCents, total))}
          unit={t('tenantOwner.finance.overview.numbers.shareNote')}
          footer={
            <FooterLine
              icon={Users}
              text={t(`${KEY}.bands.members`, {
                percent: formatPercent(percentOf(activeMembers, members)),
              })}
            />
          }
        />
        <div
          data-dash-stagger
          className="grid gap-3 @4xl:col-span-2 @4xl:grid-cols-2 @4xl:items-start"
        >
          {ENGAGEMENT_BAND_ORDER.map((band) => {
            const row = bands[band];
            const label =
              row.orders === 0
                ? t(`${KEY}.bands.none`)
                : isBelowPrivacyFloor(row.orders)
                  ? t(`${KEY}.bands.floor`, { floor: PRIVACY_FLOOR })
                  : t(`${KEY}.bands.summary`, {
                      value: formatBrlWhole(row.cents),
                      orders: row.orders,
                      buyers: row.buyers,
                      percent: formatPercent(percentOf(row.buyers, row.members)),
                    });
            const summary = (
              <BandSummary t={t} band={band} count={row.buyers} total={row.members} label={label} />
            );
            // A band that bought nothing has nothing to open: a plain row, as the open one's summary.
            if (row.buyers === 0) {
              return (
                <Card
                  key={band}
                  className={cn(SURFACE, RISE, 'flex flex-wrap items-center gap-x-2 gap-y-1 p-4')}
                >
                  <span className="text-sm font-bold text-text">{bandLabel(t, band)}</span>
                  <span className="text-xs text-text-secondary">{summary}</span>
                </Card>
              );
            }
            return (
              <Collapsible
                key={band}
                open={band === view.band}
                title={bandLabel(t, band)}
                summary={summary}
              >
                <BandBuyers t={t} view={financeTabView('buyers')} band={band} />
              </Collapsible>
            );
          })}
        </div>
      </div>
    </PanelSection>
  );
}

/** "E-book de entrada → Comunidade VIP": the path's two offers by their products. */
function pathLabel(t: DashboardT, entry: string, next: string): string {
  return t(`${KEY}.ladder.path`, {
    from: ownerFinanceProduct(financeOffer(entry).productId).name,
    to: ownerFinanceProduct(financeOffer(next).productId).name,
  });
}

/**
 * (2) Escada de compra (PD-15): from the entry offer to the second purchase, since each member
 * joined; how many took each path and the average days, the paths under 5 people together last.
 * No row opens: who bought again is already the overview's number.
 */
function Ladder({ t }: { t: DashboardT }) {
  const { paths, others } = ownerFinancePaths();
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
  return (
    <PanelSection title={t(`${KEY}.ladder.title`)} className={WIDE_HALF}>
      <BarList
        rows={[
          ...paths.map((path, i) => ({
            id: `${path.entry}-${path.next}`,
            label: pathLabel(t, path.entry, path.next),
            value: path.people,
            display: t(`${KEY}.ladder.people`, { count: path.people }),
            rate: days(path.averageDays),
            highlight: i === 0,
            leading: step,
          })),
          ...(others
            ? [
                {
                  id: 'others',
                  label: t(`${KEY}.ladder.others`, { count: others.paths }),
                  value: isBelowPrivacyFloor(others.people) ? 0 : others.people,
                  display: isBelowPrivacyFloor(others.people)
                    ? t(`${KEY}.ladder.floor`, { floor: PRIVACY_FLOOR })
                    : t(`${KEY}.ladder.people`, { count: others.people }),
                  rate: isBelowPrivacyFloor(others.people) ? undefined : days(others.averageDays),
                  leading: step,
                },
              ]
            : []),
        ]}
      />
    </PanelSection>
  );
}

/**
 * (3) Entraram e nunca compraram de novo (D-09), by band: each row with someone opens the list;
 * then the suggested action, disabled as in the rest of the panel.
 */
function NeverAgain({ t }: { t: DashboardT }) {
  const never = ownerFinanceNeverAgain();
  const bands = ownerFinanceBands();
  const total = ENGAGEMENT_BAND_ORDER.reduce((sum, band) => sum + never[band], 0);
  return (
    <PanelSection title={t(`${KEY}.never.title`)} className={WIDE_HALF}>
      <div
        data-dash-stagger
        className="grid gap-3 @min-[100rem]:grid-cols-2 @min-[100rem]:items-start"
      >
        <RowsCard
          rows={ENGAGEMENT_BAND_ORDER.map((band) => ({
            id: band,
            title: bandLabel(t, band),
            line: t(`${KEY}.never.row`, {
              count: never[band],
              value: formatCount(never[band]),
              percent: formatPercent(percentOf(never[band], bands[band].members)),
            }),
            ...(never[band] === 0
              ? {}
              : {
                  anchor: financeNeverAnchor(band),
                  href: ownerFinanceHref({ ...financeTabView('buyers'), neverBand: band }),
                }),
          }))}
        />
        <ActionCard
          icon={Sparkles}
          title={t(`${KEY}.never.action.title`)}
          detail={t(`${KEY}.never.action.detail`, { count: total, value: formatCount(total) })}
          action={
            <DisabledAction variant="outline">{t(`${KEY}.never.action.button`)}</DisabledAction>
          }
        />
      </div>
    </PanelSection>
  );
}

/**
 * Financeiro › Quem compra (D-09): revenue by band across the area, then the purchase ladder and
 * who never bought again, paired.
 */
export function OwnerFinanceBuyers({ t, view }: { t: DashboardT; view: OwnerFinanceView }) {
  return (
    <>
      <Bands t={t} view={view} />
      <Ladder t={t} />
      <NeverAgain t={t} />
    </>
  );
}
