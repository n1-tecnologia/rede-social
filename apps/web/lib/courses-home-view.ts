import type { Bootstrap } from '@rede-social/contracts';
import type {
  LearnCategoryTile,
  LearnCourseCard,
  LearnMyProgress,
  LearnOutlineLesson,
  LearnOverviewTrack,
  LearnTrack,
} from '@rede-social/module-courses/contracts';
import {
  catalogueCategoryHref,
  coursePercent,
  type HomeHeroView,
  memberCourseHref,
  streakBadgeView,
} from '@/lib/courses-member-view';
import { type CoursesTranslator, formatLessonDuration } from '@/lib/courses-view';
import { memberScreenHref } from '@/lib/member-area';

/**
 * The member Início of 2026-10-26 (the academy reference's home, the user's "tela de início
 * repensada, com vários gatilhos"): the view builders of its new blocks. Pure, like
 * `courses-member-view.ts`: no fetch and no clock (the hour comes from the overview's `serverNow`,
 * read in the TENANT's zone), every word built here from the reads Início already makes (the
 * overview, the member's progress, the tracks and the catalogue). Nothing here decides a lock or
 * counts a lesson: the numbers are the server's.
 */

const NUMBER = new Intl.NumberFormat('pt-BR');

/* ── The greeting ─────────────────────────────────────────────────────────────────────────── */

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening';

/**
 * The part of the day at `serverNow` in the tenant's zone (never the browser's): "Bom dia" from
 * 05:00, "Boa tarde" from 12:00, "Boa noite" from 18:00 until 04:59.
 */
export function greetingPeriod(serverNow: string, timeZone: string): GreetingPeriod {
  const at = new Date(serverNow);
  if (Number.isNaN(at.getTime())) return 'evening';
  const hourText = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(at)
    .find((part) => part.type === 'hour')?.value;
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return 'evening';
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** The longest first name the greeting prints, in characters (a very long one is cut, not wrapped). */
const FIRST_NAME_MAX = 24;

/**
 * The first word of the member's name for "Boa tarde, Thiago!": the profile's display name, else
 * the account name; null when neither has a word or the word looks like an e-mail address.
 */
export function firstName(...names: ReadonlyArray<string | null | undefined>): string | null {
  for (const name of names) {
    const word = name?.trim().split(/\s+/)[0] ?? '';
    if (word === '' || word.includes('@')) continue;
    return Array.from(word).slice(0, FIRST_NAME_MAX).join('');
  }
  return null;
}

export interface HomeGreetingView {
  /** "Boa tarde, Thiago!" (the page's h1). */
  title: string;
  /** "O que você quer aprender agora?" */
  ask: string;
}

export function homeGreetingView(
  bootstrap: Pick<Bootstrap, 'user' | 'membership' | 'tenant'>,
  serverNow: string,
  t: CoursesTranslator,
): HomeGreetingView {
  const name = firstName(bootstrap.membership.profile.displayName, bootstrap.user.name);
  return {
    title: t('courses.member.home.greet', {
      period: greetingPeriod(serverNow, bootstrap.tenant.timezone),
      hasName: String(name !== null),
      name: name ?? '',
    }),
    ask: t('courses.member.home.ask'),
  };
}

export interface PopularCategoryView {
  id: string;
  name: string;
  /** The catalogue already filtered (`/area-membros/cursos?categoria={id}`). */
  href: string;
}

/** How many category chips "Populares:" shows. */
const POPULAR_MAX = 5;

/**
 * "Populares:" under the search: the overview's categories with the most published courses, at
 * most five (a tie keeps the server's alphabetical order). Each lands on the catalogue filtered by
 * the SERVER's category id.
 */
export function popularCategories(
  categories: readonly LearnCategoryTile[] | undefined,
  preview = false,
): PopularCategoryView[] {
  if (!categories) return [];
  return categories
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => b.tile.count - a.tile.count || a.index - b.index)
    .slice(0, POPULAR_MAX)
    .map(({ tile }) => ({
      id: tile.id,
      name: tile.name,
      href: catalogueCategoryHref(tile.id, preview),
    }));
}

/* ── "Cursos": quick access ───────────────────────────────────────────────────────────────── */

/**
 * The quick-access row's courses: the ones the member is taking first, then the ones not started,
 * then the completed ones, each group in the catalogue's own order; at most `limit`. The host
 * passes only the courses the member can open (the SERVER's `locked`): the row is "seus cursos".
 */
export function quickCourses(cards: readonly LearnCourseCard[], limit: number): LearnCourseCard[] {
  const rank = (card: LearnCourseCard): number => {
    if (card.lessonCount > 0 && card.completedCount >= card.lessonCount) return 2;
    return card.completedCount > 0 ? 0 : 1;
  };
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => rank(a.card) - rank(b.card) || a.index - b.index)
    .slice(0, limit)
    .map(({ card }) => card);
}

export interface QuickCourseView {
  id: string;
  /** `/cursos/{id}`, `ver=aluno` in preview. */
  href: string;
  title: string;
  coverAssetId: string | null;
  /** The 2px line's share, `floor(done × 100 / total)` (0 when nothing is done). */
  percent: number;
  /** "{percent}% concluído". */
  percentLabel: string;
  /** "{done}/{N} aulas", for a screen reader. */
  srLine: string;
  /** "{title}, {N} aulas", plus ", {percent}% concluído" once a lesson is done. */
  ariaLabel: string;
}

/** One quick-access card (the reference's `home-course-card`): the server's numbers in words. */
export function quickCourseView(
  card: LearnCourseCard,
  t: CoursesTranslator,
  preview = false,
): QuickCourseView {
  const percent = coursePercent(card.completedCount, card.lessonCount);
  return {
    id: card.id,
    href: memberCourseHref(card.id, preview),
    title: card.title,
    coverAssetId: card.coverAssetId,
    percent,
    percentLabel: t('courses.member.progress.aria', { percent }),
    srLine: t('courses.member.card.lessonsDone', {
      done: Math.min(card.completedCount, card.lessonCount),
      N: card.lessonCount,
    }),
    ariaLabel: t('courses.member.card.aria', {
      course: card.title,
      N: card.lessonCount,
      exclusive: 'false',
      progress: String(card.completedCount >= 1),
      percent,
    }),
  };
}

/* ── The panel's promotion (the reference's "Você foi convidado") ──────────────────────────── */

export interface HomePromoView {
  /** `product`: a product of the store (the newest, or the admin's pick); `catalogue`: the courses. */
  kind: 'product' | 'catalogue';
  /** The collage's image ids (product images first, then the course covers), never empty words. */
  images: string[];
  eyebrow: string;
  title: string;
  body: string;
  chips: string[];
  cta: { href: string; label: string };
}

/** The collage's distinct images, at most. */
const PROMO_IMAGES = 12;

/**
 * The promotion at the panel's right: the store's newest active product (its name, its price, a
 * link to its page; the administrator can pick another one, `lib/home-promo.ts`), else the
 * catalogue (how many courses and tracks, a link to Cursos). The collage takes the products'
 * images first, then the course covers, each once.
 */
export function homePromoView({
  product,
  productImages,
  courseCovers,
  courseCount,
  trackCount,
  tenant,
  t,
  preview = false,
}: {
  product: { id: string; name: string; price: string } | null;
  productImages: readonly (string | null)[];
  courseCovers: readonly (string | null)[];
  courseCount: number;
  trackCount: number;
  tenant: string;
  t: CoursesTranslator;
  preview?: boolean;
}): HomePromoView {
  const images = [...new Set([...productImages, ...courseCovers])]
    .filter((id): id is string => typeof id === 'string' && id !== '')
    .slice(0, PROMO_IMAGES);
  if (product) {
    return {
      kind: 'product',
      images,
      eyebrow: t('courses.member.home.promo.product.eyebrow'),
      title: product.name,
      body: t('courses.member.home.promo.product.body', { tenant }),
      chips: [product.price],
      cta: {
        href: `/loja/${encodeURIComponent(product.id)}`,
        label: t('courses.member.home.promo.product.cta'),
      },
    };
  }
  const chips = [t('courses.member.home.promo.catalogue.courses', { n: courseCount })];
  if (trackCount > 0)
    chips.push(t('courses.member.home.promo.catalogue.tracks', { n: trackCount }));
  return {
    kind: 'catalogue',
    images,
    eyebrow: t('courses.member.home.promo.catalogue.eyebrow', { tenant }),
    title: t('courses.member.home.promo.catalogue.title'),
    body: t('courses.member.home.promo.catalogue.body'),
    chips,
    cta: {
      href: catalogueCategoryHref(null, preview),
      label: t('courses.member.home.promo.catalogue.cta'),
    },
  };
}

/* ── "Continue de onde parou" at the top ──────────────────────────────────────────────────── */

export interface HomeResumeSpotView {
  /** "Continue de onde parou". */
  heading: string;
  /** "{course} · Módulo 01 · Aula 02"; null when the hero names no module or lesson number. */
  eyebrow: string | null;
  /** The lesson's title. */
  title: string;
  coverAssetId: string | null;
  /** "Continuar aula", to the lesson's player, which starts at the stored second (D-430). */
  cta: { label: string; href: string };
  /** Where the member stopped, for the bar; null without a ready video (no length to measure). */
  watched: { percent: number; line: string; label: string } | null;
}

/**
 * The card at the top of Início while the member is in the middle of a course (2026-10-27, the
 * product owner: "um card de continuar de onde parou, que mostra a aula que o usuário estava
 * assistindo já com a minutagem que ele parou em forma de barra de progresso"). The lesson, the
 * place and the link are the SERVER's `retomando` hero (`homeHeroView`); the minute is the caller's
 * own `lastPositionSeconds` from the course's outline, the same share the lesson thumbs draw
 * (`lastPositionSeconds / durationSeconds`, floored). A lesson not started yet (the server resumes
 * at the next one once the touched lesson is done) reads "Próxima aula" over an empty bar.
 */
export function homeResumeSpotView(
  hero: HomeHeroView,
  lesson: Pick<LearnOutlineLesson, 'lastPositionSeconds' | 'durationSeconds'> | null,
  t: CoursesTranslator,
): HomeResumeSpotView {
  const length = lesson?.durationSeconds ?? 0;
  let watched: HomeResumeSpotView['watched'] = null;
  if (lesson && length > 0) {
    const at = Math.min(Math.max(0, lesson.lastPositionSeconds), length);
    const percent = Math.min(100, Math.floor((at * 100) / length));
    watched = {
      percent,
      line:
        at > 0
          ? t('courses.member.home.resume.stoppedAt', {
              at: formatLessonDuration(at),
              total: formatLessonDuration(length),
            })
          : t('courses.member.home.resume.next', { total: formatLessonDuration(length) }),
      label: t('courses.member.home.resume.watched', { percent }),
    };
  }
  return {
    heading: hero.sectionTitle,
    eyebrow: hero.eyebrow,
    title: hero.title,
    coverAssetId: hero.coverAssetId,
    cta: { label: hero.cta.label, href: hero.cta.href },
    watched,
  };
}

/* ── The numbers strip ────────────────────────────────────────────────────────────────────── */

export interface HomeStatsView {
  progress: { value: string; percent: number; barLabel: string; line: string };
  lessons: { value: string; line: string };
  /** Display only (D-443, PR-1): no nudge is built on it. */
  streak: { value: string; line: string; ariaLabel: string; active: boolean };
  courses: { value: string; line: string; href: string };
}

/**
 * The strip of numbers (the reference's "Progresso geral · Aulas · …"), every number the server's
 * (`GET /v1/courses/learn/progress`): the overall share with its bar and "{done} de {total} aulas",
 * the lessons completed, the study streak and the courses completed (a link to Progresso).
 */
export function homeStatsView(
  progress: LearnMyProgress,
  t: CoursesTranslator,
  preview = false,
): HomeStatsView {
  const percent = Math.min(100, Math.max(0, progress.percent));
  const streak = streakBadgeView(progress.streakDays, t);
  const days = streak.active ? Math.trunc(progress.streakDays) : 0;
  return {
    progress: {
      value: `${percent}%`,
      percent,
      barLabel: t('courses.member.progress.aria', { percent }),
      line: t('courses.member.home.stats.progressLine', {
        done: progress.lessonsDone,
        total: progress.lessonsTotal,
      }),
    },
    lessons: {
      value: NUMBER.format(progress.lessonsDone),
      line: t('courses.member.home.stats.lessonsLine', { n: progress.lessonsDone }),
    },
    streak: {
      value: NUMBER.format(days),
      line: t('courses.member.home.stats.streakLine', { n: days }),
      ariaLabel: streak.ariaLabel,
      active: streak.active,
    },
    courses: {
      value: NUMBER.format(progress.coursesDone),
      line: t('courses.member.home.stats.coursesLine'),
      href: memberScreenHref('progresso', {}, preview),
    },
  };
}

/* ── The tracks row ───────────────────────────────────────────────────────────────────────── */

export interface HomeTrackCardView {
  id: string;
  /** The track's page (`/area-membros/trilhas?trilha={id}`). */
  href: string;
  title: string;
  coverAssetId: string | null;
  /** "Sua trilha · 3 cursos", "Trilha sugerida · 3 cursos" or "Trilha · 3 cursos". */
  eyebrow: string;
  /** The card's chip ("Acesse"). */
  cta: string;
  /** Where the member stands, in words (the card shows it on hover). */
  line: string;
  /** The share once started; null keeps the band empty. */
  percent: number | null;
  ariaLabel: string;
  /** The overview's own track (the one Início used to show alone). */
  featured: boolean;
  /**
   * 2026-10-27 — the manager's subtitle, under the title ("o subtítulo deve aparecer aqui em baixo
   * nesse card"), and the audience ("Para quem é"), a small tag beside "Acesse". `null` when the
   * track has none or the member read does not carry it (the overview's track never does).
   */
  subtitle: string | null;
  audience: string | null;
}

/** The fields a card needs, common to the tracks read and the overview's track. */
interface TrackCardInput {
  id: string;
  title: string;
  coverAssetId: string | null;
  percent: number;
  total: number;
  coursesDone: number;
  currentCourseTitle: string | null;
  mine: boolean;
  suggested: boolean;
  subtitle?: string;
  audience?: string;
}

/** A manager's optional words, trimmed; `null` when there is nothing to show. */
function trackWords(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  return text ? text : null;
}

function fromTrack(track: LearnTrack): TrackCardInput {
  const current = track.courses[Math.min(track.currentIndex, track.courses.length) - 1];
  return {
    id: track.id,
    title: track.title,
    coverAssetId: track.coverAssetId,
    percent: track.percent,
    total: track.total,
    coursesDone: track.coursesDone,
    currentCourseTitle: current?.title ?? null,
    mine: track.mine,
    suggested: track.suggested,
    subtitle: track.subtitle,
    audience: track.audience,
  };
}

function fromOverviewTrack(track: LearnOverviewTrack): TrackCardInput {
  return {
    id: track.id,
    title: track.title,
    coverAssetId: track.coverAssetId,
    percent: track.percent,
    total: track.total,
    coursesDone: track.coursesDone,
    currentCourseTitle: track.currentCourseTitle,
    mine: !track.suggested,
    suggested: track.suggested,
  };
}

function trackCardView(
  input: TrackCardInput,
  t: CoursesTranslator,
  preview: boolean,
): HomeTrackCardView {
  const done = input.coursesDone >= input.total;
  const started = input.percent > 0 || input.coursesDone > 0;
  const course = input.currentCourseTitle?.trim() ? input.currentCourseTitle : null;
  let line: string;
  if (done) {
    line = t('courses.member.home.track.done', { total: input.total });
  } else if (input.suggested && course) {
    line = t('courses.member.home.track.suggestedLine', { total: input.total, course });
  } else if (started && course) {
    line = t('courses.member.home.track.progress', { percent: input.percent, course });
  } else if (started) {
    line = t('courses.member.tracks.others.progress', { percent: input.percent });
  } else {
    line = t('courses.member.tracks.others.notStarted');
  }
  const percent = started ? Math.min(100, Math.max(0, input.percent)) : null;
  return {
    id: input.id,
    href: memberScreenHref('trilhas', { trilha: input.id }, preview),
    title: input.title,
    coverAssetId: input.coverAssetId,
    eyebrow: t('courses.member.home.trackEyebrow', {
      kind: input.mine ? 'mine' : input.suggested ? 'suggested' : 'other',
      n: input.total,
    }),
    cta: t('courses.member.home.access'),
    line,
    percent,
    ariaLabel: t('courses.member.home.shelf.aria', { course: input.title, state: line }),
    featured: input.mine || input.suggested,
    subtitle: trackWords(input.subtitle),
    audience: trackWords(input.audience),
  };
}

/** How many tracks Início's row shows: three large cards and a stack of two (the reference's). */
const TRACKS_MAX = 5;

/**
 * Every track as a card (Trilhas' list, 2026-10-26): the member's own track (started or suggested)
 * first, then the others in the admin's order.
 */
export function trackCardsView(
  tracks: readonly LearnTrack[],
  t: CoursesTranslator,
  preview = false,
): HomeTrackCardView[] {
  return tracks
    .map((track, index) => ({ track, index }))
    .sort(
      (a, b) =>
        Number(b.track.mine || b.track.suggested) - Number(a.track.mine || a.track.suggested) ||
        a.index - b.index,
    )
    .map(({ track }) => trackCardView(fromTrack(track), t, preview));
}

/**
 * The tracks row: the member's own track (started or suggested) first, then the others in the
 * admin's order, at most three. Without the tracks read, the overview's track alone (as before).
 */
export function homeTrackCards(
  tracks: readonly LearnTrack[] | null,
  overviewTrack: LearnOverviewTrack | undefined,
  t: CoursesTranslator,
  preview = false,
): { cards: HomeTrackCardView[]; total: number } {
  if (!tracks) {
    return overviewTrack
      ? { cards: [trackCardView(fromOverviewTrack(overviewTrack), t, preview)], total: 1 }
      : { cards: [], total: 0 };
  }
  return { cards: trackCardsView(tracks, t, preview).slice(0, TRACKS_MAX), total: tracks.length };
}

/* ── More of the school (the reference's bento) ───────────────────────────────────────────── */

export type HomeAreaKey = 'lives' | 'communities' | 'events' | 'reels' | 'store';

export interface HomeAreaView {
  key: HomeAreaKey;
  href: string;
  /** The menu's own label (the tenant may rename a module). */
  title: string;
  eyebrow: string;
  body: string;
  /** A kernel nav icon name (`iconFor`). */
  icon: string;
  cta: string;
}

const MODULE_AREAS = ['communities', 'events', 'reels', 'store'] as const;

/**
 * The school's other areas the member can open, as the menu names and orders them: the courses
 * area's Lives, then Comunidades, Eventos, Reels and Loja when the tenant has them on. Only links,
 * built from the bootstrap's navigation (no read of their contents).
 */
export function homeAreasView(
  modules: Bootstrap['modules'],
  t: CoursesTranslator,
  preview = false,
): HomeAreaView[] {
  const cta = t('courses.member.home.areas.cta');
  const areas: HomeAreaView[] = [
    {
      key: 'lives',
      href: memberScreenHref('lives', {}, preview),
      title: t('courses.member.area.screens.lives'),
      eyebrow: t('courses.member.home.areas.lives.eyebrow'),
      body: t('courses.member.home.areas.lives.body'),
      icon: 'radio',
      cta,
    },
  ];
  for (const key of MODULE_AREAS) {
    const nav = modules.find((module) => module.key === key)?.nav;
    if (!nav?.href || !nav.label.trim()) continue;
    areas.push({
      key,
      href: nav.href,
      title: nav.label,
      eyebrow: t(`courses.member.home.areas.${key}.eyebrow`),
      body: t(`courses.member.home.areas.${key}.body`),
      icon: nav.icon,
      cta,
    });
  }
  return areas;
}
