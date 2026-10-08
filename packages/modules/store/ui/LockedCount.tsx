import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The count block that closes a locked community page (UI-D-373): `Lock` 20 tertiary, the line
 * "+ N publicações exclusivas" 14/700 `tabular-nums` (the exact N the server sent, already
 * pluralised by the host's ICU catalog, never "99+" or a page size), the body 12/400 tertiary and,
 * when a product is buyable, the host's `outline` action repeating the top section's. With nothing
 * buyable the host passes the "não está à venda" body and no action.
 *
 * Props only and no words of its own (PWA-03). `extraLine` carries the `?exclusivo=1` line when
 * there is no top section to hold it (UI-D-376).
 */
export interface LockedCountProps {
  line: string;
  body: string;
  extraLine?: string;
  action?: ReactNode;
}

export function LockedCount({ line, body, extraLine, action }: LockedCountProps) {
  return (
    <div
      data-testid="locked-count"
      className="flex flex-col items-center gap-2 px-4 py-6 text-center"
    >
      <Lock size={20} aria-hidden className="text-text-tertiary" />
      <p className="text-sm font-bold text-text tabular-nums">{line}</p>
      {extraLine ? (
        <p
          data-testid="locked-count-extra"
          className="text-sm font-bold text-text [overflow-wrap:anywhere]"
        >
          {extraLine}
        </p>
      ) : null}
      <p className="text-xs font-normal text-text-tertiary [overflow-wrap:anywhere]">{body}</p>
      {action ?? null}
    </div>
  );
}
