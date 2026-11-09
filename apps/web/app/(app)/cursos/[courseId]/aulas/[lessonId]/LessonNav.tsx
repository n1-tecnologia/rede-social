'use client';

import { cn } from '@rede-social/ui';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import type { LessonNavView } from '@/lib/courses-member-view';
import { useLessonSession } from './LessonSession';

/**
 * The player's previous and next (08.5-08, UI-D-432, UI-D-443).
 *
 * **2026-10-26 (the academy reference's player, the user's "swap completo").** One row between two
 * hairlines: "‹ Aula anterior" at the left (an `aria-disabled` span at `opacity-40` when there is no
 * previous open lesson), the lesson's place in the course in the middle ("3 de 14 aulas") and the
 * next at the right:
 *
 *  - an open next: the LINK "Próxima aula ›", in the brand ink once this lesson is complete (the
 *    emphasis moves from "Marcar como concluída" to here as the lesson completes);
 *  - a locked next: a non-interactive span, `text-text-tertiary`, with `Lock` and the reason in
 *    words ("Conclua esta aula", "Conclua o módulo", "Aula exclusiva");
 *  - no next: the LINK "Voltar para o curso".
 *
 * Client only to read the session's completion. Every word and href arrives from `lessonNavView`
 * (and the position from `lessonOutlineView`), which label the server's `lockReason`: this
 * component never decides a lock.
 */
export interface LessonNavProps {
  nav: LessonNavView;
  /** "{n} de {total} aulas"; absent without the course outline. */
  position?: string | null;
}

const LINK =
  'inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

export function LessonNav({ nav, position = null }: LessonNavProps) {
  const { completed } = useLessonSession();
  const { next } = nav;

  return (
    <nav
      data-testid="lesson-nav"
      className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-y border-border py-2"
    >
      <span className="flex min-w-0 justify-start">
        {nav.previousHref ? (
          <a
            href={nav.previousHref}
            data-testid="lesson-previous"
            className={cn(LINK, 'text-text-secondary hover:text-text')}
          >
            <ChevronLeft aria-hidden size={16} className="shrink-0" />
            <span className="truncate">{nav.previousLabel}</span>
          </a>
        ) : (
          <span
            aria-disabled="true"
            data-testid="lesson-previous"
            data-state="disabled"
            className={cn(LINK, 'text-text opacity-40')}
          >
            <ChevronLeft aria-hidden size={16} className="shrink-0" />
            <span className="truncate">{nav.previousLabel}</span>
          </span>
        )}
      </span>

      {position ? (
        <span
          data-testid="lesson-position"
          className="px-1 text-center text-sm font-normal text-text-tertiary tabular-nums"
        >
          {position}
        </span>
      ) : (
        <span aria-hidden />
      )}

      <span className="flex min-w-0 justify-end">
        {next.kind === 'open' ? (
          <a
            href={next.href}
            data-testid="lesson-next"
            data-variant={completed ? 'brand' : 'outline'}
            className={cn(
              LINK,
              completed ? 'text-brand hover:text-brand-hover' : 'text-text hover:text-brand',
            )}
          >
            <span className="truncate">{next.label}</span>
            <ChevronRight aria-hidden size={16} className="shrink-0" />
          </a>
        ) : next.kind === 'locked' ? (
          <span
            data-testid="lesson-next"
            data-variant="locked"
            className={cn(LINK, 'text-text-tertiary')}
          >
            <Lock aria-hidden size={15} className="shrink-0" />
            <span className="truncate">{next.label}</span>
          </span>
        ) : (
          <a
            href={next.href}
            data-testid="lesson-next"
            data-variant="end"
            className={cn(LINK, 'text-text hover:text-brand')}
          >
            <span className="truncate">{next.label}</span>
          </a>
        )}
      </span>
    </nav>
  );
}
