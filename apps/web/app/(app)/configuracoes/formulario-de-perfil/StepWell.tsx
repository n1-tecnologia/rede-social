'use client';

import type { AdminStep } from '@rede-social/contracts/profile-form';
import { Button, IconButton } from '@rede-social/ui';
import { ArrowDown, ArrowUp, Layers, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';

export interface StepWellProps {
  step: AdminStep;
  /** The step's place, 1..total: the eyebrow "Etapa {n}". */
  number: number;
  total: number;
  /** How many ACTIVE questions the well holds right now (the meta line and the empty state). */
  count: number;
  /** In reorder mode the rename button is replaced by the two arrows (UI-D-646). */
  reordering: boolean;
  /** A write is in flight: the arrows ignore presses and stay focusable (`aria-busy`). */
  busy: boolean;
  /** The 30-question ceiling: the footer "Adicionar pergunta" is disabled (UI-D-644). */
  addDisabled: boolean;
  onRename: (step: AdminStep) => void;
  onAddQuestion: (step: AdminStep) => void;
  onMove: (stepId: string, delta: -1 | 1) => void;
  register: (key: string, element: HTMLButtonElement | null) => void;
  /** The `ul` of question rows; absent when the step is empty. */
  children?: ReactNode;
}

/**
 * One step of the builder (12.1-16, D-627, UI-D-642, UI-D-643, UI-D-646): a tinted well (`bg-bg-tertiary`)
 * that holds the white question cards of Phase 12 unchanged. A `section` labelled by its title, a header
 * (eyebrow "Etapa {n}", the title, the meta line and, outside reorder mode, the rename button; inside it the
 * two arrows), the rows, and a ghost footer that adds a question to THIS step. An empty step shows its own
 * line instead of rows and is never collapsed. The title is the admin's text: React text only, wrapped and
 * clamped to two lines (T-12.1-12).
 */
export function StepWell({
  step,
  number,
  total,
  count,
  reordering,
  busy,
  addDisabled,
  onRename,
  onAddQuestion,
  onMove,
  register,
  children,
}: StepWellProps) {
  const t = useTranslations('profileForm.admin.steps');
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl bg-bg-tertiary p-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-bold text-text-tertiary">
            {t('eyebrow', { n: number })}
          </span>
          <h3 id={titleId} className="line-clamp-2 break-words text-sm font-bold text-text">
            {step.title}
          </h3>
          <span className="text-xs font-normal text-text-secondary">{t('count', { count })}</span>
        </div>
        <div className="-mr-2 -mt-2 flex shrink-0">
          {reordering ? (
            <>
              <IconButton
                ref={(element) => register(`step:${step.id}:up`, element)}
                icon={ArrowUp}
                size={18}
                label={t('reorder.up', { title: step.title })}
                disabled={number === 1}
                aria-busy={busy || undefined}
                onClick={() => onMove(step.id, -1)}
              />
              <IconButton
                ref={(element) => register(`step:${step.id}:down`, element)}
                icon={ArrowDown}
                size={18}
                label={t('reorder.down', { title: step.title })}
                disabled={number === total}
                aria-busy={busy || undefined}
                onClick={() => onMove(step.id, 1)}
              />
            </>
          ) : (
            <IconButton
              icon={Pencil}
              size={18}
              label={t('rename', { title: step.title })}
              onClick={() => onRename(step)}
            />
          )}
        </div>
      </div>

      {count > 0 ? (
        children
      ) : (
        <p
          data-step-empty
          className="flex items-start gap-2 text-xs font-normal text-text-tertiary"
        >
          <Layers aria-hidden size={16} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">{t('empty')}</span>
        </p>
      )}

      <div className="flex">
        <Button
          variant="ghost"
          size="sm"
          hitArea
          disabled={addDisabled}
          aria-label={t('addQuestionLabel', { title: step.title })}
          onClick={() => onAddQuestion(step)}
        >
          <Plus aria-hidden size={16} />
          {t('addQuestion')}
        </Button>
      </div>
    </section>
  );
}
