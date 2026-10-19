import { ownerBandRoster } from '@rede-social/module-dashboard/fixtures';
import { Chip } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import {
  type FinanceTab,
  financeBackHref,
  financeTabView,
  type OwnerFinanceView,
  ownerFinanceHref,
} from '@/lib/owner-finance-view';
import type { DashboardT } from './format';
import { OwnerFinanceBuyers } from './OwnerFinanceBuyers';
import { OwnerFinanceOverview } from './OwnerFinanceOverview';
import { FinanceNumberList, NeverList, OwnerFinancePeople } from './OwnerFinancePeople';
import { OwnerFinanceProductDetail } from './OwnerFinanceProductDetail';
import { OwnerFinanceProducts } from './OwnerFinanceProducts';
import { SPAN_ALL } from './ownerGrid';
import { SampleMemberDetail } from './SampleMemberDetail';
import { SampleMemberList } from './SampleMemberList';

const KEY = 'tenantOwner.finance';

const TABS = [
  { tab: 'overview', labelKey: `${KEY}.tabs.overview` },
  { tab: 'products', labelKey: `${KEY}.tabs.products` },
  { tab: 'buyers', labelKey: `${KEY}.tabs.buyers` },
] as const satisfies readonly { tab: FinanceTab; labelKey: string }[];

/** The one row of choices of the area (D-01): three equal tabs across the area, as Conteúdo's. */
function FinanceTabs({ t, view }: { t: DashboardT; view: OwnerFinanceView }) {
  return (
    <nav aria-label={t(`${KEY}.tabs.label`)} className={SPAN_ALL}>
      <ul className="grid grid-cols-3 gap-2">
        {TABS.map((row) => (
          <li key={row.tab} className="min-w-0">
            <Chip
              href={ownerFinanceHref(financeTabView(row.tab))}
              active={row.tab === view.tab}
              className="w-full justify-center text-center"
            >
              {t(row.labelKey)}
            </Chip>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The member opened from a Financeiro list (D-08): their insights, or the list behind one of their
 * numbers, with the same components as Membros. Their band is today's whole-base band.
 */
function FinanceMember({
  t,
  view,
  memberId,
}: {
  t: DashboardT;
  view: OwnerFinanceView;
  memberId: string;
}) {
  const back = financeBackHref(view);
  if (back === null) throw new Error('a member with no way back');
  if (view.list) {
    return <SampleMemberList t={t} memberId={memberId} list={view.list} backHref={back} />;
  }
  const person = ownerBandRoster.find((row) => row.id === memberId);
  if (!person) throw new Error(`no roster member ${memberId}`);
  return (
    <SampleMemberDetail
      t={t}
      memberId={memberId}
      band={person.band}
      scope={{ kind: 'member' }}
      backHref={back}
      listHref={(slug) => ownerFinanceHref({ ...view, list: slug })}
    />
  );
}

/**
 * Level 4, "Financeiro" (quick 261014-dwc): one cascade of plain links, as Membros and Conteúdo
 * (D-01). The tab screens — Visão geral, Produtos and Quem compra — carry the one row of three tabs;
 * an open band of Quem compra is still a tab screen; every deeper step (an overview number's or
 * attention row's list, a never-again list, a product, an offer's buyers, a member's insights, the
 * list behind one of them) replaces the area under its "Voltar". The period is the panel's fixed
 * 30 days against the 30 before: there is no period selector. Every screen lays its blocks out on
 * the area's grid (`AREA_GRID`), as the member report: the tabs and the wide blocks across it.
 */
export async function OwnerFinance({ finance: view }: { finance: OwnerFinanceView }) {
  const t = await getTranslations('dashboard');
  if (view.memberId) return <FinanceMember t={t} view={view} memberId={view.memberId} />;
  if (view.offerId) return <OwnerFinancePeople t={t} view={view} />;
  if (view.productId) return <OwnerFinanceProductDetail t={t} view={view} />;
  if (view.number || view.attention) return <FinanceNumberList t={t} view={view} />;
  if (view.neverBand) return <NeverList t={t} view={view} />;
  return (
    <>
      <FinanceTabs t={t} view={view} />
      {view.tab === 'overview' ? <OwnerFinanceOverview t={t} /> : null}
      {view.tab === 'products' ? <OwnerFinanceProducts t={t} view={view} /> : null}
      {view.tab === 'buyers' ? <OwnerFinanceBuyers t={t} view={view} /> : null}
    </>
  );
}
