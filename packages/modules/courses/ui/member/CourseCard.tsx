'use client';

import { MediaImage } from '@rede-social/core/ui';
import { cn } from '@rede-social/ui';
import { type ReactNode, useState } from 'react';
import { ProgressBar } from './ProgressBar';

/**
 * The member catalogue's course poster (08.5-06, UI-D-426, D-421, D-430), ported from the prototype's
 * `CourseCard` with the phase's porting deltas:
 *
 *  - **3:4, not 4:5** (UI-D-409): the ratio the admin form previews;
 *  - **the cover is always in colour**: never desaturated, no extra veil and no centred padlock on a locked
 *    card (D-357, D-421, PR-3). The lock is said by the host's tag in the top-left stack;
 *  - the prototype's category micro-pill becomes the "{category} · {level}" line of the bottom block,
 *    and its 3px bar the ported `ProgressBar` at `h-1`, shown on locked cards too (A-UI-5).
 *
 * ONE anchor with the host's accessible name (the tags' and the bar's words are folded into it), a
 * plain `<a>` (MOD-02: no framework import). The image branch is `MediaImage` on the `cover` ladder
 * under the `from-black/85` veil with white ink; the no-image branch — no cover, or a cover that
 * fails to load — is the `--brand-gradient` with `--brand-on-primary` ink (D-69), in the SAME box,
 * so nothing moves between loading, loaded and failed.
 *
 * Props only and no words (PWA-03): titles, lines, the meta, the tags and every label arrive from
 * the host. The store's tags are a `ReactNode` slot the host composes (`ExclusiveBadge`): this module
 * never imports the store (MOD-02).
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
  /** "{category} · {level}", either part alone, or absent. */
  categoryLine?: string | null;
  /** "{N} aulas · {duration}". */
  meta: string;
  /** Null takes the gradient branch (D-69). */
  coverAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06). */
  coverWidths: readonly number[];
  /** The top-left tag stack (the store's "Exclusivo", "Produto arquivado"); host-composed. */
  tags?: ReactNode;
  /** The pinned `h-1` bar, present only once a lesson is complete (D-430). */
  progress?: CourseCardProgress | null;
  /** Only the first posters of a screen load eagerly. */
  eager?: boolean;
}

/** In the 680px column: two columns below 640px, three (≈210px) from 640px. */
const POSTER_SIZES = '(min-width: 640px) 210px, 50vw';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function CourseCard({
  href,
  ariaLabel,
  title,
  categoryLine,
  meta,
  coverAssetId,
  coverWidths,
  tags,
  progress,
  eager = false,
}: CourseCardProps) {
  // Keyed by asset id, so a different cover retries instead of inheriting a previous failure.
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImage = coverAssetId !== null && failedId !== coverAssetId;

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid="course-card"
      className={cn('block rounded-xl transition-opacity active:opacity-80', FOCUS)}
    >
      <div
        data-testid="course-card-poster"
        data-branch={showImage ? 'image' : 'gradient'}
        className="relative aspect-[3/4] overflow-hidden rounded-xl bg-bg-tertiary"
      >
        {showImage && coverAssetId !== null ? (
          <>
            <MediaImage
              assetId={coverAssetId}
              widths={coverWidths}
              alt=""
              sizes={POSTER_SIZES}
              eager={eager}
              ratio=""
              className="absolute inset-0 h-full w-full"
              onFailed={() => setFailedId(coverAssetId)}
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
            />
          </>
        ) : (
          <div
            aria-hidden
            data-testid="course-card-fallback"
            className="absolute inset-0"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        )}

        {tags ? (
          <div
            data-testid="course-card-tags"
            className="absolute top-3 right-3 left-3 flex flex-col items-start gap-1"
          >
            {tags}
          </div>
        ) : null}

        <div
          data-testid="course-card-body"
          className={cn('absolute inset-x-3', progress ? 'bottom-4' : 'bottom-3')}
          style={showImage ? undefined : { color: 'var(--brand-on-primary)' }}
        >
          <div className={showImage ? 'text-white' : undefined}>
            {categoryLine ? (
              <p
                data-testid="course-card-category"
                className="truncate text-xs font-bold opacity-80"
              >
                {categoryLine}
              </p>
            ) : null}
            <p
              data-testid="course-card-title"
              className="mt-1 line-clamp-2 text-sm font-bold leading-tight"
            >
              {title}
            </p>
            <p
              data-testid="course-card-meta"
              className="mt-1 text-xs font-normal tabular-nums opacity-80"
            >
              {meta}
            </p>
          </div>
        </div>

        {progress ? (
          <ProgressBar
            percent={progress.percent}
            label={progress.label}
            size="sm"
            overMedia
            pinned
          />
        ) : null}
      </div>
    </a>
  );
}
