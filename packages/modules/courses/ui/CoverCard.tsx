import { cn } from '@rede-social/ui';
import type { ReactNode } from 'react';
import { GLASS_CHIP_LG, SCRIM_TRACK } from './member/recipes';

/**
 * 2026-10-22 — the admin's cover card (the social-igoralves "Todas as trilhas" card): ONE `<a>` that
 * is the cover itself at 16:10, outlined and rounded, with a veil rising from the foot, the host's
 * chips as glass pills at the top and the title (18/800, two lines) and the meta over the foot in
 * white. The track row is this card now (`TrackRow`); the list stacks them with a gap instead of
 * hairlines.
 *
 * The words over the art are white on the veil in both themes (the cover is the ground they sit
 * on); the title carries `data-brand-title`, whose ink rule skips `.text-white`, so it only takes the
 * tenant's title font. An empty thumb takes the tenant gradient (D-69).
 *
 * Presentational and props-only (PWA-03, MOD-02): no fetch, no catalog, no route, NO words. A plain
 * `<a>`, never `next/link`. Internal to the module: `TrackRow` composes it.
 */
export interface CoverCardChip {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface CoverCardProps {
  href: string;
  /** The card's accessible name, composed by the host ("{title}, {status}"). */
  ariaLabel: string;
  title: string;
  /** Already formatted by the host ("3 cursos"); `''` renders no meta line. */
  meta: string;
  /** Glass pills at the top, in the host's order ("Arquivada"). */
  chips?: readonly CoverCardChip[];
  /** The host's `MediaImage` (object-cover, filling the box); absent takes the gradient branch. */
  thumb?: ReactNode;
  /** The `data-testid` family prefix (`track-row`). */
  testId: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function CoverCard({
  href,
  ariaLabel,
  title,
  meta,
  chips = [],
  thumb,
  testId,
}: CoverCardProps) {
  const hasThumb = thumb !== undefined && thumb !== null;
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        'group relative block overflow-hidden rounded-2xl border border-border bg-bg-tertiary transition-opacity active:opacity-90',
        FOCUS,
      )}
    >
      <span
        data-testid={hasThumb ? `${testId}-thumb` : `${testId}-fallback`}
        className="relative block aspect-[16/10] w-full overflow-hidden bg-bg-tertiary"
        style={hasThumb ? undefined : { backgroundImage: 'var(--brand-gradient)' }}
      >
        {hasThumb ? (
          <span className="absolute inset-0 block transition-transform duration-300 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
            {thumb}
          </span>
        ) : null}
      </span>
      <span aria-hidden className={cn('pointer-events-none absolute inset-0', SCRIM_TRACK)} />

      {chips.length > 0 ? (
        <span className="absolute top-3 right-3 left-3 flex flex-wrap items-start gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.label}
              data-testid={`${testId}-pill`}
              data-tone={chip.tone}
              className={GLASS_CHIP_LG}
            >
              {chip.label}
            </span>
          ))}
        </span>
      ) : null}

      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-4">
        <span
          data-testid={`${testId}-title`}
          data-brand-title
          className="line-clamp-2 text-lg font-extrabold leading-snug tracking-tight text-white [overflow-wrap:anywhere]"
        >
          {title}
        </span>
        {meta ? (
          <span
            data-testid={`${testId}-meta`}
            className="text-xs font-semibold text-white/80 tabular-nums"
          >
            {meta}
          </span>
        ) : null}
      </span>
    </a>
  );
}
