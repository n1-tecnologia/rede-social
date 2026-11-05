'use client';

import { ConfirmDialog } from '@rede-social/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** More titles than this collapse into "e mais {count}" (UI-D-656). */
export const ERASE_LIST_LIMIT = 5;

export interface EraseAnswersDialogProps {
  open: boolean;
  /** `advance` is "Avançar" ("Apagar e continuar"); `save` is "Concluir" and "Salvar" ("Apagar e salvar"). */
  kind: 'advance' | 'save';
  /** The TITLES of the questions whose stored answer the save will delete. Never an answer (T-12.1-11). */
  titles: readonly string[];
  /** The confirmed save is running: the confirm button reads "Salvando…" (FA-UI-1). */
  pending?: boolean;
  /** The confirmed save. The dialog stays open, both buttons disabled and undismissible, until it settles. */
  onConfirm: () => Promise<void> | void;
  /** "Rever respostas", and the close after the save settles. Nothing is saved by this path. */
  onClose: () => void;
}

/**
 * The warning before answers are deleted (12.1-15, D-624, D-626, D-636; UI-D-656). A thin wrapper over the
 * shipped `ConfirmDialog`: danger tone, the `Trash2` icon and the capped scrolling body, so the title and both buttons
 * stay on screen at 320px however long the list is. The body is the ICU plural for one or many closed
 * questions, the `children` slot a plain list of the closed questions' TITLES (up to five, then "e mais
 * {count}") and the tertiary line that says going back means answering again.
 *
 * It holds titles and counts only: a member's answer value is never drawn here (UI-D-598, T-12.1-11), and
 * every title is React text (T-12.1-12). The list is what THIS tab's form read holds; the archived
 * dependents the server also deletes (D-636) have no line, and no copy promises otherwise.
 *
 * While the confirmed save runs the shipped dialog keeps itself open, disables both buttons and ignores the
 * backdrop and Escape; this wrapper only changes the confirm label to "Salvando…" (FA-UI-1). When the save
 * fails the dialog closes and the form shows its own failure alert (FA-UI-2).
 */
export function EraseAnswersDialog({
  open,
  kind,
  titles,
  pending = false,
  onConfirm,
  onClose,
}: EraseAnswersDialogProps) {
  const t = useTranslations('profileForm.member');
  const shown = titles.slice(0, ERASE_LIST_LIMIT);
  const more = titles.length - shown.length;
  const confirmLabel = pending
    ? t('saving')
    : kind === 'advance'
      ? t('erase.confirmNext')
      : t('erase.confirmSave');

  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      icon={Trash2}
      scrollBody
      title={t('erase.title')}
      body={t('erase.body', { n: titles.length })}
      confirmLabel={confirmLabel}
      cancelLabel={t('erase.cancel')}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <ul
        aria-label={t('erase.listLabel')}
        className="flex flex-col gap-1 break-words text-sm font-normal text-text"
      >
        {shown.map((title, index) => (
          // A title can repeat across steps, so the position is part of the key.
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is static for one opening.
          <li key={`${index}-${title}`} className="wrap-anywhere">
            {title}
          </li>
        ))}
        {more > 0 ? (
          <li className="text-text-secondary">{t('erase.more', { count: more })}</li>
        ) : null}
      </ul>
      <p className="mt-3 text-xs font-normal text-text-tertiary">{t('erase.hint')}</p>
    </ConfirmDialog>
  );
}
