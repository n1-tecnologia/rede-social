'use client';

import { StatusPill } from '@rede-social/ui';
import { Camera, FileText, LoaderCircle, Video } from 'lucide-react';
import { type ReactNode, useState } from 'react';

/**
 * The lesson row of a module card (08.3-08, UI-D-395, D-407, D-409): an `<a>` to the lesson form
 * with the `w-16 aspect-video` thumb on `bg-bg-tertiary` in one of four states — the ready video's
 * poster, a centred `LoaderCircle` 20 while pending/processing, `FileText` 20 for a lesson without
 * video (a practice lesson), `Camera` 20 for a failed one —, the title 14/700 clamped to two lines,
 * the meta 12/400 secondary ("12:34", "Prática", the " · Aula aberta" suffix), the `StatusPill`
 * only when the host passes one (Processando / Falhou), and the trailing slot OUTSIDE the link where
 * the host's `ReorderList` puts the two arrow buttons (an interactive control never nests in a link).
 *
 * Presentational and props-only (PWA-03, MOD-02): no fetch, no catalog, no route of its own; a plain
 * `<a>`, never `next/link`. The poster is a URL the host minted for this render (a signed thumbnail,
 * never persisted); when it fails to load the row shows the neutral `Video` glyph rather than a
 * broken image (the `MediaAssetRow` rule: a broken box is the one thing an `<img>` must never draw).
 */
export type LessonThumb =
  | { kind: 'poster'; src: string }
  | { kind: 'processing' }
  | { kind: 'practice' }
  | { kind: 'failed' };

export interface LessonRowPill {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface LessonRowProps {
  /** Built by the HOST (`/cursos/{courseId}/aulas/{lessonId}`), never assembled inside the module. */
  href: string;
  title: string;
  /** Already formatted by the host ("12:34", "Prática", "06:12 · Aula aberta"). */
  meta: string;
  thumb: LessonThumb;
  /** Only while the video is not ready: "Processando" `warning`, "Falhou" `danger`. */
  pill?: LessonRowPill;
  /** The link's accessible name, composed by the host. */
  ariaLabel: string;
  /** The arrows, outside the link. */
  trailing?: ReactNode;
  /** The `data-lesson-row` value. */
  id: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

export function LessonRow({
  href,
  title,
  meta,
  thumb,
  pill,
  ariaLabel,
  trailing,
  id,
}: LessonRowProps) {
  const [posterFailed, setPosterFailed] = useState(false);
  const poster = thumb.kind === 'poster' && !posterFailed ? thumb.src : null;
  const thumbState = thumb.kind === 'poster' && posterFailed ? 'poster-missing' : thumb.kind;

  return (
    <div
      data-testid="lesson-row"
      data-lesson-row={id}
      className="flex min-h-14 items-center gap-1 pr-1 pl-3"
    >
      <a
        href={href}
        aria-label={ariaLabel}
        data-testid="lesson-row-link"
        className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg py-2 transition-colors hover:bg-bg-hover active:bg-bg-active ${FOCUS}`}
      >
        <span
          aria-hidden
          data-testid="lesson-row-thumb"
          data-thumb={thumbState}
          className="flex w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-tertiary aspect-video"
        >
          {poster ? (
            <img
              src={poster}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-center"
              onError={() => setPosterFailed(true)}
            />
          ) : thumb.kind === 'processing' ? (
            <LoaderCircle
              size={20}
              className="animate-spin text-text-tertiary motion-reduce:animate-none"
            />
          ) : thumb.kind === 'practice' ? (
            <FileText size={20} className="text-text-secondary" />
          ) : thumb.kind === 'failed' ? (
            <Camera size={20} className="text-text-tertiary" />
          ) : (
            <Video size={20} className="text-text-tertiary" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            data-testid="lesson-row-title"
            className="line-clamp-2 break-words text-sm font-bold leading-tight text-text"
          >
            {title}
          </span>
          {meta ? (
            <span
              data-testid="lesson-row-meta"
              className="mt-0.5 text-xs font-normal text-text-secondary tabular-nums"
            >
              {meta}
            </span>
          ) : null}
        </span>
        {pill ? (
          <StatusPill
            tone={pill.tone}
            data-testid="lesson-row-pill"
            data-tone={pill.tone}
            className="shrink-0"
          >
            {pill.label}
          </StatusPill>
        ) : null}
      </a>
      {trailing}
    </div>
  );
}
