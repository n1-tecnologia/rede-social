'use client';

import {
  type AdminBranch,
  type AdminQuestion,
  type AdminStep,
  PROFILE_FORM_LIMITS,
} from '@rede-social/contracts/profile-form';
import { Button, EmptyState } from '@rede-social/ui';
import { ClipboardList, Layers, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import type { EditorMode } from './editor-state';
import { PreviewSheet } from './PreviewSheet';
import { QuestionEditorSheet } from './QuestionEditorSheet';
import { QuestionList } from './QuestionList';
import { StepSheet, type StepSheetMode } from './StepSheet';

const NO_STEPS: AdminStep[] = [];

export interface QuestionBuilderProps {
  /** The ACTIVE questions in the order members see them. */
  questions: AdminQuestion[];
  /** The tenant's steps in order. */
  steps?: AdminStep[];
  /** The tenant's branches (12.2-15, D-640); absent reads as none. */
  branches?: AdminBranch[];
  /** The most steps a tenant may have (D-633); defaults to the contract's. */
  stepLimit?: number;
  /** The most active questions a tenant may have. */
  limit: number;
  /** The tenant's display name: the `{tenant}` of the editor's LGPD notice. */
  tenantName: string;
}

interface Opening {
  /** A new key per opening: the sheet remounts, so every opening starts from its source. */
  id: number;
  mode: EditorMode;
  question: AdminQuestion | null;
  /** The step a new question lands in; absent means the last step (D-629). */
  stepId?: string;
}

interface StepOpening {
  id: number;
  mode: StepSheetMode;
  /** The step being renamed; its newest copy is read from `steps` at render, so a refresh brings its revision. */
  step: AdminStep | null;
}

/**
 * The Perguntas tab's interactive body (12-16): the list, or the empty state, and the ONE editor sheet
 * they open. The list's rows open the sheet in edit mode, "Adicionar pergunta" (the list's actions row, or
 * the empty state's call to action) in create mode, and the locked states' "Criar nova pergunta e arquivar
 * esta" in replace mode, and "Ver como o membro vê" opens the preview sheet (12-17) over the live active
 * questions. The page reads on the server; this holds only which
 * opening is showing, and the page refreshes after every write.
 */
export function QuestionBuilder({
  questions,
  steps = NO_STEPS,
  stepLimit = PROFILE_FORM_LIMITS.steps,
  limit,
  tenantName,
}: QuestionBuilderProps) {
  const t = useTranslations('profileForm.admin');
  // `opening` is kept after a close so the sheet's exit animation can play; `open` is what it follows.
  const [opening, setOpening] = useState<Opening | null>(null);
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [stepOpening, setStepOpening] = useState<StepOpening | null>(null);
  const [stepOpen, setStepOpen] = useState(false);

  const openCreate = useCallback(() => {
    setOpening((current) => ({ id: (current?.id ?? 0) + 1, mode: 'create', question: null }));
    setOpen(true);
  }, []);
  const openCreateIn = useCallback((step: AdminStep) => {
    setOpening((current) => ({
      id: (current?.id ?? 0) + 1,
      mode: 'create',
      question: null,
      stepId: step.id,
    }));
    setOpen(true);
  }, []);
  const openAddStep = useCallback(() => {
    setStepOpening((current) => ({ id: (current?.id ?? 0) + 1, mode: 'create', step: null }));
    setStepOpen(true);
  }, []);
  const openRenameStep = useCallback((step: AdminStep) => {
    setStepOpening((current) => ({ id: (current?.id ?? 0) + 1, mode: 'rename', step }));
    setStepOpen(true);
  }, []);
  const closeStep = useCallback(() => setStepOpen(false), []);
  const openEdit = useCallback((question: AdminQuestion) => {
    setOpening((current) => ({ id: (current?.id ?? 0) + 1, mode: 'edit', question }));
    setOpen(true);
  }, []);
  const openReplace = useCallback((question: AdminQuestion) => {
    setOpening((current) => ({ id: (current?.id ?? 0) + 1, mode: 'replace', question }));
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const openPreview = useCallback(() => setPreviewOpen(true), []);
  const closePreview = useCallback(() => setPreviewOpen(false), []);

  // A form with no question keeps Phase 12's empty state, unless it already has two or more steps: then
  // the (empty) wells are the screen, because they are where the admin adds the first question.
  const showList = questions.length > 0 || steps.length > 1;
  // The step being renamed, in its newest copy, and what the sheet needs to know about it.
  const renamed =
    stepOpening?.mode === 'rename'
      ? (steps.find((step) => step.id === stepOpening.step?.id) ?? stepOpening.step)
      : null;
  const renamedCount = renamed
    ? questions.filter((question) => question.stepId === renamed.id).length
    : 0;

  return (
    <>
      {showList ? (
        <QuestionList
          questions={questions}
          steps={steps}
          stepLimit={stepLimit}
          limit={limit}
          onOpen={openEdit}
          onAdd={openCreate}
          onAddStep={openAddStep}
          onRenameStep={openRenameStep}
          onAddToStep={openCreateIn}
          onPreview={openPreview}
        />
      ) : (
        <EmptyState
          variant="card"
          icon={ClipboardList}
          title={t('empty.title')}
          body={t('empty.body')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button size="md" onClick={openCreate}>
                <Plus aria-hidden size={18} />
                {t('actions.add')}
              </Button>
              <Button variant="outline" size="md" onClick={openAddStep}>
                <Layers aria-hidden size={18} />
                {t('steps.add')}
              </Button>
            </div>
          }
        />
      )}
      {opening ? (
        <QuestionEditorSheet
          key={opening.id}
          open={open}
          mode={opening.mode}
          question={opening.question}
          stepId={opening.stepId}
          questions={questions}
          steps={steps}
          tenantName={tenantName}
          limit={limit}
          onClose={close}
          onReplace={openReplace}
        />
      ) : null}
      {stepOpening ? (
        <StepSheet
          key={stepOpening.id}
          open={stepOpen}
          mode={stepOpening.mode}
          step={renamed}
          questionCount={renamedCount}
          stepCount={steps.length}
          onClose={closeStep}
        />
      ) : null}
      <PreviewSheet open={previewOpen} questions={questions} steps={steps} onClose={closePreview} />
    </>
  );
}
