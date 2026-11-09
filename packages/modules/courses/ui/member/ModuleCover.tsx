'use client';

import { MediaImage } from '@rede-social/core/ui';
import { cn, SkinTileFx } from '@rede-social/ui';
import { Check, Lock } from 'lucide-react';
import { useState } from 'react';
import { ProgressRing } from './ProgressRing';

/**
 * A module's 16:6 band in the member curriculum (08.5-07, UI-D-429, UI-D-443), ported from the
 * prototype's `ModuleCover`:
 *
 *  - **the band IS the accordion's button**: a full-width `<button type="button" aria-expanded
 *    aria-controls>` that is **never disabled** — a module's titles are always visible, because the
 *    curriculum sells the course. A locked band opens like any other and its rows say why;
 *  - **the art is the course cover** at the band's crop (one asset per course, R-A10), under the
 *    lateral `from-black/85 via-black/45` veil; no cover → the tenant gradient (D-69). The art keeps
 *    its colour in every state (D-421, PR-3): no desaturation on a locked band.
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).** The prototype's band
 * again: the big watermark numeral (48/800 `text-white/10`), the host's pill by state ("Concluído",
 * "Em andamento", "Bloqueado", "Exclusivo", "Módulo {nn}") — brand-filled while the module is under
 * way, glass otherwise —, the title 16/700 and the meta 11px at the foot, and the state at the
 * bottom-right: the success disc with `Check` (all complete), the glass disc with `Lock` (locked), or
 * the 34px `ProgressRing`, which draws itself in (CSS, still under "reduzir movimento").
 *
 * **320px (sketch 010 finding 1).** At 288px the band is ~108px tall: a two-line title plus the lock
 * meta would collide with the top pill, so the title is ONE line below 360px and two from 360px.
 *
 * The toggle is the host's (the open list animates in the host; focus stays here). Props only, no
 * words: the name "Módulo {nn}: {title}, {state}" is composed by the host.
 *
 * 2026-10-23 (the wide desktop course page): from `lg` the band is 4:1, so a module stays a band
 * (~185px on the page's 740px column) instead of a 280px poster.
 *
 * 2026-10-26 (the member skin): the band is the skin's interactive card (`ms-card`: ring, sheen and
 * lift on hover), the art zooms a little (`ms-zoom`) under the vignette and the brand glows
 * (`SkinTileFx`), the glass pill and the padlock disc are the skin's glass (`ms-chip`), and an
 * open band keeps a brand hairline. Inert outside `[data-member-skin]`.
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
  /** The state's pill: "Concluído", "Em andamento", "Bloqueado", "Exclusivo" or "Módulo 01". */
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

const PILL =
  'inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider';

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
  const underWay = state.kind === 'ring' && state.percent > 0;

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
        'ms-card group relative block aspect-[16/6] w-full overflow-hidden rounded-xl bg-bg-tertiary text-left transition-opacity active:opacity-90 aria-expanded:ring-1 aria-expanded:ring-brand/40 lg:aspect-[4/1]',
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
          className="ms-zoom absolute inset-0 h-full w-full"
          onFailed={() => setFailedId(coverAssetId)}
        />
      ) : (
        <span
          aria-hidden
          data-testid="module-cover-fallback"
          className="ms-zoom absolute inset-0 block"
          style={{ backgroundImage: 'var(--brand-gradient)' }}
        />
      )}
      <SkinTileFx soft />
      <span
        aria-hidden
        className="absolute inset-0 block bg-gradient-to-r from-black/85 via-black/45 to-transparent"
      />

      <span
        aria-hidden
        data-testid="module-cover-numeral"
        className="absolute right-4 bottom-1 text-5xl font-extrabold leading-none text-white/10 tabular-nums"
      >
        {numeral}
      </span>

      <span className="absolute top-3 right-16 left-3 flex">
        <span
          data-testid="module-cover-pill"
          data-tone={underWay ? 'brand' : 'glass'}
          className={cn(
            PILL,
            underWay ? 'bg-brand text-on-brand' : 'ms-chip bg-black/60 text-white backdrop-blur-sm',
          )}
        >
          {pill}
        </span>
      </span>

      <span className="absolute right-16 bottom-3 left-4 flex flex-col">
        <span
          data-testid="module-cover-title"
          className="line-clamp-1 break-words text-base font-bold leading-snug text-white min-[360px]:line-clamp-2"
        >
          {title}
        </span>
        <span
          data-testid="module-cover-meta"
          className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-white/75 tabular-nums"
        >
          {metaLocked ? <Lock aria-hidden size={11} className="shrink-0" /> : null}
          <span className="min-w-0 truncate">{meta}</span>
        </span>
      </span>

      <span
        aria-hidden
        className="absolute right-3 bottom-3 flex h-[34px] w-[34px] items-center justify-center"
      >
        {state.kind === 'done' ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success text-white">
            <Check size={16} strokeWidth={3} />
          </span>
        ) : state.kind === 'locked' ? (
          <span className="ms-chip flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white">
            <Lock size={14} />
          </span>
        ) : (
          <ProgressRing percent={state.percent} size={34} />
        )}
      </span>
    </button>
  );
}
