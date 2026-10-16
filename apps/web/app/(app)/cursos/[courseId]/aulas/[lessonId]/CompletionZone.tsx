'use client';

import { ProgressBar } from '@rede-social/module-courses/ui';
import { Button, useToast } from '@rede-social/ui';
import { Check, CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { completeLessonAction } from '@/app/(app)/cursos/learn-actions';
import { useLessonSession } from './LessonSession';

/**
 * The player's completion zone (08.5-08, UI-D-432, UI-D-433, D-427, D-430), `px-4 pt-4`:
 *
 *  - not complete → the brand `fullWidth` BUTTON "Marcar como concluída" (`Check` 18), pending
 *    "Marcando…" and disabled while the write runs;
 *  - complete → the done block, the store's owned-block family (`rounded-xl bg-success/10`,
 *    `CircleCheck` 20 `text-success`, "Aula concluída" 14/700). It is NOT interactive: completion is
 *    one-way and there is no "desmarcar";
 *  - under either, the module bar: `ProgressBar h-2 mt-4` and "Módulo {nn} · {done} de {total} aulas
 *    concluídas" (the server's numbers; the refresh after a completion re-reads them).
 *
 * The button's answer: a set `completedAt` → the session's one-way swap ("Aula concluída." toast,
 * `router.refresh()`), with focus moved to the done block ONLY when the button had focus (UI-D-443);
 * a lock or removal → the session's UI-D-433 reaction; anything else → the toast "Não foi possível
 * marcar a aula como concluída. Tente novamente." and the button is enabled again.
 *
 * The host renders this zone only outside the admin's preview (D-422, UI-D-437).
 */
export interface CompletionZoneProps {
  lessonId: string;
  moduleBar: { percent: number; progressLabel: string; line: string };
}

export function CompletionZone({ lessonId, moduleBar }: CompletionZoneProps) {
  const t = useTranslations('courses.member.player');
  const toast = useToast();
  const session = useLessonSession();
  const [pending, setPending] = useState(false);
  const doneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (session.completed && session.consumeFocusRequest()) doneRef.current?.focus();
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

  return (
    <div data-testid="lesson-completion" className="flex flex-col px-4 pt-4">
      {session.completed ? (
        <div
          ref={doneRef}
          tabIndex={-1}
          data-testid="lesson-done"
          className="flex items-center gap-3 rounded-xl bg-success/10 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <CircleCheck aria-hidden size={20} className="shrink-0 text-success" />
          <span className="text-sm font-bold text-text">{t('done')}</span>
        </div>
      ) : (
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
      )}
      <ProgressBar
        percent={moduleBar.percent}
        label={moduleBar.progressLabel}
        size="md"
        className="mt-4"
      />
      <p
        data-testid="lesson-module-progress"
        className="mt-2 text-xs font-normal text-text-secondary tabular-nums"
      >
        {moduleBar.line}
      </p>
    </div>
  );
}
