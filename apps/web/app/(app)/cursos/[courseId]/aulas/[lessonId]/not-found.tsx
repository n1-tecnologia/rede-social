'use client';

import { EmptyState } from '@rede-social/ui';
import { GraduationCap } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * "Aula indisponível" (08.5-08, UI-D-441, planning decision 2): the ONE screen every lesson miss
 * lands on — a removed lesson, one under a removed module, another tenant's, an unknown or crafted
 * id, a lesson of ANOTHER course than the URL names — for the member, the previewing admin and the
 * admin's edit form alike. A course-level miss keeps the segment's "Curso indisponível".
 *
 * Client only to derive the way back from the PATH (`/cursos/{courseId}/aulas/{lessonId}` →
 * `/cursos/{courseId}`): a not-found boundary receives no params. The id is never printed, so the
 * card is no existence oracle; the back link only repeats what the URL already says, and a crafted
 * course id lands on that course's own not-found.
 */
export default function LessonNotFound() {
  const t = useTranslations('courses.notFound');
  const pathname = usePathname() ?? '';
  const courseId = pathname.split('/')[2] ?? '';
  // The segment is taken as the path already carries it (encoded, never holding a `/`).
  const back = courseId ? `/cursos/${courseId}` : '/cursos';

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-4">
      <EmptyState
        variant="card"
        icon={GraduationCap}
        data-testid="lesson-not-found"
        title={t('lesson')}
        body={t('lessonBody')}
        action={
          <a href={back} data-testid="lesson-not-found-back" className={LINK_OUTLINE}>
            {t('lessonCta')}
          </a>
        }
      />
    </div>
  );
}
