import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getCategories } from '@/lib/courses';
import { CategoryManager } from './CategoryManager';

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * `/cursos/categorias` (08.3-07, D-411, UI-D-400, COURSE-04): the per-tenant category manager,
 * reached from the Cursos tab's "Categorias" row (never from Configurações). A thin server shell:
 * the gate of `cursos/layout.tsx` repeated (Next renders layout and page concurrently, the 08.3-06
 * lesson), the one category read with the three-way refusal split, and the `CategoryManager`
 * island, which owns the `PageHeader` (its trailing "Nova categoria" opens the sheet, so it must be
 * a client control), the rows, the empty state and the sheet.
 *
 * An unreadable list is the `EmptyState` error card with the per-list sentence and the `outline`
 * "Tentar novamente" as a link to the same URL (UI-D-401): the admin never meets a blank column.
 */
export default async function CategoriesPage() {
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations('courses')]);
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }

  const result = await getCategories();
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();

  if (result.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col">
        <PageHeader
          title={t('categories.title')}
          backHref="/cursos"
          backLabel={t('categories.back')}
          className="md:static md:px-0"
        />
        <div className="px-4 pt-2">
          <EmptyState
            variant="card"
            icon={CircleAlert}
            data-testid="categories-error"
            title={t('errors.title')}
            body={t('errors.categories')}
            action={
              <a href="/cursos/categorias" className={LINK_OUTLINE}>
                {t('errors.retry')}
              </a>
            }
          />
        </div>
      </div>
    );
  }

  return <CategoryManager initialItems={result.categories} />;
}
