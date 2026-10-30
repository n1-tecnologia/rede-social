'use client';

import { ConfirmDialog } from '@rede-social/ui';
import { Archive, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type ArchiveKind = 'archive' | 'delete';

export interface ArchiveDialogProps {
  open: boolean;
  /** `archive` for a question with answers, `delete` for one nobody ever answered (D-588). */
  kind: ArchiveKind;
  /** How many answers the archived question keeps: the plural sentence of the archive body. */
  answerCount: number;
  /** A required question adds "Quem ainda não respondeu deixa de precisar." to the archive body. */
  required: boolean;
  /** The write. While it runs both buttons are disabled; the dialog closes when it settles. */
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/**
 * The two confirmations in front of removing a question from the form (12-16, D-588, UI-D-577). **Archive**
 * (brand tone, `Archive`) keeps every answer and frees the members who were held by it, so it needs no
 * impact count: it says how many answers are kept and, for a required question, that nobody is held any
 * more. **Delete** (danger tone, `Trash2`) is only offered for a question nobody ever answered and cannot
 * be undone. The shipped `ConfirmDialog` does the rest: pending state, both buttons disabled, focus trap.
 */
export function ArchiveDialog({
  open,
  kind,
  answerCount,
  required,
  onConfirm,
  onClose,
}: ArchiveDialogProps) {
  const t = useTranslations('profileForm.admin');

  if (kind === 'delete') {
    return (
      <ConfirmDialog
        open={open}
        tone="danger"
        icon={Trash2}
        title={t('delete.title')}
        body={t('delete.body')}
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('delete.cancel')}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
  }

  const body = t('archive.body', { n: answerCount });
  return (
    <ConfirmDialog
      open={open}
      tone="brand"
      icon={Archive}
      title={t('archive.title')}
      body={required ? `${body} ${t('archive.requiredNote')}` : body}
      confirmLabel={t('archive.confirm')}
      cancelLabel={t('archive.cancel')}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
