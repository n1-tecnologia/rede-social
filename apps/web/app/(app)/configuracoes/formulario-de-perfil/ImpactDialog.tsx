'use client';

import { ConfirmDialog } from '@rede-social/ui';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Which change reopens the form: the title and the confirm label follow it (UI-D-576). `unconditional` is the
 * removal of the condition of a required question (12.1-17, D-634, UI-D-649): it has its own title and body.
 */
export type ImpactKind =
  | 'add'
  | 'make'
  | 'reactivate'
  | 'reactivateBranch'
  | 'replace'
  | 'unconditional';

export interface ImpactDialogProps {
  open: boolean;
  kind: ImpactKind;
  /** How many members the change will ask to answer: the server's count, read before this dialog opens. */
  members: number;
  /** A sentence added after the impact one (replace: which question is archived). */
  note?: string;
  /**
   * "Só conta quem vê esta pergunta: quem respondeu “{opener}” com {options}." for a required CONDITIONAL question
   * (12.1-17, UI-D-649): the count is of who sees it, and the dialog says so in its last sentence.
   */
  branchNote?: string;
  /** The write. While it runs both buttons are disabled; the dialog closes when it settles. */
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/**
 * "N membros vão precisar responder" (12-15, D-585, UI-D-576): the shipped `ConfirmDialog` in the brand
 * tone with the `Users` icon, in front of any write that REOPENS the form. The screen reads the impact
 * first (`readImpactAction`), opens this only when the count is above zero, and writes only when the read
 * succeeded; with 0 members there is no dialog and the write is direct.
 *
 * The body is the plural sentence of the Copywriting Contract; reactivating a question adds "As respostas
 * guardadas continuam valendo." Replace adds which question is archived (`note`). The editor sheet (12-16)
 * reuses the dialog for the add, make and replace cases. A required CONDITIONAL question ends its body with the
 * `branchNote`; removing the condition of a required question is the `unconditional` case.
 */
export function ImpactDialog({
  open,
  kind,
  members,
  note,
  branchNote,
  onConfirm,
  onClose,
}: ImpactDialogProps) {
  const t = useTranslations('profileForm.admin.impact');
  // A block of questions that comes back with its branch reads like one question coming back (12.2-18, D-653).
  const base = kind === 'reactivateBranch' ? 'reactivate' : kind;
  const body = t(kind === 'unconditional' ? 'unconditionalBody' : 'body', { n: members });
  const text = [body, base === 'reactivate' ? t('kept') : note, branchNote]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ');
  return (
    <ConfirmDialog
      open={open}
      tone="brand"
      icon={Users}
      title={t(`${base}Title`)}
      body={text}
      confirmLabel={t(`${base}Confirm`)}
      cancelLabel={t('cancel')}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
