import { Skeleton } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { HubTabs } from './HubTabs';
import { PosterSkeletons } from './MemberCoursesGrid';
import { MemberCoursesTab } from './MemberCoursesTab';
import { HomeSkeleton, MemberHomeTab } from './MemberHomeTab';
import { LiveCardSkeletons } from './MemberLivesList';
import { MemberLivesTab } from './MemberLivesTab';
import { MemberProgressTab, ProgressSkeleton } from './MemberProgressTab';
import { MemberTracksTab, TracksSkeleton } from './MemberTracksTab';
import { PreviewBanner } from './PreviewBanner';
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
 * The member `/cursos` (08.5-06, 08.6-08, D-419, D-420, D-435, UI-D-424, UI-D-446, UI-D-447): the
 * hub's frame verbatim minus the manager's controls — the h1 "Cursos" 24/700, the subtitle "Cursos e
 * lives de {tenant}." 14/400, `HubTabs` over the member registry in the compact density (Início ·
 * Cursos · Trilhas · Lives · Progresso, `?aba=` read HERE on the server; no value, an unknown value
 * or a repeated one reads as Início, D-435), then the active body in its own `Suspense` with its own
 * skeleton (the segment's `loading.tsx` is role-neutral). Each body carries its own testid inside the
 * frame's `courses-member-catalogue` (`courses-member-home`, `courses-member-courses`,
 * `courses-member-tracks`, `courses-member-lives`, `courses-member-progress`), so the e2e can tell
 * the bodies apart. No create control, no status chips and no "Categorias" row ever render here.
 *
 * Rendered for every caller of a tenant with `courses` on who does not manage the school, and for an
 * `admin_tenant` with `?ver=aluno` (`preview`: every member link keeps the flag, UI-D-437). In the
 * preview the shipped `PreviewBanner` sits between the area row and the body, with "Voltar para a
 * edição" to the hub (`/cursos`), so the zeros and the disabled reminder explain themselves before
 * they read as broken (08.6-11, UI-D-459, D-422). A member's or a `support_tenant`'s `?ver=` never
 * draws it (the page passes `preview` only for a manager).
 * Desktop: the 680px column (D-39).
 */
export async function MemberCatalogue({
  aba,
  categoria,
  trilha,
  tenantName,
  timeZone,
  preview,
}: {
  aba: string | string[] | undefined;
  categoria: string | string[] | undefined;
  /** `?trilha=` — only the Trilhas body reads it, and only to choose among the server's tracks. */
  trilha: string | string[] | undefined;
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

      {/* Compact items (UI-D-446); below the row's width it scrolls and re-centres the active tab. */}
      <HubTabs
        label={t('courses.hub.tabs.label')}
        density="compact"
        value={tab}
        items={COURSE_MEMBER_TABS.map((item) => ({
          key: item.key,
          label: t(item.labelKey),
          href: memberTabHref(item.key, preview),
        }))}
        className="mb-4 border-b border-divider"
      />

      {preview ? <PreviewBanner backHref="/cursos" className="mt-0 mb-4" /> : null}

      {tab === 'inicio' ? (
        <Suspense key="inicio" fallback={<HomeSkeleton />}>
          <MemberHomeTab tenantName={tenantName} preview={preview} />
        </Suspense>
      ) : null}
      {tab === 'cursos' ? (
        <div data-testid="courses-member-courses">
          <Suspense
            key={`cursos:${typeof categoria === 'string' ? categoria : ''}`}
            fallback={<CoursesBodySkeleton />}
          >
            <MemberCoursesTab categoria={categoria} tenantName={tenantName} preview={preview} />
          </Suspense>
        </div>
      ) : null}
      {tab === 'trilhas' ? (
        <Suspense
          key={`trilhas:${typeof trilha === 'string' ? trilha : ''}`}
          fallback={<TracksSkeleton />}
        >
          <MemberTracksTab trilha={trilha} tenantName={tenantName} preview={preview} />
        </Suspense>
      ) : null}
      {tab === 'lives' ? (
        <div data-testid="courses-member-lives">
          <Suspense key="lives" fallback={<LiveCardSkeletons count={4} />}>
            <MemberLivesTab tenantName={tenantName} timeZone={timeZone} preview={preview} />
          </Suspense>
        </div>
      ) : null}
      {tab === 'progresso' ? (
        <Suspense key="progresso" fallback={<ProgressSkeleton />}>
          <MemberProgressTab tenantName={tenantName} preview={preview} />
        </Suspense>
      ) : null}
    </div>
  );
}
