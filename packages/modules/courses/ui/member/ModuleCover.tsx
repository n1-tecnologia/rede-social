'use client';

import { MediaImage } from '@rede-social/core/ui';
import { chipBase, cn } from '@rede-social/ui';
import { Check, Lock } from 'lucide-react';
import { useState } from 'react';
import { ProgressRing } from './ProgressRing';

/**
 * A module's 16:6 band in the member curriculum (08.5-07, UI-D-429, UI-D-443), ported from the
 * prototype's `ModuleCover` with the phase's porting deltas:
 *
 *  - **the band IS the accordion's button**: a full-width `<button type="button" aria-expanded
 *    aria-controls>` that is **never disabled** — a module's titles are always visible, because the
 *    curriculum sells the course (CONTEXT § Specifics). The prototype disabled a locked band; here a
 *    locked band opens like any other and its rows say why each lesson is held;
 *  - **the art is the course cover** at the band's crop (one asset per course, R-A10), under the
 *    lateral `from-black/85 via-black/45` veil; no cover → the tenant gradient (D-69). The art keeps
 *    its colour in every state (D-421, PR-3): no extra veil and no desaturation on a locked band;
 *  - the numeral is 24/700 `text-white/10` (the type scale's largest step, not the prototype's 48);
 *  - the pill is the host's "Módulo {nn}" or "Concluído", over-media (`chipBase`, `bg-black/60`);
 *  - the meta is the host's "{N} aulas · {duration}", or — when the module rule holds it — `Lock` 12
 *    plus "Libera ao concluir o Módulo {nn}";
 *  - the 32px state: all complete → `bg-success` disc with a white `Check` 16; locked (purchase or
 *    module rule) → `bg-black/60` disc with `Lock` 16; otherwise the `ProgressRing`.
 *
 * **320px (sketch 010 finding 1).** At 288px the band is ~108px tall: a two-line title plus the lock
 * meta would collide with the top pill, so the title is ONE line below 360px and two from 360px.
 *
 * The toggle is the host's (instant, no height animation, focus stays here). Props only, no words:
 * the name "Módulo {nn}: {title}, {state}" is composed by the host.
 */
export type ModuleCoverState =
  | { kind: 'done' }
  | { kind: 'locked' }
  | { kind: 'ring'; percent: number };

export interface ModuleCoverProps {
  /** The band's accessible name: "Módulo {nn}: {title}, {state}". */
  ariaLabel: string;
  expanded: boolean;
  /** The id of the lesson list this band shows and hides. */
  controlsId: string;
  onToggle: () => void;
  /** "01". */
  numeral: string;
  /** "Módulo 01" or "Concluído". */
  pill: string;
  title: string;
  /** "{N} aulas · {duration}", or the lock sentence when `metaLocked`. */
  meta: string;
  metaLocked?: boolean;
  state: ModuleCoverState;
  coverAssetId: string | null;
  coverWidths: readonly number[];
  /** The `data-module-id` value. */
  id: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function ModuleCover({
  ariaLabel,
  expanded,
  controlsId,
  onToggle,
  numeral,
  pill,
  title,
  meta,
  metaLocked = false,
  state,
  coverAssetId,
  coverWidths,
  id,
}: ModuleCoverProps) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImage = coverAssetId !== null && failedId !== coverAssetId;

  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controlsId}
      aria-label={ariaLabel}
      onClick={onToggle}
      data-testid="module-cover"
      data-module-id={id}
      data-state={state.kind}
      className={cn(
        'relative block aspect-[16/6] w-full overflow-hidden rounded-xl bg-bg-tertiary text-left transition-opacity active:opacity-90',
        FOCUS,
      )}
    >
      {showImage && coverAssetId !== null ? (
        <MediaImage
          assetId={coverAssetId}
          widths={coverWidths}
          alt=""
          sizes="(min-width: 712px) 648px, 100vw"
          ratio=""
          className="absolute inset-0 h-full w-full"
          onFailed={() => setFailedId(coverAssetId)}
        />
      ) : (
        <span
          aria-hidden
          data-testid="module-cover-fallback"
          className="absolute inset-0 block"
          style={{ backgroundImage: 'var(--brand-gradient)' }}
        />
      )}
      <span
        aria-hidden
        className="absolute inset-0 block bg-gradient-to-r from-black/85 via-black/45 to-transparent"
      />

      <span
        aria-hidden
        className="absolute right-4 bottom-1 text-2xl font-bold leading-none text-white/10 tabular-nums"
      >
        {numeral}
      </span>

      <span className="absolute top-3 left-3 flex">
        <span
          data-testid="module-cover-pill"
          className={cn(chipBase, 'bg-black/60 text-white backdrop-blur-sm')}
        >
          {pill}
        </span>
      </span>

      <span className="absolute right-16 bottom-3 left-4 flex flex-col">
        <span
          data-testid="module-cover-title"
          className="line-clamp-1 break-words text-base font-bold leading-tight text-white min-[360px]:line-clamp-2"
        >
          {title}
        </span>
        <span
          data-testid="module-cover-meta"
          className="mt-1 flex items-center gap-1 text-xs font-normal text-white/80 tabular-nums"
        >
          {metaLocked ? <Lock aria-hidden size={12} className="shrink-0" /> : null}
          <span className="min-w-0 truncate">{meta}</span>
        </span>
      </span>

      <span
        aria-hidden
        className="absolute right-3 bottom-3 flex h-8 w-8 items-center justify-center"
      >
        {state.kind === 'done' ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success text-white">
            <Check size={16} strokeWidth={3} />
          </span>
        ) : state.kind === 'locked' ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white">
            <Lock size={16} />
          </span>
        ) : (
          <ProgressRing percent={state.percent} size={32} />
        )}
      </span>
    </button>
  );
}
