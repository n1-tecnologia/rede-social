'use client';

import { Button, ConfirmDialog, useToast } from '@rede-social/ui';
import { FileDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { startCsvDownload } from '@/lib/profile-form/download';

/** The BFF relay of the answers CSV (the route handler of this plan). */
export const EXPORT_URL = '/api/profile-form/export';

/** How long the "Arquivo gerado" toast stays (UI-D-579). */
const DONE_TOAST_MS = 6000;

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The confirmation in front of the answers export (12-17, D-595, UI-D-579; PFORM-21, T-12-37). It is the
 * only place the admin is told that personal data leaves the app and that the export is logged. The
 * shipped `ConfirmDialog` does the lock (both buttons disabled while the action runs, focus trap, focus
 * back on the opener) and closes itself when the action settles; this component adds the pending label
 * "Preparando…" and the outcome:
 *
 *  - ok: the browser has started the download (`startCsvDownload`), toast "Arquivo gerado. O download
 *    começou." for 6 seconds;
 *  - 403 (the permission was lost in another tab): the shipped forbidden toast and a refresh into the
 *    page's `notFound()`;
 *  - anything else: "Não foi possível exportar agora. Tente de novo." and nothing is cached.
 *
 * No cell is ever read here: the file goes from the relay to the browser's download and stops.
 */
export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const t = useTranslations('profileForm.admin.export');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();
  const [preparing, setPreparing] = useState(false);

  async function run() {
    setPreparing(true);
    try {
      const result = await startCsvDownload(EXPORT_URL);
      if (result.ok) {
        toast.show({ tone: 'success', message: t('done'), durationMs: DONE_TOAST_MS });
      } else if (result.status === 403) {
        toast.show({ tone: 'error', message: tAdmin('errors.forbidden') });
        router.refresh();
      } else {
        toast.show({ tone: 'error', message: t('failed') });
      }
    } finally {
      setPreparing(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      tone="brand"
      icon={FileDown}
      title={t('title')}
      body={t('body')}
      confirmLabel={preparing ? t('pending') : t('confirm')}
      cancelLabel={t('cancel')}
      onConfirm={run}
      onClose={onClose}
    />
  );
}

export interface ExportActionProps {
  /** How many members exist: with none there is nothing to export (the button is disabled with its helper). */
  memberTotal: number;
}

/**
 * The summary card's "Exportar respostas (CSV)" button and the dialog it opens (UI-D-566, UI-D-579). The
 * page itself is gated by `profile_form.manage` (admin only), so only an `admin_tenant` ever renders it;
 * the real control is the API's guard chain.
 */
export function ExportAction({ memberTotal }: ExportActionProps) {
  const t = useTranslations('profileForm.admin.export');
  const helperId = useId();
  const [open, setOpen] = useState(false);
  const empty = memberTotal === 0;

  return (
    <div className="flex min-w-0 flex-col items-start gap-1 md:ml-auto md:items-end">
      <Button
        variant="outline"
        size="sm"
        hitArea
        disabled={empty}
        aria-describedby={empty ? helperId : undefined}
        onClick={() => setOpen(true)}
      >
        <FileDown aria-hidden size={16} />
        {t('button')}
      </Button>
      {empty ? (
        <p id={helperId} className="break-words text-xs font-normal text-text-tertiary">
          {t('noMembers')}
        </p>
      ) : null}
      <ExportDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
