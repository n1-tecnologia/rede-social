import { type LucideIcon, Radio, TrendingUp } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import type { MemberScreen } from '@/lib/member-area';
import { PosterSkeletons } from './MemberCoursesGrid';
import { MemberCoursesTab } from './MemberCoursesTab';
import { HomeSkeleton, MemberHomeTab } from './MemberHomeTab';
import { LivesSkeleton, MemberLivesTab } from './MemberLivesTab';
import { MemberProgressTab, ProgressSkeleton } from './MemberProgressTab';
import { MemberTracksTab, TracksSkeleton } from './MemberTracksTab';
import { ScreenHeader, ScreenHeaderSkeleton } from './ScreenHeader';

/**
 * The Cursos body's placeholder: since 2026-10-26 the screen's own header (with its search and
 * "Filtros") and the reference's cards (two, eight in the wide grid). Shared with
 * `area-membros/cursos/loading.tsx` (2026-10-22), so the route's loading and the body's own
 * `Suspense` draw the same geometry.
 */
export function CoursesBodySkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      {/* 2026-10-26: the screen draws its own header (the search and "Filtros" live in it). */}
      <ScreenHeaderSkeleton withAction />
      <div className="pt-3">
        <PosterSkeletons count={2} wideCount={8} />
      </div>
    </div>
  );
}

type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * The `ScreenHeader` words of a member screen (2026-10-22), with the reference's eyebrow since
 * 2026-10-26. Início has none (its one h1 is the greeting its body draws); Cursos and Trilhas draw
 * their own (the search lives in Cursos' header, and a track's page opens on its hero instead).
 */
function screenHeader(
  screen: MemberScreen,
  t: Translate,
  tenantName: string,
): { title: string; subtitle: string; eyebrow: { icon: LucideIcon; text: string } } | null {
  switch (screen) {
    case 'lives':
      return {
        title: t('courses.member.screens.lives.title'),
        subtitle: t('courses.member.screens.lives.meta', { tenant: tenantName }),
        eyebrow: { icon: Radio, text: t('courses.member.screens.lives.eyebrow') },
      };
    case 'progresso':
      return {
        title: t('courses.member.screens.progress.title'),
        subtitle: t('courses.member.screens.progress.meta', { tenant: tenantName }),
        eyebrow: { icon: TrendingUp, text: t('courses.member.screens.progress.eyebrow') },
      };
    default:
      return null;
  }
}

/**
 * The frame of every member screen of the school area (08.5-06, 08.6-08, D-419, D-420, D-435,
 * UI-D-424, UI-D-446, UI-D-447), rendered by the `/area-membros*` pages for every caller of a tenant
 * with `courses` on (since 2026-10-23 a manager too, always in `preview`: nothing is written).
 *
 * **2026-10-22 — one page per screen (the courses redesign on the social-igoralves prototype).** The
 * five screens are no longer tabs of this frame (`?aba=`, `HubTabs`) but pages of their own
 * (`/area-membros`, `/area-membros/cursos`, `/trilhas`, `/lives`, `/progresso`), reached from the
 * TopBar's "· Membros" menu and the rail's sub-lines; the page passes `screen`. The frame is now:
 *
 *  - (2026-10-23: no preview banner any more. A manager browses these screens as a member sees them
 *    and manages through the menu's "Gerenciar": the user's choice, the reference's model.)
 *  - the screen's `ScreenHeader` (its h1 and supporting line). Início has none: its h1 is the
 *    greeting its body draws, and the frame gives that body the header's top space (`pt-4`);
 *  - the body, in its own `Suspense` with its own skeleton (keyed by the category or the track, so
 *    a chip swap shows the skeleton again).
 *
 * The root keeps `courses-member-catalogue` and says which screen it holds (`data-screen`); each body
 * carries its own testid (`courses-member-home`, `courses-member-courses`, `courses-member-tracks`,
 * `courses-member-lives`, `courses-member-progress`). No create control, no status chips and no
 * "Categorias" row ever render here.
 *
 * 2026-10-23 (the wide desktop, the product owner's request): the root carries `data-shell-full`, so
 * the shell lifts its desktop column from 680px to 1280px, and the frame takes the whole width; each
 * body lays its grids out for it (more columns as the screen grows, cards side by side). The phone is
 * unchanged.
 */
export async function MemberCatalogue({
  screen,
  categoria,
  busca,
  trilha,
  tenantName,
  timeZone,
  preview,
}: {
  screen: MemberScreen;
  /** `?categoria=` — only the Cursos body reads it. */
  categoria: string | string[] | undefined;
  /** `?busca=` (2026-10-26) — only the Cursos body reads it. */
  busca?: string | string[] | undefined;
  /** `?trilha=` — only the Trilhas body reads it, and only to choose among the server's tracks. */
  trilha: string | string[] | undefined;
  tenantName: string;
  timeZone: string;
  preview: boolean;
}) {
  const t = await getTranslations();
  const header = screenHeader(screen, t, tenantName);

  return (
    <div
      data-testid="courses-member-catalogue"
      data-screen={screen}
      data-shell-full
      className="flex w-full flex-col"
    >
      {header ? (
        <ScreenHeader title={header.title} subtitle={header.subtitle} eyebrow={header.eyebrow} />
      ) : null}

      {screen === 'inicio' ? (
        <div className="pt-4">
          <Suspense key="inicio" fallback={<HomeSkeleton />}>
            <MemberHomeTab tenantName={tenantName} preview={preview} />
          </Suspense>
        </div>
      ) : null}
      {screen === 'cursos' ? (
        <div data-testid="courses-member-courses">
          <Suspense
            key={`cursos:${typeof categoria === 'string' ? categoria : ''}:${typeof busca === 'string' ? busca : ''}`}
            fallback={<CoursesBodySkeleton />}
          >
            <MemberCoursesTab
              categoria={categoria}
              busca={busca}
              tenantName={tenantName}
              preview={preview}
            />
          </Suspense>
        </div>
      ) : null}
      {screen === 'trilhas' ? (
        <Suspense
          key={`trilhas:${typeof trilha === 'string' ? trilha : ''}`}
          fallback={<TracksSkeleton />}
        >
          <MemberTracksTab trilha={trilha} tenantName={tenantName} preview={preview} />
        </Suspense>
      ) : null}
      {screen === 'lives' ? (
        <div data-testid="courses-member-lives">
          <Suspense key="lives" fallback={<LivesSkeleton />}>
            <MemberLivesTab tenantName={tenantName} timeZone={timeZone} preview={preview} />
          </Suspense>
        </div>
      ) : null}
      {screen === 'progresso' ? (
        <Suspense key="progresso" fallback={<ProgressSkeleton />}>
          <MemberProgressTab tenantName={tenantName} preview={preview} />
        </Suspense>
      ) : null}
    </div>
  );
}
