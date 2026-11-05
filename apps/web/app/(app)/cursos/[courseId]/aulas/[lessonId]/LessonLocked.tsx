import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { MEDIA_CHIP_LG } from '@rede-social/module-courses/ui';
import { LockedSection } from '@rede-social/module-store/ui';
import { MemberSkin, PageHeader, SkinAtmos } from '@rede-social/ui';
import { CircleAlert, Clock, Lock, User } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  CourseActionZone,
  type LockedCourseZone,
} from '@/app/(app)/cursos/[courseId]/CourseActionZone';
import { MemberEmptyCard } from '@/app/(app)/cursos/MemberEmptyCard';
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
 *  - the identity as the player's (length, title, instructor; the pills left on 2026-10-23);
 *  - **purchase** → the course's buy section in its UI-D-428 variants with the LESSON words ("Aula
 *    exclusiva", `lockedCourseView(…, { mode: 'lesson' })`): "Comprar para liberar" to
 *    `/loja/{id}?curso={courseId}` or the "Opções de acesso" sheet, the not-for-sale line, or the
 *    store-failure card (d); plus "Assistir à aula aberta" when the course has a free lesson. A tap
 *    never buys (PR-4): the product page's `PurchaseDialog` confirms;
 *  - **sequence** → "Aula ainda bloqueada", the lock label as a sentence, and the brand "Continuar o
 *    curso" to the course's `nextLessonId` (the lesson that unblocks the path), or the outline
 *    "Voltar para o curso" when there is none. No buy action.
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).** The player's own
 * frame: the two-line header (the course over the lesson title), the BLACK 16:9 frame with the large
 * padlock disc and the glass chip ("Exclusiva" / "Bloqueada"), the length (2026-10-23: the
 * "Módulo / Aula / Aula aberta / Prática" pills left, at the product owner's request), the title
 * 20/700 (the page's h1) and the instructor; both notices are the prototype's centred card
 * (`LockedSection` `centered`, and the course's buy section through `CourseActionZone`). A failed
 * read is the member area's `MemberEmptyCard`.
 *
 * **2026-10-23 — the player's new frame** (`MemberLessonPage`): a WIDE page (`data-shell-full`); the
 * header names the course (the lesson's title is the h1 under the stage); the black 16:9 stage edge to
 * edge on the phone and, from `md`, inset by the 16px gutter, rounded and lifted; under it the title
 * (20/800, 24 from `md`) with the instructor and the length (`Clock`) on one line; the notice keeps a
 * readable width (`md:max-w-xl`) on a wide column.
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
    <MemberSkin>
      <div className="mx-auto flex w-full max-w-[680px] flex-col">
        <PageHeader
          backHref={memberCourseHref(courseId, preview)}
          backLabel={t('member.player.back')}
          className="md:static md:px-0"
        />
        <div className="px-4 pt-2">
          <MemberEmptyCard
            icon={CircleAlert}
            tone="error"
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
    </MemberSkin>
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
    <MemberSkin>
      <div
        data-testid="lesson-lock-page"
        data-reason={reason}
        data-shell-full
        className="mx-auto flex w-full flex-col pb-6"
      >
        <PageHeader
          title={view.courseTitle}
          titleAs="p"
          backHref={view.courseHref}
          backLabel={t('courses.member.player.back')}
          className="md:px-0"
        />

        <div className="md:px-4 md:pt-1">
          <div
            data-testid="lesson-lock-media"
            className="ms-hero relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black md:rounded-3xl md:shadow-lg"
          >
            {/* 2026-10-26 (the member skin): the brand's atmosphere over the black frame. */}
            <SkinAtmos />
            <span className="absolute top-3 left-3">
              <span className={MEDIA_CHIP_LG}>{view.mediaPill}</span>
            </span>
            <span
              aria-hidden
              className="ms-chip relative flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white ring-[10px] ring-brand/10 md:h-20 md:w-20"
            >
              <Lock size={26} />
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-4 pt-4 md:pt-6">
          <h1
            data-testid="lesson-lock-title"
            data-brand-title
            className="ms-title-compact text-xl font-extrabold leading-tight tracking-tight text-text md:text-2xl [overflow-wrap:anywhere]"
          >
            {view.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="flex min-w-0 items-center gap-2 text-sm font-normal text-text-secondary">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-tertiary">
                {view.instructorPhotoAssetId ? (
                  <MediaImage
                    assetId={view.instructorPhotoAssetId}
                    widths={PURPOSE_WIDTHS.cover}
                    alt=""
                    sizes="28px"
                    ratio=""
                    className="h-full w-full"
                  />
                ) : (
                  <User aria-hidden size={14} className="text-text-tertiary" />
                )}
              </span>
              <span className="min-w-0 break-words">{view.instructorLine}</span>
            </p>
            {view.duration ? (
              <p
                data-testid="lesson-lock-duration"
                className="ms-chip-surface inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-text-tertiary tabular-nums"
              >
                <Clock aria-hidden size={14} className="shrink-0" />
                {view.duration}
              </p>
            ) : null}
          </div>
        </div>

        {view.sequence ? (
          <div data-testid="lesson-lock-sequence" className="flex flex-col md:max-w-xl">
            <LockedSection
              variant="centered"
              className="ms-panel rounded-3xl"
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
          <div data-testid="lesson-lock-purchase" className="flex flex-col md:max-w-xl">
            <CourseActionZone action={null} locked={lockedZone} />
          </div>
        ) : null}
      </div>
    </MemberSkin>
  );
}
