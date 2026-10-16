'use client';

import { ProgressBar } from '@rede-social/module-courses/ui';
import { CircleCheck } from 'lucide-react';
import type { CourseActionView } from '@/lib/courses-member-view';

/**
 * The member course page's action zone (08.5-07, UI-D-427, D-430, EP-11, EP-13).
 *
 * **Open course** — the three progress variants, every number the API's:
 *  - `start` (0%) → "{N} aulas · {duration}" 14/400 secondary, then the brand `fullWidth` LINK
 *    "Começar o curso" to `nextLessonId`;
 *  - `continue` (1–99%) → the `h-2` `ProgressBar`, "{percent}% concluído · {done} de {total} aulas
 *    concluídas" 12/400, then "Continuar o curso" — absent when no open lesson is next;
 *  - `done` (100%) → `CircleCheck` + "Curso concluído · {total} de {total} aulas", then the OUTLINE
 *    "Rever o curso" to the first lesson (no brand fill at 100%).
 * A course with no live lesson renders nothing here (`action: null`, EP-13).
 *
 * Links, not buttons: each action is a route (UI-D-443). Every string arrives finished from the
 * server (`courseActionView`).
 */
export interface CourseActionZoneProps {
  action: CourseActionView | null;
}

/** The brand fill as a LINK (the shipped `Button` is a `<button>`, and a lesson is a route). */
const BRAND_LINK =
  'inline-flex h-11 w-full items-center justify-center rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const OUTLINE_LINK =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function CourseActionZone({ action }: CourseActionZoneProps) {
  if (!action) return null;

  if (action.variant === 'start') {
    return (
      <div data-testid="course-action" data-variant="start" className="flex flex-col gap-3">
        <p
          data-testid="course-action-line"
          className="text-sm font-normal text-text-secondary tabular-nums"
        >
          {action.line}
        </p>
        {action.href ? (
          <a href={action.href} data-testid="course-action-cta" className={BRAND_LINK}>
            {action.label}
          </a>
        ) : null}
      </div>
    );
  }

  if (action.variant === 'continue') {
    return (
      <div data-testid="course-action" data-variant="continue" className="flex flex-col">
        <ProgressBar percent={action.percent} label={action.progressLabel} size="md" />
        <p
          data-testid="course-action-line"
          className="mt-2 text-xs font-normal text-text-secondary tabular-nums"
        >
          {action.line}
        </p>
        {action.href ? (
          <a href={action.href} data-testid="course-action-cta" className={`mt-3 ${BRAND_LINK}`}>
            {action.label}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid="course-action" data-variant="done" className="flex flex-col gap-3">
      <p
        data-testid="course-action-line"
        className="flex items-center gap-2 text-sm font-normal text-text-secondary tabular-nums"
      >
        <CircleCheck aria-hidden size={16} className="shrink-0 text-success" />
        <span className="min-w-0">{action.line}</span>
      </p>
      {action.href ? (
        <a href={action.href} data-testid="course-action-cta" className={`w-full ${OUTLINE_LINK}`}>
          {action.label}
        </a>
      ) : null}
    </div>
  );
}
