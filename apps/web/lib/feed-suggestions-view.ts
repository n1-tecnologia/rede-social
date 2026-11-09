import type { CommunitySummary } from '@rede-social/module-communities/contracts';
import type { LearnCourseCard } from '@rede-social/module-courses/contracts';
import { coursePercent, memberCourseHref } from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';
import { memberScreenHref } from '@/lib/member-area';

/**
 * The feed's suggestions column (2026-10-26, the product owner: "ao lado direito do feed uma área
 * destinada a sugestões com cards de cursos e comunidades para o user acessar rápido", laid out as
 * the member Início's "Mais de" bento and placed where Instagram puts its suggestions). Pure: no
 * fetch and no clock. It only orders and words what two reads the app already makes answered (the
 * course catalogue's first page and the communities' first page); nothing is recommended by a rule
 * of its own, and nothing here decides a lock or counts a lesson.
 */

export type FeedSuggestionKind = 'course' | 'community';

export interface FeedSuggestionTile {
  /** `{kind}:{id}`, unique across the two kinds. */
  key: string;
  kind: FeedSuggestionKind;
  /** A course's member page (`ver=aluno` for a manager), or the community's page. */
  href: string;
  title: string;
  /** "Curso", "Curso · Em andamento" or "Comunidade". */
  eyebrow: string;
  /** "3 de 10 aulas", "10 aulas" or "12 publicações". */
  line: string;
  coverAssetId: string | null;
  /** A community's cover ladder; `null` for a course, whose cover takes the host's cover widths. */
  coverWidths: readonly number[] | null;
  /** A course in progress: the member's share (0–100). Otherwise `null`. */
  percent: number | null;
  /** "Continuar" for a course in progress, else "Acessar". */
  cta: string;
}

export interface FeedSuggestionsView {
  title: string;
  /** At most five: the first is the large tile. */
  tiles: FeedSuggestionTile[];
  /** The way to every course and every community, for the modules the tenant has on. */
  links: { href: string; label: string }[];
}

/** One large tile and four small ones, the bento of the member Início. */
export const FEED_SUGGESTIONS_MAX = 5;

/**
 * The courses worth suggesting: open ones the member has not finished, the ones in progress first,
 * then the ones not started, each group in the catalogue's order.
 */
export function suggestedCourses(
  cards: readonly LearnCourseCard[],
  limit: number,
): LearnCourseCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.locked && !finished(card))
    .sort(
      (a, b) =>
        Number(b.card.completedCount > 0) - Number(a.card.completedCount > 0) || a.index - b.index,
    )
    .slice(0, limit)
    .map(({ card }) => card);
}

function finished(card: LearnCourseCard): boolean {
  return card.lessonCount > 0 && card.completedCount >= card.lessonCount;
}

function courseTile(
  card: LearnCourseCard,
  t: CoursesTranslator,
  preview: boolean,
): FeedSuggestionTile {
  const going = card.completedCount > 0 && !finished(card);
  return {
    key: `course:${card.id}`,
    kind: 'course',
    href: memberCourseHref(card.id, preview),
    title: card.title,
    eyebrow: t(going ? 'app.home.suggestions.courseInProgress' : 'app.home.suggestions.course'),
    line: going
      ? t('app.home.suggestions.lessonsDone', {
          done: card.completedCount,
          total: card.lessonCount,
        })
      : t('app.home.suggestions.lessons', { total: card.lessonCount }),
    coverAssetId: card.coverAssetId,
    coverWidths: null,
    percent: going ? coursePercent(card.completedCount, card.lessonCount) : null,
    cta: t(going ? 'app.home.suggestions.continue' : 'app.home.suggestions.open'),
  };
}

function communityTile(community: CommunitySummary, t: CoursesTranslator): FeedSuggestionTile {
  return {
    key: `community:${community.id}`,
    kind: 'community',
    href: `/comunidades/${encodeURIComponent(community.id)}`,
    title: community.name,
    eyebrow: t('app.home.suggestions.community'),
    line: t('app.home.suggestions.posts', { count: community.postCount }),
    coverAssetId: community.coverAssetId,
    coverWidths: community.coverVariantWidths,
    percent: null,
    cta: t('app.home.suggestions.open'),
  };
}

/**
 * The column, or `null` when there is nothing to suggest. The large tile is the first course (a
 * community when there is no course), then the two kinds alternate, a community first, until five;
 * when one kind runs out the other fills the rest. `courses` and `communities` are `null` when their
 * module is off or their read failed.
 */
export function feedSuggestionsView({
  courses,
  communities,
  preview,
  t,
}: {
  courses: readonly LearnCourseCard[] | null;
  communities: readonly CommunitySummary[] | null;
  /** A courses manager: their course links open the member's page (`ver=aluno`). */
  preview: boolean;
  t: CoursesTranslator;
}): FeedSuggestionsView | null {
  const courseTiles = suggestedCourses(courses ?? [], FEED_SUGGESTIONS_MAX).map((card) =>
    courseTile(card, t, preview),
  );
  const communityTiles = (communities ?? [])
    .filter((community) => community.status === 'active')
    .slice(0, FEED_SUGGESTIONS_MAX)
    .map((community) => communityTile(community, t));

  const first = courseTiles.shift() ?? communityTiles.shift();
  if (!first) return null;
  const tiles = [first];
  let communityTurn = true;
  while (tiles.length < FEED_SUGGESTIONS_MAX) {
    const next = communityTurn
      ? (communityTiles.shift() ?? courseTiles.shift())
      : (courseTiles.shift() ?? communityTiles.shift());
    if (!next) break;
    tiles.push(next);
    communityTurn = !communityTurn;
  }

  const links: FeedSuggestionsView['links'] = [];
  if (courses !== null) {
    links.push({
      href: memberScreenHref('cursos', {}, preview),
      label: t('app.home.suggestions.allCourses'),
    });
  }
  if (communities !== null) {
    links.push({ href: '/comunidades', label: t('app.home.suggestions.allCommunities') });
  }
  return { title: t('app.home.suggestions.title'), tiles, links };
}
