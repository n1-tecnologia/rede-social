import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { RowSkeleton } from '@rede-social/module-courses/ui';
import { Skeleton } from '@rede-social/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { CoursesTab } from './CoursesTab';
import { HubTabs } from './HubTabs';
import { LivesTab } from './LivesTab';
import { MemberCatalogue } from './MemberCatalogue';
import { TracksTab } from './TracksTab';
import { COURSE_HUB_TABS, hubTabFromParam, hubTabHref } from './tabs';

const CHIPS = [56, 88, 92, 92];
const ROWS = [0, 1, 2, 3, 4, 5];

/**
 * The hub tab body's skeleton (UI-D-401), moved here from `loading.tsx` when the segment's loading
 * became role-neutral (08.5-06, UI-D-424): the title row with the create control's shape, the chips,
 * the "Categorias" row and 6 row skeletons, at the tab's final geometry. No words.
 */
function HubBodySkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pb-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton variant="rect" className="h-11 w-28 shrink-0 rounded-xl" />
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none">
        {CHIPS.map((width, index) => (
          <Skeleton
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
            key={index}
            variant="rect"
            width={width}
            className="h-[30px] shrink-0 rounded-full"
          />
        ))}
      </div>
      <div className="flex min-h-11 items-center gap-3 px-4 py-2">
        <Skeleton variant="rect" className="h-5 w-5 shrink-0 rounded-md" />
        <Skeleton variant="text" width="30%" />
      </div>
      <div className="flex flex-col divide-y divide-divider">
        {ROWS.map((index) => (
          <RowSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

/**
 * `/cursos` (08.3-06, D-402, UI-D-390, COURSE-14): the school's hub, reached from the Configurações
 * "Cursos" row (UI-D-389). A `PageHeader`-less destination in the member shell (TopBar on, BottomNav
 * on): the h1 "Cursos" 24/700, the subtitle "Cursos, trilhas e lives de {tenant}." 14/400, the area
 * sub-nav as the shipped `Tabs` with `href` items from `tabs.ts` (`?aba=`, read HERE on the server
 * so a tab, a refresh, back and a shared link land on the same list; an unknown value reads as
 * `cursos`), then the active tab's body — each tab owns its create control, chips, list, empty,
 * loading and error states.
 *
 * The registry holds `cursos`, (08.3-10) `trilhas` and (08.3-11) `lives`; each tab's body is its own
 * component below and the frame never changed for them. Desktop: the 680px column (D-39,
 * UI-D-411); no rail entry (D-401).
 *
 * **08.5-06 — the role split (D-419, D-420, UI-D-424, T-08.5-27).** `layout.tsx` keeps only the module
 * check; the split happens HERE, on the server: a caller holding `courses.manage` gets the hub above
 * unless the URL says `?ver=aluno`; everyone else — `member`, `support_tenant`, and the manager
 * previewing — gets the member catalogue (`MemberCatalogue`). A member's `?ver=` is ignored (it can
 * only ever choose the member view), and the API still authorises every admin read the hub makes.
 * Each hub tab body streams inside its own `Suspense` with the hub skeleton; the segment's
 * `loading.tsx` draws only the role-neutral frame.
 */
export default async function CoursesHubPage({
  searchParams,
}: {
  searchParams: Promise<{
    aba?: string | string[];
    filtro?: string | string[];
    categoria?: string | string[];
    trilha?: string | string[];
    ver?: string | string[];
  }>;
}) {
  const [bootstrap, t, params] = await Promise.all([
    requireBootstrap(),
    getTranslations(),
    searchParams,
  ]);
  // The module check is `layout.tsx`'s; it is repeated here because Next renders the layout and the
  // page CONCURRENTLY, so without it a request would still fire the body's API reads (each a
  // guaranteed 404) before the layout's `notFound()` lands. Same cached bootstrap, no second call.
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  const tenantName = bootstrap.tenant.displayName;
  const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);

  const showHub = manage && params.ver !== 'aluno';

  if (!showHub) {
    return (
      <MemberCatalogue
        aba={params.aba}
        categoria={params.categoria}
        trilha={params.trilha}
        tenantName={tenantName}
        timeZone={bootstrap.tenant.timezone}
        preview={manage}
      />
    );
  }

  const tab = hubTabFromParam(params.aba);
  const filterKey = typeof params.filtro === 'string' ? params.filtro : '';

  return (
    <div data-testid="courses-hub" className="mx-auto flex w-full max-w-[680px] flex-col">
      {/* The heading block is `min-w-0 flex-1`: a long tenant name wraps the subtitle (E02 long-text). */}
      <div className="flex items-start px-4 pt-4 pb-1">
        <div className="min-w-0 flex-1">
          <h1
            data-brand-title
            className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text"
          >
            {t('courses.hub.title')}
          </h1>
          <p className="mt-1 break-words text-sm font-normal text-text-secondary">
            {t('courses.hub.subtitle', { tenant: tenantName })}
          </p>
        </div>
      </div>

      {/* Three tabs fit at 320px; the `Tabs` scroller handles the member phase's five (E02 overflow). */}
      <HubTabs
        label={t('courses.hub.tabs.label')}
        value={tab}
        items={COURSE_HUB_TABS.map((item) => ({
          key: item.key,
          label: t(item.labelKey),
          href: hubTabHref(item.key),
        }))}
        className="mb-4 border-b border-divider"
      />

      <Suspense key={`${tab}:${filterKey}`} fallback={<HubBodySkeleton />}>
        {tab === 'cursos' ? <CoursesTab filtro={params.filtro} tenantName={tenantName} /> : null}
        {tab === 'trilhas' ? <TracksTab filtro={params.filtro} tenantName={tenantName} /> : null}
        {tab === 'lives' ? (
          <LivesTab
            filtro={params.filtro}
            tenantName={tenantName}
            timeZone={bootstrap.tenant.timezone}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
