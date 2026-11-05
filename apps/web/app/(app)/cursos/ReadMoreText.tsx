'use client';

import { cn } from '@rede-social/ui';
import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The member pages' long-text block with its "Ler mais" / "Ler menos" toggle (08.5-07, UI-D-427,
 * UI-D-443): 14/400 secondary `whitespace-pre-line`, clamped, and a BUTTON (an in-place action, not a
 * route) with `aria-expanded` bound to the paragraph. The toggle renders only when the clamp actually
 * hides something (measured after mount), so a short description never offers a "Ler mais" that
 * reveals nothing.
 *
 * 2026-10-22 (the courses area redesign on the social-igoralves prototype): three lines, the
 * prototype's clamp, with the relaxed leading; the toggle is the prototype's quiet text link in the
 * brand ink (12/600), still a 44px target (its extra height pulled out of the flow).
 *
 * Text safety: the description is React text (T-08.5-29). Words arrive from the host (PWA-03).
 */
export interface ReadMoreTextProps {
  text: string;
  moreLabel: string;
  lessLabel: string;
  id: string;
  'data-testid'?: string;
}

export function ReadMoreText({
  text,
  moreLabel,
  lessLabel,
  id,
  'data-testid': testId,
}: ReadMoreTextProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  // Measured once per text: a clamped paragraph scrolls taller than it shows.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || text === '') return;
    setClamped(node.scrollHeight > node.clientHeight + 1);
  }, [text]);

  return (
    <div className="flex flex-col items-start gap-1">
      <p
        ref={ref}
        id={id}
        data-testid={testId}
        className={cn(
          'whitespace-pre-line text-sm font-normal leading-relaxed text-text-secondary [overflow-wrap:anywhere]',
          !expanded && 'line-clamp-3',
        )}
      >
        {text}
      </p>
      {clamped || expanded ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          data-testid="read-more-toggle"
          onClick={() => setExpanded((value) => !value)}
          className="-my-2.5 inline-flex min-h-11 items-center rounded-md text-xs font-semibold text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      ) : null}
    </div>
  );
}
