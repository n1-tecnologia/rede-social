import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { MemberSkin, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLearnCourse } from '@/lib/courses-learn';
import {
  isPreview,
  memberCourseHref,
  memberModuleHref,
  modulePageView,
} from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';
import { MemberEmptyCard } from '../../../MemberEmptyCard';
import { MemberModulePage } from './MemberModulePage';

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * `/cursos/[courseId]/modulos/[moduleId]` (2026-10-26, the academy reference's module page): a member
 * page only, read from the member's course read (`GET /v1/courses/learn/courses/{id}`, titles only,
 * D-423). Every role sees it as a member does; a manager in preview (`courses.manage`: its links keep
 * `?ver=aluno`, so a lesson opens in the member's player and writes nothing). The module gate, the
 * refusals (`redirect` → navigation, `disabled` / not found → the kernel not-found, anything else →
 * the error card with a retry) and a module the curriculum does not show (unknown, emptied) → the
 * not-found.
 */
export default async function ModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; moduleId: string }>;
  searchParams: Promise<{ ver?: string | string[] }>;
}) {
  const [{ courseId, moduleId }, query, bootstrap] = await Promise.all([
    params,
    searchParams,
    requireBootstrap(),
  ]);
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);
  const preview = manage || isPreview(bootstrap, query.ver);

  const result = await getLearnCourse(courseId);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled' || result.status === 'not_found') notFound();
  if (result.status === 'error') {
    const t = await getTranslations('courses');
    return (
      <MemberSkin>
        <div className="mx-auto flex w-full max-w-[680px] flex-col">
          <PageHeader
            backHref={memberCourseHref(courseId, preview)}
            backLabel={t('member.player.toCourse')}
            className="md:static md:px-0"
          />
          <div className="px-4 pt-2">
            <MemberEmptyCard
              icon={CircleAlert}
              tone="error"
              data-testid="module-error"
              title={t('errors.title')}
              body={t('errors.course')}
              action={
                <a href={memberModuleHref(courseId, moduleId, preview)} className={LINK_OUTLINE}>
                  {t('errors.retry')}
                </a>
              }
            />
          </div>
        </div>
      </MemberSkin>
    );
  }

  const t = (await getTranslations()) as unknown as CoursesTranslator;
  const view = modulePageView(result.course, moduleId, preview, t);
  if (!view) notFound();
  return <MemberModulePage view={view} />;
}
