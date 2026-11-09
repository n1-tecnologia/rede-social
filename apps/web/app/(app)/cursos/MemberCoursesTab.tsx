import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { learnCatalogueQuerySchema } from '@rede-social/module-courses/contracts';
import { CourseCard } from '@rede-social/module-courses/ui';
import { ExclusiveBadge } from '@rede-social/module-store/ui';
import { buttonClasses } from '@rede-social/ui';
import { BookOpen, SearchX } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLearnCatalogue, getLearnCatalogueAll } from '@/lib/courses-learn';
import {
  catalogueCategoryHref,
  categoryFromParam,
  courseAccessById,
  courseCardView,
} from '@/lib/courses-member-view';
import { memberScreenHref } from '@/lib/member-area';
import { getCourseAccessList } from '@/lib/store';
import { CatalogueSearch } from './CatalogueSearch';
import { FilterMenu } from './FilterMenu';
import { CARD_GRID, MemberCoursesGrid } from './MemberCoursesGrid';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from './MemberEmptyCard';
import { ScreenHeader } from './ScreenHeader';

/** A `?categoria=` value worth asking the API about: a well-formed id (the contract's own check). */
function wellFormedCategory(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const parsed = learnCatalogueQuerySchema.shape.categoryId.safeParse(value);
  return parsed.success && parsed.data ? parsed.data : null;
}

/** A `?busca=` worth searching: one string, trimmed, at most 80 characters. */
export function searchQuery(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const query = value.trim().replace(/\s+/g, ' ').slice(0, 80);
  return query.length > 0 ? query : null;
}

/** Case, spaces at the ends and accents never matter in a search ("lábios" finds "Labios"). */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

const LINK_OUTLINE = buttonClasses({ variant: 'outline', size: 'md' });

/**
 * The member Cursos tab (08.5-06, D-420, D-421, UI-D-425, UI-D-426, COURSE-17), server-composed:
 *
 *  - `GET /v1/courses/learn/courses` and, only while the store is on, `GET /v1/store/course-access`
 *    run in parallel (planning decision 3: one access read per render, keyed by course id; a failed
 *    or store-off read is `null` → no tag, never a wrong one, UI-D-442);
 *  - `?categoria=` is whitelisted against the API's own category list (E02 error): an unknown id
 *    reads as "Todas", and the page is read again without the filter so the grid never shows an
 *    empty list for a category that does not exist;
 *  - the grid, keyed by the category so a switch starts from the server's page 1, receives FINISHED
 *    card views. The web never sorts (D-421: newest first, locked and open mixed).
 *
 * The first read's refusals split three ways (the hub's posture): `disabled` (the module switched off
 * between the bootstrap and this read) → the kernel not-found; `redirect` → a navigation OUTSIDE any
 * try/catch; anything else → the grid's first-load error card with its retry.
 *
 * **2026-10-26 (the academy reference, the user's "swap completo").** The screen draws its own
 * header, the reference's "Todos os cursos" panel: the eyebrow, the title and its line, and at the
 * right the search field and the "Filtros" menu (the categories, "Todas" first; a link each, as the
 * chips were). The search is FRONT ONLY (`?busca=`, a plain form): the whole catalogue the API
 * already serves (`getLearnCatalogueAll`) filtered by title and category name, accents and case
 * aside, inside the chosen category, and drawn as one grid with its count and a way out. The cards
 * are the reference's (`CourseCard`: the cover on top, "3/14 aulas" and the length under it).
 */
export async function MemberCoursesTab({
  categoria,
  busca,
  tenantName,
  preview,
}: {
  categoria: string | string[] | undefined;
  busca: string | string[] | undefined;
  tenantName: string;
  preview: boolean;
}) {
  const [t, bootstrap] = await Promise.all([getTranslations(), requireBootstrap()]);
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const asked = wellFormedCategory(categoria);
  const query = searchQuery(busca);

  const [first, access] = await Promise.all([
    getLearnCatalogue(asked ? { categoryId: asked } : {}),
    storeOn ? getCourseAccessList() : Promise.resolve(null),
  ]);
  let result = first;
  // An id the category list does not hold (unknown, foreign, emptied) reads as "Todas" (E02 error).
  if (
    result.status === 'ok' &&
    asked &&
    categoryFromParam(asked, result.page.categories) === null
  ) {
    result = await getLearnCatalogue({});
  }
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();

  const page = result.status === 'ok' ? result.page : null;
  const categories = page?.categories ?? [];
  const selected = page ? categoryFromParam(asked ?? undefined, categories) : null;
  const byId = courseAccessById(access);
  const items = (page?.items ?? []).map((card) =>
    courseCardView(card, byId?.get(card.id), t, { preview }),
  );

  // The search: the whole catalogue, filtered here (no new API).
  let found: ReturnType<typeof courseCardView>[] | null = null;
  if (query && page) {
    const everything = await getLearnCatalogueAll();
    if (everything.status === 'redirect') redirect(everything.path);
    const needle = fold(query);
    found =
      everything.status === 'ok'
        ? everything.page
            .filter((card) => selected === null || card.category?.id === selected)
            .filter(
              (card) =>
                fold(card.title).includes(needle) ||
                (card.category ? fold(card.category.name).includes(needle) : false),
            )
            .map((card) => courseCardView(card, byId?.get(card.id), t, { preview }))
        : [];
  }

  const filterOptions = [
    {
      key: 'all',
      label: t('courses.member.catalogue.categories.all'),
      href: catalogueCategoryHref(null, preview),
      active: selected === null,
    },
    ...categories.map((category) => ({
      key: category.id,
      label: category.name,
      href: catalogueCategoryHref(category.id, preview),
      active: selected === category.id,
    })),
  ];
  const current = filterOptions.find((option) => option.active)?.label ?? '';
  const screenPath = memberScreenHref('cursos', {}, false);

  return (
    <section data-testid="courses-member-tab" className="flex flex-col">
      <ScreenHeader
        testId="courses-member-header"
        eyebrow={{ icon: BookOpen, text: t('courses.member.screens.courses.eyebrow') }}
        title={t('courses.member.catalogue.title')}
        subtitle={t('courses.member.screens.courses.meta', { tenant: tenantName })}
        actionWide
        action={
          <>
            <CatalogueSearch
              action={screenPath}
              query={query}
              preview={preview}
              label={t('courses.member.search.label')}
              placeholder={t('courses.member.search.placeholder')}
              submitLabel={t('courses.member.search.submit')}
              testId="courses-member-search"
              className="min-w-0 flex-1"
            />
            {categories.length > 0 ? (
              <FilterMenu
                label={t('courses.member.catalogue.categories.label')}
                buttonLabel={t('courses.member.filters.buttonAria', { current })}
                text={t('courses.member.filters.button')}
                options={filterOptions}
                testId="courses-member-categories"
              />
            ) : null}
          </>
        }
      />

      {found !== null && query ? (
        <div data-testid="courses-member-search-results" className="flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-1">
            <p
              data-testid="courses-member-search-count"
              className="text-sm font-medium text-text-secondary"
            >
              {t('courses.member.search.results', { n: found.length, q: query })}
            </p>
            <a
              href={catalogueCategoryHref(selected, preview)}
              className="inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {t('courses.member.search.clear')}
            </a>
          </div>
          {found.length > 0 ? (
            <ul
              aria-label={t('courses.member.search.results', { n: found.length, q: query })}
              data-testid="courses-member-grid"
              className={`${CARD_GRID} pt-3 pb-6`}
            >
              {found.map((item, index) => (
                <li key={item.id} data-course-card={item.id} className="min-w-0">
                  <CourseCard
                    href={item.href}
                    ariaLabel={item.ariaLabel}
                    title={item.title}
                    categoryLine={item.categoryLine}
                    meta={item.meta}
                    duration={item.duration}
                    coverAssetId={item.coverAssetId}
                    coverWidths={PURPOSE_WIDTHS.cover}
                    tags={
                      item.tags.exclusive ? (
                        <ExclusiveBadge
                          label={t('courses.member.tags.exclusiveCourse')}
                          size="compact"
                        />
                      ) : undefined
                    }
                    progress={item.progress}
                    locked={item.tags.exclusive}
                    done={item.progress !== null && item.progress.percent >= 100}
                    eager={index < 4}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 pt-3 pb-6">
              <MemberEmptyCard
                icon={SearchX}
                data-testid="courses-member-search-empty"
                className={MEMBER_EMPTY_WIDE}
                title={t('courses.member.search.empty.title')}
                body={t('courses.member.search.empty.body')}
                action={
                  <a href={catalogueCategoryHref(null, preview)} className={LINK_OUTLINE}>
                    {t('courses.member.catalogue.categoryEmpty.cta')}
                  </a>
                }
              />
            </div>
          )}
        </div>
      ) : (
        <MemberCoursesGrid
          key={selected ?? 'all'}
          categoryId={selected}
          tenantName={tenantName}
          preview={preview}
          initialItems={items}
          initialCursor={page?.nextCursor ?? null}
          initialError={page === null}
        />
      )}
    </section>
  );
}
