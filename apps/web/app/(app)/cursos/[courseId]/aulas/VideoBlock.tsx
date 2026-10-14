'use client';

import { MEDIA_LIMITS, type MediaIssue } from '@rede-social/contracts/media';
import { Button, Card, ConfirmDialog, useToast } from '@rede-social/ui';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useAssetReadiness } from '@/components/media/useAssetReadiness';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { VideoUploadField } from '@/components/media/VideoUploadField';
import {
  formatCourseDuration,
  formatLessonDuration,
  type LessonFormVideo,
} from '@/lib/courses-view';
import { lessonVideoAction } from '../../lesson-actions';

export interface VideoBlockProps {
  /** The lesson's video as the form holds it; `null` is a practice lesson. */
  video: LessonFormVideo | null;
  /** The form's one writer: a new asset after an upload, a settled status, or `null` after a removal. */
  onChange: (video: LessonFormVideo | null) => void;
}

/**
 * The lesson form's video block (08.3-09, D-409, UI-D-398, UI-D-404, UI-D-410, COURSE-06,
 * COURSE-12): ONE block, five states, each saying what the admin can do next.
 *
 *  - **empty** — the kernel's `VideoUploadField` under the `lesson` purpose (its own accept list and
 *    the school's 4 GiB / 4 h pair, charged to the lesson budget), the `outline` CTA inside a form,
 *    and the helper "Opcional. Uma aula sem vídeo é uma aula prática: texto e materiais.";
 *  - **uploading** — the field's own progress ("{percent}% enviado", quartile announcements) and
 *    "Cancelar envio"; a type, size or duration refusal is the zone's error slot;
 *  - **processing** — the asset exists server-side as `pending`: a `bg-bg-tertiary aspect-video`
 *    card with the spinner, "Processando o vídeo…" and "Isso pode levar alguns minutos. Você pode
 *    salvar a aula e voltar depois." (the form saves in this state; only publishing waits, D-413);
 *  - **ready** — the kernel `VideoPlayer` preview (16:9, capped at 480px wide on desktop), the
 *    "mm:ss" caption from the ASSET's seconds and the `ghost` danger "Remover vídeo" → the shipped
 *    "Remover este vídeo?" dialog;
 *  - **failed** — the sentence ("Não foi possível processar este vídeo.", or the shipped "Vídeo muito
 *    longo. O limite é 4 h." for a `duration_too_long` rejection) with "Tentar novamente", which
 *    drops the asset and shows the field again.
 *
 * Readiness is polled with `useAssetReadiness` while the asset is pending/processing; the moment it
 * settles `ready` the block re-reads the asset ONCE (`lessonVideoAction`) for its measured seconds —
 * the caption is never typed and never guessed (PR-6). **No URL field, no embed, no typed duration or
 * thumbnail exists here** (D-409): the only video source is the direct upload through the kernel
 * field, browser → provider, and this block holds an asset id and what the asset said about itself.
 */
export function VideoBlock({ video, onChange }: VideoBlockProps) {
  const t = useTranslations('courses');
  const tm = useTranslations('media');
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  /** The closed refusal behind a `failed` video, when the poll named one (`duration_too_long`). */
  const [failure, setFailure] = useState<MediaIssue | null>(null);

  const polling = video !== null && (video.status === 'pending' || video.status === 'processing');
  const readiness = useAssetReadiness(polling ? video.assetId : null);
  const settledFor = useRef<string | null>(null);

  // One settle per asset id: the poll answers once, the block re-reads the asset once.
  useEffect(() => {
    if (!polling || !video) return;
    if (readiness.phase !== 'ready' && readiness.phase !== 'failed') return;
    if (settledFor.current === video.assetId) return;
    settledFor.current = video.assetId;
    const current = video;
    if (readiness.phase === 'failed') {
      setFailure(readiness.issue);
      onChange({ ...current, status: 'failed' });
      return;
    }
    let cancelled = false;
    void (async () => {
      let durationSeconds: number | null = null;
      try {
        const read = await lessonVideoAction(current.assetId);
        if (read.ok) durationSeconds = read.durationSeconds;
      } catch (error) {
        console.error('courses.lesson_video_read_failed', { error: String(error) });
      }
      if (!cancelled) onChange({ ...current, status: 'ready', durationSeconds });
    })();
    return () => {
      cancelled = true;
    };
  }, [polling, readiness, video, onChange]);

  const lessonCap = MEDIA_LIMITS.video.lesson?.maxDurationSeconds ?? 0;
  const failedCopy =
    failure === 'duration_too_long'
      ? tm('errors.duration', { duration: formatCourseDuration(lessonCap) })
      : tm('player.failed');

  return (
    <div
      data-lesson-video
      data-video-state={video?.status ?? 'empty'}
      className="flex flex-col gap-2"
    >
      <span id="lesson-video-label" className="text-sm font-normal text-text-secondary">
        {t('lesson.video.title')}
      </span>

      {video === null ? (
        <>
          {/* The kernel field owns the upload: accept list, caps, progress, cancel, the error slot. */}
          <VideoUploadField
            purpose="lesson"
            ctaVariant="outline"
            onUploaded={(assetId) => {
              settledFor.current = null;
              setFailure(null);
              onChange({ assetId, status: 'pending', durationSeconds: null });
            }}
          />
          <p className="text-xs font-normal text-text-tertiary">{t('lesson.video.helper')}</p>
        </>
      ) : video.status === 'failed' ? (
        <div data-lesson-video-failed className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm font-normal text-danger">
            {failedCopy}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFailure(null);
              settledFor.current = null;
              onChange(null);
            }}
          >
            {t('lesson.video.retry')}
          </Button>
        </div>
      ) : video.status === 'ready' ? (
        <div data-lesson-video-ready className="flex flex-col gap-2 md:max-w-[480px]">
          <VideoPlayer assetId={video.assetId} status="ready" />
          <div className="flex items-center justify-between gap-3">
            {video.durationSeconds !== null && video.durationSeconds > 0 ? (
              // UI-D-410: the asset's seconds as "mm:ss"; the sr-only twin carries "Duração {mm:ss}".
              <span data-lesson-video-duration className="text-xs tabular-nums text-text-tertiary">
                <span aria-hidden>{formatLessonDuration(video.durationSeconds)}</span>
                <span className="sr-only">
                  {t('lesson.video.duration', {
                    duration: formatLessonDuration(video.durationSeconds),
                  })}
                </span>
              </span>
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-lesson-video-remove
              className="text-danger"
              onClick={() => setRemoving(true)}
            >
              <Trash2 aria-hidden size={18} />
              {t('lesson.video.remove')}
            </Button>
          </div>
        </div>
      ) : (
        <Card
          data-lesson-video-processing
          className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-bg-tertiary p-4 md:max-w-[480px]"
        >
          <LoaderCircle
            aria-hidden
            size={28}
            className="animate-spin text-brand motion-reduce:animate-none"
          />
          <p className="text-sm font-bold text-text">{t('lesson.video.processing')}</p>
          <p className="max-w-[280px] text-center text-xs font-normal text-text-secondary">
            {t('lesson.video.processingBody')}
          </p>
        </Card>
      )}

      {/* UI-D-404: the shipped danger dialog; removing detaches the asset from the DRAFT — the lesson
          keeps its video until the form is saved. */}
      <ConfirmDialog
        open={removing}
        tone="danger"
        icon={Trash2}
        title={tm('confirm.removeVideo.title')}
        body={tm('confirm.removeVideo.body')}
        confirmLabel={tm('confirm.removeVideo.confirm')}
        cancelLabel={tm('confirm.removeVideo.cancel')}
        onConfirm={() => {
          setRemoving(false);
          settledFor.current = null;
          setFailure(null);
          onChange(null);
          toast.show({ tone: 'success', message: tm('toasts.videoRemoved') });
        }}
        onClose={() => setRemoving(false)}
      />
    </div>
  );
}
