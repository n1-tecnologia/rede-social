import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { CoursesTab } from './CoursesTab';
import { HubTabs } from './HubTabs';
import { LivesTab } from './LivesTab';
import { TracksTab } from './TracksTab';
import { COURSE_HUB_TABS, hubTabFromParam, hubTabHref } from './tabs';

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
 * component below and the frame never changed for them. The module and
 * permission gate lives in `layout.tsx`. Desktop: the 680px column (D-39, UI-D-411); no rail entry
 * (D-401).
 */
export default async function CoursesHubPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string | string[]; filtro?: string | string[] }>;
}) {
  const [bootstrap, t, params] = await Promise.all([
    requireBootstrap(),
    getTranslations(),
    searchParams,
  ]);
  // The gate is `layout.tsx`'s; it is repeated here because Next renders the layout and the page
  // CONCURRENTLY, so without it a member's request would still fire the tab's two API reads (each
  // a guaranteed 403) before the layout's `notFound()` lands. Same cached bootstrap, no second call.
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }
  const tab = hubTabFromParam(params.aba);
  const tenantName = bootstrap.tenant.displayName;

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

      {tab === 'cursos' ? <CoursesTab filtro={params.filtro} tenantName={tenantName} /> : null}
      {tab === 'trilhas' ? <TracksTab filtro={params.filtro} tenantName={tenantName} /> : null}
      {tab === 'lives' ? (
        <LivesTab
          filtro={params.filtro}
          tenantName={tenantName}
          timeZone={bootstrap.tenant.timezone}
        />
      ) : null}
    </div>
  );
}
