import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { LearnOverviewLive } from '@rede-social/module-courses/contracts';
import { buttonClasses, Card, chipBase, cn, EmptyState, Skeleton } from '@rede-social/ui';
import { Flame, GraduationCap } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLearnOverview } from '@/lib/courses-learn';
import {
  catalogueCategoryHref,
  categoryTileView,
  type HomeLiveView,
  homeHeroView,
  homeLiveView,
  homeTrackView,
  newLessonView,
  shelfRowView,
  streakBadgeView,
} from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';
import { getLiveAccess } from '@/lib/store';
import { lockedLiveView } from '@/lib/store-view';
import { HomeCategories } from './HomeCategories';
import { HomeHero } from './HomeHero';
import { HomeLive, type HomeLiveBody } from './HomeLive';
import { HomeNewLessons } from './HomeNewLessons';
import { HomeShelf } from './HomeShelf';
import { HomeTrack } from './HomeTrack';
import { memberTabHref } from './tabs';

/** "Tentar novamente": the `outline sm` look as a LINK to the page's own URL (44px hit area). */
const RETRY_LINK = buttonClasses({
  variant: 'outline',
  size: 'sm',
  hitArea: true,
  className: 'self-start',
});

const SHELF_ROWS = [60, 50, 66];

/**
 * Início's ONE skeleton (UI-D-447, UI E03 loading), drawn by the frame's single `Suspense` around
 * this body: the greeting bar and the badge, the hero (the 16:9 rect, two bars, the `h-2` bar and
 * the `h-11` button bar) and three 56px shelf rows inside a `Card`. No words.
 */
export function HomeSkeleton() {
  return (
    <div aria-busy data-testid="courses-member-home-skeleton" className="flex flex-col gap-6 pb-6">
      <div className="flex items-center justify-between gap-3 px-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton variant="rect" className="h-8 w-24 shrink-0 rounded-full" />
      </div>
      <Card className="mx-4 p-0">
        <Skeleton variant="rect" className="aspect-video w-full rounded-none" />
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton variant="rect" className="h-2 w-full rounded-full" />
          <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
        </div>
      </Card>
      <Card className="mx-4 flex flex-col divide-y divide-divider p-0">
        {SHELF_ROWS.map((width) => (
          <div key={width} className="flex min-h-14 items-center gap-3 p-3">
            <Skeleton variant="rect" className="h-12 w-12 shrink-0 rounded-lg" />
            <Skeleton className="h-4" width={`${width}%`} />
          </div>
        ))}
      </Card>
    </div>
  );
}

/**
 * The member Início (08.6-08, D-435, D-437, D-440, D-443, UI-D-447..UI-D-449, COURSE-28, 29, 34, 37):
 * the area's home, rendered from ONE `GET /v1/courses/learn/overview` read inside the frame's ONE
 * `Suspense` (`MemberCatalogue`), top to bottom `flex flex-col gap-6 pb-6`:
 *
 *  1. the greeting row — "Bem-vindo de volta." (`min-w-0`) and the server's study streak as a
 *     static, non-interactive badge (`shrink-0`, `chipBase` geometry, `Flame` 12 `aria-hidden`):
 *     tinted above zero, neutral "Sem sequência" at zero. Display only (D-443, PR-1);
 *  2. the hero (`HomeHero`), or — an overview with no `hero` is an empty school — the shipped
 *     catalogue empty card in place of the course sections (COURSE-34).
 *
 *  3. the live happening now (`HomeLive`, 08.6-11) — only with `live` at `status: 'live'`;
 *  4. "Meus cursos" (`HomeShelf`, 08.6-09) — only with `shelf`;
 *  5. "Sua trilha" (`HomeTrack`, 08.6-09) — only with `track`;
 *  6. "Próxima live" (`HomeLive`, 08.6-11) — only with `live` at `status: 'scheduled'`;
 *  7. "Novas aulas da semana" (`HomeNewLessons`, 08.6-09) — only with `newLessons`;
 *  8. "Explore por categoria" (`HomeCategories`, 08.6-09) — only with `categories`.
 *
 * A section whose key is absent renders nothing: no title, no card, no gap (planning decision 1 of
 * 08.6-09). The live's relative day is decided HERE, in the RSC, from the overview's `serverNow` in
 * the tenant timezone (UI-D-288); a locked next live reads the store's access (only then, and only
 * with the store on) for its buy path (D-446, planning decision 2).
 *
 * The web decides nothing (UI-SPEC E02..E09, T-08.6-17): no lock, no hero state, no day count —
 * every value is the strict-parsed answer, and no client clock is read here. The read's refusals
 * split like the Cursos body's: `disabled` → the kernel not-found, `redirect` → a navigation outside
 * any try/catch, anything else → the error card (the frame and the row stay usable).
 */
export async function MemberHomeTab({
  tenantName,
  preview,
}: {
  tenantName: string;
  preview: boolean;
}) {
  const [t, result, bootstrap] = await Promise.all([
    getTranslations(),
    getLearnOverview(),
    requireBootstrap(),
  ]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();

  if (result.status === 'error') {
    return (
      <div data-testid="courses-member-home" className="flex flex-col gap-6 pb-6">
        <Card data-testid="courses-member-home-error" className="mx-4 flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <p className="text-base font-bold leading-tight text-text">
              {t('courses.errors.title')}
            </p>
            <p className="text-sm font-normal text-text-secondary">{t('courses.errors.home')}</p>
          </div>
          <a href={memberTabHref('inicio', preview)} className={RETRY_LINK}>
            {t('courses.errors.retry')}
          </a>
        </Card>
      </div>
    );
  }

  const overview = result.page;
  const streak = streakBadgeView(overview.streakDays, t);
  const hero = overview.hero ? homeHeroView(overview.hero, t, { preview }) : null;
  const shelf = overview.shelf?.map((item) => shelfRowView(item, t, preview)) ?? [];
  const track = overview.track ? homeTrackView(overview.track, t, preview) : null;
  const newLessons = overview.newLessons?.map((item) => newLessonView(item, t, preview)) ?? [];
  const categories = overview.categories?.map((tile) => categoryTileView(tile, t, preview)) ?? [];
  const live = overview.live
    ? homeLiveView(overview.live, overview.serverNow, bootstrap.tenant.timezone, t, preview)
    : null;
  const liveBody =
    live?.kind === 'next' && overview.live
      ? await nextLiveBody(
          overview.live,
          live,
          preview,
          bootstrap.modules.some((module) => module.key === 'store'),
          t as unknown as CoursesTranslator,
        )
      : null;
  const liveSlot = live ? (
    <HomeLive
      view={live}
      sectionTitle={t('courses.member.home.sections.nextLive')}
      body={liveBody}
    />
  ) : null;

  return (
    <div data-testid="courses-member-home" className="flex flex-col gap-6 pb-6">
      <div className="flex items-center justify-between gap-3 px-4">
        <h2 className="min-w-0 text-base font-bold leading-tight text-text">
          {t('courses.member.home.greeting')}
        </h2>
        <span
          role="img"
          aria-label={streak.ariaLabel}
          data-testid="courses-member-streak"
          data-active={streak.active}
          className={cn(
            chipBase,
            'tabular-nums',
            streak.active ? 'bg-brand/10 text-text' : 'bg-bg-input text-text-tertiary',
          )}
        >
          <Flame
            aria-hidden
            size={12}
            className={streak.active ? 'shrink-0 text-brand' : 'shrink-0'}
          />
          <span aria-hidden>{streak.label}</span>
        </span>
      </div>

      {hero ? (
        <HomeHero view={hero} />
      ) : (
        <EmptyState
          variant="card"
          icon={GraduationCap}
          data-testid="courses-member-home-empty"
          className="mx-4"
          title={t('courses.member.catalogue.empty.title')}
          body={t('courses.member.catalogue.empty.body', { tenant: tenantName })}
        />
      )}

      {live?.kind === 'now' ? liveSlot : null}

      {shelf.length > 0 ? (
        <HomeShelf
          rows={shelf}
          title={t('courses.member.home.sections.shelf')}
          seeAll={{
            href: catalogueCategoryHref(null, preview),
            label: t('courses.member.home.seeAll'),
            ariaLabel: t('courses.member.home.seeAllCourses'),
          }}
        />
      ) : null}

      {track ? (
        <HomeTrack
          view={track}
          title={t('courses.member.home.sections.track')}
          seeAllLabel={t('courses.member.home.seeAll')}
          seeAllAriaLabel={t('courses.member.home.seeAllTracks')}
        />
      ) : null}

      {live?.kind === 'next' ? liveSlot : null}

      {newLessons.length > 0 ? (
        <HomeNewLessons items={newLessons} title={t('courses.member.home.sections.newLessons')} />
      ) : null}

      {categories.length > 0 ? (
        <HomeCategories tiles={categories} title={t('courses.member.home.sections.categories')} />
      ) : null}
    </div>
  );
}

/**
 * The next live's body (UI-D-452): the preview's disabled toggle (D-422), the open live's toggle
 * from the server's `reminderOn`, or — locked (D-446) — the 08.5 buy path in outline (A-UI-8) from
 * the store's access read. With the store off nothing is buyable (the not-for-sale line, no read);
 * a failed read is "Ver a live" to the live page, where the 08.5 failure variant lives.
 */
async function nextLiveBody(
  live: LearnOverviewLive,
  view: HomeLiveView,
  preview: boolean,
  storeOn: boolean,
  t: CoursesTranslator,
): Promise<HomeLiveBody> {
  if (preview) return { kind: 'reminder', initialOn: false, preview: true };
  if (!live.locked) return { kind: 'reminder', initialOn: live.reminderOn, preview: false };

  const target = { liveId: live.id, liveTitle: live.title };
  const access = storeOn ? await getLiveAccess(live.id) : null;
  if (storeOn && !access) {
    return { kind: 'seeLive', href: view.href, label: t('courses.member.home.live.seeLive') };
  }
  const locked = lockedLiveView(access ?? { archivedTag: false, buyableProducts: [] }, target, t);
  const label = t('courses.member.locked.buy');
  if (locked.section === 'one' && locked.productHref) {
    return { kind: 'buyOne', href: locked.productHref, label };
  }
  if (locked.section === 'many') {
    return {
      kind: 'buyMany',
      label,
      title: locked.choiceTitle,
      helper: locked.choiceHelper,
      choices: locked.choices.map((choice) => ({
        href: choice.href,
        name: choice.name,
        priceLabel: choice.priceLabel,
        ariaLabel: choice.ariaLabel,
        thumb: choice.imageAssetId ? (
          <MediaImage
            assetId={choice.imageAssetId}
            widths={PURPOSE_WIDTHS.cover}
            alt=""
            sizes="40px"
            ratio=""
            className="h-full w-full"
          />
        ) : (
          <span
            className="block h-full w-full"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        ),
      })),
    };
  }
  return { kind: 'notForSale', text: locked.body };
}
