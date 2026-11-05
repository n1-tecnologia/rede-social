'use client';

import { MediaImage } from '@rede-social/core/ui';
import { cn, SkinTileFx } from '@rede-social/ui';
import { CircleCheck, Lock } from 'lucide-react';
import { useState } from 'react';
import { ProgressBar } from './ProgressBar';
import { MEDIA_CHIP, SCRIM_MODULE } from './recipes';

/**
 * One module of the member's course page as a card (2026-10-26, the academy reference's "Módulos"
 * grid). ONE anchor to the module's own page, a panel (`ms-card ms-panel ms-solid`) with the course
 * cover on top at 16:9, sunk under a dark wash with the module's name drawn large and thin over it
 * (decorative), the "Módulo {nn}" chip at the top-left and the state at the top-right: the share
 * ("8%") while it is under way, the success chip in words ("Concluído") when complete, or the glass
 * padlock when the module is held. The 2px band at the cover's foot is the progress. Under the art:
 * the module's title and the host's lessons line ("1/12 aulas").
 *
 * The art keeps its colour in every state (D-421). Props only, no words (PWA-03, MOD-02): the chip,
 * the line, the done label and the accessible name come from the host; the href too.
 */
export type MemberModuleCardState =
  | { kind: 'progress'; percent: number; label: string }
  | { kind: 'done'; label: string }
  | { kind: 'locked' }
  | { kind: 'idle' };

export interface MemberModuleCardProps {
  /** The module page, built by the host (`?ver=aluno` kept in preview). */
  href: string;
  /** "Módulo {nn}: {title}, {state}". */
  ariaLabel: string;
  title: string;
  /** "Módulo 01". */
  pill: string;
  /** "1/12 aulas". */
  meta: string;
  state: MemberModuleCardState;
  coverAssetId: string | null;
  coverWidths: readonly number[];
  /** The `data-module-id` value. */
  id: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function MemberModuleCard({
  href,
  ariaLabel,
  title,
  pill,
  meta,
  state,
  coverAssetId,
  coverWidths,
  id,
}: MemberModuleCardProps) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImage = coverAssetId !== null && failedId !== coverAssetId;
  const locked = state.kind === 'locked';

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid="member-module-card"
      data-module-id={id}
      data-state={state.kind}
      data-locked={locked ? 'true' : undefined}
      className={cn(
        'ms-card ms-panel ms-solid group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-opacity active:opacity-90',
        FOCUS,
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-bg-tertiary">
        {showImage && coverAssetId !== null ? (
          <MediaImage
            assetId={coverAssetId}
            widths={coverWidths}
            alt=""
            sizes="(min-width: 1024px) 320px, (min-width: 480px) 50vw, 100vw"
            ratio=""
            className="ms-zoom absolute inset-0 h-full w-full"
            onFailed={() => setFailedId(coverAssetId)}
          />
        ) : (
          <span
            aria-hidden
            data-testid="member-module-card-fallback"
            className="ms-zoom absolute inset-0 block"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        )}
        <SkinTileFx soft />
        <span aria-hidden className={cn('absolute inset-0 block', SCRIM_MODULE)} />
        {/* The module's name, large and thin over the art (the reference's band): decorative. */}
        <span
          aria-hidden
          className="ms-title-font absolute inset-x-4 top-1/2 line-clamp-2 -translate-y-1/2 break-words text-[26px] font-light uppercase leading-[1.05] tracking-tight text-white/85 sm:text-[30px]"
        >
          {title}
        </span>

        <span className="absolute top-2.5 left-2.5 flex">
          <span data-testid="member-module-card-pill" className={MEDIA_CHIP}>
            {pill}
          </span>
        </span>

        {state.kind === 'progress' ? (
          <span
            aria-hidden
            data-testid="member-module-card-percent"
            className={cn(MEDIA_CHIP, 'absolute top-2.5 right-2.5 tabular-nums')}
          >
            {`${Math.min(100, Math.max(0, Math.round(state.percent)))}%`}
          </span>
        ) : null}
        {state.kind === 'done' ? (
          <span
            data-testid="member-module-card-done"
            className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
          >
            <CircleCheck aria-hidden size={11} strokeWidth={2.5} />
            {state.label}
          </span>
        ) : null}
        {locked ? (
          <span
            aria-hidden
            data-testid="member-module-card-lock"
            className="ms-chip absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white"
          >
            <Lock size={13} />
          </span>
        ) : null}

        {state.kind === 'progress' && state.percent > 0 ? (
          <ProgressBar percent={state.percent} label={state.label} size="strip" overMedia pinned />
        ) : null}
        {state.kind === 'done' ? (
          <span aria-hidden className="absolute inset-x-0 bottom-0 block h-0.5 bg-success" />
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3.5 sm:p-4">
        <p
          data-testid="member-module-card-title"
          className="ms-title-font line-clamp-2 break-words text-sm font-semibold leading-snug text-text sm:text-[15px]"
        >
          {title}
        </p>
        <p
          data-testid="member-module-card-meta"
          className="text-xs font-normal text-text-tertiary tabular-nums"
        >
          {meta}
        </p>
      </div>
    </a>
  );
}
