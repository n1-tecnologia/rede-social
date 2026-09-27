'use client';

import { cn } from '@tria/ui';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * The detail page's description (UI-D-204, UI E04/long-text): 14/400 secondary, `leading-relaxed`,
 * `whitespace-pre-line` so the admin's line breaks survive, clamped at SIX lines.
 *
 * "Ver mais" / "Ver menos" renders ONLY when the collapsed text really overflows its clamp, measured
 * here on the client (`scrollHeight > clientHeight`) and re-measured on resize. A short description
 * therefore shows no toggle at all, never a dead one.
 *
 * **Plain text, always** (T-06-17): the description is a React text child, so it is escaped; there is
 * no HTML injection and no auto-linking. The words arrive as props (the page owns the catalog).
 */
export interface EventDescriptionProps {
  text: string;
  moreLabel: string;
  lessLabel: string;
}

export function EventDescription({ text, moreLabel, lessLabel }: EventDescriptionProps) {
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const element = ref.current;
    // Only a COLLAPSED paragraph can tell whether its clamp hides anything.
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded]);

  return (
    <div>
      <p
        ref={ref}
        id={id}
        data-testid="event-description"
        className={cn(
          'whitespace-pre-line break-words text-sm leading-relaxed text-text-secondary',
          !expanded && 'line-clamp-6',
        )}
      >
        {text}
      </p>
      {overflows || expanded ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 rounded-md text-sm font-bold text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {expanded ? lessLabel : moreLabel}
        </button>
      ) : null}
    </div>
  );
}
