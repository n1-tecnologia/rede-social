import type { OwnerFinanceReady } from '@rede-social/module-dashboard/contracts';
import { Chip } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { getOwnerContent, getOwnerFinance } from '@/lib/dashboard';
import { freshnessText } from '@/lib/dashboard-view';
import { contentItemsById } from '@/lib/owner-content-rows';
import {
  type FinanceTab,
  financeBackHref,
  financeRetryHref,
  financeTabView,
  type OwnerFinanceView,
  ownerFinanceHref,
} from '@/lib/owner-finance-view';
import type { OwnerPanelFlags } from '@/lib/owner-panel';
import type { DashboardT } from './format';
import { OwnerAreaSkeleton } from './OwnerAreaSkeleton';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerFinanceBuyers } from './OwnerFinanceBuyers';
import { OwnerFinanceOverview } from './OwnerFinanceOverview';
import { FinanceNumberList, NeverList } from './OwnerFinancePeople';
import { OwnerFinanceProductDetail } from './OwnerFinanceProductDetail';
import { OwnerFinanceProducts } from './OwnerFinanceProducts';
import { OwnerMemberDetail } from './OwnerMemberDetail';
import { OwnerMemberList } from './OwnerMemberList';
import { SPAN_ALL } from './ownerGrid';
import { SnapshotFreshness } from './SnapshotFreshness';

const KEY = 'tenantOwner.finance';

const TABS = [
  { tab: 'overview', labelKey: `${KEY}.tabs.overview` },
  { tab: 'products', labelKey: `${KEY}.tabs.products` },
  { tab: 'buyers', labelKey: `${KEY}.tabs.buyers` },
] as const satisfies readonly { tab: FinanceTab; labelKey: string }[];

export interface OwnerFinanceProps {
  /** The Financeiro view (syntactic, `parseOwnerFinanceView`). */
  finance: OwnerFinanceView;
  /** The panel's module flags (`ownerPanelFlags`, read once on `/perfil`). */
  flags: OwnerPanelFlags;
  /** `bootstrap.tenant.timezone`: the freshness line and the dates are the tenant's. */
  timeZone: string;
}

/** What every Financeiro screen reads: the translator, the view, the ready answer and the context. */
export interface FinanceScreenProps {
  t: DashboardT;
  view: OwnerFinanceView;
  answer: OwnerFinanceReady;
  flags: OwnerPanelFlags;
  timeZone: string;
  /** The live captions of the window's publications (Conteúdo's answer), by post id. */
  postTitles: ReadonlyMap<string, string>;
}

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
 * The screen a view asks for, deepest level first. Each deeper level streams in its own `Suspense`
 * behind `OwnerAreaSkeleton` (UI-D-482) and receives the level above as its fallback: an id the API
 * does not know for this tenant (its bare 404) renders that level instead (D-06).
 */
function FinanceScreen(props: FinanceScreenProps) {
  const { t, view, answer, flags, timeZone } = props;
  if (view.memberId) {
    const above = <FinanceScreen {...props} view={{ ...view, memberId: null, list: null }} />;
    const back = financeBackHref(view);
    if (back === null) throw new Error('a member with no way back');
    return (
      <Suspense fallback={<OwnerAreaSkeleton />}>
        {view.list === null ? (
          <OwnerMemberDetail
            memberId={view.memberId}
            scopeKind="member"
            links={{
              back,
              list: (slug) => ownerFinanceHref({ ...view, list: slug }),
              retry: financeRetryHref(view),
            }}
            flags={flags}
            timeZone={timeZone}
            fallback={above}
          />
        ) : (
          <OwnerMemberList
            memberId={view.memberId}
            list={view.list}
            links={{ back, retry: financeRetryHref(view) }}
            timeZone={timeZone}
            fallback={above}
          />
        )}
      </Suspense>
    );
  }
  if (view.productId) {
    return (
      <Suspense fallback={<OwnerAreaSkeleton />}>
        <OwnerFinanceProductDetail
          {...props}
          view={{ ...view, productId: view.productId }}
          fallback={<FinanceScreen {...props} view={{ ...view, productId: null }} />}
        />
      </Suspense>
    );
  }
  if (view.number || view.attention) {
    return (
      <Suspense fallback={<OwnerAreaSkeleton />}>
        <FinanceNumberList
          {...props}
          fallback={<FinanceScreen {...props} view={{ ...view, number: null, attention: null }} />}
        />
      </Suspense>
    );
  }
  if (view.neverBand) {
    return (
      <Suspense fallback={<OwnerAreaSkeleton />}>
        <NeverList
          {...props}
          fallback={<FinanceScreen {...props} view={{ ...view, neverBand: null }} />}
        />
      </Suspense>
    );
  }
  return (
    <>
      <FinanceTabs t={t} view={view} />
      {view.tab === 'overview' ? (
        <OwnerFinanceOverview t={t} answer={answer} flags={flags} postTitles={props.postTitles} />
      ) : null}
      {view.tab === 'products' ? <OwnerFinanceProducts t={t} answer={answer} /> : null}
      {view.tab === 'buyers' ? (
        <Suspense fallback={<OwnerAreaSkeleton />}>
          <OwnerFinanceBuyers {...props} />
        </Suspense>
      ) : null}
    </>
  );
}

/**
 * The captions of the window's publications, read from Conteúdo's cached answer while `feed` is on
 * and Financeiro names a publication (its associated sales); empty otherwise or on a failed read,
 * where the row names the publication as one outside the window.
 */
async function readPostTitles(
  answer: OwnerFinanceReady,
  flags: OwnerPanelFlags,
): Promise<ReadonlyMap<string, string>> {
  if (!flags.feed || (answer.contentSales?.posts.length ?? 0) === 0) return new Map();
  const content = await getOwnerContent();
  if (content.status !== 'ok' || content.answer.state !== 'ready') return new Map();
  return new Map(
    [...contentItemsById(content.answer)].map(([id, item]) => [id, item.excerpt] as const),
  );
}

/**
 * Level 4, "Financeiro", on the snapshot (08.7-10, INSIGHT-12, D-460): one cascade of plain links,
 * as Membros and Conteúdo (D-01). It reads `GET /v1/dashboard/owner/finance` once, inside the area's
 * own `Suspense`, and maps the answer — `disabled` (the tenant does not have `store`) to nothing,
 * `preparing` to the preparing card (UI-D-469), a failed read to the area's error card with "Tentar
 * novamente" on the same screen (UI-D-479), a session refusal to the bootstrap's navigation, `ready`
 * to the freshness line and the screen. The tab screens — Visão geral, Produtos and Quem compra (an
 * open band included) — carry the row of three tabs; every deeper step (an overview number's or the
 * VIP row's list, a never-again list, a product, a member's insights, the list behind one of them)
 * replaces the area under its "Voltar". The period is the snapshot's 30 days against the 30 before.
 */
export async function OwnerFinance({ finance: view, flags, timeZone }: OwnerFinanceProps) {
  const [t, result] = await Promise.all([getTranslations('dashboard'), getOwnerFinance()]);
  if (result.status === 'disabled') return null;
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'error') {
    return <OwnerAreaState kind="error" retryHref={financeRetryHref(view)} />;
  }
  if (result.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  const answer = result.answer;
  const postTitles = await readPostTitles(answer, flags);
  const freshness = freshnessText(answer.snapshot, timeZone, Date.now());
  return (
    <>
      <SnapshotFreshness text={t(`report.freshness.${freshness.key}`, { ...freshness.values })} />
      <FinanceScreen
        t={t}
        view={view}
        answer={answer}
        flags={flags}
        timeZone={timeZone}
        postTitles={postTitles}
      />
    </>
  );
}
