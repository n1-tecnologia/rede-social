'use client';

import { cn } from '@rede-social/ui';
import { ChevronDown, CircleCheck, Lock, Play } from 'lucide-react';
import { useId, useState } from 'react';
import type { LessonOutlineView } from '@/lib/courses-member-view';

/**
 * The player's side list (2026-10-26, the academy reference's player; the user's "swap completo"):
 * the WHOLE course beside the video, as the reference draws it.
 *
 *  - a 2px band at the top: the course's share;
 *  - every module as a disclosure (its bare number, its title, "{done}/{N} aulas" and a chevron),
 *    the open lesson's module open on arrival, the others a tap away;
 *  - every lesson a link (a locked one too: its page says why, UI-D-431) with a disc: the success
 *    check (complete), the padlock (held), else the play glyph, brand-filled on the open lesson; a
 *    lesson begun shows its resume share under the title; the open one sits on a brand-tinted card
 *    (`aria-current="page"`).
 *
 * Every word, href and state comes from `lessonOutlineView` (the server's locks and numbers): this
 * component decides nothing. Client only for the disclosures.
 */
export function LessonOutline({
  outline,
  label,
}: {
  outline: LessonOutlineView;
  /** The list's accessible name ("Conteúdo do curso"). */
  label: string;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(outline.currentModuleId ? [outline.currentModuleId] : []),
  );
  const baseId = useId();
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const share = Math.min(100, Math.max(0, outline.coursePercent));

  return (
    <nav
      aria-label={label}
      data-testid="lesson-module-list"
      className="ms-panel flex flex-col overflow-hidden rounded-3xl border border-border bg-card lg:max-h-[calc(var(--screen-h)-8rem)]"
    >
      <span
        role="progressbar"
        aria-valuenow={share}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={outline.coursePercentLabel}
        className="ms-bar-track block h-1 shrink-0 bg-bg-tertiary"
        data-size="sm"
      >
        <span className="ms-bar block h-full bg-brand" style={{ width: `${share}%` }} />
      </span>

      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {outline.modules.map((module) => {
          const expanded = open.has(module.id);
          const listId = `${baseId}-${module.id}`;
          return (
            <section key={module.id} data-testid="lesson-outline-module" data-module-id={module.id}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => toggle(module.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <span
                  aria-hidden
                  className="w-5 shrink-0 text-center text-lg font-semibold leading-none text-text-tertiary tabular-nums"
                >
                  {module.number}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="ms-title-font truncate text-sm font-semibold uppercase tracking-wide text-text">
                    {module.title}
                  </span>
                  <span className="text-xs font-normal text-text-tertiary tabular-nums">
                    {module.meta}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden
                  size={18}
                  className={cn(
                    'shrink-0 text-text-tertiary transition-transform motion-reduce:transition-none',
                    expanded && 'rotate-180',
                  )}
                />
              </button>
              {expanded ? (
                <ol
                  id={listId}
                  aria-label={module.title}
                  className="flex flex-col gap-0.5 px-2 pb-2"
                >
                  {module.lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <a
                        href={lesson.href}
                        aria-label={lesson.ariaLabel}
                        aria-current={lesson.current ? 'page' : undefined}
                        data-testid="member-lesson-row"
                        data-lesson-id={lesson.id}
                        data-current={lesson.current ? 'true' : undefined}
                        data-trailing={
                          lesson.state === 'done'
                            ? 'done'
                            : lesson.state === 'locked'
                              ? 'locked'
                              : 'chevron'
                        }
                        className={cn(
                          'flex min-h-12 items-center gap-3 rounded-xl border px-2.5 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
                          lesson.current
                            ? 'border-brand/40 bg-brand/[0.07]'
                            : 'border-transparent hover:bg-bg-hover',
                        )}
                      >
                        <OutlineDisc state={lesson.state} current={lesson.current} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span
                            data-testid="member-lesson-title"
                            className={cn(
                              'truncate text-sm leading-snug',
                              lesson.current ? 'font-semibold text-text' : 'text-text-secondary',
                            )}
                          >
                            {lesson.title}
                          </span>
                          {lesson.state === 'progress' && lesson.percent > 0 ? (
                            <span aria-hidden className="mt-1.5 flex items-center gap-2">
                              <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
                                <span
                                  className="block h-full rounded-full bg-brand"
                                  style={{ width: `${Math.min(100, lesson.percent)}%` }}
                                />
                              </span>
                              <span className="shrink-0 text-[10px] font-semibold text-text-tertiary tabular-nums">
                                {`${Math.min(100, lesson.percent)}%`}
                              </span>
                            </span>
                          ) : null}
                        </span>
                        {lesson.state === 'done' ? (
                          <CircleCheck aria-hidden size={18} className="shrink-0 text-success" />
                        ) : null}
                      </a>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          );
        })}
      </div>
    </nav>
  );
}

/** The row's disc: the success check, the padlock, or play (brand-filled on the open lesson). */
function OutlineDisc({ state, current }: { state: string; current: boolean }) {
  if (state === 'done') {
    return (
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
      >
        <CircleCheck size={16} />
      </span>
    );
  }
  if (state === 'locked') {
    return (
      <span
        aria-hidden
        className="ms-chip-surface flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-tertiary"
      >
        <Lock size={13} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
        current
          ? 'bg-brand text-on-brand ring-4 ring-brand/15'
          : 'ms-chip-surface bg-bg-tertiary text-text-secondary',
      )}
    >
      <Play size={12} fill="currentColor" className="ml-0.5" />
    </span>
  );
}
