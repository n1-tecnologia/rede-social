'use client';

import { MediaImage } from '@rede-social/core/ui';
import { cn } from '@rede-social/ui';
import { Lock, Play } from 'lucide-react';
import { useState } from 'react';

/**
 * A lesson's 16:9 thumb in the member curriculum (08.5-07, UI-D-430, UI-D-444), ported from the
 * prototype's `LessonThumb` as `MemberLessonThumb` (the package already exports a `LessonThumb`
 * TYPE for the admin row, planning decision 1).
 *
 * **Art.** The COURSE cover at the thumb's own crop (`object-cover object-center`), never a
 * per-lesson Mux still: a locked lesson's thumbnail can never leave the server (D-423, R-A10,
 * WR-08 stays deferred). No cover, or a cover that fails to load, is the tenant gradient (D-69).
 *
 * **The four states** (no duration chip: the row's meta carries it):
 *  - `open` → a 28px `bg-black/55` disc with a filled `Play` 14;
 *  - `done` → the art at `opacity-70`, no disc;
 *  - `locked` → `bg-black/65` over the art and a 28px `bg-black/60` bordered disc with `Lock` 14.
 *    **Never desaturated** (D-421, PR-3): the padlock informs, the colour stays;
 *  - `progress` → the open disc plus a 4px resume bar pinned to the bottom (`bg-brand` on
 *    `white/25`), at the server's `lastPositionSeconds / durationSeconds`.
 *
 * Decorative (`aria-hidden`): the row's name says the state in words. Props only, no words.
 */
export type MemberLessonThumbState = 'open' | 'done' | 'locked' | 'progress';

export interface MemberLessonThumbProps {
  state: MemberLessonThumbState;
  /** 0–100, read only in the `progress` state. */
  resumePercent?: number;
  /** The course cover; null takes the gradient. */
  coverAssetId: string | null;
  coverWidths: readonly number[];
  className?: string;
}

export function MemberLessonThumb({
  state,
  resumePercent = 0,
  coverAssetId,
  coverWidths,
  className,
}: MemberLessonThumbProps) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImage = coverAssetId !== null && failedId !== coverAssetId;
  const resume = Math.min(100, Math.max(0, Number.isFinite(resumePercent) ? resumePercent : 0));

  return (
    <span
      aria-hidden
      data-testid="member-lesson-thumb"
      data-state={state}
      className={cn(
        'relative block aspect-video w-20 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary',
        className,
      )}
    >
      {showImage && coverAssetId !== null ? (
        <MediaImage
          assetId={coverAssetId}
          widths={coverWidths}
          alt=""
          sizes="80px"
          ratio=""
          className={cn('absolute inset-0 h-full w-full', state === 'done' && 'opacity-70')}
          onFailed={() => setFailedId(coverAssetId)}
        />
      ) : (
        <span
          data-testid="member-lesson-thumb-fallback"
          className={cn('absolute inset-0 block', state === 'done' && 'opacity-70')}
          style={{ backgroundImage: 'var(--brand-gradient)' }}
        />
      )}

      {state === 'locked' ? (
        <>
          <span className="absolute inset-0 bg-black/65" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white">
              <Lock size={14} />
            </span>
          </span>
        </>
      ) : null}

      {state === 'open' || state === 'progress' ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
            <Play size={14} fill="currentColor" />
          </span>
        </span>
      ) : null}

      {state === 'progress' ? (
        <span
          data-testid="member-lesson-thumb-resume"
          className="absolute inset-x-0 bottom-0 block h-1 bg-white/25"
        >
          <span className="block h-full bg-brand" style={{ width: `${resume}%` }} />
        </span>
      ) : null}
    </span>
  );
}
