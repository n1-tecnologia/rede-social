'use client';

import type { CourseStatus } from '@rede-social/module-courses/contracts';
import { PublishBlockedNotice } from '@rede-social/module-courses/ui';
import { Button, ConfirmDialog, useToast } from '@rede-social/ui';
import { Eye, EyeOff, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { type PublishBlockedLesson, publishBlockedView } from '@/lib/courses-view';
import { type CourseWriteResult, setCourseStatusAction } from '../course-actions';

export interface PublishZoneProps {
  courseId: string;
  status: CourseStatus;
  /** "9 de outubro de 2026", server-formatted, on a published course. */
  publishedAtLabel: string | null;
  /** Every live lesson in the curriculum's order, so the notice can name the blocking ones. */
  lessons: readonly PublishBlockedLesson[];
  /** The detail's `unreadyLessonIds`: what blocks publishing as of this render. */
  unreadyLessonIds: readonly string[];
  /** The linked products' names (store on); empty → the plain publish body. */
  gatedProducts: readonly string[];
}

const LIST = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' });

/** The `Button` outline `md` `fullWidth` geometry as a LINK (a route, never a `<button>`). */
const OUTLINE_LINK =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * The action zone of the course page (08.3-08, D-413, UI-D-394, UI-D-404, UI-D-405, COURSE-03), one
 * card per status:
 *
 * - **draft** — the brand `fullWidth` "Publicar curso" (`Send` 18); while any lesson's video is not
 *   ready the `PublishBlockedNotice` sits ABOVE it and the button is DISABLED: the reason before the
 *   tap. The brand "Publicar curso?" dialog (the gated body naming the products when the course has
 *   any) → `setCourseStatusAction(id, 'published')` → "Curso publicado." and a refresh.
 * - **published** — the `outline fullWidth` LINK "Ver como aluno" (`Eye` 18, 08.5-10, D-422,
 *   UI-D-437) to `/cursos/{id}?ver=aluno`, then the `outline fullWidth` "Despublicar" (`EyeOff` 18)
 *   over "Publicado em {date}." (the card's `gap-3` spaces them); the danger "Despublicar curso?"
 *   dialog → `'draft'` → "Curso despublicado." and a refresh.
 * - **archived** — the note and no button (A-UI-3: no reactivation here).
 *
 * **Server truth wins.** A `409 video_not_ready` after the tap (a video that failed between the
 * render and the confirm) re-renders the notice from the SERVER's `lessonIds`, toasts the same
 * sentence and moves focus to the notice once the dialog's trap has released (UI-D-407). Any other
 * refusal toasts and keeps the screen (E14 error).
 */
export function PublishZone({
  courseId,
  status,
  publishedAtLabel,
  lessons,
  unreadyLessonIds,
  gatedProducts,
}: PublishZoneProps) {
  const t = useTranslations('courses');
  const tRoot = useTranslations();
  const router = useRouter();
  const toast = useToast();

  const [unready, setUnready] = useState<readonly string[]>(unreadyLessonIds);
  // The SERVER rendered a different course (a refresh after a write): re-seed, the list pattern.
  const [seed, setSeed] = useState(unreadyLessonIds);
  if (seed !== unreadyLessonIds) {
    setSeed(unreadyLessonIds);
    setUnready(unreadyLessonIds);
  }

  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [focusNotice, setFocusNotice] = useState(0);

  useEffect(() => {
    if (focusNotice === 0) return;
    // The dialog's trap returns focus to its opener (the now-disabled button) as it closes; wait
    // until no modal is left, then land on the notice (the category manager's idiom).
    let frame = 0;
    let tries = 0;
    const tick = () => {
      if (document.querySelector('[aria-modal="true"]') !== null && tries < 120) {
        tries += 1;
        frame = requestAnimationFrame(tick);
        return;
      }
      noticeRef.current?.focus({ preventScroll: false });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [focusNotice]);

  const blocked = publishBlockedView(unready, lessons, courseId, tRoot as never);

  const refuse = (result: Exclude<CourseWriteResult, { ok: true }>) => {
    if (result.code === 'video_not_ready') {
      const ids = result.lessonIds && result.lessonIds.length > 0 ? result.lessonIds : unready;
      setUnready(ids);
      const view = publishBlockedView(ids, lessons, courseId, tRoot as never);
      toast.show({ tone: 'error', message: view?.sentence ?? t('form.errors.save') });
      setFocusNotice((n) => n + 1);
      return;
    }
    if (result.code === 'disabled') {
      toast.show({ tone: 'error', message: t('errors.disabled') });
      return;
    }
    toast.show({ tone: 'error', message: t('form.errors.save') });
  };

  const transition = async (next: 'published' | 'draft') => {
    let result: CourseWriteResult;
    try {
      result = await setCourseStatusAction(courseId, next);
    } catch (error) {
      console.error('courses.status_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('form.errors.save') });
      return;
    }
    if (!result.ok) {
      refuse(result);
      return;
    }
    toast.show({
      tone: 'success',
      message: next === 'published' ? t('toasts.published') : t('toasts.unpublished'),
    });
    router.refresh();
  };

  if (status === 'archived') {
    return (
      <p data-testid="course-archived-note" className="text-sm font-normal text-text-secondary">
        {t('course.archivedNote')}
      </p>
    );
  }

  if (status === 'published') {
    return (
      <>
        <a
          href={`/cursos/${encodeURIComponent(courseId)}?ver=aluno`}
          data-testid="course-view-as-member"
          className={OUTLINE_LINK}
        >
          <Eye aria-hidden size={18} className="shrink-0" />
          {t('course.viewAsMember')}
        </a>
        <Button
          type="button"
          variant="outline"
          size="md"
          fullWidth
          data-testid="course-unpublish"
          onClick={() => setUnpublishing(true)}
        >
          <EyeOff aria-hidden size={18} className="shrink-0" />
          {t('course.unpublish')}
        </Button>
        {publishedAtLabel ? (
          <p data-testid="course-published-at" className="text-xs font-normal text-text-tertiary">
            {t('course.publishedAt', { date: publishedAtLabel })}
          </p>
        ) : null}
        <ConfirmDialog
          open={unpublishing}
          tone="danger"
          icon={EyeOff}
          title={t('course.unpublishDialog.title')}
          body={t('course.unpublishDialog.body')}
          confirmLabel={t('course.unpublishDialog.confirm')}
          cancelLabel={t('course.unpublishDialog.cancel')}
          onConfirm={() => transition('draft')}
          onClose={() => setUnpublishing(false)}
          onError={(error) => {
            console.error('courses.status_failed', { error: String(error) });
            toast.show({ tone: 'error', message: t('form.errors.save') });
          }}
        />
      </>
    );
  }

  return (
    <>
      {blocked ? (
        <PublishBlockedNotice
          ref={noticeRef}
          id="course-publish-blocked"
          sentence={blocked.sentence}
          links={blocked.links}
          moreHref={blocked.moreHref}
          moreLabel={blocked.moreLabel}
        />
      ) : null}
      <Button
        type="button"
        variant="brand"
        size="md"
        fullWidth
        data-testid="course-publish"
        disabled={blocked !== null}
        aria-describedby={blocked ? 'course-publish-blocked' : undefined}
        onClick={() => setPublishing(true)}
      >
        <Send aria-hidden size={18} className="shrink-0" />
        {t('course.publish')}
      </Button>
      <ConfirmDialog
        open={publishing}
        tone="brand"
        icon={Send}
        title={t('course.publishDialog.title')}
        body={
          gatedProducts.length > 0
            ? t('course.publishDialog.bodyGated', { products: LIST.format(gatedProducts) })
            : t('course.publishDialog.body')
        }
        confirmLabel={t('course.publishDialog.confirm')}
        cancelLabel={t('course.publishDialog.cancel')}
        onConfirm={() => transition('published')}
        onClose={() => setPublishing(false)}
        onError={(error) => {
          console.error('courses.status_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('form.errors.save') });
        }}
      />
    </>
  );
}
