'use client';

import { MediaImage } from '@rede-social/core/ui';
import { cn, SkinTileFx } from '@rede-social/ui';
import { Check, Clock, Lock } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ProgressBar } from './ProgressBar';
import { MEDIA_CHIP, SCRIM_CARD } from './recipes';

/**
 * The member catalogue's course card (08.5-06, UI-D-426, D-421, D-430).
 *
 * **2026-10-26 (the academy reference, the user's "swap completo").** The reference's course card
 * replaces the 3:4 poster: ONE panel (`ms-card ms-panel ms-solid`: the skin's ring, sheen and lift
 * on hover) with the cover on top at 16:9 and the words under it, never over the art.
 *
 *  - **The cover:** always in colour (D-421), zooming a little on hover (`ms-zoom`) under the skin's
 *    vignette and brand glows (`SkinTileFx`) and a light veil that keeps the chips legible. At the
 *    top-left the host's tags (the store's "Exclusivo", "Produto arquivado") or, without tags, the
 *    category line as a glass chip; at the top-right the completion share ("21%") once a lesson is
 *    done, or the success check when every lesson is; a locked course gets the padlock disc in the
 *    centre. The 2px band at the cover's foot is the progress (`ProgressBar` `strip`).
 *  - **The body:** the title (2 lines at most), then the host's lessons line on the left ("3/14
 *    aulas") and, when the course has ready video, its length on the right with a clock.
 *
 * ONE anchor with the host's accessible name (the tags' and the bar's words are folded into it), a
 * plain `<a>` (MOD-02: no framework import). The image is `MediaImage` on the `cover` ladder; no
 * cover, or a cover that fails to load, is the `--brand-gradient` in the SAME box, so nothing moves.
 * `className` and `sizes` let a shelf give the card a fixed width; `testId`, `metaTestId` and `kind`
 * let Início's shelf keep its own hooks on the same card.
 *
 * Props only and no words (PWA-03): titles, lines, the tags and every label arrive from the host
 * (the share is a number and a sign). The store's tags are a `ReactNode` slot the host composes
 * (`ExclusiveBadge`): this module never imports the store (MOD-02).
 */
export interface CourseCardProgress {
  percent: number;
  /** "{percent}% concluído". */
  label: string;
}

export interface CourseCardProps {
  /** Built by the HOST (`/cursos/{id}`), never assembled inside the module. */
  href: string;
  /** The link's accessible name, composed by the host. */
  ariaLabel: string;
  title: string;
  /** "{category} · {level}", either part alone, or absent: the glass chip when there are no tags. */
  categoryLine?: string | null;
  /** The lessons line under the title ("3/14 aulas"). */
  meta: string;
  /** The course's length beside it ("1 h 43 min"); absent without ready video. */
  duration?: string | null;
  /** Null takes the gradient branch (D-69). */
  coverAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06). */
  coverWidths: readonly number[];
  /** The top-left tag stack (the store's "Exclusivo", "Produto arquivado"); host-composed. */
  tags?: ReactNode;
  /** The share chip and the 2px band, present only once a lesson is complete (D-430). */
  progress?: CourseCardProgress | null;
  /** Locked for this caller (the store's answer): the padlock disc in the centre. */
  locked?: boolean;
  /** Every lesson complete: the success check at the top-right. */
  done?: boolean;
  /** Only the first cards of a screen load eagerly. */
  eager?: boolean;
  /** The anchor's extra classes (a shelf's fixed width and snap). */
  className?: string;
  /** The image's `sizes` hint; the grid's by default. */
  sizes?: string;
  /** The anchor's `data-testid`; `course-card` by default. */
  testId?: string;
  /** The lessons line's `data-testid`; `course-card-meta` by default. */
  metaTestId?: string;
  /** The anchor's `data-kind` (Início's shelf cascade kind). */
  kind?: string;
}

/** One column on a phone, two from 480px, three from `lg` and four in the wide frame. */
const CARD_SIZES =
  '(min-width: 1280px) 300px, (min-width: 1024px) 33vw, (min-width: 480px) 50vw, 100vw';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function CourseCard({
  href,
  ariaLabel,
  title,
  categoryLine,
  meta,
  duration,
  coverAssetId,
  coverWidths,
  tags,
  progress,
  locked = false,
  done = false,
  eager = false,
  className,
  sizes = CARD_SIZES,
  testId = 'course-card',
  metaTestId = 'course-card-meta',
  kind,
}: CourseCardProps) {
  // Keyed by asset id, so a different cover retries instead of inheriting a previous failure.
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImage = coverAssetId !== null && failedId !== coverAssetId;
  const check = done && !locked;
  const share =
    progress && !check ? Math.min(100, Math.max(0, Math.round(progress.percent))) : null;

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid={testId}
      data-kind={kind}
      data-locked={locked ? 'true' : undefined}
      data-done={check ? 'true' : undefined}
      className={cn(
        'ms-card ms-panel ms-solid group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-opacity active:opacity-90',
        FOCUS,
        className,
      )}
    >
      <div
        data-testid="course-card-poster"
        data-branch={showImage ? 'image' : 'gradient'}
        className="relative aspect-video overflow-hidden bg-bg-tertiary"
      >
        {showImage && coverAssetId !== null ? (
          <MediaImage
            assetId={coverAssetId}
            widths={coverWidths}
            alt=""
            sizes={sizes}
            eager={eager}
            ratio=""
            className="ms-zoom absolute inset-0 h-full w-full"
            onFailed={() => setFailedId(coverAssetId)}
          />
        ) : (
          <div
            aria-hidden
            data-testid="course-card-fallback"
            className="ms-zoom absolute inset-0"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        )}
        <SkinTileFx soft />
        <span aria-hidden className={cn('absolute inset-0', SCRIM_CARD)} />

        {tags ? (
          <div
            data-testid="course-card-tags"
            className="absolute top-2.5 right-14 left-2.5 flex flex-col items-start gap-1"
          >
            {tags}
          </div>
        ) : categoryLine ? (
          <span className="absolute top-2.5 right-14 left-2.5 flex">
            <span data-testid="course-card-category" className={MEDIA_CHIP}>
              <span className="min-w-0 truncate">{categoryLine}</span>
            </span>
          </span>
        ) : null}

        {share !== null ? (
          <span
            aria-hidden
            data-testid="course-card-percent"
            className={cn(MEDIA_CHIP, 'absolute top-2.5 right-2.5 text-[10px] tabular-nums')}
          >
            {`${share}%`}
          </span>
        ) : null}

        {check ? (
          <span
            aria-hidden
            data-testid="course-card-done"
            className="absolute top-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-success text-white"
          >
            <Check size={13} strokeWidth={3} />
          </span>
        ) : null}

        {locked ? (
          <span
            aria-hidden
            data-testid="course-card-lock"
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="ms-chip flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white">
              <Lock size={17} />
            </span>
          </span>
        ) : null}

        {progress ? (
          <ProgressBar
            percent={progress.percent}
            label={progress.label}
            size="strip"
            overMedia
            pinned
          />
        ) : null}
      </div>

      <div data-testid="course-card-body" className="flex flex-1 flex-col gap-2 p-3.5 sm:p-4">
        <p
          data-testid="course-card-title"
          className="ms-title-font line-clamp-2 break-words text-sm font-semibold leading-snug text-text sm:text-[15px]"
        >
          {title}
        </p>
        <div className="mt-auto flex items-center justify-between gap-3 text-xs font-normal text-text-tertiary tabular-nums">
          <span data-testid={metaTestId} className="min-w-0 truncate">
            {meta}
          </span>
          {duration ? (
            <span
              data-testid="course-card-duration"
              className="flex shrink-0 items-center gap-1 whitespace-nowrap"
            >
              <Clock aria-hidden size={12} className="shrink-0" />
              {duration}
            </span>
          ) : null}
        </div>
      </div>
    </a>
  );
}
