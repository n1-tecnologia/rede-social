import { Card } from '@rede-social/ui';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The locked community page's top section (UI-D-373, decision (9)): rendered by the host only when
 * at least one linked product is buyable. A `Card` with a 40px NEUTRAL disc holding `Lock` 20 (the
 * brand fill stays the section's single accent: the host's action), then the title 16/700 and the
 * body 14/400 secondary; `extraLine` is the `?exclusivo=1` line (UI-D-376), 14/700, above the body.
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
}

export function LockedSection({ title, body, extraLine, action }: LockedSectionProps) {
  return (
    <Card data-testid="locked-section" className="mx-4 mt-4 flex flex-col gap-4 p-4">
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
