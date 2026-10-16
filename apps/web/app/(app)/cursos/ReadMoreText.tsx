'use client';

import { Button, cn } from '@rede-social/ui';
import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The member pages' long-text block with its "Ler mais" / "Ler menos" toggle (08.5-07, UI-D-427,
 * UI-D-443): 14/400 secondary `whitespace-pre-line`, clamped to four lines, and a `ghost sm` BUTTON
 * (an in-place action, not a route) with `aria-expanded` bound to the paragraph. The toggle renders
 * only when the clamp actually hides something (measured after mount), so a short description never
 * offers a "Ler mais" that reveals nothing. Instant: no height animation.
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
          'whitespace-pre-line text-sm font-normal text-text-secondary [overflow-wrap:anywhere]',
          !expanded && 'line-clamp-4',
        )}
      >
        {text}
      </p>
      {clamped || expanded ? (
        <Button
          variant="ghost"
          size="sm"
          hitArea
          aria-expanded={expanded}
          aria-controls={id}
          data-testid="read-more-toggle"
          onClick={() => setExpanded((value) => !value)}
          className="-ml-4"
        >
          {expanded ? lessLabel : moreLabel}
        </Button>
      ) : null}
    </div>
  );
}
