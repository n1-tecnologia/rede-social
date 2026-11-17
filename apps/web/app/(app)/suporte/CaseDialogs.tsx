'use client';

import { ConfirmDialog } from '@rede-social/ui';
import { CircleCheck, Lock, RotateCcw, UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import type { CaseDialogRequest } from './useCaseActions';

/**
 * The four confirm dialogs of the team's case bar (UI-D-827) [designed]: resolve (brand), close (the ONE
 * danger-toned dialog, it cannot be undone), reopen (brand) and the take-over of a live owner (brand). They
 * are the shipped `ConfirmDialog`: centred, a pending state on the confirm button, closed by the dialog
 * itself when `onConfirm` settles. Only the dialog of the request that is open is shown; every word is the
 * `chat` catalog's and the owner's name is a React text node inside the catalog sentence.
 *
 * Focus returns to the control that opened the dialog through the shipped focus trap; the bar hands the
 * opener back when it is no longer in the document (a menu row that closed with its sheet).
 */

export interface CaseDialogsProps {
  /** The request that is open, or `null`. */
  dialog: CaseDialogRequest | null;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function CaseDialogs({ dialog, onConfirm, onClose }: CaseDialogsProps) {
  const t = useTranslations('chat');
  // The last request keeps its words while the dialog animates out, so the title never flashes empty.
  const last = useRef<CaseDialogRequest | null>(null);
  if (dialog) last.current = dialog;
  const shown = dialog ?? last.current;
  const number = String(shown?.number ?? '');
  const cancelLabel = t('dialog.cancel');
  const is = (kind: CaseDialogRequest['kind']) => dialog?.kind === kind;

  return (
    <>
      <ConfirmDialog
        open={is('resolve')}
        icon={CircleCheck}
        title={t('dialog.resolve.title', { number })}
        body={t('dialog.resolve.body')}
        confirmLabel={t('dialog.resolve.confirm')}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        onClose={onClose}
      />
      <ConfirmDialog
        open={is('close')}
        icon={Lock}
        tone="danger"
        title={t('dialog.close.title', { number })}
        body={t('dialog.close.body')}
        confirmLabel={t('dialog.close.confirm')}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        onClose={onClose}
      />
      <ConfirmDialog
        open={is('reopen')}
        icon={RotateCcw}
        title={t('dialog.reopen.title', { number })}
        body={t('dialog.reopen.body')}
        confirmLabel={t('dialog.reopen.confirm')}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        onClose={onClose}
      />
      <ConfirmDialog
        open={is('take')}
        icon={UserCheck}
        title={t('dialog.take.title', { number })}
        body={t('dialog.take.body', { name: shown?.ownerName ?? '' })}
        confirmLabel={t('dialog.take.confirm')}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </>
  );
}
