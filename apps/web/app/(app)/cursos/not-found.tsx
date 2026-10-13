import { EmptyState } from '@rede-social/ui';
import { GraduationCap } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * "Curso indisponível" (UI-D-401, the `courses.notFound.*` card): the ONE screen every miss INSIDE
 * the segment lands on — a course, track or live page (plans 08, 10, 11) whose id is unknown or
 * another tenant's. The API answers one bare 404 for both (D-23), and this card takes no props and
 * reads no param, so it cannot echo the id and is never an existence oracle.
 *
 * The school being OFF, or a caller without `courses.manage`, never lands here: `layout.tsx` throws
 * that `notFound()` from the layout, which the parent's (generic) boundary catches (UI-D-412).
 */
export default async function CoursesNotFound() {
  const t = await getTranslations('courses');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-4">
      <EmptyState
        variant="card"
        icon={GraduationCap}
        data-testid="courses-not-found"
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={
          <a href="/cursos" className={LINK_OUTLINE}>
            {t('notFound.cta')}
          </a>
        }
      />
    </div>
  );
}
