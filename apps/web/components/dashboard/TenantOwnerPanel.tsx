import {
  type TenantOwnerAttention,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
import type { AttentionItem } from '@rede-social/module-dashboard/ui';
import { Chip } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { getOwnerOverview } from '@/lib/dashboard';
import type { OwnerMembersView } from '@/lib/owner-band-scope';
import type { OwnerContentView } from '@/lib/owner-content-view';
import type { OwnerFinanceView } from '@/lib/owner-finance-view';
import {
  OWNER_AREAS,
  OWNER_PANEL_ANCHOR,
  type OwnerArea,
  type OwnerPanelFlags,
  type OwnerPanelTenant,
  ownerAreaHref,
} from '@/lib/owner-panel';
import { type DashboardT, formatCount, formatDayMonth } from './format';
import { OwnerAreaSkeleton } from './OwnerAreaSkeleton';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerContent } from './OwnerContent';
import { OwnerEvents } from './OwnerEvents';
import { OwnerFinance } from './OwnerFinance';
import { OwnerMembers } from './OwnerMembers';
import { OwnerOverview } from './OwnerOverview';
import { OwnerSupport } from './OwnerSupport';
import { AREA_GRID } from './ownerGrid';
import { PanelHeader } from './PanelHeader';
import { TenantColumn } from './TenantColumn';

function ownerAttentionItem(t: DashboardT, item: TenantOwnerAttention): AttentionItem {
  const base = `tenantOwner.alerts.${item.kind}`;
  switch (item.kind) {
    case 'support_waiting':
      return {
        id: item.id,
        tone: item.severity,
        tag: t(`${base}.tag`, { hours: item.oldestHours }),
        title: t(`${base}.title`, { count: item.conversations }),
        detail: t(`${base}.detail`, { hours: item.oldestHours }),
      };
    case 'event_soon':
      return {
        id: item.id,
        tone: item.severity,
        tag: t(`${base}.tag`, { date: formatDayMonth(item.date), hour: item.startsAtHour }),
        title: t(`${base}.title`, {
          event: item.event,
          confirmed: formatCount(item.confirmed),
          capacity: formatCount(item.capacity),
        }),
        detail: t(`${base}.detail`, { left: item.capacity - item.confirmed }),
      };
    default:
      return {
        id: item.id,
        tone: item.severity,
        tag: t(`${base}.tag`),
        title: t(`${base}.title`, { count: item.members }),
        detail: t(`${base}.detail`, { count: formatCount(item.withPush) }),
      };
  }
}

/**
 * Visão geral from the snapshot (08.7-01, D-464): awaits `getOwnerOverview()` inside the area's own
 * `Suspense` and maps the answer — `preparing` to the preparing card (UI-D-469), a failed read to the
 * area's error card with "Tentar novamente" on the same screen (UI-D-479), a session refusal to the
 * bootstrap's navigation, `ready` to the area itself with its freshness line.
 */
async function OwnerOverviewArea({ tenant, timeZone }: AreaProps) {
  const result = await getOwnerOverview();
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'error') {
    return (
      <OwnerAreaState
        kind="error"
        retryHref={`${ownerAreaHref('visao-geral')}#${OWNER_PANEL_ANCHOR}`}
      />
    );
  }
  if (result.answer.state === 'preparing') {
    return <OwnerAreaState kind="preparing" scope="owner" />;
  }
  return (
    <OwnerOverview
      tenant={tenant}
      overview={result.answer}
      timeZone={timeZone}
      nowMs={Date.now()}
    />
  );
}

/** Every area has its component and tab label: a slug added to OWNER_AREAS without one fails typecheck. */
const AREAS = {
  'visao-geral': { labelKey: 'tenantOwner.areas.overview', Area: OwnerOverviewArea },
  membros: { labelKey: 'tenantOwner.areas.members', Area: OwnerMembers },
  conteudo: { labelKey: 'tenantOwner.areas.content', Area: OwnerContent },
  eventos: { labelKey: 'tenantOwner.areas.events', Area: OwnerEvents },
  financeiro: { labelKey: 'tenantOwner.areas.finance', Area: OwnerFinance },
  atendimento: { labelKey: 'tenantOwner.areas.support', Area: OwnerSupport },
} satisfies Record<OwnerArea, { labelKey: string; Area: AreaComponent }>;

/**
 * An area component: Visão geral reads the tenant's account, Membros the members view, Conteúdo the
 * content view, Financeiro the finance view, the others none.
 */
interface AreaProps {
  tenant: OwnerPanelTenant;
  members: OwnerMembersView;
  content: OwnerContentView;
  finance: OwnerFinanceView;
  /** The panel's module flags (08.7-05, D-460), read once on `/perfil`. */
  flags: OwnerPanelFlags;
  /** `bootstrap.tenant.timezone` (08.7-01): snapshot days and build times are the tenant's. */
  timeZone: string;
}
type AreaComponent = (props: AreaProps) => Promise<ReactNode>;

export interface TenantOwnerPanelProps {
  /** The real tenant (name, mark and host); the numbers are the sample's. */
  tenant: OwnerPanelTenant;
  /** The open area (allow-listed by `parseOwnerArea`). */
  area: OwnerArea;
  /** The Membros area's view (allow-listed by `parseOwnerMembersView`). */
  members: OwnerMembersView;
  /** The Conteúdo area's view (allow-listed by `parseOwnerContentView`). */
  content: OwnerContentView;
  /** The Financeiro area's view (allow-listed by `parseOwnerFinanceView`). */
  finance: OwnerFinanceView;
  /** The panel's module flags (`ownerPanelFlags` of `bootstrap.modules`, 08.7-05). */
  flags: OwnerPanelFlags;
  /** `bootstrap.tenant.timezone` (08.7-01): the snapshot's freshness line is in the tenant's time. */
  timeZone: string;
}

/** The areas that read the snapshot stream in their own `Suspense` (UI-D-482). */
const STREAMED: ReadonlySet<OwnerArea> = new Set<OwnerArea>(['visao-geral', 'membros', 'conteudo']);

/**
 * The rede-social-dashboard preview's level 4, "Dono do cliente": the client's business in six areas
 * (quick 261012-o00), on `/perfil` for the tenant admin (2026-10-15). The header (the tenant's mark
 * and name, "Visão do dono") keeps the period and the alerts bell in every area; under it a row of
 * tab links (plain `<a>`, so it works with no JavaScript) picks the area through `?area=` on
 * `/perfil`. A tab only changes the query of the same screen, so it replaces the history entry
 * (`Chip`'s `replace`), as the app's other filters do. Each area is its own server component, laid
 * out on the member report's grid (`AREA_GRID`) with its cards and charts drawn by the same rules.
 * The Membros band lists name members to the client's own team (261012-pkd D-03); the bell and every
 * other block stay counts only. The numbers are the sample's (`docs/pendencias-backend.md` item 10).
 *
 * 08.7-01 (D-464, UI-D-482): Visão geral now reads the tenant's daily snapshot. The header and the
 * area row render at once; the area streams in its own `Suspense` behind `OwnerAreaSkeleton`, so a
 * slow or failed read never blanks the panel. 08.7-05: Membros streams the same way, and 08.7-07
 * Conteúdo. The other areas keep the sample until their plans.
 */
export async function TenantOwnerPanel({
  tenant,
  area,
  members,
  content,
  finance,
  flags,
  timeZone,
}: TenantOwnerPanelProps) {
  const t = await getTranslations('dashboard');
  const Area: AreaComponent = AREAS[area].Area;

  return (
    <TenantColumn>
      <PanelHeader
        title={tenant.name}
        iconUrl={tenant.iconUrl}
        subtitle={t('tenantOwner.header.subtitle')}
        period={t('tenantOwner.header.period')}
        alerts={tenantOwnerPanel.attention.map((item) => ownerAttentionItem(t, item))}
      />

      <nav aria-label={t('tenantOwner.areas.label')}>
        {/* Six areas as two rows of three equal tabs spanning the whole bar. */}
        <ul className="grid grid-cols-3 gap-2">
          {OWNER_AREAS.map((slug) => (
            <li key={slug} className="min-w-0">
              <Chip
                href={ownerAreaHref(slug)}
                active={slug === area}
                replace
                className="w-full justify-center text-center"
              >
                {t(AREAS[slug].labelKey)}
              </Chip>
            </li>
          ))}
        </ul>
      </nav>

      <div data-owner-area={area} className={AREA_GRID}>
        {STREAMED.has(area) ? (
          <Suspense fallback={<OwnerAreaSkeleton />}>
            <Area
              tenant={tenant}
              members={members}
              content={content}
              finance={finance}
              flags={flags}
              timeZone={timeZone}
            />
          </Suspense>
        ) : (
          <Area
            tenant={tenant}
            members={members}
            content={content}
            finance={finance}
            flags={flags}
            timeZone={timeZone}
          />
        )}
      </div>
    </TenantColumn>
  );
}
