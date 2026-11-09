'use client';

import { MediaImage } from '@rede-social/core/ui';
import { cn, SkinTileFx } from '@rede-social/ui';
import { Check, Lock, Play } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { MEDIA_CHIP, SCRIM_RESUME } from './recipes';

/**
 * A lesson's 16:9 thumb (08.5-07, UI-D-430, UI-D-444), ported from the prototype's `LessonThumb` as
 * `MemberLessonThumb` (the package already exports a `LessonThumb` TYPE for the admin row).
 *
 * **Art.** The COURSE cover at the thumb's own crop, never a per-lesson Mux still: a locked lesson's
 * thumbnail can never leave the server (D-423, R-A10). No cover, or a cover that fails to load, is
 * the tenant gradient (D-69).
 *
 * **The four states:**
 *  - `open` → the play disc over a light veil;
 *  - `done` → the art at `opacity-70` and the success check (no play disc);
 *  - `locked` → the `bg-black/65` veil and the bordered padlock disc. **Never desaturated** (D-421,
 *    PR-3): the padlock informs, the colour stays;
 *  - `progress` → the play disc plus the 4px resume bar pinned to the bottom (`bg-brand` on
 *    `white/25`, grown in by CSS), at the server's `lastPositionSeconds / durationSeconds`.
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).** The prototype's
 * `LessonThumb` frame: 96px wide in a row (`w-24`, `rounded-xl`), the veil, the 28px play disc, the
 * glass `badge` chip at the top-left and the dark `duration` chip at the bottom-right. And a `card`
 * variant, the prototype's "continuar assistindo" (`ResumeCard`): the hairline frame, the
 * `SCRIM_RESUME` veil, the 44px play disc (a success check once `done`), the duration chip at the
 * top-right and the host's `children` (the course overline and the lesson title) at the foot.
 *
 * Decorative (`aria-hidden`): the host's link names the lesson and says its state in words. Props
 * only, no words.
 *
 * **2026-10-26 (the member skin).** Glass chips (`MEDIA_CHIP`), a lighter play disc with a light
 * edge, the resume fill in the skin's glowing gradient (`ms-bar`) and, on the `card` frame, the
 * image frame's vignette and brand glows (`ms-tile`, `SkinTileFx`). Inert outside the skin.
 */
export type MemberLessonThumbState = 'open' | 'done' | 'locked' | 'progress';

export interface MemberLessonThumbProps {
  state: MemberLessonThumbState;
  /** 0–100, read only in the `progress` state. */
  resumePercent?: number;
  /** The course cover; null takes the gradient. */
  coverAssetId: string | null;
  coverWidths: readonly number[];
  /** Top-left glass chip, already translated by the host; absent → nothing. */
  badge?: string;
  /** The duration chip ("12:34"), formatted by the host; absent → nothing. */
  duration?: string;
  /** The image's `sizes` hint; the row's `96px` by default. */
  sizes?: string;
  /** `thumb` (rows) or `card` (the "continuar assistindo" frame, with `children` at the foot). */
  variant?: 'thumb' | 'card';
  /** `card` only: the words at the foot (the host's overline and title). */
  children?: ReactNode;
  className?: string;
}

export function MemberLessonThumb({
  state,
  resumePercent = 0,
  coverAssetId,
  coverWidths,
  badge,
  duration,
  sizes = '96px',
  variant = 'thumb',
  children,
  className,
}: MemberLessonThumbProps) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImage = coverAssetId !== null && failedId !== coverAssetId;
  const resume = Math.min(100, Math.max(0, Number.isFinite(resumePercent) ? resumePercent : 0));
  const card = variant === 'card';
  const playable = state === 'open' || state === 'progress';

  return (
    <span
      aria-hidden
      data-testid="member-lesson-thumb"
      data-state={state}
      data-variant={variant}
      className={cn(
        'relative block aspect-video shrink-0 overflow-hidden rounded-xl bg-bg-tertiary',
        card ? 'ms-tile w-full border border-border' : 'w-24',
        className,
      )}
    >
      {showImage && coverAssetId !== null ? (
        <MediaImage
          assetId={coverAssetId}
          widths={coverWidths}
          alt=""
          sizes={sizes}
          ratio=""
          className={cn('ms-zoom absolute inset-0 h-full w-full', state === 'done' && 'opacity-70')}
          onFailed={() => setFailedId(coverAssetId)}
        />
      ) : (
        <span
          data-testid="member-lesson-thumb-fallback"
          className={cn('ms-zoom absolute inset-0 block', state === 'done' && 'opacity-70')}
          style={{ backgroundImage: 'var(--brand-gradient)' }}
        />
      )}

      {card ? <SkinTileFx /> : null}
      {card ? (
        <span className={cn('absolute inset-0 block', SCRIM_RESUME)} />
      ) : (
        <span
          className={cn(
            'absolute inset-0 block',
            state === 'locked' ? 'bg-black/65' : state === 'done' ? '' : 'bg-black/25',
          )}
        />
      )}

      {state === 'locked' ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              'ms-chip flex items-center justify-center rounded-full border border-white/20 bg-black/60 text-white',
              card ? 'h-11 w-11' : 'h-6 w-6',
            )}
          >
            <Lock size={card ? 17 : 12} />
          </span>
        </span>
      ) : null}

      {playable ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              'flex items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-sm',
              card ? 'h-11 w-11' : 'h-7 w-7',
            )}
          >
            <Play size={card ? 17 : 14} fill="currentColor" className="ml-0.5" />
          </span>
        </span>
      ) : null}

      {state === 'done' ? (
        card ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success text-white">
              <Check size={20} strokeWidth={3} />
            </span>
          </span>
        ) : (
          <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-success text-white">
            <Check size={11} strokeWidth={3} />
          </span>
        )
      ) : null}

      {state === 'progress' ? (
        <span
          data-testid="member-lesson-thumb-resume"
          className="absolute inset-x-0 bottom-0 block h-1 bg-white/25"
        >
          <span
            className="ms-bar block h-full animate-progress-fill bg-brand motion-reduce:animate-none"
            style={{ width: `${resume}%` }}
          />
        </span>
      ) : null}

      {badge ? (
        <span
          data-testid="member-lesson-thumb-badge"
          className={cn(MEDIA_CHIP, 'absolute', card ? 'top-2 left-2' : 'top-1.5 left-1.5')}
        >
          {badge}
        </span>
      ) : null}

      {duration ? (
        <span
          data-testid="member-lesson-thumb-duration"
          className={cn(
            'absolute rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums',
            card ? 'top-2 right-2' : 'right-1.5 bottom-1.5',
          )}
        >
          {duration}
        </span>
      ) : null}

      {card && children ? (
        <span className="absolute inset-x-0 bottom-0 block p-2.5 pb-3">{children}</span>
      ) : null}
    </span>
  );
}
