import type { ManagementTotals } from './courses';
import { adminScreenHref } from './member-area';

/**
 * 2026-10-23 — the "Gerenciar" hub's cards (the social-igoralves reference's management hub), one per
 * kind of content: where it leads, its icon, its words and its numbers line. Pure: the page reads the
 * totals (`getManagementTotals`) and the catalog; this only words them. A card whose read failed
 * keeps its title and sentence and loses only the numbers line (`meta: null`), never the door.
 */
export type ManageCardKey = 'courses' | 'tracks' | 'lives' | 'categories';

export interface ManageCardView {
  key: ManageCardKey;
  href: string;
  /** A kernel nav icon name (`iconFor`). */
  icon: string;
  title: string;
  /** The counts line ("9 cursos · 28 módulos · 111 aulas"); null when the read failed. */
  meta: string | null;
  body: string;
}

type Translate = (key: string, values?: Record<string, number>) => string;

/** The four cards, in the hub's order: Cursos, Trilhas, Lives, Categorias. */
export function manageCardsView(totals: ManagementTotals, t: Translate): ManageCardView[] {
  const card = (
    key: ManageCardKey,
    href: string,
    icon: string,
    meta: string | null,
  ): ManageCardView => ({
    key,
    href,
    icon,
    title: t(`courses.manage.cards.${key}.title`),
    meta,
    body: t(`courses.manage.cards.${key}.body`),
  });
  return [
    card(
      'courses',
      adminScreenHref('cursos'),
      'graduation-cap',
      totals.courses ? t('courses.manage.cards.courses.meta', totals.courses) : null,
    ),
    card(
      'tracks',
      adminScreenHref('trilhas'),
      'route',
      totals.tracks === null ? null : t('courses.manage.cards.tracks.meta', { n: totals.tracks }),
    ),
    card(
      'lives',
      adminScreenHref('lives'),
      'radio',
      totals.lives ? t('courses.manage.cards.lives.meta', totals.lives) : null,
    ),
    card(
      'categories',
      '/cursos/categorias',
      'tag',
      totals.categories === null
        ? null
        : t('courses.manage.cards.categories.meta', { n: totals.categories }),
    ),
  ];
}
