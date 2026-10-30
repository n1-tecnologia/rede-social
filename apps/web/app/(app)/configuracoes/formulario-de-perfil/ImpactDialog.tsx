'use client';

import { ConfirmDialog } from '@rede-social/ui';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Which change reopens the form: the title and the confirm label follow it (UI-D-576). */
export type ImpactKind = 'add' | 'make' | 'reactivate' | 'replace';

export interface ImpactDialogProps {
  open: boolean;
  kind: ImpactKind;
  /** How many members the change will ask to answer: the server's count, read before this dialog opens. */
  members: number;
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
 * guardadas continuam valendo." Plan 16 reuses the dialog for the other three kinds.
 */
export function ImpactDialog({ open, kind, members, onConfirm, onClose }: ImpactDialogProps) {
  const t = useTranslations('profileForm.admin.impact');
  const body = t('body', { n: members });
  return (
    <ConfirmDialog
      open={open}
      tone="brand"
      icon={Users}
      title={t(`${kind}Title`)}
      body={kind === 'reactivate' ? `${body} ${t('kept')}` : body}
      confirmLabel={t(`${kind}Confirm`)}
      cancelLabel={t('cancel')}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
