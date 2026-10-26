'use client';

import { ConfirmDialog, cn, useToast } from '@rede-social/ui';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { deleteEventAction } from '../actions';

export interface DeleteEventControlProps {
  eventId: string;
  className?: string;
}

/**
 * "Excluir evento" (D-552, PEND-07): the danger trigger of the event form and of the cancelled-event
 * notice (D-548: whoever may edit events, for any event; a member never gets it). The model is
 * `CancelEventControl`.
 *
 * **Always confirmed first** (the `danger` `ConfirmDialog`): the fixed copy says what disappears and
 * that the confirmations and check-ins are kept, and nobody is told (D-90, D-214). The copy never
 * interpolates the event's title and this island takes none, so no title can reach a toast, the
 * dialog or a console call (T-09.3-39). The pending state is `ConfirmDialog`'s own: it covers the
 * trigger, ignores a second tap and keeps Escape and the backdrop inert, so the trigger itself has no
 * loading state.
 *
 * **The landing is `replace('/eventos')`**, never `push` and never through the form's exit guard: the
 * event's page and its edit form are dead after the delete, so neither may be the previous history
 * entry, and the form's own "Descartar alterações?" guard has nothing to say about a deleted event.
 * Three outcomes, each with its own line: success (toast, landing), the 404 race (an info toast that
 * the event is already gone, then the same landing) and a failure (error toast, the page stays and the
 * trigger remains available).
 */
export function DeleteEventControl({ eventId, className }: DeleteEventControlProps) {
  const t = useTranslations('events');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const remove = async () => {
    const result = await deleteEventAction(eventId);
    if (!result.ok && result.code !== 'not_found') {
      toast.show({ tone: 'error', message: t('errors.delete') });
      return;
    }
    if (result.ok) toast.show({ tone: 'success', message: t('toasts.deleted') });
    else toast.show({ tone: 'info', message: t('errors.deleteGone') });
    router.replace('/eventos');
  };

  return (
    <div
      data-delete-control="event"
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        className="inline-flex h-11 items-center gap-2 rounded-xl text-sm font-bold text-danger transition-opacity active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden size={20} />
        {t('delete.action')}
      </button>
      <ConfirmDialog
        open={open}
        tone="danger"
        icon={Trash2}
        title={t('confirm.delete.title')}
        body={t('confirm.delete.body')}
        confirmLabel={t('confirm.delete.confirm')}
        cancelLabel={t('confirm.delete.dismiss')}
        onConfirm={remove}
        onClose={() => setOpen(false)}
        onError={(error) => {
          // Shape only: never the event's title.
          console.error('events.delete_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('errors.delete') });
        }}
      />
    </div>
  );
}
