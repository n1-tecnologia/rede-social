import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { EmptyState } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getCategories } from '@/lib/courses';
import { OUTLINE_LINK, WIDE_EMPTY } from '../admin-styles';
import { ManageBackLink } from '../ManageBackLink';
import { ScreenHeader } from '../ScreenHeader';
import { CategoryManager } from './CategoryManager';

/**
 * `/cursos/categorias` (08.3-07, D-411, UI-D-400, COURSE-04): the per-tenant category manager,
 * reached from the "Categorias" card of "Gerenciar" (2026-10-23; never from Configurações). A thin
 * server shell: the gate of `cursos/layout.tsx` repeated (Next renders layout and page
 * concurrently, the 08.3-06 lesson), the one category read with the three-way refusal split, and
 * the `CategoryManager` island, which owns the header (its "Nova categoria" opens the sheet, so it
 * must be a client control), the rows, the empty state and the sheet.
 *
 * An unreadable list is the `EmptyState` error card with the per-list sentence and the `outline`
 * "Tentar novamente" as a link to the same URL (UI-D-401): the admin never meets a blank column.
 * 2026-10-22: the link takes the shared `OUTLINE_LINK` (`buttonClasses`), the same geometry.
 * 2026-10-23: under the management lists' header ("‹ Gerenciar" and the h1), without the create; a
 * wide page like the manager's (`data-shell-wide`), the error card at a readable width.
 */
export default async function CategoriesPage() {
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations('courses')]);
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }
  const tenantName = bootstrap.tenant.displayName;

  const result = await getCategories();
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();

  if (result.status === 'error') {
    return (
      <div data-shell-wide className="mx-auto flex w-full flex-col">
        <ScreenHeader
          title={t('categories.title')}
          subtitle={t('categories.subtitle', { tenant: tenantName })}
          back={<ManageBackLink />}
        />
        <div className={`px-4 pt-2 ${WIDE_EMPTY}`}>
          <EmptyState
            variant="card"
            icon={CircleAlert}
            data-testid="categories-error"
            title={t('errors.title')}
            body={t('errors.categories')}
            action={
              <a href="/cursos/categorias" className={OUTLINE_LINK}>
                {t('errors.retry')}
              </a>
            }
          />
        </div>
      </div>
    );
  }

  return <CategoryManager initialItems={result.categories} tenantName={tenantName} />;
}
