import { Skeleton } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { HubTabs } from './HubTabs';
import { PosterSkeletons } from './MemberCoursesGrid';
import { MemberCoursesTab } from './MemberCoursesTab';
import { LiveCardSkeletons } from './MemberLivesList';
import { MemberLivesTab } from './MemberLivesTab';
import { COURSE_MEMBER_TABS, memberTabFromParam, memberTabHref } from './tabs';

/** The chip row's shape while the Cursos body streams in (UI-D-425). */
const CHIP_WIDTHS = [56, 72, 88];

function CoursesBodySkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      <div className="flex gap-2 overflow-hidden px-4 pb-3">
        {CHIP_WIDTHS.map((width) => (
          <Skeleton
            key={width}
            variant="rect"
            width={width}
            className="h-[30px] shrink-0 rounded-full"
          />
        ))}
      </div>
      <PosterSkeletons count={4} />
    </div>
  );
}

/**
 * The member `/cursos` (08.5-06, D-419, D-420, UI-D-424): the hub's frame verbatim minus the
 * manager's controls — the h1 "Cursos" 24/700, the subtitle "Cursos e lives de {tenant}." 14/400,
 * `HubTabs` over the member registry (Cursos · Lives, `?aba=` read HERE on the server; an unknown
 * value and the admin-only `trilhas` read as `cursos`), then the active body in its own `Suspense`
 * with its own skeleton (the segment's `loading.tsx` is role-neutral). No create control, no status
 * chips and no "Categorias" row ever render here.
 *
 * Rendered for every caller of a tenant with `courses` on who does not manage the school, and for an
 * `admin_tenant` with `?ver=aluno` (`preview`: every member link keeps the flag, UI-D-437).
 * Desktop: the 680px column (D-39).
 */
export async function MemberCatalogue({
  aba,
  categoria,
  tenantName,
  timeZone,
  preview,
}: {
  aba: string | string[] | undefined;
  categoria: string | string[] | undefined;
  tenantName: string;
  timeZone: string;
  preview: boolean;
}) {
  const t = await getTranslations();
  const tab = memberTabFromParam(aba);

  return (
    <div
      data-testid="courses-member-catalogue"
      className="mx-auto flex w-full max-w-[680px] flex-col"
    >
      {/* The heading block is `min-w-0 flex-1`: a long tenant name wraps the subtitle (E02 long-text). */}
      <div className="flex items-start px-4 pt-4 pb-1">
        <div className="min-w-0 flex-1">
          <h1
            data-brand-title
            className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text"
          >
            {t('courses.member.catalogue.title')}
          </h1>
          <p className="mt-1 break-words text-sm font-normal text-text-secondary">
            {t('courses.member.catalogue.subtitle', { tenant: tenantName })}
          </p>
        </div>
      </div>

      {/* Two tabs fit at 320px (E02 overflow). */}
      <HubTabs
        label={t('courses.hub.tabs.label')}
        value={tab}
        items={COURSE_MEMBER_TABS.map((item) => ({
          key: item.key,
          label: t(item.labelKey),
          href: memberTabHref(item.key, preview),
        }))}
        className="mb-4 border-b border-divider"
      />

      {tab === 'cursos' ? (
        <Suspense
          key={`cursos:${typeof categoria === 'string' ? categoria : ''}`}
          fallback={<CoursesBodySkeleton />}
        >
          <MemberCoursesTab categoria={categoria} tenantName={tenantName} preview={preview} />
        </Suspense>
      ) : null}
      {tab === 'lives' ? (
        <Suspense key="lives" fallback={<LiveCardSkeletons count={4} />}>
          <MemberLivesTab tenantName={tenantName} timeZone={timeZone} preview={preview} />
        </Suspense>
      ) : null}
    </div>
  );
}
