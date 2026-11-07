'use client';

import type {
  AdminBranch,
  AdminQuestion,
  AdminStep,
  MemberForm,
} from '@rede-social/contracts/profile-form';
import { BottomSheet, Button, useMediaQuery } from '@rede-social/ui';
import { ListChecks, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type PreviewStatusInfo, ProfileForm } from '@/components/profile-form/ProfileForm';

export interface PreviewSheetProps {
  open: boolean;
  /** The live ACTIVE questions in the admin's order: the definitions, never a member's answer. */
  questions: AdminQuestion[];
  /** The builder's steps in order. */
  steps?: AdminStep[];
  /** The builder's branches (12.2-19, D-651): the preview follows them exactly as the member does. */
  branches?: AdminBranch[];
  onClose: () => void;
}

/**
 * The member form for a first-time viewer, built from the admin's question definitions (12-17, UI-D-580,
 * PU-8; PFORM-23). Nothing is pre-filled (`answer: null`), nothing is flagged (`mode: 'first'`,
 * `missingRequired: 0`) and the option rows carry an id and a label only, so not even an aggregate count
 * reaches the member screen. The `formEtag` is a dummy because a preview never saves.
 */
export function previewForm(
  questions: AdminQuestion[],
  steps: AdminStep[] = [],
  branches: AdminBranch[] = [],
): MemberForm {
  const held = new Set(questions.map((question) => question.stepId));
  // Only ACTIVE branches are handed over, as the Lista and the Fluxo draw them: a question whose branch is
  // archived or unknown reads as unconditional, never as a hidden one. The member shape has no name (T-12.2-03).
  const usable = branches.filter((branch) => branch.archivedAt === null);
  const usableIds = new Set(usable.map((branch) => branch.id));
  return {
    mode: 'first',
    missingRequired: 0,
    formEtag: 'preview',
    steps: steps
      .filter((step) => held.has(step.id))
      .map((step) => ({ id: step.id, title: step.title })),
    branches: usable.map((branch) => ({
      id: branch.id,
      openerQuestionId: branch.openerQuestionId,
      values: [...branch.values],
    })),
    questions: questions.map((question) => ({
      id: question.id,
      type: question.type,
      title: question.title,
      helpText: question.helpText,
      required: question.required,
      showOnProfile: question.showOnProfile,
      allowOther: question.allowOther,
      limits: question.limits,
      stepId: question.stepId,
      branchId:
        question.branchId !== null && usableIds.has(question.branchId) ? question.branchId : null,
      options: question.options.map((option) => ({ id: option.id, label: option.label })),
      answer: null,
    })),
  };
}

/**
 * The status line and the restart (UI-D-652): `role="status"` (polite) so a step that appears or disappears is
 * announced by the new count, and a ghost "Recomeçar" with a 44px target. Both wrap on a 320px screen.
 */
function PreviewStatus({ info }: { info: PreviewStatusInfo }) {
  const t = useTranslations('profileForm.admin.preview');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p
        role="status"
        className="flex min-w-0 flex-1 items-start gap-2 break-words text-xs font-normal text-text-secondary"
      >
        <ListChecks aria-hidden size={16} className="shrink-0" />
        <span className="min-w-0 wrap-anywhere">
          {t('summary', { steps: info.steps, questions: info.questions })}
        </span>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        hitArea
        className="text-text"
        onClick={info.restart}
      >
        <RotateCcw aria-hidden size={16} />
        {t('restart')}
      </Button>
    </div>
  );
}

/**
 * "Como o membro vê" (12-17, UI-D-580): the REAL member form (`ProfileForm`, plan 12) in `preview` mode
 * inside a `BottomSheet` (the centred card from `md`). Every control is live and nothing is ever sent:
 * the form's submit is a no-op in preview, there is no "Salvar", no "Sair" and no destination, and
 * "Fechar" closes at once (a preview has no unsaved work, so no dirty guard). The banner, the required
 * markers, the public notice and the error messages are the member's own, because it is the same
 * component. With two or more steps (`showSteps`) it is the member's stepper (12.1, UI-D-652): "Avançar" works
 * without answers, the last step ends in the outline "Fechar", one more sentence joins the banner, and under it
 * a polite status line counts the steps and questions a member with the preview's answers would see, beside the
 * ghost "Recomeçar" that clears every preview answer. The sheet closes through "Fechar", the backdrop or Escape; the handle is pointer-only, so
 * the screen reader meets exactly one "Fechar".
 */
export function PreviewSheet({ open, questions, steps, branches, onClose }: PreviewSheetProps) {
  const t = useTranslations('profileForm.admin.preview');
  const desktop = useMediaQuery('(min-width: 768px)');

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('title')}
      desktopCard={desktop}
      dismiss="handle"
    >
      <ProfileForm
        form={previewForm(questions, steps, branches)}
        preview
        onClose={onClose}
        previewNote={t('skipNote')}
        previewStatus={(info) => <PreviewStatus info={info} />}
      />
    </BottomSheet>
  );
}
