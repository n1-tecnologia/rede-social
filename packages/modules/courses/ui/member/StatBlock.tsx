import { cn } from '@rede-social/ui';
import type { LucideIcon } from 'lucide-react';

/**
 * One CELL of the Progresso numbers panel (08.6-10, UI-D-458, UI-D-457), ported from the prototype's
 * `components/members/StatBlock.tsx`: not a card of its own — the host draws the one card, the
 * `<dl class="grid grid-cols-2">` and the inner `border-r` / `border-b` through `className`.
 *
 * The label comes BEFORE the value, as in the prototype: a `<dt>` row with the neutral 16px glyph
 * (`text-text-secondary`, `aria-hidden` next to the word — the 08.5 material-square precedent, not an
 * accent) and the 12/400 tertiary label (`truncate`), then the `<dd>` with the value 24/700
 * `leading-none tabular-nums`, kept on one line (UI E11 overflow). Normalised from the prototype's
 * 13/11/26/800.
 *
 * Props only, no words of its own (PWA-03, MOD-02): the host passes the label and the value it
 * already formatted from the SERVER's numbers.
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
    <div data-testid="stat-block" className={cn('flex min-w-0 flex-col gap-2 p-4', className)}>
      <dt className="flex min-w-0 items-center gap-2">
        <Icon aria-hidden size={16} className="shrink-0 text-text-secondary" />
        <span
          data-testid="stat-block-label"
          className="min-w-0 truncate text-xs font-normal text-text-tertiary"
        >
          {label}
        </span>
      </dt>
      <dd
        data-testid="stat-block-value"
        className="m-0 whitespace-nowrap text-2xl font-bold leading-none text-text tabular-nums"
      >
        {value}
      </dd>
    </div>
  );
}
