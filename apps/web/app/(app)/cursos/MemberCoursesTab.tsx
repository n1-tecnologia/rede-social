import { learnCatalogueQuerySchema } from '@rede-social/module-courses/contracts';
import { Chip } from '@rede-social/ui';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLearnCatalogue } from '@/lib/courses-learn';
import {
  catalogueCategoryHref,
  categoryFromParam,
  courseAccessById,
  courseCardView,
} from '@/lib/courses-member-view';
import { getCourseAccessList } from '@/lib/store';
import { MemberCoursesGrid } from './MemberCoursesGrid';

/** A `?categoria=` value worth asking the API about: a well-formed id (the contract's own check). */
function wellFormedCategory(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const parsed = learnCatalogueQuerySchema.shape.categoryId.safeParse(value);
  return parsed.success && parsed.data ? parsed.data : null;
}

/**
 * The member Cursos tab (08.5-06, D-420, D-421, UI-D-425, UI-D-426, COURSE-17), server-composed:
 *
 *  - `GET /v1/courses/learn/courses` and, only while the store is on, `GET /v1/store/course-access`
 *    run in parallel (planning decision 3: one access read per render, keyed by course id; a failed
 *    or store-off read is `null` → no tag, never a wrong one, UI-D-442);
 *  - `?categoria=` is whitelisted against the API's own chip list (E02 error): an unknown id reads
 *    as "Todas" — the page is read again without the filter so the grid never shows an empty list
 *    for a category that does not exist;
 *  - the chip nav (`Chip` links, "Todas" first, then the API's order) renders ONLY when at least one
 *    category holds a published course; one non-wrapping row that scrolls with the scrollbar hidden
 *    and `-mx-4 px-4` scroll padding (E02 overflow);
 *  - the grid, keyed by the category so a chip switch starts from the server's page 1, receives
 *    FINISHED card views. The web never sorts (D-421: newest first, locked and open mixed).
 *
 * The first read's refusals split three ways (the hub's posture): `disabled` (the module switched off
 * between the bootstrap and this read) → the kernel not-found; `redirect` → a navigation OUTSIDE any
 * try/catch; anything else → the grid's first-load error card with its retry.
 */
export async function MemberCoursesTab({
  categoria,
  tenantName,
  preview,
}: {
  categoria: string | string[] | undefined;
  tenantName: string;
  preview: boolean;
}) {
  const [t, bootstrap] = await Promise.all([getTranslations(), requireBootstrap()]);
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const asked = wellFormedCategory(categoria);

  const [first, access] = await Promise.all([
    getLearnCatalogue(asked ? { categoryId: asked } : {}),
    storeOn ? getCourseAccessList() : Promise.resolve(null),
  ]);
  let result = first;
  // An id the chip list does not hold (unknown, foreign, emptied) reads as "Todas" (E02 error).
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

  return (
    <section data-testid="courses-member-tab" className="flex flex-col">
      {categories.length > 0 ? (
        <div className="px-4">
          {/* Never wraps: `shrink-0` chips in one row that scrolls at 320px (E02 overflow). */}
          <nav
            aria-label={t('courses.member.catalogue.categories.label')}
            data-testid="courses-member-categories"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none"
          >
            <Chip
              href={catalogueCategoryHref(null, preview)}
              active={selected === null}
              className="shrink-0"
            >
              {t('courses.member.catalogue.categories.all')}
            </Chip>
            {categories.map((category) => (
              <Chip
                key={category.id}
                href={catalogueCategoryHref(category.id, preview)}
                active={selected === category.id}
                className="shrink-0 whitespace-nowrap"
              >
                {category.name}
              </Chip>
            ))}
          </nav>
        </div>
      ) : null}

      <MemberCoursesGrid
        key={selected ?? 'all'}
        categoryId={selected}
        tenantName={tenantName}
        preview={preview}
        initialItems={items}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
      />
    </section>
  );
}
