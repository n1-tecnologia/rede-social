import { cn } from '@rede-social/ui';
import type { LucideIcon } from 'lucide-react';

/**
 * One CELL of the Progresso numbers panel (08.6-10, UI-D-458, UI-D-457), ported from the prototype's
 * `components/members/StatBlock.tsx`: not a card of its own — the host draws the one card, the
 * `<dl class="grid grid-cols-2">` and the inner `border-r` / `border-b` through `className`.
 *
 * The label comes BEFORE the value, as in the prototype: a `<dt>` row with the glyph (`aria-hidden`
 * next to the word) and the tertiary label (clamped), then the `<dd>` with the value
 * `leading-none tabular-nums`, kept on one line (UI E11 overflow).
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).** The prototype's own
 * scale again: the 14px glyph in the brand colour, the label 11px and the value 26/800.
 *
 * Props only, no words of its own (PWA-03, MOD-02): the host passes the label and the value it
 * already formatted from the SERVER's numbers.
 *
 * **2026-10-26 (the academy reference's numbers strip).** A taller cell with room to breathe, the
 * label as a small letterspaced overline (10px, uppercase, up to two lines in a narrow cell) and the
 * value 24/600 (28px from `lg`).
 */
export interface StatBlockProps {
  icon: LucideIcon;
  /** The formatted value ("21", "3,5 h", "45 min", "5 dias"). */
  value: string;
  label: string;
  className?: string;
}

export function StatBlock({ icon: Icon, value, label, className }: StatBlockProps) {
  return (
    <div
      data-testid="stat-block"
      className={cn(
        'flex min-h-[116px] min-w-0 flex-col justify-between gap-4 p-4 lg:min-h-[148px] lg:p-6',
        className,
      )}
    >
      <dt className="flex min-w-0 items-start gap-1.5">
        <Icon aria-hidden size={13} className="mt-px shrink-0 text-brand" />
        <span
          data-testid="stat-block-label"
          className="line-clamp-2 min-w-0 break-words text-[10px] font-medium uppercase leading-snug tracking-[0.12em] text-text-tertiary"
        >
          {label}
        </span>
      </dt>
      <dd
        data-testid="stat-block-value"
        className="m-0 whitespace-nowrap text-2xl font-semibold leading-none tracking-tight text-text tabular-nums lg:text-[28px]"
      >
        {value}
      </dd>
    </div>
  );
}
