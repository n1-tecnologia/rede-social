import { cn, StatusPill } from '@rede-social/ui';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The admin list row the course, track and live rows share (UI-D-392): one `<a>` with
 * `flex items-center gap-3 min-h-14 px-4 py-2`, a thumb on `bg-bg-tertiary` whose empty slot takes
 * the tenant gradient (D-69, `--brand-on-primary` ink rule: the box carries no text, so only the
 * paint applies), the name 14/700 clamped to two lines, a meta line 12/400 secondary, the pills
 * (`shrink-0`: two pills truncate the NAME, never themselves — E03 overflow) and `ChevronRight` 18
 * tertiary.
 *
 * Presentational and props-only (PWA-03, MOD-02): it fetches nothing, formats nothing, resolves no
 * route and ships NO words. The host builds the href, the accessible name ("{title}, {status}"),
 * the meta string, every pill label and the `MediaImage` thumb slot. A plain `<a>`, never
 * `next/link`: a module must not depend on the framework.
 */
export interface ListRowPill {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface ListRowProps {
  /** Built by the HOST, never assembled inside the module. */
  href: string;
  /** The whole row's accessible name, composed by the host ("{title}, {status}"). */
  ariaLabel: string;
  title: string;
  /** Already formatted by the host ("2 módulos · 6 aulas · 45 min"); `''` renders no meta line. */
  meta: string;
  /** In priority order; the host decides them (status first, then "Processando"). */
  pills?: readonly ListRowPill[];
  /** The host's `MediaImage` (object-cover, filling the box); absent takes the gradient branch. */
  thumb?: ReactNode;
  /** `poster` is the 3:4 course thumb (`w-10`), `wide` the 16:10 track/live thumb (`w-16`). */
  thumbShape: 'poster' | 'wide';
  /** The host's `data-testid` family prefix (`course-row`, `track-row`, `live-row`). */
  testId: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

/** The two thumb geometries of UI-D-392; both `rounded-lg` on `bg-bg-tertiary`, `shrink-0`. */
export const THUMB_SHAPE = {
  poster: 'w-10 aspect-[3/4]',
  wide: 'w-16 aspect-[16/10]',
} as const;

export function ListRow({
  href,
  ariaLabel,
  title,
  meta,
  pills = [],
  thumb,
  thumbShape,
  testId,
}: ListRowProps) {
  const hasThumb = thumb !== undefined && thumb !== null;
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 px-4 py-2 transition-colors hover:bg-bg-hover active:bg-bg-active',
        FOCUS,
      )}
    >
      <span
        data-testid={hasThumb ? `${testId}-thumb` : `${testId}-fallback`}
        className={cn(
          'relative block shrink-0 overflow-hidden rounded-lg bg-bg-tertiary',
          THUMB_SHAPE[thumbShape],
        )}
        style={hasThumb ? undefined : { backgroundImage: 'var(--brand-gradient)' }}
      >
        {hasThumb ? <span className="absolute inset-0 block">{thumb}</span> : null}
      </span>
      <span className="min-w-0 flex-1">
        {/* No `block` beside `line-clamp-2`: the display utility is emitted AFTER the clamp in the
            compiled CSS and would win the cascade (display: block over -webkit-box), painting every
            line of a long title — the 08.3-12 E03 backstop found exactly that at 320px. The clamp's
            own `-webkit-box` is block-level already. */}
        <span
          data-testid={`${testId}-title`}
          className="line-clamp-2 text-sm font-bold leading-tight text-text"
        >
          {title}
        </span>
        {meta ? (
          <span
            data-testid={`${testId}-meta`}
            className="mt-1 block text-xs font-normal text-text-secondary tabular-nums"
          >
            {meta}
          </span>
        ) : null}
      </span>
      {pills.length > 0 ? (
        <span className="flex shrink-0 items-center gap-1">
          {pills.map((pill) => (
            <StatusPill
              key={pill.label}
              tone={pill.tone}
              data-testid={`${testId}-pill`}
              data-tone={pill.tone}
              className="shrink-0"
            >
              {pill.label}
            </StatusPill>
          ))}
        </span>
      ) : null}
      <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
    </a>
  );
}
