'use client';

import { MODERATION_REASON_MAX, type ReportResolveAction } from '@rede-social/contracts/moderation';
import { BottomSheet, Button, ConfirmDialog, Textarea, useMediaQuery } from '@rede-social/ui';
import { Archive, Ban, Check, type LucideIcon, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { StoryMenuRow } from '@/components/stories/StoryMenuRow';
import type { ReportQueueRow } from '@/lib/reports';
import type { ResolveGlyph } from '@/lib/reports-view';

/** The lucide glyph of each resolve row: the view names it, the screen draws it (MOD-02). */
const GLYPH: Record<ResolveGlyph, LucideIcon> = {
  Check,
  Trash2,
  Archive,
  Ban,
};

/** The counter appears from 450 characters (UI-D-274), never before. */
const COUNTER_FROM = 450;

export interface ResolveSheetProps {
  /** The report being resolved. Kept by the host while the sheet animates out. */
  row: ReportQueueRow | null;
  open: boolean;
  /** MUST be stable (`useCallback`): the shipped focus trap re-arms when it changes. */
  onClose: () => void;
  /** Interpolated into the block step's body ("{name} perde o acesso a {tenant}..."). */
  tenantName: string;
  /**
   * The resolution itself. The HOST runs the server action, toasts, updates the row and closes this sheet; it never
   * throws. The sheet only chooses the verb and, for a block, carries the optional internal reason.
   */
  onResolve: (
    row: ReportQueueRow,
    resolution: ReportResolveAction,
    reason?: string,
  ) => Promise<void>;
}

/**
 * The resolve sheet (MODER-04, D-732, UI-D-638, UI-D-874): "Resolver denúncia", with ONLY the rows legal for the
 * report's subject. The rows come finished from `resolveRowsFor`; a row that is not legal for the subject is never
 * in the list, so there is nothing here to disable and nothing for a stylesheet to hide (T-11-30).
 *
 * - **Ignorar denúncia** has no confirmation.
 * - **Remover conteúdo** and **Arquivar comunidade** open the shipped centred `ConfirmDialog` in the danger tone; the
 *   community's dialog is the UI-D-714 archive wording with the log sentence appended, and cancelling it returns to
 *   this sheet.
 * - **Bloquear autor** swaps this sheet's content for the Phase 8 block step (the `MemberAdminSheet` pattern: no
 *   second sheet is stacked): "Bloquear {nome}?", the effect body, the optional INTERNAL reason ("{nome} não vê o
 *   motivo"), "Voltar" (which keeps the typed reason) and the confirm.
 * - **A double tap sends one request**: the sheet locks while a call runs and the host holds its own in-flight guard.
 *
 * Every word is a catalog sentence and every member string React text (T-11-16).
 */
export function ResolveSheet({ row, open, onClose, tenantName, onResolve }: ResolveSheetProps) {
  const ts = useTranslations('safety');
  const tm = useTranslations('moderation');
  const tmm = useTranslations('moderation.member');
  const desktop = useMediaQuery('(min-width: 768px)');
  const [step, setStep] = useState<'main' | 'block'>('main');
  const [confirm, setConfirm] = useState<'remove' | 'archive' | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  // A different report (or a reopen) starts clean: main step, no draft, no dialog.
  const [shownId, setShownId] = useState<string | null>(row?.id ?? null);
  const [wasOpen, setWasOpen] = useState(open);
  if (shownId !== (row?.id ?? null) || wasOpen !== open) {
    setShownId(row?.id ?? null);
    setWasOpen(open);
    if (open) {
      setStep('main');
      setConfirm(null);
      setReason('');
    }
  }

  useEffect(() => {
    if (!open || step !== 'block') return;
    const frame = requestAnimationFrame(() => reasonRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, step]);

  if (!row) return null;

  /** One call at a time: a second tap in the same frame is a no-op before `pending` re-renders. */
  const run = async (resolution: ReportResolveAction, why?: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await onResolve(row, resolution, why);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const choose = (kind: ReportQueueRow['resolve']['rows'][number]['kind']) => {
    if (pending) return;
    if (kind === 'dismiss') void run('dismiss');
    else if (kind === 'remove' || kind === 'archive') setConfirm(kind);
    else setStep('block');
  };

  const author = row.author;
  const counterShown = reason.length >= COUNTER_FROM;
  const helperId = 'report-block-reason-helper';

  const mainStep = (
    <div data-resolve-step="main" aria-busy={pending || undefined} className="flex flex-col gap-1">
      {row.resolve.rows.map((view) => (
        <StoryMenuRow
          key={view.kind}
          icon={GLYPH[view.glyph]}
          label={view.label}
          destructive={view.danger}
          onClick={() => choose(view.kind)}
        />
      ))}
      {row.resolve.helper ? (
        <p data-resolve-helper className="px-3 pt-1 text-xs font-normal text-text-tertiary">
          {row.resolve.helper}
        </p>
      ) : null}
    </div>
  );

  const blockStep = (
    <div data-resolve-step="block" aria-busy={pending || undefined} className="flex flex-col gap-4">
      <p className="text-sm font-normal text-text-secondary">
        {tmm('blockStep.body', { name: author, tenant: tenantName })}
      </p>
      <div className="flex flex-col gap-2">
        <Textarea
          ref={reasonRef}
          id="report-block-reason"
          label={tmm('reason.label')}
          placeholder={tmm('reason.placeholder')}
          rows={3}
          maxLength={MODERATION_REASON_MAX}
          value={reason}
          disabled={pending}
          onChange={(event) => setReason(event.target.value)}
          counter={counterShown ? { value: reason.length, max: MODERATION_REASON_MAX } : undefined}
          className="max-h-[7.5rem] overflow-y-auto"
          aria-describedby={helperId}
        />
        <p id={helperId} className="text-xs font-normal text-text-tertiary">
          {tmm('reason.helper', { name: author })}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
        <Button
          variant="ghost"
          onClick={() => setStep('main')}
          disabled={pending}
          className="w-full text-text md:w-auto"
        >
          {tmm('back')}
        </Button>
        <Button
          data-resolve-block-confirm
          variant="danger"
          loading={pending}
          onClick={() => {
            const trimmed = reason.trim();
            void run('block_author', trimmed === '' ? undefined : trimmed);
          }}
          className="w-full md:w-auto"
        >
          {pending ? tmm('blocking') : tmm('confirmBlock')}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <BottomSheet
        open={open && confirm === null}
        onClose={pending ? () => undefined : onClose}
        title={
          step === 'block' ? tmm('blockStep.title', { name: author }) : ts('queue.resolveTitle')
        }
        desktopCard={desktop}
      >
        <div data-resolve-sheet={row.id}>{step === 'block' ? blockStep : mainStep}</div>
      </BottomSheet>
      <ConfirmDialog
        open={open && confirm === 'remove'}
        tone="danger"
        icon={Trash2}
        title={ts('queue.removeDialog.title')}
        body={ts('queue.removeDialog.body')}
        confirmLabel={ts('queue.removeDialog.confirm')}
        cancelLabel={ts('queue.removeDialog.cancel')}
        onConfirm={() => run('remove_content')}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={open && confirm === 'archive'}
        tone="danger"
        icon={Archive}
        title={tm('report.archiveDialog.title')}
        body={tm('report.archiveDialog.body')}
        confirmLabel={tm('report.archiveDialog.confirm')}
        cancelLabel={tm('report.archiveDialog.cancel')}
        onConfirm={() => run('remove_content')}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
