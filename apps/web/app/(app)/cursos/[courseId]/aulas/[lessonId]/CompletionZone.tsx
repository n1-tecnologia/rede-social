'use client';

import { ProgressBar } from '@rede-social/module-courses/ui';
import { Button, useToast } from '@rede-social/ui';
import { Check, CircleCheck } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { completeLessonAction } from '@/app/(app)/cursos/learn-actions';
import { useLessonSession } from './LessonSession';

/**
 * The player's completion zone (08.5-08, UI-D-432, UI-D-433, D-427, D-430):
 *
 *  - not complete → the brand `fullWidth` BUTTON "Marcar como concluída" (`Check` 18), pending
 *    "Marcando…" and disabled while the write runs;
 *  - complete → the done block, the store's owned-block family (`rounded-xl bg-success/10`,
 *    `CircleCheck` 20 `text-success`, "Aula concluída" 14/700). It is NOT interactive: completion is
 *    one-way and there is no "desmarcar";
 *  - with either, the module bar: `ProgressBar h-2` and "Módulo {nn} · {done} de {total} aulas
 *    concluídas" (the server's numbers; the refresh after a completion re-reads them).
 *
 * The button's answer: a set `completedAt` → the session's one-way swap ("Aula concluída." toast,
 * `router.refresh()`), with focus moved to the done block ONLY when the button had focus (UI-D-443);
 * a lock or removal → the session's UI-D-433 reaction; anything else → the toast "Não foi possível
 * marcar a aula como concluída. Tente novamente." and the button is enabled again.
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).** The swap is animated
 * like the prototype's: the button fades and drops out, then the done block fades and rises in (0.15 s
 * each, `motion/react`, instant under "reduzir movimento"); the focus request is kept until the done
 * block has MOUNTED, so it still lands there after the exit. The module bar fills in on its own.
 *
 * The host renders this zone only outside the admin's preview (D-422, UI-D-437).
 *
 * **2026-10-26 (the academy reference's player).** One panel across the lesson column: from `sm` the
 * button (or the done block) at the left, 256px, and the module bar beside it; on a phone one under
 * the other, as before.
 */
export interface CompletionZoneProps {
  lessonId: string;
  moduleBar: { percent: number; progressLabel: string; line: string };
}

/** The done block; it takes the focus on mount when the button that completed the lesson had it. */
function DoneBlock({ focus, label }: { focus: boolean; label: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-testid="lesson-done"
      className="flex min-h-11 items-center justify-center gap-2.5 rounded-xl bg-success/10 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <CircleCheck aria-hidden size={20} className="shrink-0 text-success" />
      <span className="text-sm font-bold text-text">{label}</span>
    </div>
  );
}

export function CompletionZone({ lessonId, moduleBar }: CompletionZoneProps) {
  const t = useTranslations('courses.member.player');
  const toast = useToast();
  const session = useLessonSession();
  const reduce = useReducedMotion();
  const [pending, setPending] = useState(false);
  const [focusDone, setFocusDone] = useState(false);

  useEffect(() => {
    if (session.completed && session.consumeFocusRequest()) setFocusDone(true);
  }, [session]);

  async function complete(button: HTMLButtonElement) {
    const hadFocus = document.activeElement === button;
    setPending(true);
    try {
      const result = await completeLessonAction(lessonId);
      if (result.ok && result.completedAt !== null) {
        session.markCompleted({ focusDone: hadFocus });
        return;
      }
      if (!result.ok && session.refuse(result.code)) return;
      toast.show({ tone: 'error', message: t('errors.complete') });
    } catch {
      toast.show({ tone: 'error', message: t('errors.complete') });
    } finally {
      setPending(false);
    }
  }

  const swap = {
    initial: reduce ? false : ({ opacity: 0, y: 4 } as const),
    animate: { opacity: 1, y: 0 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: -4 },
    transition: { duration: reduce ? 0 : 0.15 },
  };

  return (
    <div data-testid="lesson-completion" className="flex flex-col">
      <div className="ms-panel flex flex-col gap-4 rounded-3xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-6 md:p-5">
        <div className="sm:w-64 sm:shrink-0">
          <AnimatePresence mode="wait" initial={false}>
            {session.completed ? (
              <motion.div key="done" {...swap}>
                <DoneBlock focus={focusDone} label={t('done')} />
              </motion.div>
            ) : (
              <motion.div key="complete" {...swap}>
                <Button
                  variant="brand"
                  size="md"
                  fullWidth
                  loading={pending}
                  data-testid="lesson-complete"
                  onClick={(event) => void complete(event.currentTarget)}
                >
                  {pending ? null : <Check aria-hidden size={18} />}
                  {pending ? t('completing') : t('complete')}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <ProgressBar percent={moduleBar.percent} label={moduleBar.progressLabel} size="md" />
          <p
            data-testid="lesson-module-progress"
            className="mt-1.5 text-xs font-normal text-text-secondary tabular-nums"
          >
            {moduleBar.line}
          </p>
        </div>
      </div>
    </div>
  );
}
