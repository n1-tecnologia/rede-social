import type { MediaPlayback } from '@rede-social/contracts/media';
import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, requireBootstrap } from '@/lib/bootstrap';
import { getCourse } from '@/lib/courses';
import { getLearnCourse } from '@/lib/courses-learn';
import { isPreview } from '@/lib/courses-member-view';
import { formatPublishedAt } from '@/lib/courses-view';
import { getPlaybackTokens } from '@/lib/media';
import { CoursePage } from './CoursePage';
import { MemberCoursePage } from './MemberCoursePage';

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * The provider's signed thumbnail of a ready video, for this render only (D-44, T-08.3-18): the
 * token is a bearer credential at the provider's edge, so the URL lives in the rendered HTML and
 * nowhere else — never a store, never a log, never a cache (the page is dynamic: it reads the
 * bootstrap on every request and the playback route answers `no-store`).
 */
function thumbnailUrl(playback: MediaPlayback): string {
  return `https://image.mux.com/${encodeURIComponent(playback.playbackId)}/thumbnail.jpg?token=${encodeURIComponent(playback.tokens.thumbnail)}`;
}

/**
 * `/cursos/[courseId]` (08.3-08, D-413, D-414, UI-D-394, UI-D-395, COURSE-03, COURSE-05): the
 * course page — the hero, the pills, the action zone that says why publishing is blocked BEFORE
 * the tap, and the curriculum editor with its arrows.
 *
 * **Permission first, then the read** (the loja posture): the gate of `cursos/layout.tsx` is
 * repeated here so a refused caller's request never fires the course read. Every miss is the
 * school's one not-found (`cursos/not-found.tsx`: an unknown, foreign or vanished course — the API
 * answers one bare 404 for both, D-23); a read FAILURE is the course error card with a retry.
 *
 * **Thumbnails.** For every READY lesson video the page mints a playback credential
 * (`getPlaybackTokens`) in one `Promise.all` and hands the row a URL; an asset that answers 404 or
 * 409 (removed, or not ready after all) gets no URL and the row draws its `Camera` fallback. The
 * client then polls the processing lessons (`useAssetReadiness`) and refreshes this page when one
 * settles, so the next render mints the new poster.
 */
export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ ver?: string | string[] }>;
}) {
  const [{ courseId }, query, bootstrap, t] = await Promise.all([
    params,
    searchParams,
    requireBootstrap(),
    getTranslations('courses'),
  ]);
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();

  // 08.5-07 — the role split (D-423, UI-D-427, UI-D-424, T-08.5-27): a `courses.manage` holder gets
  // the shipped admin page unless the URL says `?ver=aluno`; everyone else gets the member page,
  // which reads ONLY the titles-only learn read. A member's `?ver=` is ignored (it can only ever
  // choose the member view), and the banner shows only for an `admin_tenant` (`isPreview`).
  const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);
  if (!manage || query.ver === 'aluno') {
    const storeOn = bootstrap.modules.some((module) => module.key === 'store');
    return renderMemberPage(courseId, isPreview(bootstrap, query.ver), storeOn, t);
  }

  const result = await getCourse(courseId);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled' || result.status === 'not-found') notFound();

  if (result.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col">
        <PageHeader backHref="/cursos" backLabel={t('course.back')} className="md:static md:px-0" />
        <div className="px-4 pt-2">
          <EmptyState
            variant="card"
            icon={CircleAlert}
            data-testid="course-error"
            title={t('errors.title')}
            body={t('errors.course')}
            action={
              <a href={`/cursos/${encodeURIComponent(courseId)}`} className={LINK_OUTLINE}>
                {t('errors.retry')}
              </a>
            }
          />
        </div>
      </div>
    );
  }

  const course = result.course;
  const readyLessons = course.modules
    .flatMap((module) => module.lessons)
    .filter((lesson) => lesson.videoStatus === 'ready' && lesson.videoAssetId !== null);
  const minted = await Promise.all(
    readyLessons.map(async (lesson) => {
      try {
        const playback = await getPlaybackTokens(lesson.videoAssetId as string);
        return [lesson.id, thumbnailUrl(playback)] as const;
      } catch (error) {
        // 404 (the asset is gone) and 409 (not ready after all) are expected: the row falls back.
        if (!(error instanceof ApiClientError && (error.status === 404 || error.status === 409))) {
          console.error('courses.thumbnail_failed', {
            ...(error instanceof ApiClientError
              ? { status: error.status, code: error.code }
              : { error: String(error) }),
          });
        }
        return null;
      }
    }),
  );
  const thumbnails: Record<string, string> = {};
  for (const entry of minted) if (entry) thumbnails[entry[0]] = entry[1];

  const storeOn = bootstrap.modules.some((module) => module.key === 'store');

  return (
    <CoursePage
      course={course}
      thumbnails={thumbnails}
      publishedAtLabel={
        course.status === 'published' && course.publishedAt
          ? formatPublishedAt(course.publishedAt, bootstrap.tenant.timezone)
          : null
      }
      // D-405: with the store off every course is open, so the gated body never shows.
      gatedProducts={storeOn ? course.products.map((product) => product.name) : []}
    />
  );
}

/**
 * The member branch (08.5-07): one learn read. Every miss — unknown, foreign, draft or archived, for
 * EVERY role, buyers and a previewing admin included — is the segment's "Curso indisponível"
 * (D-426, UI-D-441); a read failure is the shipped course error card with its retry.
 */
async function renderMemberPage(
  courseId: string,
  preview: boolean,
  storeOn: boolean,
  t: Awaited<ReturnType<typeof getTranslations<'courses'>>>,
) {
  const result = await getLearnCourse(courseId);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled' || result.status === 'not_found') notFound();
  if (result.status === 'error') {
    const retry = `/cursos/${encodeURIComponent(courseId)}${preview ? '?ver=aluno' : ''}`;
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col">
        <PageHeader backHref="/cursos" backLabel={t('course.back')} className="md:static md:px-0" />
        <div className="px-4 pt-2">
          <EmptyState
            variant="card"
            icon={CircleAlert}
            data-testid="course-error"
            title={t('errors.title')}
            body={t('errors.course')}
            action={
              <a href={retry} className={LINK_OUTLINE}>
                {t('errors.retry')}
              </a>
            }
          />
        </div>
      </div>
    );
  }
  return <MemberCoursePage course={result.course} preview={preview} storeOn={storeOn} />;
}
