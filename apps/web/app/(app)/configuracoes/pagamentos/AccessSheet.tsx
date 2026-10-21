'use client';

import type { AccessItem } from '@rede-social/module-payments/contracts';
import { AccessStatePill } from '@rede-social/module-payments/ui';
import { BottomSheet, Button, ConfirmDialog, StatusPill, useToast } from '@rede-social/ui';
import { Ban, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AccessSheetView } from '@/lib/payments-view';
import {
  type AccessWriteOutcome,
  blockAccessAction,
  removeReleaseAction,
  unblockAccessAction,
} from './actions';

/** What the sheet hands back to its host once a write is over: the server's row, or why there is none. */
export type AccessSettled =
  | {
      kind: 'changed';
      change: 'block' | 'unblock' | 'removeRelease';
      email: string;
      /** The row as the server now has it; `null` when no row remains for the e-mail. */
      access: AccessItem | null;
      serverNow: string;
    }
  | { kind: 'gone'; email: string }
  | { kind: 'forbidden' };

export interface AccessSheetProps {
  open: boolean;
  /** The finished view of the open row. Kept by the host while the sheet animates out. */
  view: AccessSheetView | null;
  /** Interpolated into the block dialog body. */
  tenantName: string;
  /** MUST be stable (`useCallback`): the shipped focus trap re-arms when it changes. */
  onClose: () => void;
  /** Success, a vanished row (404) or a lost permission (403): the HOST closes, toasts and updates. */
  onSettled: (outcome: AccessSettled) => void;
}

/**
 * The access sheet (09.1-14, UI-D-518, D-489, D-504): one component for the three cases an access row
 * can be in, drawn from the finished `AccessSheetView` so it never decides who has access.
 *
 * - **Identity.** The e-mail as the title (`break-all`, so a 120-character address wraps and keeps the
 *   footer on screen at 320px), the pills line, a `<dl>` of Origem, Situação and Validade (never blank),
 *   "Atualizado {when}" and the note by case.
 * - **Actions** stacked, each `fullWidth`: "Bloquear acesso" (outline) opens the danger dialog;
 *   "Desbloquear acesso" (outline) acts at once, because it only restores the previous state;
 *   "Remover liberação" (ghost, danger, a manual release only) opens its own danger dialog: removing
 *   a release is not blocking, so it has its own verb and its own words.
 * - **The server settles.** Every write sends only `{ email }`; what comes back (the updated row, a
 *   vanished row, a lost permission) goes to the host. A failure that has no screen line toasts the
 *   generic one and leaves the row alone. Nothing is optimistic.
 *
 * The danger dialog sits BESIDE the sheet, never inside it: a `fixed` dialog inside the sheet's
 * transformed panel would be positioned against the panel instead of the screen.
 */
export function AccessSheet({ open, view, tenantName, onClose, onSettled }: AccessSheetProps) {
  const t = useTranslations();
  const toast = useToast();
  const [blockOpen, setBlockOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [unblocking, setUnblocking] = useState(false);

  if (!view) return null;
  const { email } = view;

  function settle(outcome: AccessWriteOutcome, change: 'block' | 'unblock' | 'removeRelease') {
    if (outcome.ok) {
      onSettled({
        kind: 'changed',
        change,
        email,
        access: outcome.access,
        serverNow: outcome.serverNow,
      });
      return;
    }
    if (outcome.code === 'gone') {
      onSettled({ kind: 'gone', email });
      return;
    }
    if (outcome.code === 'forbidden') {
      onSettled({ kind: 'forbidden' });
      return;
    }
    toast.show({ tone: 'error', message: t('payments.errors.generic') });
  }

  async function confirmBlock() {
    let outcome: AccessWriteOutcome = { ok: false, code: 'generic' };
    try {
      outcome = await blockAccessAction(email);
    } catch {
      // A network failure reads like any other failed write.
    }
    settle(outcome, 'block');
  }

  async function confirmRemove() {
    let outcome: AccessWriteOutcome = { ok: false, code: 'generic' };
    try {
      outcome = await removeReleaseAction(email);
    } catch {
      // A network failure reads like any other failed write.
    }
    settle(outcome, 'removeRelease');
  }

  async function unblock() {
    if (unblocking) return;
    setUnblocking(true);
    let outcome: AccessWriteOutcome = { ok: false, code: 'generic' };
    try {
      outcome = await unblockAccessAction(email);
    } catch {
      // Falls through to the generic failure toast.
    } finally {
      setUnblocking(false);
    }
    settle(outcome, 'unblock');
  }

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={email} className="[&_h2]:break-all">
        <div data-access-sheet={email} className="flex flex-col gap-4">
          <div data-access-sheet-pills className="flex flex-wrap gap-1">
            <AccessStatePill state={view.state} label={view.stateLabel} />
            <StatusPill tone="neutral">{view.sourceLabel}</StatusPill>
            {view.hasAccount === false ? (
              <StatusPill tone="neutral">{view.noAccountLabel}</StatusPill>
            ) : null}
          </div>

          <dl className="flex flex-col gap-2 text-sm font-normal">
            {view.rows.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-text-secondary">{row.label}</dt>
                <dd className="min-w-0 break-words text-right text-text">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs font-normal text-text-tertiary">{view.updated}</p>

          {view.notes.map((note) => (
            <p key={note} className="text-xs font-normal text-text-secondary">
              {note}
            </p>
          ))}

          <div className="flex flex-col gap-2">
            {view.actions.block ? (
              <Button variant="outline" fullWidth onClick={() => setBlockOpen(true)}>
                {t('payments.access.sheet.block')}
              </Button>
            ) : null}
            {view.actions.unblock ? (
              <Button variant="outline" fullWidth loading={unblocking} onClick={unblock}>
                {t('payments.access.sheet.unblock')}
              </Button>
            ) : null}
            {view.actions.removeRelease ? (
              <Button
                variant="ghost"
                fullWidth
                className="text-danger"
                onClick={() => setRemoveOpen(true)}
              >
                {t('payments.access.sheet.removeRelease')}
              </Button>
            ) : null}
          </div>
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={blockOpen}
        tone="danger"
        icon={Ban}
        title={t('payments.access.blockDialog.title', { email })}
        body={t('payments.access.blockDialog.body', { tenant: tenantName })}
        confirmLabel={t('payments.access.blockDialog.confirm')}
        cancelLabel={t('payments.access.blockDialog.cancel')}
        onConfirm={confirmBlock}
        onClose={() => setBlockOpen(false)}
      />

      <ConfirmDialog
        open={removeOpen}
        tone="danger"
        icon={Trash2}
        title={t('payments.access.removeDialog.title', { email })}
        body={t('payments.access.removeDialog.body', { tenant: tenantName })}
        confirmLabel={t('payments.access.removeDialog.confirm')}
        cancelLabel={t('payments.access.removeDialog.cancel')}
        onConfirm={confirmRemove}
        onClose={() => setRemoveOpen(false)}
      />
    </>
  );
}
