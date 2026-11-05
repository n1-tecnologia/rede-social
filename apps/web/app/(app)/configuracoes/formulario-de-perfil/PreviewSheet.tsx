'use client';

import type { AdminQuestion, AdminStep, MemberForm } from '@rede-social/contracts/profile-form';
import { BottomSheet, useMediaQuery } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { ProfileForm } from '@/components/profile-form/ProfileForm';

export interface PreviewSheetProps {
  open: boolean;
  /** The live ACTIVE questions in the admin's order: the definitions, never a member's answer. */
  questions: AdminQuestion[];
  /** The builder's steps in order. */
  steps?: AdminStep[];
  onClose: () => void;
}

/**
 * The member form for a first-time viewer, built from the admin's question definitions (12-17, UI-D-580,
 * PU-8; PFORM-23). Nothing is pre-filled (`answer: null`), nothing is flagged (`mode: 'first'`,
 * `missingRequired: 0`) and the option rows carry an id and a label only, so not even an aggregate count
 * reaches the member screen. The `formEtag` is a dummy because a preview never saves.
 */
export function previewForm(questions: AdminQuestion[], steps: AdminStep[] = []): MemberForm {
  const held = new Set(questions.map((question) => question.stepId));
  return {
    mode: 'first',
    missingRequired: 0,
    formEtag: 'preview',
    steps: steps
      .filter((step) => held.has(step.id))
      .map((step) => ({ id: step.id, title: step.title })),
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
      condition: question.condition,
      options: question.options.map((option) => ({ id: option.id, label: option.label })),
      answer: null,
    })),
  };
}

/**
 * "Como o membro vê" (12-17, UI-D-580): the REAL member form (`ProfileForm`, plan 12) in `preview` mode
 * inside a `BottomSheet` (the centred card from `md`). Every control is live and nothing is ever sent:
 * the form's submit is a no-op in preview, there is no "Salvar", no "Sair" and no destination, and
 * "Fechar" closes at once (a preview has no unsaved work, so no dirty guard). The banner, the required
 * markers, the public notice and the error messages are the member's own, because it is the same
 * component. The sheet closes through "Fechar", the backdrop or Escape; the handle is pointer-only, so
 * the screen reader meets exactly one "Fechar".
 */
export function PreviewSheet({ open, questions, steps, onClose }: PreviewSheetProps) {
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
      <ProfileForm form={previewForm(questions, steps)} preview onClose={onClose} />
    </BottomSheet>
  );
}
