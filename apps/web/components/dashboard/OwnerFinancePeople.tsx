import type {
  OwnerFinanceBuyersReady,
  OwnerFinanceReady,
} from '@rede-social/module-dashboard/contracts';
import { ActionCard, BarList, CountUp, percentOf } from '@rede-social/module-dashboard/ui';
import { cn } from '@rede-social/ui';
import { HeartHandshake, Sparkles } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getOwnerFinanceBuyers } from '@/lib/dashboard';
import { FINANCE_FIRST_PAGE, financeBuyerRowViews } from '@/lib/owner-finance-rows';
import {
  type FinancePeopleList,
  financeBackHref,
  financePeopleListOf,
  financeRetryHref,
  type OwnerFinanceView,
} from '@/lib/owner-finance-view';
import type { OwnerPanelFlags } from '@/lib/owner-panel';
import { BackLink } from './BackLink';
import { bandLabel, type DashboardT, formatBrlWhole, formatCount, formatPercent } from './format';
import { OwnerAreaState } from './OwnerAreaState';
import type { FinanceScreenProps } from './OwnerFinance';
import { lifetimePerMember, secondaryShare } from './OwnerFinanceOverview';
import { FinanceEmpty } from './OwnerFinanceProducts';
import { OwnerListMore } from './OwnerListMore';
import { OwnerListRows } from './OwnerListRows';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

/*
 * The named buyers behind Financeiro's numbers (08.7-10, D-461, D-462): read from
 * `GET /v1/dashboard/owner/finance/buyers/{list}` for the tenant's own admin, never a product of a
 * purchase (the API's rows carry none), each card opening the panel's member detail. No expiring and
 * no offer list exists (D-455, D-465). Every outreach action stays disabled with the pill (PR-4).
 */

const LISTS = 'tenantOwner.finance.lists';

/** What a list screen says above its cards and puts below them. */
interface ListSpec {
  title: string;
  count: string;
  /** The "e mais N" line of the cards not shown. */
  more: (count: number) => string;
  body?: ReactNode;
}

/** "N pedidos" (an order count). */
function ordersText(t: DashboardT, count: number): string {
  return t('tenantOwner.finance.detail.bands.orders', { count });
}

/**
 * The share of add-ons by product (PD-11): each product's add-on orders against its entries, from
 * the answer's product cards; products, never people.
 */
function ShareBody({ t, answer }: { t: DashboardT; answer: OwnerFinanceReady }) {
  const rows = answer.byProduct.filter(
    (product) => product.current.entry + product.current.addon > 0,
  );
  if (rows.length === 0) {
    return <FinanceEmpty id="share" text={t('tenantOwner.finance.overview.sources.empty')} />;
  }
  const max = Math.max(...rows.flatMap((row) => [row.current.entry, row.current.addon]));
  const bars = (kind: 'entry' | 'addon') => (
    <BarList
      stacked
      max={max}
      rows={rows.map((row) => ({
        id: `${kind}-${row.productId}`,
        label: row.name,
        value: row.current[kind],
        display: ordersText(t, row.current[kind]),
        rate: t(`${LISTS}.share.rate`, {
          percent: formatPercent(
            percentOf(row.current[kind], row.current.entry + row.current.addon),
          ),
        }),
        highlight:
          row.current[kind] > 0 &&
          row.current[kind] >= row.current[kind === 'entry' ? 'addon' : 'entry'],
      }))}
    />
  );
  return (
    <div data-dash-stagger className="grid gap-3 @4xl:grid-cols-2">
      {(['addon', 'entry'] as const).map((kind) => (
        <div key={kind} className="flex min-w-0 flex-col gap-2">
          <p className="text-xs font-bold text-text-secondary">{t(`${LISTS}.share.${kind}`)}</p>
          {bars(kind)}
        </div>
      ))}
    </div>
  );
}

/** The never-again action: the band's count when every band is shown, else no number. */
export function NeverAction({ t, total }: { t: DashboardT; total: number | null }) {
  const key = 'tenantOwner.finance.buyers.never.action';
  return (
    <ActionCard
      icon={Sparkles}
      title={t(`${key}.title`)}
      detail={
        total === null
          ? t(`${key}.detailFloored`)
          : t(`${key}.detail`, { count: total, value: formatCount(total) })
      }
      action={
        <DisabledAction variant="outline" pill={t('report.comingSoon.value')}>
          {t(`${key}.button`)}
        </DisabledAction>
      }
    />
  );
}

/** What the screen of a view says: its title, its count line, its "e mais N" and its body. */
function specOf(
  t: DashboardT,
  view: OwnerFinanceView,
  answer: OwnerFinanceReady,
  flags: OwnerPanelFlags,
  page: OwnerFinanceBuyersReady | null,
): ListSpec | null {
  const summary = answer.summary.current;
  const members = (count: number) => t('tenantOwner.bandMembers.more', { count });
  const title = (key: string) => t(`tenantOwner.finance.overview.numbers.${key}`);
  if (view.neverBand) {
    const total = page?.total ?? 0;
    return {
      title: t(`${LISTS}.never.title`, { band: bandLabel(t, view.neverBand) }),
      count: t(`${LISTS}.never.count`, { count: total, value: formatCount(total) }),
      more: members,
      body: <NeverAction t={t} total={total} />,
    };
  }
  if (view.attention === 'vipFading') {
    const vip = answer.vip;
    if (!vip) return null;
    const count = vip.fading.atRisk + vip.fading.inactive;
    return {
      title: t(`${LISTS}.vipFading.title`, { community: vip.communityName }),
      count: t(`${LISTS}.vipFading.count`, {
        count,
        community: vip.communityName,
        atRisk: vip.fading.atRisk,
        inactive: vip.fading.inactive,
      }),
      more: members,
      body: (
        <ActionCard
          icon={HeartHandshake}
          title={t('tenantOwner.finance.overview.next.fading.title')}
          detail={
            flags.notifications
              ? t(`${LISTS}.vipFading.action`, { push: vip.fading.withPush })
              : t(`${LISTS}.vipFading.actionNoPush`)
          }
          action={
            <DisabledAction variant="outline" pill={t('report.comingSoon.value')}>
              {t('tenantOwner.finance.overview.next.fading.action')}
            </DisabledAction>
          }
        />
      ),
    };
  }
  switch (view.number) {
    case 'primary':
      return {
        title: title('primary'),
        count: t(`${LISTS}.primary.count`, {
          value: formatBrlWhole(answer.primary.current.cents),
          count: answer.primary.current.orders,
        }),
        more: (count) => t(`${LISTS}.primary.more`, { count }),
      };
    case 'secondary':
      return {
        title: title('secondary'),
        count: t(`${LISTS}.secondary.count`, {
          value: formatBrlWhole(answer.secondary.current.cents),
          count: answer.secondary.current.orders,
        }),
        more: members,
      };
    case 'share':
      return {
        title: title('share'),
        count: t(`${LISTS}.share.count`, {
          percent: formatPercent(secondaryShare(answer, 'current')),
          value: formatBrlWhole(answer.secondary.current.cents),
          total: formatBrlWhole(answer.totals.current.cents),
        }),
        more: members,
        body: <ShareBody t={t} answer={answer} />,
      };
    case 'rebought':
      return {
        title: title('rebought'),
        count: t(`${LISTS}.rebought.count`, {
          count: summary.rebought,
          value: formatCount(summary.rebought),
          percent: formatPercent(percentOf(summary.rebought, summary.base)),
        }),
        more: members,
      };
    case 'timeToSecond':
      return {
        title: title('timeToSecond'),
        count:
          summary.timeToSecondDays === null
            ? t('tenantOwner.finance.buyers.ladder.empty')
            : t(`${LISTS}.timeToSecond.count`, {
                days: Math.round(summary.timeToSecondDays),
                count: summary.rebought,
                value: formatCount(summary.rebought),
              }),
        more: members,
      };
    case 'lifetime':
      return {
        title: title('lifetime'),
        count: t(`${LISTS}.lifetime.count`, {
          value: formatBrlWhole(lifetimePerMember(summary)),
          total: formatBrlWhole(summary.lifetimeCents),
          members: formatCount(summary.base),
        }),
        more: members,
      };
    default:
      return null;
  }
}

export interface FinancePeopleViewProps {
  t: DashboardT;
  view: OwnerFinanceView;
  answer: OwnerFinanceReady;
  flags: OwnerPanelFlags;
  /** The first page of the view's buyers list; null for the share of add-ons (no people). */
  page: OwnerFinanceBuyersReady | null;
  timeZone: string;
  nowMs: number;
}

/**
 * The list behind an overview number, the VIP row or a never-again band (D-07, D-461), a deeper step
 * under its "Voltar", across the whole area: its count line repeats the number, then the member
 * cards (each opening the member's detail) with "Ver todos" continuing in place (UI-D-477), then the
 * suggested action, disabled with the pill. The share of add-ons lists products, not people (PD-11).
 */
export function FinancePeopleView({
  t,
  view,
  answer,
  flags,
  page,
  timeZone,
  nowMs,
}: FinancePeopleViewProps) {
  const back = financeBackHref(view);
  const spec = specOf(t, view, answer, flags, page);
  if (back === null || spec === null) return null;
  const rows = page ? financeBuyerRowViews(t, page, { timeZone, nowMs }) : [];
  const more = page ? page.total - rows.length : 0;
  const list = page && page.list !== 'product' ? page.list : null;
  return (
    <div className={cn(SPAN_ALL, 'flex min-w-0 flex-col gap-3')}>
      <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection title={spec.title} prominent>
        <p className="text-sm text-text-secondary">
          <CountUp value={spec.count} />
        </p>
        {page === null ? null : rows.length === 0 ? (
          <p className="text-sm text-text-secondary">{t(`${LISTS}.empty`)}</p>
        ) : (
          <>
            <OwnerListRows rows={rows} layout="cards-wide" />
            {page.nextCursor !== null && list !== null ? (
              <OwnerListMore
                request={{ kind: 'finance-buyers', list, band: page.band }}
                cursor={page.nextCursor}
                layout="cards-wide"
                more={more > 0 ? spec.more(more) : null}
                labels={{
                  seeAll: t('tenantOwner.bandMembers.seeAll'),
                  error: t('report.errors.more'),
                  retry: t('report.errors.retry'),
                }}
              />
            ) : null}
          </>
        )}
        {spec.body}
      </PanelSection>
    </div>
  );
}

type ListScreenProps = FinanceScreenProps & {
  /** The level above: a list the API does not know (or a VIP gone) falls back to it (D-06). */
  fallback: ReactNode;
};

/** Reads the first page of `people` and renders its screen, or the level above, or its error card. */
async function readList(props: ListScreenProps, people: FinancePeopleList): Promise<ReactNode> {
  const { t, view, answer, flags, timeZone, fallback } = props;
  const read = await getOwnerFinanceBuyers(people.list, {
    band: people.band,
    limit: FINANCE_FIRST_PAGE,
  });
  if (read.status === 'redirect') redirect(read.path);
  if (read.status === 'notFound') return fallback;
  if (read.status === 'error') {
    return <OwnerAreaState kind="error" body="list" retryHref={financeRetryHref(view)} />;
  }
  if (read.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  return (
    <FinancePeopleView
      t={t}
      view={view}
      answer={answer}
      flags={flags}
      page={read.answer}
      timeZone={timeZone}
      nowMs={Date.now()}
    />
  );
}

/**
 * An overview number's or the VIP row's list (D-07), streamed in its own `Suspense` by the caller.
 * With no VIP (UI-D-490) the fading list falls back to Visão geral; the share of add-ons reads no
 * list.
 */
export async function FinanceNumberList(props: ListScreenProps): Promise<ReactNode> {
  const { t, view, answer, flags, timeZone } = props;
  if (view.attention === 'vipFading' && answer.vip === null) return props.fallback;
  if (view.number === 'share') {
    return (
      <FinancePeopleView
        t={t}
        view={view}
        answer={answer}
        flags={flags}
        page={null}
        timeZone={timeZone}
        nowMs={Date.now()}
      />
    );
  }
  const people = financePeopleListOf(view);
  return people ? readList(props, people) : props.fallback;
}

/** Who of a band entered and never bought again (D-09), streamed in its own `Suspense`. */
export async function NeverList(props: ListScreenProps): Promise<ReactNode> {
  const people = financePeopleListOf(props.view);
  return people?.list === 'never' ? readList(props, people) : props.fallback;
}
