'use client';

import { buttonClasses, cn } from '@rede-social/ui';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import type { LessonNavView } from '@/lib/courses-member-view';
import { useLessonSession } from './LessonSession';

/**
 * The player's previous and next (08.5-08, UI-D-432, UI-D-443), `grid grid-cols-2 gap-3 px-4 pt-6`:
 *
 *  - left: the `outline` LINK "Aula anterior" (`ChevronLeft` 16), or an `aria-disabled` span at
 *    `opacity-40` when there is no previous open lesson;
 *  - right, open next: the LINK "Próxima aula" (`ChevronRight` 16) — **brand only once this lesson
 *    is complete**, `outline` before, so the player shows exactly one brand fill and it moves from
 *    "Marcar como concluída" to here as the lesson completes;
 *  - right, locked next: a non-interactive span in `outline` geometry, `text-text-tertiary`, with
 *    `Lock` 16 and the reason in words ("Conclua esta aula", "Conclua o módulo", "Aula exclusiva");
 *  - right, no next: the `outline` LINK "Voltar para o curso".
 *
 * Client only to read the session's completion (the brand swap is instant; the refresh that follows
 * re-reads the next lesson's lock from the server). Every word and href arrives from `lessonNavView`,
 * which labels the server's `lockReason` — this component never decides a lock.
 */
export interface LessonNavProps {
  nav: LessonNavView;
}

/** The links' look, from `buttonClasses` (`md` geometry, tighter `px-3` and `gap-1.5`). */
const NAV_LINK = 'min-w-0 gap-1.5 px-3';
const OUTLINE = buttonClasses({
  variant: 'outline',
  size: 'md',
  fullWidth: true,
  className: NAV_LINK,
});
const BRAND = buttonClasses({ variant: 'brand', size: 'md', fullWidth: true, className: NAV_LINK });
/** The two non-interactive `<span>` states: the outline geometry with no hover, active or focus. */
const STATIC =
  'inline-flex h-11 w-full min-w-0 items-center justify-center gap-1.5 rounded-xl border border-border-secondary px-3 text-sm font-bold';

export function LessonNav({ nav }: LessonNavProps) {
  const { completed } = useLessonSession();
  const { next } = nav;

  return (
    <nav data-testid="lesson-nav" className="grid grid-cols-2 gap-3 px-4 pt-6">
      {nav.previousHref ? (
        <a href={nav.previousHref} data-testid="lesson-previous" className={OUTLINE}>
          <ChevronLeft aria-hidden size={16} className="shrink-0" />
          <span className="truncate">{nav.previousLabel}</span>
        </a>
      ) : (
        <span
          aria-disabled="true"
          data-testid="lesson-previous"
          data-state="disabled"
          className={cn(STATIC, 'text-text opacity-40')}
        >
          <ChevronLeft aria-hidden size={16} className="shrink-0" />
          <span className="truncate">{nav.previousLabel}</span>
        </span>
      )}

      {next.kind === 'open' ? (
        <a
          href={next.href}
          data-testid="lesson-next"
          data-variant={completed ? 'brand' : 'outline'}
          className={completed ? BRAND : OUTLINE}
        >
          <span className="truncate">{next.label}</span>
          <ChevronRight aria-hidden size={16} className="shrink-0" />
        </a>
      ) : next.kind === 'locked' ? (
        <span
          data-testid="lesson-next"
          data-variant="locked"
          className={cn(STATIC, 'text-text-tertiary')}
        >
          <Lock aria-hidden size={16} className="shrink-0" />
          <span className="truncate">{next.label}</span>
        </span>
      ) : (
        <a href={next.href} data-testid="lesson-next" data-variant="end" className={OUTLINE}>
          <span className="truncate">{next.label}</span>
        </a>
      )}
    </nav>
  );
}
