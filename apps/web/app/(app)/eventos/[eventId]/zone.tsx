import type { ReactNode } from 'react';

/**
 * The action zone's shell and its call-to-action classes, shared by `EventActions` (the free event and a
 * member who is in) and `PaidEventZone` (a paid event the member is not in, Phase 10.1-12), so the two
 * can never draw a different zone: `flex flex-col gap-3`, `data-testid="event-actions"`, ONE gold fill.
 */
export function Zone({ phase, children }: { phase: string; children: ReactNode }) {
  return (
    <div data-testid="event-actions" data-phase={phase} className="flex flex-col gap-3">
      {children}
    </div>
  );
}

/**
 * `Button lg fullWidth brand`, as classes on a link or a disabled span: the button colour (the
 * REINE gold wherever a tenant set it) under the gradient button's image, the focus ring on the
 * primary.
 */
export const GOLD_BASE =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors';
export const GOLD = `${GOLD_BASE} hover:bg-button-hover hover:bg-(image:--button-image-hover) active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg`;
/** `Button md fullWidth outline`. */
export const OUTLINE_CTA =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
