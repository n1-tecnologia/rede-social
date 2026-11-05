import { Card, cn } from '@rede-social/ui';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The locked community page's top section (UI-D-373, decision (9)): rendered by the host only when
 * at least one linked product is buyable. A `Card` with a 40px NEUTRAL disc holding `Lock` 20 (the
 * brand fill stays the section's single accent: the host's action), then the title 16/700 and the
 * body 14/400 secondary; `extraLine` is the `?exclusivo=1` line (UI-D-376), 14/700, above the body.
 *
 * **2026-10-22 (`variant="centered"`, the courses area redesign on the social-igoralves
 * prototype).** The school's locked course and lesson draw the prototype's centred card instead:
 * the hairline card, a 48px padlock disc on the brand tint, the title and the body centred under it,
 * and the host's action full width below. Without `variant` it renders exactly as before.
 *
 * Props only and no words of its own (PWA-03): every string and the action (an `<a>` "Ver produto"
 * or a `<button>` "Ver opções") come from the host, so the module routes nowhere (MOD-02). Long
 * product or community names wrap inside the body (`[overflow-wrap:anywhere]`), never clip.
 */
export interface LockedSectionProps {
  title: string;
  body: string;
  /** The "A publicação que você abriu…" line, only when the page was reached from a hidden post. */
  extraLine?: string;
  action: ReactNode;
  /** `centered`: the school's prototype card. Default: the shipped row layout. */
  variant?: 'default' | 'centered';
  className?: string;
}

export function LockedSection({
  title,
  body,
  extraLine,
  action,
  variant = 'default',
  className,
}: LockedSectionProps) {
  if (variant === 'centered') {
    return (
      <Card
        data-testid="locked-section"
        data-variant="centered"
        className={cn(
          'mx-4 mt-4 flex flex-col items-center border border-border p-4 text-center shadow-none',
          className,
        )}
      >
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand/10 text-text"
        >
          <Lock size={22} />
        </span>
        <h2 className="mt-2.5 text-base font-bold text-text [overflow-wrap:anywhere]">{title}</h2>
        {extraLine ? (
          <p
            data-testid="locked-section-extra"
            className="mt-1 text-sm font-bold text-text [overflow-wrap:anywhere]"
          >
            {extraLine}
          </p>
        ) : null}
        <p className="mt-1 text-sm font-normal leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
          {body}
        </p>
        <div className="mt-3.5 flex w-full flex-col">{action}</div>
      </Card>
    );
  }
  return (
    <Card
      data-testid="locked-section"
      className={cn('mx-4 mt-4 flex flex-col gap-4 p-4', className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary"
        >
          <Lock size={20} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-base font-bold text-text [overflow-wrap:anywhere]">{title}</h2>
          {extraLine ? (
            <p
              data-testid="locked-section-extra"
              className="text-sm font-bold text-text [overflow-wrap:anywhere]"
            >
              {extraLine}
            </p>
          ) : null}
          <p className="text-sm font-normal text-text-secondary [overflow-wrap:anywhere]">{body}</p>
        </div>
      </div>
      {action}
    </Card>
  );
}
