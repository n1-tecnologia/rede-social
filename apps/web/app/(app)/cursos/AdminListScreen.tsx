import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import {
  COURSE_FILTER_LABEL_KEY,
  COURSE_FILTER_ORDER,
  courseFilterFromParam,
  courseFilterHref,
  LIVE_FILTER_LABEL_KEY,
  LIVE_FILTER_ORDER,
  liveFilterFromParam,
  liveFilterHref,
  TRACK_FILTER_LABEL_KEY,
  TRACK_FILTER_ORDER,
  trackFilterFromParam,
  trackFilterHref,
} from '@/lib/courses-view';
import type { AdminScreen } from '@/lib/member-area';
import { AdminListSkeleton } from './AdminListSkeletons';
import { ADMIN_SCREEN_TITLE_ID, CREATE_LINK } from './admin-styles';
import { CoursesTab } from './CoursesTab';
import { FilterMenu, type FilterOption } from './FilterMenu';
import { LivesTab } from './LivesTab';
import { ManageBackLink } from './ManageBackLink';
import { ScreenHeader } from './ScreenHeader';
import { TracksTab } from './TracksTab';

/**
 * 2026-10-22 — one of the admin's three list screens of the courses area (`/cursos`,
 * `/cursos/trilhas`, `/cursos/lives`), each a page of its own instead of a tab of one hub (the
 * social-igoralves admin lists). Since 2026-10-23 they are reached from a card of "Gerenciar"
 * (`/cursos/gerenciar`), the last row of the "Membros" menu. The page routes and redirects; this
 * component draws:
 *
 *  - `courses-hub` with `data-screen`, the 680px column (D-39);
 *  - the `ScreenHeader`: "‹ Gerenciar" above it (`ManageBackLink`, the way back to the hub), the
 *    screen's h1 (24/800, the tenant's title font), the supporting line and, on the right, the brand
 *    "Novo curso" / "Nova trilha" / "Nova live" link, the screen's ONE brand fill (UI-D-391;
 *    `data-courses-create` / `data-tracks-create` / `data-lives-create` kept);
 *  - the filter (links bound to `?filtro=`, read here on the server; an unknown value reads as the
 *    default, E03/E04 partial), since 2026-10-23 an icon button left of "Novo …" that opens a
 *    dropdown (`FilterMenu`, the user's call) instead of the row of chips under the title; it lives
 *    in the header, OUTSIDE the `Suspense`, so a switch never blanks the header while the new page
 *    streams;
 *  - the body (`CoursesTab`, `TracksTab`, `LivesTab`: the list, its empty, error and paging states)
 *    in its own `Suspense` keyed by the filter, with the body's skeleton; it enters with the CSS
 *    `animate-swap-in` (a filter is a link, so the swap is a page load; still under "reduzir
 *    movimento").
 *
 * 2026-10-23 (the wide desktop lists): `courses-hub` carries `data-shell-wide`, so the shell lifts
 * its 680px desktop column to 1280px for these three screens; the header spans the width, and each
 * body lays its cards out in a grid that gains columns as the screen grows (`CoursesList`,
 * `TracksList`, `LivesList`).
 *
 * The interface `{ screen, filtro, tenantName, timeZone }` is the pages' contract.
 */
export async function AdminListScreen({
  screen,
  filtro,
  tenantName,
  timeZone,
}: {
  screen: AdminScreen;
  filtro: string | string[] | undefined;
  tenantName: string;
  timeZone: string;
}) {
  const t = await getTranslations();
  const filterKey = typeof filtro === 'string' ? filtro : '';
  const titleId = ADMIN_SCREEN_TITLE_ID[screen];

  let header: { title: string; subtitle: string };
  let create: { href: string; label: string; hook: string };
  let filters: { label: string; testId: string; options: FilterOption[] };
  if (screen === 'trilhas') {
    const active = trackFilterFromParam(filtro);
    header = {
      title: t('courses.screens.tracks.title'),
      subtitle: t('courses.screens.tracks.subtitle', { tenant: tenantName }),
    };
    create = {
      href: '/cursos/trilhas/nova',
      label: t('courses.hub.create.track'),
      hook: 'data-tracks-create',
    };
    filters = {
      label: t('courses.tracks.filter.label'),
      testId: 'tracks-filters',
      options: TRACK_FILTER_ORDER.map((key) => ({
        key,
        label: t(TRACK_FILTER_LABEL_KEY[key]),
        href: trackFilterHref(key),
        active: active === key,
      })),
    };
  } else if (screen === 'lives') {
    const active = liveFilterFromParam(filtro);
    header = {
      title: t('courses.screens.lives.title'),
      subtitle: t('courses.screens.lives.subtitle', { tenant: tenantName }),
    };
    create = {
      href: '/cursos/lives/nova',
      label: t('courses.hub.create.live'),
      hook: 'data-lives-create',
    };
    filters = {
      label: t('courses.lives.filter.label'),
      testId: 'lives-filters',
      options: LIVE_FILTER_ORDER.map((key) => ({
        key,
        label: t(LIVE_FILTER_LABEL_KEY[key]),
        href: liveFilterHref(key),
        active: active === key,
      })),
    };
  } else {
    const active = courseFilterFromParam(filtro);
    header = {
      title: t('courses.hub.title'),
      subtitle: t('courses.screens.courses.subtitle', { tenant: tenantName }),
    };
    create = {
      href: '/cursos/novo',
      label: t('courses.hub.create.course'),
      hook: 'data-courses-create',
    };
    filters = {
      label: t('courses.list.filter.label'),
      testId: 'courses-filters',
      options: COURSE_FILTER_ORDER.map((key) => ({
        key,
        label: t(COURSE_FILTER_LABEL_KEY[key]),
        href: courseFilterHref(key),
        active: active === key,
      })),
    };
  }

  // The button's name carries the choice on screen (an unknown ?filtro= reads as the default).
  const current = filters.options.find((option) => option.active) ?? filters.options[0];

  return (
    <div
      data-testid="courses-hub"
      data-screen={screen}
      data-shell-wide
      className="mx-auto flex w-full flex-col"
    >
      <ScreenHeader
        title={header.title}
        subtitle={header.subtitle}
        titleId={titleId}
        back={<ManageBackLink />}
        action={
          <div className="flex items-center gap-2">
            <FilterMenu
              label={filters.label}
              buttonLabel={t('courses.hub.filter.button', {
                label: filters.label,
                current: current?.label ?? '',
              })}
              options={filters.options}
              testId={filters.testId}
            />
            <a href={create.href} {...{ [create.hook]: true }} className={CREATE_LINK}>
              <Plus aria-hidden size={16} />
              {create.label}
            </a>
          </div>
        }
      />

      <Suspense
        key={`${screen}:${filterKey}`}
        fallback={
          <AdminListSkeleton
            screen={screen}
            pastLives={screen === 'lives' && liveFilterFromParam(filtro) === 'past'}
          />
        }
      >
        <div className="animate-swap-in motion-reduce:animate-none">
          {screen === 'cursos' ? <CoursesTab filtro={filtro} tenantName={tenantName} /> : null}
          {screen === 'trilhas' ? <TracksTab filtro={filtro} tenantName={tenantName} /> : null}
          {screen === 'lives' ? (
            <LivesTab filtro={filtro} tenantName={tenantName} timeZone={timeZone} />
          ) : null}
        </div>
      </Suspense>
    </div>
  );
}
