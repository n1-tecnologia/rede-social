'use client';

import { MediaImage } from '@rede-social/core/ui';
import { cn, SkinTileFx } from '@rede-social/ui';
import { CircleCheck, Clock, Lock, Play } from 'lucide-react';
import { useState } from 'react';
import { ProgressBar } from './ProgressBar';
import { MEDIA_CHIP, SCRIM_CARD } from './recipes';

/**
 * One lesson of a module page as a card (2026-10-26, the academy reference's "Aulas" grid). ONE
 * anchor to the lesson (a locked one too: its page says why and holds the way to unlock it,
 * UI-D-431), a panel (`ms-card ms-panel ms-solid`) with the COURSE cover on top at 16:9 (never a
 * per-lesson still: a locked lesson's thumbnail can never leave the server, D-423):
 *
 *  - the "Aula {nn}" chip at the top-left; at the top-right the resume share ("26%"), the success
 *    chip in words ("Concluída") or the glass padlock; the length chip at the bottom-right;
 *  - the play disc in the centre on hover for a lesson that opens;
 *  - the 2px band at the cover's foot: the resume share (or full when the lesson is complete);
 *  - under the art the title, then the host's line ("8 min · 26%", "3 min · Concluída", the lock
 *    reason), the done words in the success ink.
 *
 * The current lesson (the one the player has open) keeps a brand hairline. Props only, no words.
 */
export type MemberLessonCardState = 'open' | 'progress' | 'done' | 'locked';

export interface MemberLessonCardProps {
  href: string;
  ariaLabel: string;
  title: string;
  /** "Aula 01". */
  pill: string;
  state: MemberLessonCardState;
  /** 0–100, the resume share of a `progress` lesson. */
  percent?: number;
  /** The share bar's accessible name ("{percent}% concluído"). */
  percentLabel?: string;
  /** The success chip's words ("Concluída"). */
  doneLabel: string;
  /** The length chip ("8 min"); absent without ready video. */
  duration?: string | null;
  /** The line under the title. */
  meta: string;
  current?: boolean;
  coverAssetId: string | null;
  coverWidths: readonly number[];
  /** The `data-lesson-id` value. */
  id: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function MemberLessonCard({
  href,
  ariaLabel,
  title,
  pill,
  state,
  percent = 0,
  percentLabel = '',
  doneLabel,
  duration,
  meta,
  current = false,
  coverAssetId,
  coverWidths,
  id,
}: MemberLessonCardProps) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImage = coverAssetId !== null && failedId !== coverAssetId;
  const share = Math.min(100, Math.max(0, Math.round(Number.isFinite(percent) ? percent : 0)));
  const locked = state === 'locked';

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      aria-current={current ? 'page' : undefined}
      data-testid="member-lesson-card"
      data-lesson-id={id}
      data-state={state}
      data-locked={locked ? 'true' : undefined}
      className={cn(
        'ms-card ms-panel ms-solid group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-opacity active:opacity-90',
        current && 'ring-1 ring-brand/50',
        FOCUS,
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-bg-tertiary">
        {showImage && coverAssetId !== null ? (
          <MediaImage
            assetId={coverAssetId}
            widths={coverWidths}
            alt=""
            sizes="(min-width: 1280px) 240px, (min-width: 1024px) 25vw, (min-width: 480px) 50vw, 100vw"
            ratio=""
            className={cn(
              'ms-zoom absolute inset-0 h-full w-full',
              state === 'done' && 'opacity-80',
            )}
            onFailed={() => setFailedId(coverAssetId)}
          />
        ) : (
          <span
            aria-hidden
            data-testid="member-lesson-card-fallback"
            className="ms-zoom absolute inset-0 block"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        )}
        <SkinTileFx soft />
        <span
          aria-hidden
          className={cn('absolute inset-0 block', SCRIM_CARD, locked && 'bg-black/45')}
        />

        <span className="absolute top-2.5 left-2.5 flex">
          <span data-testid="member-lesson-card-pill" className={MEDIA_CHIP}>
            {pill}
          </span>
        </span>

        {state === 'progress' ? (
          <span
            aria-hidden
            data-testid="member-lesson-card-percent"
            className={cn(MEDIA_CHIP, 'absolute top-2.5 right-2.5 tabular-nums')}
          >
            {`${share}%`}
          </span>
        ) : null}
        {state === 'done' ? (
          <span
            aria-hidden
            data-testid="member-lesson-card-done"
            className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
          >
            <CircleCheck size={11} strokeWidth={2.5} />
            {doneLabel}
          </span>
        ) : null}
        {locked ? (
          <span
            aria-hidden
            data-testid="member-lesson-card-lock"
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="ms-chip flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white">
              <Lock size={16} />
            </span>
          </span>
        ) : (
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-sm">
              <Play size={17} fill="currentColor" className="ml-0.5" />
            </span>
          </span>
        )}

        {duration ? (
          <span
            aria-hidden
            data-testid="member-lesson-card-duration"
            className={cn(
              MEDIA_CHIP,
              'absolute right-2.5 bottom-2.5 gap-1 normal-case tracking-normal tabular-nums',
            )}
          >
            <Clock size={10} />
            {duration}
          </span>
        ) : null}

        {state === 'progress' && share > 0 ? (
          <ProgressBar percent={share} label={percentLabel} size="strip" overMedia pinned />
        ) : null}
        {state === 'done' ? (
          <span aria-hidden className="absolute inset-x-0 bottom-0 block h-0.5 bg-success" />
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <p
          data-testid="member-lesson-card-title"
          className="ms-title-font line-clamp-2 break-words text-sm font-semibold leading-snug text-text"
        >
          {title}
        </p>
        <p
          data-testid="member-lesson-card-meta"
          className={cn(
            'flex items-center gap-1 text-xs font-normal tabular-nums',
            state === 'done' ? 'text-success' : 'text-text-tertiary',
          )}
        >
          {locked ? <Lock aria-hidden size={11} className="shrink-0" /> : null}
          <span className="min-w-0 truncate">{meta}</span>
        </p>
      </div>
    </a>
  );
}
