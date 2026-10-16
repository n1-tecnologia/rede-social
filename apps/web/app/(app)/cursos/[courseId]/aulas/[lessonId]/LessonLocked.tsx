import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { LockedSection } from '@rede-social/module-store/ui';
import { chipBase, cn, EmptyState, PageHeader, StatusPill } from '@rede-social/ui';
import { CircleAlert, Lock, User } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  CourseActionZone,
  type LockedCourseZone,
} from '@/app/(app)/cursos/[courseId]/CourseActionZone';
import { PreviewBanner } from '@/app/(app)/cursos/PreviewBanner';
import { getLearnCourse, type LessonLockKind } from '@/lib/courses-learn';
import { lessonLockView, memberCourseHref, memberLessonHref } from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';
import { getCourseAccess } from '@/lib/store';
import { lockedCourseView } from '@/lib/store-view';

/**
 * The lock page of a lesson (08.5-08, UI-D-431, D-424, D-428, A-UI-3, sketch 010 frames
 * `aula-bloqueio-compra` / `aula-bloqueio-sequencia`): what a tapped, shared or remembered lesson URL
 * renders when the lesson read answered `403 lesson_locked` (`purchase`) or `409
 * lesson_sequence_locked` (`sequence`). One notice surface instead of a sheet plus a page.
 *
 * **Titles only** (D-423, T-08.5-13, PR-1): this page reads the COURSE outline (`getLearnCourse`) —
 * the lesson's title, numbers and length are there — and NEVER the lesson read: its description,
 * video, poster and materials are never requested, so none of them can reach this HTML or the RSC
 * payload. A lesson the outline does not list (removed, another course's) is "Aula indisponível".
 *
 *  - header as the player's (back "Voltar para o curso", the course title);
 *  - the media block: `aspect-video bg-bg-tertiary`, NO image, a centred 56px `bg-black/60` disc
 *    with `Lock` 24 white, and the over-media pill "Exclusiva" or "Bloqueada" at top-left;
 *  - the identity as the player's (pills, length, title, instructor);
 *  - **purchase** → the course's buy section in its UI-D-428 variants with the LESSON words ("Aula
 *    exclusiva", `lockedCourseView(…, { mode: 'lesson' })`): "Comprar para liberar" to
 *    `/loja/{id}?curso={courseId}` or the "Opções de acesso" sheet, the not-for-sale line, or the
 *    store-failure card (d); plus "Assistir à aula aberta" when the course has a free lesson. A tap
 *    never buys (PR-4): the product page's `PurchaseDialog` confirms;
 *  - **sequence** → "Aula ainda bloqueada", the lock label as a sentence, and the brand "Continuar o
 *    curso" to the course's `nextLessonId` (the lesson that unblocks the path), or the outline
 *    "Voltar para o curso" when there is none. No buy action.
 */
export interface LessonLockedProps {
  courseId: string;
  lessonId: string;
  reason: LessonLockKind;
  preview: boolean;
  /** The store module is on (UI-D-442: off → nothing to buy, no access read). */
  storeOn: boolean;
}

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const BRAND_LINK =
  'inline-flex h-11 w-full items-center justify-center rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const OUTLINE_FULL_LINK = `w-full ${LINK_OUTLINE}`;

/**
 * The member lesson routes' read-failure card: the shipped course error copy ("Algo deu errado",
 * "Não foi possível carregar o curso. Tente novamente.") with an outline retry to the lesson URL.
 */
export async function LessonErrorCard({
  courseId,
  lessonId,
  preview,
}: {
  courseId: string;
  lessonId: string;
  preview: boolean;
}) {
  const t = await getTranslations('courses');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <PageHeader
        backHref={memberCourseHref(courseId, preview)}
        backLabel={t('member.player.back')}
        className="md:static md:px-0"
      />
      <div className="px-4 pt-2">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-testid="lesson-error"
          title={t('errors.title')}
          body={t('errors.course')}
          action={
            <a href={memberLessonHref(courseId, lessonId, preview)} className={LINK_OUTLINE}>
              {t('errors.retry')}
            </a>
          }
        />
      </div>
    </div>
  );
}

export async function LessonLocked({
  courseId,
  lessonId,
  reason,
  preview,
  storeOn,
}: LessonLockedProps) {
  const result = await getLearnCourse(courseId);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'not_found' || result.status === 'disabled') notFound();
  if (result.status === 'error') {
    return <LessonErrorCard courseId={courseId} lessonId={lessonId} preview={preview} />;
  }

  const course = result.course;
  const t = (await getTranslations()) as unknown as CoursesTranslator;
  const view = lessonLockView(course, lessonId, reason, t, { preview });
  if (!view) notFound();

  let lockedZone: LockedCourseZone | null = null;
  if (reason === 'purchase') {
    const access = storeOn ? await getCourseAccess(course.id) : null;
    const target = { courseId: course.id, courseTitle: course.title };
    // Store off → nothing is buyable: the not-for-sale card (c); a failed read → (d).
    const section = storeOn
      ? access
        ? lockedCourseView(access, target, t, { mode: 'lesson' })
        : null
      : lockedCourseView({ archivedTag: false, buyableProducts: [] }, target, t, {
          mode: 'lesson',
        });
    lockedZone = {
      view: section,
      choices: (section?.choices ?? []).map((choice) => ({
        href: choice.href,
        name: choice.name,
        priceLabel: choice.priceLabel,
        ariaLabel: choice.ariaLabel,
        thumb: choice.imageAssetId ? (
          <MediaImage
            assetId={choice.imageAssetId}
            widths={PURPOSE_WIDTHS.cover}
            alt=""
            sizes="40px"
            ratio=""
            className="h-full w-full"
          />
        ) : (
          <span
            className="block h-full w-full"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        ),
      })),
      buyLabel: t('courses.member.locked.buy'),
      storeUnavailable: t('courses.member.locked.storeUnavailable'),
      retryLabel: t('courses.errors.retry'),
      retryHref: memberLessonHref(course.id, lessonId, preview),
      freeLesson: view.freeLessonHref
        ? { href: view.freeLessonHref, label: t('courses.member.locked.freeLesson') }
        : null,
    };
  }

  return (
    <div
      data-testid="lesson-lock-page"
      data-reason={reason}
      className="mx-auto flex w-full max-w-[680px] flex-col pb-6"
    >
      <PageHeader
        title={view.courseTitle}
        backHref={view.courseHref}
        backLabel={t('courses.member.player.back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      {preview ? <PreviewBanner courseId={view.courseId} /> : null}

      <div
        data-testid="lesson-lock-media"
        className={cn(
          'relative flex aspect-video w-full items-center justify-center bg-bg-tertiary',
          preview && 'mt-3',
        )}
      >
        <span className="absolute top-3 left-3">
          <span className={cn(chipBase, 'bg-black/60 text-white backdrop-blur-sm')}>
            {view.mediaPill}
          </span>
        </span>
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white"
        >
          <Lock size={24} />
        </span>
      </div>

      <div className="flex flex-col gap-2 px-4 pt-4">
        <div data-testid="lesson-lock-pills" className="flex flex-wrap items-center gap-1">
          {view.pills.map((pill) => (
            <StatusPill key={pill} tone="neutral">
              {pill}
            </StatusPill>
          ))}
          {view.duration ? (
            <span className="ml-1 text-xs font-normal text-text-tertiary tabular-nums">
              {view.duration}
            </span>
          ) : null}
        </div>
        <h1
          data-testid="lesson-lock-title"
          data-brand-title
          className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text [overflow-wrap:anywhere]"
        >
          {view.title}
        </h1>
        <p className="flex items-center gap-2 text-sm font-normal text-text">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-tertiary">
            {view.instructorPhotoAssetId ? (
              <MediaImage
                assetId={view.instructorPhotoAssetId}
                widths={PURPOSE_WIDTHS.cover}
                alt=""
                sizes="24px"
                ratio=""
                className="h-full w-full"
              />
            ) : (
              <User aria-hidden size={14} className="text-text-tertiary" />
            )}
          </span>
          <span className="min-w-0 break-words">{view.instructorLine}</span>
        </p>
      </div>

      {view.sequence ? (
        <div data-testid="lesson-lock-sequence" className="flex flex-col">
          <LockedSection
            title={view.sequence.title}
            body={view.sequence.body}
            action={
              <a
                href={view.sequence.action.href}
                data-testid="lesson-lock-action"
                data-variant={view.sequence.action.brand ? 'brand' : 'outline'}
                className={view.sequence.action.brand ? BRAND_LINK : OUTLINE_FULL_LINK}
              >
                {view.sequence.action.label}
              </a>
            }
          />
        </div>
      ) : lockedZone ? (
        <div data-testid="lesson-lock-purchase" className="flex flex-col">
          <CourseActionZone action={null} locked={lockedZone} />
        </div>
      ) : null}
    </div>
  );
}
