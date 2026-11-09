import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type {
  LearnCourseCard,
  LearnMyProgress,
  LearnOutlineLesson,
  LearnOverview,
  LearnOverviewLive,
} from '@rede-social/module-courses/contracts';
import {
  type ProductCard,
  type ProductPage,
  STORE_MAX_PAGE_SIZE,
  STORE_PERMISSIONS,
} from '@rede-social/module-store/contracts';
import { buttonClasses, cn, Skeleton } from '@rede-social/ui';
import { CircleAlert, GraduationCap } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { neverStarted, startHero, suggestedStart, swapShelf } from '@/lib/courses-home-plan';
import {
  homeAreasView,
  homeGreetingView,
  homePromoView,
  homeResumeSpotView,
  homeStatsView,
  homeTrackCards,
  popularCategories,
  quickCourses,
  quickCourseView,
} from '@/lib/courses-home-view';
import {
  getLearnCatalogueAll,
  getLearnCourse,
  getLearnOverview,
  getLearnProgress,
  getLearnTracks,
  type LearnReadResult,
} from '@/lib/courses-learn';
import {
  catalogueCategoryHref,
  type HomeLiveView,
  homeHeroView,
  homeLiveView,
  memberTracksHref,
  newLessonView,
} from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';
import { readHomePromoChoice } from '@/lib/home-promo-cookie';
import { memberScreenHref } from '@/lib/member-area';
import { resumeSpotLocalView } from '@/lib/resume-spot-local-view';
import { getLiveAccess, getProducts } from '@/lib/store';
import { lockedLiveView, priceLabel } from '@/lib/store-view';
import { HomeAreas } from './HomeAreas';
import { HomeContinueFloat } from './HomeContinueFloat';
import {
  HOME_RESUME_ID,
  HomeDashboard,
  HomeLatest,
  HomePromo,
  HomeResume,
  HomeStats,
} from './HomeDashboard';
import { HomeGreeting } from './HomeGreeting';
import { HomeLive, type HomeLiveBody } from './HomeLive';
import { HomePromoChoice } from './HomePromoChoice';
import { HomeResumeSpot } from './HomeResumeSpot';
import { HomeShelf } from './HomeShelf';
import { HomeTracks } from './HomeTracks';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from './MemberEmptyCard';

/** "Tentar novamente": the `outline sm` look as a LINK to the page's own URL (44px hit area). */
const RETRY_LINK = buttonClasses({ variant: 'outline', size: 'sm', hitArea: true });

/** The quick-access row's courses: ONE row, five at the widest (the reference's preview). */
const QUICK_COURSES = 5;

/** Fewer areas than this and "Mais da escola" is not drawn (Lives alone is already in the menu). */
const AREAS_MIN = 2;

/** The promotion's read for a member: the newest product and the collage's images. */
const PROMO_PRODUCTS = 12;

/** The administrator's picker lists every active product, up to this many pages of 50. */
const PROMO_PICK_PAGES = 4;

const TRACK_SKELETONS = [0, 1, 2];
const CARD_SKELETONS = [0, 1, 2, 3];

/** The error state's h1: the old greeting row (18/800 tight; display-sized inside the skin). */
const GREETING =
  'ms-title-display min-w-0 text-lg font-extrabold leading-none tracking-tight text-text';

/**
 * Início's ONE skeleton (UI-D-447, UI E03 loading), drawn by the frame's single `Suspense` around
 * this body, at the 2026-10-26 geometry: the centred greeting, the question and the search box, the
 * tracks row, the courses row under its title and the dashboard panel. No words.
 */
export function HomeSkeleton() {
  return (
    <div
      aria-busy
      data-testid="courses-member-home-skeleton"
      className="flex flex-col gap-9 pb-10 md:gap-12"
    >
      <div className="flex flex-col items-center px-4 pt-4 md:pt-10">
        <Skeleton className="ms-skel-display h-8 w-56 md:h-10 md:w-80" />
        <Skeleton className="mt-3 h-5 w-64 md:w-80" />
        <Skeleton variant="rect" className="mt-6 h-[104px] w-full max-w-2xl rounded-3xl md:mt-8" />
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="mx-4 h-4 w-24" />
        <div className="flex gap-3 overflow-hidden px-4 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-5">
          {TRACK_SKELETONS.map((index) => (
            <Skeleton
              key={index}
              variant="rect"
              className={cn(
                'aspect-[4/5] w-[82%] shrink-0 rounded-2xl sm:aspect-auto sm:h-[300px] sm:w-auto md:rounded-3xl lg:h-[340px]',
                index === 2 && 'sm:hidden lg:block',
              )}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-2 px-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-52" />
        </div>
        <div className="flex gap-3 overflow-hidden px-4 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-5 xl:grid-cols-4">
          {CARD_SKELETONS.map((index) => (
            <div
              key={index}
              className={cn(
                'ms-panel ms-solid flex w-[260px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card sm:w-auto',
                index === 3 && 'lg:max-xl:hidden',
              )}
            >
              <Skeleton variant="rect" className="aspect-video w-full rounded-none" />
              <div className="flex flex-col gap-2.5 p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="px-4">
        <Skeleton variant="rect" className="h-[420px] w-full rounded-3xl lg:h-[380px]" />
      </div>
    </div>
  );
}

/**
 * The member Início (08.6-08, D-435, D-437, D-440, D-443, UI-D-447..UI-D-449, COURSE-28, 29, 34, 37).
 *
 * **2026-10-26 (rethought on the academy reference's home, the user's "tela de início repensada,
 * com vários gatilhos").** Every block is built from reads the member area already makes, all in
 * ONE wave inside the frame's ONE `Suspense` (`MemberCatalogue`): the overview (the hero, the live,
 * the week's lessons, the categories, the clock), the member's own numbers (`progress`), the tracks,
 * the catalogue and, with the store on, its active products (the panel's promotion). Top to bottom,
 * each block only with data (UI-D-447). Since the product owner's second pass ("exatamente assim",
 * "mais fiel", "quero motion nos cards") each block follows the reference card for card:
 *
 *  1. the greeting (`HomeGreeting`): "Boa tarde, Thiago!" by the part of the day in the school's
 *     zone, the page's ONE h1, "O que você quer aprender agora?" and the catalogue search with
 *     "Populares:" (the categories with the most courses);
 *  2. "Continue de onde parou" (`HomeResumeSpot`, 2026-10-27), while the member is in the middle of
 *     a course (the server's `retomando`): the lesson, the second they stopped at as a bar ("Você
 *     parou em 12:34 de 25:00") and ONE link over the card, straight to the player;
 *  3. the live happening now (`HomeLive` `now`);
 *  4. the tracks (`HomeTracks`): three large cover cards with breathing glows and a stack of two
 *     small tiles, the member's own first;
 *  5. "Cursos" (`HomeShelf`): ONE row of the reference's quick card, the member's OPEN courses,
 *     the ones in progress first, "N disponíveis", "Ver todos";
 *  6. the dashboard panel (`HomeDashboard`, the brand's ambient light behind it): the numbers strip
 *     (overall progress, lessons, the streak, courses completed); at the left the hero when the
 *     member is NOT resuming ("Comece por aqui", "Você está em dia", with its CTA; resuming, it is
 *     the card at the top) over "Últimas aulas" (the week's new lessons as text rows); at the right
 *     the promotion (the store's newest product, which the administrator can swap with the pencil,
 *     `HomePromoChoice`; else the catalogue) over a moving collage of the school's images;
 *  7. the next live (`HomeLive` `next`), across the row like a banner, with its reminder or buy path;
 *  8. "Mais de {tenant}" (`HomeAreas`): the school's other areas, from the menu;
 *  9. the floating "Continuar assistindo" (`HomeContinueFloat`) on a desktop, while the card at the
 *     top is out of view.
 *
 * An empty school (no hero) is the greeting and the catalogue's empty card. The web still decides
 * nothing (UI-SPEC E02..E09, T-08.6-17): no lock, no hero state, no count. The numbers are the
 * server's, and no clock is read here (the hour is the overview's `serverNow` in the tenant zone).
 * The refinements of 2026-10-22 stay (`planHome`): a member who never started a lesson lands on the
 * catalogue, and with nothing in progress the hero is the platform's suggestion. A failed overview
 * is the error card under the old greeting; any other failed read only drops its own block.
 */
export async function MemberHomeTab({
  tenantName,
  preview,
}: {
  tenantName: string;
  preview: boolean;
}) {
  const bootstrap = await requireBootstrap();
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  // The panel's promotion is the administrator's to pick (`HomePromoChoice`): the store's manager.
  const canPickPromo = storeOn && bootstrap.permissions.includes(STORE_PERMISSIONS.manage);
  const [t, result, progressRead, tracksRead, catalogueRead, products, promoPick] =
    await Promise.all([
      getTranslations(),
      getLearnOverview(),
      getLearnProgress(),
      getLearnTracks(),
      getLearnCatalogueAll(),
      // The panel's promotion: the store's active products (a failed read only drops the product).
      storeOn ? promoProducts(canPickPromo) : Promise.resolve(null),
      canPickPromo ? readHomePromoChoice() : Promise.resolve(null),
    ]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();

  if (result.status === 'error') {
    return (
      <div data-testid="courses-member-home" className="flex flex-col gap-7 pb-6">
        <div className="flex items-center gap-3 px-4">
          <h1 data-brand-title className={GREETING}>
            {t('courses.member.home.greeting')}
          </h1>
        </div>
        <MemberEmptyCard
          icon={CircleAlert}
          tone="error"
          data-testid="courses-member-home-error"
          className={cn('mx-4', MEMBER_EMPTY_WIDE)}
          title={t('courses.errors.title')}
          body={t('courses.errors.home')}
          action={
            <a href={memberScreenHref('inicio', {}, preview)} className={RETRY_LINK}>
              {t('courses.errors.retry')}
            </a>
          }
        />
      </div>
    );
  }

  const plan = await planHome(result.page, preview, progressRead, catalogueRead);
  if (plan.catalogue) redirect(memberScreenHref('cursos', {}, preview));
  const overview = plan.overview;
  const catalogue = catalogueRead.status === 'ok' ? catalogueRead.page : null;
  // "Seus cursos": the courses the member can open (the SERVER's lock), the reference's quick access.
  const openCourses = catalogue?.filter((card) => !card.locked) ?? [];

  const greeting = homeGreetingView(bootstrap, overview.serverNow, t);
  const popular = popularCategories(overview.categories, preview);
  const tracks = homeTrackCards(
    tracksRead.status === 'ok' ? tracksRead.page.tracks : null,
    overview.track,
    t,
    preview,
  );
  const quick = quickCourses(openCourses, QUICK_COURSES).map((card) =>
    quickCourseView(card, t, preview),
  );
  const stats = progressRead.status === 'ok' ? homeStatsView(progressRead.page, t, preview) : null;
  const hero = overview.hero ? homeHeroView(overview.hero, t, { preview }) : null;
  const newLessons = overview.newLessons?.map((item) => newLessonView(item, t, preview)) ?? [];
  const areas = homeAreasView(bootstrap.modules, t, preview);
  // The store's NEWEST active product by default (the API lists them newest first); for the
  // administrator, THIS device's pick while it is still for sale (`lib/home-promo.ts`).
  const forSale = (products ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    price: priceLabel(item.priceCents, t),
    imageAssetId: item.imageAssetId,
  }));
  const newest = forSale[0] ?? null;
  const promoChoice = forSale.some((item) => item.id === promoPick) ? promoPick : null;
  const promo = homePromoView({
    product: newest,
    productImages: forSale.map((item) => item.imageAssetId),
    courseCovers: catalogue?.map((card) => card.coverAssetId) ?? [],
    courseCount: catalogue?.length ?? 0,
    trackCount: tracks.total,
    tenant: tenantName,
    t,
    preview,
  });
  const live = overview.live
    ? homeLiveView(overview.live, overview.serverNow, bootstrap.tenant.timezone, t, preview)
    : null;
  const liveBody =
    live?.kind === 'next' && overview.live
      ? await nextLiveBody(overview.live, live, preview, storeOn, t as unknown as CoursesTranslator)
      : null;
  const resuming =
    hero && overview.hero?.state === 'retomando' && overview.hero.lessonId !== null
      ? { lessonId: overview.hero.lessonId, hero: overview.hero, view: hero }
      : null;
  // The card at the top while resuming: the hero's lesson with the member's own minute in it.
  const spot = resuming
    ? homeResumeSpotView(
        resuming.view,
        await resumeLesson(resuming.hero.courseId, resuming.lessonId),
        t,
      )
    : // ⚠ TEMPORARY LOCAL VIEW (2026-10-27): remove with `resume-spot-local-view.ts` on "ok".
      resumeSpotLocalView(overview.hero ?? null, preview, t);

  return (
    <div
      data-testid="courses-member-home"
      // The floating "Continuar assistindo" never covers the last blocks for good: the page scrolls
      // them above it on a desktop.
      className={cn('flex flex-col gap-9 pb-10 md:gap-12', resuming && 'md:pb-28')}
    >
      <HomeGreeting
        view={greeting}
        search={{
          action: memberScreenHref('cursos'),
          preview,
          label: t('courses.member.search.label'),
          placeholder: t('courses.member.home.searchPlaceholder'),
          submitLabel: t('courses.member.search.submit'),
        }}
        popular={popular}
        popularLabel={t('courses.member.home.popular')}
      />

      {spot ? <HomeResumeSpot view={spot} /> : null}

      {live?.kind === 'now' ? (
        <HomeLive
          view={live}
          sectionTitle={t('courses.member.home.sections.nextLive')}
          body={null}
        />
      ) : null}

      {hero ? null : (
        <MemberEmptyCard
          icon={GraduationCap}
          data-testid="courses-member-home-empty"
          className={cn('mx-4', MEMBER_EMPTY_WIDE)}
          title={t('courses.member.catalogue.empty.title')}
          body={t('courses.member.catalogue.empty.body', { tenant: tenantName })}
        />
      )}

      {tracks.cards.length > 0 ? (
        <HomeTracks
          cards={tracks.cards}
          title={t('courses.member.area.screens.tracks')}
          seeAll={{
            href: memberTracksHref(preview),
            label: t('courses.member.home.tracks.all'),
            ariaLabel: t('courses.member.home.seeAllTracks'),
          }}
        />
      ) : null}

      {quick.length > 0 ? (
        <HomeShelf
          cards={quick}
          title={t('courses.member.home.courses.title')}
          sub={t('courses.member.home.courses.sub', { n: openCourses.length })}
          seeAll={{
            href: catalogueCategoryHref(null, preview),
            label: t('courses.member.home.courses.all'),
            ariaLabel: t('courses.member.home.seeAllCourses'),
          }}
        />
      ) : null}

      {hero ? (
        <HomeDashboard
          stats={
            stats ? (
              <HomeStats
                view={stats}
                labels={{
                  region: t('courses.member.home.stats.label'),
                  progress: t('courses.member.home.stats.progress'),
                  lessons: t('courses.member.home.stats.lessons'),
                  streak: t('courses.member.home.stats.streak'),
                  courses: t('courses.member.home.stats.courses'),
                }}
              />
            ) : null
          }
          // Resuming, the hero is the card at the top (`HomeResumeSpot`), never twice.
          resume={spot ? null : <HomeResume view={hero} sub={null} />}
          latest={
            newLessons.length > 0 ? (
              <HomeLatest
                items={newLessons}
                title={t('courses.member.home.latest.title')}
                sub={t('courses.member.home.latest.sub')}
                all={{
                  href: catalogueCategoryHref(null, preview),
                  label: t('courses.member.home.latest.all'),
                }}
              />
            ) : null
          }
          promo={
            <HomePromo
              view={promo}
              compact={spot !== null}
              body={
                canPickPromo && newest ? (
                  <HomePromoChoice
                    view={promo}
                    options={forSale.map((item) => ({
                      id: item.id,
                      name: item.name,
                      price: item.price,
                      thumb: productThumb(item.imageAssetId),
                    }))}
                    initialChoice={promoChoice}
                    labels={{
                      open: t('courses.member.home.promo.edit.open'),
                      title: t('courses.member.home.promo.edit.title'),
                      helper: t('courses.member.home.promo.edit.helper'),
                      latest: t('courses.member.home.promo.edit.latest'),
                      latestLine: t('courses.member.home.promo.edit.latestLine', {
                        product: newest.name,
                      }),
                      device: t('courses.member.home.promo.edit.device'),
                    }}
                  />
                ) : undefined
              }
            />
          }
        />
      ) : null}

      {live?.kind === 'next' ? (
        <HomeLive
          view={live}
          sectionTitle={t('courses.member.home.sections.nextLive')}
          body={liveBody}
          panoramic
        />
      ) : null}

      {areas.length >= AREAS_MIN ? (
        <HomeAreas
          areas={areas}
          title={t('courses.member.home.areas.label', { tenant: tenantName })}
        />
      ) : null}

      {resuming ? (
        <HomeContinueFloat
          lessonId={resuming.lessonId}
          href={resuming.view.cta.href}
          eyebrow={t('courses.member.home.float.eyebrow')}
          title={resuming.view.title}
          meta={t('courses.member.home.float.meta', {
            course: resuming.hero.courseTitle,
            percent: resuming.hero.percent,
          })}
          percent={resuming.hero.percent}
          closeLabel={t('courses.member.home.float.close')}
          watchId={HOME_RESUME_ID}
        />
      ) : null}
    </div>
  );
}

/**
 * 2026-10-22 — what Início leads with, on the user's rule (`lib/courses-home-plan.ts`): a course in
 * progress stays as the API answered (`retomando`, the lesson the member stopped at); a member who
 * never started a lesson lands on the catalogue instead (the user's choice: Início appears from the
 * first lesson on; never in a preview, where the admin writes no progress); with nothing in progress
 * but something finished (`comecando`) the hero becomes the platform's suggestion — the next course
 * of a track the member is on, else the next course at the member's level — and "Meus cursos" takes
 * the displaced course back. An empty school (no hero) keeps Início and its empty card. Any refusal
 * keeps the API's answer, never the error card. Since 2026-10-26 the member's progress and the
 * catalogue arrive already read (Início's one wave); only the suggested course's page is read here.
 */
async function planHome(
  overview: LearnOverview,
  preview: boolean,
  progress: LearnReadResult<LearnMyProgress>,
  cards: LearnReadResult<LearnCourseCard[]>,
): Promise<{ catalogue: true } | { catalogue: false; overview: LearnOverview }> {
  const keep = { catalogue: false as const, overview };
  const hero = overview.hero;
  if (!hero || hero.state === 'retomando') return keep;
  if (!preview && progress.status === 'ok' && neverStarted(progress.page)) {
    return { catalogue: true };
  }
  if (hero.state !== 'comecando') return keep;

  if (cards.status !== 'ok') return keep;
  const pick = suggestedStart(cards.page, overview.track ?? null);
  if (!pick || pick.id === hero.courseId) return keep;
  const course = await getLearnCourse(pick.id);
  if (course.status !== 'ok') return keep;
  const next = startHero(course.course);
  if (!next) return keep;
  const { shelf: _serverShelf, ...rest } = overview;
  const shelf = swapShelf(overview.shelf, next.courseId, hero, overview.track ?? null);
  return {
    catalogue: false,
    overview: shelf ? { ...rest, hero: next, shelf } : { ...rest, hero: next },
  };
}

/**
 * The lesson Início resumes, from its course's outline (`GET /v1/courses/learn/courses/{id}`), which
 * carries the caller's own `lastPositionSeconds` and the video's length per lesson (D-430): the top
 * card's minute. A failed read, or a lesson the outline no longer has, draws the card without it.
 */
async function resumeLesson(
  courseId: string,
  lessonId: string,
): Promise<LearnOutlineLesson | null> {
  const read = await getLearnCourse(courseId);
  if (read.status !== 'ok') return null;
  for (const module of read.course.modules) {
    const lesson = module.lessons.find((item) => item.id === lessonId);
    if (lesson) return lesson;
  }
  return null;
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
        thumb: productThumb(choice.imageAssetId),
      })),
    };
  }
  return { kind: 'notForSale', text: locked.body };
}

/** A product's 40×50 thumb in a pop-up row: its image, else the brand gradient. */
function productThumb(imageAssetId: string | null): ReactNode {
  return imageAssetId ? (
    <MediaImage
      assetId={imageAssetId}
      widths={PURPOSE_WIDTHS.cover}
      alt=""
      sizes="40px"
      ratio=""
      className="h-full w-full"
    />
  ) : (
    <span className="block h-full w-full" style={{ backgroundImage: 'var(--brand-gradient)' }} />
  );
}

/**
 * The store's active products for the panel's promotion, newest first (the API's order): one page
 * for a member (the newest and the collage's images), every page up to `PROMO_PICK_PAGES` for the
 * administrator's picker, so any product can be picked. A failed first read is `null` (only the
 * product drops); a failed later one keeps what already arrived.
 */
async function promoProducts(pick: boolean): Promise<ProductCard[] | null> {
  const items: ProductCard[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < (pick ? PROMO_PICK_PAGES : 1); page += 1) {
    // Keyset pages, one after the other: each needs the cursor the previous one answered.
    const read: ProductPage | null = await getProducts({
      filter: 'all',
      limit: pick ? STORE_MAX_PAGE_SIZE : PROMO_PRODUCTS,
      ...(cursor ? { cursor } : {}),
    }).catch(() => null);
    if (!read) return page === 0 ? null : items;
    items.push(...read.items);
    cursor = read.nextCursor;
    if (!cursor) break;
  }
  return items.filter((item) => item.status === 'active');
}
