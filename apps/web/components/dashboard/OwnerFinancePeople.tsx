import { formatBrl } from '@rede-social/contracts/money';
import {
  type EngagementBand,
  type FinancePerson,
  financeOffer,
  financeProductOffers,
  ownerFinanceAttention,
  ownerFinancePeople,
  ownerFinanceProduct,
  ownerFinanceSummary,
  ownerFinanceWindow,
} from '@rede-social/module-dashboard/fixtures';
import { ActionCard, BarList, percentOf } from '@rede-social/module-dashboard/ui';
import { cn } from '@rede-social/ui';
import { BellRing, HeartHandshake, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  type FinanceAttentionList,
  type FinanceNumber,
  financeBackHref,
  financePeopleListOf,
  type OwnerFinanceView,
  ownerFinanceHref,
} from '@/lib/owner-finance-view';
import { BackLink } from './BackLink';
import {
  bandLabel,
  type DashboardT,
  formatBrlCompact,
  formatBrlWhole,
  formatCount,
  formatPercent,
  momentText,
} from './format';
import { PeopleCards } from './OwnerContentPeople';
import { financeProducts } from './OwnerFinanceProducts';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

/*
 * The only web file that reads `ownerFinancePeople`: who bought, what and for how much (D-11) reach
 * the client's own team (the tenant admin, on `/perfil`) only; the platform never sees a name.
 */

const KEY = 'tenantOwner.finance.people';

/**
 * The buyers of one offer in the last 30 days (D-08): "Voltar" to the offer, its composition and
 * product, how many bought it, then the member cards most recent first, each saying when and for how
 * much they bought; each card opens the member's insights.
 */
export function OwnerFinancePeople({ t, view }: { t: DashboardT; view: OwnerFinanceView }) {
  const back = financeBackHref(view);
  // The parser only sets an offer under its product: a gap here is a bug.
  if (!view.offerId || back === null) throw new Error('a buyers list with no offer');
  const offer = financeOffer(view.offerId);
  const { people, total } = ownerFinancePeople({ kind: 'offer', offerId: offer.id });
  const product = ownerFinanceProduct(offer.productId).name;

  return (
    <div className={cn(SPAN_ALL, 'flex min-w-0 flex-col gap-3')}>
      <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection title={offer.composition} period={product} prominent>
        <p className="text-sm text-text-secondary">{t(`${KEY}.count`, { count: total })}</p>
        <PeopleCards
          t={t}
          people={people}
          total={total}
          hrefOf={(memberId) => ownerFinanceHref({ ...view, memberId, list: null })}
          leadOf={(person) =>
            t(`${KEY}.bought`, { when: momentText(t, person.when), value: formatBrl(person.cents) })
          }
          showBand
          wide
          moreText={(more) => t(`${KEY}.more`, { count: more })}
        />
      </PanelSection>
    </div>
  );
}

const LISTS = 'tenantOwner.finance.lists';

interface ListBody {
  title: string;
  count: string;
  lead?: (person: FinancePerson) => string;
  more?: (more: number) => string;
  /** The sentence when nobody of the number is in the sample. */
  empty?: string;
  body?: ReactNode;
}

/** The share of add-ons by product (PD-11): entry against add-on revenue, nothing below it. */
function ShareBody({ t }: { t: DashboardT }) {
  const { byOffer } = ownerFinanceWindow(0, 29);
  const rows = financeProducts().map((product) => {
    const cents = (kind: 'entry' | 'addon') =>
      financeProductOffers(product.id)
        .filter((offer) => offer.kind === kind)
        .reduce((sum, offer) => sum + byOffer[offer.id].cents, 0);
    return { product, entry: cents('entry'), addon: cents('addon') };
  });
  const max = Math.max(...rows.flatMap((row) => [row.entry, row.addon]));
  const bars = (kind: 'entry' | 'addon') => (
    <BarList
      stacked
      max={max}
      rows={rows.map((row) => ({
        id: `${kind}-${row.product.id}`,
        label: row.product.name,
        value: row[kind],
        display: formatBrlCompact(row[kind]),
        rate:
          row.entry + row.addon === 0
            ? undefined
            : t(`${LISTS}.share.rate`, {
                percent: formatPercent(percentOf(row[kind], row.entry + row.addon)),
              }),
        highlight: row[kind] > 0 && row[kind] >= row[kind === 'entry' ? 'addon' : 'entry'],
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

/**
 * The list behind an overview number or an attention row (D-07), a deeper step under its "Voltar":
 * its count line repeats the number; the cards are the roster's sample of it, each opening the
 * member. The share of add-ons lists products, not people (PD-11); the accesses ending this week
 * have no member in the sample, so it says so in one sentence, with the disabled action (PD-17,
 * quick 261014-ia8 F-2).
 */
export function FinanceNumberList({ t, view }: { t: DashboardT; view: OwnerFinanceView }) {
  const back = financeBackHref(view);
  if ((!view.number && !view.attention) || back === null) {
    throw new Error('a finance list with no number');
  }
  const summary = ownerFinanceSummary(0);
  const { vipFading, expiring } = ownerFinanceAttention();
  const offerName = (person: FinancePerson) => financeOffer(person.offerId).composition;
  const when = (person: FinancePerson) => momentText(t, person.when);
  const members = (more: number) => t('tenantOwner.bandMembers.more', { count: more });
  const numbers: Record<FinanceNumber, () => ListBody> = {
    primary: () => ({
      title: t('tenantOwner.finance.overview.numbers.primary'),
      count: t(`${LISTS}.primary.count`, {
        value: formatBrlWhole(summary.primary.cents),
        count: summary.primary.orders,
      }),
      lead: (person) =>
        t(`${LISTS}.primary.lead`, {
          offer: offerName(person),
          value: formatBrl(person.cents),
          when: when(person),
        }),
      more: (more) => t(`${LISTS}.primary.more`, { count: more }),
    }),
    secondary: () => ({
      title: t('tenantOwner.finance.overview.numbers.secondary'),
      count: t(`${LISTS}.secondary.count`, {
        value: formatBrlWhole(summary.secondary.cents),
        count: summary.secondary.orders,
      }),
      lead: (person) =>
        t(`${LISTS}.secondary.lead`, {
          offer: offerName(person),
          value: formatBrl(person.cents),
          when: when(person),
        }),
      more: (more) => t(`${KEY}.more`, { count: more }),
    }),
    share: () => ({
      title: t('tenantOwner.finance.overview.numbers.share'),
      count: t(`${LISTS}.share.count`, {
        percent: formatPercent(percentOf(summary.secondary.cents, summary.total.cents)),
        value: formatBrlWhole(summary.secondary.cents),
        total: formatBrlWhole(summary.total.cents),
      }),
      body: <ShareBody t={t} />,
    }),
    rebought: () => ({
      title: t('tenantOwner.finance.overview.numbers.rebought'),
      count: t(`${LISTS}.rebought.count`, {
        count: summary.rebought,
        value: formatCount(summary.rebought),
        percent: formatPercent(percentOf(summary.rebought, summary.base)),
      }),
      lead: (person) =>
        t(`${LISTS}.rebought.lead`, { offer: offerName(person), when: when(person) }),
      more: members,
    }),
    timeToSecond: () => ({
      title: t('tenantOwner.finance.overview.numbers.timeToSecond'),
      count: t(`${LISTS}.timeToSecond.count`, {
        days: Math.round(summary.timeToSecondDays),
        count: summary.rebought,
        value: formatCount(summary.rebought),
      }),
      lead: (person) => t(`${LISTS}.timeToSecond.lead`, { days: person.days ?? 0 }),
      more: members,
    }),
    lifetime: () => ({
      title: t('tenantOwner.finance.overview.numbers.lifetime'),
      count: t(`${LISTS}.lifetime.count`, {
        value: formatBrlWhole(summary.lifetimeCents / summary.base),
        total: formatBrlWhole(summary.lifetimeCents),
        members: formatCount(summary.base),
      }),
      lead: (person) => t(`${LISTS}.lifetime.lead`, { value: formatBrlWhole(person.cents) }),
      more: members,
    }),
  };
  const attentions: Record<FinanceAttentionList, () => ListBody> = {
    vipFading: () => ({
      title: t(`${LISTS}.vipFading.title`),
      count: t(`${LISTS}.vipFading.count`, {
        count: vipFading.atRisk + vipFading.inactive,
        atRisk: vipFading.atRisk,
        inactive: vipFading.inactive,
      }),
      lead: (person) =>
        t(`${LISTS}.vipFading.lead`, { when: when(person), value: formatBrl(person.cents) }),
      more: members,
      body: (
        <ActionCard
          icon={HeartHandshake}
          title={t('tenantOwner.finance.overview.next.fading.title')}
          detail={t(`${LISTS}.vipFading.action`, { push: vipFading.withPush })}
          action={
            <DisabledAction variant="outline">
              {t('tenantOwner.finance.overview.next.fading.action')}
            </DisabledAction>
          }
        />
      ),
    }),
    expiring: () => ({
      title: t(`${LISTS}.expiring.title`),
      count: t(`${LISTS}.expiring.count`, {
        count: expiring.value.count,
        product: ownerFinanceProduct(expiring.value.productId).name,
      }),
      more: members,
      empty: t(`${LISTS}.expiring.empty`),
      body: (
        <ActionCard
          icon={BellRing}
          title={t('tenantOwner.finance.overview.next.expiring.title')}
          detail={t('tenantOwner.finance.overview.next.expiring.detail', {
            count: expiring.value.count,
          })}
          action={
            <DisabledAction variant="outline">
              {t('tenantOwner.finance.overview.next.expiring.action')}
            </DisabledAction>
          }
        />
      ),
    }),
  };
  const spec = view.number
    ? numbers[view.number]()
    : view.attention
      ? attentions[view.attention]()
      : null;
  if (!spec) throw new Error('a finance list with no number');
  const list = financePeopleListOf(view);
  const people = list ? ownerFinancePeople(list) : null;
  const { lead, more } = spec;
  return (
    <div className={cn(SPAN_ALL, 'flex min-w-0 flex-col gap-3')}>
      <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection title={spec.title} prominent>
        <p className="text-sm text-text-secondary">{spec.count}</p>
        {people && more ? (
          <PeopleCards
            t={t}
            people={people.people}
            total={people.total}
            hrefOf={(memberId) => ownerFinanceHref({ ...view, memberId, list: null })}
            leadOf={lead ?? (() => '')}
            showBand
            wide
            moreText={more}
            emptyText={spec.empty}
          />
        ) : null}
        {spec.body}
      </PanelSection>
    </div>
  );
}

/**
 * The month's buyers of one band, inside its open "Receita por faixa" row (D-09): the cards do not
 * repeat the band; each says what they bought, for how much and when, and opens the member (whose
 * Voltar reopens this band).
 */
export function BandBuyers({
  t,
  view,
  band,
}: {
  t: DashboardT;
  view: OwnerFinanceView;
  band: EngagementBand;
}) {
  const { people, total } = ownerFinancePeople({ kind: 'band', band });
  return (
    <PeopleCards
      t={t}
      people={people}
      total={total}
      hrefOf={(memberId) =>
        ownerFinanceHref({ ...view, band, neverBand: null, memberId, list: null })
      }
      leadOf={(person) =>
        t(`${LISTS}.secondary.lead`, {
          offer: financeOffer(person.offerId).composition,
          value: formatBrl(person.cents),
          when: momentText(t, person.when),
        })
      }
      showBand={false}
      moreText={(more) => t(`${LISTS}.band.more`, { count: more })}
    />
  );
}

/**
 * Who of a band entered and never bought again (D-09), a deeper step under its "Voltar": how many,
 * the sample's cards (each saying how they entered and when, opening the member), and the
 * suggested action, disabled as in the rest of the panel.
 */
export function NeverList({ t, view }: { t: DashboardT; view: OwnerFinanceView }) {
  const back = financeBackHref(view);
  const band = view.neverBand;
  if (!band || back === null) throw new Error('a never-again list with no band');
  const { people, total } = ownerFinancePeople({ kind: 'never', band });
  return (
    <div className={cn(SPAN_ALL, 'flex min-w-0 flex-col gap-3')}>
      <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection title={t(`${LISTS}.never.title`, { band: bandLabel(t, band) })} prominent>
        <p className="text-sm text-text-secondary">
          {t(`${LISTS}.never.count`, { count: total, value: formatCount(total) })}
        </p>
        <PeopleCards
          t={t}
          people={people}
          total={total}
          hrefOf={(memberId) => ownerFinanceHref({ ...view, memberId, list: null })}
          leadOf={(person) =>
            t(`${LISTS}.never.lead`, {
              offer: financeOffer(person.offerId).composition,
              when: momentText(t, person.when),
            })
          }
          showBand={false}
          wide
          moreText={(more) => t('tenantOwner.bandMembers.more', { count: more })}
        />
        <ActionCard
          icon={Sparkles}
          title={t('tenantOwner.finance.buyers.never.action.title')}
          detail={t('tenantOwner.finance.buyers.never.action.detail', {
            count: total,
            value: formatCount(total),
          })}
          action={
            <DisabledAction variant="outline">
              {t('tenantOwner.finance.buyers.never.action.button')}
            </DisabledAction>
          }
        />
      </PanelSection>
    </div>
  );
}
