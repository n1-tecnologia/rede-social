import { Chip, cn } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { getOwnerOverview } from '@/lib/dashboard';
import type { OwnerMembersView } from '@/lib/owner-band-scope';
import type { OwnerContentView } from '@/lib/owner-content-view';
import type { OwnerFinanceView } from '@/lib/owner-finance-view';
import {
  areaChipSpan,
  OWNER_PANEL_ANCHOR,
  type OwnerArea,
  type OwnerPanelFlags,
  type OwnerPanelTenant,
  ownerAreaHref,
  visibleOwnerAreas,
} from '@/lib/owner-panel';
import { OwnerAreaSkeleton } from './OwnerAreaSkeleton';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerContent } from './OwnerContent';
import { OwnerEvents } from './OwnerEvents';
import { OwnerFinance } from './OwnerFinance';
import { OwnerMembers } from './OwnerMembers';
import { OwnerOverview } from './OwnerOverview';
import { OwnerSupport } from './OwnerSupport';
import { AREA_GRID } from './ownerGrid';
import { OwnerBell, PanelHeader } from './PanelHeader';
import { TenantColumn } from './TenantColumn';

/** A chip's tracks on the 6-track row, as static classes (UI-D-471, `areaChipSpan`). */
const CHIP_SPAN = { 2: 'col-span-2', 3: 'col-span-3' } as const;

/**
 * The header's bell (08.7-12, UI-D-482): the overview answer's alerts, streamed in its own
 * `Suspense` with nothing in its place while it loads. `getOwnerOverview` is React-cached, so the
 * bell and Visão geral share one read. A failed, refused or preparing read leaves no bell (UI-D-469).
 */
async function OwnerAlertsBell({ timeZone }: { timeZone: string }) {
  const result = await getOwnerOverview();
  if (result.status !== 'ok' || result.answer.state !== 'ready') return null;
  return <OwnerBell alerts={result.answer.alerts} timeZone={timeZone} />;
}

/**
 * Visão geral from the snapshot (08.7-01, D-464): awaits `getOwnerOverview()` inside the area's own
 * `Suspense` and maps the answer — `preparing` to the preparing card (UI-D-469), a failed read to the
 * area's error card with "Tentar novamente" on the same screen (UI-D-479), a session refusal to the
 * bootstrap's navigation, `ready` to the area itself with its freshness line.
 */
async function OwnerOverviewArea({ tenant, flags, timeZone }: AreaProps) {
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
      flags={flags}
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
 * content view, Financeiro the finance view, Eventos only the zone, the others none.
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
  /** The real tenant (name, mark and host). */
  tenant: OwnerPanelTenant;
  /** The open area (allow-listed by `parseOwnerArea`, a shown area of `flags`). */
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
const STREAMED: ReadonlySet<OwnerArea> = new Set<OwnerArea>([
  'visao-geral',
  'membros',
  'conteudo',
  'eventos',
  'financeiro',
  'atendimento',
]);

/**
 * The rede-social-dashboard preview's level 4, "Dono do cliente": the client's business in six areas
 * (quick 261012-o00), on `/perfil` for the tenant admin (2026-10-15). The header (the tenant's mark
 * and name, "Visão do dono") keeps the period and the alerts bell in every area; under it a row of
 * tab links (plain `<a>`, so it works with no JavaScript) picks the area through `?area=` on
 * `/perfil`. A tab only changes the query of the same screen, so it replaces the history entry
 * (`Chip`'s `replace`), as the app's other filters do. Each area is its own server component, laid
 * out on the member report's grid (`AREA_GRID`) with its cards and charts drawn by the same rules.
 * The Membros band lists name members to the client's own team (261012-pkd D-03); the bell and every
 * other block stay counts only.
 *
 * 08.7-01 (D-464, UI-D-482): Visão geral now reads the tenant's daily snapshot. The header and the
 * area row render at once; the area streams in its own `Suspense` behind `OwnerAreaSkeleton`, so a
 * slow or failed read never blanks the panel. 08.7-05: Membros streams the same way, 08.7-07
 * Conteúdo, 08.7-08 Eventos, 08.7-10 Financeiro and 08.7-11 Atendimento (gone, Moderação with it,
 * while `chat` is off).
 *
 * 08.7-12 (D-459, D-460, UI-D-471, UI-D-482): every number is the tenant's. The area row lists only
 * the areas the tenant's modules show (`visibleOwnerAreas`), reflowed on a 6-track grid
 * (`areaChipSpan`); the bell is the overview answer's alerts, streamed in its own `Suspense` with
 * nothing in its place while it loads (absent when no alert is left).
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
  const areas = visibleOwnerAreas(flags);

  return (
    <TenantColumn>
      <PanelHeader
        title={tenant.name}
        iconUrl={tenant.iconUrl}
        subtitle={t('tenantOwner.header.subtitle')}
        period={t('tenantOwner.header.period')}
        bell={
          <Suspense fallback={null}>
            <OwnerAlertsBell timeZone={timeZone} />
          </Suspense>
        }
      />

      <nav aria-label={t('tenantOwner.areas.label')}>
        {/* The shown areas on a 6-track row (UI-D-471): each chip spans 6 ÷ (chips in its row). */}
        <ul className="grid grid-cols-6 gap-2">
          {areas.map((slug, index) => (
            <li key={slug} className={cn('min-w-0', CHIP_SPAN[areaChipSpan(index, areas.length)])}>
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
